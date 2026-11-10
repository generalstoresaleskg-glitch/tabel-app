// Отрисовка подарочного сертификата AYAY KYZ в PNG 1080×1920 (формат сторис).
// SVG собирается вручную и растеризуется через resvg — без браузера, быстро,
// работает на Vercel. Шрифт Lora (с кыргызскими ң ү ө) лежит в src/assets/certificate.
import fs from "fs";
import path from "path";
import { parse as parseFont, type Font } from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { formatAmount } from "@/lib/certificate-parse";

export type CertificateData = {
  recipient: string;
  sender: string;
  amount: number;
  message: string;
  code: string;
};

const W = 1080;
const H = 1920;
const DIR = path.join(process.cwd(), "src", "assets", "certificate");

type Assets = {
  fontFiles: string[];
  regular: Font;
  semibold: Font;
  bold: Font;
  italic: Font;
  logoDataUri: string;
};
let cache: Assets | null = null;

function loadFont(name: string): Font {
  const b = fs.readFileSync(path.join(DIR, name));
  return parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

function assets(): Assets {
  if (cache) return cache;
  cache = {
    fontFiles: ["Lora-Regular.ttf", "Lora-SemiBold.ttf", "Lora-Bold.ttf", "Lora-Italic.ttf"].map((f) => path.join(DIR, f)),
    regular: loadFont("Lora-Regular.ttf"),
    semibold: loadFont("Lora-SemiBold.ttf"),
    bold: loadFont("Lora-Bold.ttf"),
    italic: loadFont("Lora-Italic.ttf"),
    logoDataUri: "data:image/png;base64," + fs.readFileSync(path.join(DIR, "logo-circle.png")).toString("base64"),
  };
  return cache;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Ширина строки по advance-ширинам глифов. getAdvanceWidth из opentype.js не
// используем: он падает на таблице подстановок (GSUB) шрифта Lora.
function width(font: Font, text: string, size: number, spacing = 0): number {
  const chars = [...text];
  let units = 0;
  for (const ch of chars) units += font.charToGlyph(ch).advanceWidth ?? 0;
  return (units * size) / font.unitsPerEm + spacing * Math.max(0, chars.length - 1);
}

// Подбирает размер шрифта так, чтобы строка влезла в maxW; если и на минимальном
// не влезает — обрезает многоточием.
function fitLine(font: Font, text: string, size: number, minSize: number, maxW: number) {
  let s = size;
  while (s > minSize && width(font, text, s) > maxW) s -= 1;
  let t = text;
  if (width(font, t, s) > maxW) {
    while (t.length > 1 && width(font, t + "…", s) > maxW) t = t.slice(0, -1);
    t = t.trimEnd() + "…";
  }
  return { text: t, size: s };
}

function wrap(font: Font, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(font, next, size) > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function star(cx: number, cy: number, r: number, opacity = 0.85): string {
  const k = r * 0.16;
  return `<path d="M${cx} ${cy - r} Q${cx + k} ${cy - k} ${cx + r} ${cy} Q${cx + k} ${cy + k} ${cx} ${cy + r} Q${cx - k} ${cy + k} ${cx - r} ${cy} Q${cx - k} ${cy - k} ${cx} ${cy - r}Z" fill="#d4b06a" opacity="${opacity}"/>`;
}

function centered(
  y: number,
  text: string,
  o: { size: number; fill: string; weight?: number; italic?: boolean; spacing?: number; extra?: string }
): string {
  const x = W / 2;
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="Lora" font-size="${o.size}" font-weight="${o.weight ?? 400}" font-style="${o.italic ? "italic" : "normal"}" letter-spacing="${o.spacing ?? 0}" fill="${o.fill}" ${o.extra ?? ""}>${esc(text)}</text>`;
}

export function buildCertificateSvg(d: CertificateData): string {
  const a = assets();
  const parts: string[] = [];

  // --- сумма: подгоняем под ширину (5 000 … 1 000 000) ---
  const amountText = formatAmount(d.amount);
  let amountSize = 240;
  while (amountSize > 120 && width(a.bold, amountText, amountSize) > 780) amountSize -= 4;

  // --- имена ---
  const to = fitLine(a.regular, d.recipient, 50, 28, 780);
  const from = fitLine(a.regular, d.sender, 50, 28, 780);

  // --- пожелание: 42px в 1–3 строки, при большом тексте уменьшаем ---
  const quoteText = `«${d.message.trim()}»`;
  const QUOTE_TOP = 1526; // базовая линия первой строки
  const QUOTE_BOTTOM = 1660;
  let qSize = 44;
  let qLines: string[] = [];
  for (const size of [44, 38, 34, 30, 27, 24]) {
    qSize = size;
    qLines = wrap(a.italic, quoteText, size, 720);
    const lh = Math.round(size * 1.42);
    if (QUOTE_TOP + (qLines.length - 1) * lh <= QUOTE_BOTTOM) break;
  }
  const lh = Math.round(qSize * 1.42);
  // Короткое пожелание в 1 строку центрируем по вертикали между «КИМДЕН» и низом карточки.
  const qFirst = qLines.length === 1 ? QUOTE_TOP + lh / 2 : QUOTE_TOP;

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d6dfc3"/><stop offset="0.45" stop-color="#f5f2e5"/><stop offset="1" stop-color="#ecd7d4"/>
    </linearGradient>
    <linearGradient id="amt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bc8626"/><stop offset="1" stop-color="#85501a"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#8a5415" flood-opacity="0.32"/></filter>
    <filter id="card" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#6b5a4e" flood-opacity="0.14"/></filter>
    <filter id="logo" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#6b5a4e" flood-opacity="0.18"/></filter>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  parts.push(`<rect x="40" y="40" width="1000" height="1840" rx="56" fill="none" stroke="#c9a45c" stroke-width="3"/>`);
  parts.push(`<rect x="56" y="56" width="968" height="1808" rx="42" fill="none" stroke="#d9c28f" stroke-width="1.5"/>`);

  // логотип
  parts.push(`<circle cx="540" cy="331" r="228" fill="#e9ecdb" stroke="#d9c28f" stroke-width="2" filter="url(#logo)"/>`);
  parts.push(`<image href="${a.logoDataUri}" x="${540 - 214}" y="${331 - 214}" width="428" height="428"/>`);

  // разделитель
  parts.push(`<line x1="370" y1="592" x2="710" y2="592" stroke="#c9a45c" stroke-width="1.5"/>`);
  parts.push(star(540, 592, 7, 1));

  parts.push(centered(672, "БЕЛЕК СЕРТИФИКАТЫ", { size: 46, fill: "#8c9c6e", spacing: 8 }));
  parts.push(centered(945, amountText, { size: amountSize, fill: "url(#amt)", weight: 700, extra: 'filter="url(#sh)"' }));
  parts.push(centered(1052, "СОМ", { size: 64, fill: "#9a6218", weight: 700, spacing: 20 }));

  // карточка
  parts.push(`<rect x="112" y="1092" width="856" height="606" rx="50" fill="#fcfaf3" stroke="#e8d6d3" stroke-width="2" filter="url(#card)"/>`);
  parts.push(centered(1172, "КИМГЕ", { size: 32, fill: "#8c9c6e", spacing: 1 }));
  parts.push(centered(1255, to.text, { size: to.size, fill: "#2b2b2b" }));
  parts.push(`<line x1="480" y1="1316" x2="600" y2="1316" stroke="#d9c28f" stroke-width="1.5"/>`);
  parts.push(centered(1372, "КИМДЕН", { size: 32, fill: "#8c9c6e", spacing: 1 }));
  parts.push(centered(1432, from.text, { size: from.size, fill: "#2b2b2b" }));

  qLines.forEach((line, i) => {
    parts.push(centered(Math.round(qFirst + i * lh), line, { size: qSize, fill: "#6b5a4e", italic: true }));
  });
  const lastW = width(a.italic, qLines[qLines.length - 1] ?? "", qSize);
  const lastY = Math.round(qFirst + (qLines.length - 1) * lh);
  parts.push(star(Math.min(540 + lastW / 2 + 34, 925), lastY - 18, 20));
  if (qLines.length <= 2) parts.push(star(Math.min(540 + lastW / 2 + 58, 949), lastY - 44, 10));

  // низ
  parts.push(centered(1788, "@ayay.kyz", { size: 38, fill: "#8c9c6e" }));
  parts.push(centered(1836, `№ ${d.code}`, { size: 26, fill: "#a7b08d", spacing: 3 }));

  // искры
  for (const [x, y, r, o] of [
    [885, 737, 18, 0.9], [677, 707, 10, 0.7], [365, 1062, 8, 0.8], [196, 1078, 14, 0.9],
    [230, 1770, 10, 0.7], [985, 1768, 12, 0.7], [548, 683, 5, 0.5],
  ] as const) parts.push(star(x, y, r, o));

  parts.push(`</svg>`);
  return parts.join("\n");
}

export function renderCertificatePng(d: CertificateData): Buffer {
  const a = assets();
  const resvg = new Resvg(buildCertificateSvg(d), {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: a.fontFiles, loadSystemFonts: false, defaultFontFamily: "Lora" },
  });
  return resvg.render().asPng();
}
