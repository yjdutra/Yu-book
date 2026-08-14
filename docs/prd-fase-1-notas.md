# PRD — Yu-book Fase 1: Notas

**Versão:** v0.1 (draft) · **Autor:** Yuri · **Data:** 2026-08-13 · **Status:** rascunho

Contexto anterior: [PROPOSTA.md](../PROPOSTA.md) (escopo geral) e [README.md](../README.md) (Fase 0, concluída).

---

## 1. Contexto e problema

Você está começando na Coders, onde há muitas aulas e você toma notas em todas. Hoje essas notas
não existem em lugar nenhum de forma consultável: ou se perdem em arquivos soltos, ou ficam num
app genérico onde "aquilo que eu anotei sobre JWT" só é reencontrável se você lembrar **onde**
anotou. O custo não aparece na hora de escrever — aparece semanas depois, quando o conteúdo de uma
aula seria útil num projeto e você não consegue recuperá-lo.

A Fase 0 entregou a fundação: monorepo, Postgres com o modelo de dados completo, autenticação JWT
e deploy configurado na Railway. O banco já tem a tabela `note`, a busca full-text em português
(`pt_unaccent`, trigger, índices GIN e trigram) e as tabelas `tag`, `note_tag`, `note_link` e
`workspace` — mas **nada disso está exposto**. Não existe uma tela para criar uma nota.

A Fase 1 é o que transforma a fundação em ferramenta: criar, editar, organizar e **reencontrar**
notas. É a primeira fase em que o Yu-book passa a ser usado de verdade, em aula, enquanto o resto
ainda está sendo construído.

Prazo-alvo: **4–5 dias de trabalho**, conforme o roadmap da proposta.

---

## 2. Objetivos

- **O1** — Registrar a nota de uma aula do início ao fim sem sair do teclado: atalho para criar,
  escrever em Markdown, sair. Sem botão de salvar obrigatório.
- **O2** — Reencontrar qualquer nota por conteúdo em menos de 3 segundos, de qualquer tela, com
  busca tolerante a acento e a erro de digitação.
- **O3** — Conectar notas entre si com links `[[titulo]]` e ver, em cada nota, quais outras a
  referenciam — o que faz notas soltas virarem conhecimento navegável.
- **O4** — Organizar por tipo (`aula`/`projeto`/`trilha`/`trabalho`/`livre`), tag e workspace, com
  filtros combináveis, mantendo **uma única** busca que atravessa todos os contextos.
- **O5** — Nunca perder conteúdo escrito por falha de salvamento.

### 2.1 Métricas de sucesso

| | Métrica | Baseline | Alvo | Prazo |
|---|---|---|---|---|
| **M1** | Tempo do atalho `Ctrl+N` até o cursor piscando no título | não existe | ≤ 500 ms | entrega |
| **M2** | p95 de `GET /search` com 1.000 notas no banco | não existe | ≤ 150 ms | entrega |
| **M3** | p95 de `GET /notes` (lista com filtros, 50 itens) | não existe | ≤ 200 ms | entrega |
| **M4** | Perda de conteúdo por falha de autosave, em 100 edições consecutivas | não existe | 0 | entrega |
| **M5** | Aulas da Coders anotadas no Yu-book nas 2 primeiras semanas de uso real | 0 | ≥ 20 | 2 semanas após deploy |
| **M6** | Notas que possuem ao menos um link `[[…]]` ao fim do primeiro mês | 0 | ≥ 30% | 1 mês após deploy |

M5 e M6 são as métricas que importam: elas medem se a ferramenta é boa o bastante para você usar
em vez de abandonar. M1–M4 são pré-condições técnicas para isso.

---

## 3. Não-objetivos

Fora do escopo desta fase, explicitamente:

- **NO1** — Kanban, boards e cards (Fase 2).
- **NO2** — Lista de empresas e calendário de eventos (Fase 3).
- **NO3** — Dashboard agregado e export em `.md`/`.json` (Fase 4).
- **NO4** — Busca semântica, embeddings, pgvector, "pergunte às suas notas" (Fase 5). A Fase 1
  entrega **apenas** busca por palavra-chave.
