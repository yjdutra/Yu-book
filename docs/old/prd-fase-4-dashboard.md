# PRD — Yu-book Fase 4: Dashboard + tema claro

**Versão:** v0.1 (draft) · **Autor:** Yuri · **Data:** 2026-08-14 · **Status:** rascunho

Contexto anterior: [PROPOSTA.md](../PROPOSTA.md), [README.md](../README.md) (Fases 0 a 3
concluídas), [prd-fase-1-notas.md](prd-fase-1-notas.md), [prd-fase-2-kanban.md](prd-fase-2-kanban.md)
e [prd-fase-3-links.md](prd-fase-3-links.md).

---

## 1. Contexto e problema

O Yu-book tem quatro lugares onde algo pode estar esperando por você: uma nota que ficou pela
metade, um card com prazo, uma coluna que passou do limite de WIP e uma fila de links que só
cresce. Hoje, descobrir isso exige **visitar os quatro** — abrir cada board para ver prazos, abrir a
gaveta para ver a fila, olhar a lista para lembrar onde parou.

O custo aparece no começo do dia. Você abre a aplicação e ela mostra a última nota que estava
aberta, que é informação sobre o passado. O que falta é a pergunta oposta: **o que precisa de mim
agora?**

A segunda parte desta fase é diferente em natureza. A aplicação é dark-only desde a Fase 1 — foi
uma decisão consciente para não dobrar o trabalho de cor e contraste enquanto o resto era
construído. Agora que a interface parou de mudar de forma, suportar tema claro deixou de ser
retrabalho garantido e virou uma escolha de conforto: aula de manhã, sala clara, tela escura
cansando a vista.

Duas entregas independentes, sem relação entre si além de caberem no mesmo intervalo. Nenhuma cria
tabela nova — **esta é a primeira fase sem migration**.

Prazo-alvo: **2 dias de trabalho**, sendo aproximadamente metade para cada.

---

## 2. Objetivos

- **O1** — Responder "o que precisa de mim agora?" em uma tela, sem clicar em nada: prazos vencidos
  e da semana, onde você parou de escrever, e o tamanho da fila de links.
- **O2** — Fazer isso em **uma** requisição, para que a tela inicial não seja a mais lenta da
  aplicação.
- **O3** — Nunca esconder um prazo vencido. Se existe card com prazo passado, ele aparece primeiro,
  sempre.
- **O4** — Oferecer tema claro sem duplicar decisão de cor: um mesmo componente serve aos dois
  temas, e a troca vive inteira no CSS.
- **O5** — Manter o contraste WCAG AA (RNF-07 da Fase 1) nos **dois** temas, não só no escuro.

### 2.1 Métricas de sucesso

| | Métrica | Baseline | Alvo | Prazo |
|---|---|---|---|---|
| **M1** | Requisições para montar a tela inicial | não existe | 1 | entrega |
| **M2** | p95 de `GET /dashboard` | não existe | ≤ 150 ms | entrega |
| **M3** | Tempo do login até a tela inicial pintada com dados | não existe | ≤ 800 ms | entrega |
| **M4** | Pares texto/fundo abaixo de 4,5:1, somando os dois temas | desconhecido | 0 | entrega |
| **M5** | Piscada de tema errado ao carregar (FOUC) | não existe | 0 | entrega |
| **M6** | Cards com prazo vencido há mais de 3 dias, ao fim do primeiro mês | desconhecido | ≤ 2 | 1 mês após deploy |
| **M7** | Idade média da fila de "ver depois" ao fim do primeiro mês | ver M6 da Fase 3 | menor que a da Fase 3 | 1 mês após deploy |

M6 e M7 são as que dizem se o dashboard serviu para alguma coisa. Uma tela inicial bonita que não
muda o que você faz é decoração — e, se em um mês os prazos continuarem vencendo do mesmo jeito, o
problema é que o dashboard não é o lugar certo para cobrar, não que ele está mal feito.

---

## 3. Não-objetivos

