---
name: dominios-railway
description: Quais domínios públicos da Railway existem, qual é de qual serviço, e que o da web não está no repositório — yu-book.up.railway.app não é ele
metadata:
  type: reference
---

Os únicos domínios que aparecem no repositório (`grep -roP 'https://[a-z0-9.-]+\.up\.railway\.app'`):

- **API** — `https://yu-bookapi-production.up.railway.app`
- **MCP** — `https://yu-book-production.up.railway.app` (confirme pelo campo `transporte` do
  `/health`; é contraintuitivo que o nome mais curto seja o do MCP, não o da web)

**O domínio público da web não está em lugar nenhum do repositório.** Em 2026-09-23 tentei
`https://yu-book.up.railway.app`, que aparece como exemplo **comentado** em
`apps/api/.env.example` (`OPENROUTER_APP_URL`) — devolve
`{"status":"error","code":404,"message":"Application not found"}`, ou seja, não há serviço ali.
Aquele valor é ilustrativo, não o host real.

**How to apply:** não derive um host do outro nem reaproveite exemplo de `.env.example` como se
fosse endereço de produção. Se precisar do domínio da web, peça ao operador — é painel.

Isso importa porque, quando o diff da API está todo atrás de autenticação, o **bundle da web** é a
única superfície pública que carrega texto do diff (string de interface aparece literal no JS
servido) — e sem o domínio essa via fica fechada. Ver [[deploy-mcp-como-conferir]].
