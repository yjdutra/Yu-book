# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Duas suítes vitest: `apps/api/tests/` (integração, Postgres) e `apps/mcp/tests/` (nada no ar).
- Arnês JSON-RPC do MCP: `apps/mcp/tests/arnes.ts` — sem o `Client` do SDK, que não manda
  `authInfo` por mensagem; é o fio para testar autorização por chamada.
- Dublê SSE do provedor: `apps/api/tests/provedor.ts`, de `chat.test.ts` e `agentes.test.ts`.

## O que já nos mordeu

- Duas rodadas da suíte da API no mesmo Postgres se derrubam: o `limpar()` de uma apaga os usuários
  da outra (`apps/api/tests/apoio.ts:26`); antes de caçar falha intermitente, pergunte quem roda o portão.
- Irmã: `EADDRINUSE` em 127.0.0.1:39333 após rodada interrompida (`docs/historico.md`, 2026-09-23).
- O SDK MCP valida argumentos **antes** do handler: chamar com `{}` prova a coisa errada.
  `argumentosMinimos` deriva do `inputSchema` (`apps/mcp/tests/escrita.test.ts:65`).
- `chamar` faz `JSON.parse` do corpo (`apoio.ts:63`): rota que não devolve JSON, como o export
  do agente, vai por `app.inject` direto (`agentes.test.ts:1088`).

## Decisões em vigor

- Lista que o teste enumera à mão herda o furo que fecha: derive-a. Lista derivada por diferença
  cega o que vaza dos dois lados — pague com a asserção inversa (`escrita.test.ts:109`).
- Dublê de resposta da API tipado pelo tipo de `shared` (`AiMark`), nunca literal solto: campo
  novo quebra o typecheck (`apps/mcp/tests/marca.test.ts:29-41`).
- Corrida sem depender de tempo: `vi.spyOn(...).mockImplementationOnce` que chama o original e
  age no meio (`apps/api/tests/agentes.test.ts:977`).
