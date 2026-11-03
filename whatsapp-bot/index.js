// Бот-мост между приложением «Табель» и групповым чатом WhatsApp.
//
// Подключается к WhatsApp как обычное дополнительное устройство на телефон
// владельца (та же технология, что у WhatsApp Web/Desktop) — официального
// способа писать в обычные групповые чаты у WhatsApp нет, только так.
// Основное приложение (на Vercel) дёргает сюда POST /notify, когда нужно
// отправить сообщение в общий чат. Разовая настройка — открыть /qr в
// браузере на телефоне владельца и отсканировать код в WhatsApp
// (Настройки → Связанные устройства → Привязать устройство).
//
// Подробная инструкция по развёртыванию — в README.md рядом с этим файлом.
import express from "express";
import { Boom } from "@hapi/boom";
import { Redis } from "ioredis";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { useRedisAuthState } from "./redis-auth-state.js";
import { setupChats } from "./chats.js";

const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.WHATSAPP_GROUP_ID || "";
const REDIS_URL = process.env.REDIS_URL;
// Анализ переписок (скачивание истории всех чатов + DeepSeek). Включается
// только явно: CHAT_ANALYSIS=on. Бот на личном номере владельца шлёт только
// уведомления, /клиент и дни рождения — и не трогает его личные переписки.
const CHAT_ANALYSIS = process.env.CHAT_ANALYSIS === "on";
// Свой ключ сессии в Redis для каждого бота — чтобы второй бот (на номере
// магазина) мог жить в той же базе, не затирая первого.
const SESSION_PREFIX = process.env.SESSION_PREFIX || "baileys";
// Роль процесса. main — бот на номере владельца: уведомления, /клиент, дни
// рождения. store — второй бот на номере магазина: только сбор переписок и
// анализ клиентов (его страницы открываются по адресу /store/qr, /store/pair).
const ROLE = process.env.BOT_ROLE === "store" ? "store" : "main";
const IS_MAIN = ROLE === "main";
// Префикс адресов страниц, если процесс стоит за прокси (у второго бота — /store).
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");
// Внутренний порт второго бота (на него главный процесс проксирует /store/*).
const STORE_PORT = Number(process.env.STORE_PORT || 10001);
// Render сам подставляет публичный адрес сервиса. По нему бот раз в 10 минут
// стучится сам к себе: бесплатный тариф усыпляет сервис после ~15 минут без
// входящих запросов, а спящий бот просыпается до минуты — за это время
// приложение перестаёт ждать, и уведомление о приходе/уходе теряется.
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const KEEP_AWAKE_MS = 10 * 60 * 1000;
// Адрес основного приложения (Vercel): сюда бот пересылает «/клиент …» и
// отсюда берёт список именинников. Без него эти две функции молчат, а
// уведомления о приходе/уходе работают как обычно.
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
// Во сколько (час по Бишкеку) писать в чат про дни рождения клиентов.
const BIRTHDAY_HOUR = Number(process.env.BIRTHDAY_HOUR || 9);

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN не задан — без него /notify и /groups не будут работать. Остановка.");
  process.exit(1);
}
if (!REDIS_URL) {
  console.error("REDIS_URL не задан — без него сессия WhatsApp не переживёт перезапуск. Остановка.");
  process.exit(1);
}

const logger = pino({ level: process.env.LOG_LEVEL || "info" }).child({ bot: ROLE });
const redis = new Redis(REDIS_URL);

