---
name: design-system-yu-book
description: Design system manual do Yu-book — rampa de cor semântica ink/accent, os dois temas em CSS puro sem usar a variante dark do Tailwind, os tokens do redesenho de UI (fonte, text-miudo, rotulo, raios, sombras por tema, animação com prefers-reduced-motion, inclusive a feita em JS, escala de z), os primitivos de components/base/ (Botao, Bloco, Aviso, Dialogo com foco preso e o que ele deixa de fora, Menu, Etiqueta, Toast), a casca de trilho e painel contextual recolhível, /ajustes em seções, os três arrastes (kanban, favoritos e quadro de modelos) e o foco que sobrevive ao desmonte, o painel do assistente que empurra o conteúdo e não é modal (e o Esc do Dialogo aberto dentro dele), a marca de conteúdo gerado por IA (MarcaIA e FaixaIA), ícones SVG desenhados à mão em Icones.tsx e as siglas unicode que ficam, a paleta com comandos, ausência deliberada de biblioteca de UI, limite desktop-only e as regras de acessibilidade tratadas como requisito. Use antes de criar ou alterar qualquer componente, cor, sombra, animação, ícone, atalho de teclado ou estado visual em apps/web.
---

# Design system do Yu-book

Tudo aqui é feito à mão. **Não existe shadcn, Radix, Headless UI, Material nem biblioteca de
ícones**, e isso é decisão registrada em comentário no código. Não instale nenhuma.

**A única exceção é o CodeMirror 6**, e ela é estreita: motor de edição de texto não é biblioteca
de UI nem de ícones, e o operador autorizou nominalmente essa dependência e nenhuma outra — a
decisão e seus limites estão na §12/D-01 de `docs/old/prd-fase-5-refino.md`. Ela não abre precedente:
componente que já existe aqui continua sendo escrito à mão.

## 1. A rampa de cor é semântica

Definida em `apps/web/src/index.css`. `ink-950` é sempre "o fundo mais profundo" e `ink-200` sempre
"o texto de maior contraste" — **os nomes descrevem papel, não cor**. O tema claro inverte os
valores e preserva o significado.

| Token | Papel |
|---|---|
| `--color-ink-950 … 700` | Superfícies, do mais profundo ao mais elevado |
| `--color-ink-400` | Texto secundário |
| `--color-ink-200` | Texto de maior contraste |
| `--color-titulo` | Cor de título |
| `--color-accent-500` / `400` | Destaque e interação |
| `--color-superficie` | Cartão que se ergue sobre o painel — o degrau que a rampa `ink` não tinha |
| `--color-ia-500` | Só fecha o gradiente `accent-500 → ia-500` das áreas de IA; não é cor de texto |

Os contrastes calculados de `superficie` e `ia-500` estão no comentário ao lado
(`apps/web/src/index.css:22-26`). Não copie os números para cá.

## 2. O tema não existe em React

**Nunca use a variante `dark:` do Tailwind.** Não há uma única ocorrência dela em `apps/web/src`, e
nenhum componente tem condicional de tema. O mecanismo é:

1. Um IIFE bloqueante em `apps/web/index.html` roda **antes da primeira pintura**, lê
   `localStorage["yb:tema"]` (caindo para `prefers-color-scheme`) e define
   `document.documentElement.dataset.tema`.
2. `index.css` redefine **as mesmas variáveis** sob `:root[data-tema="claro"]`.
3. `apps/web/src/lib/tema.ts` apenas **lê** o que o script já aplicou, e só grava na primeira
   troca manual. `useTema` é **um armazenamento só** para a aplicação (`useSyncExternalStore`,
   `tema.ts:33`): trilho e paleta trocam o tema e um vê a troca do outro. Não crie `useState` de
   tema num componente — o porquê está em `tema.ts:7-9`.

Consequências obrigatórias:

- **Cor nova exige duas entradas**: uma no bloco `@theme` e outra em `:root[data-tema="claro"]`.
  Definir só uma quebra um dos temas.
