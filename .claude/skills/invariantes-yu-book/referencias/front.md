# Invariantes — front

Referência da skill `invariantes-yu-book`. Cobre `apps/web`.
O servidor e o contrato estão em `referencias/servidor.md`.

## Autosave e cache

**INV-23 — O autosave faz cirurgia de cache, não invalidação.** `useAtualizarNota`
(`apps/web/src/lib/notas.ts:198`) compara o `NoteDetail` em cache com a resposta e invalida só o que
mudou de fato; salvamento de corpo — o caso comum, a cada 800 ms — invalida **nada**, apenas costura
a resposta nas listas (`costurarNasListas`, `:161`). Levou o autosave de 6 requisições por pausa para
1. Trocar isso por `invalidateQueries` amplo é regressão de desempenho, não simplificação.

**INV-24 — `refetchType: "none"` é idioma do projeto.** Marca `search` e `dashboard` como obsoletos
sem refazer a requisição (`notas.ts:129,238`). Aparece também em `kanban.ts` e `links.ts`.

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
`apps/web/src/components/Quadro.tsx:204-207`. Remover essa guarda faz o card saltar de volta no meio do
arraste.

**INV-30 — O teclado do arraste é remapeado.** `Espaço` pega e solta, `Esc` cancela
(`Quadro.tsx:216`), porque `Enter` está reservado para abrir o card. O `PointerSensor` exige 4 px de
deslocamento (`:211`) para que clique continue sendo clique. O quadro de modelos copia o mapa e a
folga (`apps/web/src/components/ajustes/QuadroDeModelos.tsx:230,233`), e o fluxo do editor de
rotinas também (`apps/web/src/components/rotinas/FluxoEditavel.tsx:402-405`).

**A origem do arraste some com `opacity-0`, nunca com `visibility`**, em todo arraste:
`ColunaQuadro.tsx:85` (razão em `:61-63`), o cartão numa coluna de tarefa do quadro de modelos
(`QuadroDeModelos.tsx:497`, razão em `:495-496`) e o passo no fluxo de rotina
(`FluxoEditavel.tsx:248`). O elemento que some guarda o foco e é nele que o
`KeyboardSensor` escuta; `visibility: hidden` o tira da árvore de foco e mata o arraste por teclado.
Parece detalhe de estilo e derruba INV-30 — e **não existe teste de front neste projeto**, então cai
em silêncio. Arraste novo entra nesta lista.

**O `onKeyDown` do ativador compõe com o do sensor, nunca o substitui.** Os `listeners` do
`useSortable` são `{ onPointerDown, onKeyDown }`, e é pelo `onKeyDown` que o `KeyboardSensor`
recebe o `Espaço`. Um `onKeyDown` escrito **depois** de `{...listeners}` o sobrescreve: o mouse
segue arrastando e o teclado nunca pega. A forma certa chama o do sensor no fim do próprio handler
(`GavetaLinks.tsx:51-61`, favoritos — defeito anterior ao redesenho, corrigido na Etapa 5), e o
card do kanban (`ColunaQuadro.tsx:77-88`, razão em `:83-86`). E as setas do gesto **borbulham** para os
`onKeyDown` React dos ancestrais: quem usa seta para outra coisa ignora durante o arraste, como a
gaveta faz com a ref `arrastando` (`GavetaLinks.tsx:145-150`, lida em `:224`).

**INV-33 — Com filtro de tag ativo no board, o arraste é desligado** (RN-05). `arrasteDesativado`
nasce como `filtrando` em `apps/web/src/components/Quadro.tsx:154`, é entregue à coluna em
`:394` e propagado para os `useSortable` de `apps/web/src/components/ColunaQuadro.tsx:48` (card) e
`:164` (coluna), mais a alça de arrasto (`:239`). O índice de destino é contado sobre a lista
renderizada: se ela estiver filtrada, "soltar na segunda posição" vira a segunda posição **do
recorte**, e o servidor renumera a coluna inteira em cima disso (RN-01 / INV-11) — a ordem real
embaralha em silêncio. É o perigo que INV-11 existe para impedir, chegando por um caminho novo.
Quem "consertar" isso permitindo arraste filtrado reintroduz corrupção de ordem.

O que sustenta a invariante:

