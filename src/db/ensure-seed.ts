import { db } from "./index";
import { users } from "./schema";
import { seedInitialData } from "./seed-data";

// Безопасно запускать на каждом деплое: заполняет базу тестовыми данными
// только один раз, при первом запуске (пока в таблице users пусто).
// Если данные уже есть (реальная работа системы) — ничего не делает и не
// затирает существующих сотрудников/график.
async function main() {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("В базе уже есть данные — пропускаю сидирование.");
    return;
  }
  console.log("База пустая — заполняю начальными данными...");
  await seedInitialData();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
