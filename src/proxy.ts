import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth;

// Кроме api/_next/login, также не трогаем любые пути с расширением файла —
// /logo.png, /icon-*.png, /manifest.webmanifest, /favicon.ico и т.п. Раньше
// это не имело значения (такие файлы не использовались напрямую), но теперь
// шапка и страница входа ссылаются на /logo.png — без этого исключения
// неавторизованный запрос к нему уходил в редирект на /login и картинка не
// загружалась.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login|.*\\..*).*)"],
};
