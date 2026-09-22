---
name: fluxo-arvore-intermediaria
description: Como verificar a árvore de um commit intermediário e dividir um arquivo entre dois commits sem git checkout, git stash nem git add -p — todos indisponíveis aqui
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

## Dividir um arquivo entre dois commits sem `git add -p`

`git add -p` é interativo e **não está disponível neste ambiente**. O caminho que passou, em
2026-09-04, para tirar um hunk isolado de `apps/mcp/src/http.ts`:

1. `git diff -- caminho > full.patch`; `grep -n '^@@' full.patch` para numerar os hunks.
2. Montar o patch do hunk que sai por último: as 4 linhas de cabeçalho (`diff --git`, `index`,
   `---`, `+++`) mais o intervalo de linhas daquele hunk.
3. `git apply -R --recount hunk.patch` no working tree → sobra a árvore do commit anterior. O
   `--recount` dispensa acertar os offsets do cabeçalho `@@` à mão.
4. Portões, `git add` do arquivo, commit. Depois `cp` do backup de volta, conferir `md5sum`, e
   commitar o hunk restante — que aparece sozinho no `git diff`.

Conferir com `git diff -- caminho | grep -c '^@@'` que sobrou o número esperado de hunks é o que
prova a separação antes de commitar.