let sock = null;
let latestQrDataUrl = null;
let connectionStatus = "starting"; // starting | qr | open | closed | idle
// Пока бот не привязан, он НЕ стучится в WhatsApp сам по себе: раньше он
// круглосуточно каждые ~2,5 минуты открывал новую попытку привязки (сотни в
// день), и WhatsApp из-за этого закрывает номеру привязку новых устройств
// («Сейчас невозможно связать новые устройства»). Теперь попытки идут только
// 10 минут после того, как кто-то открыл /qr или /pair.
let linkWantedUntil = 0;
const LINK_WINDOW_MS = 10 * 60 * 1000;
// Подряд неудачные переподключения уже привязанного бота — растущая пауза
// (3 с → 6 с → … → 5 мин), чтобы не долбить WhatsApp каждые 3 секунды.
let failures = 0;
// Режим привязки по коду: пока он включён, сокет держит одну попытку привязки
// долго (а не рвёт её через ~2 минуты, как при QR), иначе 8-значный код
// «умирает» раньше, чем его успевают ввести на телефоне.
let pairingUntil = 0;
const PAIRING_WINDOW_MS = 10 * 60 * 1000;
const isPairing = () => Date.now() < pairingUntil;

async function startSock() {
  let { state, saveCreds, clearAll } = await useRedisAuthState(redis, SESSION_PREFIX);
  // Полупривязанная сессия: код запрашивали (Baileys уже записал номер в
  // creds.me), но привязка не завершилась (нет creds.account). С такой сессией
  // Baileys пытается «войти» вместо новой привязки, WhatsApp отвечает отказом —
  // и любой код сразу недействителен. Начинаем с чистого листа.
  if (state.creds.me && !state.creds.account) {
    logger.warn("Незавершённая привязка — сбрасываю её и начинаю заново.");
    await clearAll();
    ({ state, saveCreds, clearAll } = await useRedisAuthState(redis, SESSION_PREFIX));
  }
  if (!state.creds.account && Date.now() > linkWantedUntil && !isPairing()) {
    connectionStatus = "idle";
    latestQrDataUrl = null;
    logger.info("Бот не привязан — жду, пока откроют /qr или /pair (сам в WhatsApp не стучусь).");
    return;
  }
  const { version } = await fetchLatestBaileysVersion();
  // Вид устройства — тот же, под каким бот привязан с самого начала.
  // «Компьютер Mac» (Browsers.macOS) WhatsApp сейчас не принимает: и вход, и
  // новая привязка обрываются с кодом 428. Старую историю бот добирает сам
  // докачкой по каждому чату (см. chats.js), поэтому вид устройства не важен.
  const browser = ["Табель", "Chrome", "1.0"];

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      // Кэширующая обёртка — как в примерах Baileys, снижает число обращений
      // к Redis на каждое сообщение.
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser,
    syncFullHistory: CHAT_ANALYSIS,
    shouldSyncHistoryMessage: () => CHAT_ANALYSIS,
    // Не «светиться» онлайн: иначе телефон магазина перестаёт показывать
    // уведомления о новых сообщениях, пока бот подключён.
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    // В режиме кода одна попытка привязки живёт 3 минуты на каждый шаг
    // (несколько шагов подряд), вместо стандартных 60/20 секунд для QR.
    ...(isPairing() ? { qrTimeout: 3 * 60 * 1000 } : {}),
  });

  sock.ev.on("creds.update", saveCreds);
  if (CHAT_ANALYSIS) chats.attach(sock);
  sock.ev.on("messages.upsert", (upsert) => {
    handleIncoming(upsert).catch((err) => logger.error(err, "Ошибка при обработке входящих сообщений"));
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQrDataUrl = await QRCode.toDataURL(qr);
      connectionStatus = "qr";
      logger.info("Новый QR-код готов — откройте /qr в браузере на телефоне владельца.");
    }

    if (connection === "open") {
      pairingUntil = 0;
      linkWantedUntil = 0;
      failures = 0;
      latestQrDataUrl = null;
      connectionStatus = "open";
      logger.info({ me: sock.user }, "WhatsApp подключён.");
      // Список чатов бота в логах — чтобы при смене общего чата сразу видеть
      // его id для WHATSAPP_GROUP_ID, не открывая /groups вручную.
      sock
        .groupFetchAllParticipating()
        .then((groups) => {
          const list = Object.values(groups).map((g) => ({ id: g.id, name: g.subject }));
          const current = list.find((g) => g.id === GROUP_ID);
          logger.info({ groups: list, current: current?.name ?? null }, "Чаты бота");
          if (!current) logger.warn({ GROUP_ID }, "Бот не состоит в чате WHATSAPP_GROUP_ID — уведомления туда не дойдут");
        })
        .catch((err) => logger.warn({ err: err?.message }, "Не удалось получить список чатов"));
    }

    if (connection === "close") {
      connectionStatus = "closed";
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        logger.warn("Устройство отвязано в самом WhatsApp — сбрасываю сессию, нужен новый QR.");
        await clearAll();
      } else {
        logger.warn({ statusCode }, "Соединение с WhatsApp разорвано, переподключаюсь…");
      }
      // Привязка в процессе (или WhatsApp просит перезапуск после привязки) —
      // быстро. Уже привязанный бот при повторных сбоях ждёт всё дольше.
      const paired = !!state.creds.account && !loggedOut;
      let delay = 3000;
      if (paired && statusCode !== DisconnectReason.restartRequired) {
        failures++;
        delay = Math.min(3000 * 2 ** Math.min(failures - 1, 7), 5 * 60 * 1000);
      }
      setTimeout(() => startSock().catch((err) => logger.error(err, "Не удалось переподключиться")), delay);
    }
  });
}