- **NO1** — **Export das notas em `.md`/`.json`.** Você decidiu que não há necessidade agora.
  Consequência registrada: o risco "lock-in dos seus dados" da seção 10 da PROPOSTA fica **sem
  mitigação** até isso existir — o backup do Postgres protege contra perda, não contra querer sair.
- **NO2** — Números, gráficos, sequência de dias anotando, cards concluídos por semana. Motivam,
  mas não ajudam a decidir o que fazer agora, e são a parte mais cara de construir.
- **NO3** — Dashboard configurável: escolher blocos, arrastar, esconder. Três blocos fixos.
- **NO4** — Expurgo automático da lixeira. A Fase 1 prometeu remoção definitiva após 30 dias
  (RN-04) e isso continua não existindo. **Dívida declarada, não resolvida aqui** (ver Q-02).
- **NO5** — Remover a tabela `company`, morta desde a Fase 0. Continua pendente (Q-03).
- **NO6** — Script de backup `pg_dump`. Continua pendente na PROPOSTA.
- **NO7** — Notificação, alerta por e-mail, lembrete de prazo. O dashboard informa quando você
  abre; ele não persegue você.
- **NO8** — Eventos ou agenda no dashboard. A agenda é Fase 5 e vive no Google Calendar.
- **NO9** — Tema por workspace, tema automático por horário, temas customizáveis. Dois temas, uma
  escolha manual, com o do sistema como valor inicial.
- **NO10** — Layout responsivo. Continua desktop-only.

---

## 4. Personas e usuários-alvo

**Usuário único: você.** Dois momentos que esta fase atende:

| Momento | Frequência | O que exige |
|---|---|---|
| **Abrindo o app** — começo do dia ou volta do intervalo | várias vezes por dia | ver o que está pendente sem clicar; ir de lá para o item em um clique |
| **Trocando de ambiente** — sala clara de manhã, quarto escuro à noite | diária | trocar o tema em um clique, sem a interface piscar nem perder legibilidade |

---

## 5. Requisitos funcionais

### 5.1 A tela inicial

- **RF-01** — A rota `/` passa a ser o dashboard. As notas passam a viver em `/n` (sem nota aberta)
  e `/n/:id` (com nota aberta).
- **RF-02** — A barra de navegação ganha um item `Início`, acima de `Todas as notas`.
- **RF-03** — Fechar uma nota volta para `/n`, não para o dashboard.
- **RF-04** — O dashboard carrega em **uma** requisição a `GET /dashboard`.
- **RF-05** — O dashboard respeita o workspace ativo nos blocos de prazos e notas; a fila de links
  é sempre a mesma, porque a gaveta não tem workspace (RN-01 da Fase 3).
- **RF-06** — Cada bloco tem estado vazio próprio e acionável, e o dashboard nunca aparece
  totalmente em branco.

### 5.2 Bloco de prazos

- **RF-07** — O bloco lista, em duas seções, os cards **vencidos** e os que vencem nos **próximos 7
  dias**.
- **RF-08** — Vencidos vêm primeiro, do mais antigo para o mais recente; os próximos, do mais
  próximo para o mais distante.
- **RF-09** — Cada card exibe título, quanto tempo falta ou passou ("venceu há 3 dias", "amanhã"),
  prioridade, board e coluna.
- **RF-10** — Clicar em um card abre o board com o painel dele aberto.
- **RF-11** — Cards arquivados não aparecem.
- **RF-12** — O bloco mostra no máximo 5 vencidos e 5 próximos; havendo mais, exibe quantos ficaram
  de fora.

### 5.3 Bloco de notas recentes

- **RF-13** — Lista as 6 notas editadas mais recentemente, com título, tipo, trecho e há quanto
  tempo foram tocadas.
- **RF-14** — Clicar abre a nota em `/n/:id`.
- **RF-15** — Notas na lixeira não aparecem.

### 5.4 Bloco da fila de links

- **RF-16** — Exibe quantos itens esperam em "ver depois" e os 3 mais antigos, com a idade de cada
  um.
- **RF-17** — Clicar em um item abre o link em nova aba, com `rel="noopener noreferrer"`.
- **RF-18** — O bloco tem uma ação que abre a gaveta na aba "ver depois".

