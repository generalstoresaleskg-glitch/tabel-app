// MP4 сертификата по коду (12 с, 1080×1920). Только для бота.
import { findCertificateByCode } from "@/lib/certificates";
import { renderCertificateVideo } from "@/lib/certificate-video";
import { isBotRequest } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const code = new URL(request.url).searchParams.get("code") ?? "";
  const row = code ? await findCertificateByCode(code) : null;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  const mp4 = await renderCertificateVideo({
    recipient: row.recipient,
    sender: row.sender,
    amount: row.amount,
    message: row.message,
    code: row.code,
  });
  return new Response(new Uint8Array(mp4), {
    headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" },
  });
}
