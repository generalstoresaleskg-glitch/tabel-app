import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Растеризатор сертификатов (нативный модуль) подключается как есть, не бандлится.
  serverExternalPackages: ["@resvg/resvg-js"],
  // Шрифты и логотип для сертификата читаются с диска во время запроса.
  outputFileTracingIncludes: {
    "/api/certificates/image": ["./src/assets/certificate/**/*"],
  },
};

export default nextConfig;
