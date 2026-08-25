---
name: decisoes-fase-5-etapa-c
description: PRD da Fase 5 tem afirmações revogadas na entrega da Etapa C (caret.ts, RF-31, RF-33) — não reintroduzir
metadata:
  type: project
---

A Etapa C da Fase 5 (editor ao vivo) contradisse três coisas que o PRD afirmava, todas já corrigidas
em `docs/prd-fase-5-refino.md`:

- **`caret.ts` NÃO foi removido**, ao contrário do que D-01 e a §17 item 7 prometiam. A `<textarea>`
  ficou nos modos `edicao`/`dividido`/`leitura` e o autocomplete de `[[` deles depende de
  `posicaoDoCursor` e `wikilinkEmDigitacao`. Apagar o arquivo quebra três dos quatro modos.
- **RF-31 saiu do escopo**: o botão de copiar não tem atalho, porque `Ctrl+Shift+C` é do DevTools e
  `preventDefault()` não cancela.
- **RF-33 foi reduzido**: bloco de código no modo ao vivo não tem realce por token.

**Why:** as três promessas pressupunham que o CodeMirror substituiria a `<textarea>`. Ele não
substituiu — manter os três modos antigos é a mitigação de acessibilidade, já que o `contentDOM` do
CodeMirror não tem nome acessível e esconder marcação tira texto do DOM de propósito.

**How to apply:** se alguém propuser "limpar" `caret.ts` como resquício, ou reintroduzir o atalho de
copiar, esta é a razão da recusa. Confirme lendo o PRD antes de citar — ele é a fonte, isto é só o
ponteiro. Relacionado: [[feedback-entrega-nao-verificada]].
