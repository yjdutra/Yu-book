# PRD — Yu-book Fase 2: Workspaces globais + Kanban

**Versão:** v0.1 (draft) · **Autor:** Yuri · **Data:** 2026-08-14 · **Status:** rascunho

Contexto anterior: [PROPOSTA.md](../PROPOSTA.md) (escopo geral), [README.md](../README.md) (Fases 0 e 1
concluídas) e [docs/prd-fase-1-notas.md](prd-fase-1-notas.md).

---

## 1. Contexto e problema

A Fase 1 entregou o núcleo do Yu-book: notas, busca, tags e links. O que ela **não** resolve é a
outra metade da jornada na Coders — o que está *em andamento*. Um projeto de módulo tem etapas, uma
candidatura tem estágios, um estudo tem "quero ver isso ainda". Hoje isso não existe em lugar
nenhum: nota é registro do que passou, não fila do que vem.

O segundo problema é de contexto. Workspace já existe no banco desde a Fase 0 e na barra lateral
desde a Fase 1, mas hoje ele é **mais um filtro entre outros** — no mesmo nível de "favoritas" ou
de uma tag. A proposta previa outra coisa: um seletor global no topo que troca o contexto da
aplicação inteira, de forma que estar em `Coders` signifique ver notas da Coders e boards da
Coders, sem refiltrar a cada tela. Sem isso, cada módulo novo (kanban agora, empresas e calendário
na Fase 3) repete o mesmo seletor de workspace na própria tela, e a aplicação vira sete telas que
não conversam — exatamente o risco que a seção 1 da proposta existe para evitar.

As tabelas `board`, `board_column` e `card` já foram criadas na migration inicial, com `position`,
`wip_limit`, `checklist` (JSONB) e `note_id`. Nada disso está exposto: não há endpoint nem tela.

Esta fase transforma workspace em contexto, expõe o kanban e liga card ↔ nota nos dois sentidos —
o que faz o quadro de "estou implementando refresh token" apontar para a nota da aula onde o
assunto foi explicado.

Prazo-alvo: **3–4 dias de trabalho**, conforme o roadmap da proposta.

---

## 2. Objetivos

- **O1** — Trocar o contexto da aplicação inteira em um clique: escolher um workspace filtra notas,
  busca e boards ao mesmo tempo, e a escolha sobrevive a recarregar a página.
- **O2** — Manter um board utilizável de verdade: criar colunas, criar cards, arrastar entre
  colunas e ver o estado do trabalho sem sair da tela.
- **O3** — Mover um card por teclado, com a mesma completude do mouse — a regra teclado-primeiro da
  Fase 1 não regride no kanban.
- **O4** — Ligar card e nota nos dois sentidos: o card mostra a nota; a nota mostra os cards que a
  referenciam, ao lado do "Referenciada por".
- **O5** — Não perder nem embaralhar ordenação: a posição dos cards depois de qualquer sequência de
  movimentos é determinística e sem buracos.

### 2.1 Métricas de sucesso

| | Métrica | Baseline | Alvo | Prazo |
|---|---|---|---|---|
| **M1** | p95 de `GET /boards/:id` (board completo, 4 colunas, 200 cards) | não existe | ≤ 200 ms | entrega |
| **M2** | p95 de `PATCH /cards/:id/move` | não existe | ≤ 150 ms | entrega |
| **M3** | Tempo entre soltar o card e ele aparecer na coluna nova (UI otimista) | não existe | ≤ 50 ms | entrega |
| **M4** | Divergência de ordenação após 200 movimentos aleatórios (posições duplicadas ou com buraco) | não existe | 0 | entrega |
| **M5** | Cards criados nas 2 primeiras semanas de uso real | 0 | ≥ 30 | 2 semanas após deploy |
| **M6** | Cards com nota vinculada ao fim do primeiro mês | 0 | ≥ 25% | 1 mês após deploy |
| **M7** | Trocas de workspace pelo seletor global por semana de uso | 0 | ≥ 5 | 1 mês após deploy |

M5–M7 medem se a ferramenta é boa o bastante para você usar. M7 em zero significa que o seletor
global não se pagou e workspace deveria ter continuado sendo um filtro simples.

---

## 3. Não-objetivos

- **NO1** — Empresas e calendário (Fase 3). O reaproveitamento do kanban como pipeline de
  candidaturas é decisão da Fase 3, não desta.
