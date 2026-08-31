import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "owner" | "manager" | "employee";
    } & DefaultSession["user"];
  }

  interface User {
    role: "owner" | "manager" | "employee";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "owner" | "manager" | "employee";
    uid?: string;
  }
}
