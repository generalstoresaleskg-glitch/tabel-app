// Проверка разбора «/клиент …»: npx tsx tests/client-parse.test.ts
import assert from "node:assert/strict";
import { parseClientMessage, isClientCommand } from "../src/lib/client-parse";

const ok = (text: string, exp: object) => {
  const r = parseClientMessage(text, 2026);
  assert.ok(r.ok, `${text} → ${JSON.stringify(r)}`);
  assert.deepEqual(r.client, exp, text);
};
const bad = (text: string, needle: string) => {
  const r = parseClientMessage(text, 2026);
  assert.ok(!r.ok, `ожидалась ошибка: ${text}`);
  assert.ok(r.errors.join("|").includes(needle), `${text} → ${r.errors}`);
};

ok("/клиент Иванова Айгуль +996 555 123 456 12.03.1995", { name: "Иванова Айгуль", phone: "+996555123456", day: 12, month: 3, year: 1995 });
ok("\\клиент-Иванова Айгуль Маратовна, 0555123456, 12.03.95", { name: "Иванова Айгуль Маратовна", phone: "+996555123456", day: 12, month: 3, year: 1995 });
ok("/Клиент: асанова бермет 0700 12-34-56 1/2/2001", { name: "Асанова Бермет", phone: "+996700123456", day: 1, month: 2, year: 2001 });
ok("/клиент\nФИО: Токтогулова Жибек\nТел: 0 555 12 34 56\nДР: 12 марта", { name: "Токтогулова Жибек", phone: "+996555123456", day: 12, month: 3, year: null });
ok("/клиент 12.03.1995 Иванова +996(555)12-34-56", { name: "Иванова", phone: "+996555123456", day: 12, month: 3, year: 1995 });
ok("/клиент Ли Анна +7 912 345 67 89 29.02", { name: "Ли Анна", phone: "+79123456789", day: 29, month: 2, year: null });
ok("/клиент Өмүрбекова Нургүл 555123456 5 января 1990", { name: "Өмүрбекова Нургүл", phone: "+996555123456", day: 5, month: 1, year: 1990 });
ok("/клиент Иванова Айгуль 0555123456 12-03-1995", { name: "Иванова Айгуль", phone: "+996555123456", day: 12, month: 3, year: 1995 });
ok("/клиент Иванова 0555 12-12-12 12.03.1995", { name: "Иванова", phone: "+996555121212", day: 12, month: 3, year: 1995 });
ok("/клиент Сыдыкова Мээрим 0700123456 7 мая", { name: "Сыдыкова Мээрим", phone: "+996700123456", day: 7, month: 5, year: null });

bad("/клиент Иванова 0555123456", "дату");
bad("/клиент Иванова 12.03.1995", "телефон");
bad("/клиент Иванова 0555 12 34 12.03.1995", "телефона указан неверно");
bad("/клиент 0555123456 12.03.1995", "ФИО");
bad("/клиент Иванова 0555123456 31.02.1995", "неверно");
bad("/клиент Иванова 0555123456 12.03.2030", "неверно");

assert.ok(isClientCommand("/клиент x"));
assert.ok(isClientCommand("  \\Клиент-x"));
assert.ok(!isClientCommand("/клиенты"));
assert.ok(!isClientCommand("новый клиент /клиент"));
console.log("client-parse: все проверки прошли");
