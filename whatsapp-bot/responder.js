// Своевременные ответы клиентам (бот на номере магазина).
//
// 1. Автоприветствие. Когда клиент пишет впервые или после паузы
//    (GREETING_COOLDOWN_HOURS, по умолчанию 8 ч без сообщений в чате), бот
//    один раз отвечает коротким «мы получили ваше сообщение». В рабочее время
//    — «скоро ответим», вне его — «ответим с 10:00». Только тем, кто написал
//    первым, и не чаще раза за паузу.
// 2. Индикатор «клиент ждёт». Бот помнит, кому из клиентов ещё не ответили.
//    Если в рабочее время клиент ждёт дольше REPLY_ALERT_MIN минут — бот пишет
//    в общий рабочий чат; если дольше REPLY_ESCALATE_MIN — пишет второй раз,
//    жёстче. Дальше не повторяет. Сообщение, отправленное в ответ с телефона
//    магазина, снимает «ожидание». Сообщения вне рабочего времени начинают
//    отсчёт с открытия. «Спасибо», «ок» и смайлики ожидания не создают.
//    Список тех, кто ждёт прямо сейчас, — команда «/ждут» в рабочем чате.
// 3. Каждый ответ сотрудника записывается (время от сообщения клиента до
//    ответа) — позже по этим данным можно считать скорость ответов.
//
// Настройки (переменные Render, все необязательные):
//   RESPONDER=off            — выключить всё
//   AUTO_GREETING=off        — выключить только автоприветствие
//   WORK_START_HOUR / WORK_END_HOUR — рабочие часы по Бишкеку (10 и 20)
//   REPLY_ALERT_MIN / REPLY_ESCALATE_MIN — 10 и 30 минут
//   GREETING_COOLDOWN_HOURS  — 8
//   GREETING_TEXT / GREETING_OFF_TEXT — свои тексты ({open} — час открытия)
//   IGNORE_PHONES            — номера через запятую: им не отвечаем и не следим

const TZ_MS = 6 * 60 * 60 * 1000; // Бишкек, UTC+6 без перехода на летнее время
const WAIT_KEY = "reply:wait";

const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

const ACK_RE = /^[\s\p{P}\p{S}]*(спасибо|благодарю|рахмат|рахмат\s+сизге|ок|окей|ok|okay|хорошо|ладно|понятно|good|thanks|thx|👍|🙏|❤️?|\[стикер\]|\[реакция[^\]]*\])?[\s\p{P}\p{S}]*$/iu;

// Благодарность или короткое подтверждение, на которое отвечать не нужно:
// «спасибо», «спасибо большое, очень довольна!», «ок, заберу завтра».
// Если в сообщении есть вопрос (знак «?» или вопросительное слово) — это
// не благодарность, клиент ждёт ответа.
const THANKS_RE = /(спасибо|благодар|рахмат|отлично|супер|класс|замечательно|понятно|поняла|понял|договорились|хорошо|ладно|окей|(^|[\s,.!])ок($|[\s,.!])|(^|[\s,.!])ok($|[\s,.!])|thanks)/i;
const QUESTION_RE = /\?|(^|[\s,.!])(сколько|когда|где|как|какой|какая|какие|какое|почему|можно|можете|есть ли|есть|нет ли|а |ли|подскажите|скажите|нужно|хочу|хотела|хотел|закаж|достав|цена|цену|стоит)/i;

export function isAck(text) {
  const t = String(text || "").trim();
  if (ACK_RE.test(t)) return true;
  return t.length <= 60 && THANKS_RE.test(t) && !QUESTION_RE.test(t);
}