### 5.5 Tema

- **RF-19** — A aplicação suporta dois temas: escuro (atual) e claro.
- **RF-20** — Na primeira visita, o tema segue a preferência do sistema (`prefers-color-scheme`).
- **RF-21** — A escolha manual sobrepõe a do sistema e é persistida; ela vale para todas as telas e
  sobrevive a recarregar.
- **RF-22** — A troca de tema fica na barra de navegação, junto do nome do usuário.
- **RF-23** — Os controles nativos (campo de data, `select`, barra de rolagem) acompanham o tema.
- **RF-24** — O preview do Markdown, o realce de sintaxe dos blocos de código e o destaque de busca
  são legíveis nos dois temas.
- **RF-25** — As cores geradas por domínio na gaveta de links (RN-06 da Fase 3) mantêm contraste nos
  dois temas.

---

## 6. Requisitos não-funcionais

### 6.1 Desempenho

- **RNF-01** — `GET /dashboard`: p95 ≤ 150 ms (M2), com as três consultas em paralelo.
- **RNF-02** — Nenhuma consulta do dashboard faz varredura sequencial. Prazos usam
  `card(due_date)`, notas usam `note(user_id, deleted_at, updated_at DESC)` e links usam
  `link(user_id, kind, created_at DESC)` — todos os três índices já existem.
- **RNF-03** — O dashboard não traz o corpo das notas: só título, tipo e trecho, como a listagem
  (mesma decisão de payload da otimização pré-deploy).

### 6.2 Tema

- **RNF-04 O tema vive no CSS** — A troca acontece por variáveis redefinidas em
  `:root[data-tema="claro"]`. **Nenhum componente ganha condicional de tema**, e nenhum arquivo
  `.tsx` passa a ter duas versões de cor.
- **RNF-05 A rampa é semântica** — `ink-950` é sempre "o fundo mais profundo" e `ink-200` é sempre
  "o texto de maior contraste". No tema claro os valores se invertem; o significado, não.
- **RNF-06 Cores de estado também são token** — Os tons fixos hoje usados para erro, alerta,
  sucesso e tipo de nota (`red`, `amber`, `emerald`, `sky`, `rose`, `violet`) passam a ser
  redefinidos por tema, para que texto de erro sobre fundo claro não fique ilegível.
- **RNF-07 Sem piscada** — O tema é aplicado antes da primeira pintura. Carregar com tema claro
  salvo não pode mostrar um quadro escuro antes (M5).
- **RNF-08 Contraste nos dois** — WCAG AA: 4,5:1 para texto, 3:1 para elementos de interface e
  indicador de foco. A auditoria roda nos dois temas (M4).
- **RNF-09 Cor nunca sozinha** — Continua valendo: tipo de nota, prioridade, prazo vencido e item
  velho continuam distinguíveis sem cor, nos dois temas.

### 6.3 Segurança e integridade

- **RNF-10** — `GET /dashboard` exige autenticação e filtra por `userId` do token.
- **RNF-11** — O dashboard não introduz caminho novo de escrita: ele só lê.

---

## 7. Modelo de dados

**Nenhuma mudança.** Não há tabela, coluna nem índice novo — o dashboard é uma leitura de três
consultas sobre o que já existe, e o tema é CSS.

| Bloco | Origem | Índice usado |
|---|---|---|
| Prazos | `card` com `due_date` não nulo, `archived = false`, do usuário | `card(due_date)` |
| Notas recentes | `note` ativa do usuário | `note(user_id, deleted_at, updated_at DESC)` |
| Fila de links | `link` com `kind = 'depois'` | `link(user_id, kind, created_at DESC)` |

A preferência de tema fica em `localStorage`, como a largura das colunas, o workspace ativo e o modo
de exibição da nota. Não é dado de usuário no servidor.

---

## 8. Fluxos principais

### Fluxo A — Abrir o app de manhã

