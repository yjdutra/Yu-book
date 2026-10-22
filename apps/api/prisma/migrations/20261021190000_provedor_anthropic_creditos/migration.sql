-- Créditos mensais da Anthropic, informados à mão em /ajustes/claude
-- (docs/plano-provedor-anthropic.md, F4). Nulo = não informado; só informativo.

-- AlterTable
ALTER TABLE "ai_preference" ADD COLUMN     "anthropic_monthly_credit_micros" INTEGER;

