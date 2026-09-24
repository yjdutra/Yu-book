-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('em_andamento', 'concluida', 'falhou', 'cancelada', 'interrompida');

-- CreateEnum
CREATE TYPE "AiRunStepStatus" AS ENUM ('pendente', 'rodando', 'concluido', 'falhou', 'pulado');

-- CreateEnum
CREATE TYPE "AiStepMode" AS ENUM ('reescreve', 'revisa');

-- CreateEnum
CREATE TYPE "AiConsumeAction" AS ENUM ('mover', 'arquivar', 'manter');

-- CreateEnum
CREATE TYPE "AiOutputTitle" AS ENUM ('ideia', 'primeira_linha');

-- AlterEnum
-- `ADD VALUE` roda dentro da transação da migration (Postgres 12+), mas o valor
-- novo só pode ser **usado** depois do commit. Nada nesta migration o usa — nem
-- default, nem dado —, e é isso que a mantém aplicável num passo só.
ALTER TYPE "AiTask" ADD VALUE 'rotina';

-- AlterEnum
ALTER TYPE "AiVia" ADD VALUE 'rotina';

-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "run_id" UUID;

-- AlterTable
ALTER TABLE "card" ADD COLUMN     "ai_routine_name" TEXT,
ADD COLUMN     "ai_run_id" UUID;

-- AlterTable
ALTER TABLE "note" ADD COLUMN     "ai_routine_name" TEXT,
ADD COLUMN     "ai_run_id" UUID;

-- CreateTable
CREATE TABLE "ai_routine" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "input_board_id" UUID NOT NULL,
    "input_column_id" UUID NOT NULL,
    "output_column_id" UUID NOT NULL,
    "output_title" "AiOutputTitle" NOT NULL DEFAULT 'ideia',
    "include_notes" BOOLEAN NOT NULL DEFAULT true,
    "consume_action" "AiConsumeAction" NOT NULL,
    "consume_column_id" UUID,
    "run_cap_micros" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routine_step" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "agent_id" UUID,
    "agent_name" TEXT NOT NULL,
    "mode" "AiStepMode" NOT NULL,
    "instruction" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ai_routine_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routine_run" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "routine_id" UUID,
    "routine_name" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'em_andamento',
    "input_card_id" UUID,
    "input_title" TEXT NOT NULL,
    "output_card_id" UUID,
    "run_cap_micros" INTEGER NOT NULL,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "ai_routine_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routine_run_step" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "agent_name" TEXT NOT NULL,
    "mode" "AiStepMode" NOT NULL,
    "instruction" TEXT NOT NULL DEFAULT '',
    "model_id" TEXT,
    "model_used" TEXT,
    "status" "AiRunStepStatus" NOT NULL DEFAULT 'pendente',
    "text" TEXT NOT NULL DEFAULT '',
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "ai_routine_run_step_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_routine_user_id_name_key" ON "ai_routine"("user_id", "name");

-- CreateIndex
CREATE INDEX "ai_routine_step_routine_id_position_idx" ON "ai_routine_step"("routine_id", "position");

-- CreateIndex
CREATE INDEX "ai_routine_step_agent_id_idx" ON "ai_routine_step"("agent_id");

-- CreateIndex
CREATE INDEX "ai_routine_run_user_id_status_idx" ON "ai_routine_run"("user_id", "status");

-- CreateIndex
CREATE INDEX "ai_routine_run_routine_id_started_at_idx" ON "ai_routine_run"("routine_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ai_routine_run_input_card_id_idx" ON "ai_routine_run"("input_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_routine_run_step_run_id_position_key" ON "ai_routine_run_step"("run_id", "position");

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_routine_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_routine_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_routine_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine" ADD CONSTRAINT "ai_routine_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_step" ADD CONSTRAINT "ai_routine_step_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "ai_routine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_step" ADD CONSTRAINT "ai_routine_step_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_run" ADD CONSTRAINT "ai_routine_run_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_run" ADD CONSTRAINT "ai_routine_run_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "ai_routine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_run" ADD CONSTRAINT "ai_routine_run_input_card_id_fkey" FOREIGN KEY ("input_card_id") REFERENCES "card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_run" ADD CONSTRAINT "ai_routine_run_output_card_id_fkey" FOREIGN KEY ("output_card_id") REFERENCES "card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_run_step" ADD CONSTRAINT "ai_routine_run_step_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_routine_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
