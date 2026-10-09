-- Frente de agenda, Fase 1: evento ganha quadro e marca de IA; nasce a tarefa.
-- Só aditiva — o banco de desenvolvimento guarda a conta real do operador, e
-- `event` nunca teve linha gravada por rota (a tabela existia desde o init sem
-- service). `task.date` é DATE, data civil: não passa por fuso nenhum.

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "ai_agent_name" TEXT,
ADD COLUMN     "ai_author" TEXT,
ADD COLUMN     "ai_conversation_id" UUID,
ADD COLUMN     "ai_generated_at" TIMESTAMP(3),
ADD COLUMN     "ai_revised_at" TIMESTAMP(3),
ADD COLUMN     "ai_routine_name" TEXT,
ADD COLUMN     "ai_run_id" UUID,
ADD COLUMN     "ai_via" "AiVia",
ADD COLUMN     "board_id" UUID;

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "board_id" UUID,
    "title" TEXT NOT NULL,
    "description_md" TEXT NOT NULL DEFAULT '',
    "date" DATE,
    "time" VARCHAR(5),
    "completed_at" TIMESTAMP(3),
    "ai_completed_via" "AiVia",
    "ai_completed_author" TEXT,
    "ai_completed_agent_name" TEXT,
    "ai_generated_at" TIMESTAMP(3),
    "ai_via" "AiVia",
    "ai_author" TEXT,
    "ai_conversation_id" UUID,
    "ai_revised_at" TIMESTAMP(3),
    "ai_agent_name" TEXT,
    "ai_run_id" UUID,
    "ai_routine_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_user_id_completed_at_date_idx" ON "task"("user_id", "completed_at", "date");

-- CreateIndex
CREATE INDEX "task_board_id_idx" ON "task"("board_id");

-- CreateIndex
CREATE INDEX "event_user_id_board_id_idx" ON "event"("user_id", "board_id");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_ai_conversation_id_fkey" FOREIGN KEY ("ai_conversation_id") REFERENCES "ai_conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_routine_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_ai_conversation_id_fkey" FOREIGN KEY ("ai_conversation_id") REFERENCES "ai_conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_routine_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

