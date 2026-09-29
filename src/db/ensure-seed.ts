import { db } from "./index";
import { users } from "./schema";
import { seedInitialData } from "./seed-data";
import { seedTrainingContent } from "./training-seed-data";

// Безопасно запускать на каждом деплое: заполняет базу тестовыми данными
// только один раз, при первом запуске (пока в таблице users пусто).
// Если данные уже есть (реальная работа системы) — ничего не делает и не
// затирает существующих сотрудников/график.
//
// Контент обучения (курсы/уроки/тесты) — отдельная история: это не тестовые
// данные, а реальный учебный материал, и seedTrainingContent() обновляет его
// по slug, не трогая попытки прохождения тестов сотрудников. Поэтому он
// запускается на КАЖДОМ деплое, даже если users уже заполнены — так правки
// материала/тестов подхватываются автоматически при следующем деплое.
async function main() {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("В базе уже есть данные — пропускаю сидирование тестовых данных.");
  } else {
    console.log("База пустая — заполняю начальными данными...");
    await seedInitialData();
  }

  console.log("Обновляю материал обучения...");
  await seedTrainingContent();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
