import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/login")) return true;
      // Публичный раздел обучения по ссылке (/uchenik) — без входа в систему,
      // личность гостя проверяется отдельной кукой (см. src/lib/guest-session.ts),
      // не сессией NextAuth.
      if (pathname === "/uchenik" || pathname.startsWith("/uchenik/")) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.uid = (user as { id: string }).id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
