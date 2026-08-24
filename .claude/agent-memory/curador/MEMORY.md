# Memória — curador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Espelhamentos frágeis: `§4` de `.claude/skills/contrato-compartilhado/SKILL.md`.
- Invariantes `INV-xx`, id nunca reusado, em `.claude/skills/invariantes-yu-book/SKILL.md`.
- Os PRDs dizem qual skill recebe o quê — `§ Registro em .claude` de `docs/prd-fase-*.md`.

## O que já nos mordeu

- Refs de `Quadro.tsx`/`ColunaQuadro.tsx` deslocam a cada entrega do kanban — 9 corrigidas em
  2026-08-24, mais 6 no mesmo dia após a Etapa B. Idem `kanban.service.ts`, `notes.service.ts`.
- **Arquivo de agente é onde registro apodrece calado**: ninguém o lê contra o código. Não duplique
  skill lá (`frontend.md` repetia INV-29/30 com refs de duas fases) nem descreva estado, só como
  levantá-lo (`versionador.md`). Aponte para a skill.

## Decisões em vigor

- Divergência já explicada por comentário no código **não** vira invariante própria: entra como
  linha dentro da invariante que a causa (`opacity-0` do vão em INV-30; filtro OU em INV-34).
- **Cruza arquivo → catálogo; sítio único com o comentário ao lado → fica na linha.** Separou
  INV-36 (estratégia em dois arquivos) de `ROLAGEM` e `detectarColisao`, que não entraram.
- Fato de biblioteca do tipo "não implemente X" não é invariante: não há `arquivo:linha` que o
  audite. Fica no PRD (`MeasuringStrategy`, como `caret.ts`).
- Onde o PRD já tem o parágrafo pronto, o catálogo leva a forma curta e **aponta** para lá
  (INV-34 → §7.3; INV-36 → RF-27). Não reescrevo.
- O aviso de sequência no fim da skill nomeia **quais invariantes** a próxima etapa ameaça, não só
  quais arquivos ela toca.
- Mudança de fase ou de caminho: `grep` no território `.claude/` inteiro. Ref stale é minha.
- Agente que relata defeito nas próprias instruções me passa tarefa: eu edito o arquivo, não ele.
