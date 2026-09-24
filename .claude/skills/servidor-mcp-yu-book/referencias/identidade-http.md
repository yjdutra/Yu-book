# Identidade e transporte HTTP

Referência da skill `servidor-mcp-yu-book` (§0). Abra ao tocar em `src/auth/` ou `src/http.ts`.
Para decidir **se** algo deve existir, o que vale é o corpo da skill; aqui está **como** o que
existe funciona. As garantias que não podem quebrar estão em INV-41 a INV-44 e em INV-46.

## O fio inteiro da identidade

Do consentimento no navegador até o `Authorization` da chamada à `apps/api`:

1. O cliente MCP acha `/.well-known/*` — `mcpAuthRouter` monta na raiz, e é ali que ele procura.
2. Registro dinâmico devolve um `client_id` que **é** o envelope cifrado do cliente.
3. `/authorize` sela um envelope `pedido` (10 min) e manda para a página de login própria.
4. Login contra a `apps/api` (`sessao-api.ts`), consentimento, e o `code` volta como envelope
   `codigo` (60 s, uso único por `jti`).
5. `/token` troca o código pelos dois tokens (`emitirTokens`). O de acesso é JWT assinado; o de
   refresh é envelope `refresh`.
6. `requireBearerAuth` → `verifyAccessToken` decifra o `atk` e devolve `extra.tokenDaApi`.
7. `erros.ts` põe esse token no `AsyncLocalStorage`; `cliente.ts` o lê e monta o `Bearer`.

## Nenhum estado durável, por decisão

O pacote é cliente da API e não do Postgres — é a decisão fundadora, e é o que faz ele herdar o
escopo por `userId` em vez de reimplementá-lo. Mas o fluxo OAuth tem estado. A saída foi trocar
**armazenamento por criptografia**: cliente registrado, código e refresh viajam cifrados dentro do
próprio identificador (`segredos.ts`), com `aes-256-gcm` e chave derivada do `MCP_SEGREDO`.

Consequências que se aceitam de olhos abertos:

- **Quem tiver o `MCP_SEGREDO` lê e forja tudo.** Mesma postura do `JWT_SECRET` da API, e o mesmo
  motivo de o boot recusar segredo curto.
- **Redeploy não expulsa ninguém**, porque nada precisava estar em disco.
- **Revogar mata o refresh na hora, mas o token de acesso já emitido vale até expirar** — no máximo
  840 s, pelo compasso. Cobrir esses catorze minutos exigiria trazer estado de volta.

Os cinco tipos de envelope são `cliente`, `pedido`, `codigo`, `refresh` e `credencial`. **O rótulo
é obrigatório nas duas pontas** — ver INV-41 antes de acrescentar um sexto.

O único estado em memória é o mínimo que não dá para cifrar: `codigosUsados` (uso único do código),
a janela de idempotência de renovação por `jti`, e o mapa de sessões do `http.ts`.

## A janela de idempotência, e por que ela existe fora daqui

A `apps/api` detecta reuso de refresh token e, fora da janela de graça, **revoga todas as sessões
do usuário** — inclusive a do navegador dele (INV-06). O servidor MCP não é navegador e não
retenta sozinho: quem retenta é o cliente MCP, contra o `/token` daqui.

Duas defesas em camadas, e as duas precisam existir:

- **Deste lado**, a janela de idempotência de `provedor.ts`, chaveada pelo `jti` do refresh: duas
  trocas do mesmo refresh compartilham a mesma promessa em vez de baterem duas vezes na API.
  Chamar `renovarNaApi` por fora dela é reabrir o buraco.
- **Do lado da API**, `GRACA_DE_REUSO_MS = 30_000`, para a resposta perdida no caminho não derrubar
  o operador de todo lugar.

**As duas somadas não fecham o caso, e isso está declarado em `sessao-api.ts`.** A janela daqui dura
120 s e a graça da API, 30 s. O cliente que guardou um refresh anterior e o reapresenta muito depois
— reinício, laptop fechado, retentativa no dia seguinte — cai fora das duas e **derrubaria todas as
sessões do usuário**. Fechar isso exigiria estado no servidor, que é exatamente o que este desenho
não tem. Não "conserte" alargando um dos dois números sem reler o custo de INV-06.

Limite conhecido do logout: a API revoga por `where: { tokenHash }`, então um cookie de rotações
atrás responde sem revogar nada (`count = 0`, sem erro). Consertar exige uma coluna `replacedById`
no schema da API.

## Sessão: o que o SDK não faz por você

`sessionIdGenerator` definido mantém o SSE aberto, e com ele o log e o progresso das tools
de escrita — a única trilha de auditoria que chega ao usuário. O preço está declarado no
`http.ts`: **com duas instâncias isto quebra**, porque o POST da chamada e o GET do SSE podem cair
em máquinas diferentes. Uma instância, sempre.

O que o SDK **não** faz, e por isso INV-44 existe: `close()` do transporte só é chamado no caminho
do `DELETE`. Cliente que cai de rede deixa a sessão viva para sempre.

Ordem dos middlewares no `criarAplicacaoHttp`, que já mordeu: `/health` vem **antes** da validação
de host, porque o healthcheck da Railway chega com um `Host` que não é o domínio público — validar
antes dele daria 403, e a política `ON_FAILURE` entraria em laço de reinício. Parece falha do app
e é da ordem dos middlewares.

`MCP_URL_PUBLICA` **nunca** se deriva do header `Host`: um atacante manda `Host: evil.com` e o
servidor anuncia o `token_endpoint` dele no metadata de descoberta.

## Como provar

`pnpm --filter @yu-book/mcp test` — não precisa de banco nem de API no ar; `tests/setup.ts` planta
o ambiente **antes** de qualquer import, porque `env.ts` valida na importação e chama
`process.exit(1)`, o que dentro do Vitest mata o worker com uma saída que não parece falha de teste.

Para exercitar o fluxo inteiro à mão é preciso a `apps/api` no ar, e aí vale a advertência da
memória do agente `mcp`: o limite de login da API esgota rápido com provas em sequência, e o
sintoma não parece um limite.
