# Invariantes — front

Referência da skill `invariantes-yu-book`. Cobre `apps/web`.
O servidor e o contrato estão em `referencias/servidor.md`.

## Autosave e cache

**INV-23 — O autosave faz cirurgia de cache, não invalidação.** `useAtualizarNota`
(`apps/web/src/lib/notas.ts:190`) compara o `NoteDetail` em cache com a resposta e invalida só o que
mudou de fato; salvamento de corpo — o caso comum, a cada 800 ms — invalida **nada**, apenas costura
a resposta nas listas (`costurarNasListas`, `:153`). Levou o autosave de 6 requisições por pausa para
1. Trocar isso por `invalidateQueries` amplo é regressão de desempenho, não simplificação.

**INV-24 — `refetchType: "none"` é idioma do projeto.** Marca `search` e `dashboard` como obsoletos
sem refazer a requisição (`notas.ts:124,230`). Aparece também em `kanban.ts` e `links.ts`.

**INV-25 — Renomear nota invalida tudo.** Se o título mudou, invalida `titles` e **todas** as notas,
porque o servidor reescreveu `[[…]]` em outras notas (RN-03).

**INV-26 — O autosave guarda callbacks em ref de propósito.** `apps/web/src/lib/useAutosave.ts:42-45`.
O objeto de mutation do TanStack tem identidade nova a cada render; sem as refs, o efeito de debounce
reagenda para sempre e **o autosave nunca dispara**. Constantes: 800 ms de debounce (`:10`), 5 s de
reintento (`:11`), máximo 3 tentativas (`:12`).

**INV-27 — Trocar de nota descarta o timer pendente.** `useAutosave.ts:52-56`: a troca de chave
limpa o timer e adota o valor novo como "já salvo". Sem isso, o conteúdo da nota anterior vaza
para a nova.

**INV-28 — Erro de título duplicado não é reintentado.** É erro de entrada do usuário; reintentar
martela a API.

---

## Kanban

**INV-29 — Durante o arraste, o estado local vence; fora dele, o servidor vence.**
`apps/web/src/components/Quadro.tsx:202-205`. Remover essa guarda faz o card saltar de volta no meio do
arraste.

**INV-30 — O teclado do kanban é remapeado.** `Espaço` pega e solta, `Esc` cancela
(`Quadro.tsx:214`), porque `Enter` está reservado para abrir o card. O `PointerSensor` exige 4 px de
deslocamento (`:209`) para que clique continue sendo clique.

**O vão do arraste esconde o card com `opacity-0`, nunca com `visibility`**
(`ColunaQuadro.tsx:81`, razão escrita em `:57-59`). Aquele `div` é o elemento focado e é nele que o
`KeyboardSensor` escuta; `visibility: hidden` o tira da árvore de foco e mata o arraste por teclado.
Parece detalhe de estilo e derruba INV-30 — e **não existe teste de front neste projeto**, então cai
em silêncio.

**INV-33 — Com filtro de tag ativo no board, o arraste é desligado** (RN-05). `arrasteDesativado`
nasce como `filtrando` em `apps/web/src/components/Quadro.tsx:152`, é entregue à coluna em
`:390` e propagado para os `useSortable` de `apps/web/src/components/ColunaQuadro.tsx:45` (card) e
`:128` (coluna), mais a alça de arrasto (`:202`). O índice de destino é contado sobre a lista
renderizada: se ela estiver filtrada, "soltar na segunda posição" vira a segunda posição **do
recorte**, e o servidor renumera a coluna inteira em cima disso (RN-01 / INV-11) — a ordem real
embaralha em silêncio. É o perigo que INV-11 existe para impedir, chegando por um caminho novo.
Quem "consertar" isso permitindo arraste filtrado reintroduz corrupção de ordem.

O que sustenta a invariante:

- `Quadro` mantém `colunas` com **todos** os cards e passa `cardsVisiveis` só para renderizar
  (`Quadro.tsx:387`). `coluna.cards` continua sendo a verdade para contagem, limite de WIP e
  cálculo de posição. Não troque uma pela outra.
- **É "nenhum sensor inicia o gesto", não "nenhum droppable aceita".** `useSortable({ disabled:
  true })` com **booleano** normaliza para `{ draggable: true, droppable: false }`
  (`normalizeLocalDisabled`, `@dnd-kit/sortable/dist/sortable.esm.js:625` na 10.0.0) — os cards
  continuam **droppables** com o filtro ativo. Isso é inofensivo hoje só porque `arrasteDesativado`
  vale para o board inteiro e desliga também a coluna e a alça. Duas consequências: **nenhum
  caminho de arraste novo pode escapar de `arrasteDesativado`** (alça separada, `activatorNodeRef`
  próprio); e se o filtro um dia for por coluna em vez de por board, a forma objeto
  `{ draggable, droppable }` passa a ser obrigatória.