- `Quadro` mantém `colunas` com **todos** os cards e passa `cardsVisiveis` só para renderizar
  (`Quadro.tsx:391-393`). `coluna.cards` continua sendo a verdade para contagem, limite de WIP e
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
`indicePorPonteiro` (`Quadro.tsx:103`, RF-18) conta quantos cards da coluna têm o **ponto médio
acima do ponteiro**, ignorando o arrastado. A formulação óbvia — ponto médio do card sob o cursor —
**oscila**: inserir empurra aquele card, a metade dele cruza o ponteiro, a conta se inverte no frame
seguinte, com a mão parada. Esta é idempotente por construção: inserir em k empurra só quem tem
índice ≥ k, e recontar devolve k. Não depende da altura do card arrastado nem de onde ele foi pego,
e funciona no `gap` entre dois cards e no vazio da coluna, onde não existe "card sob o cursor".
Card ainda não medido **não** entra na conta (`:113-115`) — contá-lo deslocaria a fila inteira.

O **ramo do teclado é outro código de propósito** (`:275-287`), o da Fase 2, com um off-by-one que
só parece erro: `moverLocal` remove o card **antes** do `splice` (`:72-76`), então "inserir no índice
do alvo" já significa *depois* dele quando o movimento é para baixo na mesma coluna — que é a
semântica que as setas querem. Unificar os dois ramos quebra um dos lados.

**INV-36 — Os cards não usam estratégia de ordenação; as colunas usam.** (RF-27) Quem "padronizar"
os dois quebra um dos lados.

| | Cards | Colunas |
|---|---|---|
| `strategy` | `SEM_DESLOCAMENTO = () => null` (`ColunaQuadro.tsx:33`, aplicada em `:428`) | `horizontalListSortingStrategy` (`Quadro.tsx:378`) |
| Quem abre o vão | o DOM: `moverLocal` reordena o estado a cada `dragOver` e o React repinta na ordem nova | o transform, único mecanismo que existe ali |
| `items` durante o gesto | mudam a cada `dragOver` | não mudam — `aoPassar` retorna cedo para `tipo !== "card"` (`Quadro.tsx:258`) |

Uma estratégia por cima do DOM desloca **de novo** o que já foi deslocado:
`verticalListSortingStrategy` empurraria o vizinho pela altura do card ativo, em cima da lista que o
DOM já reordenou. E não é sempre — é pior: o `SortableContext` desliga os transforms enquanto os
`items` mudam e os **religa no primeiro frame em que a lista se repete**
(`disableTransforms = … || itemsHaveChanged`, `@dnd-kit/sortable/dist/sortable.esm.js:314`, com
`previousItemsRef` atualizado num efeito **passivo**, `:323`) — exatamente quando a mão para para
mirar. Argumento completo em RF-27 de `docs/old/prd-fase-5-refino.md`.

---

## Tags

**INV-34 — Tag de nota e tag de card têm o mesmo nome e são coisas diferentes.** Não são para ser
unificadas; a tabela completa está na §7.3 de `docs/old/prd-fase-5-refino.md`.

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
- **O filtro de tag do board é OU; o do painel contextual de notas é E.** `cardCasaFiltro`
  (`apps/web/src/lib/tags.ts:66`) usa `some`; as notas usam `AND` no Prisma
  (`apps/api/src/modules/notes/notes.service.ts:438`). Divergência de propósito, com razão escrita
  em `apps/web/src/components/BarraDeTags.tsx:17-23`: na barra lateral se estreita até achar uma
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
de `docs/old/prd-fase-5-refino.md` prometeu a remoção; a promessa não se cumpriu e não vale mais.

**INV-39 — O editor tem dois mapas de atalho, e os dois precisam parar o evento.** Os atalhos
globais moram num listener de `window` (`useAtalhosGlobais`, `apps/web/src/lib/atalhosGlobais.ts:26-78`,
fora de `Aplicacao.tsx` desde a Etapa 2 do redesenho), que recebe o evento **mesmo depois de
`preventDefault`**. Só `stopPropagation` o barra. Na `<textarea>` isso é
imperativo (`Editor.tsx:240`); no modo ao vivo é declarativo, `stopPropagation: true` em cada tecla
do `keymap` sob `Prec.high` para vencer o `defaultKeymap` (`apps/web/src/lib/editorMd.ts:161-178`).
Sem isso `Ctrl+K` insere o link **e** abre a paleta — regressão já corrigida uma vez.

A armadilha vizinha:

- **`Ctrl+Shift+B` e `Ctrl+Shift+L` são da navegação.** O mapa da `<textarea>` casa por
  `e.key.toLowerCase()`, então sem o teste de `e.shiftKey` (`Editor.tsx:225`) `Ctrl+Shift+B`
  navega **e** aplica negrito.

