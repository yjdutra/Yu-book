# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[semver](https://semver.org/lang/pt-BR/). Os identificadores `RF-xx`, `RN-xx` e `RNF-xx` resolvem
para os PRDs em [`docs/`](docs/).

`CHANGELOG.md` diz **o quê**. As decisões e os porquês ficam em
[`docs/historico.md`](docs/historico.md).

## [Não lançado]

_Nada pendente._

---

## [0.7.0] — 2026-08-26

**Etapa 3 do servidor MCP — as tools de escrita.** O servidor deixa de só consultar o segundo
cérebro e passa a mudá-lo: `create_card`, `move_card`, `trash_note` e `restore_note`. É a **Etapa 3
das cinco da proposta de MCP** ([`docs/old/proposta-mcp-inicial.md`](docs/old/proposta-mcp-inicial.md)),
a que a Etapa 2 tinha declarado fora do próprio escopo, e é a **Fase 2 do roteiro de IA aplicada**
([`docs/applied-ai-read-trip.md`](docs/applied-ai-read-trip.md)). **Não é uma fase de produto** — as
fases de produto vão de 0 a 5, estão concluídas, e a próxima delas continua sendo a agenda. Três
numerações diferentes convivem no repositório; nenhuma se converte na outra.

`apps/mcp` vai de `0.3.0` para `0.4.0` — superfície nova, compatível com quem já usava as cinco
tools de leitura. `apps/api` vai de `0.3.0` para `0.4.0` **sem mudar uma linha do que é deployado**:
o que ele ganhou foi o primeiro seed do projeto e os scripts do segundo ambiente, ferramenta de
desenvolvimento. `apps/web` segue em `0.5.0` e `packages/shared` em `0.3.0` — o contrato **não**
mudou, e é por isso que a regra dos quatro pacotes não se aplica aqui.

**A verificação desta etapa foi de verdade, e é a primeira em três entregas que se pode dizer isso.**
`pnpm typecheck` verde nos quatro pacotes, os 55 testes de integração da API passando (5 arquivos),
`pnpm --filter @yu-book/mcp build` ok, e roteiros sequenciais completos rodados contra o ambiente
local: nota para a lixeira → a busca não acha mais → restaurar → `get_note` confirmando o que volta
e o que não volta → restaurar de novo não altera nada. **Zero linhas não-JSON no stdout** em todos
os roteiros, que é a regra que derruba o transporte stdio quando quebra. `get_board` e
`yubook://board/{id}` continuam devolvendo os mesmos **1385 bytes, caractere a caractere** — a
duplicação de superfície não virou duplicação de código.

**E a revisão pegou uma afirmação falsa antes de ela sair.** A descrição de `trash_note` dizia que
os links `[[…]]` não voltam ao restaurar; eles voltam. O erro nasceu **nesta entrega**, não é
dívida antiga, e está corrigido e reverificado no banco — 1 → 0 → 1 aresta em `note_link` ao
excluir e restaurar. O que ele custou está em [`docs/historico.md`](docs/historico.md); o que
importa aqui é que as descrições abaixo descrevem o comportamento real.

O preço está medido: `tools/list` foi de **3480 bytes com 5 tools para 8517 com 9**, e isso é gasto
em todo turno de conversa. É o custo da granularidade estreita, aceito de propósito. A revisão
cortou **273 bytes** de `description` e `.describe()` no fonte — texto que não mudava decisão
nenhuma do modelo — e só `trash_note` cresceu (+42), para desfazer a afirmação falsa. No fio, com o
JSON dos schemas junto, isso deu **196 bytes a menos** que antes das correções.

### Adicionado
- **`create_card`** — cria um card no fim de uma coluna, com título, descrição em Markdown, prazo,
  prioridade e tags. O quadro é deduzido da coluna: não existe parâmetro de quadro. Não cria
  coluna, quadro, workspace nem checklist. Data **sintaticamente válida e inexistente** — um
  `2026-13-45` — é recusada dizendo que o campo não é uma data existente, em vez de deixar um
  `Invalid time value` cru chegar ao modelo.
- **`move_card`** — move um card para outra coluna ou o reordena dentro da que já está. A posição
  pedida é **a posição em que o card vai ficar**, dita assim para não exigir subtração mental de
  quem chama. Card arquivado não se move: a recusa manda desarquivar primeiro.