- **Sombra não segue essa regra do jeito ingênuo.** O Tailwind v4 **copia** o valor de `--shadow-*`
  para dentro da utilidade no build; redefinir `--shadow-e2` no bloco claro não muda nada. Sombra
  que troca com o tema mora em `--sombra-*` em `:root` **e** no bloco claro, e o `@theme` só aponta
  para ela (`--shadow-e1: var(--sombra-e1)`, `apps/web/src/index.css:49`). Sombra feita só de
  `color-mix` sobre token de cor (`--sombra-brilho-ia`, `:111-113`) já troca sozinha e fica só em `:root`.
- Cores de estado (`red`, `amber`, `emerald`, `sky`, `rose`, `violet`) têm valores próprios no tema
  claro — um vermelho calibrado para fundo escuro reprova em contraste sobre fundo claro.
- **Não mova a decisão de tema para o React.** O comentário em `index.html` registra que isso
  reintroduz o flash de tema errado.

O contraste dos dois temas é verificado por cálculo, em WCAG AA. Cor nova entra com essa
verificação feita, não por impressão, e o resultado fica em comentário ao lado do token.

## 3. Ícones

`apps/web/src/components/Icones.tsx` é a fonte. Grade 16×16, traço único compartilhado pela
constante `TRACO`, `currentColor` para seguir tema e estado, `aria-hidden` porque todo item tem
texto ao lado. Ícone novo é desenhado ali, no mesmo estilo. Não instale pacote de ícones.

`TRACO` e `IconeProps` são exportados (`Icones.tsx:13,21`). Desenho que só um componente usa pode
morar nele — `SeletorTema.tsx` e `ModoNota.tsx` fazem isso —, mas **importa o `TRACO`; não o
redeclara**. As cópias locais divergiriam do traço sem ninguém notar.

`ICONE_TIPO` mapeia `NoteKind` para ícone e precisa continuar total — um `kind` novo no enum exige
entrada nova ali.

Grepe `export function Icone` antes de desenhar: a Etapa 5 trouxe relógio, check, clipe, recarregar
e o chevron. Ícone que só muda de orientação ganha prop, não cópia — `IconeChevron({ direcao })`
(`Icones.tsx:300-310`).

**Glifo unicode que é sigla fica glifo.** As siglas de prazo e de prioridade (`!`, `◷`, `▤`, `⬆`,
`⬇`) em `CartaoCard.tsx:19-30` e `pages/DashboardPage.tsx:19-23` são texto de propósito,
`aria-hidden`, com o estado por extenso ao lado (`CartaoCard.tsx:82-84`, `:90-91`). São o sinal que
não depende de cor (§4): não as troque por SVG nem as apague como resíduo.

## 4. Acessibilidade é requisito, não polimento

- **Estado nunca é comunicado só por cor.** Todo status carrega letra ou glifo: o tipo de nota tem
  letra (`A/P/T/W/L`), o prazo tem símbolo, o link quebrado tem sublinhado tracejado **e** o sufixo
  `(criar)`.
- Foco visível é global e incondicional. Não remova `outline` de nada. O `:focus-visible` global
  **não leva `border-radius`** (`index.css:221`): fora de camada ele vencia o `rounded-*` e o botão
  mudava de forma ao receber foco. Não o devolva.
- Ícone sem texto leva rótulo `sr-only`.
- Erro usa `role="alert"`; status de salvamento usa `aria-live="polite"`.
- Lista de opções usa `role="listbox"`/`role="option"`; item de navegação ativo usa `aria-current`.
- Toda operação de arraste tem equivalente por teclado **e** é anunciada por `Announcements` (§11).
- **Ação que desmonta o elemento focado entrega o foco a um vizinho estável** (RNF-06 da Fase 1),
  ou ele cai no `<body>`. Recolher o painel contextual → `ID_MOSTRAR_CONTEXTO` (§5); tirar, remover
  ou mover um modelo → a coluna onde a mudança aconteceu (`focarColuna`,
  `components/ajustes/QuadroDeModelos.tsx:65-71`, que depende do `tabIndex={-1}` da coluna, `:183`).
- Erro fica na tela, não vira toast que some. O usuário precisa poder ler e tentar de novo — é o
  `Aviso` de `components/base/` (§10).

## 5. Layout

