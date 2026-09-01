"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; icon: React.ReactNode };

// Иконки — простые инлайн-SVG (без иконочной библиотеки), чтобы не тянуть
// лишнюю зависимость ради 4 картинок.
const ICONS = {
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
      <circle cx="9" cy="8" r="3" />
      <path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5" strokeLinecap="round" />
      <path d="M16 8.2a3 3 0 1 1 3.2 3M21.5 20c-.3-2.4-1.4-4.1-3.2-5" strokeLinecap="round" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
};

export function BottomNav({ canManage, isOwner }: { canManage: boolean; isOwner: boolean }) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: "/schedule", label: "График", icon: ICONS.calendar },
    { href: "/tabel", label: "Табель", icon: ICONS.clock },
  ];
  if (canManage) tabs.push({ href: "/employees", label: "Люди", icon: ICONS.users });
  if (isOwner) tabs.push({ href: "/points", label: "Точки", icon: ICONS.pin });

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors " +
              (active ? "text-indigo-600" : "text-slate-400")
            }
          >
            {t.icon}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