- **`trash_note`** — manda a nota para a lixeira. A confirmação **separa o que a volta desfaz do
  que ela não desfaz**, porque são coisas de natureza oposta: os cards que apontavam para a nota
  perdem o vínculo e `restore_note` **não** o refaz, enquanto os links `[[…]]` são apagados e
  **voltam** ao restaurar. Os números vêm de uma leitura feita antes da exclusão — depois do fato
  não há mais o que contar. A conta de cards diz, no próprio texto, que **card arquivado também
  perde o vínculo e não entra nela**: a API zera o vínculo de todos, mas só os ativos são
  contáveis. Chamar `trash_note` numa nota que **já está** na lixeira não é mais um 404 que manda
  procurar o id onde a busca não enxerga — a tool diz desde quando ela está lá, devolve o id para
  `restore_note` e não registra passo de algo que não aconteceu.
- **`restore_note`** — tira a nota da lixeira, com os backlinks recalculados nos dois sentidos.
  Avisa, na própria descrição, que **não** refaz o vínculo dos cards e que pode falhar por título
  duplicado, se outra nota tiver tomado o título enquanto esta estava lá.
- **Notificação de log a cada escrita** (`notifications/message`): é o único registro que chega ao
  usuário de que uma nota foi para a lixeira — o stderr deste pacote nenhum cliente MCP mostra.
- **Notificação de progresso**, emitida só quando o cliente manda um `progressToken` no `_meta` da
  chamada. Sem token, nada é emitido; o log continua nos dois casos.
- **`annotations` do MCP nas quatro tools novas**, para o cliente saber antes de chamar o que é
  destrutivo (`trash_note`) e o que é idempotente (`restore_note`).
- **Ambiente local de escrita**, separado do de desenvolvimento e da produção: banco `yubook_mcp`,
  API na porta 3334 por `pnpm --filter @yu-book/api dev:mcp`, e `pnpm --filter @yu-book/api db:seed`
  criando um acervo recriável e o usuário `mcp@yu-book.test`. O seed é idempotente e escreve
  **pelos services**, não pelo Prisma cru, para que `note_link` exista e as posições nasçam
  contíguas — a gaveta de links é a única exceção, e está comentada no arquivo. O acervo é
  desenhado para **exercitar caminho, não para parecer cheio**: **16 cards, dos quais 15 ativos** —
  `list_boards` diz 15 porque conta só os ativos, e o décimo sexto está arquivado de propósito —,
  duas notas na lixeira — uma para a restauração feliz, outra que perdeu o
  título para uma nota ativa e faz a restauração falhar com 409 —, um card com checklist 2/3, três
  links na gaveta, e a coluna "Fazendo" com **4 cards ativos contra um `wipLimit` de 3**, estourada
  de propósito, porque o limite existe para avisar e não para bloquear. Instruções no
  [README](README.md) e em [`apps/mcp/README.md`](apps/mcp/README.md).
- **`pnpm --filter @yu-book/mcp verificar` passa a dizer se a escrita está ligada** e contra que
  tipo de host — a pergunta que o utilitário responde deixou de ser só "estou lendo de onde?".

### Alterado
- **Os dois prompts empacotados deixaram de proibir ação.** Onde diziam "este servidor é somente
  leitura", agora dizem o que mudou: a revisão do dia pode *propor* uma escrita e nomear a tool que
  a executa, mas não chama nenhuma sem pedido; retomar contexto segue sendo leitura.
- **`get_board` passa a imprimir o id de cada coluna**, sob o nome dela. Custa 36 caracteres por
  coluna e é o que torna as escritas de kanban alcançáveis.
- **O erro de validação que chega ao modelo agora nomeia o campo e o motivo**, em vez da frase
  "Dados inválidos", que não dizia nada e levava o modelo a repetir a mesma chamada errada. O erro
  de título duplicado ganhou explicação própria, incluindo o caso em que o título foi tomado
  enquanto a nota estava na lixeira. O `NOT_FOUND` ganhou a cláusula da lixeira, pelo mesmo motivo
  que a ausência dela custava caro: mandar o modelo reconferir o id em `search_notes` é inútil
  quando o id que ele tem é o de uma nota excluída, que a busca por desenho não enxerga.
- **As descrições das tools encolheram 273 bytes sem perder informação acionável.** Saiu do
  `.describe()` de `tags` a explicação da normalização silenciosa do servidor, que o modelo não tem
  como acionar nem evitar, e portanto não muda decisão nenhuma dele. Texto de tool é orçamento
  gasto em todo turno.
- `prisma/**/*` entrou no `tsconfig.test.json` de `apps/api`, para que o seed não escape do
  `pnpm typecheck` — o único portão automático que existe aqui.
- `docs/prd-fase-5-refino.md` foi para `docs/old/` com a Fase 5 fechada, e a proposta de MCP saiu de
  `docs/temp/` para [`docs/old/proposta-mcp-inicial.md`](docs/old/proposta-mcp-inicial.md). Os links
  de quem apontava para elas foram corrigidos; o conteúdo dos dois, não — documento em `docs/old/`
  é registro de época. O nome do contêiner do Postgres ficou igual no `README.md` da raiz e no de
  `apps/mcp` — divergiam no mesmo diff, e um dos dois comandos de setup falhava copiado como está.

