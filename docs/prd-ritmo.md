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
| Ritmo 2 | Hábitos no móvel: área Ritmo, barra nova, lista, detalhe, folha de registro, feedback; check-in por ocorrência, XP e nível | movel, cliente, api, shared, mcp |
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

## 5. Ritmo 2 — Hábitos no móvel

> Detalhado em 2026-10-18, ao começar a fase. Os `RF-xx` daqui continuam a numeração da Ritmo 1
> (RF-16 em diante), para o comentário do código não colidir dentro do mesmo PRD.

### 5.1 Escopo

A primeira fase com tela. Tudo é do móvel (`apps/movel`) e do pacote que os fronts dividem
(`packages/cliente`); o servidor só ganha o que a tela não consegue calcular sozinha: o estado do
check-in por ocorrência e o XP total.

Fica para depois, mesmo aparecendo no protótipo: ofensivas, recordes e a ofensiva por hábito
(Ritmo 3), humor (Ritmo 4), skill do dia (Ritmo 5), o "play" do foco (Ritmo 6), e criar ou editar
hábito pela tela — a configuração segue no MCP (RF-13).

### 5.2 Requisitos funcionais

**Navegação**

- **RF-16** — A barra do móvel passa a ser Início · Plano · ＋ · Ritmo · Assistente. Plano reúne
  Agenda e Tarefas: as duas rotas continuam (`/agenda`, `/tarefas`), o item Plano fica ativo nas
  duas, e um seletor no topo troca entre elas. O item leva à última das duas aberta na sessão.
- **RF-17** — A área Ritmo (`/ritmo`) tem quatro abas no topo: Hábitos, Ofensivas, Skills e Humor.
  Nesta fase só Hábitos tem conteúdo; as outras três dizem em que fase chegam.

**Ritmo › Hábitos**

- **RF-18** — Cartão de nível: o nível, o nome dele, a barra de XP até o próximo, o XP total e o da
  semana, e três números da semana (meta em %, XP ganho e dias ativos).
- **RF-19** — A semana em barras: os pontos de cada dia, somados entre os hábitos ativos, de
  segunda a domingo, com hoje em destaque e os dias por vir vazios. O cabeçalho diz o período e
  "N de M pts" (o que conta para as metas sobre a soma das metas).
- **RF-20** — A grade de hábitos: um cartão por hábito ativo, com o emblema na cor dele, o anel da
  meta com a porcentagem, "N de M pts · D/A dias" e uma faixa dos sete dias. Tocar abre o detalhe.

**Detalhe do hábito** (`/ritmo/habitos/:id`)