- **NO5** — Qualquer layout responsivo, mobile ou tablet. A aplicação é desktop-only (ver RNF-01).
- **NO6** — Imagens, anexos, colar screenshot na nota. Exige storage de objetos, que não existe no
  projeto. [SUPOSIÇÃO S-04]
- **NO7** — Histórico de versões / desfazer entre sessões. O `Ctrl+Z` do editor cobre a sessão atual.
- **NO8** — Tema claro. A aplicação é dark-only nesta fase.
- **NO9** — Colaboração, compartilhamento, notas públicas, comentários.
- **NO10** — Edição offline, PWA, service worker.
- **NO11** — Templates de nota, notas recorrentes, notas diárias.
- **NO12** — Editor WYSIWYG ou realce inline estilo Obsidian. A escolha é split ao vivo (RF-10).

---

## 4. Personas e usuários-alvo

**Usuário único: você.** Não há papéis, permissões nem hierarquia — a Fase 0 já entregou
autenticação de usuário único com cadastro fechado por variável de ambiente.

Três contextos de uso que moldam os requisitos:

| Contexto | Frequência | O que exige da interface |
|---|---|---|
| **Durante a aula** — anotando ao vivo, atenção dividida | várias vezes por semana | criar nota em 1 atalho, autosave, zero diálogos modais interrompendo |
| **Depois da aula** — organizando, adicionando tags e links | semanal | edição confortável, tags rápidas, links `[[…]]` com autocomplete |
| **Consultando** — durante um projeto, procurando algo anotado | diária | `Ctrl+K` de qualquer tela, resultado com trecho destacado |

O contexto "durante a aula" é o mais crítico: é onde a ferramenta falha se pedir cliques demais.

---

## 5. Requisitos funcionais

### 5.1 Notas — CRUD

- **RF-01** — O sistema permite criar uma nota informando título, conteúdo Markdown, tipo, workspace
  e tags. Apenas o título é obrigatório.
- **RF-02** — O sistema cria a nota com tipo `livre` e sem workspace quando esses campos não são
  informados.
- **RF-03** — O sistema permite editar todos os campos de uma nota existente.
- **RF-04** — O sistema permite marcar e desmarcar uma nota como favorita.
- **RF-05** — O sistema permite excluir uma nota, movendo-a para a lixeira (exclusão reversível,
  ver RN-04).
- **RF-06** — O sistema permite restaurar uma nota da lixeira e excluí-la definitivamente.
- **RF-07** — O sistema lista notas com filtros combináveis: texto livre, tipo, tags (E lógico),
  workspace, favoritas, intervalo de datas.
- **RF-08** — O sistema ordena a listagem por data de atualização (padrão), data de criação, data
  do ocorrido ou título.
- **RF-09** — O sistema pagina a listagem por cursor, 50 itens por página, com carregamento
  incremental ao rolar.

### 5.2 Editor

- **RF-10** — O editor exibe duas colunas lado a lado: Markdown editável à esquerda, resultado
  renderizado à direita.
- **RF-11** — O preview atualiza em no máximo 100 ms após a digitação parar.
- **RF-12** — O scroll das duas colunas é sincronizado proporcionalmente.
- **RF-13** — O editor renderiza: títulos (h1–h4), negrito, itálico, riscado, listas ordenadas e
  não ordenadas, checkboxes, citações, links, tabelas, código inline e blocos de código com realce
  de sintaxe.
- **RF-14** — O editor salva automaticamente 800 ms após a última tecla digitada.
- **RF-15** — `Ctrl+S` salva imediatamente, sem esperar o debounce.
- **RF-16** — O editor exibe o estado do salvamento em três formas: `editando`, `salvando…`,
  `salvo HH:MM`.
- **RF-17** — Quando o salvamento falha, o editor exibe o erro de forma persistente (não um toast
  que some) e tenta novamente a cada 5 s, até 3 tentativas.
- **RF-18** — O sistema avisa antes de fechar a aba com alterações não salvas (`beforeunload`).
- **RF-19** — O editor oferece atalhos de formatação: `Ctrl+B` negrito, `Ctrl+I` itálico,
  `Ctrl+K` link, `` Ctrl+` `` código.
- **RF-20** — O primeiro `# título` do corpo não substitui o campo de título: o título é um campo
  próprio, sempre visível no topo do editor.