- **Desktop-only por decisão.** `GuardaDesktop` (`apps/web/src/components/Colunas.tsx`) bloqueia
  abaixo de 1024px com um aviso. **Não escreva trabalho responsivo nem breakpoints de celular.**
- `PainelRedimensionavel` é a primitiva de layout: largura persistida em `localStorage`, divisor
  operável por teclado (`role="separator"`, setas), limites 180–520px por padrão e `min`/`max`
  por instância — o painel do assistente usa 320–640.
- Seção recolhível usa `Secao`/`useSecao`, e vale uma invariante: **uma seção fechada precisa
  continuar mostrando o que está escondido.** O `resumo` aparece quando fechada — o filtro de tipo
  ativo, a contagem de tags selecionadas. Esconder o controle nunca pode esconder que o filtro
  continua valendo.

### A casca: trilho e painel contextual

Desde a Etapa 2 do redesenho (2026-09-24) a casca de `components/Aplicacao.tsx` tem duas colunas
de navegação, no lugar da antiga barra lateral única:

- **Trilho** (`components/casca/Trilho.tsx`), 56px (`w-14`): só "para onde ir" — busca, menu `+`,
  áreas, e no pé atalhos, tema e conta. Item de área navega e usa `aria-current="page"`; item que
  abre painel (assistente) usa `aria-pressed`. Ativo tem barra de forma, não só fundo (RNF-09).
- **Painel contextual** (`components/casca/PainelContexto.tsx`): "o que ver" na área atual, uma
  peça por área em `casca/contexto/Contexto*.tsx`, escolhida por `areaDe(pathname)` (`:15-21`).
  Topo comum: workspace e busca. Mora na coluna `yb:col-nav`, a mesma da barra antiga, para a largura
  já ajustada sobreviver. `Item`, `Titulo`, `Secao` e `CartaoTags` estão em `casca/partes.tsx`.