// Переписки магазина: сохранение, докачка истории и анализ — см. chats.js.
const chats = setupChats({ getSock: () => sock, callApp, sendGroup, logger, redis, enabled: CHAT_ANALYSIS });

// Кто-то открыл /qr или /pair — бот начинает попытки привязки на 10 минут.
function wantLink() {
  linkWantedUntil = Date.now() + LINK_WINDOW_MS;
  // Бот магазина после привязки сам запускает докачку истории и анализ.
  if (CHAT_ANALYSIS) chats.armAutoPipeline().catch(() => {});
  if (connectionStatus === "idle") {
    connectionStatus = "starting";
    startSock().catch((err) => logger.error(err, "Не удалось запустить подключение к WhatsApp."));
  }
}

async function sendGroup(text) {
  if (!GROUP_ID || !(await waitForOpen(30000))) {
    logger.warn({ text }, "Не удалось написать в общий чат — WhatsApp не подключён");
    return;
  }
  try {
    await sock.sendMessage(GROUP_ID, { text });
  } catch (err) {
    logger.error({ err: err?.message }, "Не удалось написать в общий чат");
  }
}

startSock().catch((err) => {
  logger.error(err, "Не удалось запустить подключение к WhatsApp.");
});

// --- Клиенты: «/клиент …» из общего чата ----------------------------------

const CLIENT_COMMAND_RE = /^\s*[\/\\]\s*клиент(?![а-яё])/i;

function messageText(msg) {
  const m = msg?.ephemeralMessage?.message || msg?.viewOnceMessage?.message || msg;
  return m?.conversation || m?.extendedTextMessage?.text || "";
}

// Номер отправителя цифрами (996XXXXXXXXX). В группах WhatsApp часто вместо
// номера присылает скрытый id (…@lid), а настоящий номер кладёт в
// participantAlt — берём тот, что заканчивается на @s.whatsapp.net.
function senderPhone(m) {
  const candidates = m.key.fromMe ? [sock?.user?.id] : [m.key.participant, m.key.participantAlt];
  const jid = candidates.find((j) => j && j.endsWith("@s.whatsapp.net"));
  return jid ? jid.split("@")[0].split(":")[0] : null;
}