### Corrigido
- **O prazo de um card era relatado um dia à frente.** O front grava o prazo às 23:59:59 do fuso
  local; o servidor MCP cortava o texto da data em UTC, e em UTC-3 isso cai no dia seguinte. Valia
  para **todo** card com prazo, em `get_board`, `get_dashboard` e nos dois prompts. Bug preexistente
  desde a Etapa 1.
- **Não havia como descobrir o id de uma coluna pelo MCP**, o que teria deixado `create_card` e
  `move_card` inalcançáveis: nenhuma tool, resource ou prompt imprimia `columnId`. Era bloqueante
  para esta etapa.
- **Detalhe de erro de validação era descartado antes de chegar ao modelo** — `issues` vinha da API
  e era jogado fora. Tolerável enquanto o servidor só lia; inútil agora que ele erra por campo.
- **Os dois prompts afirmavam que o servidor é somente leitura**, o que desligaria as tools novas
  justamente nos fluxos empacotados.

### Segurança
- **A escrita nasce desligada fora de um host local.** As quatro tools novas só se registram quando
  `YUBOOK_API_URL` aponta para localhost; contra a Railway elas **somem do `tools/list`**, e o motivo
  vai para o stderr no boot. `YUBOOK_ESCRITA_REMOTA=1` destrava, deliberadamente. Enquanto o servidor
  só lia, apontar o `.env` para produção era inofensivo — deixou de ser: um pedido mal interpretado
  pelo modelo cria dado de verdade, e não existe desfazer deste lado.
- **Exclusão definitiva de nota e exclusão de card não viraram tool**, nem por engano de nome: as
  duas são irreversíveis e continuam só no aplicativo, com um humano confirmando. `trash_note` foi
  batizada assim, e não `delete_note`, também por isso.

### Limitações conhecidas
- **A trava de ambiente protege contra *remoto*, não contra *o banco errado*.** Ela verifica o
  host, e `localhost:3333` — o banco de **desenvolvimento** — passa por ela sem reclamar. Isso não
  é hipótese para quem for configurar: é o estado de quem **já** configurou, porque `3333` era o
  padrão anterior do `.env.example` e nenhum `.env` existente foi migrado. Nesse caso o stderr
  anuncia `escrita: habilitada (API local)` com toda a confiança, e as tools escrevem no acervo de
  trabalho de verdade. A porta é a única diferença entre os dois ambientes e nada a verifica.
  **Confira a porta no `.env` antes de usar escrita.**
- **A volta dos backlinks ao restaurar é melhor esforço, e falha por caixa.** A API acha as notas
  que citam a restaurada filtrando o texto por `[[` mais o título, **sensível a maiúscula**, mas
  casa o alvo ignorando acento e caixa. Medido: `[[Notificações de progresso` reencontra a nota,
  `[[notificações de progresso` não. Um `[[wikilink]]` escrito com caixa diferente da do título
  continua funcionando na interface e não volta à tabela de links.

---

## [0.6.0] — 2026-08-24

**Etapa C da Fase 5 — a nota**: botão de copiar e um quarto modo de edição, "ao vivo". Com ela a
**Fase 5 está completa** (Etapas A, B e C entregues). Mudou **só `apps/web`** — nenhum contrato,
migration, endpoint ou primitiva do MCP —, então só ele bumpa, de `0.4.0` para `0.5.0`; `apps/api`,
`apps/mcp` e `packages/shared` seguem em `0.3.0`. Requisitos em
[`docs/old/prd-fase-5-refino.md`](docs/old/prd-fase-5-refino.md) §5.4 e §5.5 (RF-28 a RF-41).

É a primeira dependência externa nova do front desde a Fase 3: seis pacotes (`@codemirror/state`,
`@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/autocomplete` e
`@lezer/markdown`), autorizados pelo operador em D-01 e **só eles** — RNF-13 continua valendo.
O editor entra por `import()` sob demanda: o chunk ficou em **115,9 KB comprimidos**, dentro do teto
de 120 KB de RNF-05, e o bundle inicial seguiu em 171,35 KB gz, inalterado.

**Esta etapa não foi executada uma única vez.** `pnpm typecheck` limpo nos quatro pacotes, os 55
testes de integração da API verdes (regressão — nenhum novo, a Etapa C não toca a API) e
`pnpm --filter @yu-book/web build` ok, mas **nenhum portão do projeto carrega uma `EditorView`**,
porque não existe teste de front aqui. Um editor inteiro foi escrito e nunca rodou: **CA-23 a CA-35
estão implementados e não verificados**. É a terceira entrega seguida nessa condição. O que falta
conferir está em [`docs/historico.md`](docs/historico.md).

