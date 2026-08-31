import { db } from "@/db";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/session";
import {
  createEmployee,
  updateEmployee,
  resetPassword,
  toggleEmployeeActive,
} from "./actions";

const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  manager: "Управляющая",
  employee: "Сотрудник",
};

export default async function EmployeesPage() {
  const me = await requireRole(["owner", "manager"]);
  const isOwner = me.role === "owner";

  const all = await db.select().from(users).orderBy(users.createdAt);
  const editable = isOwner ? all : all.filter((u) => u.role === "employee");
  const readOnly = isOwner ? [] : all.filter((u) => u.role !== "employee");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Сотрудники</h1>
        <p className="text-sm text-neutral-500">
          {isOwner
            ? "Полное управление сотрудниками и их ролями."
            : "Вы можете создавать и редактировать рядовых сотрудников. Владельца и других управляющих редактирует только владелец."}
        </p>
      </div>

      {readOnly.length > 0 && (
        <div className="border rounded-lg p-4 bg-neutral-100 text-sm text-neutral-600">
          {readOnly.map((u) => (
            <div key={u.id}>
              {u.name} — {ROLE_LABEL[u.role]} (логин: {u.login})
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4">
        {editable.map((u) => (
          <div
            key={u.id}
            className={`border rounded-lg p-4 bg-white space-y-3 ${
              u.active ? "" : "opacity-50"
            }`}
          >
            <form
              action={updateEmployee.bind(null, u.id)}
              className="grid sm:grid-cols-[2fr_1.5fr_1.5fr_1fr_auto] gap-3 items-end"
            >
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Имя</label>
                <input
                  name="name"
                  defaultValue={u.name}
                  required
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Телефон</label>
                <input
                  name="phone"
                  defaultValue={u.phone ?? ""}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Логин</label>
                <input
                  name="login"
                  defaultValue={u.login}
                  required
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Роль</label>
                {isOwner ? (
                  <select
                    name="role"
                    defaultValue={u.role}
                    className="w-full border rounded px-2 py-1.5 text-sm"
                  >
                    <option value="owner">Владелец</option>
                    <option value="manager">Управляющая</option>
                    <option value="employee">Сотрудник</option>
                  </select>
                ) : (
                  <div className="text-sm py-1.5">{ROLE_LABEL[u.role]}</div>
                )}
              </div>
              <button
                type="submit"
                className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 hover:bg-neutral-800"
              >
                Сохранить
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <form
                action={resetPassword.bind(null, u.id)}
                className="flex items-center gap-2"
              >
                <input
                  name="password"
                  type="password"
                  placeholder="Новый пароль"
                  minLength={4}
                  className="border rounded px-2 py-1 text-sm"
                />
                <button className="text-neutral-600 underline underline-offset-2 hover:text-neutral-900">
                  Сменить пароль
                </button>
              </form>
              <form action={toggleEmployeeActive.bind(null, u.id, !u.active)}>
                <button className="text-neutral-600 underline underline-offset-2 hover:text-neutral-900">
                  {u.active ? "Деактивировать" : "Активировать"}
                </button>
              </form>
              {!u.active && <span className="text-neutral-400">неактивен</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <h2 className="font-medium mb-3">Добавить сотрудника</h2>
        <form
          action={createEmployee}
          className="grid sm:grid-cols-[2fr_1.5fr_1.5fr_1.5fr_1fr_auto] gap-3 items-end"
        >
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Имя</label>
            <input name="name" required className="w-full border rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Телефон</label>
            <input name="phone" className="w-full border rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Логин</label>
            <input name="login" required className="w-full border rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Пароль</label>
            <input
              name="password"
              type="password"
              required
              minLength={4}
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Роль</label>
            {isOwner ? (
              <select name="role" defaultValue="employee" className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="owner">Владелец</option>
                <option value="manager">Управляющая</option>
                <option value="employee">Сотрудник</option>
              </select>
            ) : (
              <div className="text-sm py-1.5 text-neutral-500">Сотрудник</div>
            )}
          </div>
          <button
            type="submit"
            className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 hover:bg-neutral-800"
          >
            Добавить
          </button>
        </form>
      </div>
    </div>
  );
}