### 5.3 Links entre notas

- **RF-21** — O sistema reconhece a sintaxe `[[titulo da nota]]` no conteúdo Markdown.
- **RF-22** — Ao digitar `[[`, o editor abre um autocomplete com as notas do usuário, filtrando por
  título conforme a digitação.
- **RF-23** — O preview renderiza um link resolvido como link clicável, que navega para a nota
  alvo.
- **RF-24** — O preview renderiza um link **não resolvido** (título inexistente) com estilo visual
  distinto do link resolvido.
- **RF-25** — Clicar em um link não resolvido cria uma nova nota com aquele título já preenchido e
  navega para ela.
- **RF-26** — Cada nota exibe, ao final, a lista de notas que a referenciam ("Referenciada por"),
  com título e tipo de cada uma.
- **RF-27** — O sistema recalcula os links de uma nota a cada salvamento.

### 5.4 Busca

- **RF-28** — `Ctrl+K` abre a paleta de busca sobre qualquer tela da aplicação.
- **RF-29** — A paleta busca conforme a digitação, com debounce de 200 ms.
- **RF-30** — A busca ignora acentuação nos dois sentidos: `programacao` encontra `programação` e
  vice-versa.
- **RF-31** — A busca aplica stemming em português: `autenticar` encontra `autenticação`.
- **RF-32** — Cada resultado exibe título, tipo, workspace, data e um trecho do conteúdo com os
  termos buscados destacados.
- **RF-33** — Os resultados são ordenados por relevância, com o título pesando mais que o corpo.
- **RF-34** — Quando a busca por texto completo não retorna nada, o sistema tenta uma busca por
  similaridade de título (trigrama) e rotula esses resultados como aproximados.
- **RF-35** — A paleta aceita filtros digitados no próprio campo: `tipo:aula`, `tag:seguranca`,
  `#coders` (workspace).
- **RF-36** — A paleta é operável só pelo teclado: `↑`/`↓` navegam, `Enter` abre, `Esc` fecha.
- **RF-37** — Com o campo vazio, a paleta lista as 10 notas atualizadas mais recentemente.

### 5.5 Organização — tags e workspaces

- **RF-38** — O sistema permite associar múltiplas tags a uma nota.
- **RF-39** — Tags são criadas ao serem digitadas pela primeira vez, sem tela de cadastro separada.
- **RF-40** — O campo de tags oferece autocomplete com as tags já existentes do usuário.
- **RF-41** — O sistema permite renomear e excluir uma tag; excluir remove a associação de todas as
  notas, sem excluir as notas.
- **RF-42** — O sistema permite criar, renomear, recolorir e excluir workspaces.
- **RF-43** — Excluir um workspace **não** exclui suas notas: elas ficam sem workspace.
  [SUPOSIÇÃO S-01]
- **RF-44** — A barra lateral exibe os workspaces e a contagem de notas por tipo.

### 5.6 Campos específicos por tipo

- **RF-45** — Notas do tipo `aula` exibem campos adicionais: módulo, número da aula, instrutor e
  link da gravação, gravados em `note.meta` (JSONB).
- **RF-46** — Os campos de `meta` aparecem em um painel recolhível, fechado por padrão, para não
  competir com a área de escrita.
- **RF-47** — Trocar o tipo de uma nota preserva o conteúdo de `meta` já preenchido.

---

## 6. Requisitos não-funcionais

### 6.1 Plataforma e layout

- **RNF-01 Desktop-only** — A aplicação é projetada para viewport ≥ 1280 × 720. Abaixo de 1024 px
  de largura, o sistema exibe uma tela informando que o Yu-book é para desktop, em vez de degradar
  o layout. Nenhum esforço de responsividade além disso.
- **RNF-02 Densidade** — O layout usa três colunas fixas simultâneas (navegação, lista, editor),
  aproveitando a largura em vez de centralizar conteúdo em uma coluna estreita.