- **RF-21** — O anel da meta com os pontos que contam, uma frase do que falta ("Faltam 40 pts — em
  pelo menos 2 dias", "Meta da semana batida", ou "Não fecha mais nesta semana") e as pílulas dos
  dias-alvo e do teto.
- **RF-22** — Barras ponderadas da semana: a parte que conta, cheia; o que passou do teto,
  hachurado em cima; a linha tracejada do teto; a legenda das duas partes.
- **RF-23** — As atividades ativas, com os pontos e quantas vezes entraram nesta semana, e o botão
  "Registrar fora do plano".
- **RF-24** — Os últimos 30 dias em barras (pontos por dia) e o mapa de 12 semanas (uma coluna por
  semana, de segunda a domingo, quatro tons com legenda). Os dois saem de uma consulta só de
  registros (RF-11).

**Registrar fora do plano**

- **RF-25** — Uma folha inferior: o hábito (quando aberta do Início), a atividade ou "Valor livre",
  e um seletor de pontos de 5 em 5. Antes de registrar, ela diz quanto conta para a meta de hoje e
  quanto vira só XP. Registrar grava pelo `POST /habits/:id/entries` (RF-09) e mostra o toast.

**Início › Hoje no ritmo**

- **RF-26** — Uma seção com as atividades de hoje: as tarefas do dia e as ocorrências de evento do
  dia ligadas a uma atividade, com o hábito, a hora e os pontos. O check conclui a tarefa ou faz o
  check-in, e desfaz. Uma pílula "N de M" e uma barra fina dizem quanto do dia já foi. O botão
  "Registrar fora do plano" abre a folha de RF-25.
- **RF-27** — O toast de pontos: "+N", o hábito e a semana depois do ganho ("110 de 120"), e o
  próximo passo ("Falta 1 dia para a meta", "Meta da semana batida", "10 viraram XP extra"). Some
  sozinho em 2,6 s e é `role="status"`.

**Check-in de evento** (pendência de §4.7)

- **RF-28** — `EventItem` ganha `checkedIn`: se a ocorrência (`id` + `occurrenceDate`) já tem
  check-in. Vale em `GET /agenda`, `GET /events` e `GET /events/:id`. Evento sem atividade traz
  `false`.
- **RF-29** — No item da agenda do móvel (Início, Agenda, projeto), o evento com atividade troca a
  bolha do tipo por uma caixa de check-in, no dia de hoje ou antes. Num dia futuro a caixa não
  aparece.
- **RF-30** — MCP: `check_in_event` faz e desfaz o check-in de uma ocorrência. Fica fora do chat.

**Servidor**

- **RF-31** — `GET /habits/summary`: o hoje do usuário, o XP total (a soma de todo registro, acima
  do teto inclusive), o XP da semana e o nível calculado.

### 5.3 Regras de negócio

- **RN-14** — XP é a soma dos pontos de todo registro do usuário, de hábito arquivado também. O
  registro de hábito excluído some com ele (RN-08), e o XP cai junto: calcular na leitura (P3) é
  isso.
- **RN-15** — A curva de nível mora em `packages/shared` (`nivelDoXp`): chegar ao nível `n + 1`
  custa `25 · n · (n + 1)` XP no total — 50 para o 2, 150 para o 3, 300 para o 4. Os nomes vão por
  faixa (Iniciante, Aprendiz, Constante, Dedicado, Disciplinado, Mestre).
- **RN-16** — O aviso da folha usa a mesma conta do servidor: o que entra hoje conta até
  `cap − pontos de hoje`, e o resto vira só XP. A função é de `packages/shared` (`quantoConta`).
- **RN-17** — "Hoje" é sempre o do usuário (`AgendaRange.today` ou `summary.today`), nunca o do
  aparelho (INV-66). Até a API responder, a tela espera.
- **RN-18** — O check de "Hoje no ritmo" é o mesmo gesto da agenda: concluir a tarefa (RF-07) ou o
  check-in (RF-08). A tela não grava registro avulso no lugar.
- **RN-19** — Hábito sem atividade ativa abre a folha direto no "Valor livre". Sem nenhum hábito
  ativo, "Hoje no ritmo" não aparece, e a aba Hábitos explica que o hábito se cria pelo assistente
  ou pelo MCP.
- **RN-20** — `check_in_event` manda `origin`: o registro leva a marca de quem registrou (RN-12).

### 5.4 Requisitos não funcionais

- **RNF-06** — `BarrasPorDia` e `Indicador` sobem de `apps/web` para `packages/cliente`, sem mudar
  de desenho. O kit novo nasce em `packages/cliente/src/ritmo/`.
- **RNF-07** — Sem biblioteca de UI nem de gráfico. Os gráficos são SVG ou HTML à mão, com o número
  fora do desenho e um resumo acessível; os emblemas e os ícones novos são SVG em `Icones.tsx`.
- **RNF-08** — Cor nunca é o único sinal: o anel traz o número, o dia de hoje é negrito, o
  hachurado tem legenda, o mapa tem legenda e o título de cada célula.
- **RNF-09** — Sem a variante `dark:`. As cores novas (chama, ouro e sucesso) entram no `@theme` e
  em `:root[data-tema="claro"]`. A cor do hábito é a do agente da mesma chave.
- **RNF-10** — Com `prefers-reduced-motion`, o estado final aparece direto: anel e barra sem
  transição, toast sem subir.
- **RNF-11** — O estado do check-in custa uma consulta de registros por leitura da agenda, não uma
  por evento.

### 5.5 Rotas novas ou alteradas

| Método e caminho | O que muda |
|---|---|
| `GET /habits/summary` | Novo (RF-31) |
| `GET /agenda`, `GET /events`, `GET /events/:id` | `checkedIn` em cada evento (RF-28) |

### 5.6 Critérios de aceite

- **CA-11** — A barra mostra Início, Plano, ＋, Ritmo e Assistente. Plano fica ativo em `/agenda` e
  em `/tarefas`, e o seletor troca entre as duas.
- **CA-12** — Com "Inglês" (120, 4 dias) e 40 pts hoje, o detalhe mostra 30 que contam, 10
  hachurados acima da linha do teto, e "+10 XP extra".
- **CA-13** — A folha, com 20 pts hoje e teto 30, avisa "10 contam para a meta; 10 viram XP extra"
  para 20 pts. Registrar soma 20 ao XP e 10 à semana.
- **CA-14** — Concluir em "Hoje no ritmo" uma tarefa ligada a "App" (10) mostra o toast "+10" e
  move o anel do hábito. Desmarcar desfaz.
- **CA-15** — Check-in numa ocorrência de hoje marca a caixa no Início e na Agenda; a agenda
  recarregada traz `checkedIn: true` só naquela ocorrência, e não nas outras da série.
- **CA-16** — `GET /habits/summary` com 60 pts em registros devolve `xp: 60` e o nível 2.
- **CA-17** — Pelo MCP, `check_in_event` faz o check-in e, com `done: false`, desfaz.
- **CA-18** — Os dois temas, em 390 px, sem rolagem lateral; as abas Ofensivas, Skills e Humor dizem
  quando chegam.

### 5.7 Decisões tomadas na implementação (2026-10-18)

- **A curva de nível veio para a Ritmo 2.** O cartão de nível é desta fase, e sem a curva ele não
  teria número. Ofensiva e recorde, que o protótipo põe no mesmo cartão, ficam para a Ritmo 3: no
  lugar deles entram o XP da semana e os dias ativos.
- **`GET /habits/summary`, e não um campo novo em `GET /habits`.** A lista é um array, e mudar a
  forma dela quebraria o MCP no ar. O caminho fixo casa antes de `/habits/:id` no Fastify.
- **`checkedIn: boolean`, sem o id do registro.** A tela só precisa saber se a caixa está marcada,
  e desfazer vai pelo `DELETE /events/:id/check-in?day=`. A janela da consulta recua
  `MAX_DIAS_DO_EVENTO + 1` dias antes de `from`, porque o evento simples que atravessa a borda tem a
  ocorrência no dia em que começa.
- **`check_in_event` está no MCP e fora do chat.** O chat já tem `log_habit`, e mais uma descrição
  seria paga em todo turno (RNF-03). O texto do vínculo nos eventos passou de "check-in, feito no
  app" para "check-in da ocorrência", porque agora o MCP também faz. `list_agenda` diz "check-in
  feito em AAAA-MM-DD".
- **Plano não é uma rota nova.** `/agenda` e `/tarefas` continuam, para não quebrar os links do
  Início e do histórico. O item da barra acende nas duas e leva à última aberta, guardada na memória
  do módulo (`lib/plano.ts`), sem `sessionStorage`.
- **As abas do Ritmo e o seletor de Plano são links com `aria-current`, não `tablist`.** Cada aba é
  uma rota que o Voltar desfaz.
- **`invalidarAgenda` também invalida `["habitos"]`.** Concluir uma tarefa ligada pontua, e quem
  conclui não deveria precisar saber disso. No web, que não lê hábitos, não custa nada.
- **O toast calcula o ganho antes da resposta** (`ganhoNaSemana`, pela mesma `quantoConta` do
  servidor), e aparece só depois que a API confirma. Desfazer não tem toast. Registro fora da
  semana corrente também não, porque a conta da semana não vale para ele.
- **O check-in no `ItemAgenda` é opt-in por tela (`onCheckIn`).** Início e Agenda passam. Projeto
  não passa, porque mostra os próximos dias, que estão no futuro.
- **Cores novas:** `chama-500/600/300`, `ouro-500/300` e `sucesso-500/300`, nos dois temas. O
  selo do nível usa `chama-600`, porque o gradiente ouro→chama do protótipo não passa 3:1 com o
  número branco. O toast fica sobre `superficie`, sem inverter, para o "+N" em `chama-300` passar
  4,5:1.
- **Ficou de fora:** criar e editar hábito pela tela, ligar tarefa ou evento a uma atividade pelo
  formulário do móvel, a linha "Evento · ter e qui, 19:00" de cada atividade (pediria uma consulta
  reversa do vínculo), recordes e a ofensiva do hábito (Ritmo 3), e o "play" do foco (Ritmo 6).
- **Portões:** `pnpm typecheck` limpo. API com 689 de 690 testes passando: a falha é
  `web.test.ts › DNS rebinding`, que sobe um servidor em `127.0.0.2`, endereço que o macOS não tem
  sem alias de loopback (`EADDRNOTAVAIL`), e não toca nesta fase. MCP com 113 de 113. A interface
  foi conferida no navegador em 375 px, nos dois temas: Início com "Hoje no ritmo" (concluir,
  check-in e toast), Ritmo, as abas "em breve", o detalhe, a folha (aviso do teto e registro) e o
  seletor de Plano.

## 6. Ritmo 3 — Ofensivas, níveis e recordes

> Detalhado em 2026-10-18. A curva de nível já veio na Ritmo 2 (RN-15); aqui entram as
> sequências e os recordes, tudo calculado na leitura (P3).

### 6.1 Requisitos funcionais

- **RF-32** — Ofensiva geral: dias civis seguidos com pelo menos um registro de hábito, terminando
  hoje ou ontem. Se hoje ainda não tem registro, a ofensiva segue viva até a meia-noite, e a tela
  avisa que hoje está pendente. A Ritmo 4 soma o check-in de humor a estes dias.
- **RF-33** — Ofensiva do hábito: semanas seguidas com `goalMet`. A semana corrente só entra quando
  já bateu a meta; antes disso, a sequência que fechou na semana passada continua viva.
- **RF-34** — Recordes: as 5 maiores sequências de dias, as 5 maiores sequências de semanas
  (entre todos os hábitos, cada uma com o nome do hábito) e as 5 semanas com mais pontos (somando
  os hábitos). Cada item diz o período e se ainda está em andamento.
- **RF-35** — `GET /habits/streaks` devolve tudo isso numa leitura, mais os dias ativos dos
  últimos 400 dias, que o calendário usa. `GET /habits/summary` ganha `streak`, com a ofensiva
  geral, o recorde dela e se hoje já conta.
- **RF-36** — Ritmo › Ofensivas: o cartão da chama com a ofensiva geral e a barra até o recorde, o
  calendário do mês com a faixa contínua dos dias seguidos e a contagem de dias ativos e perdidos,
  e o ranking pessoal com três abas (Dias seguidos, Hábitos, Semanas).
- **RF-37** — Início: o cartão da chama, com a ofensiva, a frase do recorde e os sete dias da
  semana (feito, hoje, por vir).
- **RF-38** — Hábitos: a grade mostra a ofensiva de cada hábito ("5 semanas" ou "comece hoje"), e
  o detalhe mostra a ofensiva e dois recordes do hábito: a melhor semana em pontos e a maior
  sequência de semanas.
- **RF-39** — Folha de conquista, só para marcos raros: a meta da semana de um hábito batida por
  um gesto do app e o nível novo. Nunca a cada check.

### 6.2 Regras de negócio

- **RN-21** — Os dias e as semanas são civis, no fuso do usuário (INV-66), e as semanas vão de
  segunda a domingo, como em RF-10.
- **RN-22** — Em sequências do mesmo tamanho, a mais recente fica na frente.
- **RN-23** — A semana passada é avaliada com a meta e os dias-alvo **atuais** do hábito. O
  registro guarda os pontos (P5), mas não a meta da época, e mudar a meta reescreve as semanas que
  já contavam. É a troca consciente por não gravar agregado (P3).
- **RN-24** — A semana com mais pontos soma `points`, não `counted`: é recorde de XP, e não de meta.
- **RN-25** — O calendário vai até 400 dias para trás (`MAX_DIAS_DO_HISTORICO`). Antes disso, a tela
  não navega.

### 6.3 Requisitos não funcionais

- **RNF-12** — As sequências saem de funções puras de `packages/shared` (`sequenciasDeDias`,
  `sequenciasDeSemanas`), testáveis sem banco.
- **RNF-13** — `GET /habits/streaks` faz duas consultas agrupadas: dias ativos e pontos por hábito
  e dia. Nenhuma consulta por hábito.
- **RNF-14** — O cartão da chama é o único de cor cheia. O texto branco vai sobre `chama-600` ou
  mais escuro, para passar o contraste de texto grande.

### 6.4 Critérios de aceite

- **CA-19** — Registros em hoje, ontem e anteontem, com um buraco antes, dão uma ofensiva de 3 com
  `todayDone`. Sem o de hoje, ela é 2 e continua viva.
- **CA-20** — Um hábito com a meta batida nas duas semanas anteriores e não na corrente tem
  ofensiva 2; batendo a corrente, 3.
- **CA-21** — O ranking põe a sequência viva com `alive: true` e ordena pelo tamanho.
- **CA-22** — A semana com mais pontos soma acima do teto.
- **CA-23** — No móvel, a aba Ofensivas mostra o calendário com a faixa, os dias perdidos e o
  ranking nas três abas. O Início mostra a chama.

### 6.5 Decisões tomadas na implementação (2026-10-18)

- **Uma rota de leitura, `GET /habits/streaks`, e a ofensiva geral também no resumo.** O resumo é
  barato e serve ao MCP numa fase futura; a tela lê a rota inteira, porque o calendário e a semana
  da chama precisam dos dias ativos.
- **Sem tool no MCP nesta fase.** O PRD não pedia (§3: shared, api, movel). `list_habits` segue sem
  ofensiva.
- **Recordes incluem hábitos arquivados.** O recorde é do usuário. `habits[]` traz `archived`, para
  a tela decidir.
- **A meta antiga não é guardada (RN-23).** Mudar a meta reescreve as semanas passadas. Gravar a
  meta da época pediria um agregado, e P3 não deixa.
- **A medalha do pódio é um anel de token** (ouro, `ink-400`, `chama-600`) com o número em
  `titulo`, e não os gradientes do protótipo, que não passavam contraste com o número branco.
- **A folha de conquista** abre no gesto que fecha a meta da semana (no lugar do toast) e quando o
  nível sobe com o app aberto. O primeiro nível lido na sessão é o ponto de partida, não uma
  conquista. Bater recorde não abre folha: a lista já sobe na hora.
- **Portões:** typecheck limpo; API com 695 de 696 testes passando (a mesma falha de ambiente de
  `web.test.ts`, §5.7); MCP com 113 de 113. A interface foi conferida em 375 px:
  - Ofensivas: chama, calendário com a faixa e os dias perdidos, e o ranking;
  - a chama do Início acendendo ao concluir;
  - a pílula da grade;
  - os recordes do detalhe;
  - a folha de conquista, ao fechar a meta de Corpo.

## 7. Fases seguintes (escopo, detalhado quando cada uma começar)

### Ritmo 3 — Ofensivas, níveis e recordes

- **Ofensiva geral:** dias seguidos com qualquer registro de hábito ou check-in de humor.
- **Ofensiva do hábito:** semanas seguidas com `goalMet`.
- **Recordes:** as 5 maiores sequências de cada tipo, mais as melhores semanas por pontos.
- **XP e nível:** a curva veio antes, na Ritmo 2 (RN-15), porque o cartão de nível é dela.
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
