import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db } from "./db";
import { users } from "./db/schema";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        login: { label: "Логин" },
        password: { label: "Пароль", type: "password" },
      },
      authorize: async (credentials) => {
        const login = credentials?.login as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!login || !password) return null;

        const rows = await db.select().from(users).where(eq(users.login, login));
        const user = rows[0];
        if (!user || !user.active) return null;

        const valid = bcrypt.compareSync(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
