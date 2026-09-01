import type { MetadataRoute } from "next";

// Next.js отдаёт это по адресу /manifest.webmanifest — то, что превращает сайт
// в "приложение" при добавлении на домашний экран телефона (иконка, без адресной
// строки браузера, свой цвет статус-бара).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Табель — график и учёт рабочего времени",
    short_name: "Табель",
    description: "Внутренняя система учёта графика и табеля сотрудников",
    start_url: "/schedule",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#4f46e5",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
