# Memória — publicador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- [Domínios da Railway](dominios-railway.md) — API `yu-bookapi-production`, MCP `yu-book-production`; o da web não está no repositório.

## O que já nos mordeu

- [Conferir deploy](deploy-mcp-como-conferir.md) — `/health` (API e MCP) responde `ok` o rebuild inteiro; não prova nem que a migration aplicou.
- [Contar o pendente contra o remoto](conferir-pendente-contra-o-remoto.md) — `git fetch` + `ls-remote`; o relato de quem pede pode dar por pendente o que já foi publicado.
- [Árvore de commit intermediário](fluxo-arvore-intermediaria.md) — sem `checkout`, `stash` nem `add -p`: use `cp` + `git apply -R --recount` do hunk isolado.

## Decisões em vigor

- [Commits de ponto de controle](commits-de-ponto-de-controle.md) — commit no meio da etapa não leva changelog nem bump.
