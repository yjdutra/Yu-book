---
name: commits-de-ponto-de-controle
description: O operador pede commits no meio de uma etapa, antes de trabalho arriscado — commitar não significa que a etapa acabou nem que documentação deve entrar
metadata:
  type: feedback
---

O operador commita **no meio** de uma etapa, deliberadamente, antes de encarar a parte arriscada
dela. Em 2026-08-24, na Etapa C da Fase 5, pediu dois commits antes de começar o editor CodeMirror,
"para não ficarem reféns do risco do editor".

**Why:** trabalho pronto e verificado não deve ficar preso num working tree que uma refatoração
arriscada pode obrigar a desfazer. Commit é local e reversível; o custo de commitar cedo é zero.

**How to apply:**

- Não trate o pedido de commit como fechamento de entrega. Nesses pontos de controle **nada** de
  `CHANGELOG.md`, bump de `package.json` ou `.claude/` entra — quem fecha é o
  `versionador`, no fim da etapa, e o operador o chama explicitamente.
- A regra do `versionador` ter passado antes do commit vale para o fechamento da etapa, não para o
  ponto de controle no meio dela.
- Prefira vários commits coesos: aqui a divisão foi por natureza da mudança (`fix` de bug separado
  do `feat` novo), mesmo os dois sendo do mesmo arquivo-tema.

Ver [[fluxo-arvore-intermediaria]] para verificar que o primeiro commit da série compila sozinho.
