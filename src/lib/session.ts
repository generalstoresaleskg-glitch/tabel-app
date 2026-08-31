import { auth } from "@/auth";
import { redirect } from "next/navigation";

export type Role = "owner" | "manager" | "employee";

export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user;
}

export async function requireRole(roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    redirect("/");
  }
  return user;
}
