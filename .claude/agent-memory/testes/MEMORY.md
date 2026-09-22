# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Existem **duas** suítes vitest desde 2026-09-01: `apps/api/tests/` (integração, exige Postgres) e
  `apps/mcp/tests/` (unitária, não exige nada no ar). Seu escopo declarado ainda é só a primeira.
- Arnês JSON-RPC em memória: `apps/mcp/tests/arnes.ts`, o primeiro do repositório. Não usa o
  `Client` do SDK de propósito — o `Client` não manda `authInfo` por mensagem, e o
  `InMemoryTransport.send(msg, { authInfo })` manda. É o fio para testar autorização por chamada.

## O que já nos mordeu

- `beforeEach(() => mock.mockReset())` sem chaves devolve o próprio mock, e o Vitest trata retorno
  de `beforeEach` como função de limpeza: ele chama o mock depois de cada teste. Custou três testes
  em `apps/mcp/tests/provedor.test.ts:220` — a rejeição sem dono aparece como falha de **outro**
  teste, então o teste que falha não é o teste quebrado.

- O limite de taxa é por IP, e `app.inject` usa o mesmo endereço em toda injeção: dois testes de
  rotas com balde próprio dividem o balde e um derruba o outro com 429. Passe `ip`
  (`apps/api/tests/apoio.ts:48`).

- O SDK MCP valida os argumentos **antes** de chamar o handler, então guarda dentro do handler
  nunca é alcançado por chamada malformada: um teste que chame com `{}` prova a coisa errada.
  `argumentosMinimos` deriva os argumentos do `inputSchema` (`apps/mcp/tests/escrita.test.ts:65`).

## Decisões em vigor

- Lista que o teste enumera à mão herda o furo que ele fecha: derive-a do próprio sistema. E toda
  lista derivada por **diferença** tem uma cegueira — o item que vaza para os dois lados é
  subtraído e some do exame. Pague com a asserção inversa (`apps/mcp/tests/escrita.test.ts:109`).
