-- Frente de eventos recorrentes, R1: a regra de repetição semanal mora no
-- próprio `event`. Só aditiva — o banco de desenvolvimento guarda a conta real
-- do operador. Toda linha existente fica com `repeat_days` vazio: evento simples.

-- AlterTable
ALTER TABLE "event" ADD COLUMN     "exdates" DATE[] NOT NULL DEFAULT ARRAY[]::DATE[],
ADD COLUMN     "repeat_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "repeat_until" DATE;

-- A consulta das séries (`eventos.service.ts`, `seriesNoPeriodo`) não tem piso
-- em `starts_at`: uma série de janeiro ainda aparece em outubro. Sobre o índice
-- `(user_id, starts_at)` ela leria todo evento do passado da conta; este, só
-- as séries. O predicado é o mesmo que o Prisma emite para
-- `repeatDays: { isEmpty: false }` (`"repeat_days" <> '{}'`, conferido no log
-- de consultas e no EXPLAIN), para o planner poder usá-lo. O Prisma 6 não
-- representa índice parcial no schema, e `migrate diff` sai vazio com ele no
-- banco: ele vive só aqui. As colunas de lista com NOT NULL também não geram
-- deriva (conferido).
CREATE INDEX "event_serie_idx" ON "event"("user_id", "starts_at") WHERE "repeat_days" <> '{}';
