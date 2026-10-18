-- CreateEnum
CREATE TYPE "HabitEntryOrigin" AS ENUM ('task', 'event', 'manual');

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "habit_activity_id" UUID;

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "habit_activity_id" UUID;

-- AlterTable
ALTER TABLE "task_series" ADD COLUMN     "habit_activity_id" UUID;

-- CreateTable
CREATE TABLE "habit" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "emblem" TEXT NOT NULL,
    "weekly_goal" INTEGER NOT NULL,
    "target_days" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_activity" (
    "id" UUID NOT NULL,
    "habit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habit_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_entry" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "habit_id" UUID NOT NULL,
    "activity_id" UUID,
    "points" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "origin" "HabitEntryOrigin" NOT NULL,
    "note" TEXT,
    "task_id" UUID,
    "event_id" UUID,
    "ai_via" "AiVia",
    "ai_author" TEXT,
    "ai_agent_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "habit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "habit_user_id_name_key" ON "habit"("user_id", "name");

-- CreateIndex
CREATE INDEX "habit_activity_user_id_idx" ON "habit_activity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "habit_activity_habit_id_name_key" ON "habit_activity"("habit_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "habit_entry_task_id_key" ON "habit_entry"("task_id");

-- CreateIndex
CREATE INDEX "habit_entry_user_id_day_idx" ON "habit_entry"("user_id", "day");

-- CreateIndex
CREATE INDEX "habit_entry_habit_id_day_idx" ON "habit_entry"("habit_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "habit_entry_event_id_day_key" ON "habit_entry"("event_id", "day");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_habit_activity_id_fkey" FOREIGN KEY ("habit_activity_id") REFERENCES "habit_activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_habit_activity_id_fkey" FOREIGN KEY ("habit_activity_id") REFERENCES "habit_activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_habit_activity_id_fkey" FOREIGN KEY ("habit_activity_id") REFERENCES "habit_activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit" ADD CONSTRAINT "habit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_activity" ADD CONSTRAINT "habit_activity_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entry" ADD CONSTRAINT "habit_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entry" ADD CONSTRAINT "habit_entry_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entry" ADD CONSTRAINT "habit_entry_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "habit_activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entry" ADD CONSTRAINT "habit_entry_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entry" ADD CONSTRAINT "habit_entry_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

