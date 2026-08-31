import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL не задан. Укажите строку подключения к Postgres (см. .env.example)."
  );
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
