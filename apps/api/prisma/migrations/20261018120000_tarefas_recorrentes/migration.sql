-- AlterTable
ALTER TABLE "task" ADD COLUMN     "series_id" UUID;

-- CreateTable
CREATE TABLE "task_series" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "board_id" UUID,
    "title" TEXT NOT NULL,
    "description_md" TEXT NOT NULL DEFAULT '',
    "time" VARCHAR(5),
    "start_date" DATE NOT NULL,
    "repeat_days" INTEGER[],
    "repeat_until" DATE,
    "exdates" DATE[] DEFAULT ARRAY[]::DATE[],
    "generated_through" DATE NOT NULL,
    "ai_generated_at" TIMESTAMP(3),
    "ai_via" "AiVia",
    "ai_author" TEXT,
    "ai_agent_name" TEXT,
    "ai_routine_name" TEXT,
    "ai_revised_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_series_user_id_idx" ON "task_series"("user_id");

-- CreateIndex
CREATE INDEX "task_series_generated_through_idx" ON "task_series"("generated_through");

-- CreateIndex
CREATE UNIQUE INDEX "task_series_id_date_key" ON "task"("series_id", "date");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "task_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

