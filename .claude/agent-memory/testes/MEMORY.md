# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- Arnês JSON-RPC do MCP: `apps/mcp/tests/arnes.ts` — o `Client` do SDK não manda `authInfo`.
- Dublê SSE do provedor: `apps/api/tests/provedor.ts`; turno `segura` (`:71`) para agir no meio.

## O que já nos mordeu

- Suíte da API no `yubook` real: duas rodadas se derrubam (`limpar()`, `apoio.ts:26`; porta 39333).
- `reconciliarExecucoes()` fecha órfã de qualquer conta: asserir `>= 1` (`rotinas.test.ts:985`).
- O dublê repete o último turno (`provedor.ts:200-201`): depois de um `segura`, troque o roteiro.
- O SDK MCP valida argumentos antes do handler: `argumentosMinimos` (`escrita.test.ts:65`).
- `chamar` faz `JSON.parse` (`apoio.ts:63`): corpo não-JSON por `app.inject`
  (`agentes.test.ts:1088`); SSE no meio pede `listen({ port: 0 })` + `fetch` (`rotinas.test.ts:55`).
- 300/min por IP (`apps/api/src/app.ts:47`): releitura em laço usa `proximoIp` (`rotinas.test.ts:80`).
- Potência de 2 cai na fronteira do pedaço do gunzip; só se o alvo for ela (`web.test.ts:519`).
- `lerHtml` decodifica entidade **depois** de tirar tag (`pagina.service.ts:331`).
- Chave real do `.env` vai ao dublê (`setup.ts:23`): asserir como booleano, ou a falha a imprime
  (`openrouter-painel.test.ts:571-575`).

## Decisões em vigor

- Lista à mão herda o furo: derive-a e pague com a asserção inversa (`escrita.test.ts:109`).
- Dublê de resposta tipado pelo tipo de `shared` (`apps/mcp/tests/marca.test.ts:29-43`).
- Corrida sem tempo: `vi.spyOn(...).mockImplementationOnce` no meio (`agentes.test.ts:977`).
- Assíncrono: `esperar` (`rotinas.test.ts:229`) até a condição, nunca `sleep` fixo.
- Relógio fixo com dublê HTTP: `toFake: ["Date"]` (`openrouter-painel.test.ts:213-216`).
- Executor com a guarda de produção: `vi.mock` + `vi.hoisted` no service (`web.test.ts:68-80`).
- "Comportamento inalterado": rode a nova e uma cópia da do HEAD nas mesmas entradas, e compare.
