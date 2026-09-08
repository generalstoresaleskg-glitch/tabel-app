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

const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.WHATSAPP_GROUP_ID || "";
const REDIS_URL = process.env.REDIS_URL;

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

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      // Кэширующая обёртка — как в примерах Baileys, снижает число обращений
      // к Redis на каждое сообщение.
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: ["Табель", "Chrome", "1.0"],
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

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

startSock().catch((err) => {
  logger.error(err, "Не удалось запустить подключение к WhatsApp.");
});

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
    </body>`
  );
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

app.post("/notify", checkToken, async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) return res.status(400).json({ error: "Пустое сообщение" });
  if (!GROUP_ID) return res.status(500).json({ error: "WHATSAPP_GROUP_ID не настроен" });
  if (connectionStatus !== "open") return res.status(503).json({ error: "WhatsApp ещё не подключён" });

  try {
    await sock.sendMessage(GROUP_ID, { text: message });
    res.json({ ok: true });
  } catch (err) {
    logger.error(err, "Не удалось отправить сообщение в WhatsApp");
    res.status(500).json({ error: "Не удалось отправить сообщение" });
  }
});

app.listen(PORT, () => {
  logger.info(`HTTP-сервер бота слушает порт ${PORT}`);
});
