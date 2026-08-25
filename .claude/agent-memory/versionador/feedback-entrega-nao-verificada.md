---
name: feedback-entrega-nao-verificada
description: Nunca escrever que uma entrega foi verificada quando só typecheck/build/testes de API passaram — o projeto não tem teste de front
metadata:
  type: feedback
---

Quando a entrega é só de `apps/web`, os portões do projeto (`pnpm typecheck`, `pnpm --filter
@yu-book/api test`, `pnpm --filter @yu-book/web build`) **não a validam**. Registrar isso
explicitamente no CHANGELOG, no `docs/historico.md` e no README, com as palavras "implementado e
**não verificado**" e os `CA-xx` nomeados. Nunca escrever "verificado".

**Why:** não existe teste de front no projeto. Nas Etapas A, B e C da Fase 5 o operador pediu esse
registro nas três, e na C reforçou o peso — um editor CodeMirror inteiro foi escrito e nunca
executado. A omissão faria o changelog afirmar uma garantia que não existe.

**How to apply:** em qualquer entrega que toque `apps/web`, separe o que os portões cobrem
(regressão da API, tipos, build) do que ninguém rodou. Se a condição se repetir, diga que é a
n-ésima seguida — a repetição é a informação, não o fato isolado. Relacionado:
[[decisoes-fase-5-etapa-c]].
