# Memória — publicador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

## O que já nos mordeu

- [Conferir deploy do MCP](deploy-mcp-como-conferir.md) — `/health` responde `ok` durante todo o rebuild; prove pelo comportamento do diff.
- [Árvore de commit intermediário](fluxo-arvore-intermediaria.md) — sem `checkout`, `stash` nem `add -p`: use `cp` + `git apply -R --recount` do hunk isolado.

## Decisões em vigor

- [Commits de ponto de controle](commits-de-ponto-de-controle.md) — commit no meio da etapa não leva changelog, histórico nem bump.
