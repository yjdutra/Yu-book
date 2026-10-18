# PRD — Frente Ritmo: hábitos, ofensivas, foco, skills e humor

> Escrito em 2026-10-18. Esta frente é um eixo de numeração novo: **Ritmo 1 a 7**. Ela não se
> confunde com as fases de produto, com a frente de agenda nem com R1–R3 dos eventos
> recorrentes. Os `RF-xx`, `RN-xx`, `RNF-xx` e `CA-xx` abaixo valem para o código desta frente,
> e os números colidem com os de outros PRDs de propósito: o comentário resolve para o PRD da fase
> daquele código.
>
> Protótipo visual aprovado (canvas "Yu-book Ritmo"): https://claude.ai/artifact/MrZdhqEbxWeoju1wF7qthf

## 1. Problema e objetivo

O Yu-book organiza o que fazer (agenda, tarefas, quadros), mas não mostra **constância**. A frente
Ritmo gamifica a disciplina pessoal no estilo Duolingo, sem virar um aglomerado de telas:

- hábitos com atividades pontuadas, ligadas às tarefas e eventos que já existem;
- meta semanal **ponderada**, para que um dia só não pague a semana inteira;
- ofensivas e um ranking pessoal de recordes;
- pomodoro ligado a uma atividade;
- skills: modos de agir que o usuário quer internalizar, apresentados como habilidades de jogo;
- humor em três momentos do dia, para correlacionar com os hábitos.

Single-user. Tudo configurável pelo MCP, para que o assistente organize a frente depois de pronta.

## 2. Princípios (valem para todas as fases)

- **P1 — Um conceito, dois pontos de entrada.** Uma área nova no móvel, "Ritmo", com quatro
  abas (Hábitos, Ofensivas, Skills, Humor). O check-in de humor e o skill do dia ficam no Início.
  O foco não é aba: abre a partir de uma atividade.
- **P2 — Nada de "lugar de anotar" próprio.** Pontos vêm de três gestos: concluir uma tarefa, fazer
  check-in na ocorrência de um evento, ou registrar fora do plano.
- **P3 — Calcular na leitura.** Semana, XP, nível, ofensivas e recordes saem dos registros a cada
  leitura. Não existe tabela de agregado nem relógio novo. O volume é de um usuário só.
- **P4 — Honestidade acima de pontos.** Humor nunca dá pontos, e skill tem XP próprio.
- **P5 — O passado não muda.** O registro guarda os pontos do momento em que foi feito.

## 3. Fases

| Fase | Entrega | Pacotes |
|---|---|---|
| **Ritmo 1** | Hábitos no servidor: modelos, vínculo com tarefa e evento, registro avulso, semana ponderada, MCP e chat | api, shared, mcp |
| Ritmo 2 | Hábitos no móvel: área Ritmo, barra nova, lista, detalhe, folha de registro, feedback | movel, cliente |
| Ritmo 3 | Ofensivas, níveis e recordes, calculados na leitura, com tela e chama no Início | shared, api, movel |
| Ritmo 4 | Humor: check-in no Início, ditado, histórico, correlação | api, shared, mcp, movel |
| Ritmo 5 | Skills: catálogo de emblemas, "usei agora", níveis, skill do dia | api, shared, mcp, movel |
| Ritmo 6 | Foco: pomodoro ligado a uma atividade, sessão gravada | api, shared, movel |
| Ritmo 7 | Povoar pelo MCP com o conteúdo do "Rotina da Casa" (dados, não código) | — |

Fora desta frente: lista de compras e estoque, recorrência mensal, notificação push, medalhas
genéricas, ranking social e pontos por humor.

---

## 4. Ritmo 1 — Hábitos no servidor

### 4.1 Modelo

- **Hábito** (`habit`): nome, cor, emblema, meta semanal em pontos, dias-alvo por semana, posição e
  arquivamento.
- **Atividade** (`habit_activity`): nome, pontos, posição e arquivamento. Pertence a um hábito.
- **Registro** (`habit_entry`): "ganhei N pontos no dia D". Tem origem (`task`, `event` ou
  `manual`), o dia civil do usuário e os pontos congelados.
- **Vínculo:** `task`, `task_series` e `event` ganham um `habit_activity_id` opcional.

### 4.2 Requisitos funcionais

**Hábitos e atividades**

- **RF-01** — Criar hábito com `name`, `color` (a paleta `AGENT_COLORS`), `emblem` (catálogo
  fechado em `packages/shared`), `weeklyGoal` e `targetDays`. A criação aceita as atividades
  iniciais junto, numa transação só.
- **RF-02** — Editar os campos do hábito; arquivar e desarquivar (`archived`); excluir.
- **RF-03** — Criar, editar, arquivar e excluir atividade de um hábito, com `name` e `points`.
- **RF-04** — Listar hábitos com as atividades e o resumo da semana corrente (RF-10). Os arquivados
  só vêm sob pedido (`includeArchived`).