### Adicionado
- **Modo "ao vivo", o quarto do editor de notas** (RF-32 a RF-41): a marcação some do que já foi
  escrito e o texto aparece formatado no próprio lugar em que se digita — `# Título` vira título sem
  o `#`, `**negrito**` vira negrito sem os asteriscos. A linha onde o cursor está mostra a marcação
  crua (RF-34), e selecionar um trecho revela a marcação de tudo o que está dentro da seleção
  (RF-35). O documento continua sendo a string de Markdown: fechar uma nota sem digitar não altera
  um byte.
- **`[[wikilink]]` clicável dentro do texto** no modo ao vivo (RF-36), com o mesmo comportamento do
  preview — resolvido navega, não resolvido cria a nota — e os não resolvidos continuam marcados.
- **Caixa de tarefa clicável** (RF-39): marcar `- [ ]` no modo ao vivo edita o texto do Markdown.
- **Autocomplete de `[[` e atalhos de formatação no modo novo** (RF-37, RF-38): `Ctrl+B`, `Ctrl+I`,
  `Ctrl+K`, ``Ctrl+` `` e `Ctrl+S` continuam, e cada aplicação de marcação é **um** passo do
  desfazer (CA-31).
- **Botão de copiar a nota inteira como Markdown**, no cabeçalho, ao lado do seletor de modo
  (RF-28 a RF-30): copia `# Título`, uma linha em branco e o corpo exatamente como está, sem
  reescrita. Copia o **rascunho**, não o que está gravado, porque entre a tecla e o autosave existem
  800 ms em que os dois divergem. Confirma por 2 segundos e anuncia por `aria-live`; falha de
  permissão da área de transferência vira aviso visível, não silêncio.

### Alterado
- **O modo "ao vivo" passa a ser o padrão** (RF-32), e a escolha de modo anterior é descartada uma
  vez: a chave do `localStorage` mudou de nome, então quem já tinha um modo salvo cai no novo padrão
  na primeira abertura e escolhe de novo se quiser. Os três modos antigos — `edicao`, `dividido` e
  `leitura` — continuam existindo e **idênticos**, inclusive a rolagem sincronizada do dividido
  (RF-40) e o autosave (RF-41).
- **O PRD da Fase 5 foi corrigido em três pontos que a entrega contradisse**: RF-31 (atalho do botão
  de copiar) saiu do escopo, a remoção de `caret.ts` prometida em D-01 e na §17 não aconteceu, e o
  realce de sintaxe dentro de bloco de código descrito em RF-33 não vale para o modo ao vivo.

### Corrigido
- **`Ctrl+K` dentro do editor abria a paleta de busca além de inserir o link.** O handler chamava
  `preventDefault` sem `stopPropagation`, e o listener global de `window` recebia o evento assim
  mesmo.
- **`Ctrl+Shift+B` deixava a seleção em negrito além de navegar para os boards.** O mapa de atalhos
  do editor nunca testava `shiftKey`, e com Shift o `e.key` é `"B"`, que minúsculo casa com o
  negrito. Os dois eram bugs pré-existentes, não introduzidos pela etapa.

### Limitações conhecidas
- **O botão de copiar não tem atalho de teclado** (RF-31 fora do escopo, decisão do operador):
  `Ctrl+Shift+C` é "inspecionar elemento" no Chrome e no Firefox, e `preventDefault()` não cancela.
- **Bloco de código no modo ao vivo não tem realce por token** — só fonte monoespaçada e fundo.
  Realce dentro da cerca exigiria parsers aninhados por linguagem, exatamente o peso recusado em
  D-01. Nos modos `dividido` e `leitura` o realce completo continua, via `renderMarkdown`.
- **O mesmo texto pode aparecer levemente diferente entre o modo ao vivo e o modo leitura**: são
  dois parsers de Markdown convivendo no bundle, o `marked` e o do Lezer.
- **Para leitor de tela, o modo ao vivo é pior que a `<textarea>`.** Manter os três modos antigos
  intactos **é** a mitigação — ver [`docs/historico.md`](docs/historico.md).

---

## [0.5.0] — 2026-08-24

**Etapa B da Fase 5**: precisão e fluidez do arraste do kanban. Mudou **só `apps/web`** — nenhum
contrato, migration, endpoint ou primitiva do MCP —, então só ele bumpa, de `0.3.0` para `0.4.0`;
`apps/api`, `apps/mcp` e `packages/shared` seguem em `0.3.0`. A Etapa **C** (copiar nota e editor ao
vivo) não começou: a Fase 5 **não** está concluída. Requisitos em
[`docs/old/prd-fase-5-refino.md`](docs/old/prd-fase-5-refino.md) §5.3 (RF-18 a RF-27).

