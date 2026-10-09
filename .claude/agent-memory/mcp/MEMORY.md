# Memória — mcp

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Alvo da escrita em stdio: banco `yubook_mcp` (5432), API na 3334, usuário `mcp@yu-book.test`,
  recriável por `db:seed`. Passo a passo em `apps/mcp/README.md`, § "O ambiente local de escrita".
- Portões do pacote: `typecheck` (sobre `tsconfig.test.json`, cobre `src/` e `tests/`), `test`,
  `build` e `verificar`. Prova de tool continua à mão, por JSON-RPC.

## O que já nos mordeu

- Limite de login da API — 10 por 5 min por IP (`apps/api/src/modules/auth/auth.routes.ts:58`):
  provas de OAuth em sequência o esgotam, e o sintoma (`invalid_grant`, `Invalid URL`) parece defeito
  do fluxo.
- `yubook_mcp` não recebe migration sozinho e fica para trás a cada uma nova: a API da 3334 falha
  por coluna inexistente. Rode o `db:deploy` de `apps/mcp/README.md:125-128` antes da prova à mão.
- `refine` não vai ao JSON Schema publicado: o formato do dia chega ao modelo só pela `describe`
  (`novoDiaCivilSchema`, `packages/shared/src/eventos.ts:90-91`).

## Decisões em vigor

- Baseline sobre `dist/` (2026-10-09, eventos recorrentes, conferida pelo curador): `tools/list`
  15069 com 15 tools e 4275 só leitura (6); `resources/list` 929, `resources/templates/list` 553,
  `prompts/list` 766.
  Cobrados em todo turno; meça contra eles, não estime.
- O texto que produz esses bytes mora em `packages/shared/src/ferramentas.ts`: a baseline se move
  por edição **fora** de `apps/mcp`, e nenhum portão acusa (§4.6 de `contrato-compartilhado`).
- Como medir: `initialize`/`initialized`/`*/list` por `printf` no stdin de
  `node --env-file=.env dist/index.js`, e `Buffer.byteLength(JSON.stringify(linha))` na resposta
  inteira (envelope incluído). Só leitura: `YUBOOK_API_URL=http://api.exemplo.invalid` exportada
  antes — `--env-file` não sobrescreve variável do ambiente.