- **NO2** — Dashboard agregado com "prazos próximos" e export (Fase 4).
- **NO3** — Busca semântica (Fase 5).
- **NO4** — Mover card entre **boards** diferentes. Movimento é dentro de um board.
- **NO5** — Swimlanes, subtarefas como cards, dependências entre cards, gráfico de burndown.
- **NO6** — Etiquetas/labels próprias do card. O card já tem prioridade e prazo; tags são de nota.
- **NO7** — Comentários, histórico de atividade, log de movimentações do card.
- **NO8** — Múltiplos boards abertos lado a lado, ou visão "todos os cards de todos os boards".
- **NO9** — Templates de board ou de card, cards recorrentes, automações ("ao mover para Feito…").
- **NO10** — Anexos e imagens no card — mesma restrição da Fase 1 (NO6 de lá): não há storage.
- **NO11** — Colaboração, atribuição de responsável, tempo real. Usuário único.
- **NO12** — Layout responsivo/mobile. Continua desktop-only (RNF-01 da Fase 1).
- **NO13** — Ícone de workspace. A proposta cita `icon`; nesta fase o workspace é identificado por
  nome + cor, e a coluna `icon` fica sem uso.
- **NO14** — Reordenar workspaces por arrasto. A coluna `position` existe, mas a ordenação é
  alfabética nesta fase.

---

## 4. Personas e usuários-alvo

**Usuário único: você.** Sem papéis nem permissões.

Contextos de uso que moldam os requisitos desta fase:

| Contexto | Frequência | O que exige da interface |
|---|---|---|
| **Planejando a semana** — criando e reordenando cards em lote | semanal | criar card sem sair do teclado, arrastar rápido, sem diálogo a cada card |
| **No meio do trabalho** — movendo um card de coluna, marcando checklist | diária | 2 cliques no máximo; movimento otimista, sem espera de rede |
| **Estudando** — indo do card para a nota da aula e voltando | várias vezes por semana | ida e volta card ↔ nota em um clique de cada lado |
| **Trocando de frente** — sair da Coders e entrar em Trabalho | diária | um seletor, um clique, aplicação inteira acompanha |

---

## 5. Requisitos funcionais

### 5.1 Workspace como contexto global

- **RF-01** — A aplicação mantém um **workspace ativo**, escolhido em um seletor no topo da coluna
  de navegação, com as opções sendo os workspaces do usuário mais "Todos os workspaces".
- **RF-02** — O workspace ativo filtra simultaneamente: a lista de notas, a paleta de busca
  (`Ctrl+K`) e a lista de boards.
- **RF-03** — Com "Todos os workspaces" ativo, nenhum filtro de workspace é aplicado em nenhuma
  tela.
- **RF-04** — O workspace ativo é persistido em `localStorage` e restaurado ao abrir a aplicação.
  Se o workspace salvo não existe mais, o sistema volta para "Todos os workspaces".
- **RF-05** — Criar uma nota ou um card com um workspace ativo pré-seleciona esse workspace.
- **RF-06** — O filtro `#workspace` digitado na paleta de busca **sobrepõe** o workspace ativo
  naquela busca, sem alterar o workspace ativo.
- **RF-07** — A seção "Workspaces" da barra lateral da Fase 1 é substituída pelo seletor; a barra
  lateral deixa de listar workspaces como filtros individuais.
- **RF-08** — O seletor oferece criar, renomear, recolorir e excluir workspace — as operações que a
  Fase 1 já expunha na barra lateral, sem perda de função.
- **RF-09** — Excluir um workspace com boards exige confirmação que informa **quantos boards e
  cards serão excluídos junto** (ver RN-06); as notas do workspace continuam existindo.

### 5.2 Boards

- **RF-10** — O sistema permite criar um board informando nome e workspace. Board **sempre**
  pertence a um workspace.
- **RF-11** — A tela de boards lista os boards do workspace ativo; com "Todos os workspaces", lista
  todos, agrupados por workspace.
- **RF-12** — O sistema permite renomear e excluir um board. Excluir exige confirmação com a
  contagem de cards que serão perdidos.
- **RF-13** — Ao abrir um board, o sistema retorna colunas e cards em **uma única requisição**.
- **RF-14** — Todo board novo nasce com três colunas: `A fazer`, `Fazendo`, `Feito`.
  [SUPOSIÇÃO S-03]

### 5.3 Colunas

- **RF-15** — O sistema permite criar, renomear e excluir colunas de um board.
- **RF-16** — Excluir uma coluna **com cards** exige escolher entre mover os cards para outra coluna
  ou excluí-los junto.
- **RF-17** — O sistema permite reordenar colunas por arrasto.
- **RF-18** — Cada coluna aceita um limite de WIP opcional (`wip_limit`).
- **RF-19** — Uma coluna que ultrapassa o limite de WIP é sinalizada visualmente sem impedir o
  movimento (ver RN-05).
- **RF-20** — O cabeçalho da coluna exibe a contagem de cards e, quando há limite, no formato
  `4/3`.

