# Memória — curador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- Espelhamentos frágeis: `§4` de `.claude/skills/contrato-compartilhado/SKILL.md`.
- Invariantes `INV-xx`, id nunca reusado, em `.claude/skills/invariantes-yu-book/SKILL.md`.
- Qual skill recebe o quê: `§ Registro em .claude` de `docs/prd-fase-*.md`.
- Publicação não tem skill — a prescrição de commit e push é `.claude/agents/publicador.md`.

## O que já nos mordeu

- Ref do arquivo em obra desloca a cada etapa (duas rodadas no kanban em 2026-08-24). Regrep a cada
  entrega; a Etapa C repete isso no editor de notas.
- **Arquivo de agente é onde registro apodrece calado**: não duplique skill lá nem descreva estado,
  só como levantá-lo. Procedimento próprio do agente, sim — é o lugar dele.
- O item que o agente me passa já pode estar no arquivo dele: 2 dos 6 de 2026-08-24 estavam.

## Decisões em vigor

- Divergência já explicada por comentário no código não vira invariante própria: vira linha dentro
  da invariante que a causa (`opacity-0` do vão em INV-30; filtro OU em INV-34).
- **Cruza arquivo → catálogo; sítio único com o comentário ao lado → fica na linha.**
- Não vira registro: fato sem `arquivo:linha` que o audite (`MeasuringStrategy`), e fato com prazo,
  que morre ao fim da ação em curso ("A e B editam as mesmas linhas" morreu no commit).
- Observação sobre o projeto já escrita em `docs/historico.md` não se copia para `.claude/` — vai ao
  operador (duas entregas sem verificação de front, 2026-08-24).
- Se o PRD já tem o parágrafo, a skill aponta para lá em vez de reescrever (INV-34 → §7.3).
- O aviso de sequência no fim da skill nomeia quais invariantes a próxima etapa ameaça.
- Mudança de fase ou de caminho: `grep` no território `.claude/` inteiro. Ref stale é minha.
- Agente que relata defeito nas próprias instruções me passa tarefa: eu edito o arquivo, não ele.
