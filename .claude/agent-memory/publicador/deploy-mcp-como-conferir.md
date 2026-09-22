---
name: deploy-mcp-como-conferir
description: O /health do MCP hospedado responde ok durante todo o rebuild — a prova de que o deploy novo subiu tem que ser um comportamento do próprio diff
metadata:
  type: feedback
---

Depois de um push que reconstrói o serviço MCP, **`/health` não prova nada**: a Railway mantém o
container antigo servindo até o novo passar no healthcheck, então
`{"status":"ok","transporte":"http","sessoes":N}` (`apps/mcp/src/http.ts:219-220`) volta idêntico o
rebuild inteiro. A asserção que
vale é algum comportamento observável introduzido pelo diff daquele push.

**Why:** em 2026-09-04, no fix do `form-action`, o `/health` respondeu `ok` nas três amostragens,
inclusive nas duas em que a produção ainda devolvia a política antiga. Só o cabeçalho
`content-security-policy` do `/authorize` distinguiu o deploy velho do novo. Rebuild levou
**~2 minutos** entre o push e a resposta nova (amostrando de 30 em 30 segundos).

**How to apply:**

- Domínio público do MCP: `https://yu-book-production.up.railway.app` (o da API é
  `yu-bookapi-production`, outro host — não derive um do outro). Confirme que é o MCP pelo campo
  `transporte` do `/health`.
- Para exercitar a página de autorização sem navegador: `POST /register` com
  `redirect_uris` → pegue o `client_id` → `GET /authorize?client_id=…&response_type=code&
  redirect_uri=…&code_challenge=<43 chars>&code_challenge_method=S256` e leia os cabeçalhos com
  `curl -sD -`.
- Amostre em laço até o comportamento novo aparecer; não conclua "subiu" pelo tempo decorrido.

**Portão verde não cobre navegador.** CSP, `form-action` e afins não passam por `fetch`, e este
repositório não tem prova de interface. Quando o diff mexe em cabeçalho ou em fluxo que só um
navegador executa, a conferência pós-deploy é a primeira prova real — trate-a como parte do deploy,
não como formalidade.