- **Não memoize `ColunaQuadro` com `React.memo`.** Ela recebe `colunas`, cuja identidade muda a cada
  `moverLocal` — a memoização falharia sempre, e o "conserto" seria tirar `colunas` ou `coluna.cards`
  das props, que é exatamente o que sustenta esta invariante.

**INV-35 — O índice de inserção do arraste é contagem geométrica, não "sobre qual card estou".**
`indicePorPonteiro` (`Quadro.tsx:102`, RF-18) conta quantos cards da coluna têm o **ponto médio
acima do ponteiro**, ignorando o arrastado. A formulação óbvia — ponto médio do card sob o cursor —
**oscila**: inserir empurra aquele card, a metade dele cruza o ponteiro, a conta se inverte no frame
seguinte, com a mão parada. Esta é idempotente por construção: inserir em k empurra só quem tem
índice ≥ k, e recontar devolve k. Não depende da altura do card arrastado nem de onde ele foi pego,
e funciona no `gap` entre dois cards e no vazio da coluna, onde não existe "card sob o cursor".
Card ainda não medido **não** entra na conta (`:112-114`) — contá-lo deslocaria a fila inteira.

O **ramo do teclado é outro código de propósito** (`:273-284`), o da Fase 2, com um off-by-one que
só parece erro: `moverLocal` remove o card **antes** do `splice` (`:72-76`), então "inserir no índice
do alvo" já significa *depois* dele quando o movimento é para baixo na mesma coluna — que é a
semântica que as setas querem. Unificar os dois ramos quebra um dos lados.

**INV-36 — Os cards não usam estratégia de ordenação; as colunas usam.** (RF-27) Quem "padronizar"
os dois quebra um dos lados.

| | Cards | Colunas |
|---|---|---|
| `strategy` | `SEM_DESLOCAMENTO = () => null` (`ColunaQuadro.tsx:31`, aplicada em `:384`) | `horizontalListSortingStrategy` (`Quadro.tsx:374`) |
| Quem abre o vão | o DOM: `moverLocal` reordena o estado a cada `dragOver` e o React repinta na ordem nova | o transform, único mecanismo que existe ali |
| `items` durante o gesto | mudam a cada `dragOver` | não mudam — `aoPassar` retorna cedo para `tipo !== "card"` (`Quadro.tsx:256`) |

Uma estratégia por cima do DOM desloca **de novo** o que já foi deslocado:
`verticalListSortingStrategy` empurraria o vizinho pela altura do card ativo, em cima da lista que o
DOM já reordenou. E não é sempre — é pior: o `SortableContext` desliga os transforms enquanto os
`items` mudam e os **religa no primeiro frame em que a lista se repete**
(`disableTransforms = … || itemsHaveChanged`, `@dnd-kit/sortable/dist/sortable.esm.js:314`, com
`previousItemsRef` atualizado num efeito **passivo**, `:322`) — exatamente quando a mão para para
mirar. Argumento completo em RF-27 de `docs/prd-fase-5-refino.md`.

---

## Tags

**INV-34 — Tag de nota e tag de card têm o mesmo nome e são coisas diferentes.** Não são para ser
unificadas; a tabela completa está na §7.3 de `docs/prd-fase-5-refino.md`.

| | Tag de nota | Tag de card |
|---|---|---|
| Escopo | acervo inteiro do usuário | um board |
| Vida | sobrevive à nota, some quando fica órfã (INV-20) | morre com o card |
| Identidade | linha na tabela `tag`, com id e cor | texto em `card.tags` (`text[]`) |
| Renomear | funde com a existente | não existe |
| Catálogo | endpoint `/tags`, resource `yubook://tags` | derivado dos cards em memória, sem endpoint |

Duas consequências que economizam busca:

- **Não existe `limparTagsOrfas` para tag de card, e não precisa existir.** A tag some do catálogo
  quando o último card que a usava perde a tag ou é arquivado
  (`catalogoDeTags`, `apps/web/src/lib/tags.ts:46`).
- **O filtro de tag do board é OU; o da barra lateral de notas é E.** `cardCasaFiltro`
  (`apps/web/src/lib/tags.ts:66`) usa `some`; as notas usam `AND` no Prisma
  (`apps/api/src/modules/notes/notes.service.ts:396`). Divergência de propósito, com razão escrita
  em `apps/web/src/components/BarraDeTags.tsx:16-21`: na barra lateral se estreita até achar uma
  nota; no board se agrega assunto espalhado por colunas, e E esvaziaria o quadro na segunda tag.
  **Não é bug de consistência.**

---

## Editor de notas

