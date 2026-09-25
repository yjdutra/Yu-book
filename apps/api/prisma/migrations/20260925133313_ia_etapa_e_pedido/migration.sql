-- Emenda da Etapa E: rotina que parte de um pedido (sem coluna de entrada) e
-- saída em card ou nota. Aditiva: as linhas existentes ficam `coluna`/`card`
-- pelos padrões, e as colunas que passam a aceitar nulo continuam preenchidas.
--
-- `fixo` entra em `AiOutputTitle` sem uso nesta migration: valor novo de enum
-- não pode ser usado na mesma transação que o cria.
--
-- Nada aqui toca em `ai_routine_run_uma_em_andamento_idx` (RN-19, migration
-- `20260924233000_ia_etapa_e_uma_execucao`): conferido no SQL gerado.

-- CreateEnum
CREATE TYPE "AiInputKind" AS ENUM ('coluna', 'pedido');

-- CreateEnum
CREATE TYPE "AiOutputKind" AS ENUM ('card', 'nota');

-- AlterEnum
ALTER TYPE "AiOutputTitle" ADD VALUE 'fixo';

-- AlterTable
ALTER TABLE "ai_routine" ADD COLUMN     "input_kind" "AiInputKind" NOT NULL DEFAULT 'coluna',
ADD COLUMN     "input_prompt" TEXT,
ADD COLUMN     "output_kind" "AiOutputKind" NOT NULL DEFAULT 'card',
ADD COLUMN     "output_title_text" TEXT,
ADD COLUMN     "output_workspace_id" UUID,
ALTER COLUMN "input_board_id" DROP NOT NULL,
ALTER COLUMN "input_column_id" DROP NOT NULL,
ALTER COLUMN "output_column_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ai_routine_run" ADD COLUMN     "input_kind" "AiInputKind" NOT NULL DEFAULT 'coluna',
ADD COLUMN     "output_note_id" UUID,
ALTER COLUMN "input_title" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ai_routine_run" ADD CONSTRAINT "ai_routine_run_output_note_id_fkey" FOREIGN KEY ("output_note_id") REFERENCES "note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
