import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { guestLearners } from "@/db/schema";

// Гость — человек, зашедший по публичной ссылке /uchenik и представившийся
// именем, без пароля и логина. Личность хранится в куке (год) на устройстве,
// чтобы не спрашивать имя заново при каждом визите.
export const GUEST_COOKIE = "tabel_guest_id";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 год

export async function getCurrentGuest() {
  const store = await cookies();
  const id = store.get(GUEST_COOKIE)?.value;
  if (!id) return null;

  const rows = await db.select().from(guestLearners).where(eq(guestLearners.id, id));
  return rows[0] ?? null;
}

// Для внутренних страниц /uchenik/... — если гость ещё не представился
// именем на /uchenik, отправляем его туда.
export async function requireGuest() {
  const guest = await getCurrentGuest();
  if (!guest) redirect("/uchenik");
  return guest;
}

export async function setGuestCookie(id: string) {
  const store = await cookies();
  store.set(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
}