### 5.4 Cards

- **RF-21** — O sistema permite criar um card informando apenas o título, direto no rodapé da
  coluna, sem abrir painel.
- **RF-22** — Após criar um card pelo rodapé da coluna, o campo permanece focado e vazio, pronto
  para o próximo — criar 5 cards seguidos não exige tocar no mouse.
- **RF-23** — O card tem: título, descrição em Markdown, prazo, prioridade (`baixa`/`media`/`alta`),
  checklist e vínculo opcional a uma nota.
- **RF-24** — O sistema permite mover um card entre colunas e reordená-lo dentro da coluna por
  arrasto.
- **RF-25** — O sistema permite mover um card inteiramente por teclado: `Espaço` pega o card, as
  setas movem entre posições e colunas, `Espaço` solta, `Esc` cancela e devolve o card à origem.
- **RF-26** — O movimento é aplicado na interface imediatamente (otimista) e revertido, com
  mensagem de erro, se a API recusar.
- **RF-27** — O painel de detalhe do card abre à direita do board, sem cobrir as colunas e sem
  modal.
- **RF-28** — A descrição do card usa o mesmo editor Markdown da nota, em coluna única com preview
  alternável — não split.
- **RF-29** — A descrição do card salva automaticamente com o mesmo comportamento da nota: debounce
  de 800 ms, `Ctrl+S` imediato e indicador de estado.
- **RF-30** — O checklist permite adicionar, marcar, desmarcar, editar texto, remover e reordenar
  itens.
- **RF-31** — A face do card no board exibe: título, e — quando existirem — prazo, prioridade,
  progresso do checklist (`2/5`) e um indicador de nota vinculada.
- **RF-32** — Um card com prazo vencido é destacado na face; um com prazo em até 48 h recebe
  destaque distinto do vencido.
- **RF-33** — O sistema permite arquivar e desarquivar um card. Card arquivado sai do board e fica
  acessível em um painel "Arquivados" do próprio board.
- **RF-34** — O sistema permite excluir um card definitivamente, com confirmação. Não há lixeira de
  card. [SUPOSIÇÃO S-04]

### 5.5 Vínculo card ↔ nota

- **RF-35** — O painel do card permite vincular uma nota por busca de título, com autocomplete.
- **RF-36** — O painel do card permite desvincular a nota e criar uma nota nova já vinculada, com o
  título do card pré-preenchido.
- **RF-37** — Clicar na nota vinculada abre a nota na tela de notas.
- **RF-38** — A nota exibe, no rodapé, a seção "Em cards" com os cards que a referenciam — board,
  coluna e título de cada um —, ao lado da seção "Referenciada por" da Fase 1.
- **RF-39** — Clicar em um card dessa lista abre o board correspondente com o painel do card
  aberto.
- **RF-40** — Excluir uma nota (lixeira) não exclui os cards vinculados: o vínculo é desfeito e o
  indicador some da face do card.

### 5.6 Busca

- **RF-41** — A paleta `Ctrl+K` passa a retornar também cards, identificados por um rótulo de tipo
  distinto do de nota e pelo nome do board.
- **RF-42** — Cards são encontrados por semelhança de título, sem acento e tolerante a erro de
  digitação, pelo mesmo mecanismo de trigrama já usado no fallback de notas.
- **RF-43** — Abrir um card pela paleta navega para o board com o painel do card aberto.
- **RF-44** — Cards arquivados não aparecem na paleta.
- **RF-45** — A paleta aceita o filtro digitado `tipo:card`, restringindo os resultados a cards.

---

## 6. Requisitos não-funcionais

### 6.1 Interação e teclado

- **RNF-01 Teclado-primeiro** — Novos atalhos: `Ctrl+B` **não** é reaproveitado (é negrito no
  editor); a tela de boards abre por `Ctrl+Shift+B`, criar card na coluna focada por `N`, abrir o
  painel do card por `Enter`, fechar por `Esc`. `Ctrl+/` passa a listar também estes.
- **RNF-02 Arrasto acessível** — O arrasto usa uma biblioteca com sensor de teclado e anúncios em
  região `aria-live` ("Card X pego", "movido para Fazendo, posição 2", "solto"). Arrasto que só
  funciona com mouse não atende RF-25.
- **RNF-03 Sem modais no caminho de escrita** — Criar card, mover card, editar checklist e vincular
  nota não abrem diálogo modal. Confirmação modal só em exclusão (board, coluna com cards, card).
- **RNF-04 Foco previsível** — Ao fechar o painel do card com `Esc`, o foco volta para o card no
  board. Ao excluir um card, o foco vai para o card seguinte da mesma coluna.

