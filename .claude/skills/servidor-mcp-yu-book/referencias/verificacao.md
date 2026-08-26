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
pnpm --filter @yu-book/mcp typecheck
pnpm --filter @yu-book/mcp build
pnpm --filter @yu-book/mcp verificar   # confirma ambiente, escrita, login e volume
```

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

Se as tools de escrita **não aparecem** no `tools/list`, confira `YUBOOK_API_URL` antes de procurar
bug: contra host não-local elas não são registradas (§9), e o motivo está no stderr do boot.
