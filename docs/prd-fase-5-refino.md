# PRD — Yu-book Fase 5: tags de card, arraste preciso e escrita ao vivo

**Versão:** v0.1 (draft) · **Autor:** Yuri · **Data:** 2026-08-24 · **Status:** rascunho

Contexto anterior: [README.md](../README.md) (Fases 0 a 4 concluídas),
[docs/old/prd-fase-1-notas.md](old/prd-fase-1-notas.md) (editor, tags de nota, wikilinks),
[docs/old/prd-fase-2-kanban.md](old/prd-fase-2-kanban.md) (boards, arraste, posições) e
[docs/historico.md](historico.md).

> **Numeração do roadmap.** O roadmap chamava de Fase 5 a agenda no Google Calendar. Esta entrega
> assume o número 5 e empurra o Calendar para a Fase 6. É uma escolha de sequência, não de escopo:
> o que está aqui é refino do que já se usa todo dia; o Calendar é superfície nova. Ver Q-01.

---

## 1. Contexto e problema

As Fases 1 a 4 entregaram as superfícies: nota, board, gaveta, dashboard. Depois de meses de uso
real, os atritos que sobraram não são de funcionalidade faltando — são de **fricção no caminho
quente**, o gesto que se repete dezenas de vezes por dia. São quatro:

