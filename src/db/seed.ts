import { seedInitialData } from "./seed-data";

// Ручной запуск: ВСЕГДА очищает и заново заполняет базу тестовыми данными.
// Используйте для локальной разработки. Для продакшен-деплоя используется
// ensure-seed.ts — он не трогает базу, если данные уже есть.
seedInitialData()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