1. Você abre o Yu-book. A rota `/` é o dashboard.
2. O primeiro bloco mostra "1 vencido": o card "Exercício de JWT", que venceu ontem.
3. Você clica nele. O board abre com o painel do card aberto.
4. Você move o card para "Feito" e volta para `Início` pela navegação.
5. O bloco de vencidos agora está vazio, com a mensagem de que não há nada atrasado.

### Fluxo B — Retomar de onde parou

1. No bloco de notas recentes, a primeira é "RAG", editada "há 2 horas".
2. Você clica; a nota abre em `/n/<id>`, com a lista à esquerda.
3. Fechar a nota volta para `/n`, não para o dashboard — você continua no contexto de notas.

### Fluxo C — Trocar para o tema claro

1. Fim da tarde, sala clara. Você clica no seletor de tema na navegação.
2. A interface inteira troca: fundo claro, texto escuro, blocos de código e destaques ajustados.
3. Você recarrega a página. Ela abre clara, sem piscar escuro antes.

---

## 9. Regras de negócio

- **RN-01 Prazo vencido tem precedência** — Havendo card vencido, ele ocupa o topo do dashboard,
  antes de qualquer outro bloco. Nunca é agrupado com os próximos.
- **RN-02 "Vencido" é `due_date` menor que agora** — O prazo é gravado no fim do dia escolhido
  (Fase 2), então um card com prazo hoje só vence à meia-noite.
- **RN-03 A janela dos próximos é de 7 dias** — Fixa, não configurável.
- **RN-04 O workspace ativo vale para prazos e notas, não para links** — A gaveta é única (RN-01 da
  Fase 3); prazos e notas seguem o contexto (RF-02 da Fase 2).
- **RN-05 O dashboard não escreve nada** — Toda ação leva para o lugar onde a alteração acontece.
- **RN-06 O tema é do dispositivo** — Fica em `localStorage`, não no banco. Abrir em outra máquina
  começa pela preferência do sistema de lá.

---

## 10. Critérios de aceitação

**Dashboard**

- **CA-01** (RF-01, RF-03) — Dado que abro `/`, então vejo o dashboard; abrir uma nota leva a
  `/n/:id`, e fechá-la volta para `/n`.
- **CA-02** (RF-04, M1) — Dado o dashboard carregando, então **uma** requisição à API é feita.
- **CA-03** (RF-07, RF-08, RN-01) — Dados um card vencido há 3 dias, um vencido ontem e um que vence
  em 2 dias, então os dois vencidos aparecem primeiro, o de 3 dias antes do de ontem, e o terceiro
  em "próximos".
- **CA-04** (RF-11) — Dado um card vencido e arquivado, então ele não aparece no dashboard.
- **CA-05** (RF-12) — Dados 8 cards vencidos, então 5 são listados e o bloco informa que há mais 3.
- **CA-06** (RF-10) — Dado um card no bloco de prazos, quando clico nele, então o board abre com o
  painel daquele card aberto.
- **CA-07** (RF-05, RN-04) — Dado o workspace `Coders` ativo, então prazos e notas recentes são só
  da Coders, e a fila de links continua mostrando todos.
- **CA-08** (RF-13, RF-15) — Dadas 10 notas, sendo uma na lixeira, então as 6 mais recentes que não
  estão na lixeira aparecem, da mais recente para a mais antiga.
- **CA-09** (RF-16) — Dados 7 itens em "ver depois", então o bloco exibe "7" e os 3 mais antigos com
  a idade de cada um.
- **CA-10** (RF-06) — Dado um usuário sem card, sem nota e sem link, então os três blocos mostram
  estado vazio com uma ação, e nenhum deles aparece em branco.
- **CA-11** (RNF-01) — Dados 500 cards, 1.000 notas e 200 links, então o p95 de `GET /dashboard` é
  ≤ 150 ms em 100 requisições.
- **CA-12** (RNF-02) — Dado `EXPLAIN` sobre as três consultas, então nenhuma faz `Seq Scan`.
- **CA-13** (RNF-10) — Dado um token de outro usuário, então o dashboard responde apenas com os
  dados desse usuário — nunca um card, nota ou link alheio.

**Tema**