### 6.2 Layout

- **RNF-05 Desktop-only** — Mantido da Fase 1: viewport ≥ 1280 × 720; abaixo de 1024 px, aviso.
- **RNF-06 Colunas roláveis** — O board rola horizontalmente quando as colunas excedem a largura;
  cada coluna rola verticalmente de forma independente, com o cabeçalho e o campo de novo card
  fixos.
- **RNF-07 Cor nunca sozinha** — Prioridade, prazo vencido, WIP estourado e nota vinculada são
  distinguíveis sem depender de cor (texto, ícone ou traçado).
- **RNF-08 Contraste e foco** — Mantidos da Fase 1: WCAG AA (4,5:1 texto normal, 3:1 interface) e
  indicador de foco visível em todo elemento interativo, incluindo cards.

### 6.3 Desempenho

- **RNF-09** — `GET /boards/:id`: p95 ≤ 200 ms com 4 colunas e 200 cards (M1).
- **RNF-10** — `PATCH /cards/:id/move`: p95 ≤ 150 ms (M2).
- **RNF-11** — O movimento não aguarda rede: a interface reordena localmente e concilia na resposta
  (M3).
- **RNF-12** — Nenhuma query desta fase faz varredura sequencial em `card`. A listagem do board usa
  `(column_id, position)`; os cards de uma nota usam o índice novo em `card(note_id)`; a busca de
  card usa índice trigram em `card(title)`. Verificável por `EXPLAIN`.
- **RNF-13** — O board é carregado com uma única requisição (RF-13) — nunca uma por coluna.

### 6.4 Segurança e integridade

- **RNF-14** — Todo endpoint exige autenticação e resolve a posse via `board.user_id`. Como `card` e
  `board_column` não têm `user_id` próprio, toda operação sobre eles verifica a cadeia
  card → coluna → board → usuário **na mesma query**, nunca em duas etapas.
- **RNF-15** — Um id de card, coluna ou board de outro usuário responde `404`, nunca `403` — não
  revela existência.
- **RNF-16** — A descrição do card e o texto do checklist são sanitizados na renderização, com o
  mesmo pipeline da nota.
- **RNF-17** — Toda reordenação acontece em uma única transação. Uma falha no meio não deixa
  posições duplicadas nem com buraco (RN-01).
- **RNF-18** — Limites: título do card 200 caracteres; descrição 100 KB; checklist 50 itens de até
  200 caracteres; 20 colunas por board; nome de coluna e de board 60 caracteres.

### 6.5 Estados vazios e de erro

- **RNF-19** — Estados vazios próprios e acionáveis: nenhum board no workspace, board sem colunas,
  coluna sem cards, painel de arquivados vazio, nota sem cards vinculados.
- **RNF-20** — Falha ao mover um card devolve o card à posição de origem com animação e mostra erro
  persistente, sem recarregar o board inteiro.

---

## 7. Modelo de dados

As tabelas `board`, `board_column` e `card` existem desde a Fase 0. Esta fase exige **quatro
alterações**, todas de índice ou restrição:

| Mudança | Onde | Por quê |
|---|---|---|
| índice em `card(note_id)` | `card` | "Em cards" na nota (RF-38) sem varredura |
| índice GIN trigram em `card(title)` sem acento | `card` | busca de card na paleta (RF-42) |
| `UNIQUE (board_id, name)` | `board_column` | duas colunas "Feito" no mesmo board é erro de digitação, não intenção |
| `UNIQUE (workspace_id, name)` | `board` | mesma razão, por workspace [SUPOSIÇÃO S-05] |

Entidades e atributos usados nesta fase:

| Entidade | Atributos | Relações |
|---|---|---|
| `Board` | `name`, `position` | pertence a `User` e a `Workspace` (obrigatório); tem `BoardColumn[]` |
| `BoardColumn` | `name`, `position`, `wipLimit` | pertence a `Board`; tem `Card[]` |
| `Card` | `title`, `descriptionMd`, `position`, `dueDate`, `priority`, `checklist` (JSONB), `archived` | pertence a `BoardColumn`; opcionalmente a `Note` |

**Forma do `checklist`** (validada por Zod em `packages/shared`, escrita e lida sempre pelo mesmo
schema):

```json
[{ "id": "c1", "text": "Ler a RFC", "done": false }]
```

**Invariantes:**

- `position` dos cards **ativos** de uma coluna, e das colunas de um board, é uma sequência de
  inteiros **contígua a partir de 0**, sem buraco e sem repetição (RN-01).
- Card arquivado mantém `column_id` e sai da contagem de posições — desarquivar o devolve à mesma
  coluna, no fim. Manter a posição antiga do arquivado abriria buraco na fila dos ativos.
