# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Existem **duas** suítes vitest desde 2026-09-01: `apps/api/tests/` (integração, exige Postgres) e
  `apps/mcp/tests/` (unitária, não exige nada no ar). Seu escopo declarado ainda é só a primeira.

## O que já nos mordeu

- `beforeEach(() => mock.mockReset())` sem chaves devolve o próprio mock, e o Vitest trata retorno
  de `beforeEach` como função de limpeza: ele chama o mock depois de cada teste. Custou três testes
  em `apps/mcp/tests/provedor.test.ts:220` — a rejeição sem dono aparece como falha de **outro**
  teste, então o teste que falha não é o teste quebrado.

## Decisões em vigor
