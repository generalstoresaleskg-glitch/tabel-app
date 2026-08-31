import { pgTable, text, boolean, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Роли: owner (владелец), manager (управляющая), employee (сотрудник, включая СММ)
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "manager", "employee"] }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

// Точки (филиалы)
export const points = pgTable("points", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  defaultOpenTime: text("default_open_time").notNull(), // "09:00"
  defaultCloseTime: text("default_close_time").notNull(), // "19:00"
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

// Недельные графики
export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(), // "2026-09-01" (понедельник недели)
  status: text("status", {
    enum: ["draft", "pending_owner", "pending_employee", "published"],
  })
    .notNull()
    .default("draft"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  ownerComment: text("owner_comment"),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
  updatedAt: text("updated_at").notNull().default(sql`now()::text`),
});

// Смены и визит-задачи внутри графика
export const shifts = pgTable("shifts", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id")
    .notNull()
    .references(() => schedules.id, { onDelete: "cascade" }),
  pointId: text("point_id")
    .notNull()
    .references(() => points.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type", { enum: ["SHIFT", "VISIT"] }).notNull().default("SHIFT"),
  date: text("date").notNull(), // "2026-09-01"
  plannedStart: text("planned_start"), // null для VISIT
  plannedEnd: text("planned_end"), // null для VISIT
  note: text("note"), // напр. "съёмка контента"
  employeeAck: text("employee_ack", {
    enum: ["pending", "confirmed", "question"],
  })
    .notNull()
    .default("pending"),
  employeeComment: text("employee_comment"),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

// Фактические отметки (табель)
export const attendance = pgTable("attendance", {
  id: text("id").primaryKey(),
  shiftId: text("shift_id")
    .notNull()
    .references(() => shifts.id, { onDelete: "cascade" })
    .unique(),
  checkinAt: text("checkin_at"), // ISO datetime факт. прихода (SHIFT) или визита (VISIT)
  checkoutAt: text("checkout_at"), // ISO datetime факт. ухода (только SHIFT)
  checkinStatus: text("checkin_status", {
    enum: ["on_time", "late"],
  }),
  checkoutStatus: text("checkout_status", {
    enum: ["on_time", "early", "overtime"],
  }),
  checkinLateMinutes: integer("checkin_late_minutes"),
});

// История изменений опубликованного графика
export const scheduleChangeLog = pgTable("schedule_change_log", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id")
    .notNull()
    .references(() => schedules.id, { onDelete: "cascade" }),
  shiftId: text("shift_id"),
  changedBy: text("changed_by")
    .notNull()
    .references(() => users.id),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});
