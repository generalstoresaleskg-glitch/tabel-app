import type { Metadata } from "next";
import "./globals.css";
import { auth, signOut } from "@/auth";
import { NavLink } from "@/components/nav-link";

export const metadata: Metadata = {
  title: "Табель — график и учёт рабочего времени",
  description: "Внутренняя система учёта графика и табеля сотрудников",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  manager: "Управляющая",
  employee: "Сотрудник",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;

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
                  <span className="hidden sm:block text-sm text-slate-500 text-right leading-tight">
                    <span className="block font-medium text-slate-700">
                      {user.name}
                    </span>
                    <span>{ROLE_LABEL[user.role] ?? user.role}</span>
                  </span>
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

              <nav className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
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
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
