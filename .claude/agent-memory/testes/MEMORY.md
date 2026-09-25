# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Duas suítes vitest: `apps/api/tests/` (integração, Postgres) e `apps/mcp/tests/` (nada no ar).
- Arnês JSON-RPC do MCP: `apps/mcp/tests/arnes.ts` — sem o `Client` do SDK, que não manda
  `authInfo` por mensagem.
- Dublê SSE do provedor: `apps/api/tests/provedor.ts`; turno `segura` (`:47`) para o fluxo no meio.

## O que já nos mordeu

- A suíte da API roda no banco `yubook` de dev, com a conta real; duas rodadas se derrubam pelo
  `limpar()` (`apps/api/tests/apoio.ts:26`) e a porta 39333 do dublê.
- `reconciliarExecucoes()` não filtra usuário — fecha órfã de qualquer conta: asserir `>= 1`
  (`rotinas.test.ts:985`).
- O SDK MCP valida argumentos **antes** do handler: `argumentosMinimos` deriva do `inputSchema`
  (`apps/mcp/tests/escrita.test.ts:65`).
- `chamar` faz `JSON.parse` (`apoio.ts:63`): corpo não-JSON vai por `app.inject` direto
  (`agentes.test.ts:1088`). `inject` entrega a resposta inteira: SSE no meio exige
  `app.listen({ port: 0 })` + `fetch` (`rotinas.test.ts:55`, `:1082`).
- Releitura em laço no mesmo IP estoura o limite global de 300/min (`apps/api/src/app.ts:47`), e o
  429 cai no teste seguinte: um IP por leitura (`proximoIp`, `rotinas.test.ts:218-229`).

## Decisões em vigor

- Lista que o teste enumera à mão herda o furo que fecha: derive-a, e pague a cegueira da derivação
  com a asserção inversa (`escrita.test.ts:109`).
- Dublê de resposta da API tipado pelo tipo de `shared` (`AiMark`), nunca literal solto
  (`apps/mcp/tests/marca.test.ts:29-43`).
- Corrida sem tempo: `vi.spyOn(...).mockImplementationOnce` que age no meio (`agentes.test.ts:977`).
- Execução assíncrona: releia `GET /ai/runs/:runId` até a condição (`esperar`, `rotinas.test.ts:229`),
  nunca `sleep` fixo.
