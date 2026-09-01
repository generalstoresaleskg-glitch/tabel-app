"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { initials } from "@/lib/user-color";
import { roleLabel } from "@/lib/role-label";

export function ProfileMenu({
  name,
  role,
  color,
  canManage,
  isOwner,
  needsAttention,
}: {
  userId: string;
  name: string;
  role: string;
  color: string;
  canManage: boolean;
  isOwner: boolean;
  needsAttention: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  const avatar = (
    <span className="relative shrink-0">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold tracking-tight text-white ${color}`}
      >
        {initials(name)}
      </span>
      {needsAttention && (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
      )}
    </span>
  );

  const label = (
    <span className="hidden text-left leading-tight sm:block">
      <span className="block text-sm font-medium text-slate-800">{name}</span>
      <span className="block text-xs text-slate-500">{roleLabel(role)}</span>
    </span>
  );

  if (!canManage) {
    return (
      <div className="flex items-center gap-2.5">
        {avatar}
        {label}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full py-1 pl-0.5 pr-2 hover:bg-slate-100"
      >
        {avatar}
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
            <p className="text-sm font-medium text-slate-800">{name}</p>
            <p className="text-xs text-slate-500">{roleLabel(role)}</p>
          </div>
          <Link href="/tabel" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Табель
          </Link>
          <Link href="/employees" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Сотрудники
          </Link>
          {isOwner && (
            <Link href="/points" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Точки
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
