import { seedTrainingContent } from "./training-seed-data";

// Ручной запуск: обновляет только материал обучения (курсы/уроки/тесты) из
// training-content/manifest.json + quiz-data.json, не трогая сотрудников,
// точки и график. Используется и для разработки, и как часть db:seed:ensure
// на каждом деплое.
seedTrainingContent()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