## Painéis: montagem condicional contra prop viva

**INV-53 — Painel montado por `{estado && <X aberto … />}` nunca recebe `aberto: false`.** Ele
**desmonta**. As duas formas convivem em `apps/web/src/components/Aplicacao.tsx` e a diferença não
aparece em nenhuma assinatura: `Paleta` recebe a prop viva (`aberta={paletaAberta}`, `:607`) e
continua montada o tempo todo, enquanto `GavetaLinks` é montada dentro de um `&&` (`:589`) com
`aberta` **literal** (`:592`).

A consequência é toda na limpeza. Num painel do segundo grupo, `useEffect(() => { if (!aberto) … })`
**nunca roda o corpo de fechamento** — `aberto` é sempre `true` enquanto o efeito existe. Só a
função de limpeza roda, no desmonte. Trabalho de fechamento posto no corpo compila e nunca executa.

**A forma errada compila nos dois grupos, e nenhum portão executa qualquer um deles.** Antes de
escrever a limpeza de um painel novo, abra `Aplicacao.tsx` e veja em qual grupo ele foi montado; a
regra não está visível de dentro do componente. Desde a Etapa 5 do redesenho os dois repassam
`aberta` ao `Dialogo`, e o `if (!aberto) return null` mora só nele (`base/Dialogo.tsx:52`) — é o
que engana: existe para o grupo da prop viva e parece indicar que `false` chega. Na gaveta, o
efeito que reseta filtro e renomeação ao abrir (`GavetaLinks.tsx:161-167`) só vale para a prop
viva, e o comentário dele diz isso.

A forma que serve aos dois grupos já existe: `useFocoPreso` põe o fechamento **na limpeza** de um
efeito que depende de `ativo` (`apps/web/src/lib/foco.ts:65-70`), que roda quando a prop vira `false`
e quando o componente desmonta. Por isso `Dialogo` (`components/base/Dialogo.tsx`) aceita as duas
montagens. Painel novo que precise de fechamento imita essa forma.

Há uma terceira: `PainelAssistente` também nasce num `&&` (`Aplicacao.tsx:537-541`), mas **sem
prop `aberto`**, porque o estado dele mora fora, na sessão do chat. O fechamento que faz trabalho é
uma ação chamada antes do desmonte, não efeito do painel — e o que ela garante é o INV-56.

## O chat: o laço não roda sem superfície

**INV-56 — O laço do servidor não roda sem superfície visível.** Uma mensagem do chat são até cinco
chamadas ao provedor, cada uma gravando contra o teto do dia (INV-47). Desde a Etapa 3 do redesenho
de UI o fluxo mora em `ProvedorSessaoChat` (`apps/web/src/lib/sessaoChat.tsx:169`), montado acima da
casca (`apps/web/src/App.tsx:38-40`) — **desmontar a superfície não solta a conexão.** A garantia
deixou de ser uma limpeza de efeito e virou cinco pontos, cada um fechando um caminho:

1. **Fechar o painel para o fluxo:** `fecharPainel` chama `parar()` antes de desmontar
   (`sessaoChat.tsx:282-283`).
2. **O logout aborta:** sair da sessão desmonta o provedor, e a limpeza aborta (`sessaoChat.tsx:209`).
3. **Sair da tela do chat com fluxo em curso reabre o painel** (`Aplicacao.tsx:185-190`, lendo
   `temFluxo()`, `sessaoChat.tsx:224`). Sem isso a resposta seguiria em tela nenhuma.
4. **O `AbortController` nasce antes de criar a conversa** (`sessaoChat.tsx:308-309`, razão em
   `:188-194`), e enquanto ele existe outro envio não começa (`:306`). Nascido depois do
   `criar.mutateAsync` (`:336`), fechar nessa janela chamava um `parar()` sem nada para parar; a
   conferência de `:345` é o que segura o fluxo ali.
5. **Conversa nova pedida com fluxo em curso não troca a conversa** (Etapa D): mostra a resposta —
   no painel, ou no campo da tela do chat — e diz por quê (`avisoDeEspera`, `sessaoChat.tsx:111`).
   Vale para "Conversar" com um agente (`components/agentes/acoesDoAgente.tsx:125-137`), para o
   pedido que chega à tela do chat (`pages/AssistentePage.tsx:40-64`) e para a conversa aberta das
   últimas chamadas do AI usage dash (`components/ajustes/TabelasUsoIa.tsx:201-210`).

