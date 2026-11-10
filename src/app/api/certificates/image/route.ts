// PNG сертификата по коду. Только для бота (тот же токен, что и у /api/clients/ingest).
import { findCertificateByCode } from "@/lib/certificates";
import { renderCertificatePng } from "@/lib/certificate-render";
import { isBotRequest } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const code = new URL(request.url).searchParams.get("code") ?? "";
  const row = code ? await findCertificateByCode(code) : null;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  const png = renderCertificatePng({
    recipient: row.recipient,
    sender: row.sender,
    amount: row.amount,
    message: row.message,
    code: row.code,
  });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