- **RNF-03 Larguras ajustáveis** — As colunas de navegação e lista são redimensionáveis por
  arrasto, com largura persistida em `localStorage`.

### 6.2 Interação e teclado

- **RNF-04 Teclado-primeiro** — Toda ação frequente tem atalho: `Ctrl+K` busca, `Ctrl+N` nova nota,
  `Ctrl+S` salvar, `Esc` fecha overlays, `Ctrl+/` lista os atalhos.
- **RNF-05 Sem modais bloqueantes no caminho de escrita** — Criar, salvar e tagear uma nota não
  abre diálogo modal. Confirmação modal só na exclusão definitiva.
- **RNF-06 Foco previsível** — Após `Ctrl+N`, o foco vai para o campo de título. Após `Enter` no
  título, vai para o corpo. `Esc` na paleta devolve o foco ao elemento anterior.

### 6.3 Acessibilidade visual

- **RNF-07 Contraste** — Texto e ícones atendem WCAG AA: 4,5:1 para texto normal, 3:1 para texto
  grande e elementos de interface.
- **RNF-08 Foco visível** — Todo elemento interativo tem indicador de foco visível, com contraste
  ≥ 3:1 contra o fundo adjacente. Nunca `outline: none` sem substituto.
- **RNF-09 Cor nunca sozinha** — Tipo de nota, estado de salvamento e link não resolvido são
  distinguíveis sem depender de cor (texto, ícone ou traçado).
- **RNF-10 Tipografia de leitura** — O preview limita a linha a 70–80 caracteres; a fonte do editor
  é monoespaçada e a do preview, proporcional.

### 6.4 Percepção de desempenho

- **RNF-11 Sem salto de layout** — Estados de carregamento usam esqueleto com as mesmas dimensões
  do conteúdo final. `CLS` visual igual a zero na troca de nota.
- **RNF-12 Navegação otimista** — Clicar em uma nota da lista mostra título e metadados
  imediatamente (já estão em cache da listagem), com o corpo carregando em seguida.
- **RNF-13 Digitação livre** — A digitação no editor nunca aguarda rede. Autosave e recálculo de
  links acontecem fora do caminho da tecla.

### 6.5 Desempenho técnico

- **RNF-14** — `GET /search`: p95 ≤ 150 ms com 1.000 notas (M2). O volume de referência é
  [SUPOSIÇÃO S-06].
- **RNF-15** — `GET /notes` com filtros: p95 ≤ 200 ms para página de 50 itens (M3).
- **RNF-16** — `PATCH /notes/:id` (autosave): p95 ≤ 250 ms para nota de até 50 KB.
- **RNF-17** — A busca usa os índices GIN já criados na migration inicial. Nenhuma busca faz
  varredura sequencial em `note`. Verificável por `EXPLAIN`.

### 6.6 Segurança e integridade

- **RNF-18** — Todo endpoint desta fase exige autenticação e filtra por `userId` vindo do token,
  nunca do corpo ou da query.
- **RNF-19** — O Markdown renderizado é sanitizado antes de ir ao DOM. HTML bruto na nota não pode
  executar script. Sem `dangerouslySetInnerHTML` sem sanitização.
- **RNF-20** — Os termos de busca vão para o Postgres via `websearch_to_tsquery` com parâmetro
  ligado, nunca por interpolação de string.
- **RNF-21** — O corpo de uma nota é limitado a 1 MB; o título, a 200 caracteres.

### 6.7 Estados vazios e de erro