**"Tela do chat" é `naTelaDoChat` (`sessaoChat.tsx:95`), não a área `/assistente`.** Desde a Etapa D
a área tem a galeria e o editor de agentes (`/assistente/agentes…`), e desde a E as rotinas
(`/assistente/rotinas…`, `/assistente/execucoes/:runId`); em todas elas o painel existe.
`pathname.startsWith("/assistente")` faria a resposta sumir ao ir do chat para a galeria —
nenhuma superfície à vista, o laço pagando. Quem decide "o painel existe aqui?" chama a função:
a casca (`Aplicacao.tsx:177`), o trilho (`casca/Trilho.tsx:254`) e a conversa (`Conversa.tsx:167`).
Os três perguntavam pela área até a Etapa D. `areaDe` (`casca/PainelContexto.tsx:18`) continua por
prefixo, e está certo: ali a pergunta é qual painel contextual mostrar, não se o chat está à vista.

**A conversa nova pedida de fora troca ao chegar, nunca antes do `navigate`.** Ela viaja no `state`
da navegação (`EstadoRotaChat`, `sessaoChat.tsx:106-108`) e é aplicada por `AssistentePage`. Trocar
antes quebra duas coisas: a guarda de saída do editor de agentes segura o `navigate` e a conversa
já teria mudado com a pessoa ainda no editor; e um envio feito pelo painel enquanto o diálogo da
guarda estava aberto sumiria da tela — este invariante.

**Expandir para a tela do chat não toca no fluxo**: trocar de superfície não é fechar
(`sessaoChat.tsx:274-276`), e a rota não passa por `fecharPainel`. Caminho novo que esconda a
última superfície visível — outra rota, outro atalho, outro "fechar" — chama `fecharPainel` ou
entra nesta lista. Nenhum portão executa o front: a quebra aparece como gasto no teto sem resposta
na tela.

**Defeito aberto, anterior à Etapa D — o ponto 5 ainda não vale em todo sítio.** "Nova conversa" e
escolher outra conversa chamam `novaConversa`/`selecionar` sem olhar `temFluxo()`: a fala em curso
só aparece na conversa dela (`components/assistente/Conversa.tsx:639`), e some com o laço pagando.
Os `selecionar` sem desvio em 2026-09-25: `MarcaIA.tsx:146`, `casca/contexto/ContextoInicio.tsx:83`,
`assistente/PainelAssistente.tsx:121` e `assistente/ListaConversas.tsx:176`. Quem for fechar, grepe
os dois nomes em `apps/web/src` e passe todo chamador pelo desvio de `TabelasUsoIa.tsx:201-210`.

**O avesso: na tela do chat, nada alterna o painel.** Lá o painel não existe, mas `painelAberto`
continua valendo, e `alternarPainel` com ele `true` é `fecharPainel` — `parar()` na resposta que
está na tela. Todo caminho que alterna faz o desvio `emAssistente ? focarCampo() : alternarPainel()`:
o atalho (`Aplicacao.tsx:299`) e o comando da paleta (`:399`); o botão do trilho escapa por não
existir ali (`casca/Trilho.tsx:254`). Caminho novo que alterne o painel entra nesta lista.

A armadilha vizinha: **os dois contextos da sessão não se fundem.** `useAcoesChat`
(`sessaoChat.tsx:483`) dá as ações e `painelAberto` a quem só abre o chat — casca, editor, card —;
`useSessaoChat` (`:490`) dá o estado, que muda a cada delta do streaming, e é só das superfícies
(razão em `:33-37`). Fundir os dois, ou assinar `useSessaoChat` fora de `components/assistente/`,
faz quadro e editor re-renderizarem dezenas de vezes por segundo durante a resposta. Compila,
funciona, só fica lento.

## Enums que a interface precisa percorrer

**INV-54 — Membro de enum que exige escolha do usuário só existe se a tela o percorrer.** O quadro
de modelos deriva uma coluna por tarefa de `TAREFAS_COM_MODELO`
(`apps/web/src/components/ajustes/QuadroDeModelos.tsx:461`, e a grade conta as colunas em `:387`) e
tira os rótulos de um `Record<TarefaComModelo, …>` **total**
(`apps/web/src/components/ajustes/comum.ts:27`, razão em `:17-26`). As duas metades fazem
trabalho diferente: o `Record` faz o **compilador** cobrar a tarefa nova — é o portão que o front
compra no lugar do teste que não existe — e o `.map` faz a coluna nascer sozinha.

