# Memória — curador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- `invariantes-yu-book/SKILL.md` é só índice; o corpo está em `referencias/servidor.md` e
  `referencias/front.md`. Id `INV-xx` nunca é reusado.
- Publicação não tem skill: é `agents/publicador.md`. Propagação de fase: `§ Propagação
  obrigatória` do PRD dela.

## O que já nos mordeu

- Ref errada **de origem**, não só deslocada: INV-26 citava `:31-34` e era `:42-45`. Abra a linha.
- **Arquivo de agente apodrece calado**: `zelador.md` cobrava um bug já corrigido. Fase nova:
  `grep` no `.claude/` inteiro.
- O agente pode citar o `INV-xx` errado: "corrigir INV-30" era lacuna, e virou INV-39.

## Decisões em vigor

- **Skill registra o que o código faz, nunca o que a fase pretende.** O catálogo dizia que
  `caret.ts` sairia na Etapa C; ficou. Do PRD só se aproveita argumento pronto, por ponteiro.
- Cruza arquivo → catálogo; sítio único com o comentário ao lado → fica na linha. **Alvo de
  auditoria em outro arquivo cruza**: a proibição do `@codemirror/lang-markdown` se audita no
  `package.json`, e o diff que a viola apaga o comentário — subiu. `view.composing` ficou.
- Divergência já explicada por comentário vira linha dentro da invariante que a causa (`opacity-0`
  em INV-30), não invariante própria.
- **Prescrição e invariante que se tocam se separam por natureza**: o "como se faz" vai para a
  skill prescritiva; o estado auditável fica no catálogo (design-system §7 × INV-39).
- Não vira registro: fato sem `arquivo:linha` que o audite, e fato com prazo.
- **Padrão repetido sem `arquivo:linha` vira passo de procedimento**: três entregas sem conferir
  interface viraram o passo 5 da revisão.
- Fato já escrito em `docs/historico.md` ou no `CLAUDE.md` não se copia: vai ao operador.
- Agente que relata defeito nas próprias instruções me passa tarefa: eu edito o arquivo, não ele.