- `card.note_id` aponta para nota não excluída; a lixeira desfaz o vínculo (RF-40).
- Excluir workspace exclui seus boards em cascata (já é o comportamento do schema); excluir board
  exclui colunas e cards em cascata.

---

## 8. Fluxos principais

### Fluxo A — Trocar de contexto

1. Você está em "Todos os workspaces", vendo tudo.
2. Clica no seletor no topo e escolhe `Coders`.
3. A lista de notas passa a mostrar só notas da Coders; a paleta `Ctrl+K` passa a buscar só nelas.
4. Você abre a tela de boards: só os boards da Coders aparecem.
5. Recarrega a página no dia seguinte: continua em `Coders`.

### Fluxo B — Planejar a semana

1. `Ctrl+Shift+B` abre a tela de boards; você abre "Módulo 3".
2. Clica no campo do rodapé da coluna "A fazer" e digita `Exercício de JWT`, `Enter`.
3. O campo continua focado e vazio; você digita mais quatro títulos, um por `Enter`.
4. Arrasta o primeiro card para "Fazendo".
5. A coluna "Fazendo" tem limite 3 e agora está com 4: o cabeçalho mostra `4/3` sinalizado, e o
   movimento acontece do mesmo jeito.

### Fluxo C — Do card para a nota e de volta

1. Você abre o card "Exercício de JWT"; o painel abre à direita.
2. Em "Nota vinculada", digita `jwt`; o autocomplete mostra "Autenticação com JWT" e você vincula.
3. A face do card passa a exibir o indicador de nota vinculada.
4. Clicando no nome da nota, você vai para a tela de notas com ela aberta.
5. No rodapé da nota, a seção "Em cards" lista "Exercício de JWT — Módulo 3 / Fazendo".
6. Clicando ali, você volta para o board com o painel do card aberto.

### Fluxo D — Mover um card sem mouse

1. Com o board aberto, você chega a um card com `Tab`/setas.
2. `Espaço` pega o card; o leitor de tela anuncia "Exercício de JWT pego, A fazer, posição 1".
3. `→` move para "Fazendo"; `↓` desce uma posição.
4. `Espaço` solta. O anúncio confirma a posição final.
5. `Esc` durante o arrasto teria devolvido o card à posição original.

---

## 9. Regras de negócio

- **RN-01 Posição é contígua** — Depois de qualquer movimento, os cards de cada coluna afetada têm
  `position` 0, 1, 2… sem buraco e sem repetição. A renumeração das colunas de origem e destino
  acontece na mesma transação do movimento. A mesma regra vale para colunas dentro do board.
- **RN-02 Movimento é por índice de destino** — `PATCH /cards/:id/move` recebe `{ columnId,
  position }`, onde `position` é o índice desejado **na coluna de destino, já sem o card de
  origem**. Valor fora do intervalo é ajustado para o limite mais próximo, não recusado.
- **RN-03 Board pertence a um workspace** — Não existe board sem workspace. Se o último workspace
  for excluído, não há board para exibir, e a tela mostra o estado vazio pedindo um workspace novo.
- **RN-04 Card não atravessa boards** — O destino de um movimento é sempre uma coluna do mesmo
  board. Um destino de outro board é recusado com erro de validação (NO4).
- **RN-05 Limite de WIP avisa, não bloqueia** — Ultrapassar o limite sinaliza a coluna e nada mais.
  Bloquear um movimento em uma ferramenta de um usuário só cria contorno. [SUPOSIÇÃO S-06]
- **RN-06 Exclusão em cascata é anunciada** — Excluir workspace ou board informa, na confirmação, a
  contagem exata de boards e cards que serão perdidos. Cards não têm lixeira (S-04), então a
  confirmação é a única rede de proteção.
- **RN-07 Nota na lixeira desvincula** — Enviar uma nota para a lixeira zera `card.note_id` dos
  cards que a referenciam. Restaurar a nota **não** restaura os vínculos. [SUPOSIÇÃO S-07]
- **RN-08 Última escrita vence** — Mantido da Fase 1 (RN-06 de lá): sem detecção de conflito.
- **RN-09 Tudo filtra por usuário** — Nenhuma consulta desta fase alcança dado de outro usuário; a
  posse é sempre resolvida por `board.user_id` (RNF-14).

---

## 10. Critérios de aceitação

**Workspace global**

- **CA-01** (RF-02) — Dado o workspace `Coders` ativo, então a lista de notas, a paleta `Ctrl+K` e a
  lista de boards mostram apenas itens da Coders.
- **CA-02** (RF-04) — Dado o workspace `Coders` ativo, quando recarrego a página, então ele continua
  ativo.