**A lista percorrida é a das tarefas que pedem escolha, não a das que gastam** (Etapa E).
`AI_TASKS` (`packages/shared/src/enums.ts:29`) é o que `ai_usage.task` registra e ganhou `rotina`;
`TAREFAS_COM_MODELO` (`:42`, razão em `:32-41`) é o subconjunto com modelo padrão em `/ajustes`, e
`rotina` fica fora porque cada passo usa o modelo do agente, ou o do chat. Percorrer `AI_TASKS`
poria na tela uma coluna que não controla nada. Tarefa nova com modelo próprio entra nas duas.

A Etapa B mostrou o custo de citar em vez de percorrer. `chat` entrou em
`AI_TASKS`, no enum `AiTask` do Prisma, na rota e no service; a tela ficou
com `const TAREFA: AiTask = "formatar"`, que compila para sempre. O servidor **exige** escolha por
tarefa (`modeloParaTarefa`, `apps/api/src/modules/assistente/preferencias.service.ts:295`), então o
chat recusava toda mensagem com `MODELO_NAO_ESCOLHIDO`, pedindo uma escolha que não tinha onde ser
feita: entidade no banco, rota aceitando, funcionalidade inalcançável, typecheck e suíte da API
verdes. Por isso a mensagem de erro **nomeia a tarefa** (`:301-311`) — sem o nome, quem está na tela
vendo um modelo marcado conclui que o erro é falso.

**Não vale para todo enum: vale para o enum cujo membro pede configuração.** `LINK_KINDS` é citado à
mão de propósito em `apps/web/src/components/ZonasDeSoltura.tsx:131-142` — cada zona tem texto e
ícone próprios, e ali o enum só discrimina. Enum que rotula ou discrimina pode ser citado (é também
o caso de `ICONE_TIPO`, que o `Record<NoteKind, …>` de `apps/web/src/components/Icones.tsx:493` já
mantém total); enum cujo membro exige um valor que **só a interface** coleta, não.

O resto da tela também percorre, e cada um é um `.map` que o typecheck não cobra: os itens "Usar
para…" do menu de cada favorito (`QuadroDeModelos.tsx:433-438`), as etiquetas de uso do cartão
(`:401`, `:446-450`), o "Usado por…" de cada coluna (`:470`), que substituiu o rodapé-legenda, e a
recusa do catálogo (`CatalogoModelos.tsx:95`, `:108-110`). Frase escrita à mão com os nomes é o mesmo furo
em texto — acesso a chave conhecida não é erro de tipo.

## Filtros de notas na URL

**INV-55 — Toda navegação dentro de `/n` carrega o `search`.** Desde a Etapa 2 do redesenho de UI
os filtros da lista moram na query string (`useFiltrosDaUrl`, `apps/web/src/lib/filtrosUrl.ts:62`),
e a URL é o único lugar em que eles existem. Um `navigate` para `/n/<id>` sem `search` **apaga o
recorte**: a lista volta a "todas" no mesmo clique que abriu a nota, sem erro nem aviso. Os pontos
que carregam hoje:

- abrir nota: `abrirNota` (`apps/web/src/components/Aplicacao.tsx:256-263`, o `navigate` em `:260`),
  que serve também a paleta, ao chat e ao "Abrir nota" da execução de rotina — desce de
  `Aplicacao.tsx:510` e `:518` para `RotinasPage` e `ExecucaoAvulsaPage` como `onAbrirNota`;
- criar nota: `novaNota` (`Aplicacao.tsx:265`), que também tira o tipo da nota nova do filtro
  (`:273`);
- fechar nota: `onFechar` (`apps/web/src/pages/NotasPage.tsx:55`);
- voltar à lista de outra área: o trilho navega para `ultimaListaNotas` (`Aplicacao.tsx:159-162`,
  `:429`), e o comando "Ir para Notas" da paleta (`:333`), a última `/n?…` visitada.

**O `search` só viaja quando se está em `/n`** (`emNotas ? search : ""`): fora dali a query string
é de outra rota, e um filtro esquecido não pode decidir o tipo de uma nota criada no board. Não
"simplifique" para sempre carregar. O workspace fica **fora** da URL de propósito
(`filtrosUrl.ts:55-56`). Caminho novo que abra, feche ou crie nota a partir da lista entra nesta
lista — **nenhum portão executa navegação**, e o sintoma só aparece com um filtro ligado.

## Quadro de modelos

