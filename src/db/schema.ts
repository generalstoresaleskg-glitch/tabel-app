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
// Статусы: draft (собирается) -> pending_owner (только если создал управляющий,
// ждёт утверждения владельцем) -> published (виден всем сразу, без подтверждения
// сотрудниками — решили, что для команды из 5 человек это лишний шаг).
export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(), // "2026-09-01" (понедельник недели)
  status: text("status", {
    enum: ["draft", "pending_owner", "published"],
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

// ===== Обучение =====
// Курс = один модуль программы обучения (напр. "Кожа и типы кожи").
export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(), // "m1", "m2", ...
  moduleNumber: integer("module_number").notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

// Урок внутри модуля — страницы исходной презентации отрендерены в картинки
// (сохраняем визуал 1:1), пути к ним лежат прямо в строке урока по порядку.
export const lessons = pgTable("lessons", {
  id: text("id").primaryKey(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(), // "m1-l1"
  lessonNumber: integer("lesson_number").notNull(),
  title: text("title").notNull(),
  images: text("images").array().notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

// "Гость" — человек, который прошёл по публичной ссылке на обучение
// (/uchenik) и представился именем, без создания полноценного аккаунта.
export const guestLearners = pgTable("guest_learners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

// Отметка "урок пройден" — либо сотрудником (user_id), либо гостем по ссылке
// (guest_id). Ровно одно из двух полей заполнено — проверяется в коде.
export const lessonProgress = pgTable("lesson_progress", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  guestId: text("guest_id").references(() => guestLearners.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id")
    .notNull()
    .references(() => lessons.id, { onDelete: "cascade" }),
  completedAt: text("completed_at").notNull().default(sql`now()::text`),
});

// Тест в конце модуля — один вопрос с несколькими вариантами, один правильный.
export const quizQuestions = pgTable("quiz_questions", {
  id: text("id").primaryKey(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  question: text("question").notNull(),
});

export const quizOptions = pgTable("quiz_options", {
  id: text("id").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => quizQuestions.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  text: text("text").notNull(),
  isCorrect: boolean("is_correct").notNull().default(false),
});

// Попытка прохождения теста — сотрудником (user_id) или гостем по ссылке
// (guest_id), ровно одно из двух. Владелец/управляющая видят историю попыток
// по каждому человеку и модулю (сколько раз пытался, лучший результат).
export const quizAttempts = pgTable("quiz_attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  guestId: text("guest_id").references(() => guestLearners.id, { onDelete: "cascade" }),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  total: integer("total").notNull(),
  percent: integer("percent").notNull(),
  passed: boolean("passed").notNull(),
  completedAt: text("completed_at").notNull().default(sql`now()::text`),
});
