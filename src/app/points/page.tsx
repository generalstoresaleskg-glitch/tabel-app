import { db } from "@/db";
import { points } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { createPoint, updatePoint, togglePointActive, deletePoint } from "./actions";

export const dynamic = "force-dynamic";

export default async function PointsPage() {
  await requireRole(["owner"]);

  const allPoints = await db.select().from(points).orderBy(points.createdAt);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Точки (филиалы)</h1>
        <p className="page-subtitle">
          Управление точками доступно только владельцу.
        </p>
      </div>

      <div className="grid gap-4">
        {allPoints.map((p) => (
          <div key={p.id} className={`card-pad ${p.active ? "" : "opacity-60"}`}>
            <form
              action={updatePoint.bind(null, p.id)}
              className="grid sm:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-3 sm:items-end"
            >
              <div>
                <label className="field-label">Название</label>
                <input name="name" defaultValue={p.name} required className="input" />
              </div>
              <div>
                <label className="field-label">Адрес</label>
                <input name="address" defaultValue={p.address ?? ""} className="input" />
              </div>
              <div>
                <label className="field-label">Открытие</label>
                <input
                  type="time"
                  name="defaultOpenTime"
                  defaultValue={p.defaultOpenTime}
                  required
                  className="input"
                />
              </div>
              <div>
                <label className="field-label">Закрытие</label>
                <input
                  type="time"
                  name="defaultCloseTime"
                  defaultValue={p.defaultCloseTime}
                  required
                  className="input"
                />
              </div>
              <button type="submit" className="btn-primary btn-sm">
                Сохранить
              </button>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <form action={togglePointActive.bind(null, p.id, !p.active)}>
                <button className="btn-link">
                  {p.active ? "Деактивировать" : "Активировать"}
                </button>
              </form>
              <form action={deletePoint.bind(null, p.id)}>
                <button className="btn-link-danger">Удалить</button>
              </form>
              {!p.active && <span className="badge-neutral">точка неактивна</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card-pad">
        <h2 className="section-title mb-4">Добавить точку</h2>
        <form
          action={createPoint}
          className="grid sm:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-3 sm:items-end"
        >
          <div>
            <label className="field-label">Название</label>
            <input name="name" required placeholder="Например, Достук" className="input" />
          </div>
          <div>
            <label className="field-label">Адрес</label>
            <input name="address" className="input" />
          </div>
          <div>
            <label className="field-label">Открытие</label>
            <input type="time" name="defaultOpenTime" defaultValue="09:00" required className="input" />
          </div>
          <div>
            <label className="field-label">Закрытие</label>
            <input type="time" name="defaultCloseTime" defaultValue="19:00" required className="input" />
          </div>
          <button type="submit" className="btn-primary btn-sm">
            Добавить
          </button>
        </form>
      </div>
    </div>
  );
}