**Esta etapa não tem portão automático que a valide.** `pnpm typecheck` nos quatro pacotes, os 55
testes de integração da API (regressão — nenhum novo, a Etapa B não toca a API) e o build do front
passaram, mas o que ela entrega é tato, e não existe teste de front no projeto: CA-14 a CA-22 estão
implementados e **não verificados à mão**. O que falta conferir está em
[`docs/historico.md`](docs/historico.md).

### Alterado
- **O destino do arraste passa a ser decidido pelo ponteiro** (RF-19): `pointerWithin` primeiro,
  `rectIntersection` quando o ponteiro não está sobre nada e `closestCorners` como último recurso —
  encadeados, nunca somados, porque a pontuação de cada algoritmo está em escala própria e misturar
  as listas ordena por números incomparáveis. O arraste por teclado, que não tem coordenada de
  mouse, cai no fallback retangular e continua com a mesma completude (INV-30).
- **A posição de inserção é contada, não apontada** (RF-18): o índice é quantos cards da coluna têm
  o ponto médio acima do ponteiro, ignorando o card arrastado. Antes era o índice do card sob o
  cursor.
- **O destino aparece como um vão de contorno tracejado**, no lugar do card fantasma em opacidade
  reduzida (RF-22).
- **O gesto ficou mais legível**: cursor de "segurando" durante todo o arraste e animação de
  assentamento ao soltar (RF-23).
- **A rolagem automática ficou mais estreita na horizontal** e mais generosa na vertical (RF-21).
  Com o limiar padrão, a faixa lateral de um board largo engolia a primeira e a última coluna, e
  elas nunca rolavam na vertical.
- **Menos repintura durante o arraste** (RF-25): a lista de cards visíveis devolve a mesma
  referência quando não há filtro, os `items` dos dois `SortableContext` são memoizados e o cartão
  do card só repinta quando os dados dele mudam.
- Nada do arraste por teclado mudou (RF-26): `Espaço` pega e solta, `Esc` cancela, as setas movem e
  cada etapa continua sendo anunciada.
- O PRD da Fase 5 foi corrigido em três pontos, e um deles **renumerou a Etapa C**: RF-18 passou a
  descrever a contagem geométrica com a nota de por que a redação anterior oscilava; RF-20 virou um
  bloco de "já atendido, não implementar"; e entrou o RF-27, descoberto na investigação. A Etapa C,
  que ia de RF-27 a RF-40, agora vai de **RF-28 a RF-41**.

### Corrigido
- **A última posição de uma coluna cheia era inalcançável**, a não ser mirando a margem inferior do
  quadro: como o índice vinha do card sob o cursor, não havia card abaixo do último para apontar.
- **O vizinho trocava de lugar sozinho com a mão parada.** Duas causas somadas: a regra do ponto
  médio se invertia no frame seguinte ao da inserção, e a estratégia de ordenação vertical dos
  cards deslocava de novo o vizinho que o DOM já tinha reordenado (RF-27). As estratégias dos cards
  foram desligadas; as das **colunas** continuam ligadas, porque ali os itens não mudam durante o
  gesto e o deslocamento é o único mecanismo que existe.

---

## [0.4.0] — 2026-08-24

**Etapa A da Fase 5**: tags de card no kanban e busca na lista de tags da barra lateral. As duas
saíram juntas porque são o mesmo gesto — filtrar uma lista de etiquetas por texto digitado —, e
implementá-las em sessões separadas as faria divergir. A Etapa **B** (precisão do arraste) saiu logo em seguida, na
`0.5.0`; a **C** (copiar nota e editor ao vivo) não começou: a Fase 5 **não** está concluída.

Os quatro pacotes vão a `0.3.0`. `packages/shared` mudou contrato — `CardSummary` e `cardInputSchema`
ganharam `tags` —, e a regra do projeto manda bumpar junto quem consome o contrato: `apps/api`,
`apps/web` e `apps/mcp`. Requisitos em [`docs/old/prd-fase-5-refino.md`](docs/old/prd-fase-5-refino.md).

### Adicionado
- **Tags de card no kanban** (RF-01 a RF-07): até 8 etiquetas livres por card, com até 24
  caracteres cada, criadas ao digitar no painel do card — não existe tela de cadastro. O seletor
  oferece as tags já em uso naquele board, ordenadas por quantidade de cards, para que marcar o
  segundo card com o mesmo assunto seja escolher e não redigitar. A face do card mostra três
  etiquetas e resume o resto em `+n`.
- **Barra de filtro por tag acima das colunas** (RF-08 a RF-10). O filtro é **OU**: duas tags
  selecionadas mostram os cards que tenham qualquer uma das duas. Cada coluna passa a exibir
  `visíveis de total` enquanto o filtro estiver valendo. É local — não vai para a URL, não sobrevive
  a recarregar a página nem a trocar de board.
