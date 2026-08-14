-- DropIndex
DROP INDEX "note_user_id_updated_at_idx";

-- AlterTable
ALTER TABLE "note" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "note_user_id_deleted_at_updated_at_idx" ON "note"("user_id", "deleted_at", "updated_at" DESC);

-- =====================================================================
-- Título único por usuário (RN-01)
--
-- `unaccent()` é STABLE, não IMMUTABLE, então não pode ir direto num índice.
-- O wrapper abaixo fixa o dicionário e declara imutabilidade — é o que
-- permite indexar `lower(sem_acento(title))`.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Parcial: só vale para notas ativas, então a lixeira pode guardar
-- uma nota com o mesmo título de outra que você recriou.
CREATE UNIQUE INDEX note_title_unico_idx
  ON "note" (user_id, lower(public.immutable_unaccent(title)))
  WHERE deleted_at IS NULL;

-- Mesma expressão usada para resolver [[titulo]] -> nota.
CREATE INDEX note_title_normalizado_idx
  ON "note" (user_id, lower(public.immutable_unaccent(title)));
