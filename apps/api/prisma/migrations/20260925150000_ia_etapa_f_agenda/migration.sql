-- Etapa F da frente de IA: agenda de rotina. Aditiva: as rotinas de antes
-- ficam desligadas e vazias pelos padrões, e as execuções de antes, manuais.
--
-- `pulada` entra em `AiRunStatus` sem uso nesta migration: valor novo de enum
-- não pode ser usado na mesma transação que o cria.
--
-- O único `(routine_id, scheduled_for)` é o que faz cada horário agendado
-- rodar no máximo uma vez com duas instâncias da API no ar (INV-60). As
-- execuções manuais têm `scheduled_for` nulo e ficam fora dele: no Postgres,
-- nulos não colidem num índice único.
--
-- Nada aqui toca em `ai_routine_run_uma_em_andamento_idx` (RN-19, migration
-- `20260924233000_ia_etapa_e_uma_execucao`), conferido no SQL gerado por
-- `prisma migrate diff`. Ele continua `WHERE status = 'em_andamento'`: a linha
-- `pulada` não conta nele, e a conversão dela em execução passa por ele.

-- CreateEnum
CREATE TYPE "AiRunTrigger" AS ENUM ('manual', 'agenda');

-- AlterEnum
ALTER TYPE "AiRunStatus" ADD VALUE 'pulada';

-- AlterTable
ALTER TABLE "ai_preference" ADD COLUMN     "runs_seen_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ai_routine" ADD COLUMN     "schedule_active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedule_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "schedule_times" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ai_routine_run" ADD COLUMN     "attempts" INTEGER,
ADD COLUMN     "scheduled_for" TIMESTAMP(3),
ADD COLUMN     "trigger" "AiRunTrigger" NOT NULL DEFAULT 'manual';

-- CreateIndex
CREATE UNIQUE INDEX "ai_routine_run_routine_id_scheduled_for_key" ON "ai_routine_run"("routine_id", "scheduled_for");