async function callApp(path, options = {}) {
  let lastErr;
  // Приложение на Vercel и база Neon после простоя просыпаются не мгновенно —
  // одна повторная попытка спасает от потери сообщения.
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`${APP_URL}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${BOT_TOKEN}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

async function handleIncoming({ messages, type }) {
  if (!APP_URL) return;
  for (const m of messages) {
    if (m.key.remoteJid !== GROUP_ID || !m.message) continue;
    const text = messageText(m.message);

    // «/анализ», «/история», «/статус» — работа с перепиской магазина.
    const fresh = Date.now() - Number(m.messageTimestamp || 0) * 1000 < 10 * 60 * 1000;
    if (CHAT_ANALYSIS && fresh && /^\s*[\/\\]\s*(анализ|история|статус)/i.test(text)) {
      if (await redis.set(`cmd:${m.key.id}`, "1", "EX", 3600, "NX")) {
        const reply = await chats.handleCommand(text).catch((err) => `⚠️ ${err?.message}`);
        if (reply) await sock.sendMessage(GROUP_ID, { text: reply }, { quoted: m });
      }
      continue;
    }

    if (!IS_MAIN || type !== "notify" || !CLIENT_COMMAND_RE.test(text)) continue;
    // После переподключения WhatsApp досылает старые сообщения — их не трогаем,
    // иначе бот ответит на давно обработанные команды повторно.
    const ts = Number(m.messageTimestamp || 0) * 1000;
    if (ts && Date.now() - ts > 10 * 60 * 1000) continue;

    let reply;
    let birthday = null;
    try {
      const r = await callApp("/api/clients/ingest", {
        method: "POST",
        body: JSON.stringify({ text, senderPhone: senderPhone(m), senderName: m.pushName || null }),
      });
      if (r.ignored) continue;
      reply = r.reply;
      birthday = r.birthday || null;
      logger.info({ status: r.status, ok: r.ok, birthdayToday: !!birthday }, "Команда /клиент обработана");
    } catch (err) {
      logger.error({ err: err?.message }, "Не удалось передать клиента в приложение");
      reply = "⚠️ Не получилось сохранить клиента — система не ответила. Отправьте сообщение ещё раз через минуту.";
    }
    if (reply) await sock.sendMessage(GROUP_ID, { text: reply }, { quoted: m });
    // У клиента день рождения сегодня — поздравление сразу, не дожидаясь утра.
    if (birthday?.message && (await markAnnounced([birthday.id])).length) {
      await sock.sendMessage(GROUP_ID, { text: birthday.message });
    }
  }
}

// --- Дни рождения -----------------------------------------------------------
//
// Утром (BIRTHDAY_HOUR по Бишкеку) — одна проверка всей базы. Клиенты,
// добавленные позже в тот же день, поздравляются сразу при добавлении (см.
// handleIncoming). Чаще в приложение не ходим: каждое обращение будит базу
// Neon, а её бесплатный лимит считается по времени бодрствования.
// Кого уже поздравили сегодня, бот помнит в Redis — повторов не будет даже
// после перезапуска.

function bishkekNow() {
  const d = new Date(Date.now() + 6 * 60 * 60 * 1000); // UTC+6, без перехода на летнее время
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

// Отмечает клиентов как «сегодня поздравлены», возвращает тех, кто ещё не был.
async function markAnnounced(ids) {
  const key = `birthdays:announced:${bishkekNow().date}`;
  const fresh = [];
  for (const id of ids) if (await redis.sadd(key, id)) fresh.push(id);
  await redis.expire(key, 3 * 24 * 3600);
  return fresh;
}

async function birthdayCheck() {
  if (!APP_URL || !GROUP_ID || connectionStatus !== "open") return;
  const { date, hour } = bishkekNow();
  if (hour < BIRTHDAY_HOUR) return;
  const doneKey = `birthdays:checked:${date}`;
  if (await redis.get(doneKey)) return; // утренняя проверка сегодня уже была
  const already = await redis.smembers(`birthdays:announced:${date}`);
  const r = await callApp(`/api/clients/birthdays?exclude=${encodeURIComponent(already.join(","))}`);
  if (r.message && r.ids?.length) {
    await sock.sendMessage(GROUP_ID, { text: r.message });
    await markAnnounced(r.ids);
  }
  await redis.set(doneKey, "1", "EX", 3 * 24 * 3600);
  logger.info({ count: r.count }, "Проверка дней рождения выполнена");
}

if (IS_MAIN) setInterval(() => {
  birthdayCheck().catch((err) => logger.error({ err: err?.message }, "Проверка дней рождения не удалась — повторю через 5 минут"));
}, 5 * 60 * 1000);

// --- HTTP-сервер -----------------------------------------------------------

const app = express();

// Главный процесс пропускает /store/* во второй бот (номер магазина), который
// слушает только внутренний порт. Тело передаём как есть.
if (IS_MAIN) {
  app.use("/store", express.raw({ type: "*/*", limit: "5mb" }), async (req, res) => {
    try {
      const headers = {};
      for (const h of ["content-type", "authorization"]) if (req.headers[h]) headers[h] = req.headers[h];
      const hasBody = !["GET", "HEAD"].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length;
      const r = await fetch(`http://127.0.0.1:${STORE_PORT}${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      });
      res.status(r.status);
      for (const h of ["content-type", "location"]) {
        const v = r.headers.get(h);
        if (v) res.set(h, v);
      }
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      res
        .status(502)
        .set("Content-Type", "text/html; charset=utf-8")
        .send("<h2>Бот магазина ещё запускается</h2><p>Обновите страницу через 20 секунд.</p>");
    }
  });
}

