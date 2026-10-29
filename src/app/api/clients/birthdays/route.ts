// Бот каждые 5 минут (начиная с утра) спрашивает, у кого из клиентов сегодня
// день рождения. В ?exclude= он передаёт тех, о ком уже написал сегодня, —
// в ответ приходят только новые именинники (например, клиент, добавленный
// днём) и готовый текст для общего чата. Нет новых — message = null.
import { birthdayMessage, birthdaysOn, isBotRequest } from "@/lib/clients";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const exclude = new Set(
    (new URL(request.url).searchParams.get("exclude") ?? "").split(",").filter(Boolean)
  );
  const list = (await birthdaysOn()).filter((c) => !exclude.has(c.id));
  return Response.json({ count: list.length, ids: list.map((c) => c.id), message: birthdayMessage(list) });
}