- **RF-05** — Reordenar hábitos e atividades por `position`.

**Vínculo com a agenda**

- **RF-06** — Tarefa, série de tarefas e evento aceitam `habitActivityId` na criação e na edição.
  A série copia o vínculo para cada ocorrência que gera. Editar a série reescreve o vínculo das
  ocorrências abertas de hoje em diante, como já faz com o título.
- **RF-07** — Concluir uma tarefa com atividade grava um registro `task` **na mesma transação**,
  com os pontos da atividade naquele momento e o dia da conclusão no fuso do usuário. Reabrir a
  tarefa apaga o registro, também na mesma transação.
- **RF-08** — Check-in na ocorrência de um evento com atividade: `POST /events/:id/check-in` com o
  dia da ocorrência grava um registro `event`. `DELETE` no mesmo endereço desfaz. O dia precisa ser
  uma ocorrência real do evento, e não pode estar no futuro.

**Registro avulso**

- **RF-09** — Registrar pontos fora do plano em um hábito: com uma atividade (os pontos vêm dela,
  a menos que o pedido diga outro valor) ou só com `points`. Aceita `day` (o padrão é hoje no fuso do
  usuário) e `note`. Também é possível excluir um registro avulso.

**Semana ponderada**

- **RF-10** — Cada hábito expõe a semana corrente: segunda a domingo, no fuso do usuário. Os campos
  são:
  - `cap` = `ceil(weeklyGoal / targetDays)`;
  - por dia, `points` (tudo o que entrou) e `counted` (`min(points, cap)`);
  - `progress` = soma de `counted`;
  - `extra` = soma do que passou do teto;
  - `activeDays` = dias com pelo menos um registro;
  - `goalMet` = `progress >= weeklyGoal`.
- **RF-11** — Histórico de registros de um hábito por período (`from`, `to`, dias civis), para a
  linha do tempo e o mapa de calor da Ritmo 2.

**MCP e chat**

- **RF-12** — MCP, leitura: `list_habits` mostra hábitos, atividades (com id) e a semana
  ponderada.
- **RF-13** — MCP, escrita: `create_habit` (hábito com atividades), `update_habit` (campos do
  hábito, e atividades a criar, editar ou arquivar) e `log_habit` (registro avulso).
- **RF-14** — `create_task`, `update_task`, `create_event` e `update_event` aceitam
  `habitActivityId`.
- **RF-15** — O chat ganha `list_habits` e `log_habit`. A configuração (`create_habit` e
  `update_habit`) fica só no MCP (RNF-03).

### 4.3 Regras de negócio

- **RN-01** — `weeklyGoal` vai de 1 a 5000. `targetDays` vai de 1 a 7. Os pontos de atividade e de
  registro vão de 1 a 500.
- **RN-02** — O nome do hábito é único por usuário. O nome da atividade é único dentro do hábito.
  Nos dois casos a comparação é feita depois de `trim`. Repetir o nome é 409.
- **RN-03** — O registro guarda os pontos do momento (P5). Mudar os pontos da atividade não
  reescreve registros antigos.
- **RN-04** — Uma tarefa rende no máximo um registro (`task_id` único). Uma ocorrência de evento
  rende no máximo um (`event_id` + `day` únicos). Concluir de novo, ou fazer check-in de novo, não
  duplica nada. É a mesma guarda de estado de `concluirTarefa` (INV-63), e vale também entre as duas
  instâncias da API (INV-60).
- **RN-05** — O dia do registro é um **dia civil** (`@db.Date`, INV-66), resolvido no servidor
  pelo fuso de `ai_preference`. Nunca é o fuso do processo nem o do aparelho.
- **RN-06** — Registro avulso: o dia não pode estar no futuro nem ter mais de 30 dias.
- **RN-07** — O hábito arquivado não aparece na listagem padrão e não recebe registro novo (409).
  Os registros antigos continuam lá. A atividade arquivada também não recebe registro, e concluir
  uma tarefa ligada a ela não gera pontos.
- **RN-08** — Excluir um hábito apaga as atividades e os registros dele (cascata). Excluir uma
  atividade solta os vínculos (`habit_activity_id` vira nulo em tarefa, série e evento), e os
  registros ficam com o hábito e sem atividade.
- **RN-09** — Excluir uma tarefa concluída **não** apaga o registro dela: o `task_id` vira nulo e o
  ponto continua no histórico. Só reabrir a tarefa desfaz o registro.
- **RN-10** — O registro `manual` se exclui pela rota de registros. Os de tarefa e de evento se
  desfazem pela origem (reabrir a tarefa, ou tirar o check-in). Se a origem sumiu (tarefa ou evento
  excluídos), eles também passam a se excluir pela rota de registros.
