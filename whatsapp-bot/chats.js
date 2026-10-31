// Переписки магазина: сбор, докачка истории до самого начала и анализ ИИ.
//
// 1. Сбор. Каждое сообщение личных чатов номера магазина (история, которую
//    WhatsApp присылает при привязке, и новые сообщения) уходит в приложение
//    (/api/chats/ingest) и хранится в базе. Групповые чаты не сохраняются.
// 2. Докачка. WhatsApp при привязке отдаёт не всю историю. Бот по каждому
//    чату просит у телефона сообщения старше самого старого из уже
//    сохранённых — страницами, пока телефон не ответит, что старше ничего нет.
//    Телефон магазина в это время должен быть включён и онлайн.
// 3. Анализ. Каждая переписка уходит в DeepSeek (номера телефонов в тексте
//    скрываются), результат — в приложение: настоящие клиенты попадают в
//    «Клиенты» с сегментом, а в конце строится общий отчёт по продажам.
//
// Порядок после перепривязки (/relink) запускается сам: история → докачка →
// анализ. Вручную — командами в общем чате: «/история», «/анализ», «/статус».

const DEEPSEEK_URL = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";
// deepseek-chat объявлен устаревшим; если основная модель недоступна —
// пробуем следующие по списку.
const MODELS = [process.env.DEEPSEEK_MODEL, "deepseek-flash", "deepseek-chat"].filter(Boolean);

const BACKFILL_PAGE = 50; // сообщений за один запрос к телефону
const BACKFILL_WAIT_MS = 45_000; // сколько ждать ответа телефона
const QUIET_MS = 5 * 60 * 1000; // история «докачалась», если 5 минут не было новых порций
const ANALYZE_CONCURRENCY = 4;

