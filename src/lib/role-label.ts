// Единая подпись роли — переиспользуется в шапке, профиле и списке сотрудников,
// чтобы при добавлении новой роли не искать все места по отдельности.
export const ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  manager: "Управляющая",
  employee: "Сотрудник",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}
