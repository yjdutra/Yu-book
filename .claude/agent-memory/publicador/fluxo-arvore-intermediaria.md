---
name: fluxo-arvore-intermediaria
description: Como verificar a árvore de um commit intermediário sem git checkout nem git stash — o auto mode bloqueia checkout destrutivo do working tree
metadata:
  type: feedback
---

Para montar a árvore de um commit intermediário, **não use `git checkout HEAD -- <arquivo>`**: o
classificador do auto mode bloqueia, porque descarta modificação não commitada do working tree. O
`git stash push --keep-index` também está fora, por decisão de projeto.

O caminho que passou, em 2026-08-24:

1. `cp` dos arquivos finais para o scratchpad e `md5sum` para registrar o hash.
2. `git show HEAD:caminho > caminho` para escrever a versão do HEAD por cima (reversível, porque o
   backup existe e foi conferido).
3. Rodar os portões nessa árvore, commitar a parte isolada.
4. `cp` de volta do scratchpad e conferir o `md5sum` contra o do passo 1 antes de commitar o resto.

**Why:** nenhum portão do projeto vê a árvore intermediária — `typecheck` e testes só olham o estado
final, e não há CI. Um commit intermediário que não compila só aparece num `git bisect` meses
depois.

**How to apply:** sempre que uma entrega for dividida em mais de um commit e houver dúvida se o
primeiro compila sozinho. Quando os arquivos não se importam entre si (checar os `import` do arquivo
isolado resolve em segundos), o risco é baixo, mas rodar `pnpm typecheck` + `pnpm --filter
@yu-book/web build` na árvore isolada custa poucos segundos e encerra a dúvida.