- **CA-03** (RF-04) — Dado um workspace ativo que foi excluído em outra aba, quando recarrego, então
  a aplicação abre em "Todos os workspaces", sem tela de erro.
- **CA-04** (RF-06) — Dado o workspace `Coders` ativo, quando busco `#trabalho jwt` na paleta, então
  os resultados vêm do workspace `Trabalho` e o workspace ativo continua sendo `Coders`.
- **CA-05** (RF-09, RN-06) — Dado um workspace com 2 boards e 30 cards, quando peço para excluí-lo,
  então a confirmação informa "2 boards e 30 cards" e, ao confirmar, as notas do workspace
  continuam existindo.

**Board e colunas**

- **CA-06** (RF-13, RNF-13) — Dado um board com 4 colunas, quando eu o abro, então **uma** requisição
  é feita à API e o board renderiza completo.
- **CA-07** (RF-14) — Dado um workspace sem boards, quando crio o primeiro, então ele nasce com as
  colunas `A fazer`, `Fazendo` e `Feito`.
- **CA-08** (RF-16) — Dada uma coluna com 5 cards, quando peço para excluí-la, então o sistema exige
  escolher entre mover os cards para outra coluna ou excluí-los, e a escolha é respeitada.
- **CA-09** (RF-17, RN-01) — Dado um board com 4 colunas, quando arrasto a última para a primeira
  posição, então as posições ficam 0,1,2,3 sem repetição.
- **CA-10** (RF-19, RN-05) — Dada uma coluna com limite 3 e 3 cards, quando movo um quarto card para
  ela, então o movimento é concluído e o cabeçalho exibe `4/3` sinalizado.

**Cards e movimento**

- **CA-11** (RF-22) — Dado o campo de novo card focado, quando digito um título e pressiono `Enter`
  cinco vezes seguidas com títulos diferentes, então 5 cards são criados na ordem digitada, sem
  tocar no mouse.
- **CA-12** (RF-24, RN-01) — Dados 3 cards em "A fazer" e 2 em "Fazendo", quando arrasto o card do
  meio de "A fazer" para o topo de "Fazendo", então "A fazer" fica com posições 0,1 e "Fazendo" com
  0,1,2, com o card movido em 0.
- **CA-13** (RF-25) — Dado um card com foco, quando pressiono `Espaço`, `→`, `↓`, `Espaço`, então o
  card está na coluna seguinte, uma posição abaixo do topo, sem uso de mouse.
- **CA-14** (RF-25) — Dado um card pego por teclado, quando pressiono `Esc`, então ele volta à
  coluna e posição originais.
- **CA-15** (RNF-02) — Dado um leitor de tela ativo, quando pego, movo e solto um card, então cada
  etapa é anunciada por `aria-live`.
- **CA-16** (RF-26, RNF-20) — Dada a API fora do ar, quando arrasto um card, então ele aparece na
  coluna nova imediatamente, volta para a origem ao falhar, e um erro persistente é exibido — sem
  recarregar o board.
- **CA-17** (M4, RN-01) — Dados 200 movimentos aleatórios executados em sequência, então nenhuma
  coluna tem posição repetida ou com buraco.
- **CA-18** (RF-29) — Dado o painel do card aberto, quando digito na descrição e paro por 800 ms,
  então o indicador vai de `salvando…` a `salvo HH:MM`, e reabrir o card mostra o texto.
- **CA-19** (RF-31) — Dado um card com prazo, prioridade alta, checklist 2/5 e nota vinculada, então
  a face exibe os quatro indicadores.
- **CA-20** (RF-32) — Dados um card com prazo ontem e outro com prazo em 24 h, então os dois têm
  destaques visuais distintos entre si e do card sem prazo.
- **CA-21** (RF-33) — Dado um card arquivado, então ele some do board, aparece em "Arquivados" e,
  ao desarquivar, volta para a mesma coluna.
- **CA-22** (RNF-07) — Dada uma simulação de daltonismo (deuteranopia), então prioridade, prazo
  vencido e nota vinculada continuam distinguíveis.

**Vínculo card ↔ nota**

- **CA-23** (RF-35, RF-38) — Dado um card vinculado à nota "Autenticação com JWT", quando abro essa
  nota, então "Em cards" lista o card com board e coluna.
- **CA-24** (RF-39) — Dado esse item em "Em cards", quando clico nele, então o board abre com o
  painel do card aberto.
- **CA-25** (RF-36) — Dado um card sem nota, quando peço "criar nota vinculada", então uma nota é
  criada com o título do card e já vinculada.
- **CA-26** (RF-40, RN-07) — Dada uma nota vinculada a um card, quando envio a nota para a lixeira,
  então o card continua existindo e sem vínculo.