- **CA-14** (RF-20) — Dado um navegador configurado em claro e nenhuma escolha salva, então a
  aplicação abre clara.
- **CA-15** (RF-21) — Dada a escolha manual de escuro num sistema claro, quando recarrego, então
  continua escura.
- **CA-16** (RNF-07, M5) — Dado o tema claro salvo, quando carrego a página, então nenhum quadro é
  pintado com o tema escuro antes.
- **CA-17** (RF-23) — Dado o tema claro, então o campo de data do card, os `select` e a barra de
  rolagem aparecem claros, sem contraste invertido.
- **CA-18** (RF-24) — Dado o tema claro, então o preview do Markdown, o realce de sintaxe e o
  destaque de termos da busca continuam legíveis.
- **CA-19** (RF-25) — Dados 20 domínios diferentes na gaveta, então nenhum bloco colorido fica
  abaixo de 4,5:1 em nenhum dos dois temas.
- **CA-20** (RNF-08, M4) — Dada uma auditoria de contraste em todas as telas, nos dois temas, então
  nenhum par texto/fundo fica abaixo de 4,5:1 e nenhum indicador de foco abaixo de 3:1.
- **CA-21** (RNF-04) — Dado o código dos componentes, então nenhum `.tsx` contém condicional de
  tema: a diferença vive inteira no CSS.
- **CA-22** (RNF-09) — Dada uma simulação de daltonismo em ambos os temas, então tipo de nota,
  prioridade, prazo vencido e link velho continuam distinguíveis.

---

