# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Suítes vitest: `apps/api/tests/` (Postgres) e `apps/mcp/tests/` (nada no ar).
- Arnês JSON-RPC do MCP: `apps/mcp/tests/arnes.ts` — o `Client` do SDK não manda `authInfo`.
- Dublê SSE do provedor: `apps/api/tests/provedor.ts`; turno `segura` (`:47`) para agir no meio.

## O que já nos mordeu

- A suíte da API roda no `yubook` real; duas rodadas se derrubam pelo `limpar()`
  (`apps/api/tests/apoio.ts:26`) e pela porta 39333 do dublê.
- `reconciliarExecucoes()` fecha órfã de qualquer conta: asserir `>= 1` (`rotinas.test.ts:985`).
- O dublê repete o último turno (`provedor.ts:148-149`): depois de um `segura`, troque o roteiro.
- O SDK MCP valida argumentos antes do handler: `argumentosMinimos`
  (`apps/mcp/tests/escrita.test.ts:65`).
- `chamar` faz `JSON.parse` (`apoio.ts:63`): corpo não-JSON por `app.inject`
  (`agentes.test.ts:1088`); SSE no meio pede `listen({ port: 0 })` + `fetch` (`rotinas.test.ts:55`).
- Limite de 300/min por IP (`apps/api/src/app.ts:47`): releitura em laço usa `proximoIp`
  (`rotinas.test.ts:218-229`).

## Decisões em vigor

- Lista enumerada à mão herda o furo: derive-a e pague com a asserção inversa
  (`escrita.test.ts:109`).
- Dublê de resposta tipado pelo tipo de `shared` (`apps/mcp/tests/marca.test.ts:29-43`).
- Corrida sem tempo: `vi.spyOn(...).mockImplementationOnce` no meio (`agentes.test.ts:977`).
- Execução assíncrona: `esperar` (`rotinas.test.ts:229`) até a condição, nunca `sleep` fixo.
- Refatoração "comportamento inalterado": rode a função nova e uma cópia da do HEAD sobre a mesma
  varredura de entradas, e compare.