**Busca e desempenho**

- **CA-27** (RF-41, RF-42) — Dado um card "Exercício de JWT", quando busco `exercicio jwt` na
  paleta, então o card aparece rotulado como card, com o nome do board.
- **CA-28** (RF-45) — Dado o texto `tipo:card jwt` na paleta, então apenas cards são retornados.
- **CA-29** (RF-44) — Dado um card arquivado, então ele não aparece na paleta.
- **CA-30** (RNF-09) — Dado um board com 200 cards, então o p95 de `GET /boards/:id` é ≤ 200 ms em
  100 requisições.
- **CA-31** (RNF-12) — Dado `EXPLAIN` sobre a query de cards de uma nota e sobre a busca de card,
  então ambas usam índice, sem `Seq Scan` em `card`.
- **CA-32** (RNF-15) — Dado o id de um card de outro usuário, quando faço `PATCH /cards/:id`, então
  a resposta é `404`.

---

## 11. Layout de referência

**Tela de board** — a coluna de navegação da Fase 1 permanece; o board ocupa o resto.

```
┌──────────────┬────────────────────────────────────────────┬──────────────────┐
│ Yu-book      │  Módulo 3                       ⚙ arquivados│ Exercício de JWT │
│ ▼ Coders     │                                             │ ──────────────── │
│──────────────│ A fazer    2 │ Fazendo   4/3⚠│ Feito      5 │ Fazendo · alta   │
│ ▸ Notas      │──────────────│───────────────│──────────────│ 📅 16/08 (2 dias)│
│ ▸ Boards     │ Exercício de │ Refresh token │ Setup do     │                  │
│   Módulo 3   │ JWT          │ 📅 16/08 ⬆ 2/5│ projeto      │ Descrição        │
│   Freela     │ 📎 nota      │ 📎 nota       │              │ ┌──────────────┐ │
│──────────────│──────────────│───────────────│──────────────│ │ Implementar  │ │
│ Aulas     12 │ Ler a RFC    │ Testes de     │ Migration    │ │ rotação…     │ │
│ Projetos   4 │ ⬇ baixa      │ integração    │              │ └──────────────┘ │
│              │──────────────│───────────────│──────────────│                  │
│              │ + novo card  │ + novo card   │ + novo card  │ Checklist   2/5  │
│ 🗑 Lixeira   │              │               │              │ ☑ Ler a RFC      │
│ yuri  sair   │              │               │              │ ☐ Rotacionar     │
└──────────────┴──────────────┴───────────────┴──────────────┴──────────────────┘
   240px                    board (rola na horizontal)          420px
```

Regras de layout:

- O seletor de workspace (`▼ Coders`) fica no topo da coluna de navegação e vale para toda a
  aplicação.
- O painel do card ocupa 420 px à direita e **empurra** o board, sem cobri-lo (RF-27).
- Cabeçalho da coluna e campo "+ novo card" ficam fixos; só a lista de cards rola (RNF-06).
- A paleta `Ctrl+K` continua sobreposta e centralizada, agora também com resultados de card.
- Na tela de notas, "Em cards" fica no rodapé do preview, logo abaixo de "Referenciada por".

---

## 12. Dependências, restrições e riscos

### Dependências

- **Uma biblioteca de arrasto com suporte a teclado** (`dnd-kit` ou equivalente que atenda RF-25 e
  RNF-02). É a única dependência nova desta fase.

### Restrições técnicas

- Stack fixa: Fastify + Prisma + Postgres; React + Vite + Tailwind; Zod compartilhado em
  `packages/shared`.
- As tabelas do kanban já existem: esta fase **não** redesenha o schema, só acrescenta índices e
  restrições (seção 7).
- `position` é `Int` no schema — a estratégia é renumeração contígua em transação (RN-01), não
  posição fracionária.
- Sem serviços novos: nada de Redis, fila ou WebSocket.

### Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Retrofit do workspace global quebrar a navegação da Fase 1** | alto; regressão em funcionalidade que já funciona | fazer o seletor primeiro, sozinho, com os CA-01 a CA-04 passando antes de começar o kanban |
| **Renumeração contígua a cada movimento pesar** | baixo com 200 cards por coluna; cresce linearmente | uma `UPDATE … FROM (VALUES …)` por coluna afetada, no máximo duas colunas por movimento; medir com 500 cards antes de fechar a fase |
| **Arrasto acessível consumir mais tempo que o previsto** | médio; é o requisito mais caro da fase | se estourar 1 dia, entregar RF-25 (teclado) e RF-24 (mouse) com a biblioteca padrão e cortar as animações, não a acessibilidade |
| **Busca de card (5.6) esticar o escopo** | médio | é a **primeira coisa a cortar** se a fase passar de 4 dias — o kanban funciona sem ela; o corte custa RF-41 a RF-45 e nada mais |
| **Painel do card virar um segundo editor completo** | médio; duplica o trabalho da Fase 1 | RF-28 fixa: coluna única com preview alternável, reaproveitando o renderer existente. Sem split, sem autocomplete `[[…]]` no card |

