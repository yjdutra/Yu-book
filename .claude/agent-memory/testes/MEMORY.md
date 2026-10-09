# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- Dublê SSE: `apps/api/tests/provedor.ts`; turno `segura` (`:71`) para agir no meio.
- Dublê S3: `tests/armazem.ts`; porta fixa (`:18`), `EADDRINUSE` pula o arquivo; recusa em `:39`.

## O que já nos mordeu

- `reconciliarExecucoes()` fecha órfã de toda conta: asserir `>= 1` (`rotinas.test.ts:1034`).
- O dublê repete o último turno (`provedor.ts:200-201`): após `segura`, troque o roteiro.
- SDK MCP valida antes do handler: `argumentosMinimos` (`escrita.test.ts:71`).
- `chamar` faz `JSON.parse` (`apoio.ts:63`): não-JSON por `app.inject` (`agentes.test.ts:1135`).
- 300/min por IP (`app.ts:54`): 429 no fim do arquivo; `proximoIp` (`rotinas.test.ts:87`).
- Board tem nome único: sufixo aleatório (`arquivos.test.ts:167-168`).
- Chave do `.env` vai ao dublê (`setup.ts:23`): asserir booleano (`openrouter-painel.test.ts:605`).
- Desempate por texto segue a collation: difira no 1º caractere (`uso-ia.test.ts:394`).
- `GET /agenda` traz a conta inteira: teste que a lê usa conta própria.
- Não negue nome de dia na agenda: "hoje é <dia>" segue o relógio (`formato.ts:645`).
- 422 do Zod: "Dados inválidos" + frase em `issues` (`app.ts:63`); do service, na mensagem.

## Decisões em vigor

- Derive, não liste (`escrita.test.ts:117`), salvo se a lista é a prova (`marca-ia.test.ts:490`).
- Dublê de resposta tipado por `shared` (`apps/mcp/tests/marca.test.ts:34`).
- Corrida sem tempo: espião que segura as leituras (`eventos-recorrentes.test.ts:1043`).
- Guarda de produção no executor: `vi.mock` + `vi.hoisted` (`web.test.ts:68-80`).
- Dublê S3 cai só no último `describe` (`arquivos.test.ts:940-952`).
- "Hoje" sem relógio falso: Pago_Pago e Kiritimati (`tarefas.test.ts:370-381`).
- Relógio real: `toContain` em `[f(antes), f(depois)]` (`agenda-chat.test.ts:618`).
- "Não reconverte" só se prova com dia inteiro e fuso trocado (`eventos.test.ts:519`).
