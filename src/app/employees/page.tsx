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
        <h1 className="page-title">Сотрудники</h1>
        <p className="page-subtitle">
          {isOwner
            ? "Полное управление сотрудниками и их ролями."
            : "Вы можете создавать и редактировать рядовых сотрудников. Владельца и других управляющих редактирует только владелец."}
        </p>
      </div>

      {readOnly.length > 0 && (
        <div className="card-pad bg-slate-50 text-sm text-slate-600 space-y-1">
          {readOnly.map((u) => (
            <div key={u.id}>
              <span className="font-medium text-slate-800">{u.name}</span> —{" "}
              {ROLE_LABEL[u.role]} (логин: {u.login})
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4">
        {editable.map((u) => (
          <div key={u.id} className={`card-pad space-y-4 ${u.active ? "" : "opacity-60"}`}>
            <form
              action={updateEmployee.bind(null, u.id)}
              className="grid sm:grid-cols-[2fr_1.5fr_1.5fr_1fr_auto] gap-3 sm:items-end"
            >
              <div>
                <label className="field-label">Имя</label>
                <input name="name" defaultValue={u.name} required className="input" />
              </div>
              <div>
                <label className="field-label">Телефон</label>
                <input name="phone" defaultValue={u.phone ?? ""} className="input" />
              </div>
              <div>
                <label className="field-label">Логин</label>
                <input name="login" defaultValue={u.login} required className="input" />
              </div>
              <div>
                <label className="field-label">Роль</label>
                {isOwner ? (
                  <select name="role" defaultValue={u.role} className="input">
                    <option value="owner">Владелец</option>
                    <option value="manager">Управляющая</option>
                    <option value="employee">Сотрудник</option>
                  </select>
                ) : (
                  <div className="text-sm py-2 text-slate-700">{ROLE_LABEL[u.role]}</div>
                )}
              </div>
              <button type="submit" className="btn-primary btn-sm">
                Сохранить
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4">
              <form action={resetPassword.bind(null, u.id)} className="flex items-center gap-2">
                <input
                  name="password"
                  type="password"
                  placeholder="Новый пароль"
                  minLength={4}
                  className="input !w-44 !py-1.5 text-sm"
                />
                <button className="btn-link">Сменить пароль</button>
              </form>
              <form action={toggleEmployeeActive.bind(null, u.id, !u.active)}>
                <button className="btn-link">
                  {u.active ? "Деактивировать" : "Активировать"}
                </button>
              </form>
              {!u.active && <span className="badge-neutral">неактивен</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card-pad">
        <h2 className="section-title mb-4">Добавить сотрудника</h2>
        <form
          action={createEmployee}
          className="grid sm:grid-cols-[2fr_1.5fr_1.5fr_1.5fr_1fr_auto] gap-3 sm:items-end"
        >
          <div>
            <label className="field-label">Имя</label>
            <input name="name" required className="input" />
          </div>
          <div>
            <label className="field-label">Телефон</label>
            <input name="phone" className="input" />
          </div>
          <div>
            <label className="field-label">Логин</label>
            <input name="login" required className="input" />
          </div>
          <div>
            <label className="field-label">Пароль</label>
            <input name="password" type="password" required minLength={4} className="input" />
          </div>
          <div>
            <label className="field-label">Роль</label>
            {isOwner ? (
              <select name="role" defaultValue="employee" className="input">
                <option value="owner">Владелец</option>
                <option value="manager">Управляющая</option>
                <option value="employee">Сотрудник</option>
              </select>
            ) : (
              <div className="text-sm py-2 text-slate-500">Сотрудник</div>
            )}
          </div>
          <button type="submit" className="btn-primary btn-sm">
            Добавить
          </button>
        </form>
      </div>
    </div>
  );
}
