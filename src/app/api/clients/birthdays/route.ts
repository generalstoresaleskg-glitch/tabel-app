// Бот раз в день утром спрашивает, у кого из клиентов сегодня день рождения,
// и публикует готовый текст в общий чат (если именинников нет — молчит).
import { birthdayMessage, birthdaysOn, isBotRequest } from "@/lib/clients";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const list = await birthdaysOn();
  return Response.json({ count: list.length, message: birthdayMessage(list) });
}