- **Busca no cartão de tags da barra lateral** (RF-12 a RF-17): campo acima da lista, casando por
  trecho, sem acento e sem caixa (`progr` acha `programação`). Uma tag ativa como filtro continua
  visível mesmo que não case com o texto — esconder um filtro que está valendo faria a tela mentir.
  Com texto digitado o campo declara quantas tags de quantas está mostrando; `Esc` limpa o texto e,
  já vazio, devolve o foco à lista; nenhuma tag casando, o cartão diz qual termo não achou nada.
- Migration `20260824215324_tags_do_card`: coluna `tags` (`text[]`) na tabela `card`. **Sem índice**
  — o filtro roda no cliente sobre o board que `GET /boards/:id` já devolve inteiro, e índice sem
  consulta que o use é peso morto na escrita.
- Oito testes de kanban: normalização, fusão por acento e caixa, corte da tag longa em vez de
  recusa, `422` ao passar de 8 tags sem gravar nada, tags na face de cada card, e preservação das
  tags ao salvar só o título, ao mover e ao arquivar.

### Alterado
- **Reverte o NO6 da Fase 2** ("etiquetas próprias do card não; tags são de nota"). O uso mostrou
  que assunto e estágio são eixos independentes: a coluna diz em que ponto o card está, a tag diz de
  que assunto ele é, e forçar os dois no mesmo eixo multiplicava colunas.
- `CardSummary` passa a trazer `tags` e `cardInputSchema` a aceitá-las; `CardDetail` e
  `cardUpdateSchema` herdam. **Nenhum endpoint novo:** o catálogo de tags de um board é derivado dos
  cards que a resposta do board já traz, e um `/boards/:id/tags` seria segunda fonte de verdade para
  a mesma informação.
- O texto da tag é normalizado no servidor mesmo já tendo sido normalizado no front, e duas tags que
  só diferem por acento ou caixa são fundidas numa só, prevalecendo a primeira grafia recebida
  (RN-01, RN-02). `tags` só é gravada quando vem na requisição, para que salvar só o título de um
  card não zere as etiquetas dele.
- **Com filtro de tag ativo, mover card fica desabilitado — mouse e teclado** (RN-05). O índice de
  destino é contado sobre a lista renderizada; filtrada, "soltar na segunda posição" viraria a
  segunda posição do recorte e o servidor renumeraria a coluna inteira em cima disso. Recusar o
  gesto, com o motivo escrito no quadro e um botão para limpar o filtro, é mais honesto que traduzir
  índices.
- O servidor MCP mostra as tags na linha de cada card (RF-11), e a descrição de `get_board` passou a
  dizer que elas agrupam por assunto num eixo independente da coluna. O resource
  `yubook://board/{id}` herda sem alteração, porque formata pela mesma função.
- A revisão passou a ter o que cobrar: `invariantes-yu-book` ganhou INV-33 (arraste desligado sob
  filtro) e INV-34 (as duas noções de tag não são para ser unificadas), e `contrato-compartilhado`
  ganhou `normalizarTag` no catálogo de espelhamentos que quebram em silêncio.
- `PROPOSTA.md` virou [`docs/old/PROPOSTA-inicial.md`](docs/old/PROPOSTA-inicial.md) e
  `docs/prd-mcp-resources-e-prompts.md` foi para `docs/old/`. Os dois são registro do que se decidiu
  na época, não descrição do estado atual. As referências no README acompanham.

---

## [0.3.0] — 2026-08-24

Etapas 2 e 4 do servidor MCP: com elas o servidor passa a expor as três primitivas do protocolo —
tools, resources e prompts — e as propriedades de contrato que elas exigiram. **Nenhuma migration
nesta versão:** as colunas já existiam na tabela; o que mudou foi o que a API expõe (RF-25).

Os quatro pacotes vão a `0.2.0`. `packages/shared` mudou contrato, e a regra do projeto manda bumpar
junto quem consome o contrato — `apps/api`, `apps/web` e também `apps/mcp`, que importa os mesmos
tipos. Requisitos em [`docs/old/prd-mcp-resources-e-prompts.md`](docs/old/prd-mcp-resources-e-prompts.md).

### Adicionado
- **Resources do servidor MCP** (RF-01 a RF-06): `yubook://notas`, `yubook://boards`,
  `yubook://tags` e `yubook://workspaces`. São índices — identificam e rotulam, sem corpo de nota
  nem descrição de card. O catálogo de notas para em 200 itens e **declara o total real quando
  corta** (RNF-01): cap silencioso faz o modelo concluir que o acervo é só aquilo. Notas na lixeira
  não aparecem.
