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
        <h1 className="text-xl font-semibold">Точки (филиалы)</h1>
        <p className="text-sm text-neutral-500">
          Управление точками доступно только владельцу.
        </p>
      </div>

      <div className="grid gap-4">
        {allPoints.map((p) => (
          <div
            key={p.id}
            className={`border rounded-lg p-4 bg-white ${
              p.active ? "" : "opacity-50"
            }`}
          >
            <form
              action={updatePoint.bind(null, p.id)}
              className="grid sm:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-3 items-end"
            >
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Название</label>
                <input
                  name="name"
                  defaultValue={p.name}
                  required
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Адрес</label>
                <input
                  name="address"
                  defaultValue={p.address ?? ""}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Открытие</label>
                <input
                  type="time"
                  name="defaultOpenTime"
                  defaultValue={p.defaultOpenTime}
                  required
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-neutral-500">Закрытие</label>
                <input
                  type="time"
                  name="defaultCloseTime"
                  defaultValue={p.defaultCloseTime}
                  required
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="submit"
                className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 hover:bg-neutral-800"
              >
                Сохранить
              </button>
            </form>

            <div className="mt-3 flex gap-3 text-sm">
              <form action={togglePointActive.bind(null, p.id, !p.active)}>
                <button className="text-neutral-600 underline underline-offset-2 hover:text-neutral-900">
                  {p.active ? "Деактивировать" : "Активировать"}
                </button>
              </form>
              <form action={deletePoint.bind(null, p.id)}>
                <button className="text-red-600 underline underline-offset-2 hover:text-red-800">
                  Удалить
                </button>
              </form>
              {!p.active && (
                <span className="text-neutral-400">точка неактивна</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <h2 className="font-medium mb-3">Добавить точку</h2>
        <form
          action={createPoint}
          className="grid sm:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-3 items-end"
        >
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Название</label>
            <input
              name="name"
              required
              placeholder="Например, Достук"
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Адрес</label>
            <input
              name="address"
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Открытие</label>
            <input
              type="time"
              name="defaultOpenTime"
              defaultValue="09:00"
              required
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Закрытие</label>
            <input
              type="time"
              name="defaultCloseTime"
              defaultValue="19:00"
              required
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
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
