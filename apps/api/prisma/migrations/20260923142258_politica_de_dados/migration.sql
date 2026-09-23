-- AlterTable
--
-- Em dois passos de propósito. Uma coluna obrigatória sem padrão falha se a
-- tabela já tiver linha, e `prisma migrate deploy` roda no **boot de produção**:
-- a falha não apareceria num pipeline, derrubaria o serviço. Acrescentar com
-- padrão preenche as linhas existentes; tirar o padrão em seguida deixa o banco
-- igual ao `schema.prisma`, onde a coluna não tem `@default` — o valor padrão
-- mora em `packages/shared`, e duas fontes divergiriam em silêncio.
ALTER TABLE "ai_preference" ADD COLUMN "allow_training" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_preference" ALTER COLUMN "allow_training" DROP DEFAULT;
