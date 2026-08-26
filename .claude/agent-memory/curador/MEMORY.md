# Memória — curador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- Publicação não tem skill: é `agents/publicador.md`.

## O que já nos mordeu

- Ref errada **de origem**, não só deslocada, e `INV-xx` citado errado. Abra a linha, sempre.
- **Arquivo de agente apodrece calado**: `zelador.md` cobrava bug corrigido; `mcp.md` dizia "fala
  com a API em produção" depois da escrita. Fase nova: `grep` no `.claude/` inteiro.
- **Auditar entrega em curso é auditar chão móvel**: um arquivo mudou e desmentiu parágrafo que eu
  acabara de escrever. Releia também o que você escreveu na sessão.
- **Título de catálogo é lido sozinho e vira a fonte.** O de INV-19 prometia mais que o corpo e
  induziu erro numa `description` de tool.

## Decisões em vigor

- **Skill registra o que o código faz, nunca o que a fase pretende.** Do PRD só se aproveita
  argumento pronto, por ponteiro.
- Cruza arquivo → catálogo; sítio único com o comentário ao lado → fica na linha. **Alvo de
  auditoria em outro arquivo cruza.**
- **Prescrição e invariante que se tocam se separam por natureza**: o "como se faz" vai para a
  skill; o estado auditável, para o catálogo.
- **Espelhamento frágil vai para `contrato-compartilhado` §4 mesmo sem passar por `shared`**, e aí
  a dívida se declara ali (§4.5, o dia do prazo).
- **Ponteiro de rota entre skills não é duplicação; cópia do argumento é.**
- **Número medido é memória de agente, não skill.** Envelhece calado.
- **Skill perto das 300 linhas: extraia o que se lê *depois* de escrever**, nunca a doutrina.
- Não vira registro: fato sem `arquivo:linha` que o audite, e fato com prazo.
- Fato já escrito em `docs/historico.md` ou no `CLAUDE.md` não se copia: vai ao operador.
- Agente que relata defeito nas próprias instruções me passa tarefa: eu edito o arquivo, não ele.