**INV-09 — Markdown só vira DOM depois do DOMPurify.** `renderMarkdown` em
`apps/web/src/lib/markdown.ts:83` sanitiza; é a única razão de `dangerouslySetInnerHTML` ser
aceitável (`Editor.tsx:369`). Nunca contorne.

O editor ao vivo abriu um **segundo caminho** de Markdown para DOM e não o contorna: as decorações
escondem, marcam e substituem trechos por elementos construídos no código, com `textContent` e
nunca `innerHTML` (`apps/web/src/lib/editorMdDecoracoes.ts:131`, razão em `:14-23`). Widget novo que
monte HTML a partir do texto da nota é a mesma falha por uma porta nova — CA-34 exige que nota com
HTML bruto não execute nada em nenhum dos quatro modos.

**INV-37 — O documento do editor ao vivo é a string de Markdown, e nada a altera sozinho.** Não há
modelo intermediário nem conversão de ida e volta: `EditorAoVivo`
(`apps/web/src/components/EditorAoVivo.tsx:95-129`) recebe e devolve `contentMd` cru. Abrir e fechar
uma nota sem digitar não altera um byte (RNF-08). É o que mantém o autosave (INV-23, INV-26,
INV-27), os `note_link` derivados (INV-17) e o `contentMd` que o MCP lê funcionando sem saber que
este editor existe.

O que sustenta a invariante:

- **`@codemirror/lang-markdown` é proibido.** Está fora de `apps/web/package.json` de propósito, e a
  linguagem é montada à mão sobre `@lezer/markdown` (`apps/web/src/lib/editorMd.ts:33-38`, razão em
  `:7-23`). Dois motivos, e **o segundo é o que quebra esta invariante**: aquele pacote instala três
  comportamentos que editam o documento sozinhos — continuar marcador de lista no Enter, trocar URL
  colada sobre seleção por `[texto](url)`, e completar tag HTML. O peso só acompanha: ele importa
  `@codemirror/lang-html` em escopo de módulo, que tree-shaking não remove, e traz ~60 KB gz de
  pilha HTML/CSS/JS contra os 120 KB de RNF-05. Quem "simplificar" trocando o parser cru por ele
  apaga, no mesmo diff, o comentário que explicava por quê — por isso a proibição está aqui.
- **A sincronia de fora para dentro compara antes de escrever** (`EditorAoVivo.tsx:150-156`). Sem a
  comparação, o `updateListener` sobe o valor, o React devolve por prop, e o editor reescreve o
  próprio documento para sempre.

**INV-38 — Os quatro modos não se unificam: a `<textarea>` é a mitigação de acessibilidade.** Só
`aovivo` monta o CodeMirror; `edicao`, `dividido` e `leitura` continuam na `<textarea>` de
`apps/web/src/components/Editor.tsx:303`. **Não é resíduo de migração.** O `contentDOM` do
CodeMirror é um `role="textbox"` que só ganha nome acessível por atribuição manual
(`EditorAoVivo.tsx:123-124`, `:140-143`), só o viewport existe no DOM, e `Decoration.replace` tira
texto do DOM (`editorMdDecoracoes.ts:279`, `:292-297`) — para leitor de tela o modo novo é **pior**
que a `<textarea>`. Manter os outros três é o que garante que sempre exista um modo plenamente
acessível. Quem "limpar duplicação" unificando os quatro no CodeMirror remove a mitigação sem
perceber, e nenhum portão acusa.

Consequência: **`apps/web/src/lib/caret.ts` não foi removido.** O autocomplete da `<textarea>`
continua usando `posicaoDoCursor` e `wikilinkEmDigitacao` (`Editor.tsx:5`, `:164-177`). A §12/D-01
de `docs/prd-fase-5-refino.md` prometeu a remoção; a promessa não se cumpriu e não vale mais.

**INV-39 — O editor tem dois mapas de atalho, e os dois precisam parar o evento.** Os atalhos
globais moram num listener de `window` (`apps/web/src/components/Aplicacao.tsx:173-211`), que recebe
o evento **mesmo depois de `preventDefault`**. Só `stopPropagation` o barra. Na `<textarea>` isso é
imperativo (`Editor.tsx:240`); no modo ao vivo é declarativo, `stopPropagation: true` em cada tecla
do `keymap` sob `Prec.high` para vencer o `defaultKeymap` (`apps/web/src/lib/editorMd.ts:161-178`).
Sem isso `Ctrl+K` insere o link **e** abre a paleta — regressão já corrigida uma vez.

A armadilha vizinha:

- **`Ctrl+Shift+B` e `Ctrl+Shift+L` são da navegação.** O mapa da `<textarea>` casa por
  `e.key.toLowerCase()`, então sem o teste de `e.shiftKey` (`Editor.tsx:225`) `Ctrl+Shift+B`
  navega **e** aplica negrito.
