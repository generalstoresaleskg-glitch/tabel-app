import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL не задан. Укажите строку подключения к Postgres (см. .env.example)."
  );
}

// В проде (Neon) подключаемся через их лёгкий HTTP-драйвер — он заметно
// быстрее устанавливает соединение при "холодном" старте serverless-функции
// на Vercel, чем обычный TCP-драйвер (нет живого пула соединений между
// вызовами). Локально и в тестах (обычный Postgres, не Neon) продолжаем
// использовать стандартный pg-драйвер — HTTP-драйвер Neon работает только
// с самим Neon, а не с любым Postgres.
const isNeon = connectionString.includes("neon.tech");

export const db = isNeon
  ? drizzleNeonHttp(neon(connectionString), { schema })
  : drizzlePg(new Pool({ connectionString }), { schema });