- **RN-13** — O check-in é da ocorrência. Quando a ocorrência muda de linha (o avulso de `esta`, a
  série nova de `seguintes`), o registro vai junto, na mesma transação.
- **RN-11** — Vincular uma atividade de outra conta, ou inexistente, é 404, como acontece com o
  quadro.
- **RN-12** — O registro vindo do MCP ou do chat leva a marca de origem (`aiVia`, `aiAuthor` e
  `aiAgentName`), gravada só pelo servidor, como a marca de conclusão (INV-63).

### 4.4 Requisitos não funcionais

- **RNF-01** — Duas camadas: `habitos.routes.ts` faz o parse e chama o service, e
  `habitos.service.ts` concentra a regra e o Prisma.
- **RNF-02** — Schemas, limites, o catálogo de emblemas e a função pura da semana ponderada moram em
  `packages/shared`, para web e móvel calcularem igual.
- **RNF-03** — Orçamento de contexto: as descrições das tools novas são curtas, e só duas entram em
  `FERRAMENTAS_DO_CHAT`. Cada palavra é paga em todo turno.
- **RNF-04** — O formatador de texto dos hábitos (`formatarHabitos`) mora em `formato.ts` e lê
  campo novo tolerando ausência.
- **RNF-05** — Ler a lista de hábitos com a semana custa uma consulta de registros por janela, não
  uma por hábito.

### 4.5 Rotas

| Método e caminho | O que faz |
|---|---|
| `GET /habits?includeArchived` | RF-04, com `week` em cada hábito |
| `POST /habits` | RF-01 |
| `GET /habits/:id` | Um hábito com atividades e semana |
| `PATCH /habits/:id` | RF-02 e RF-05 |
| `DELETE /habits/:id` | RN-08 |
| `POST /habits/:id/activities` | RF-03 |
| `PATCH /habit-activities/:id` | RF-03 e RF-05 |
| `DELETE /habit-activities/:id` | RN-08 |
| `GET /habits/:id/entries?from&to` | RF-11 |
| `POST /habits/:id/entries` | RF-09 |
| `DELETE /habit-entries/:id` | RN-10 |
| `POST /events/:id/check-in` | RF-08; corpo `{ day }` |
| `DELETE /events/:id/check-in?day=` | RF-08 |

### 4.6 Critérios de aceite

- **CA-01** — Criar "Inglês" com meta 120, 4 dias-alvo e três atividades devolve o hábito com as
  atividades e `week.cap = 30`.
- **CA-02** — Concluir uma tarefa ligada a "App" (10 pts) cria um registro de 10 no dia de hoje do
  usuário. Concluir de novo não cria outro. Reabrir apaga o registro.
- **CA-03** — Uma série com atividade gera ocorrências com o vínculo. Concluir uma ocorrência pontua.
- **CA-04** — Num mesmo dia com 40 pts e teto 30, a semana mostra `counted = 30` e `extra = 10`.
- **CA-05** — Check-in num dia em que o evento não acontece é 422. Check-in repetido não duplica.
  O `DELETE` desfaz.
- **CA-06** — Registro avulso no futuro, ou de 31 dias atrás, é 422. Em hábito arquivado é 409.
- **CA-07** — Mudar os pontos da atividade não altera registros antigos.
- **CA-08** — Atividade, hábito ou registro de outro usuário é 404 em toda rota.
- **CA-09** — Pelo MCP: `create_habit` cria o hábito com atividades, `list_habits` mostra a semana,
  `log_habit` pontua e `create_task` com `habitActivityId` liga a tarefa.
- **CA-10** — O chat consegue listar hábitos e registrar fora do plano, e não consegue criar hábito.

---

### 4.7 Pendências registradas na revisão da Ritmo 1

- **Check-in pelo MCP e pelo chat.** O PRD não pediu essa tool, e hoje o check-in só se faz pela
  rota (o app, na Ritmo 2). O texto do vínculo nos eventos diz "check-in, feito no app" para o modelo
  não usar `log_habit` no lugar, o que escaparia da unicidade `(event_id, day)`. A decisão fica para
  a Ritmo 2: `check_in_event` no MCP e, talvez, no chat.
- **Estado do check-in no `EventItem`.** A Ritmo 2 precisa saber, por ocorrência, se já houve
  check-in. Isso entra junto com a tela.

### 4.8 Decisões tomadas na implementação (2026-10-18)

Registradas aqui porque `docs/historico.md` não existe neste checkout. Quando este `docs/` for
mesclado ao original, elas são a entrada da Ritmo 1 no histórico.

