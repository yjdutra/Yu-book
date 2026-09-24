-- RN-19 pela própria escrita: uma execução em andamento por conta.
--
-- A conferência em `iniciar` (`execucao.service.ts`) é `findFirst` + `create`, e
-- numa janela de deploy duas instâncias da API convivem: dois "Rodar agora"
-- passam juntos pela consulta, escolhem a mesma ideia e geram dois cards
-- (RN-18). Com este índice o segundo `create` é recusado pelo banco (P2002),
-- traduzido para o mesmo 409 `ROTINA_EM_ANDAMENTO`.
--
-- Parcial, por isso vive só aqui: o `schema.prisma` não declara índice com
-- `WHERE`, e o Prisma não o introspecta nem o derruba (conferido com
-- `prisma migrate diff` ao criar esta migration). Só a criação grava
-- `em_andamento` — toda outra escrita de status sai dele —, então nenhum
-- outro caminho esbarra aqui.
CREATE UNIQUE INDEX "ai_routine_run_uma_em_andamento_idx"
  ON "ai_routine_run" ("user_id")
  WHERE "status" = 'em_andamento';