export function setupChats({ getSock, callApp, sendGroup, logger, redis }) {
  // --- Адреса чатов -------------------------------------------------------

  const lidToPn = new Map(); // «123456789» (lid) → «996555123456»

  function rememberMapping(lid, pn) {
    if (!lid || !pn) return;
    const l = String(lid).split("@")[0].split(":")[0];
    const p = String(pn).split("@")[0].split(":")[0];
    if (l && /^\d{8,15}$/.test(p)) lidToPn.set(l, p);
  }

  function isPrivate(jid) {
    return !!jid && (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")) && jid !== "status@broadcast";
  }

  // Ключ переписки в базе: «+996…» по номеру, если номер известен, иначе «lid:…».
  async function chatRef(jid, alt) {
    if (!isPrivate(jid)) return null;
    const pnJid = [jid, alt].find((j) => j && j.endsWith("@s.whatsapp.net"));
    const lidJid = [jid, alt].find((j) => j && j.endsWith("@lid"));
    let pn = pnJid ? pnJid.split("@")[0].split(":")[0] : null;
    const lid = lidJid ? lidJid.split("@")[0].split(":")[0] : null;
    if (!pn && lid) {
      pn = lidToPn.get(lid) ?? null;
      if (!pn) {
        try {
          const found = await getSock()?.signalRepository?.lidMapping?.getPNForLID(lidJid);
          if (found) {
            pn = found.split("@")[0].split(":")[0];
            lidToPn.set(lid, pn);
          }
        } catch {
          // номер пока неизвестен
        }
      }
    }
    if (pn && lid) lidToPn.set(lid, pn);
    // Адрес чата без номера устройства («…:12@…») — по нему бот потом
    // запрашивает у телефона старые сообщения этого чата.
    const [user, server] = jid.split("@");
    const bareJid = `${user.split(":")[0]}@${server}`;
    return pn ? { chat: "+" + pn, phone: pn, jid: bareJid } : { chat: "lid:" + lid, phone: null, jid: bareJid };
  }

  // --- Текст сообщения ----------------------------------------------------

  function unwrap(m) {
    let cur = m;
    for (let i = 0; i < 5 && cur; i++) {
      const inner =
        cur.ephemeralMessage?.message ||
        cur.viewOnceMessage?.message ||
        cur.viewOnceMessageV2?.message ||
        cur.viewOnceMessageV2Extension?.message ||
        cur.documentWithCaptionMessage?.message ||
        cur.editedMessage?.message;
      if (!inner) break;
      cur = inner;
    }
    return cur;
  }

  function textOf(message) {
    const m = unwrap(message);
    if (!m) return "";
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    const cap = (x) => (x?.caption ? ` ${x.caption}` : "");
    if (m.imageMessage) return `[фото]${cap(m.imageMessage)}`;
    if (m.videoMessage) return `[видео]${cap(m.videoMessage)}`;
    if (m.audioMessage) return m.audioMessage.ptt ? "[голосовое сообщение]" : "[аудио]";
    if (m.documentMessage) return `[документ ${m.documentMessage.fileName || ""}]${cap(m.documentMessage)}`.trim();
    if (m.stickerMessage) return "[стикер]";
    if (m.locationMessage || m.liveLocationMessage) return "[геолокация]";
    if (m.contactMessage || m.contactsArrayMessage) return "[контакт]";
    if (m.reactionMessage?.text) return `[реакция ${m.reactionMessage.text}]`;
    if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
    if (m.listResponseMessage?.title) return m.listResponseMessage.title;
    if (m.orderMessage) return "[заказ из каталога]";
    if (m.productMessage) return "[товар из каталога]";
    return "";
  }

  function tsOf(x) {
    if (x == null) return 0;
    if (typeof x === "number") return x;
    if (typeof x.toNumber === "function") return x.toNumber();
    return Number(x) || 0;
  }

  // --- Отправка в приложение пачками --------------------------------------

  let buffer = { messages: [], contacts: [] };
  let flushing = Promise.resolve();
  let flushTimer = null;
  const stats = { received: 0, sent: 0, historyChunks: 0, lastChunkAt: 0 };

  function scheduleFlush(now = false) {
    if (now || buffer.messages.length >= 400 || buffer.contacts.length >= 1000) {
      clearTimeout(flushTimer);
      flushTimer = null;
      return flush();
    }
    if (!flushTimer) flushTimer = setTimeout(() => flush(), 3000);
    return flushing;
  }

  function flush() {
    flushing = flushing.then(async () => {
      while (buffer.messages.length || buffer.contacts.length) {
        const batch = { messages: buffer.messages.splice(0, 400), contacts: buffer.contacts.splice(0, 1000) };
        for (let attempt = 1; ; attempt++) {
          try {
            await callApp("/api/chats/ingest", { method: "POST", body: JSON.stringify(batch) });
            stats.sent += batch.messages.length;
            break;
          } catch (err) {
            logger.warn({ err: err?.message, attempt }, "Не удалось сохранить переписки — повторю");
            await new Promise((r) => setTimeout(r, Math.min(60_000, 5000 * attempt)));
          }
        }
      }
    });
    return flushing;
  }

  // Возвращает число сохранённых сообщений по каждому чату (нужно докачке).
  async function collect(messages, { contacts = [] } = {}) {
    const perChat = new Map();
    for (const c of contacts) {
      rememberMapping(c.lid, c.phoneNumber);
      if (c.id?.endsWith("@lid") && c.phoneNumber) rememberMapping(c.id, c.phoneNumber);
    }
    for (const c of contacts) {
      const ref = await chatRef(c.id, c.phoneNumber || c.lid);
      if (!ref) continue;
      if (c.name) buffer.contacts.push({ ...ref, name: c.name });
      else if (c.notify || c.verifiedName) buffer.contacts.push({ ...ref, name: c.notify || c.verifiedName, weak: true });
    }
    for (const m of messages) {
      const key = m.key || {};
      const ref = await chatRef(key.remoteJid, key.remoteJidAlt);
      if (!ref || !key.id) continue;
      const ts = tsOf(m.messageTimestamp);
      const info = perChat.get(ref.chat) ?? { count: 0, oldest: null };
      if (!info.oldest || ts < info.oldest.ts) info.oldest = { msgId: key.id, fromMe: !!key.fromMe, ts };
      info.count++;
      perChat.set(ref.chat, info);
      const text = textOf(m.message);
      if (!text.trim()) continue;
      stats.received++;
      buffer.messages.push({ ...ref, msgId: key.id, fromMe: !!key.fromMe, ts, text });
      if (!key.fromMe && m.pushName) buffer.contacts.push({ ...ref, name: m.pushName, weak: true });
    }
    await scheduleFlush();
    return perChat;
  }

  // --- События WhatsApp ---------------------------------------------------

  const waiters = new Map(); // chat → { resolve }

  function attach(sock) {
    sock.ev.on("messaging-history.set", async (h) => {
      try {
        for (const m of h.lidPnMappings ?? []) rememberMapping(m.lid, m.pn);
        stats.historyChunks++;
        stats.lastChunkAt = Date.now();
        const perChat = await collect(h.messages ?? [], { contacts: h.contacts ?? [] });
        logger.info(
          { syncType: h.syncType, messages: h.messages?.length ?? 0, chats: perChat.size, progress: h.progress },
          "Получена порция истории"
        );
        for (const [chat, info] of perChat) {
          const w = waiters.get(chat);
          if (w) w.resolve(info);
        }
        // Пустой ответ на запрос докачки: телефон говорит, что старше ничего нет.
        if (h.peerDataRequestSessionId && perChat.size === 0) {
          for (const [, w] of waiters) if (w.requestId === h.peerDataRequestSessionId) w.resolve({ count: 0, oldest: null });
        }
      } catch (err) {
        logger.error({ err: err?.message }, "Ошибка при разборе истории");
      }
    });

    sock.ev.on("messaging-history.status", (s) => {
      logger.info(s, "Статус синхронизации истории");
    });

    sock.ev.on("messages.upsert", ({ messages }) => {
      collect(messages ?? []).catch((err) => logger.error({ err: err?.message }, "Не удалось сохранить сообщение"));
    });

    sock.ev.on("contacts.upsert", (contacts) => {
      collect([], { contacts }).catch(() => {});
    });
    sock.ev.on("contacts.update", (contacts) => {
      collect([], { contacts }).catch(() => {});
    });
    sock.ev.on("lid-mapping.update", (m) => {
      for (const x of Array.isArray(m) ? m : [m]) rememberMapping(x?.lid, x?.pn);
    });
  }

  // --- Докачка истории -----------------------------------------------------

  const job = { backfill: false, analysis: false, progress: "" };

  async function fetchOlder(chat) {
    const sock = getSock();
    let cursor = chat.oldest;
    let pages = 0;
    let timeouts = 0;
    while (true) {
      const p = new Promise((resolve) => {
        const w = { resolve, requestId: null };
        waiters.set(chat.chat, w);
        setTimeout(() => resolve(null), BACKFILL_WAIT_MS);
      });
      try {
        const requestId = await sock.fetchMessageHistory(
          BACKFILL_PAGE,
          { remoteJid: chat.jid, fromMe: cursor.fromMe, id: cursor.msgId },
          cursor.ts * 1000
        );
        const w = waiters.get(chat.chat);
        if (w) w.requestId = requestId;
      } catch (err) {
        waiters.delete(chat.chat);
        throw err;
      }
      const got = await p;
      waiters.delete(chat.chat);
      if (got === null) {
        // Телефон не ответил: офлайн или занят. Три раза подряд — переходим к
        // следующему чату, этот останется в очереди на следующий проход.
        if (++timeouts >= 3) return { pages, done: false };
        continue;
      }
      timeouts = 0;
      if (!got.count || !got.oldest || got.oldest.ts >= cursor.ts) return { pages, done: true };
      cursor = got.oldest;
      pages++;
      await new Promise((r) => setTimeout(r, 1500)); // не торопим телефон
    }
  }

  async function runBackfill() {
    if (job.backfill) return false;
    job.backfill = true;
    let processed = 0;
    let stalled = 0;
    const skip = new Set();
    try {
      while (true) {
        const q = await callApp("/api/chats/backfill?limit=20");
        const list = (q.chats ?? []).filter((c) => !skip.has(c.chat));
        if (!list.length) break;
        for (const c of list) {
          job.progress = `докачка истории: осталось ${q.remaining} переписок`;
          try {
            const r = await fetchOlder(c);
            await scheduleFlush(true);
            if (r.done) {
              await callApp("/api/chats/backfill", { method: "POST", body: JSON.stringify({ chat: c.chat }) });
              stalled = 0;
            } else {
              skip.add(c.chat);
              stalled++;
            }
          } catch (err) {
            logger.warn({ err: err?.message, chat: c.chat }, "Не удалось докачать переписку");
            skip.add(c.chat);
            stalled++;
          }
          processed++;
          if (processed % 25 === 0) logger.info({ processed, remaining: q.remaining }, "Докачка истории идёт");
        }
        // Подряд много чатов без ответа — телефон, видимо, офлайн. Пауза и
        // новый проход позже, а не сжигание очереди впустую.
        if (stalled >= 10) {
          await sendGroup("⏸ Докачка истории переписок на паузе: телефон магазина не отвечает. Проверьте, что он включён и с интернетом. Продолжу сам через 15 минут.");
          await new Promise((r) => setTimeout(r, 15 * 60 * 1000));
          stalled = 0;
          skip.clear();
        }
      }
      logger.info({ processed }, "Докачка истории завершена");
      return true;
    } finally {
      job.backfill = false;
      job.progress = "";
    }
  }

  // --- Анализ -------------------------------------------------------------

  function maskPhones(t) {
    return t.replace(/\+?\d[\d\s\-()]{7,}\d/g, "[номер]");
  }

  function fmtTime(ts) {
    const d = new Date((ts + 6 * 3600) * 1000); // Бишкек, UTC+6
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${String(d.getUTCFullYear()).slice(2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }

  function transcript(chat) {
    const lines = chat.messages.map((m) => `[${fmtTime(m.ts)}] ${m.fromMe ? "Магазин" : "Клиент"}: ${maskPhones(m.text).replace(/\s+/g, " ").trim()}`);
    let text = lines.join("\n");
    const LIMIT = 24_000;
    if (text.length > LIMIT) {
      const head = text.slice(0, 4000);
      const tail = text.slice(-(LIMIT - 4000));
      text = `${head}\n…[часть переписки пропущена]…\n${tail.slice(tail.indexOf("\n") + 1)}`;
    }
    return text;
  }

  const CHAT_PROMPT = `Ты — аналитик продаж магазинов косметики AYAY KYZ (г. Ош и Ноокат, Кыргызстан; уход за кожей и декоративная косметика, корейские и европейские бренды).
Тебе дают переписку WhatsApp между магазином («Магазин») и человеком («Клиент»). Переписка может быть на русском, кыргызском или смешанной. Номера телефонов скрыты как [номер]. [фото] от клиента часто означает фото товара или чек/скрин оплаты.

Определи, кто это и как с ним работали. Верни ТОЛЬКО JSON такого вида:
{
  "is_customer": true/false — реальный или потенциальный покупатель косметики; false для поставщиков, курьеров, сотрудников, рекламы, спама, ошибочных и личных переписок,
  "purchased": "yes" | "no" | "unclear" — была ли покупка (оплата, заказ, доставка, «забрала», чек),
  "purchase_evidence": "коротко, на чём основан вывод о покупке",
  "purchases_count": число покупок, которые видно в переписке (0, если не видно),
  "grateful": true/false — благодарила, хвалила товар или сервис, писала тёплые слова,
  "sentiment": "positive" | "neutral" | "negative",
  "segment": "loyal" | "buyer" | "warm" | "problem" | "other",
  "name": "имя/ФИО клиента, только если оно явно есть в переписке (клиент представился, назвал для доставки), иначе null",
  "birthday": "ДД.ММ или ДД.ММ.ГГГГ, только если дата рождения явно названа, иначе null",
  "interests": ["бренды, товары, категории, проблемы кожи, которые интересовали клиента"],
  "summary": "1–2 предложения: кто клиент, что покупал или хотел, чем закончилось",
  "service_issues": ["конкретные ошибки магазина: долго не отвечали (укажи примерно сколько), не ответили вовсе, не уточнили потребность, не предложили альтернативу или сопутствующий товар, не назвали цену, не дожали, грубость, путаница с заказом"],
  "lost_sale": "если покупки не было — почему, по переписке; иначе null",
  "objections": ["возражения клиента: дорого, подумаю, нет в наличии, далеко, доставка и т.п."],
  "questions": ["вопросы, которые задавал клиент"],
  "recommendations": ["что магазину сделать лучше в продажах и сервисе — на примере этой переписки"],
  "next_action": "что предложить этому клиенту сейчас (повторная покупка, новинка, напоминание, приглашение на мероприятие)"
}

Сегменты:
- loyal — покупал(а) и доволен(а): благодарил(а), хвалил(а), или покупал(а) больше одного раза;
- buyer — покупка была, но явной благодарности или повторов не видно;
- warm — интересовался(ась) товаром, спрашивал(а) цену/наличие, но покупки в переписке не видно;
- problem — была жалоба, возврат, недовольство или конфликт;
- other — не клиент (is_customer = false).
Пиши выводы по-русски, кратко и по делу. Не придумывай того, чего нет в переписке. Пустые списки — [].`;

  const REPORT_PROMPT = `Ты — консультант по рознице и продажам. Перед тобой итоги анализа клиентских переписок WhatsApp магазинов косметики AYAY KYZ (Ош, Ноокат): по одной JSON-строке на переписку (segment, purchased, sentiment, ошибки сервиса, причины потерь, возражения, вопросы, рекомендации).
Сделай общий отчёт для владельца: найди повторяющиеся закономерности, оцени масштаб (примерно сколько переписок затронуто), дай конкретные рекомендации. Верни ТОЛЬКО JSON:
{
  "summary": "3–6 предложений: главное о продажах и сервисе в переписках",
  "strengths": [{"title": "", "detail": ""}],
  "weaknesses": [{"title": "слабое место", "detail": "в чём проявляется, как часто, пример"}],
  "lost_sales": [{"reason": "причина потери продажи", "detail": "как часто и что с этим делать"}],
  "recommendations": [{"title": "", "detail": "что конкретно сделать", "priority": "высокий" | "средний" | "низкий"}],
  "objections": [{"objection": "возражение клиента", "how_to_handle": "как отвечать продавцу"}],
  "faq": [{"question": "частый вопрос клиентов", "answer": "как лучше отвечать"}],
  "scripts": [{"situation": "ситуация", "text": "готовая фраза для продавца в WhatsApp"}]
}
Пиши по-русски, конкретно, без воды. 5–10 пунктов в каждом списке, где хватает данных.`;

  async function deepseek(system, user, maxTokens) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw Object.assign(new Error("DEEPSEEK_API_KEY не задан"), { fatal: true });
    let lastErr;
    for (const model of MODELS) {
      for (let attempt = 1; attempt <= 4; attempt++) {
        let res;
        try {
          res = await fetch(DEEPSEEK_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              response_format: { type: "json_object" },
              temperature: 0.2,
              max_tokens: maxTokens,
            }),
            signal: AbortSignal.timeout(240_000),
          });
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        if (res.status === 401 || res.status === 402) {
          const body = (await res.text()).slice(0, 200);
          throw Object.assign(
            new Error(res.status === 402 ? "На балансе DeepSeek закончились деньги" : `Ключ DeepSeek не принят: ${body}`),
            { fatal: true }
          );
        }
        if (res.status === 400 || res.status === 404) {
          const body = await res.text();
          if (/model/i.test(body)) {
            lastErr = new Error(`Модель ${model} недоступна`);
            break; // следующая модель
          }
          throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`);
        }
        if (!res.ok) {
          lastErr = new Error(`DeepSeek ${res.status}`);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? "";
        const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
        try {
          return JSON.parse(json);
        } catch {
          lastErr = new Error("DeepSeek вернул не JSON");
        }
      }
    }
    throw lastErr ?? new Error("DeepSeek не ответил");
  }

  async function analyzeOne(chat, totals) {
    const header = `Всего сообщений в переписке: ${chat.total}${chat.total > chat.messages.length ? ` (ниже последние ${chat.messages.length})` : ""}.\n\n`;
    let result = null;
    try {
      result = await deepseek(CHAT_PROMPT, header + transcript(chat), 1500);
    } catch (err) {
      if (err.fatal) throw err;
      logger.warn({ err: err?.message, chat: chat.chat }, "Анализ переписки не удался");
    }
    // Номер для lid-чатов, если WhatsApp его к этому времени раскрыл.
    let phone = chat.phone;
    if (!phone && chat.chat.startsWith("lid:")) {
      const ref = await chatRef(chat.chat.slice(4) + "@lid");
      phone = ref?.phone ?? null;
    }
    const r = await callApp("/api/chats/analysis", {
      method: "POST",
      body: JSON.stringify({ chat: chat.chat, phone, ok: !!result, result }),
    });
    totals.done++;
    if (r.status === "created") totals.created++;
    if (r.status === "updated") totals.updated++;
    if (r.status === "failed") totals.failed++;
  }

  async function runAnalysis() {
    if (job.analysis) return false;
    if (!process.env.DEEPSEEK_API_KEY) {
      await sendGroup("⚠️ Анализ не запущен: на сервере бота не задан ключ DEEPSEEK_API_KEY (Render → tabel-whatsapp-bot → Environment).");
      return false;
    }
    job.analysis = true;
    const totals = { done: 0, created: 0, updated: 0, failed: 0 };
    try {
      await scheduleFlush(true);
      const first = await callApp("/api/chats/pending?limit=1");
      if (!first.remaining) {
        await sendGroup("ℹ️ Новых переписок для анализа нет — всё уже разобрано.");
        return true;
      }
      await sendGroup(`🔎 Начинаю анализ переписок магазина: ${first.remaining}. Это займёт какое-то время, по окончании напишу итог.`);
      while (true) {
        const q = await callApp(`/api/chats/pending?limit=${ANALYZE_CONCURRENCY * 2}`);
        if (!q.chats?.length) break;
        job.progress = `анализ: осталось ${q.remaining} переписок`;
        for (let i = 0; i < q.chats.length; i += ANALYZE_CONCURRENCY) {
          await Promise.all(q.chats.slice(i, i + ANALYZE_CONCURRENCY).map((c) => analyzeOne(c, totals)));
        }
        if (totals.done % 50 < ANALYZE_CONCURRENCY * 2) logger.info({ ...totals, remaining: q.remaining }, "Анализ идёт");
      }

      job.progress = "строю общий отчёт";
      const input = await callApp("/api/chats/report");
      let report = null;
      if (input.items?.length) {
        try {
          report = await deepseek(REPORT_PROMPT, input.items.join("\n"), 8000);
        } catch (err) {
          if (err.fatal) throw err;
          logger.error({ err: err?.message }, "Общий отчёт не построен");
        }
      }
      let clientsTotal = null;
      if (report) {
        const saved = await callApp("/api/chats/report", {
          method: "POST",
          body: JSON.stringify({ report: { ...report, counts: input.counts }, chatsCount: input.total }),
        });
        clientsTotal = saved.clients;
      }
      const c = input.counts ?? {};
      await sendGroup(
        [
          "✅ Анализ переписок завершён",
          `Разобрано переписок: ${totals.done - totals.failed}${totals.failed ? ` (с ошибкой: ${totals.failed}, повторю при следующем /анализ)` : ""}`,
          `В базу клиентов: новых ${totals.created}, обновлено ${totals.updated}`,
          `Постоянные: ${c.loyal ?? 0} · Купили: ${c.buyer ?? 0} · Интересовались: ${c.warm ?? 0} · С жалобой: ${c.problem ?? 0}`,
          clientsTotal != null ? `Всего клиентов в базе: ${clientsTotal}` : null,
          report ? "Подробный разбор продаж и сервиса — в табеле: Клиенты → Анализ продаж." : "Общий отчёт построить не удалось, клиенты сохранены.",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return true;
    } catch (err) {
      logger.error({ err: err?.message }, "Анализ остановлен");
      await sendGroup(`⚠️ Анализ остановлен: ${err?.message}. Уже разобранное сохранено; после исправления напишите /анализ — продолжу с места остановки.`);
      return false;
    } finally {
      job.analysis = false;
      job.progress = "";
    }
  }

  // --- Полный цикл после перепривязки --------------------------------------

  const AUTO_KEY = "chats:auto-pipeline";

  async function runPipeline() {
    await sendGroup("📥 История переписок получена. Докачиваю старые сообщения до самого начала — это может занять несколько часов, телефон магазина должен быть включён и с интернетом.");
    await runBackfill();
    const s = await callApp("/api/chats/stats").catch(() => null);
    if (s) {
      const since = s.oldest_ts ? fmtTime(s.oldest_ts).slice(0, 8) : "—";
      await sendGroup(`📚 История собрана: ${s.chats} переписок, ${s.messages} сообщений, самое раннее — ${since}.`);
    }
    await runAnalysis();
  }

  // Раз в минуту: если после перепривязки история перестала приходить —
  // запускаем докачку и анализ.
  const startedAt = Date.now();
  setInterval(async () => {
    try {
      if (job.backfill || job.analysis) return;
      if (!(await redis.get(AUTO_KEY))) return;
      // После перезапуска бота отсчёт тишины — от момента запуска.
      if (Date.now() - (stats.lastChunkAt || startedAt) < QUIET_MS) return;
      if (!getSock()?.user) return;
      await redis.del(AUTO_KEY);
      await runPipeline();
    } catch (err) {
      logger.error({ err: err?.message }, "Автозапуск сбора истории не удался");
    }
  }, 60_000);

  async function status() {
    const s = await callApp("/api/chats/stats").catch(() => null);
    const lines = ["📊 Переписки магазина"];
    if (s) {
      lines.push(`Сохранено: ${s.chats} переписок, ${s.messages} сообщений`);
      if (s.oldest_ts) lines.push(`Самое раннее сообщение: ${fmtTime(s.oldest_ts).slice(0, 8)}`);
      lines.push(`Ещё не докачано до начала: ${s.backfill_left}`);
      lines.push(`Клиентов в базе: ${s.clients}`);
    }
    lines.push(job.progress ? `Сейчас: ${job.progress}` : "Сейчас: ничего не выполняется");
    return lines.join("\n");
  }

  // Команды в общем чате.
  async function handleCommand(text) {
    const t = text.trim().toLowerCase();
    if (/^[\/\\]\s*анализ(?![а-яё])/.test(t)) {
      if (job.analysis || job.backfill) return `⏳ Уже идёт: ${job.progress || "работа с перепиской"}.`;
      runAnalysis().catch(() => {});
      return null;
    }
    if (/^[\/\\]\s*история(?![а-яё])/.test(t)) {
      if (job.backfill || job.analysis) return `⏳ Уже идёт: ${job.progress || "работа с перепиской"}.`;
      runBackfill()
        .then(async () => sendGroup(await status()))
        .catch((err) => logger.error({ err: err?.message }, "Докачка не удалась"));
      return "📥 Докачиваю старые сообщения переписок до самого начала. Телефон магазина должен быть онлайн. Когда закончу — напишу.";
    }
    if (/^[\/\\]\s*статус(?![а-яё])/.test(t)) return status();
    return undefined; // не наша команда
  }

  return {
    attach,
    handleCommand,
    status,
    runAnalysis,
    runBackfill,
    armAutoPipeline: () => redis.set(AUTO_KEY, "1", "EX", 7 * 24 * 3600),
    stats,
    job,
  };
}
