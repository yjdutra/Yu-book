-- Índice do fallback de busca aproximada (RF-34).
--
-- O índice trigrama existente é sobre `title` cru; a busca por erro de
-- digitação compara sem acento, então precisa de um índice sobre a mesma
-- expressão — senão o fallback vira varredura sequencial e quebra o RNF-17.

CREATE INDEX note_title_trgm_unaccent_idx
  ON "note"
  USING GIN (lower(public.immutable_unaccent(title)) gin_trgm_ops);
