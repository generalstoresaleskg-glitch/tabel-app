"use client";

import { useState } from "react";

// Кнопка "скопировать ссылку" для owner/manager на странице /training —
// показывает и копирует публичную ссылку /uchenik, которую можно отправить
// человеку со стороны (без логина, только имя).
export function CopyGuestLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Скопируйте ссылку:", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={handleCopy} className="btn-secondary btn-sm shrink-0">
      {copied ? "Ссылка скопирована ✓" : "Скопировать ссылку для обучения"}
    </button>
  );
}