- **O painel recolhe** (`Ctrl+\`, chave `yb:contexto-recolhido`) e é desmontado, não escondido
  (`Aplicacao.tsx:390-396`). O foco que ele levava junto vai para o botão que o traz de volta,
  `ID_MOSTRAR_CONTEXTO` (`Aplicacao.tsx:116-129`).
- **Recolhido, o trilho herda a regra da seção fechada:** o ponto de filtro ativo em Notas
  (`Trilho.tsx:193-201`, com o texto no `aria-label`, `:189`) e o selo do workspace ativo
  (`:274-289`).
  O ponto é calculado da última lista `/n?…` visitada (`Aplicacao.tsx:378`), não da rota atual —
  vale também fora de Notas. Controle novo no painel que filtre algo ganha sinal no trilho.
- **`/ajustes` é uma casca de rotas internas** (Etapa 4): `pages/AjustesPage.tsx` só tem o
  cabeçalho comum e as rotas `modelos`, `provedor` e `gasto`; as seções moram em
  `components/ajustes/`. A navegação entre elas é o painel contextual, que lê `SECOES_DE_AJUSTES`
  de `ajustes/comum.ts` — e não da página, que é `lazy()` (razão em `comum.ts:4-8`).
- **Painel do assistente** (`components/assistente/PainelAssistente.tsx`, Etapa 3): à direita, na
  mesma linha flex, **empurra** o conteúdo em vez de cobri-lo e segue aberto enquanto se navega.
  **Não é modal** (RNF-05 da Fase 1): sem véu, sem foco preso, e por isso não é `Dialogo`. O `Esc`
  global (`fecharTudo`) não o fecha; o `Esc` só vale com o foco dentro (`onKeyDown` do `<aside>`,
  `:57-61`), e quem tem `Esc` próprio lá dentro — menu do `@` no `Compositor`, `Menu`, renomear
  conversa — para a propagação. **`Dialogo` lá dentro é o avesso**: o `Esc` dele mora no
  `document`, e `stopPropagation` o calaria; ele vai num wrapper `contents` com `preventDefault`,
  e o `<aside>` ignora o `Esc` já tratado (`Conversa.tsx:510-518`; `PainelAssistente.tsx:58`). Fechar devolve o foco à origem ou, sem ela, ao botão do trilho
  `ID_BOTAO_PAINEL` (`lib/sessaoChat.tsx:216-225`). `Ctrl+Shift+Y` e o comando da paleta alternam;
  em `/assistente`, onde o painel não existe, focam o campo — alternar ali fecharia a sessão na tela
  (INV-56). Fechar no meio de uma resposta para o fluxo. **`/assistente` não tem id de conversa**:
  levar a uma conversa é `selecionar(id)` e `abrirPainel()`, como a faixa da marca de IA
  (`MarcaIA.tsx:112-115`).
- **Levar texto ao assistente preenche e abre; nunca envia, e abre conversa nova.** Uma mensagem são
  até cinco chamadas pagas, e quem digitou ainda não viu modelo nem teto. Assim fazem o "Pergunte ao
  seu acervo" (`pages/DashboardPage.tsx:114-131`) e o "Perguntar ao assistente" da paleta
  (`Aplicacao.tsx:537-551`). Atalho novo para o chat segue os dois.

## 6. Chaves de `localStorage`

Prefixo `yb:`. Hoje: `yb:tema`, `yb:workspace`, `yb:modo-nota`, `yb:secao:<chave>`, `yb:col-nav`,
`yb:col-lista`, `yb:col-card`, `yb:contexto-recolhido`, `yb:col-chat`, `yb:chat-aberto`.

**Filtro de lista não é preferência de dispositivo:** os de notas moram na URL
(`lib/filtrosUrl.ts`), para o Voltar desfazer e o filtro virar link — e toda navegação em `/n`
precisa carregá-los (INV-55).

O princípio: **preferência com formato de dispositivo mora em `localStorage`; dado com formato de
conta mora no banco.** Chave nova segue o prefixo.

## 7. Atalhos de teclado

`apps/web/src/components/Atalhos.tsx` é a **fonte única dos atalhos documentados**. Atalho novo sem
entrada lá quebra o contrato com o usuário.

Atalho global entra em **dois lugares**: o ouvinte único de `window`, `useAtalhosGlobais`
(`apps/web/src/lib/atalhosGlobais.ts`, ações num ref para registrar uma vez só), e a lista de
`Atalhos.tsx`. Ao adicionar um atalho: verifique conflito com esse ouvinte, e chame
`stopPropagation()` quando o atalho for local a um campo — `preventDefault()` sozinho não impede o
listener de `window` de receber o evento (INV-39 mostra onde isso já custou caro).

**A paleta também executa comandos** (Etapa 5): a lista mora em `Aplicacao.tsx:296-371`, e `>` no
início troca a busca por só comandos (`Paleta.tsx:31-32`, `:72-75`). O `atalho` de um comando é só
exibido (`Paleta.tsx:14-17`) — o atalho continua entrando nos dois lugares acima. Ação nova do
trilho ou de atalho ganha comando. O `Enter` espera a busca responder (`Paleta.tsx:137-142`).

**No editor de notas o atalho entra em dois lugares ou em nenhum**: a `<textarea>` casa a tecla à
mão em `Editor.tsx`, e o modo ao vivo declara no `keymap` de `editorMd.ts`. Cobrir só um faz o
atalho existir num modo e não no outro, sem nada acusar.

## 8. Markdown renderizado

A classe `.preview` em `index.css` é uma escala tipográfica escrita à mão — não há
`@tailwindcss/typography`. Largura de linha limitada a `72ch`. As cores do realce de sintaxe são
variáveis `--hljs-*`, definidas nos dois temas.

## 9. Tokens do redesenho de UI

O redesenho em cinco etapas (todas entregues em 2026-09-24) pôs no `@theme` de `index.css` um
vocabulário com **nome de papel, não de tamanho**. Tela nova ou redesenhada usa estes; os valores
avulsos antigos migram quando o arquivo é tocado.

| Token | Uso |
|---|---|
| `font-sans` / `font-mono` | Inter, com a pilha de sistema como recuo; `mono` para tecla e código |
| `text-miudo` | 11/16 — o degrau abaixo de `text-xs` |
| `rotulo` (`@utility`, `index.css:195`) | Título de seção: miúdo, caixa alta, `ink-400` |
| `rounded-etiqueta` / `controle` / `cartao` / `dialogo` | Raio por papel |
| `shadow-e1` … `e4`, `shadow-brilho-ia` | Elevação crescente; o brilho só em área de IA |
| `ease-saida` / `ease-padrao` | Curvas de entrada e de transição comum |
| `animate-surgir` / `animate-surgir-veu` | Entrada de caixa flutuante e do véu atrás dela |
| `animate-deslizar-esquerda` | Entrada de painel que surge da direita (o do assistente) |
| `animate-deslizar-direita` | Entrada do `Dialogo` lateral, que surge da esquerda (a gaveta) |
| `animate-subir` | Entrada de `Toast` na pilha do pé da tela |
| `--veu` | Fundo atrás de diálogo — variável em `:root`, fora do `@theme`, porque não é cor de texto |
| `--z-popover` < `veu` < `dialogo` < `soltura` < `toast` | A escala de camadas (`index.css:117-121`); `z-(--z-dialogo)`, não `z-50` avulso |

- **`text-[10px]` e `text-[11px]` estão proibidos.** São `text-miudo`. 10px fica ilegível em Inter.
- **Toda animação nova passa pelo bloco `prefers-reduced-motion`** (`index.css:206`), que zera
  duração de animação e transição. Ele usa `0.01ms`, não `none`, para o `animationend` continuar
  disparando — não "simplifique". **Animação feita em JS o CSS não alcança**: ela lê
  `useMovimentoReduzido` (`lib/movimento.ts`) — hoje a soltura do `DragOverlay` do quadro de
  modelos, `dropAnimation={reduzido ? null : …}` (`QuadroDeModelos.tsx:522`).
- A Inter vem do Google Fonts por `<link>` em `index.html`, **depois** do script de tema: a fonte
  pode chegar atrasada (`display=swap`), o tema não. Não mova o `<link>` para antes do script.

## 10. Primitivos em `components/base/`

**A decisão de manter `Button` e `Modal` inexistentes foi revogada** na Etapa 1 do redesenho: as
cópias à mão tinham divergido (o porquê está em `components/base/Botao.tsx:4-9`). Hoje existem:

| Arquivo | Exporta |
|---|---|
| `Botao.tsx` | `Botao` (variantes `primario`, `secundario`, `fantasma`, `perigo`, `ia`; `carregando`) e `BotaoIcone`, cujo `rotulo` vira nome acessível e dica, com `tamanho` `p`/`m`/`g` |
| `Bloco.tsx` | `Bloco` (variante `ia` com fio de gradiente), `Vazio`, `Esqueleto` de altura fixa |
| `Aviso.tsx` | Aviso inline, tom `erro`/`alerta`/`info`, glifo sempre; `urgente` promove `status` a `alert` |
| `IndicadorSalvamento.tsx` | Estado do autosave com texto, único para nota e card |
| `Dialogo.tsx` | Modal com véu, portal, `Esc`, foco preso; `posicao` `centro`, `topo` (paleta) ou `lateral` (gaveta, encostada no trilho, altura toda) |
| `Toast.tsx` | `PilhaFlutuante`, o pé da tela que empilha o que flutua, e `Toast` (`role="status"`, uma ação no máximo); erro ali dentro continua `Aviso` |
| `Tecla.tsx` | Combinação de teclas partida em `<kbd>` |
| `Menu.tsx` | Menu de ações com gatilho por render prop; ↑/↓/Home/End, `Esc` para ali e devolve o foco; `lado` inclui `baixo-fim`, alinhado à direita do gatilho |
| `Etiqueta.tsx` | Pílula de informação, tom `neutro`/`destaque`/`ia`; vira `<button>` só com `como="button"` |

- **Primitivo só nasce na etapa que tem consumidor.** `Menu` nasceu na Etapa 2 com o trilho,
  `Etiqueta` na 3 com o chat, `Toast` na 5 com o desfazer do link; Campo e Dica estão previstos e
  não existem — não os crie antecipados nem "por completude".
- Botão novo é `Botao`, não `<button>` com classes copiadas.
- **O que a base já define não se varia por `className`.** O Tailwind v4 ordena utilitários da
  mesma propriedade pelo nome no CSS gerado, não pela ordem no atributo: um `size-6` ou uma cor
  passados a `Botao`/`BotaoIcone` perdem para os da base, calados (`Botao.tsx:76-80`). Tamanho é
  prop; cor vai no ícone. Precisa de outra variação? Vira prop do primitivo.
- **`Dialogo` devolve o foco na limpeza do efeito** (`useFocoPreso`, `apps/web/src/lib/foco.ts`), e
  por isso funciona nas duas formas de montagem — prop viva e montagem condicional, em que `aberto`
  nunca chega a `false` (INV-53).
- **`Dialogo` não serve para painel que convive com o editor** (RNF-05 da Fase 1): nota, card e
  chat não são diálogos. Ele é para o que está fora do caminho de escrita — atalhos, busca, gaveta.
- **O que flutua fora de um `Dialogo` aberto fica inalcançável** por teclado e por leitor de tela:
  foco preso e `aria-modal`. Ação que precisa existir com ele aberto mora dentro dele — o desfazer
  do link aparece na gaveta (`GavetaLinks.tsx:453-463`) e a casca esconde o `Toast` enquanto ela
  está aberta (`Aplicacao.tsx:479-481`).
- **Handler do conteúdo de um `Dialogo` não pega o foco que está na caixa.** Ela tem
  `tabIndex={-1}` (`Dialogo.tsx:70`) e o recebe num clique em área vazia; dali o evento não passa
  por filho nenhum. Tecla de lista vai num wrapper e só vale com o foco num filho (`Paleta.tsx:191`);
  o que precisa valer sempre vai no `document` — o colar da gaveta (`GavetaLinks.tsx:201-219`).

## 11. Arraste

O projeto tem três: o kanban (`components/Quadro.tsx`), os favoritos da gaveta de links
(`components/GavetaLinks.tsx:152-159`, o mais simples) e, desde a Etapa 4 do redesenho, o quadro de
modelos em `/ajustes/modelos` (`components/ajustes/QuadroDeModelos.tsx`), que **copia o padrão do
kanban sem compartilhar código com ele** (`:42-55`). Arraste novo copia o mesmo contrato:

- `Espaço` pega e solta, `Esc` cancela, 4 px de folga no ponteiro, colisão `pointerWithin` com
  recuo para `rectIntersection` — sem ponteiro, só o segundo acha o alvo (`:78-86`). Setas pulam de
  destino em destino, não de 25 px em 25 px (`:88-124`).
- A origem some com `opacity-0` (INV-30); cópia que continua à vista esmaece (`opacity-50`, `:410-411`).
  Com controle interativo dentro do arrastável, **a alça é o único ativador** (INV-57).
- `onKeyDown` próprio no ativador **compõe** com o do sensor, e seta com outro uso num ancestral é
  ignorada durante o gesto (INV-30). O card do kanban ainda viola a primeira.
- Alvo que recusa mostra a recusa com forma, ícone e texto — borda tracejada, não só vermelha
  (`:185-208`) — e a regra aparece **antes** do arraste, numa `Etiqueta` na coluna (`:468-472`).
- `data-arrastando` no `<html>` mantém o cursor de "segurando" o gesto inteiro (`:237-242`).
- No quadro de modelos a mesma escolha existe também sem arrastar, no menu "Usar para…" de cada
  favorito (`:428-435`); a recusa é a mesma nos dois (`podeServir`, `ajustes/comum.ts:36`).

## 12. A marca de conteúdo gerado por IA

Nota e card com `ai` não nulo (Etapa C da frente de IA) se mostram por `components/MarcaIA.tsx`, e
só por ele: `MarcaIA` é a pílula das listas (`Etiqueta tom="ia"`, `curta` onde não cabe
"· revisada") e `FaixaIA` a linha sob o cabeçalho de nota e card, com "Abrir conversa". A tela só
**mostra**: a marca vem do servidor (INV-58). Sem cor como único sinal — faísca **e** palavra, e
"revisada" é texto (RNF-09 da IA). Superfície nova que liste nota ou card usa uma das duas.