- **Resource templates** `yubook://nota/{id}` e `yubook://board/{id}` (RF-07 a RF-10) — o conteúdo
  sob demanda, endereçado por uuid, para que renomear uma nota não invalide uma URI já injetada no
  contexto de alguém. Verificado contra a API de produção: `yubook://nota/{id}` e a tool `get_note`
  devolvem os mesmos 5080 bytes, caractere a caractere (CA-05).
- **Prompts** `revisao_semanal` e `retomar_contexto` (RF-13 a RF-18). Buscam pelas tools e declaram
  o que **não** fazer: não inventar prazo que não veio da API, não embutir conteúdo de nota na
  própria mensagem, citar o `id` de cada nota mencionada.
- **Tool `get_dashboard`** (RF-11, RF-12): prazos vencidos, prazos dos próximos sete dias, notas
  editadas recentemente e o tamanho da fila de links, numa requisição só. É a fonte dos prompts —
  nenhum deles remonta esse recorte por conta própria.
- Nono agente especialista, `mcp`, dono de `apps/mcp`, e a sétima skill, `servidor-mcp-yu-book`. O
  agente opera em dois modos: criar ou alterar uma primitiva, e verificar propagação depois que o
  domínio mudou (RF-38i a RF-38m, RF-50a).

### Alterado
- `CardSummary` passa a trazer `updatedAt` (RF-23). "O que está parado" é uma pergunta sobre o
  quadro inteiro, e respondê-la exigia uma requisição por card. `CardDetail` herda a propriedade em
  vez de declarar a sua.
- `GET /notes/titles` passa a devolver `NoteTitle`, com o nome do workspace e `updatedAt` (RF-24).
  Um endpoint só serve ao autocomplete de `[[…]]` no front e ao catálogo do servidor MCP.
- A tool `get_board` passa a formatar pela mesma função do resource equivalente (RF-19): tool e
  resource são duas superfícies do mesmo recurso, e o que se duplica de propósito é a superfície,
  nunca a implementação.
- O `revisor` ganhou um passo no checklist: diff que toca `packages/shared/src` vira observação de
  que o agente `mcp` deve rodar no modo de propagação.
- `docs/casos-para-conteudo.md` foi para `docs/temp/` — é matéria-prima de outro projeto, não
  documentação técnica do Yu-book.

### Corrigido
- O catálogo de notas era orçado em "~40 bytes por nota", número que nunca foi medido e que chegou a
  ser copiado para um requisito não funcional. A medição real dá ~100 bytes, porque o uuid sozinho
  ocupa 36 caracteres. Corrigido no comentário de `titulos()` e em RNF-01, que passou a limitar o
  catálogo por **quantidade** de itens em vez de por tamanho de acervo.
- JSDoc duplicado em `titulos()`: o comentário antigo sobreviveu a uma reescrita e ficou empilhado
  com o novo.

---

## [0.2.0] — 2026-08-22

Infraestrutura de trabalho e a primeira etapa do servidor MCP. **Nenhum dos serviços deployados
mudou**: `apps/api`, `apps/web` e `packages/shared` seguem em `0.1.0`. O pacote novo `apps/mcp`
nasce em `0.1.0`.

### Adicionado
- **Servidor MCP do Yu-book** em `apps/mcp` (Etapa 1 — só leitura, transporte stdio), com as tools
  `search_notes`, `get_note`, `list_boards` e `get_board`. Registrado em `.mcp.json`.
  Verificado contra a API de produção: as quatro tools respondem sobre dados reais.
- `pnpm --filter @yu-book/mcp verificar`, diagnóstico que confirma `/health`, `/health/db`, o login
  e a contagem de notas antes de conectar um cliente.
- **Estrutura `.claude/` de trabalho:** oito agentes especialistas, seis skills e memória
  persistente por agente, com `CLAUDE.md` como contexto mínimo. Requisitos em
  [`docs/old/prd-agentes-e-skills.md`](docs/old/prd-agentes-e-skills.md).
- `CHANGELOG.md` e `docs/historico.md`.

### Alterado
- Os PRDs de fase foram arquivados em `docs/old/`; as referências no README, no `CLAUDE.md` e nas
  skills acompanham o novo caminho.
- `pnpm build` na raiz passa a compilar também `@yu-book/mcp`.

---

## [0.1.0] — 2026-08-20

Fases 0 a 4 do projeto, entregues sem release intermediário. Reconstruída retroativamente a partir
dos PRDs de fase e do histórico do git.

### Adicionado

**Fundação (Fase 0)**
- Monorepo pnpm com `apps/api` (Fastify + Prisma + Postgres), `apps/web` (React + Vite + Tailwind) e
  `packages/shared` (schemas Zod usados pelos dois).
