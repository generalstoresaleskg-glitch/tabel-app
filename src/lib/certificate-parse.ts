// Разбор сообщения «/сертификат …» из общего чата WhatsApp.
// Чистые функции без базы.
//
//   /сертификат
//   кому: Русланова Мээрим Руслановна
//   от: Русланова Ибадат Руслановна
//   сумма: 5000
//   текст: Аруулук ажарыңдан эч качан кетпесин жарыгым
//
// Строки можно писать через «;» в одну строку, порядок не важен.
// Если «текст:» не указан — подставляется стандартный.

export const DEFAULT_CERTIFICATE_TEXT = "Аруулук ажарыңдан эч качан кетпесин жарыгым";

export const MAX_CERTIFICATE_AMOUNT = 1_000_000;

export const CERTIFICATE_FORMAT_HINT = `Как создать сертификат — скопируйте, подставьте данные и отправьте:

/сертификат
кому: Фамилия Имя Отчество
от: Фамилия Имя Отчество
сумма: 5000
текст: ${DEFAULT_CERTIFICATE_TEXT}

Строку «текст» можно не писать — будет стандартный текст. Чтобы написать свой, замените текст после «текст:».`;

export type ParsedCertificate = {
  recipient: string;
  sender: string;
  amount: number;
  message: string;
  customMessage: boolean;
};

export type CertificateParseResult =
  | { ok: true; certificate: ParsedCertificate }
  | { ok: false; errors: string[] };

const COMMAND_RE = /^\s*[\/\\]\s*сертификат(?![а-яё])\s*[:\-–—]?\s*/i;

export function isCertificateCommand(text: string): boolean {
  return COMMAND_RE.test(text);
}

type Field = "recipient" | "sender" | "amount" | "message";

const LABELS: Record<string, Field> = {
  кому: "recipient",
  кимге: "recipient",
  "от кого": "sender",
  от: "sender",
  кимден: "sender",
  сумма: "amount",
  сом: "amount",
  текст: "message",
  пожелание: "message",
};

// «кому:», «от кого:» … — метка распознаётся только с двоеточием и не внутри слова.
const LABEL_RE = /(?<![\p{L}\d])(кому|кимге|от\s+кого|от|кимден|сумма|сом|текст|пожелание)\s*:/giu;

function clean(v: string): string {
  return v.replace(/[ \t]+/g, " ").replace(/^[\s;,]+|[\s;,]+$/g, "").trim();
}

export function parseCertificateMessage(text: string): CertificateParseResult {
  const body = text.replace(COMMAND_RE, "");
  const found: Partial<Record<Field, string>> = {};

  // Границами полей считаем только первое вхождение каждой метки: повтор метки
  // (например, «текст:» внутри самого пожелания) остаётся частью значения.
  const seen = new Set<Field>();
  const matches = [...body.matchAll(LABEL_RE)].filter((m) => {
    const key = LABELS[m[1].toLowerCase().replace(/\s+/g, " ")];
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  matches.forEach((m, i) => {
    const key = LABELS[m[1].toLowerCase().replace(/\s+/g, " ")];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
    found[key] = clean(body.slice(start, end));
  });

  const errors: string[] = [];
  const recipient = found.recipient ?? "";
  const sender = found.sender ?? "";
  if (!recipient) errors.push("не указано, кому сертификат («кому: …»)");
  if (!sender) errors.push("не указано, от кого («от: …»)");

  let amount = 0;
  if (!found.amount) {
    errors.push("не указана сумма («сумма: 5000»)");
  } else {
    const digits = found.amount.replace(/[\s .,]/g, "").replace(/сом.*$/i, "");
    amount = /^\d+$/.test(digits) ? Number(digits) : 0;
    if (!amount || amount < 1) errors.push(`не удалось прочитать сумму «${found.amount}»`);
    else if (amount > MAX_CERTIFICATE_AMOUNT) errors.push("сумма слишком большая");
  }

  if (recipient.length > 120) errors.push("слишком длинное имя получателя");
  if (sender.length > 120) errors.push("слишком длинное имя отправителя");
  if ((found.message ?? "").length > 300) errors.push("текст слишком длинный (максимум 300 символов)");

  if (errors.length) return { ok: false, errors };

  const custom = !!found.message && found.message !== DEFAULT_CERTIFICATE_TEXT;
  return {
    ok: true,
    certificate: {
      recipient,
      sender,
      amount,
      message: found.message || DEFAULT_CERTIFICATE_TEXT,
      customMessage: custom,
    },
  };
}

// 5000 → «5 000»
export function formatAmount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// «/погасить 4827» (также «AK-4827», «№4827»)
const REDEEM_RE = /^\s*[\/\\]\s*погасить(?![а-яё])\s*[:\-–—]?\s*/i;

export function isRedeemCommand(text: string): boolean {
  return REDEEM_RE.test(text);
}

export function redeemCodeFromMessage(text: string): string | null {
  return text.replace(REDEEM_RE, "").trim() || null;
}

export const REDEEM_FORMAT_HINT = "Напишите «/погасить» и номер сертификата, например: /погасить 4827";
