// Видео сертификата 1080×1920, 12 с, 30 к/с: элементы появляются по очереди,
// затем кадр держится. Слои рисует resvg (certificate-render), монтирует ffmpeg.
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { type CertificateData, type Layer, renderCertificateLayers } from "@/lib/certificate-render";

const run = promisify(execFile);

// Когда слой начинает появляться и сколько длится появление (секунды).
const TIMELINE: Record<Exclude<Layer, "base">, { at: number; dur: number; rise: number }> = {
  logo: { at: 0.2, dur: 0.9, rise: 30 },
  title: { at: 1.1, dur: 0.8, rise: 24 },
  amount: { at: 1.9, dur: 1.0, rise: 36 },
  card: { at: 3.0, dur: 1.0, rise: 50 },
  quote: { at: 4.2, dur: 0.9, rise: 20 },
  footer: { at: 5.1, dur: 0.7, rise: 0 },
};
const ANIM_END = 6.2; // после этого кадр не меняется
const TOTAL = 12;
const FPS = 30;

function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = (process.env.FFMPEG_PATH || require("ffmpeg-static")) as string | null;
  if (!p) throw new Error("ffmpeg не найден");
  return p;
}

export async function renderCertificateVideo(d: CertificateData): Promise<Buffer> {
  const layers = renderCertificateLayers(d);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cert-"));
  try {
    const order = Object.keys(layers) as Layer[];
    const args: string[] = ["-v", "error", "-y"];
    for (const name of order) {
      fs.writeFileSync(path.join(dir, `${name}.png`), layers[name]);
      args.push("-loop", "1", "-framerate", String(FPS), "-t", String(ANIM_END), "-i", path.join(dir, `${name}.png`));
    }

    // base — подложка; остальные слои накладываются с плавным появлением и подъёмом.
    const f: string[] = ["[0:v]format=rgba[b0]"];
    let prev = "b0";
    order.slice(1).forEach((name, i) => {
      const t = TIMELINE[name as Exclude<Layer, "base">];
      const idx = i + 1;
      f.push(`[${idx}:v]format=rgba,fade=t=in:st=${t.at}:d=${t.dur}:alpha=1[l${idx}]`);
      const p = `min(max((t-${t.at})/${t.dur},0),1)`;
      const y = t.rise ? `${t.rise}*pow(1-${p},3)` : "0";
      f.push(`[${prev}][l${idx}]overlay=x=0:y='${y}':format=auto[b${idx}]`);
      prev = `b${idx}`;
    });
    f.push(`[${prev}]format=yuv420p,tpad=stop_mode=clone:stop_duration=${TOTAL - ANIM_END}[out]`);

    const outFile = path.join(dir, "certificate.mp4");
    args.push(
      "-filter_complex", f.join(";"),
      "-map", "[out]",
      "-r", String(FPS),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
      "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-t", String(TOTAL),
      outFile
    );
    await run(ffmpegPath(), args, { timeout: 110_000, maxBuffer: 10 * 1024 * 1024 });
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