**O board só sabe agrupar por estágio.** Uma coluna responde "em que ponto isto está". Não responde
"o que aqui é do módulo de banco de dados", "o que aqui é da candidatura na empresa X". Hoje esse
recorte só existe na cabeça de quem olha o quadro, ou vira coluna — e coluna por assunto destrói o
significado de coluna. A Fase 2 registrou isso como não-objetivo (NO6 de lá: *"etiquetas próprias
do card; tags são de nota"*). O uso mostrou que era a decisão errada: dentro de um board, assunto e
estágio são dois eixos independentes, e só um deles está representado.

**O arraste funciona, mas não é confiável.** Solta na coluna certa quase sempre. O "quase" é o
problema: com card de altura variável, `closestCorners` decide pelo canto mais próximo e não pelo
ponteiro, os retângulos de soltura são medidos uma vez no início do arraste e ficam desatualizados
conforme a lista se reacomoda, e o índice de inserção é sempre *antes* do card sob o cursor — não
existe "depois do último" a não ser mirando a área vazia. O resultado é um gesto que exige atenção
onde deveria ser reflexo.

**A lista de tags da barra lateral virou um paredão.** Ela cresce sem teto e sem ordem útil (é
alfabética). Achar `postgres` no meio de setenta tags é varredura visual.

**Escrever exige traduzir.** O editor é um `textarea` de Markdown cru ao lado de um preview. Você
escreve `## Aula 12` e lê `## Aula 12`; o resultado está do outro lado da tela, e o olho pula. E
copiar uma nota inteira para levar a outro lugar exige selecionar tudo à mão.

Esta fase não adiciona superfície nova. Ela tira atrito de quatro gestos que já existem.

---

## 2. Objetivos

- **O1** — Dar ao card um segundo eixo de agrupamento: etiquetas livres, criadas ao digitar,
  reaproveitadas dentro do board, e um filtro que isola um assunto sem mexer em coluna nenhuma.
- **O2** — Tornar o arraste do kanban previsível: onde o ponteiro está é onde o card cai, inclusive
  na última posição da coluna e em coluna que rolou.
- **O3** — Fazer a lista de tags da barra lateral responder a digitação, em vez de exigir leitura.
- **O4** — Copiar uma nota inteira em um clique.
- **O5** — Escrever vendo o resultado: a marcação some do que já foi escrito e reaparece na linha
  onde o cursor está, mantendo **Markdown como a única fonte de verdade** do conteúdo.
- **O6** — Não regredir nenhuma invariante existente. Em especial: contiguidade de posições
  (INV-11), teclado do kanban (INV-30), cirurgia de cache do autosave (INV-23) e sanitização do
  Markdown (INV-09).

### 2.1 Métricas de sucesso

| | Métrica | Baseline | Alvo | Prazo |
|---|---|---|---|---|
| **M1** | Cards com ao menos uma tag, 2 semanas após a Etapa A | 0 | ≥ 30% dos cards ativos | 2 semanas |
| **M2** | Solturas em coluna diferente da pretendida (contagem manual em 50 arrastes) | ~5 em 50 | 0 em 50 | entrega da Etapa B |
| **M3** | Tempo de quadro (frame) durante o arraste, board com 100 cards | não medido | ≤ 16 ms no p95 | entrega da Etapa B |
| **M4** | Cliques para achar uma tag específica na barra lateral com 70 tags | varredura visual | ≤ 3 teclas digitadas | entrega da Etapa A |
| **M5** | Uso do modo "ao vivo" após 2 semanas (proporção do tempo de edição) | não existe | modo padrão, sem troca de volta | 2 semanas após a Etapa C |
| **M6** | Bytes de `contentMd` alterados por um round-trip abrir→fechar sem digitar nada | 0 | 0 (o editor novo não pode reescrever o texto) | entrega da Etapa C |

M6 é a métrica de segurança da Etapa C: um editor que "normaliza" o Markdown ao abrir corrompe o
acervo em silêncio. Zero é o único valor aceitável.

---

## 3. Não-objetivos

- **NO1** — Tabela própria para tag de card. Decisão explícita: é `text[]` na linha do card. Ver §7.
- **NO2** — Cor, renomeação em massa, fusão ou catálogo global de tags de card. Tag de card é texto,
  vive e morre com o card.
- **NO3** — Unificar tag de nota e tag de card. São duas coisas com o mesmo nome e ciclos de vida
  diferentes; ver §7.3.
- **NO4** — Filtrar o board por tag **no servidor**. O board já vem inteiro numa requisição
  (RF-13 da Fase 2); o filtro é local.
- **NO5** — Arrastar com filtro de tag ativo. Ver RN-05 — é recusa deliberada, não limitação.
- **NO6** — Mover card entre boards, swimlanes, arrastar múltiplos cards de uma vez.
- **NO7** — Arrastar em telas de toque. Continua desktop-only.
- **NO8** — Editor WYSIWYG de verdade (modelo de documento rico com Markdown como import/export).
  Ver D-01: o modelo continua sendo a string de Markdown.
- **NO9** — Tabelas editáveis, arrastar imagem para dentro da nota, anexos. Não há storage.
- **NO10** — Colaboração em tempo real, histórico de versões da nota, comentários.
- **NO11** — Copiar a nota como HTML ou como texto sem marcação. Copia-se o Markdown.
- **NO12** — Busca de card por tag na paleta (`Ctrl+K`). O filtro de tag é do board.

---

## 4. Divisão em etapas

Três etapas independentes entre si. **Cada uma é executada em modo plano**, gerando o seu próprio
plano de implementação a partir deste documento. Nenhuma depende do resultado da outra; a ordem
abaixo é a recomendada, não obrigatória.

| Etapa | Escopo | Camadas | Tamanho | Risco |
|---|---|---|---|---|
| **A — Tags** | Tags no card (item 1) + busca na lista de tags da barra lateral (item 3) | `shared`, `api` (migration), `web`, `mcp` | maior | baixo |
| **B — Arraste** | Precisão e fluidez do arraste do kanban (item 2) | `web` | média | médio |
| **C — Nota** | Botão copiar (item 4) + editor ao vivo (item 5) | `web` | maior | alto |

**Por que A junta os itens 1 e 3.** São tags diferentes (card e nota), mas o gesto é o mesmo:
*filtrar uma lista de etiquetas por texto digitado*. O seletor de tag do card e a busca da barra
lateral compartilham o mesmo casamento sem acento — implementar os dois juntos garante que se
comportem igual, em vez de divergirem em duas sessões diferentes.

**Por que B fica sozinha.** Não toca contrato, não toca banco, não toca `shared`. É a única etapa
que pode ser revertida inteira sem consequência para o resto.

**Por que C junta os itens 4 e 5.** Os dois moram no cabeçalho e no corpo do editor de nota
(`PainelEditor.tsx` / `Editor.tsx`). O botão de copiar é meia hora de trabalho no arquivo que a
etapa vai reescrever de qualquer forma — separar significaria abrir o mesmo arquivo duas vezes.
**Ordem interna obrigatória:** o botão de copiar entra e é entregue *antes* do editor. Se a Etapa C
travar em D-01, o item 4 já estará em produção.

---

## 5. Requisitos funcionais

### 5.1 Etapa A — Tags de card

- **RF-01** — Um card tem de zero a `MAX_TAGS_CARD` (8) etiquetas de texto, com até
  `MAX_TAG_TEXTO` (24) caracteres cada.
- **RF-02** — A tag é criada ao digitar, no painel do card. Não existe tela de cadastro, nem
  seleção prévia obrigatória: digitar `banco` e confirmar cria e aplica.
- **RF-03** — Ao abrir o campo de tag, o painel lista as tags **já existentes naquele board**,
  ordenadas por frequência de uso (mais usadas primeiro) e depois alfabeticamente. Digitar filtra
  essa lista.
- **RF-04** — Se o texto digitado não casar com nenhuma tag existente do board, a primeira opção da
  lista é "criar «texto»". Enter aplica a opção selecionada; a primeira opção é a pré-selecionada.
- **RF-05** — Todo texto passa por `normalizarTag` antes de ser gravado (§8). O casamento com uma
  tag existente é feito sem acento e sem caixa: digitar `revisao` encontra `revisão` e aplica a
  grafia que já existe no board (RN-02).
- **RF-06** — Remover uma tag do card é um clique no `×` da própria etiqueta, e uma tecla
  `Backspace` com o campo vazio remove a última.
- **RF-07** — A face do card no board mostra as tags como etiquetas pequenas, na mesma linha dos
  outros metadados (prazo, prioridade, checklist). Acima de 3 tags, mostra as 3 primeiras e `+n`.
  São **rótulo, não botão**: o card inteiro é a alça de arraste, e um alvo clicável dentro dele
  competiria com o gesto. O filtro se opera pela barra (RF-08).
- **RF-08** — O board ganha uma barra de filtro por tag acima das colunas, listando as tags em uso
  no board com a contagem de cards de cada uma. Clicar alterna; várias tags selecionadas filtram
  por **OU** — o card aparece se tiver pelo menos uma delas. Diverge de propósito do filtro de
  notas, que é E (RF-07 da Fase 1): lá o objetivo é estreitar até achar uma nota; aqui é agregar
  assuntos relacionados espalhados por colunas diferentes, e E esvaziaria o quadro na segunda tag.
- **RF-09** — Com filtro ativo, cada coluna mostra `visíveis de total` no lugar da contagem simples,
  e uma faixa no topo do board diz quantos cards estão escondidos, com um botão "limpar filtro".
- **RF-10** — O filtro é local e não sobrevive a recarregar a página nem a trocar de board.
- **RF-11** — As tags do card aparecem no servidor MCP, na linha de cada card, no mesmo formato
  compacto do resto (§13). Isso é uma mudança só em `formatarCard`, que serve a `get_board` **e** ao
  resource `yubook://board/{id}` — não existe tool `get_card`.

### 5.2 Etapa A — Busca na lista de tags da barra lateral

- **RF-12** — O cartão de tags da barra lateral ganha um campo de busca **acima** da lista de tags,
  dentro do cartão, visível apenas quando o cartão está aberto.
- **RF-13** — Digitar filtra as tags por correspondência de trecho, sem acento e sem caixa
  (mesmo casamento de RF-05). `progr` encontra `programação`.
- **RF-14** — Uma tag que está **ativa como filtro** continua visível mesmo que não case com o
  texto digitado, marcada como ativa. Esconder um filtro que está valendo é mentir sobre o estado
  da tela.
- **RF-15** — O campo mostra quantas tags estão sendo exibidas de quantas existem quando há texto
  digitado (`12 de 70`). Sem texto, nada é exibido.
- **RF-16** — `Esc` no campo limpa o texto; com o campo já vazio, devolve o foco à lista. O campo
  não rouba foco ao abrir o cartão.
- **RF-17** — Nenhuma tag casando, o cartão diz "nenhuma tag com «texto»", em vez de ficar em
  branco.

### 5.3 Etapa B — Arraste do kanban

- **RF-18** — O índice de inserção é **quantos cards da coluna têm o ponto médio acima do
  ponteiro**, ignorando o card arrastado. Hoje é sempre o índice do card sob o cursor, o que torna a
  última posição de uma coluna cheia inalcançável a não ser pela margem inferior.
  > *Correção pós-investigação:* a redação original desta linha dizia "o ponto médio **do card sob
  > o ponteiro**: acima insere antes, abaixo insere depois". Essa regra oscila — inserir empurra o
  > card sob o cursor, a metade dele cruza o ponteiro, e a conta se inverte no frame seguinte, com
  > a mão parada. A contagem é idempotente por construção e não depende da altura do card
  > arrastado nem de onde ele foi pego.
- **RF-19** — A detecção de colisão passa a priorizar o ponteiro (`pointerWithin`), com fallback
  retangular quando não há ponteiro — o arraste por teclado (INV-30) não tem coordenada de mouse e
  precisa continuar funcionando com a mesma completude.
- **RF-20** — Os retângulos de soltura continuam corretos depois que a lista se reacomoda embaixo
  do cursor.
  > *Já atendido — não implementar `MeasuringStrategy.Always`.* Verificado no `@dnd-kit/core`
  > 6.3.1 instalado: `isDisabled()` devolve `false` tanto para `Always` quanto para o default
  > `WhileDragging` **enquanto** `dragging` é `true` — são idênticos durante o gesto. E a remedição
  > periódica depende de `frequency` **numérico**, que o default deixa como a string `"optimized"`.
  > Quem remede durante o arraste é o `SortableContext`, que chama `measureDroppableContainers`
  > a cada mudança de `items` — e mover o card no estado local muda `items` a cada `dragOver`.
  > Trocar a estratégia só acrescenta medição **fora** do arraste: custo, não benefício.
- **RF-21** — Arrastar perto da borda do board rola o board na horizontal; arrastar perto do topo
  ou do fim de uma coluna rola aquela coluna na vertical. As duas rolagens convivem sem disputa.
- **RF-22** — O espaço que o card vai ocupar é mostrado como um vão com contorno tracejado na
  posição de destino, em vez do card fantasma em opacidade reduzida. O contorno é `outline` e não
  `border` (borda mudaria o box e dispararia remedição da coluna no meio do gesto), e o card de
  dentro some por opacidade e nunca por `visibility` — ele é o elemento focado, e é nele que o
  `KeyboardSensor` escuta.
- **RF-23** — O card no cursor (`DragOverlay`) acompanha o ponteiro sem defasagem perceptível, com
  cursor `grabbing` durante todo o gesto e animação de assentamento ao soltar.
- **RF-24** — A área de soltura de uma coluna cobre a altura inteira da coluna, inclusive quando ela
  está vazia ou tem poucos cards.
- **RF-25** — Durante o arraste, só as colunas afetadas re-renderizam. Um card cuja posição não
  mudou não repinta.
- **RF-27** — As estratégias de ordenação dos **cards** são desligadas
  (`strategy={() => null}` no `SortableContext` da coluna). Quem abre o vão é o DOM: o estado local
  é reordenado a cada `dragOver` e o React repinta a lista na ordem nova.
  `verticalListSortingStrategy` deslocaria de novo o que já foi deslocado, empurrando o vizinho
  pela altura do card ativo — e o `SortableContext` religa os transforms no primeiro frame em que a
  lista se repete, que é exatamente quando você para a mão para mirar. O
  `horizontalListSortingStrategy` das **colunas** permanece: ali os `items` não mudam durante o
  gesto e o transform é o único mecanismo que existe.
  > Requisito descoberto na investigação, ausente da redação original.
- **RF-26** — Nada do teclado muda: `Espaço` pega e solta, `Esc` cancela, setas movem, `Enter` abre
  o card, e cada etapa continua sendo anunciada (CA-15 da Fase 2).

### 5.4 Etapa C — Copiar a nota

- **RF-28** — O cabeçalho da nota ganha um botão "copiar", ao lado do seletor de modo.
- **RF-29** — Um clique copia a nota inteira para a área de transferência como Markdown: o título
  como `# Título`, uma linha em branco, e o corpo exatamente como está gravado. Sem reescrita,
  sem reformatação.
- **RF-30** — O botão confirma o resultado por 2 segundos ("copiado ✓") e anuncia por
  `aria-live`. Falha de permissão da área de transferência vira aviso visível, não silêncio.
- **RF-31** — Atalho `Ctrl+Shift+C`, listado no modal de atalhos (`Ctrl+/`).

### 5.5 Etapa C — Editor ao vivo

- **RF-32** — O editor ganha um quarto modo, **"ao vivo"**, que passa a ser o padrão para quem
  nunca escolheu um modo. Os três modos atuais (`edicao`, `dividido`, `leitura`) continuam
  existindo e funcionando como hoje.
- **RF-33** — No modo ao vivo, a marcação de uma linha fica **oculta** e o texto aparece já
  formatado: `# Título` vira um título sem o `#`, `**negrito**` vira negrito sem os asteriscos,
  `- item` vira marcador, ` ``` ` delimita um bloco com realce de sintaxe.
- **RF-34** — A linha onde o cursor está mostra a marcação crua. Sair da linha volta a esconder.
  É o que permite editar a marcação sem sair do modo.
- **RF-35** — Selecionar um trecho revela a marcação de tudo o que está dentro da seleção — sem
  isso, não dá para saber o que está sendo copiado ou apagado.
- **RF-36** — `[[wikilink]]` aparece como um elemento clicável dentro do texto, com o mesmo
  comportamento do preview: resolvido navega, não resolvido cria a nota (RF-23/RF-25 da Fase 1).
  Links não resolvidos continuam visualmente marcados.
- **RF-37** — O autocomplete de `[[` continua funcionando, ancorado na posição real do cursor, com
  as mesmas teclas (setas, Enter, Tab, Esc).
- **RF-38** — Os atalhos de formatação continuam: `Ctrl+B`, `Ctrl+I`, `Ctrl+K`, ``Ctrl+` ``,
  `Ctrl+S`.
- **RF-39** — Lista de tarefas (`- [ ]`) tem caixa clicável que edita o texto do Markdown ao ser
  marcada.
- **RF-40** — No modo `dividido`, a rolagem sincronizada entre os painéis continua como hoje
  (RF-12 da Fase 1). No modo ao vivo não há segundo painel, então não há o que sincronizar.
- **RF-41** — O autosave não muda: mesma pausa, mesmo `Ctrl+S`, mesmas 3 tentativas, mesma cirurgia
  de cache (INV-23).

---

## 6. Requisitos não-funcionais

### 6.1 Desempenho

- **RNF-01** — Arraste a 60 fps num board com 100 cards: nenhum quadro acima de 16 ms no p95.
- **RNF-02** — Digitar no editor ao vivo não pode ter latência perceptível numa nota de 100 KB.
  Só o trecho visível é decorado; o documento inteiro nunca é reprocessado por tecla.
- **RNF-03** — Abrir o painel de um card não faz requisição nova por causa das tags: elas já vêm
  na face do card, e portanto no `GET /boards/:id` que já acontece.
- **RNF-04** — O catálogo de tags do board é derivado dos cards que já estão em memória. Nenhum
  endpoint novo.
- **RNF-05** — O peso do bundle do front pode crescer no máximo 120 KB comprimidos por causa da
  Etapa C. Acima disso, o carregamento do editor vira `import()` sob demanda.

### 6.2 Integridade

- **RNF-06** — Toda tag gravada passa por `normalizarTag` **no servidor**, mesmo já tendo passado
  no front. `packages/shared` é a fonte única; os dois lados chamam a mesma função.
- **RNF-07** — O editor ao vivo nunca insere HTML no documento. Ele decora texto. `renderMarkdown`
  + DOMPurify continuam sendo o único caminho de Markdown para DOM (INV-09), usado pelos modos
  `dividido` e `leitura`.
- **RNF-08** — Abrir e fechar uma nota no editor novo sem digitar nada não pode alterar um byte de
  `contentMd` (M6).

### 6.3 Acessibilidade e teclado

- **RNF-09** — O seletor de tag do card é um combobox com semântica correta
  (`role="combobox"`, `aria-expanded`, `aria-activedescendant`), navegável só por teclado.
- **RNF-10** — O filtro de tags do board é operável por teclado, e o estado de cada chip é lido
  por `aria-pressed`.
- **RNF-11** — Foco visível em tudo que é novo (`:focus-visible`, já global no CSS).
- **RNF-12** — Nenhuma informação nova depende só de cor: tag ativa tem estado além do fundo.

### 6.4 Visual

- **RNF-13** — Nenhuma biblioteca de UI, nenhuma biblioteca de ícones. Ícone novo é SVG à mão em
  `Icones.tsx`. Cor nova exige entrada em `@theme` **e** em `:root[data-tema="claro"]`.
- **RNF-14** — Os dois temas são verificados em toda tela alterada. A variante `dark:` do Tailwind
  continua proibida.

---

## 7. Modelo de dados

Só a Etapa A toca o banco. Etapas B e C não têm migration.

### 7.1 A coluna

```prisma
model Card {
  // …
  /// Etiquetas livres do card (RF-01). Texto na própria linha, sem tabela:
  /// tag de card não tem cor, não é renomeada e não existe fora do card.
  tags String[] @default([])
  // …
}
```

```sql
ALTER TABLE "card" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

Nome da migration: `tags_do_card`.

### 7.2 Sem índice, por enquanto

Nenhum índice GIN em `card.tags` nesta etapa. O filtro é local (NO4), então nenhuma query filtra
por tag — um índice agora seria peso morto que o `zelador` apontaria com razão. Se um dia o filtro
subir para o servidor, o índice entra na mesma migration que a query.

### 7.3 Por que tag de card não reaproveita a tabela `tag`

A tabela `tag` existe, tem cor, tem unicidade por usuário e tem `limparTagsOrfas` (INV-20). Não
usá-la é decisão, e o motivo é ciclo de vida:

| | Tag de nota | Tag de card |
|---|---|---|
| Escopo | acervo inteiro do usuário | um board |
| Vida | sobrevive à nota, some quando fica órfã | morre com o card |
| Identidade | linha com id e cor | texto |
| Renomear | funde com a existente | não existe |
| Catálogo | endpoint `/tags`, resource MCP | derivado dos cards em memória |

Fundir as duas significaria dar id, cor e catálogo global a algo que não precisa de nada disso, e
fazer `limparTagsOrfas` passar a varrer duas tabelas. A duplicação de nome é aceita; o custo dela é
uma linha nesta tabela e um parágrafo na skill `invariantes-yu-book`.

---

## 8. Contrato compartilhado (`packages/shared`)

Etapa A adiciona, em `packages/shared/src/kanban.ts`:

```ts
export const MAX_TAGS_CARD = 8;
export const MAX_TAG_TEXTO = 24;

/**
 * Forma canônica de uma etiqueta de card. Chamada nos dois lados: o front
 * normaliza para exibir a lista, a API normaliza de novo antes de gravar.
 * Devolve string vazia para entrada que não sobra nada — quem chama filtra.
 */
export function normalizarTag(bruto: string): string;

export const cardTagsSchema: z.ZodType<string[]>;
```

`normalizarTag` faz, nesta ordem: corta espaço nas pontas, remove `#` inicial, colapsa espaço
interno em um só, passa para minúsculas, corta em `MAX_TAG_TEXTO`, corta espaço de novo. **Não
remove acento** — `revisão` é gravada `revisão`.

O casamento sem acento (RF-05, RF-13) usa a `normalizarTitulo` que já existe em
`wikilinks.ts`, como chave de comparação. É a mesma função que espelha `immutable_unaccent` no
banco; reusá-la evita uma terceira definição de "mesmo texto" no projeto.

`CardSummary` ganha `tags: string[]` — e portanto `CardDetail` também, por herança.
`cardInputSchema` e `cardUpdateSchema` ganham o campo.

**Espelhamento frágil novo, para a skill `contrato-compartilhado`:** `normalizarTag` no front e no
service do card. Se um lado deixar de chamar, tags visualmente iguais viram entradas diferentes no
catálogo do board, e ninguém percebe até a lista ter `Banco` e `banco`.

---

## 9. Fluxos principais

### Fluxo A — Marcar dois cards com o mesmo assunto
1. Abre o card, clica no campo de tag. A lista mostra as tags já usadas no board, mais usadas
   primeiro.
2. Digita `bd`. A lista filtra para `banco de dados`. Enter aplica.
3. Abre outro card, campo de tag, digita `ban`, Enter — mesma tag, mesma grafia.
4. Na barra de filtro do board, clica em `banco de dados`. As colunas passam a mostrar só esses
   dois cards, cada uma com `1 de 7`.
5. "Limpar filtro" devolve o board.

### Fluxo B — Mover um card para o fim de uma coluna cheia
1. Pega o card, arrasta até a coluna de destino, que tem 12 cards e está rolada.
2. Ao aproximar do fim visível, a coluna rola sozinha.
3. Passa o cursor abaixo da metade do último card: o vão tracejado aparece **depois** dele.
4. Solta. O card cai na posição 13.

### Fluxo C — Achar uma tag entre setenta
1. Abre o cartão de tags na barra lateral.
2. Digita `pos`. A lista cai para `postgres` e `posicionamento` — `12 de 70` ao lado.
3. Clica em `postgres`. A lista de notas filtra.
4. Digita `zzz`: a lista fica vazia, mas `postgres` continua visível, marcada como ativa.

### Fluxo D — Escrever uma aula
1. Abre nota nova, digita `## Aula 12 — índices`. Ao pular a linha, o `##` some e a linha vira
   título.
2. Escreve o corpo. `**` some ao sair da palavra; `[[transações]]` vira um link clicável assim que
   fecha.
3. Precisa corrigir o nível do título: clica na linha, o `##` reaparece, apaga um `#`, sai da
   linha.
4. `Ctrl+Shift+C` copia a nota inteira em Markdown para colar numa mensagem.

---

## 10. Regras de negócio

- **RN-01** — Uma tag é gravada na forma que `normalizarTag` devolve. Texto que normaliza para
  vazio é descartado sem erro.
- **RN-02** — Dentro de um card e dentro do catálogo de um board, duas tags que só diferem por
  acento ou caixa são a **mesma** tag. Prevalece a grafia que já existia no board; a segunda
  digitação é convertida para ela.
- **RN-03** — A ordem das tags de um card é a de inserção, e é preservada. Não é ordenada
  alfabeticamente na gravação.
- **RN-04** — O catálogo de tags de um board é o conjunto das tags dos cards **ativos** daquele
  board. Card arquivado não contribui — arquivar é sair do quadro (INV-13). Isso implica que a
  última desmarcação faz a tag desaparecer do catálogo: não há lixo acumulado, e não há
  `limparTagsOrfas` para tag de card.
- **RN-05** — **Com filtro de tag ativo, o arraste é desabilitado.** Índice de inserção calculado
  sobre uma lista filtrada aponta para a posição errada na lista real, e o servidor renumeraria em
  cima dela — corrupção silenciosa de ordem, exatamente o que INV-11 existe para impedir. O board
  filtrado explica isso numa linha, com o botão de limpar ao lado.
- **RN-06** — Excluir a última tag de um card não é evento nenhum: nada é apagado além do texto na
  linha do card.
- **RN-07** — O modo do editor continua sendo da pessoa e não da nota (`yb:modo-nota` no
  `localStorage`). Quem já escolheu um modo mantém a escolha; só quem nunca escolheu recebe o modo
  ao vivo como padrão.
- **RN-08** — O editor ao vivo edita a mesma string que o `textarea` editava. Nenhuma transformação
  de ida e volta, nenhuma normalização de Markdown, nenhuma reescrita ao abrir (RNF-08).

---

## 11. Critérios de aceitação

### Etapa A

- **CA-01** — Criar uma tag num card e abrir outro card do mesmo board: a tag aparece na lista de
  sugestões sem recarregar a página.
- **CA-02** — Digitar `REVISÃO ` num card e `revisao` em outro: os dois cards ficam com `revisão`,
  e o catálogo do board mostra uma entrada só.
- **CA-03** — Aplicar 9 tags a um card: a nona é recusada com aviso, sem perder as 8 anteriores.
- **CA-04** — Uma tag de 40 caracteres é cortada em 24 antes de gravar, no servidor, mesmo que a
  requisição venha de fora do front.
- **CA-05** — `GET /boards/:id` devolve `tags` em cada card, e o board com 200 cards continua
  dentro do orçamento de tempo da Fase 2 (M1 de lá: p95 ≤ 200 ms).
- **CA-06** — Card com 3 tags mostra as 3 na face; com 6, mostra 3 e `+3`.
- **CA-07** — Filtrar por duas tags mostra os cards que têm **qualquer uma** das duas.
- **CA-08** — Com filtro ativo, nenhum card é arrastável, e a explicação está visível (RN-05).
- **CA-09** — Arquivar um card que tinha a única ocorrência de uma tag remove essa tag da barra de
  filtro; desarquivar a devolve.
- **CA-10** — `get_board` no MCP mostra as tags de cada card.
- **CA-11** — Buscar `pos` no cartão de tags da barra lateral filtra a lista; uma tag ativa que não
  casa continua visível e marcada.
- **CA-12** — Buscar por texto sem correspondência mostra a mensagem de vazio, não uma área em
  branco.
- **CA-13** — Recarregar a página com filtro de tag ativo na barra lateral: o filtro persiste (é o
  comportamento atual), mas o campo de busca volta vazio.

### Etapa B

- **CA-14** — 50 arrastes deliberados entre colunas: 50 acertam a coluna e a posição pretendidas.
- **CA-15** — Um card pode ser solto **depois** do último card de uma coluna cheia, mirando a
  metade de baixo do último card.
- **CA-16** — Arrastar até a borda direita do board rola o board; o card continua colável na coluna
  que apareceu.
- **CA-17** — Arrastar dentro de uma coluna com 30 cards rola a coluna e permite soltar em qualquer
  posição, inclusive fora da área visível inicial.
- **CA-18** — O vão de destino aparece na posição exata em que o card vai cair, o tempo todo.
- **CA-19** — Board com 100 cards: nenhum quadro acima de 16 ms no p95 durante um arraste de
  3 segundos (medido no perfilador do navegador).
- **CA-20** — Todos os critérios de teclado da Fase 2 continuam passando: pegar, mover entre
  colunas, cancelar com `Esc`, anúncios em cada etapa.
- **CA-21** — Soltar fora de qualquer coluna cancela o movimento e o card volta.
- **CA-22** — Falha da requisição de mover devolve o card ao lugar de origem, com o aviso
  persistente (RNF-20 da Fase 2).

### Etapa C

- **CA-23** — Clicar em copiar e colar num editor de texto: sai `# Título`, linha em branco, e o
  corpo idêntico ao gravado.
- **CA-24** — `Ctrl+Shift+C` faz o mesmo e o atalho está listado em `Ctrl+/`.
- **CA-25** — Sem permissão de área de transferência, aparece aviso visível.
- **CA-26** — Abrir uma nota de 100 KB no modo ao vivo, não digitar nada, fechar: `contentMd` no
  banco não muda (M6).
- **CA-27** — Digitar `# Título` e pular a linha: o `#` some e o texto vira título. Clicar de volta
  na linha: o `#` reaparece.
- **CA-28** — Selecionar um parágrafo com `**negrito**`: a marcação aparece dentro da seleção.
- **CA-29** — `[[nota existente]]` é clicável e navega; `[[nota inexistente]]` é clicável, marcada
  como quebrada, e criar por ela funciona.
- **CA-30** — Digitar `[[` abre o autocomplete na posição do cursor, e as setas/Enter/Tab/Esc
  funcionam como antes.
- **CA-31** — `Ctrl+B` com texto selecionado envolve a seleção e a mantém selecionada.
- **CA-32** — `Ctrl+S` salva na hora; o autosave continua salvando na pausa; o indicador de estado
  continua correto.
- **CA-33** — Os modos `edicao`, `dividido` e `leitura` continuam funcionando, incluindo a rolagem
  sincronizada do `dividido`.
- **CA-34** — Uma nota com HTML bruto no corpo não executa nada no modo ao vivo nem no de leitura.
- **CA-35** — Os dois temas conferidos em cada modo.

---

## 12. Decisões técnicas

### D-01 — Motor do editor ao vivo *(a confirmar antes da Etapa C)*

A exigência de **esconder o `#`** elimina a maior parte das saídas baratas: um `textarea` não
consegue ocultar caracteres, e uma camada espelhada por cima dele só funciona enquanto cada
caractere ocupar a mesma largura nos dois — o que deixa de valer no instante em que um título fica
maior que o corpo.

| Opção | Modelo do documento | Custo | Veredito |
|---|---|---|---|
| **1. CodeMirror 6 + decorações** | a própria string de Markdown | ~6 pacotes `@codemirror/*`, reescrita de `Editor.tsx`, `caret.ts` sai de cena | **recomendada** |
| 2. `contenteditable` próprio | string de Markdown | seleção, IME, desfazer e colar por conta própria | rejeitada — meses de trabalho para reimplementar um editor |
| 3. TipTap / Lexical / ProseMirror | árvore de documento rico | Markdown vira import/export, com round-trip com perda | rejeitada — quebra RN-08, M6, os wikilinks derivados e o `contentMd` que o MCP lê |
| 4. `textarea` + camada espelhada | string de Markdown | zero dependências | rejeitada — não atende RF-33 |

**Opção 1 em detalhe.** É como o Obsidian faz o *live preview*: o documento continua sendo texto,
e o editor aplica decorações que escondem os marcadores nas linhas fora do cursor. Consequências
para este repositório:

- `contentMd` continua sendo uma string editada diretamente → RN-08, RNF-08 e M6 saem de graça.
- `caret.ts` (o truque do `div` espelhado para achar o cursor) deixa de ser necessário: o editor
  informa a posição do cursor em pixels. **O arquivo sai do projeto** — anotar para o `zelador`.
- Os atalhos migram de `onKeyDown` para o mapa de teclas do editor. Comportamento idêntico.
- O realce de sintaxe dentro de bloco de código passa a ser do editor; o `highlight.js` continua
  servindo os modos `dividido` e `leitura` via `renderMarkdown`.
- É a maior dependência que o projeto já aceitou. O `CLAUDE.md` proíbe biblioteca de **UI** e de
  **ícones** — um motor de edição de texto não é nem um nem outro, mas a decisão é do operador e
  não do agente. **Nada da Etapa C começa antes desta confirmação.**

Se D-01 for recusada, a Etapa C encolhe para o item 4 (copiar) mais melhorias possíveis sem esconder
marcação: realce da marcação no próprio `textarea`, tamanho de fonte por nível de título e
atalhos novos. O item 5 sai do escopo e vira questão em aberto.

### D-02 — O catálogo de tags do board é derivado, não consultado

O board inteiro já chega numa requisição, com todos os cards. Somar as tags em memória custa uma
passada por um array que já está lá. Um endpoint `/boards/:id/tags` seria uma segunda fonte de
verdade para a mesma informação, com uma janela de divergência entre as duas.

### D-03 — O filtro de tag não vai para a URL

Filtro de nota mora no estado da página; o de card faz o mesmo. Colocar na URL exigiria decidir o
que acontece ao compartilhar o link — pergunta sem sentido num aplicativo de um usuário só.

---

## 13. Propagação obrigatória

A Etapa A muda o domínio, e três coisas precisam acompanhar na **mesma entrega**:

1. **`packages/shared`** — compilado antes de qualquer typecheck
   (`pnpm --filter @yu-book/shared build`).
2. **`apps/mcp`** — `CardSummary` ganhou campo, então `formatarCard` precisa decidir se mostra tags
   (RF-11: mostra) e a descrição de `get_board` precisa dizer isso. O resource
   `yubook://board/{id}` herda de graça: ele chama `formatarQuadro`, que chama `formatarCard`.
   Consultar a skill `servidor-mcp-yu-book` antes de mexer.
3. **Skills** — `contrato-compartilhado` ganha o espelhamento de `normalizarTag` (§8);
   `invariantes-yu-book` ganha RN-05 (arraste desabilitado sob filtro) e a assimetria de §7.3.
   Quem escreve em `.claude/` é o `curador`.

Etapas B e C não mudam contrato e não propagam para o MCP.

**Versionamento** (skill `changelog-e-versao`): a Etapa A muda `packages/shared`, então bumpa os
quatro pacotes. B e C são só `apps/web`.

---

## 14. Dependências, restrições e riscos

### Dependências
- **D1** — Postgres 16 com `text[]`. Já é o caso.
- **D2** — `@dnd-kit/core` ≥ 6.3 para as estratégias de medição e colisão da Etapa B. Já é o caso;
  nada a instalar.
- **D3** — Etapa C depende de D-01 confirmada.

### Restrições
- **R1** — Duas camadas na API e só duas: rota valida e chama service; service tem a regra e o
  Prisma. Rota que importa `prisma` é violação.
- **R2** — Domínio em português, fronteira da API em inglês. O campo é `tags` na API; a função é
  `normalizarTag`; o componente é `SeletorDeTags`.
- **R3** — Imports internos com extensão `.js`, inclusive em `.ts`.
- **R4** — `noUncheckedIndexedAccess` ligado: todo acesso por índice devolve `T | undefined`.
- **R5** — Sem linter. Estilo por imitação: 2 espaços, aspas duplas, ~100 colunas.
- **R6** — Os únicos portões automáticos são `pnpm typecheck` e
  `pnpm --filter @yu-book/api test` (exige Postgres no ar).

### Riscos

| | Risco | Impacto | Mitigação |
|---|---|---|---|
| **X1** | O editor novo reescreve o Markdown ao abrir e corrompe notas em silêncio | alto | M6/CA-26 como portão de entrega; teste manual numa nota grande de verdade antes de qualquer commit |
| **X2** | A Etapa C quebra o autocomplete de `[[` ou os atalhos, e a escrita fica pior que antes | alto | RF-37/RF-38 são requisito, não melhoria; o modo antigo continua disponível como saída |
| **X3** | O arraste fica preciso mas o teclado regride sem ninguém notar | médio | CA-20 executado à mão em cada revisão da Etapa B; INV-30 citado no diff |
| **X4** | Arrastar com filtro ativo corrompe posições | alto | RN-05: recusa explícita, com aviso na tela |
| **X5** | Tag de card e tag de nota se confundem na cabeça de quem lê o código depois | baixo | §7.3 vira parágrafo na skill `invariantes-yu-book` |
| **X6** | O bundle cresce demais com o editor | médio | RNF-05: acima de 120 KB comprimidos, carregamento sob demanda |

---

## 15. Questões em aberto

- **Q-01** — Esta entrega assume o número "Fase 5" e empurra o Google Calendar para a Fase 6.
  Confirmar antes de mexer em README, PROPOSTA e CHANGELOG.
- **Q-02** — D-01: CodeMirror 6 entra no projeto? Bloqueia a Etapa C.
- **Q-03** — Ordem das etapas. A recomendada é A → B → C (contrato primeiro, risco por último). B é
  a de maior retorno diário imediato e não depende de nada — se o incômodo do arraste for o mais
  urgente, ela pode vir primeiro sem custo nenhum.
- **Q-04** — Tag de card deveria aparecer na paleta de busca (`Ctrl+K`)? Hoje `tag:` filtra notas.
  Está em NO12, mas é a extensão mais óbvia depois da Etapa A.
- **Q-05** — O botão de copiar deveria oferecer "copiar sem o título"? Assumido que não: a nota
  inteira inclui o título (RF-29).

## 16. Suposições assumidas

- **S1** — Um board não passa de algumas centenas de cards, e derivar o catálogo de tags em
  memória a cada render é irrelevante nessa escala.
- **S2** — 8 tags por card e 24 caracteres por tag cobrem o uso real. São constantes em `shared`,
  fáceis de subir depois; começar largo é que não tem volta.
- **S3** — Quem usa o aplicativo escreve em Markdown por preferência, e o modo ao vivo é conforto,
  não substituição — por isso os três modos antigos permanecem.
- **S4** — A área de transferência está disponível: o aplicativo roda em HTTPS ou em `localhost`.
- **S5** — Desktop-only continua valendo. Nada aqui é pensado para toque.

---

## 17. Definição de pronto

Para **cada etapa**, antes de considerar entregue:

1. `pnpm --filter @yu-book/shared build` e `pnpm typecheck` limpos.
2. `pnpm --filter @yu-book/api test` verde, com teste novo para o que a etapa criou de regra
   (Etapa A: normalização, limite de 8, corte em 24, tags no retorno do board).
3. Todos os CA da etapa verificados à mão, nos **dois temas**, incluindo os de teclado.
4. Revisão pela skill `invariantes-yu-book` — em especial INV-11, INV-13, INV-23, INV-30 e a nova
   RN-05.
5. Propagação da §13 feita, quando a etapa a exige.
6. `CHANGELOG.md`, `docs/historico.md` e as versões dos pacotes atualizados.
7. Nada de resquício: `console.log`, import morto, arquivo temporário. `caret.ts` removido junto
   com a Etapa C, se D-01 for aprovada.