- **RNF-22** — Cada lista tem estado vazio próprio e acionável: sem notas ("Crie sua primeira nota
  — `Ctrl+N`"), busca sem resultado (mostrando o termo buscado), workspace vazio, lixeira vazia.
- **RNF-23** — Falha de rede na listagem ou na busca mostra o erro com botão de "tentar de novo",
  sem apagar o conteúdo que já estava na tela.

---

## 7. Modelo de dados

As tabelas já existem desde a Fase 0. Esta fase exige **três alterações**:

| Mudança | Onde | Por quê |
|---|---|---|
| `note.deleted_at TIMESTAMP NULL` | `note` | lixeira (RF-05, RF-06, RN-04) |
| índice único em `(user_id, lower(unaccent(title)))` para notas não excluídas | `note` | torna `[[titulo]]` determinístico (RN-01) |
| índice em `(user_id, deleted_at, updated_at DESC)` | `note` | listagem padrão sem varredura |

Entidades envolvidas, com os atributos que a Fase 1 usa:

| Entidade | Atributos | Relações |
|---|---|---|
| `Note` | `title`, `contentMd`, `kind`, `meta` (JSONB), `sourceUrl`, `occurredAt`, `isFavorite`, `deletedAt`, `searchVector` | pertence a `User`; opcionalmente a `Workspace`; N:N com `Tag`; N:N consigo mesma via `NoteLink` |
| `Tag` | `name`, `color` | única por `(user, name)` |
| `NoteLink` | `fromNoteId`, `toNoteId` | derivada do conteúdo, recalculada a cada salvamento |
| `Workspace` | `name`, `color`, `position` | única por `(user, name)` |

**Invariantes:**

- `note.searchVector` é mantido por trigger — a aplicação nunca escreve nessa coluna.
- `NoteLink` é derivado: qualquer divergência entre o conteúdo e a tabela é bug, e a fonte da
  verdade é sempre `contentMd`.
- Nota na lixeira (`deletedAt` preenchido) não aparece em listagem, busca, autocomplete de `[[…]]`
  nem em backlinks.

---

## 8. Fluxos principais

### Fluxo A — Anotar uma aula ao vivo

1. Em qualquer tela, você pressiona `Ctrl+N`.
2. Uma nota nova é criada e o foco vai para o campo de título.
3. Você digita o título e pressiona `Enter`; o foco vai para o corpo.
4. Você escreve em Markdown enquanto assiste à aula. O preview acompanha à direita.
5. 800 ms após cada pausa, o indicador mostra `salvando…` e depois `salvo HH:MM`.
6. Você fecha o navegador sem clicar em nada. O conteúdo está salvo.

### Fluxo B — Reencontrar algo anotado

1. Você pressiona `Ctrl+K` em qualquer tela.
2. Digita `jwt` (sem lembrar em qual aula foi).
3. A paleta mostra notas de tipos diferentes — uma aula, um projeto, uma nota de trilha — cada uma
   com o trecho onde `jwt` aparece, destacado.
4. Você navega com `↓` e abre com `Enter`.
5. A nota abre na coluna do editor; a coluna da lista mantém o contexto anterior.

### Fluxo C — Conectar duas notas

1. Editando a nota de um projeto, você digita `[[`.
2. Um autocomplete abre listando suas notas; você digita `refre` e ele filtra para
   "Refresh rotativo".
3. `Enter` insere `[[Refresh rotativo]]`.
4. Ao salvar, o preview passa a mostrar um link clicável.
5. Abrindo "Refresh rotativo", a seção "Referenciada por" agora lista a nota do projeto.

### Fluxo D — Link para uma nota que ainda não existe

1. Escrevendo, você digita `[[Injeção de dependência]]` — nota que não existe.
2. O preview mostra o link com estilo de não resolvido.
3. Você clica; o sistema cria a nota com esse título e abre.
4. O backlink da nota original passa a existir automaticamente.

---

## 9. Regras de negócio

- **RN-01 Título único** — Duas notas ativas do mesmo usuário não podem ter o mesmo título,
  comparado sem diferenciar maiúsculas nem acentos. É isso que faz `[[titulo]]` apontar sempre para
  uma nota só. Ao tentar salvar um título duplicado, o sistema recusa e indica a nota existente.
  [SUPOSIÇÃO S-02]
- **RN-02 Links são derivados do conteúdo** — Não existe criar link fora do texto. Apagar
  `[[X]]` do corpo apaga o link e o backlink correspondente.
- **RN-03 Renomear propaga** — Renomear uma nota atualiza a sintaxe `[[…]]` em todas as notas que a
  referenciam, para que os links não quebrem.
- **RN-04 Exclusão é reversível por 30 dias** — Excluir marca `deletedAt`. A nota some de todas as
  visões, exceto da lixeira. Após 30 dias, é elegível para remoção definitiva. [SUPOSIÇÃO S-03]
- **RN-05 Tag órfã é removida** — Tag que deixa de estar associada a qualquer nota é excluída
  automaticamente, para o autocomplete não acumular lixo.
- **RN-06 Última escrita vence** — Com a mesma nota aberta em duas abas, o último salvamento
  prevalece, sem merge nem aviso. [SUPOSIÇÃO S-05]
- **RN-07 Busca só enxerga o que é seu** — Toda consulta é restrita ao `userId` do token. Não
  existe caminho de código em que uma nota de outro usuário possa ser retornada.

---

## 10. Critérios de aceitação

**Editor e salvamento**

- **CA-01** (RF-14) — Dado o editor aberto, quando eu digito e paro por 800 ms, então o indicador
  passa por `salvando…` e chega em `salvo HH:MM`, e recarregar a página mostra o texto digitado.
- **CA-02** (RF-15) — Dado texto não salvo, quando pressiono `Ctrl+S`, então a requisição parte em
  menos de 50 ms, sem esperar o debounce.
- **CA-03** (RF-17) — Dada a API fora do ar, quando o autosave dispara, então um erro persistente
  aparece, 3 tentativas são feitas em intervalos de 5 s, e o texto digitado permanece na tela.
- **CA-04** (RF-11) — Dado que digito `## Teste` no editor, então em até 100 ms o preview exibe
  "Teste" como título de nível 2.
- **CA-05** (RF-12) — Dado um documento maior que a altura da tela, quando rolo o editor até 50%,
  então o preview está a aproximadamente 50%.

**Busca**

- **CA-06** (RF-30) — Dada uma nota com o texto "programação assíncrona", quando busco
  `programacao`, então a nota aparece nos resultados.
- **CA-07** (RF-31) — Dada uma nota com "autenticação", quando busco `autenticar`, então a nota
  aparece.
- **CA-08** (RF-33) — Dadas duas notas, uma com o termo no título e outra só no corpo, quando busco
  o termo, então a do título aparece primeiro.
- **CA-09** (RF-34) — Dada uma nota "Autenticação com JWT", quando busco `autentcacao` (com erro de
  digitação), então a nota aparece marcada como resultado aproximado.
- **CA-10** (RF-35) — Dado o texto `tipo:aula jwt` na paleta, então só notas do tipo `aula` que
  contêm `jwt` são retornadas.
- **CA-11** (RF-36) — Dada a paleta aberta, então consigo buscar, navegar, abrir uma nota e fechar
  a paleta sem tocar no mouse.
- **CA-12** (RNF-14) — Dadas 1.000 notas no banco, então o p95 de `GET /search` é ≤ 150 ms, medido
  em 100 requisições.
- **CA-13** (RNF-17) — Dado `EXPLAIN` sobre a query de busca, então o plano usa
  `Bitmap Index Scan` em `note_search_vector_idx`, sem `Seq Scan` em `note`.

**Links**

- **CA-14** (RF-22) — Dado que digito `[[` no editor, então um autocomplete abre listando minhas
  notas, filtrando conforme continuo digitando.
- **CA-15** (RF-26) — Dada a nota A com `[[B]]` no corpo, quando abro a nota B, então A aparece em
  "Referenciada por".
- **CA-16** (RF-25) — Dado `[[Nota Inexistente]]`, quando clico no link no preview, então uma nota
  com esse título é criada e aberta.
- **CA-17** (RN-03) — Dada a nota B referenciada por A, quando renomeio B para "B2", então o corpo
  de A passa a conter `[[B2]]`.
- **CA-18** (RN-02) — Dado que removo `[[B]]` do corpo de A e salvo, então A deixa de aparecer nos
  backlinks de B.

**Notas e organização**

- **CA-19** (RN-01) — Dada uma nota "Aula 1", quando tento salvar outra com título "aula 1", então
  o sistema recusa e mostra um link para a nota existente.
- **CA-20** (RF-05, RN-04) — Dada uma nota excluída, então ela some da lista, da busca e do
  autocomplete de `[[…]]`, e aparece na lixeira.
- **CA-21** (RF-06) — Dada uma nota na lixeira, quando a restauro, então ela reaparece na listagem
  com tags e links intactos.
- **CA-22** (RF-07) — Dados filtros de tipo `aula` e tag `jwt` aplicados juntos, então só notas que
  satisfazem **ambos** são listadas.
- **CA-23** (RF-43) — Dado um workspace com 5 notas, quando excluo o workspace, então as 5 notas
  continuam existindo, sem workspace.
- **CA-24** (RF-47) — Dada uma nota `aula` com `meta` preenchido, quando mudo o tipo para `projeto`
  e volto para `aula`, então os campos de `meta` continuam preenchidos.

**Interface**

- **CA-25** (RNF-01) — Dada uma janela com 900 px de largura, então a aplicação exibe o aviso de
  desktop-only, e não um layout quebrado.
- **CA-26** (RNF-04) — Dado `Ctrl+/`, então a lista de atalhos aparece.
- **CA-27** (RNF-07) — Dada uma auditoria de contraste em todas as telas, então nenhum par
  texto/fundo fica abaixo de 4,5:1.
- **CA-28** (RNF-08) — Dado que navego com `Tab` por uma tela inteira, então o foco é visível em
  todos os elementos, sem exceção.
- **CA-29** (RNF-19) — Dada uma nota contendo `<img src=x onerror=alert(1)>`, quando abro o
  preview, então nenhum script executa.
- **CA-30** (RNF-22) — Dado um usuário sem nenhuma nota, então a lista mostra o estado vazio com a
  instrução do atalho `Ctrl+N`.

---

## 11. Layout de referência

Layout aprovado: **três colunas fixas**.

```
┌──────────┬─────────────────┬──────────────────────────────────────────┐
│ Yu-book  │ 🔍 buscar…      │  Autenticação com JWT          salvo 14:32│
│          ├─────────────────┤  aula · Coders · 12/08 · #jwt #seguranca │
│ ▸ Coders │ ● Autenticação… │─────────────────────┬────────────────────│
│ ▸ Trabalho│  JWT, refresh… │ ## Tokens           │ Tokens             │
│ ▸ Pessoal│─────────────────│                     │ ──────             │
│          │ ○ Hooks no React│ O **access token**  │ O access token     │
│ ─────────│   useEffect e…  │ vive em memória.    │ vive em memória.   │
│ Aulas  12│─────────────────│                     │                    │
│ Projetos 4│ ○ Kanban board │ - rotação a cada uso│  • rotação a cada  │
│ Trilha  3│   colunas e…    │ - `httpOnly`        │  • httpOnly        │
│ Trabalho 7│────────────────│                     │                    │
│          │                 │ Ver [[Fase 0]]      │ Ver → Fase 0       │
│ 🗑 Lixeira│                 │                     │                    │
└──────────┴─────────────────┴─────────────────────┴────────────────────┘
   240px         320px                    resto (split 50/50)
```

Regras de layout:

- Colunas 1 e 2 têm largura ajustável por arrasto (RNF-03); a coluna 3 ocupa o restante.
- Trocar de nota na coluna 2 troca **apenas** a coluna 3.
- A paleta `Ctrl+K` (RF-28) abre sobreposta, centralizada, sem alterar as colunas por trás.
- O painel de `meta` (RF-46) abre abaixo do cabeçalho da coluna 3, empurrando o editor para baixo.
- "Referenciada por" (RF-26) fica no rodapé da coluna de preview, separado por divisor.

---

## 12. Dependências, restrições e riscos

### Dependências

Nenhuma externa. Toda a infraestrutura necessária está entregue na Fase 0: banco, busca full-text,
autenticação e deploy.

Bibliotecas novas no front (a fixar na implementação): um renderer de Markdown com sanitização e
um realçador de sintaxe para blocos de código.

### Restrições técnicas

- Stack fixa pela Fase 0: Fastify + Prisma + Postgres na API; React + Vite + Tailwind no front;
  schemas Zod compartilhados em `packages/shared`.
- A busca usa `websearch_to_tsquery` sobre a configuração `pt_unaccent` já criada. Consultas de
  busca são SQL cru via `$queryRaw` — o Prisma não modela `tsvector`.
- Sem serviços novos: nada de Redis, fila ou índice externo.

### Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Título único (RN-01) incomodar na prática** — "Aula 1" em dois módulos diferentes | médio; atrito recorrente na escrita | validar na primeira semana de uso real; se incomodar, trocar por resolução do link para a nota mais recente e remover a restrição |
| **Renomear em cascata (RN-03) corromper conteúdo** — regex sobre o Markdown de outras notas | alto; perda de dado | substituição feita em transação, restrita ao padrão `[[…]]` exato; teste de integração cobrindo título com caractere especial |
| **Autosave gerar escrita excessiva** | baixo | debounce de 800 ms + só enviar se o conteúdo mudou de fato |
| **Split ao vivo pesar em nota grande** | médio; digitação travando | limite de 1 MB (RNF-21); renderização do preview em `requestIdleCallback`; medir com nota de 100 KB antes de fechar a fase |
| **Escopo do editor crescer** (tabelas, diagramas, atalhos infinitos) | alto; estoura os 4–5 dias | RF-13 define a lista fechada do que o editor renderiza; o que não está lá não entra nesta fase |

---

## 13. Questões em aberto

- **Q-01** — Quais são os campos reais de `meta` para uma aula da Coders (RF-45)? A lista atual
  (módulo, número, instrutor, link da gravação) é um chute a partir do formato usual de bootcamp.
  **Impacto:** baixo — é JSONB, muda sem migration. Vale confirmar depois da primeira semana de aulas.
- **Q-02** — Colar imagem/screenshot na nota é importante para aulas com slides e diagramas?
  Hoje é NO6. **Impacto:** alto se for — exige storage de objetos (volume da Railway ou S3) e vira
  uma fase própria. **Decidir antes da Fase 2.**
- **Q-03** — A lixeira (RF-05, RF-06, RN-04) vale os ~2h de implementação, ou exclusão direta com
  diálogo de confirmação basta até o export da Fase 4 existir? **Impacto:** médio — é o único
  mecanismo de recuperação até a Fase 4.

---

## 14. Suposições assumidas

- **S-01** — **Workspaces mínimos entram na Fase 1** (RF-42, RF-43, RF-44), embora a proposta os
  tenha colocado na Fase 2. Justificativa: o layout de três colunas aprovado exibe workspaces na
  barra lateral, e a coluna `workspace_id` já existe. O escopo aqui é só criar/renomear/recolorir/
  excluir — sem reordenação, sem ícones, sem seletor global. Boards e cards continuam na Fase 2.
- **S-02** — **Título único por usuário** (RN-01), comparado sem acento e sem diferenciar
  maiúsculas. Justificativa: é o que torna `[[titulo]]` determinístico sem uma tela de
  desambiguação. Alternativa se incomodar: resolver o link para a nota mais recente com aquele título.
- **S-03** — **Exclusão reversível** (RN-04) em vez de exclusão direta. Justificativa: até a Fase 4
  não existe export, então a lixeira é a única rede de proteção para o conteúdo. Ver Q-03.
- **S-04** — **Sem imagens ou anexos** (NO6). Justificativa: exige storage de objetos, ausente no
  projeto; incluir agora estouraria os 4–5 dias. Ver Q-02.
- **S-05** — **Última escrita vence** (RN-06). Justificativa: usuário único; detecção de conflito
  exigiria versionamento, que é NO7.
- **S-06** — **Volume esperado de até 1.000 notas no primeiro ano.** Justificativa: uma nota por
  aula mais notas de projeto e trabalho. É o número que dimensiona as metas M2/M3 e o que torna
  desnecessário qualquer índice externo.

---

## 15. Definição de pronto

A Fase 1 está concluída quando:

1. Os 30 critérios de aceitação passam.
2. `pnpm typecheck` e `pnpm build` passam limpos nos três pacotes.
3. Os fluxos A, B, C e D foram executados em navegador real, ponta a ponta.
4. A migration com as três alterações de `note` foi aplicada em produção.
5. Você anotou **uma aula de verdade** na aplicação em produção, do começo ao fim, sem tocar no
   código para isso.

O item 5 é o único que não dá para simular.