- **`HABIT_COLORS` repete a paleta dos agentes em vez de importar `AGENT_COLORS`.** Importar
  fecharia o ciclo `agentes.ts` → `ferramentas.ts` → `habitos.ts`, e o `z.enum` receberia a
  constante ainda indefinida. Um `satisfies readonly AgentColor[]` impede que as duas paletas se
  afastem. RF-01 diz "a paleta `AGENT_COLORS`": no valor é verdade, na fonte não.
- **O vínculo e a pontuação da conclusão moram em `habitos/vinculo.service.ts`, fora de
  `habitos.service.ts`.** Tarefas e eventos importam o vínculo, e `habitos.service` importa
  eventos, para conferir a ocorrência do check-in. No mesmo arquivo, o ciclo entregaria
  `CAMPOS_DO_VINCULO` indefinido ao `select`.
- **A atividade arquivada ainda se vincula, só não pontua** (`conferirAtividade` não olha
  `archivedAt`). RN-07 só fala de registro; o vínculo ficou permitido.
- **Arquivado é 409 com `VALIDATION_ERROR`**, sem código novo em `ERROR_CODES`.
- **`update_habit` não é atômico.** O hábito e cada atividade são rotas próprias. A tool confere
  tudo o que pode antes da primeira escrita e, numa falha no meio, devolve o que já foi aplicado.
  Desfazer exigiria uma rota transacional nova. Repetir a chamada inteira criaria a atividade nova
  duas vezes.
- **O check-in muda de linha junto com a ocorrência.** Em `esta`, o avulso nasce antes de a
  ocorrência sair da série. Assim o registro troca de dono antes que a série, se ficar vazia, seja
  apagada e o `SET NULL` o solte.
- **`log_habit` não entra em `criados` no chat.** O registro não é item que se abra.
- **Pendência: a ordem do deploy importa (API antes do MCP).** Uma API velha descarta
  `habitActivityId` calada, e o MCP não confere o vínculo na resposta, ao contrário do que faz com
  `repeat` desde a `[0.36.0]`.

## 5. Fases seguintes (escopo, detalhado quando cada uma começar)

### Ritmo 2 — Hábitos no móvel

- A barra passa a ser Início · Plano (Agenda + Tarefas, com seletor) · ＋ · Ritmo · Assistente.
- Ritmo › Hábitos: um cartão de nível, a semana em barras e uma grade de hábitos com anel.
- Detalhe do hábito: anel da meta, barras ponderadas com a linha do teto, atividades, os últimos 30
  dias, o mapa de 12 semanas e recordes.
- Folha "Registrar fora do plano", com seletor de pontos, avisando quanto conta e quanto vira XP.
- Início ganha "Hoje no ritmo" (as atividades do dia com o check) e o toast de pontos.
- `BarrasPorDia` e `Indicador` sobem para `packages/cliente`, e o kit novo nasce em
  `packages/cliente/src/ritmo/`.

### Ritmo 3 — Ofensivas, níveis e recordes

- **Ofensiva geral:** dias seguidos com qualquer registro de hábito ou check-in de humor.
- **Ofensiva do hábito:** semanas seguidas com `goalMet`.
- **Recordes:** as 5 maiores sequências de cada tipo, mais as melhores semanas por pontos.
- **XP e nível:** uma curva sobre o XP total, definida em `packages/shared`.
- Tudo calculado na leitura (P3). Há uma folha de conquista só para os marcos raros.

### Ritmo 4 — Humor

- Uma linha por dia: manhã, durante e noite, cada um de 1 a 5, mais uma descrição. A descrição
  pode ser ditada com `useDitado`, que só preenche o campo.
- O histórico mostra uma linha de humor sobre os pontos do dia, e cartões "com/sem hábito" com
  o `n` à mostra. Um cartão só aparece com pelo menos 7 dias de cada lado.
- No MCP: `log_mood` e `get_mood`.

### Ritmo 5 — Skills

- A skill tem nome, descrição, "quando usar", emblema do catálogo e cor.
- "Usei agora" grava um uso. Os níveis vêm do número de usos: Bronze no 1º, Prata com 15, Ouro com
  50 e Mestre com 150.
- O skill do dia aparece no Início, em rodízio.
- Skill não dá pontos de hábito (P4).
- No MCP: `upsert_skill` e `log_skill_use`.

### Ritmo 6 — Foco

- O timer roda no cliente, guardando o instante final, com Wake Lock.
- A sessão de foco é gravada. O pomodoro concluído numa atividade com "pontos por pomodoro" gera um
  registro de origem `focus`.

### Ritmo 7 — Povoar pelo MCP

Do "Rotina da Casa":

- Rotina diária e semanal → o hábito "Casa em ordem", com atividades e checklist na descrição.
- Regras da aba Mente → skills.
- Dicas → notas.
- Lista de compras → fica fora.