## 11. Layout de referência

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ Yu-book    + │  Início                                    ☀/☾           │
│ ▼ Coders     │                                                          │
│──────────────│  ⚠ Prazos                                                │
│ ▸ Início     │  ┌────────────────────────────────────────────────────┐  │
│ ▸ Notas      │  │ ⚠ Exercício de JWT      venceu há 3 dias  ⬆ alta   │  │
│──────────────│  │   Módulo 3 · Fazendo                               │  │
│ Aula      12 │  │ ⚠ Migration             venceu ontem               │  │
│ Projeto    4 │  │   Módulo 3 · A fazer                               │  │
│ Trilha     3 │  ├────────────────────────────────────────────────────┤  │
│ Trabalho   7 │  │ ◷ Testes de integração  amanhã                     │  │
│ Livre      1 │  │ ◷ Ler sobre argon2      em 4 dias                  │  │
│──────────────│  └────────────────────────────────────────────────────┘  │
│ BOARDS       │                                                          │
│ ● Módulo 3 4 │  Onde você parou                    Ver depois · 7       │
│──────────────│  ┌──────────────────────────┐  ┌──────────────────────┐  │
│ Links      7 │  │ RAG            há 2 horas│  │ ⚠ Docs: Prisma       │  │
│ 🗑 Lixeira   │  │ aula · estudar…          │  │   há 1 mês           │  │
│ Yuri    sair │  │ Autenticação com JWT     │  │ Postgres FTS         │  │
│              │  │ ontem · aula             │  │   há 3 dias          │  │
│              │  │ Kanban board   há 2 dias │  │ [abrir a gaveta]     │  │
│              │  └──────────────────────────┘  └──────────────────────┘  │
└──────────────┴──────────────────────────────────────────────────────────┘
```

Regras de layout:

- Prazos ocupam a largura toda, no topo: é o único bloco com urgência (RN-01).
- Sem card vencido, a seção de vencidos some inteira — não vira um bloco vazio ocupando espaço.
- Notas recentes e fila de links dividem a linha de baixo.
- O seletor de tema fica no canto superior direito, com ícone e rótulo para leitor de tela.

---

## 12. Dependências, restrições e riscos

### Dependências

Nenhuma nova. O dashboard é uma rota e um endpoint; o tema é CSS. Não há biblioteca de gráfico
porque não há gráfico (NO2).

### Restrições técnicas

- Stack fixa: Fastify + Prisma + Postgres; React + Vite + Tailwind v4; Zod compartilhado.
- A paleta hoje são 8 tokens (`--color-ink-950` a `--color-ink-200`, `--color-accent-500/400`)
  declarados em `@theme`, mais cerca de 60 usos de cores fixas do Tailwind para estados e tipos de
  nota. O tema claro se resolve redefinindo **esses tokens** — é o que sustenta RNF-04 e CA-21.
- Sem migration nesta fase.

### Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Tema claro virar retrabalho de cor sem fim** | alto; é metade da fase | RNF-04: a troca é só de variável. Se um componente exigir condicional de tema, isso é sinal de que falta um token — cria-se o token, não o `if` |
| **Contraste no claro passar despercebido** | médio; quebra RNF-07 da Fase 1 | CA-19 e CA-20 auditam os dois temas; os tons de estado viram token justamente para serem auditáveis um a um |
| **Dashboard virar mais uma tela para manter** | médio | Três blocos fixos, sem configuração (NO3), sem escrita (RN-05) |
| **Trocar `/` de tela quebrar links salvos** | baixo | `/n/:id` e `/b/...` não mudam; só a raiz muda, e ela nunca foi um link compartilhado |
| **O dashboard não mudar comportamento nenhum** | médio; a fase teria sido decoração | M6 e M7 medem exatamente isso, com um mês de uso |

---

## 13. Entregas

| Onda | Escopo | Corte se atrasar |
|---|---|---|
| **4a — Dashboard** | RF-01 a RF-18 | não corta |
| **4b — Tema claro** | RF-19 a RF-25 | corta inteira; a aplicação continua dark-only, como está hoje |

---

## 14. Questões em aberto

- **Q-01** — Sem o export (NO1), a única saída dos seus dados é o `pg_dump` — que também não existe
  ainda. Isso é aceitável enquanto o Yu-book for o único lugar onde suas notas de aula moram?
  **Impacto:** alto se um dia você quiser sair; zero no dia a dia. Vale reavaliar quando passar de
  ~100 notas.
- **Q-02** — A lixeira nunca esvazia (NO4). Em algum momento vale implementar o expurgo dos 30 dias
  que a Fase 1 prometeu, ou trocar a promessa por "a lixeira é permanente" e corrigir o PRD-1?
  **Impacto:** baixo por ora; cresce com o uso.
- **Q-03** — A tabela `company` segue morta no schema. **Impacto:** cosmético.
- **Q-04** — O bloco de prazos usa 7 dias (RN-03). Se na prática você planeja por quinzena, o número
  muda numa linha.

---

## 15. Suposições assumidas

- **S-01** — **O dashboard vira a home em `/`**, e as notas passam a `/n`. Confirmado por você.
  Consequência aceita: um clique a mais para chegar às notas.
- **S-02** — **Três blocos: prazos, notas recentes e fila de links.** Confirmado por você. Números e
  estatísticas ficaram de fora (NO2).
- **S-03** — **Sem export nesta fase.** Confirmado por você. A consequência para o risco de lock-in
  está registrada em NO1 e Q-01.
- **S-04** — **Tema claro é o único item de polimento.** Confirmado por você. Expurgo da lixeira,
  tabela morta e script de backup seguem pendentes.
- **S-05** — **A preferência de tema é local**, não sincronizada entre máquinas. Justificativa: é
  preferência de ambiente físico (sala clara, quarto escuro), não de conta.

---

## 16. Definição de pronto

A Fase 4 está concluída quando:

1. Os 22 critérios de aceitação passam.
2. `pnpm typecheck`, `pnpm build` e `pnpm --filter @yu-book/api test` passam limpos.
3. Os testes de integração cobrem `GET /dashboard`: ordenação de vencidos (CA-03), exclusão de
   arquivados e de notas na lixeira (CA-04, CA-08), escopo de workspace (CA-07) e posse (CA-13).
4. Os fluxos A, B e C foram executados em navegador real, nos dois temas.
5. A auditoria de contraste (CA-20) foi feita e registrada, tema por tema.
6. Você abriu o Yu-book em um dia normal e a tela inicial te levou direto a alguma coisa que
   precisava ser feita.

O item 6 é o único que não dá para simular.
