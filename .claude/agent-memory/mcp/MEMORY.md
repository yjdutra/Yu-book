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
  do fluxo. Espace as provas antes de caçar bug.
- `yubook_mcp` não recebe migration sozinho e fica para trás a cada uma nova: a API da 3334 falha
  por coluna inexistente. Rode o `db:deploy` de `apps/mcp/README.md:125-127` antes da prova à mão.

## Decisões em vigor

- Baseline sobre `dist/`: `tools/list` 3480 B com 5 tools, 9601 B com 10; `resources/list` 929,
  `resources/templates/list` 553, `prompts/list` 757 — os quatro reconfirmados em 2026-09-24, na
  Etapa D. Tudo cobrado em todo turno. Meça contra estes números, não estime.
- O texto que produz esses bytes mora em `packages/shared/src/ferramentas.ts`: a baseline se move
  por edição **fora** de `apps/mcp`, e nenhum portão acusa (§4.6 de `contrato-compartilhado`).
- Sob HTTP a sessão vê cinco ou dez tools conforme o escopo do token.
- Como medir: `initialize`/`initialized`/`*/list` por `printf` no stdin de
  `node --env-file=.env dist/index.js`, e `Buffer.byteLength(JSON.stringify(linha))` na resposta
  inteira (envelope JSON-RPC incluído) — não só no `result`.
