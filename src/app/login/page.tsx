import Image from "next/image";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

async function loginAction(formData: FormData) {
  "use server";
  const login = String(formData.get("login") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", {
      login,
      password,
      redirectTo: "/schedule",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <form action={loginAction} className="w-full max-w-sm card-pad space-y-5">
        <div className="space-y-1 text-center">
          <Image
            src="/logo.png"
            alt="AYAY KYZ"
            width={96}
            height={96}
            className="mx-auto h-24 w-24 rounded-full object-cover shadow-sm"
            priority
          />
          <h1 className="page-title !text-xl pt-2">Вход в систему</h1>
          <p className="text-sm text-slate-500">
            График работы и табель сотрудников
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Неверный логин или пароль
          </p>
        )}

        <div>
          <label className="field-label" htmlFor="login">
            Логин
          </label>
          <input
            id="login"
            name="login"
            required
            autoFocus
            autoComplete="username"
            className="input"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="password">
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />
        </div>

        <button type="submit" className="btn-primary w-full">
          Войти
        </button>
      </form>
    </div>
  );
}
