-- ============================================================
-- Анализ переписок WhatsApp: необязательные ФИО/ДР у клиентов, поля
-- сегмента и выжимки, таблицы переписок и отчётов.
-- Приложение выполняет это само при первом обращении — запускать вручную
-- нужно, только если что-то пошло не так. Идемпотентно.
-- ============================================================

ALTER TABLE "clients" ALTER COLUMN "name" DROP NOT NULL;

ALTER TABLE "clients" ALTER COLUMN "birth_day" DROP NOT NULL;

ALTER TABLE "clients" ALTER COLUMN "birth_month" DROP NOT NULL;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "segment" text;

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ai_summary" text;

CREATE TABLE IF NOT EXISTS "wa_messages" (
    "chat" text NOT NULL,
    "msg_id" text NOT NULL,
    "from_me" boolean NOT NULL,
    "ts" integer NOT NULL,
    "text" text NOT NULL,
    CONSTRAINT "wa_messages_chat_msg_id_pk" PRIMARY KEY("chat","msg_id")
  );

CREATE TABLE IF NOT EXISTS "wa_chats" (
    "chat" text PRIMARY KEY NOT NULL,
    "jid" text,
    "phone" text,
    "name" text,
    "msg_count" integer DEFAULT 0 NOT NULL,
    "in_count" integer DEFAULT 0 NOT NULL,
    "last_msg_at" integer DEFAULT 0 NOT NULL,
    "analyzed_at" integer,
    "attempts" integer DEFAULT 0 NOT NULL,
    "history_done" boolean DEFAULT false NOT NULL,
    "segment" text,
    "analysis" text
  );

CREATE TABLE IF NOT EXISTS "chat_reports" (
    "id" text PRIMARY KEY NOT NULL,
    "chats_count" integer NOT NULL,
    "body" text NOT NULL,
    "created_at" text DEFAULT now()::text NOT NULL
  );

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "last_chat_at" integer;