app.use(express.json());

function checkToken(req, res, next) {
  const header = req.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const token = bearer || req.query.token;
  if (token !== BOT_TOKEN) {
    return res.status(401).json({ error: "Неверный или отсутствующий токен" });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({
    status: connectionStatus,
    connected: connectionStatus === "open",
    phone: sock?.user?.id ?? null,
    groupConfigured: !!GROUP_ID,
  });
});

// Страница для сканирования — открывается прямо в браузере телефона.
// Защищена тем же токеном через ?token=, чтобы случайный человек со ссылкой
// не смог перехватить привязку во время настройки.
app.get("/qr", checkToken, (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  if (connectionStatus !== "open") wantLink();
  if (connectionStatus === "open") {
    return res.send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Уже подключено ✅</h2>
        <p>WhatsApp-бот подключён и готов слать уведомления. Новый QR не нужен.</p>
      </body>`
    );
  }
  if (!latestQrDataUrl) {
    return res.send(
      `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5">
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Код ещё готовится…</h2>
        <p>Страница обновится сама через пару секунд.</p>
      </body>`
    );
  }
  // WhatsApp сам меняет QR-код каждые ~20 секунд (это нормально — так устроена
  // привязка устройств), поэтому страница обязательно должна обновляться сама:
  // иначе человек наводит камеру на уже устаревший код и получает в WhatsApp
  // ошибку вида «проверьте соединение и повторите попытку».
  res.send(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="12">
    <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Отсканируйте код в WhatsApp</h2>
      <p>WhatsApp → Настройки → Связанные устройства → Привязать устройство</p>
      <img src="${latestQrDataUrl}" style="width:280px;height:280px" />
      <p style="color:#888;font-size:13px">Код обновляется автоматически — если не успели, просто наведите камеру ещё раз через пару секунд.</p>
      <p>QR не сканируется? <a href="${BASE}/pair?token=${encodeURIComponent(req.query.token || "")}">Привязать по коду из 8 символов</a></p>
    </body>`
  );
});

// Привязка по коду вместо QR: на телефоне «Связанные устройства →
// Привязать устройство → Связать по номеру телефона» и ввести 8 символов.
// Удобно, когда QR не сканируется или страницу открыть негде, кроме телефона.
const STORE_PHONE = (process.env.BOT_PHONE || process.env.STORE_PHONE || "996222904448").replace(/\D/g, "");

