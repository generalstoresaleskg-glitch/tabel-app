import type { Metadata, Viewport } from "next";
import "./globals.css";
import { auth, signOut } from "@/auth";
import { NavLink } from "@/components/nav-link";
import { BottomNav } from "@/components/bottom-nav";
import { ProfileMenu } from "@/components/profile-menu";
import { mondayOf, addDays, todayISO } from "@/lib/dates";
import {
  getScheduleByWeek,
  getMissingShiftSlots,
  getWeeksAwaitingOwnerApproval,
} from "@/lib/schedule-queries";

export const metadata: Metadata = {
  title: "Табель — график и учёт рабочего времени",
  description: "Внутренняя система учёта графика и табеля сотрудников",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Табель",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  viewportFit: "cover",
};

// "Требуется действие" — красная точка на аватаре: у владельца есть черновик,
// ждущий его утверждения, либо (у владельца и управляющей) в графике текущей
// или следующей недели не хватает обязательного сотрудника на какой-то точке.
async function computeNeedsAttention(userId: string, role: string): Promise<boolean> {
  if (role !== "owner" && role !== "manager") return false;

  if (role === "owner") {
    const awaiting = await getWeeksAwaitingOwnerApproval();
    if (awaiting.length > 0) return true;
  }

  const currentWeekStart = mondayOf(todayISO());
  const nextWeekStart = addDays(currentWeekStart, 7);
  for (const weekStart of [currentWeekStart, nextWeekStart]) {
    const schedule = await getScheduleByWeek(weekStart);
    if (!schedule || schedule.status !== "draft") continue;
    const missing = await getMissingShiftSlots(schedule.id, weekStart);
    if (missing.size > 0) return true;
  }
  return false;
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;
  const canManage = !!user && (user.role === "owner" || user.role === "manager");
  const needsAttention = user ? await computeNeedsAttention(user.id, user.role) : false;

  return (
    <html lang="ru" className="h-full">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-slate-900">
        {user && (
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="max-w-5xl mx-auto px-4 sm:px-6">
              <div className="flex items-center gap-3 py-3">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                    Т
                  </span>
                  <span className="hidden sm:inline">Табель</span>
                </div>

                <div className="ml-auto flex items-center gap-3">
                  <ProfileMenu
                    userId={user.id}
                    name={user.name ?? ""}
                    role={user.role}
                    canManage={canManage}
                    isOwner={user.role === "owner"}
                    needsAttention={needsAttention}
                  />
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: "/login" });
                    }}
                  >
                    <button className="btn-ghost btn-sm">Выйти</button>
                  </form>
                </div>
              </div>

              {/* На десктопе — обычное меню сверху. На телефоне вместо него — */}
              {/* нижняя таб-панель (см. ниже), чтобы было похоже на приложение. */}
              <nav className="hidden sm:flex flex-wrap items-center gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
                <NavLink href="/schedule">График</NavLink>
                <NavLink href="/tabel">Табель</NavLink>
                {(user.role === "owner" || user.role === "manager") && (
                  <NavLink href="/employees">Сотрудники</NavLink>
                )}
                {user.role === "owner" && (
                  <NavLink href="/points">Точки</NavLink>
                )}
              </nav>
            </div>
          </header>
        )}
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 pb-24 sm:pb-6">
          {children}
        </main>
        {user && (
          <BottomNav
            canManage={user.role === "owner" || user.role === "manager"}
            isOwner={user.role === "owner"}
          />
        )}
      </body>
    </html>
  );
}
