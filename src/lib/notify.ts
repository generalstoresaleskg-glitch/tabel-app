// Канал уведомлений в общий чат WhatsApp — реализован через отдельный бот на
// базе Baileys (см. папку whatsapp-bot/ в корне репозитория), который
// подключается к WhatsApp как обычный телефон владельца и от его имени пишет
// сообщения в групповой чат. Сама эта функция просто дёргает HTTP-эндпоинт
// бота (WHATSAPP_BOT_URL берётся из переменных окружения Vercel — см. README
// в whatsapp-bot/). Если бот ещё не развёрнут (переменные не заданы, обычно
// это локальная разработка), просто пишем в консоль сервера и не роняем
// вызывающий код — уведомления не критичны для работы самого приложения.
export async function notifyWhatsApp(message: string) {
  const botUrl = process.env.WHATSAPP_BOT_URL;
  const token = process.env.WHATSAPP_BOT_TOKEN;

  if (!botUrl || !token) {
    console.log("[Уведомление в общий чат — бот не настроен]", message);
    return;
  }

  try {
    const res = await fetch(`${botUrl.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
      // Не ждём уведомление вечно — если бот "заснул" (бесплатный тариф) и
      // просыпается дольше обычного, не блокируем действие сотрудника из-за
      // этого.
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error("[Уведомление в WhatsApp] бот ответил ошибкой:", res.status, await res.text());
    }
  } catch (err) {
    // Сеть недоступна / бот не отвечает — отметка прихода/ухода уже сохранена
    // в базе, уведомление просто не дошло, это не должно ломать основной поток.
    console.error("[Уведомление в WhatsApp] не удалось отправить:", err);
  }
}
