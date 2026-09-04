# Como verificar o servidor MCP

Referência da skill `servidor-mcp-yu-book` (§15). Abra na hora de **provar** que algo funciona;
para decidir *como escrever*, o que vale é o corpo da skill.

O inspetor oficial serve para explorar. Para **provar**, fale JSON-RPC direto no stdin — é o que
permite medir bytes, comparar saídas e validar invariantes:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}' \
  '{"jsonrpc":"2.0","id":4,"method":"prompts/list","params":{}}' \
| node --env-file=apps/mcp/.env apps/mcp/dist/index.js
```

Sempre confira que **toda linha do stdout é JSON válido** — é a invariante do transporte.

```bash
pnpm --filter @yu-book/shared build    # se o contrato mudou
pnpm --filter @yu-book/mcp typecheck   # roda sobre tsconfig.test.json: cobre src/ e tests/
pnpm --filter @yu-book/mcp test        # quarto portão; não precisa de banco nem de API no ar
pnpm --filter @yu-book/mcp build
pnpm --filter @yu-book/mcp verificar   # confirma ambiente, escrita, login e volume
```

**O que a suíte cobre e o que não cobre.** Ela prova identidade, envelopes e provedor OAuth
(INV-41 a INV-44) e, pelo arnês em memória de `tests/arnes.ts`, **fala JSON-RPC**: `escrita.test.ts`
confere quem é anunciado no `tools/list` e que toda tool de escrita recusa um token sem
`yubook:write` (INV-45). O que ela **não** vê é o texto que as tools imprimem — o `fetch` é
substituído —, então INV-40 e a formatação continuam só à mão, e nada abaixo desta linha é
substituído por ela.

### Escrita: verifique contra o ambiente local, nunca contra o seu acervo

A escrita tem alvo próprio — banco `yubook_mcp`, API na 3334, acervo recriável por
`pnpm --filter @yu-book/api db:seed`. O passo a passo está em `apps/mcp/README.md` (§"O ambiente
local de escrita"). Não exercite `trash_note` contra o banco de desenvolvimento.

O seed escreve **pelos services**, não pelo Prisma cru: é o que faz `note_link` existir (INV-17) e
as posições nascerem contíguas (INV-11). Um seed com `prisma.note.create` produz um banco que
parece certo e mente sobre o grafo — e aí a verificação valida contra uma ficção.

### As duas provas que separam implementado de vazando ruído

1. **Progresso sem token não sai.** Chame a tool **sem** `_meta.progressToken` e confirme que
   nenhum `notifications/progress` aparece no stdout. A contraprova é o ponto: emitir sempre é
   ruído, e só se percebe procurando a ausência.
2. **Com token, sai — e o total bate.** Repita mandando `"_meta":{"progressToken":1}` nos `params`
   da chamada, e confira que a contagem chega ao `total` declarado no `relatar(...)`.

```bash
# depois de initialize + notifications/initialized, na mesma sessão:
'{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"restore_note",
  "arguments":{"noteId":"<uuid>"},"_meta":{"progressToken":1}}}'
```

Se as tools de escrita **não aparecem** no `tools/list`, confira qual trava está agindo antes de
procurar bug — são duas, e a de cada transporte é diferente (§9). Em **stdio**, é `YUBOOK_API_URL`
contra host não-local. Em **http**, é o escopo do token de quem chamou ou `MCP_ESCRITA_HABILITADA=0`
— e a trava por host local não participa. Nos dois casos o motivo está no stderr do boot.

### O fluxo HTTP, à mão

O transporte http exige `MCP_TRANSPORTE=http`, `MCP_SEGREDO` e `MCP_URL_PUBLICA`, e **recusa subir**
se `YUBOOK_EMAIL` estiver no ambiente. Comece pela descoberta, que é por onde o cliente MCP começa:

```bash
curl -s localhost:3335/.well-known/oauth-protected-resource/mcp | jq
curl -s -i localhost:3335/mcp -X POST -H 'Content-Type: application/json' -d '{}'   # 401 + WWW-Authenticate
curl -s localhost:3335/health | jq   # `sessoes` prova que o mapa esvazia (INV-44)
```

Uma prova de sessão vale mais que a inspeção do mapa: abra uma sessão, mate o cliente sem `DELETE`,
e confirme pelo `/health` que a varredura a recolhe — o `onclose` sozinho **não** recolhe.

O passo a passo completo do fluxo OAuth está em `apps/mcp/README.md`. Rodar o arsenal de provas em
sequência esbarra no limite de login da `apps/api`; o sintoma está na memória do agente `mcp`.
