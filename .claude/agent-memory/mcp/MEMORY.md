# Memória — mcp

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Alvo da escrita: banco `yubook_mcp` (5432), API na 3334, usuário `mcp@yu-book.test`, recriável
  por `db:seed`. Passo a passo em `apps/mcp/README.md`, § "O ambiente local de escrita".
- `apps/mcp` não tem script `test` (`apps/mcp/package.json:6-13`): `pnpm test` não o alcança, e os
  portões são `typecheck`, `build` e `verificar`. Prova de tool é à mão, por JSON-RPC.

## O que já nos mordeu

## Decisões em vigor

- Baseline de orçamento medido em 2026-08-26: `tools/list` = 3480 bytes com 5 tools (só leitura) e
  8713 bytes com 9 (Etapa 3). É cobrado em todo turno. Meça contra este número, não estime.
