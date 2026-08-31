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
    <div className="min-h-[70vh] flex items-center justify-center">
      <form
        action={loginAction}
        className="w-full max-w-sm bg-white border rounded-lg p-6 shadow-sm space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Вход</h1>
          <p className="text-sm text-neutral-500">
            График работы и табель сотрудников
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            Неверный логин или пароль
          </p>
        )}

        <div className="space-y-1">
          <label className="text-sm text-neutral-700" htmlFor="login">
            Логин
          </label>
          <input
            id="login"
            name="login"
            required
            autoFocus
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-neutral-700" htmlFor="password">
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-neutral-900 text-white rounded py-2 text-sm font-medium hover:bg-neutral-800"
        >
          Войти
        </button>
      </form>
    </div>
  );
}
