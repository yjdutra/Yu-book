---
name: deploy-mcp-como-conferir
description: Na Railway o /health responde ok durante todo o rebuild, na API e no MCP — ele nunca distingue build velho de novo, e por isso não prova que a migration aplicou
metadata:
  type: feedback
---

A Railway **mantém o deployment anterior servindo** até o novo passar no healthcheck. Logo, depois
de um push, `/health` volta idêntico o rebuild inteiro — e volta idêntico **também quando o build
novo falha e nunca sobe**. Vale para os dois serviços; não é particularidade do MCP.

**Why:** em 2026-09-04, no fix do `form-action`, o `/health` do MCP respondeu `ok` nas três
amostragens, inclusive nas duas em que a produção ainda servia a política antiga. Só o cabeçalho
`content-security-policy` do `/authorize` distinguiu velho de novo. Rebuild levou ~2 minutos.

**A consequência que morde na API: `/health` verde NÃO prova que a migration aplicou.** O raciocínio
"o `start` roda `prisma migrate deploy` antes do `node`, então a API responder prova que aplicou"
tem um buraco — se a migration falha, o container novo não sobe, o healthcheck não passa, e **o
antigo continua respondendo `ok`**. Sucesso e falha de migration têm a mesma assinatura externa.
Em 2026-09-23 (`20260923142258_politica_de_dados`) amostrei 30 vezes em 10 minutos, tudo verde, e
mesmo assim não pude concluir que a migration rodou.

**How to apply:**

- A asserção que vale é um **comportamento observável introduzido pelo diff daquele push**, nunca
  o `/health`. Amostre em laço até esse comportamento aparecer; não conclua pelo tempo decorrido.
- Se todo o diff está atrás de autenticação, **diga que não dá para provar de fora** e passe ao
  operador: status do deployment e log de boot no painel. Não busque credencial no `.env` para
  autenticar contra produção — é decisão dele.
- No MCP, confirme que é ele pelo campo `transporte` do `/health`
  (`{"status":"ok","transporte":"http","sessoes":N}`, `apps/mcp/src/http.ts:219-220`). `transporte`
  diferente de `http` significa `MCP_TRANSPORTE=http` fora do `startCommand`.
- Para exercitar a página de autorização sem navegador: `POST /register` com `redirect_uris` → pegue
  o `client_id` → `GET /authorize?client_id=…&response_type=code&redirect_uri=…&
  code_challenge=<43 chars>&code_challenge_method=S256` e leia os cabeçalhos com `curl -sD -`.

**Portão verde não cobre navegador.** CSP, `form-action` e afins não passam por `fetch`, e este
repositório não tem prova de interface. Quando o diff mexe em cabeçalho ou em fluxo que só um
navegador executa, a conferência pós-deploy é a primeira prova real.

Ver [[dominios-railway]] para saber qual host é qual.