**INV-57 — Nenhum controle dentro do elemento que recebe os `listeners` do arraste.** Controle ali
dentro faz o `Espaço` nele virar "pegar": o menu deixa de abrir pelo teclado, e o mouse continua
funcionando. Nenhum portão executa arraste. Há duas formas certas, e arrastável novo escolhe uma:

- **Alça única.** No quadro de modelos, `setActivatorNodeRef`, `attributes` e `listeners` vão só no
  botão da alça (`QuadroDeModelos.tsx:146-148`); o nó que se move (`setNodeRef`, `:158`) envolve o
  cartão inteiro, com o menu "Usar para…" e o botão de tirar — por isso `CartaoModelo` recebe `alca`
  e `acoes` como encaixes (razão em `apps/web/src/components/ajustes/CartaoModelo.tsx:20-22`). A
  coluna do kanban (`ColunaQuadro.tsx:233-239`) e o passo do fluxo de rotina
  (`components/rotinas/FluxoEditavel.tsx:262-264`, razão em `:43-46`) fazem o mesmo.
- **Controle irmão do ativador**, dentro do nó mas fora do elemento com os `listeners`: os botões
  dos favoritos (`GavetaLinks.tsx:76-98`) e, desde a Parte 1 da frente de cards (2026-09-30), o
  check de concluir do card do kanban (`ColunaQuadro.tsx:101-118`, razão em `:96-100`), cujos
  `listeners` estão no `div` de `role="button"` (`:70-72`). Mover o check para dentro de
  `CartaoCard` — onde ele parece morar, e onde o `pr-5` lhe abre lugar — o põe sob os `listeners`
  e dentro de um `role="button"`. Ele some por opacidade, não por `hidden`, para o Tab o alcançar.

## O gasto na tela

**INV-62 — Toda ação que chama o provedor invalida o gasto, inclusive quando falha.** A chamada que
falhou também grava linha em `ai_usage` (INV-51), e as duas leituras dela no front têm `staleTime`
de 30 s: `CHAVE_AJUSTES`, o gasto do dia, e `CHAVE_USO`, o AI usage dash
(`apps/web/src/lib/chat.ts:34-37`). Os pontos, cada um no **fim** da ação e não no sucesso:

- o formatar, no `onSettled` (`apps/web/src/lib/ia.ts:222-225`, razão em `:214-221`);
- o chat, no `finally` (`apps/web/src/lib/sessaoChat.tsx:417-428`);
- a execução de rotina, por `invalidarDepoisDaExecucao` (`apps/web/src/lib/rotinas.ts:202-209`).

`useAtualizarAjustes` invalida `CHAVE_USO` por outro motivo — o fuso muda o `to` do relatório
(`lib/ia.ts:136-142`). Trocar `onSettled` por `onSuccess` deixa a falha paga fora da tela, e ação
nova que chame o provedor entra nesta lista: **nada cobra um quarto ponto**, e o sintoma é um número
velho por 30 s, logo depois da ação que o mudou.

## `Esc` em camadas: diálogo dentro de painel

**INV-65 — `Dialogo` aberto dentro de um contêiner que fecha no `Esc` vai num wrapper `contents`
por fora, com `preventDefault`; o contêiner ignora o `Esc` com `defaultPrevented`.** O `Esc` do
`Dialogo` é ouvido no `document` (`apps/web/src/components/base/Dialogo.tsx:43-50`), mas o
`keydown` nascido no portal também sobe pela árvore do React até o `onKeyDown` do contêiner, que
fecharia junto. `stopPropagation` no caminho calaria o ouvinte do próprio diálogo. O wrapper fica
**fora** do `Dialogo` porque a caixa tem `tabIndex={-1}` (`:70`) e ganha o foco num clique em área
vazia — um wrapper dentro dela não vê a tecla. Dois pares hoje:
`assistente/Conversa.tsx:505-515` com `assistente/PainelAssistente.tsx:61`, e
`AnexosDoCard.tsx:263-275` com `PainelCard.tsx:157-159`. Diálogo novo num desses contêineres, ou
contêiner novo que feche no `Esc` e hospede diálogo, repete as duas metades — **faltar qualquer uma
compila**, e o sintoma é o `Esc` fechar o diálogo e o painel de uma vez. O `Esc` só chega ao
contêiner com o foco dentro dele: ação que desmonta o controle focado devolve o foco ali
(`AnexosDoCard.tsx:118-123`), ou o `Esc` seguinte não fecha nada.