function pairPage(token, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px;line-height:1.5">${body}
    <p style="margin-top:32px;color:#888;font-size:13px"><a href="${BASE}/qr?token=${encodeURIComponent(token)}">Привязать по QR-коду</a></p></body>`;
}

app.get("/pair", checkToken, (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  const token = String(req.query.token || "");
  if (connectionStatus === "open") {
    return res.send(pairPage(token, "<h2>Уже подключено ✅</h2><p>Бот привязан к WhatsApp, код не нужен.</p>"));
  }
  res.send(
    pairPage(
      token,
      `<h2>Привязать бота по коду (без QR)</h2>
      <form method="post" action="${BASE}/pair?token=${encodeURIComponent(token)}">
        <p>Номер WhatsApp, к которому привязывается бот:</p>
        <input name="phone" value="+${STORE_PHONE}" style="font-size:18px;padding:8px;width:100%;box-sizing:border-box">
        <p><button style="font-size:18px;padding:12px 20px;background:#c8400e;color:#fff;border:0;border-radius:10px">Получить код</button></p>
      </form>`
    )
  );
});

app.post("/pair", express.urlencoded({ extended: false }), checkToken, async (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  const token = String(req.query.token || "");
  if (connectionStatus === "open") {
    return res.send(pairPage(token, "<h2>Уже подключено ✅</h2>"));
  }
  const phone = String(req.body?.phone || STORE_PHONE).replace(/\D/g, "");
  // Перезапускаем подключение в режиме кода: новый сокет не будет рваться
  // каждые ~2 минуты, и выданный код проживёт, пока его вводят на телефоне.
  pairingUntil = Date.now() + PAIRING_WINDOW_MS;
  linkWantedUntil = pairingUntil;
  if (connectionStatus === "idle") {
    connectionStatus = "starting";
    startSock().catch((err) => logger.error(err, "Не удалось запустить подключение к WhatsApp."));
  } else {
    connectionStatus = "starting";
    sock?.end?.(new Boom("Перезапуск для привязки по коду", { statusCode: DisconnectReason.restartRequired }));
  }
  const until = Date.now() + 30000;
  while (connectionStatus !== "qr" && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  if (connectionStatus !== "qr" || !sock) {
    return res.send(pairPage(token, "<h2>Бот ещё готовится</h2><p>Обновите страницу через 10 секунд и нажмите «Получить код» ещё раз.</p>"));
  }
  try {
    const code = await sock.requestPairingCode(phone);
    const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    logger.info({ phone }, "Выдан код привязки");
    res.send(
      pairPage(
        token,
        `<h2>Код привязки</h2>
        <div style="font-size:40px;font-weight:bold;letter-spacing:4px;text-align:center;padding:16px;border:2px dashed #c8400e;border-radius:12px">${pretty}</div>
        <ol>
          <li>На телефоне с этим номером: WhatsApp → Настройки → <b>Связанные устройства</b> → <b>Привязать устройство</b>.</li>
          <li>Внизу экрана с камерой нажмите <b>«Связать по номеру телефона»</b>.</li>
          <li>Введите код выше. Он действует несколько минут — если не успели, вернитесь назад и получите новый.</li>
          <li>Не нажимайте «Получить код» повторно, пока вводите этот — новый запрос отменяет старый код.</li>
        </ol>
        <p>Когда привяжется, откройте <a href="${BASE}/qr?token=${encodeURIComponent(token)}">эту страницу</a> — там будет «Уже подключено ✅».</p>`
      )
    );
  } catch (err) {
    logger.error({ err: err?.message }, "Не удалось получить код привязки");
    res.send(pairPage(token, `<h2>Не получилось</h2><p>${String(err?.message || err)}</p><p>Подождите 10 секунд и попробуйте снова.</p>`));
  }
});

// Список групп, в которых состоит номер бота — нужен один раз, чтобы найти
// id нужного группового чата и прописать его как WHATSAPP_GROUP_ID.
app.get("/groups", checkToken, async (req, res) => {
  if (connectionStatus !== "open") {
    return res.status(503).json({ error: "WhatsApp ещё не подключён" });
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map((g) => ({ id: g.id, name: g.subject }));
    res.json({ groups: list });
  } catch (err) {
    logger.error(err, "Не удалось получить список групп");
    res.status(500).json({ error: "Не удалось получить список групп" });
  }
});

// Если соединение с WhatsApp как раз переподключается (это бывает раз в
// несколько часов и длится пару секунд), не отказываем сразу, а немного ждём.
async function waitForOpen(ms) {
  const until = Date.now() + ms;
  while (connectionStatus !== "open" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return connectionStatus === "open";
}

app.post("/notify", checkToken, async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) return res.status(400).json({ error: "Пустое сообщение" });
  if (!GROUP_ID) return res.status(500).json({ error: "WHATSAPP_GROUP_ID не настроен" });
  if (!(await waitForOpen(10000))) return res.status(503).json({ error: "WhatsApp ещё не подключён" });

  try {
    await sock.sendMessage(GROUP_ID, { text: message });
    res.json({ ok: true });
  } catch (err) {
    logger.error(err, "Не удалось отправить сообщение в WhatsApp");
    res.status(500).json({ error: "Не удалось отправить сообщение" });
  }
});

// Перепривязка, чтобы WhatsApp заново прислал историю переписок. Табель,
// /клиент и дни рождения после неё продолжают работать как раньше.
app.get("/relink", checkToken, (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px;line-height:1.5">
      <h2>Перепривязать WhatsApp и забрать историю переписок</h2>
      <p>Бот отвяжется от номера магазина и покажет новый QR-код. Отсканируйте его <b>тем же телефоном магазина</b>:
      WhatsApp → Настройки → Связанные устройства → Привязать устройство.</p>
      <p>Если телефон спросит про синхронизацию истории — разрешите. Табель, /клиент и дни рождения продолжат работать.</p>
      <form method="post" action="${BASE}/relink?token=${encodeURIComponent(req.query.token || "")}">
        <button style="font-size:18px;padding:12px 20px;background:#c8400e;color:#fff;border:0;border-radius:10px">Перепривязать</button>
      </form>
    </body>`
  );
});

