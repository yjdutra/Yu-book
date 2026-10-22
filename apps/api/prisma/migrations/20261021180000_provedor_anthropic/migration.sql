-- A Anthropic como segundo provedor de IA (docs/plano-provedor-anthropic.md, F1).
-- O padrão `openrouter` deixa certo, sem backfill, tudo o que foi gravado antes:
-- até aqui só existia esse provedor. O valor é usado como padrão na mesma
-- migration que cria o tipo, o que o Postgres aceita — a restrição é do
-- `ALTER TYPE ... ADD VALUE`, não de um `CREATE TYPE` novo.

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('openrouter', 'anthropic');

-- AlterTable
ALTER TABLE "ai_model_favorite" ADD COLUMN     "provider" "AiProvider" NOT NULL DEFAULT 'openrouter';

-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provider" "AiProvider" NOT NULL DEFAULT 'openrouter';

-- CreateIndex
CREATE INDEX "ai_usage_user_id_provider_local_day_idx" ON "ai_usage"("user_id", "provider", "local_day");
