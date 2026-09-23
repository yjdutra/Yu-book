# Memória — testes

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Duas suítes vitest desde 2026-09-01: `apps/api/tests/` (integração, exige Postgres) e
  `apps/mcp/tests/` (unitária, não exige nada no ar). Seu escopo declarado é só a primeira.
- Arnês JSON-RPC em memória: `apps/mcp/tests/arnes.ts`. Não usa o `Client` do SDK de propósito —
  ele não manda `authInfo` por mensagem, e `InMemoryTransport.send(msg, { authInfo })` manda. É o
  fio para testar autorização por chamada.

## O que já nos mordeu

- **Duas rodadas de `pnpm --filter @yu-book/api test` contra o mesmo Postgres se derrubam**: o
  `limpar()` de uma apaga os usuários da outra (`apps/api/tests/apoio.ts:26`). Medido 2026-09-23 —
  sozinha 3/3 verdes, com rival em paralelo 2/3 caem com `response destroyed before completion`.
  **Não é defeito de código** e o sintoma aponta para o lugar errado: antes de caçar falha
  intermitente, pergunte se um agente está rodando o portão.
- Irmã dela, `EADDRINUSE` em 127.0.0.1:39333 após rodada interrompida: descrita na entrada de
  2026-09-23 de `docs/historico.md`. Também parece defeito do chat.
- O SDK MCP valida os argumentos **antes** do handler: guarda dentro do handler nunca é alcançada
  por chamada malformada, e um teste que chame com `{}` prova a coisa errada. `argumentosMinimos`
  deriva do `inputSchema` (`apps/mcp/tests/escrita.test.ts:65`).

## Decisões em vigor

- Lista que o teste enumera à mão herda o furo que ele fecha: derive-a do sistema. E lista derivada
  por **diferença** tem cegueira — o item que vaza para os dois lados é subtraído e some do exame.
  Pague com a asserção inversa (`apps/mcp/tests/escrita.test.ts:109`).