---

## 13. Entregas e fases

Três ondas, na ordem. Cada uma é utilizável sozinha.

| Onda | Escopo | Corte se atrasar |
|---|---|---|
| **2a — Workspace global** | RF-01 a RF-09 | não corta: é o que impede a Fase 3 de repetir seletor por tela |
| **2b — Kanban** | RF-10 a RF-40 | corta RF-33/RF-34 (arquivar) antes de qualquer outra coisa |
| **2c — Cards na busca** | RF-41 a RF-45 | corta inteira |

---

## 14. Questões em aberto

- **Q-01** — Com "Todos os workspaces" ativo, criar uma nota ou um card deixa o campo de workspace
  vazio. Isso é aceitável, ou vale forçar a escolha de um workspace na criação? **Impacto:** baixo —
  muda um campo do formulário. Decidível durante a implementação da onda 2a.
- **Q-02** — Cards precisam de tags, ou prioridade + coluna já bastam para organizar? Hoje é NO6.
  **Impacto:** médio — reaproveitaria `tag` e `note_tag` viraria genérico, o que é uma migration não
  trivial. **Decidir só depois de duas semanas de uso real.**
- **Q-03** — Vale um segundo board por workspace na prática, ou você usará um só por frente de
  trabalho? Se for um só, a tela de lista de boards (RF-11) pode virar navegação direta.
  **Impacto:** baixo — economiza uma tela.
- **Q-04** — Q-02 do PRD da Fase 1 (colar imagem na nota) continua pendente e a proposta era decidir
  **antes desta fase**. Se a resposta for "sim", entra como fase própria e desloca a Fase 3.

---

## 15. Suposições assumidas

- **S-01** — **O seletor global filtra a aplicação inteira**, incluindo a tela de notas da Fase 1
  (RF-02). Confirmado por você. Consequência aceita: a barra lateral da Fase 1 muda (RF-07).
- **S-02** — **O arrasto usa biblioteca com sensor de teclado** (RF-25, RNF-02). Confirmado por
  você. Consequência aceita: uma dependência nova no front.
- **S-03** — **Três colunas padrão em todo board novo** (RF-14): `A fazer`, `Fazendo`, `Feito`.
  Justificativa: um board vazio com zero colunas é um estado morto — o usuário precisa criar coluna
  antes de criar qualquer card, e isso vale para o segundo board tanto quanto para o primeiro.
- **S-04** — **Card não tem lixeira** (RF-34), ao contrário da nota. Justificativa: o conteúdo de um
  card é curto e reescrevível; a lixeira da nota existe porque nota é conteúdo escrito com esforço.
  A confirmação de exclusão cobre o acidente. Ver RN-06.
- **S-05** — **Nome de board é único por workspace** e nome de coluna é único por board (seção 7).
  Justificativa: duas colunas "Feito" no mesmo board é sempre erro de digitação.
- **S-06** — **WIP limit avisa, não bloqueia** (RN-05). Justificativa: com um usuário só, bloquear
  gera contorno (criar coluna "Fazendo 2") em vez de disciplina.
- **S-07** — **Restaurar nota da lixeira não restaura vínculos com cards** (RN-07). Justificativa:
  guardar o vínculo desfeito exigiria uma coluna a mais só para isso; o vínculo é refeito em um
  clique.
- **S-08** — **Volume esperado**: até 5 boards, 20 colunas e 500 cards no primeiro ano. É o número
  que dimensiona M1/M2 e o que torna a renumeração contígua suficiente.

---

## 16. Definição de pronto

A Fase 2 está concluída quando:

1. Os 32 critérios de aceitação passam.
2. `pnpm typecheck` e `pnpm build` passam limpos nos três pacotes.
3. Os fluxos A, B, C e D foram executados em navegador real, ponta a ponta.
4. A migration com as quatro alterações da seção 7 foi aplicada em produção.
5. Os testes de integração cobrem `PATCH /cards/:id/move` (incluindo CA-17, os 200 movimentos) e a
   verificação de posse da cadeia card → coluna → board (CA-32).
6. Você planejou **uma semana de verdade** no board em produção e moveu os cards ao longo dela, sem
   tocar no código para isso.

O item 6 é o único que não dá para simular.
