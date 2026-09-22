# Memória — mcp

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Alvo da escrita em stdio: banco `yubook_mcp` (5432), API na 3334, usuário `mcp@yu-book.test`,
  recriável por `db:seed`. Passo a passo em `apps/mcp/README.md`, § "O ambiente local de escrita".
- Portões do pacote: `typecheck` (sobre `tsconfig.test.json`, cobre `src/` e `tests/`), `test`
  (vitest, `apps/mcp/tests/`), `build` e `verificar`. Prova de tool continua à mão, por JSON-RPC.

## O que já nos mordeu

- Limite de login da API — 10 por 5 min por IP (`apps/api/src/modules/auth/auth.routes.ts:58`) —
  esgota rápido com provas de OAuth em sequência. O sintoma engana: `invalid_grant` ou `Invalid URL`
  no script, que parecem defeito do fluxo. Espace as provas antes de caçar bug.

## Decisões em vigor

- Baseline de orçamento medido em 2026-09-22, sobre `dist/`: `tools/list` = 3480 B com 5 tools (só
  leitura) e 8551 B com 9; `resources/list` 929, `resources/templates/list` 553, `prompts/list` 757.
  Tudo cobrado em todo turno. Meça contra estes números, não estime.
- Sob HTTP a sessão vê cinco ou nove tools conforme o escopo do token: os números dependem de
  quem chamou.
- Como medir: as mensagens `initialize`/`initialized`/`*/list` por `printf` no stdin de
  `node --env-file=.env dist/index.js`, e `Buffer.byteLength(JSON.stringify(linha))` na resposta
  inteira (envelope JSON-RPC incluído) — não só no `result`.
