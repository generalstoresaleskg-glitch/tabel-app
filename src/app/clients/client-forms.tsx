"use client";

import { useActionState, useRef } from "react";
import { addClient, deleteClient, type AddClientState } from "./actions";

export function AddClientForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<AddClientState, FormData>(async (prev, fd) => {
    const r = await addClient(prev, fd);
    if (r?.ok) formRef.current?.reset();
    return r;
  }, null);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-[2fr_1.4fr_1.2fr_auto] sm:items-end">
      <div>
        <label className="field-label">ФИО</label>
        <input name="name" required className="input" placeholder="Иванова Айгуль" />
      </div>
      <div>
        <label className="field-label">Телефон</label>
        <input name="phone" required inputMode="tel" className="input" placeholder="0555 123 456" />
      </div>
      <div>
        <label className="field-label">Дата рождения</label>
        <input name="birthday" required className="input" placeholder="12.03.1995" />
      </div>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Сохраняю…" : "Добавить"}
      </button>
      {state && (
        <p className={`text-sm sm:col-span-4 ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</p>
      )}
    </form>
  );
}

export function DeleteClientButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteClient.bind(null, id)}
      onSubmit={(e) => {
        if (!confirm(`Удалить клиента «${name}»?`)) e.preventDefault();
      }}
    >
      <button className="btn-link text-red-600">Удалить</button>
    </form>
  );
}