export function setupResponder({ getSock, sendGroup, chatRef, textOf, logger, redis }) {
  const cfg = {
    enabled: process.env.RESPONDER !== "off",
    greeting: process.env.AUTO_GREETING !== "off",
    workStart: num(process.env.WORK_START_HOUR, 10),
    workEnd: num(process.env.WORK_END_HOUR, 20),
    alertMin: num(process.env.REPLY_ALERT_MIN, 10),
    escalateMin: num(process.env.REPLY_ESCALATE_MIN, 30),
    cooldownH: num(process.env.GREETING_COOLDOWN_HOURS, 8),
    ignore: new Set((process.env.IGNORE_PHONES || "").split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean)),
  };
  const GREETING_ON =
    process.env.GREETING_TEXT ||
    "Саламатсызбы! 🌸 Здравствуйте! Спасибо, что написали в AYAY KYZ. Мы увидели ваше сообщение и скоро ответим.";
  const GREETING_OFF =
    process.env.GREETING_OFF_TEXT ||
    "Саламатсызбы! 🌸 Здравствуйте! Спасибо, что написали в AYAY KYZ. Сейчас мы не на связи — ответим {when} с {open}:00. Ваше сообщение не потеряется.";

  const alwaysOpen = cfg.workStart >= cfg.workEnd;
  const hourOf = (ms) => new Date(ms + TZ_MS).getUTCHours();
  const isWorkTime = (ms) => alwaysOpen || (hourOf(ms) >= cfg.workStart && hourOf(ms) < cfg.workEnd);

  // С какого момента считать ожидание: сообщение вне рабочих часов начинает
  // отсчёт с ближайшего открытия.
  function effectiveSince(ms) {
    if (isWorkTime(ms)) return ms;
    const d = new Date(ms + TZ_MS);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const open = d.getUTCHours() < cfg.workStart ? day + cfg.workStart * 3600e3 : day + 24 * 3600e3 + cfg.workStart * 3600e3;
    return open - TZ_MS;
  }

  const greetingFor = (ms) => {
    if (isWorkTime(ms)) return GREETING_ON;
    const when = hourOf(ms) < cfg.workStart ? "сегодня" : "завтра";
    return GREETING_OFF.replace("{when}", when).replace("{open}", String(cfg.workStart));
  };

  const fmtWait = (ms) => {
    const min = Math.max(1, Math.round(ms / 60000));
    return min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60 ? (min % 60) + " мин" : ""}`.trim();
  };
  const fmtPhone = (p) => (p ? "+" + p : "номер не определён");
  const clip = (t, n = 90) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tsMs = (x) => {
    const n = typeof x === "object" && x !== null ? (x.low ?? Number(x)) : Number(x);
    return (n || 0) * 1000;
  };

  async function greet(sock, jid, ms, chat) {
    // Небольшая «человеческая» пауза и индикатор набора текста.
    await sleep(4000 + Math.random() * 5000);
    // Пока ждали, сотрудник мог уже ответить — тогда приветствие не нужно.
    if (!(await redis.hexists(WAIT_KEY, chat))) return;
    try {
      await sock.sendPresenceUpdate("composing", jid);
      await sleep(1500 + Math.random() * 1500);
      await sock.sendMessage(jid, { text: greetingFor(ms) });
      await sock.sendPresenceUpdate("paused", jid);
      logger.info({ chat }, "Автоприветствие отправлено");
    } catch (err) {
      logger.error({ err: err?.message, chat }, "Не удалось отправить автоприветствие");
    }
  }

  async function onMessage(sock, m) {
    const key = m.key || {};
    if (!key.id || !m.message) return;
    const ms = tsMs(m.messageTimestamp);
    const age = Date.now() - ms;
    if (!ms || age > 2 * 3600e3) return; // старое (досылка после переподключения) не трогаем
    const ref = await chatRef(key.remoteJid, key.remoteJidAlt);
    if (!ref) return; // группы, статусы и прочее
    if (ref.phone && cfg.ignore.has(ref.phone)) return;
    if (!(await redis.set(`reply:seen:${key.id}`, "1", "EX", 3600, "NX"))) return; // уже разобрано

    const text = (textOf(m.message) || "").trim();
    const actKey = `reply:act:${ref.chat}`;
    const hadConversation = await redis.exists(actKey);
    await redis.set(actKey, "1", "EX", Math.round(cfg.cooldownH * 3600));

    if (key.fromMe) {
      // Своё автоприветствие ответом не считается.
      if (text && (text === GREETING_ON || text === greetingFor(ms) || text.startsWith("Саламатсызбы! 🌸 Здравствуйте! Спасибо, что написали"))) return;
      const raw = await redis.hget(WAIT_KEY, ref.chat);
      if (!raw) return;
      const w = JSON.parse(raw);
      await redis.hdel(WAIT_KEY, ref.chat);
      const secs = Math.max(0, Math.round((ms - w.first) / 1000));
      const day = new Date(ms + TZ_MS).toISOString().slice(0, 10);
      await redis.lpush(`reply:times:${day}`, JSON.stringify({ chat: ref.chat, secs, work: isWorkTime(w.first) }));
      await redis.expire(`reply:times:${day}`, 40 * 24 * 3600);
      return;
    }

    // Сообщение клиента.
    if (!text) return; // реакции, служебные сообщения
    const existing = await redis.hget(WAIT_KEY, ref.chat);
    if (existing) {
      const w = JSON.parse(existing);
      w.text = clip(text);
      if (m.pushName) w.name = m.pushName;
      await redis.hset(WAIT_KEY, ref.chat, JSON.stringify(w));
    } else if (!isAck(text)) {
      await redis.hset(
        WAIT_KEY,
        ref.chat,
        JSON.stringify({
          first: ms,
          since: effectiveSince(ms),
          name: m.pushName || null,
          phone: ref.phone,
          text: clip(text),
          lvl: 0,
        })
      );
    }

    // Приветствие — только на свежее сообщение и только в начале разговора.
    if (cfg.greeting && !hadConversation && age < 3 * 60 * 1000 && !isAck(text)) {
      greet(sock, key.remoteJid, ms, ref.chat).catch(() => {});
    }
  }

  function attach(sock) {
    if (!cfg.enabled) return;
    sock.ev.on("messages.upsert", ({ messages }) => {
      const list = [...(messages ?? [])].sort((a, b) => tsMs(a.messageTimestamp) - tsMs(b.messageTimestamp));
      (async () => {
        for (const m of list) {
          try {
            await onMessage(sock, m);
          } catch (err) {
            logger.error({ err: err?.message }, "Ошибка контроля ответов");
          }
        }
      })();
    });
  }

  // --- Проверка «кто ждёт» раз в минуту ---------------------------------------

  async function tick() {
    if (!cfg.enabled) return;
    const now = Date.now();
    if (!isWorkTime(now)) return;
    const all = await redis.hgetall(WAIT_KEY);
    for (const [chat, raw] of Object.entries(all)) {
      const w = JSON.parse(raw);
      if (now - w.first > 48 * 3600e3) {
        await redis.hdel(WAIT_KEY, chat);
        continue;
      }
      const waited = (now - w.since) / 60000;
      let level = 0;
      if (waited >= cfg.escalateMin) level = 2;
      else if (waited >= cfg.alertMin) level = 1;
      if (level <= (w.lvl || 0)) continue;
      w.lvl = level;
      await redis.hset(WAIT_KEY, chat, JSON.stringify(w)); // отметка до отправки — без повторов
      const head =
        level === 2 ? `🔴 Клиент ждёт уже ${fmtWait(now - w.first)}! Ответьте сейчас — иначе потеряем.` : `⏰ Клиент ждёт ответа ${fmtWait(now - w.first)}. Ответьте скорее.`;
      await sendGroup(`${head}\n👤 ${w.name || "Без имени"} · ${fmtPhone(w.phone)}\n💬 «${w.text}»`);
      logger.info({ chat, level }, "Напоминание про ожидающего клиента отправлено");
    }
  }

  setInterval(() => {
    tick().catch((err) => logger.error({ err: err?.message }, "Проверка ожидающих клиентов не удалась"));
  }, 60 * 1000);

  // «/ждут» — кто сейчас остался без ответа.
  async function listWaiting() {
    const all = await redis.hgetall(WAIT_KEY);
    const rows = Object.values(all)
      .map((r) => JSON.parse(r))
      .sort((a, b) => a.first - b.first);
    if (!rows.length) return "✅ Все клиенты получили ответ.";
    const now = Date.now();
    const lines = rows.slice(0, 15).map((w, i) => `${i + 1}. ${w.name || "Без имени"} · ${fmtPhone(w.phone)} — ждёт ${fmtWait(now - w.first)}\n   «${w.text}»`);
    return `⏳ Ждут ответа: ${rows.length}\n\n${lines.join("\n")}${rows.length > 15 ? `\n…и ещё ${rows.length - 15}` : ""}`;
  }

  return { attach, listWaiting, config: cfg };
}
