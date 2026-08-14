-- CreateIndex
-- RF-38: "Em cards" no rodapé da nota. Sem isto, listar os cards de uma nota
-- é varredura sequencial em `card` (RNF-12).
CREATE INDEX "card_note_id_idx" ON "card"("note_id");

-- CreateIndex
-- Duas colunas "Feito" no mesmo board é erro de digitação, não intenção (S-05).
CREATE UNIQUE INDEX "board_column_board_id_name_key" ON "board_column"("board_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "board_workspace_id_name_key" ON "board"("workspace_id", "name");

-- =====================================================================
-- Busca de card na paleta (RF-42)
--
-- Mesma estratégia da busca aproximada de nota: a comparação é feita sem
-- acento dos dois lados, então o índice precisa ser sobre a mesma expressão.
-- Um índice sobre `title` cru não serviria — o planner não o usaria.
--
-- Card não tem `tsvector`: o volume é baixo (S-08, ~500 cards) e o texto é
-- curto. Trigrama no título resolve, e evita mais um trigger no banco.
-- =====================================================================

CREATE INDEX card_title_trgm_unaccent_idx
  ON "card"
  USING GIN (lower(public.immutable_unaccent(title)) gin_trgm_ops);