- Autenticação de dois tokens: access JWT HS256 de 15 min mantido em memória no front, e refresh
  opaco de 7 dias em cookie `httpOnly` guardado como hash no banco, com rotação a cada uso,
  detecção de reuso e consumo atômico.
- Deploy na Railway em três serviços a partir do mesmo repositório, com `prisma migrate deploy` no
  boot e healthcheck em `/health` e `/health/db`.

**Notas (Fase 1)**
- CRUD de notas com uma entidade `Note` e um campo `kind` (`aula`, `projeto`, `trilha`, `trabalho`,
  `livre`), com campos livres por tipo em `meta` (JSONB).
- Editor Markdown com preview lado a lado e autosave 800 ms depois da última tecla, com 3 novas
  tentativas a cada 5 s em caso de falha de rede (RF-14, RF-17).
- Links `[[wiki]]` entre notas, com backlinks no rodapé, autocomplete ao digitar `[[` e criação da
  nota a partir de um link que ainda não existe.
- Busca full-text em português com `unaccent` e stemming, ranking com título pesando mais que o
  corpo, e queda para similaridade por trigrama quando não há resultado exato.
- Tags, workspaces e lixeira reversível.

**Workspace global e kanban (Fase 2)**
- Seletor de workspace que troca o contexto da aplicação inteira e sobrevive a recarregar a página.
- Boards por workspace, nascendo com `A fazer`, `Fazendo` e `Feito`; cards com prazo, prioridade,
  checklist e descrição em Markdown.
- Movimentação por mouse e por teclado, com as duas fazendo a mesma coisa e cada etapa anunciada
  para leitor de tela; posições renumeradas em transação, sem empate nem buraco (RN-01).
- Vínculo card ↔ nota nos dois sentidos, e cards nos resultados da paleta de busca.

**Gaveta de links (Fase 3)**
- Duas listas — favoritos e "ver depois" — numa entidade `Link` com um campo `kind`.
- Captura arrastando o link de outra janela para qualquer ponto da aplicação, com `Ctrl+V` como
  alternativa dentro da gaveta.
- Leitura do título da página no servidor, tratada como origem hostil: recusa endereço privado, de
  laço, link-local e CGNAT, revalida a cada redirecionamento, lê no máximo 512 KB e desiste em 2 s.
- Identidade visual por bloco de cor derivada do domínio, sem favicon — buscar o ícone entregaria a
  um terceiro a lista de tudo que se guarda.

**Dashboard e tema claro (Fase 4)**
- Tela inicial em `/` com prazos vencidos e da semana, notas recentes e o tamanho da fila de links,
  tudo em uma requisição e nada dali escrevendo.
- Tema claro além do escuro, com a escolha aplicada antes da primeira pintura para não piscar ao
  carregar. Contraste dos dois temas verificado por cálculo em 74 pares texto/fundo, em WCAG AA.

**Vídeos do YouTube na gaveta**
- Título lido pelo oEmbed, miniatura montada a partir do id do vídeo sem requisição no salvamento, e
  duração quando existir `YOUTUBE_API_KEY` no ambiente.

### Alterado
- Navegação lateral redesenhada: ícones próprios em SVG na grade 16×16, seções recolhíveis que
  continuam mostrando o filtro ativo quando fechadas, e tags num cartão próprio.
- Cache do front após salvar deixa de invalidar seis consultas por pausa de digitação e passa a
  costurar a resposta, com uma requisição.
- `GET /notes` passa a truncar o trecho no banco em 600 caracteres, em vez de trazer o corpo inteiro
  de 50 notas — 4,2 MB para 24 KB por página, medido com notas de 100 KB.
- `GET /notes/counts` passa de quatro `count` para uma varredura com `FILTER`.
- `note_link` só é recalculado quando o conjunto de `[[…]]` muda.
- Respostas da API passam a ser comprimidas com gzip acima de 1 KB.
- O kanban vira um chunk carregado sob demanda: bundle inicial de 600 KB para 525 KB.

### Corrigido
- Build da Railway falhava por poda de `devDependencies`; `NODE_ENV=production` passou a valer só no
  runtime, não no build.
- Node fixado em 22 nos dois serviços.

### Segurança
- Contraste do tema escuro corrigido: branco sobre `accent-500` estava em 4,47:1, abaixo do mínimo
  de 4,5 do WCAG AA.
- Rate limit de 10 tentativas por 5 minutos por IP no login, e custo constante para email
  inexistente, para que o tempo de resposta não revele quais contas existem.
- Cadastro fechável por `ALLOW_SIGNUP`, com padrão fechado em produção.

[Não lançado]: https://github.com/yjdutra/Yu-book/compare/5fb0f52...HEAD
