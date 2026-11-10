import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Растеризатор и ffmpeg для сертификатов — нативные бинарники, не бандлятся.
  serverExternalPackages: ["@resvg/resvg-js", "ffmpeg-static"],
  // Шрифты, логотип и ffmpeg читаются с диска во время запроса.
  outputFileTracingIncludes: {
    "/api/certificates/image": ["./src/assets/certificate/**/*"],
    "/api/certificates/video": ["./src/assets/certificate/**/*", "./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
