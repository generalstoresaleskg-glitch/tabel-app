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

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const redis = new Redis(REDIS_URL);

let sock = null;
let latestQrDataUrl = null;
let connectionStatus = "starting"; // starting | qr | open | closed

async function startSock() {
  const { state, saveCreds, clearAll } = await useRedisAuthState(redis, "baileys");
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
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    // Не «светиться» онлайн: иначе телефон магазина перестаёт показывать
    // уведомления о новых сообщениях, пока бот подключён.
    markOnlineOnConnect: false,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);
  chats.attach(sock);
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
      // Не переподключаемся мгновенно в цикле — небольшая пауза бережёт от
      // спама попытками, если проблема не сиюминутная.
      setTimeout(startSock, 3000);
    }
  });
}

// Переписки магазина: сохранение, докачка истории и анализ — см. chats.js.
const chats = setupChats({ getSock: () => sock, callApp, sendGroup, logger, redis });

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
    if (fresh && /^\s*[\/\\]\s*(анализ|история|статус)/i.test(text)) {
      if (await redis.set(`cmd:${m.key.id}`, "1", "EX", 3600, "NX")) {
        const reply = await chats.handleCommand(text).catch((err) => `⚠️ ${err?.message}`);
        if (reply) await sock.sendMessage(GROUP_ID, { text: reply }, { quoted: m });
      }
      continue;
    }

    if (type !== "notify" || !CLIENT_COMMAND_RE.test(text)) continue;
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

setInterval(() => {
  birthdayCheck().catch((err) => logger.error({ err: err?.message }, "Проверка дней рождения не удалась — повторю через 5 минут"));
}, 5 * 60 * 1000);

// --- HTTP-сервер -----------------------------------------------------------

const app = express();
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
      <p>QR не сканируется? <a href="/pair?token=${encodeURIComponent(req.query.token || "")}">Привязать по коду из 8 символов</a></p>
    </body>`
  );
});

// Привязка по коду вместо QR: на телефоне «Связанные устройства →
// Привязать устройство → Связать по номеру телефона» и ввести 8 символов.
// Удобно, когда QR не сканируется или страницу открыть негде, кроме телефона.
const STORE_PHONE = (process.env.STORE_PHONE || "996222904448").replace(/\D/g, "");

function pairPage(token, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px;line-height:1.5">${body}
    <p style="margin-top:32px;color:#888;font-size:13px"><a href="/qr?token=${encodeURIComponent(token)}">Привязать по QR-коду</a></p></body>`;
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
      <form method="post" action="/pair?token=${encodeURIComponent(token)}">
        <p>Номер магазина (к нему привязывается бот):</p>
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
  // Код можно запросить только пока бот ждёт привязки (показывает QR).
  const until = Date.now() + 20000;
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
          <li>На телефоне магазина: WhatsApp → Настройки → <b>Связанные устройства</b> → <b>Привязать устройство</b>.</li>
          <li>Внизу экрана с камерой нажмите <b>«Связать по номеру телефона»</b>.</li>
          <li>Введите код выше. Он действует около 2 минут — если не успели, вернитесь назад и получите новый.</li>
        </ol>
        <p>Когда привяжется, откройте <a href="/qr?token=${encodeURIComponent(token)}">эту страницу</a> — там будет «Уже подключено ✅».</p>`
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
      <form method="post" action="/relink?token=${encodeURIComponent(req.query.token || "")}">
        <button style="font-size:18px;padding:12px 20px;background:#c8400e;color:#fff;border:0;border-radius:10px">Перепривязать</button>
      </form>
    </body>`
  );
});

app.post("/relink", checkToken, async (req, res) => {
  await chats.armAutoPipeline();
  try {
    if (sock?.user) await sock.logout();
  } catch (err) {
    logger.warn({ err: err?.message }, "logout не удался — сбрасываю сессию вручную");
    const { clearAll } = await useRedisAuthState(redis, "baileys");
    await clearAll();
    sock?.end?.(undefined);
  }
  res.redirect(303, `/qr?token=${encodeURIComponent(req.query.token || "")}`);
});

app.get("/status", checkToken, async (req, res) => {
  res.json({ connection: connectionStatus, job: chats.job, collected: chats.stats, text: await chats.status() });
});

app.post("/analyze", checkToken, (req, res) => {
  chats.runAnalysis().catch(() => {});
  res.json({ started: true });
});

app.post("/backfill", checkToken, (req, res) => {
  chats.runBackfill().catch(() => {});
  res.json({ started: true });
});

app.listen(PORT, () => {
  logger.info(`HTTP-сервер бота слушает порт ${PORT}`);
});

if (SELF_URL) {
  setInterval(() => {
    fetch(`${SELF_URL}/health`, { signal: AbortSignal.timeout(30000) }).catch((err) =>
      logger.warn({ err: err?.message }, "Самопинг не прошёл — попробую через 10 минут")
    );
  }, KEEP_AWAKE_MS);
  logger.info(`Защита от засыпания включена: пинг ${SELF_URL}/health каждые 10 минут.`);
}
