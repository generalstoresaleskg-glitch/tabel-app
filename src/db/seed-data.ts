import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, points, schedules, shifts, attendance, scheduleChangeLog } from "./schema";

function hash(pw: string) {
  return bcrypt.hashSync(pw, 10);
}

export async function seedInitialData() {
  console.log("Очистка таблиц...");
  // Порядок важен из-за внешних ключей: сначала зависимые таблицы.
  await db.delete(attendance);
  await db.delete(scheduleChangeLog);
  await db.delete(shifts);
  await db.delete(schedules);
  await db.delete(users);
  await db.delete(points);

  console.log("Создаю точки...");
  const pointsData = [
    {
      id: randomUUID(),
      name: "Ноокат",
      address: "",
      defaultOpenTime: "09:00",
      defaultCloseTime: "19:00",
      active: true,
    },
    {
      id: randomUUID(),
      name: "Максом",
      address: "",
      defaultOpenTime: "10:00",
      defaultCloseTime: "22:00",
      active: true,
    },
    {
      id: randomUUID(),
      name: "Тынчтык",
      address: "",
      defaultOpenTime: "10:00",
      defaultCloseTime: "19:00",
      active: true,
    },
  ];
  await db.insert(points).values(pointsData);

  console.log("Создаю пользователей...");
  const usersData = [
    {
      id: randomUUID(),
      name: "Владелец",
      phone: "",
      login: "owner",
      passwordHash: hash("owner123"),
      role: "owner" as const,
      active: true,
    },
    {
      id: randomUUID(),
      name: "Айгуль (управляющая)",
      phone: "",
      login: "aigul",
      passwordHash: hash("aigul123"),
      role: "manager" as const,
      active: true,
    },
    {
      id: randomUUID(),
      name: "Бегимай",
      phone: "",
      login: "begimai",
      passwordHash: hash("begimai123"),
      role: "employee" as const,
      active: true,
    },
    {
      id: randomUUID(),
      name: "Нурила",
      phone: "",
      login: "nurila",
      passwordHash: hash("nurila123"),
      role: "employee" as const,
      active: true,
    },
    {
      id: randomUUID(),
      name: "Айперим (СММ)",
      phone: "",
      login: "aiperim",
      passwordHash: hash("aiperim123"),
      role: "employee" as const,
      active: true,
    },
  ];
  await db.insert(users).values(usersData);

  console.log("Готово. Логины/пароли:");
  console.table(
    usersData.map((u) => ({
      role: u.role,
      login: u.login,
      password: "см. seed.ts (по умолчанию <login>123)",
    }))
  );
}