app.post("/relink", checkToken, async (req, res) => {
  if (CHAT_ANALYSIS) await chats.armAutoPipeline();
  try {
    if (sock?.user) await sock.logout();
  } catch (err) {
    logger.warn({ err: err?.message }, "logout не удался — сбрасываю сессию вручную");
    const { clearAll } = await useRedisAuthState(redis, SESSION_PREFIX);
    await clearAll();
    sock?.end?.(undefined);
  }
  res.redirect(303, `${BASE}/qr?token=${encodeURIComponent(req.query.token || "")}`);
});

app.get("/status", checkToken, async (req, res) => {
  res.json({ connection: connectionStatus, job: chats.job, collected: chats.stats, text: await chats.status() });
});

app.post("/analyze", checkToken, (req, res) => {
  if (!CHAT_ANALYSIS) return res.status(409).json({ error: "Анализ переписок на этом боте выключен (CHAT_ANALYSIS)" });
  chats.runAnalysis().catch(() => {});
  res.json({ started: true });
});

app.post("/backfill", checkToken, (req, res) => {
  if (!CHAT_ANALYSIS) return res.status(409).json({ error: "Анализ переписок на этом боте выключен (CHAT_ANALYSIS)" });
  chats.runBackfill().catch(() => {});
  res.json({ started: true });
});

app.listen(IS_MAIN ? PORT : STORE_PORT, IS_MAIN ? undefined : "127.0.0.1", () => {
  logger.info(`HTTP-сервер бота (${ROLE}) слушает порт ${IS_MAIN ? PORT : STORE_PORT}`);
});

if (SELF_URL && IS_MAIN) {
  setInterval(() => {
    fetch(`${SELF_URL}/health`, { signal: AbortSignal.timeout(30000) }).catch((err) =>
      logger.warn({ err: err?.message }, "Самопинг не прошёл — попробую через 10 минут")
    );
  }, KEEP_AWAKE_MS);
  logger.info(`Защита от засыпания включена: пинг ${SELF_URL}/health каждые 10 минут.`);
}
