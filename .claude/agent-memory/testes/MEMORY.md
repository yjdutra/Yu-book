# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- Arnês JSON-RPC do MCP: `apps/mcp/tests/arnes.ts`.
- Dublê SSE do provedor: `apps/api/tests/provedor.ts`; turno `segura` (`:71`) para agir no meio.
- Dublê S3: `apps/api/tests/armazem.ts`; recusa por `falhar.PUT`/`DELETE` (`:39`).

## O que já nos mordeu

- `reconciliarExecucoes()` fecha órfã de qualquer conta: asserir `>= 1` (`rotinas.test.ts:1019`).
- O dublê repete o último turno (`provedor.ts:200-201`): depois de um `segura`, troque o roteiro.
- O SDK MCP valida argumentos antes do handler: `argumentosMinimos` (`escrita.test.ts:65`).
- `chamar` faz `JSON.parse` (`apoio.ts:63`): não-JSON por `app.inject` (`agentes.test.ts:1135`);
  SSE no meio, `listen({ port: 0 })` + `fetch` (`rotinas.test.ts:56`).
- 300/min por IP (`apps/api/src/app.ts:54`); anexo, 20/min: `proximoIp` (`arquivos.test.ts:75`).
- Board tem nome único por workspace: sufixo aleatório (`arquivos.test.ts:167-168`).
- Chave real do `.env` vai ao dublê (`setup.ts:23`): asserir booleano (`openrouter-painel.test.ts:605`).
- Desempate por texto segue a collation: códigos que difiram no 1º caractere (`uso-ia.test.ts:394`).

## Decisões em vigor

- Lista à mão herda o furo: derive-a e pague com a asserção inversa (`escrita.test.ts:109`).
- Dublê de resposta tipado por `shared`, marca e card (`apps/mcp/tests/marca.test.ts:34`, `:113`).
- Corrida sem tempo: `vi.spyOn(...).mockImplementationOnce` no meio (`agentes.test.ts:1024`).
- Executor com a guarda de produção: `vi.mock` + `vi.hoisted` (`web.test.ts:68-80`).
- Dublê S3 cai só no último `describe` (`arquivos.test.ts:940-952`); `fecharArmazem` idempotente.
- "Hoje" sem relógio falso: Pago_Pago e Kiritimati nunca no mesmo dia (`tarefas.test.ts:370-381`).
- "Não reconverte instante" só se prova com dia inteiro e fuso trocado (`eventos.test.ts:519`).
