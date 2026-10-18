-- AlterEnum
ALTER TYPE "HabitEntryOrigin" ADD VALUE 'focus';

-- AlterTable
ALTER TABLE "habit_activity" ADD COLUMN     "points_per_pomodoro" INTEGER;

-- AlterTable
ALTER TABLE "habit_entry" ADD COLUMN     "focus_session_id" UUID;

-- CreateTable
CREATE TABLE "focus_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "activity_id" UUID,
    "habit_id" UUID,
    "minutes" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "day" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "focus_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "focus_session_user_id_day_idx" ON "focus_session"("user_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "focus_session_user_id_client_id_key" ON "focus_session"("user_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "habit_entry_focus_session_id_key" ON "habit_entry"("focus_session_id");

-- AddForeignKey
ALTER TABLE "habit_entry" ADD CONSTRAINT "habit_entry_focus_session_id_fkey" FOREIGN KEY ("focus_session_id") REFERENCES "focus_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_session" ADD CONSTRAINT "focus_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_session" ADD CONSTRAINT "focus_session_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "habit_activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

