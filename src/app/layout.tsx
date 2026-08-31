import type { Metadata } from "next";
import "./globals.css";
import { auth, signOut } from "@/auth";
import Link from "next/link";

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
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {user && (
          <header className="border-b bg-white">
            <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="font-semibold text-neutral-800">Табель</span>
              <nav className="flex flex-wrap gap-4 text-sm text-neutral-600">
                <Link href="/schedule" className="hover:text-neutral-900">
                  График
                </Link>
                <Link href="/tabel" className="hover:text-neutral-900">
                  Табель
                </Link>
                {(user.role === "owner" || user.role === "manager") && (
                  <Link href="/employees" className="hover:text-neutral-900">
                    Сотрудники
                  </Link>
                )}
                {user.role === "owner" && (
                  <Link href="/points" className="hover:text-neutral-900">
                    Точки
                  </Link>
                )}
              </nav>
              <div className="ml-auto flex items-center gap-3 text-sm">
                <span className="text-neutral-500">
                  {user.name} · {ROLE_LABEL[user.role] ?? user.role}
                </span>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <button className="text-neutral-500 hover:text-neutral-900 underline underline-offset-2">
                    Выйти
                  </button>
                </form>
              </div>
            </div>
          </header>
        )}
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
