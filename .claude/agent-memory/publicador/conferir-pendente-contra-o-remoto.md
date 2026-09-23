---
name: conferir-pendente-contra-o-remoto
description: Antes de contar o que um push publica, faça git fetch e confira com git ls-remote — o que o chamador diz estar pendente pode já estar publicado
metadata:
  type: feedback
---

Antes de qualquer push, conte o pendente **contra o remoto real**, não contra o relato de quem
pediu nem contra o ref de rastreamento sozinho:

```bash
git fetch origin
git ls-remote origin master      # a verdade
git log --oneline origin/master..HEAD
```

**Why:** em 2026-09-23 o chamador afirmou, com detalhe e SHA, que `4e14b99 docs: corrige a contagem
de testes da 0.11.0` era "um commit local já feito e não publicado" que sairia junto. `ls-remote`
mostrou `4e14b99` **já em `refs/heads/master`** no remoto. O relato estava errado, e acreditar nele
teria feito eu anunciar ao operador que o push publicava trabalho de outra sessão — exatamente o
aviso que a regra de contar o pendente existe para dar, dado errado.

**How to apply:**

- O erro corre nas duas direções: o pendente pode ser **maior** que a entrega do turno (aí nomeie os
  commits estranhos e peça confirmação) ou **menor** (aí corrija quem pediu, porque o aviso que ele
  já deu ao operador ficou impreciso). Relate a correção junto com o resultado do push.
- `git log origin/master..HEAD` sem `fetch` antes lê um ref que pode estar velho. O `fetch` é
  leitura pura e custa nada.
