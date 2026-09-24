---
name: design-system-yu-book
description: Design system manual do Yu-book — rampa de cor semântica ink/accent, os dois temas em CSS puro sem usar a variante dark do Tailwind, os tokens do redesenho de UI (fonte, text-miudo, rotulo, raios, sombras por tema, animação com prefers-reduced-motion, inclusive a feita em JS, escala de z), os primitivos de components/base/ (Botao, Bloco, Aviso, Dialogo com foco preso e o que ele deixa de fora, Menu, Etiqueta, Toast, Interruptor, Parte) e os reusáveis fora dela (CampoMarkdown, SeletorDeNota, SeletorColuna, AvatarAgente e as cores de agente), a guarda de saída de formulário com salvar explícito, a casca de trilho e painel contextual recolhível, /ajustes em seções, os quatro arrastes (kanban, favoritos, quadro de modelos e fluxo de rotina) e o foco que sobrevive ao desmonte, o painel do assistente que empurra o conteúdo, não é modal e só some na tela do chat, não nas de agentes e rotinas (e o Esc do Dialogo aberto dentro dele), a marca de conteúdo gerado por IA (MarcaIA e FaixaIA, com o "Ver execução" da rotina), ícones SVG desenhados à mão em Icones.tsx e as siglas unicode que ficam, a paleta com comandos, ausência deliberada de biblioteca de UI, limite desktop-only e as regras de acessibilidade tratadas como requisito. Use antes de criar ou alterar qualquer componente, cor, sombra, animação, ícone, atalho de teclado ou estado visual em apps/web.
---

# Design system do Yu-book

Tudo aqui é feito à mão. **Não existe shadcn, Radix, Headless UI, Material nem biblioteca de
ícones**, e isso é decisão registrada em comentário no código. Não instale nenhuma.

**A única exceção é o CodeMirror 6**, autorizado nominalmente e sem abrir precedente — motor de
edição não é biblioteca de UI (§12/D-01 de `docs/old/prd-fase-5-refino.md`).

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
| `--color-agente-*` | Seis fundos de avatar de agente (`AGENT_COLORS`), com texto branco por cima |

Os contrastes de `superficie`, `ia-500` e `agente-*` estão no comentário de `index.css:22-26`, não aqui.

## 2. O tema não existe em React

**Nunca use a variante `dark:` do Tailwind.** Não há uma única ocorrência dela em `apps/web/src`, e
nenhum componente tem condicional de tema. O mecanismo é:

1. Um IIFE bloqueante em `apps/web/index.html` roda **antes da primeira pintura**, lê
   `localStorage["yb:tema"]` (caindo para `prefers-color-scheme`) e define
   `document.documentElement.dataset.tema`.
2. `index.css` redefine **as mesmas variáveis** sob `:root[data-tema="claro"]`.
3. `apps/web/src/lib/tema.ts` só **lê** o que o script aplicou e grava na primeira troca manual.
   `useTema` é **um armazenamento só** (`useSyncExternalStore`, `tema.ts:33`): trilho e paleta veem
   a troca um do outro. Não crie `useState` de tema num componente (porquê em `tema.ts:7-9`).

Consequências obrigatórias:

- **Cor nova exige duas entradas**: uma no bloco `@theme` e outra em `:root[data-tema="claro"]`.
  Definir só uma quebra um dos temas.
- **Sombra não segue essa regra do jeito ingênuo.** O Tailwind v4 **copia** o valor de `--shadow-*`
  para dentro da utilidade no build; redefinir `--shadow-e2` no bloco claro não muda nada. Sombra
  que troca com o tema mora em `--sombra-*` em `:root` **e** no bloco claro, e o `@theme` só aponta
  para ela (`--shadow-e1: var(--sombra-e1)`, `apps/web/src/index.css:61`). Sombra feita só de
  `color-mix` sobre token de cor (`--sombra-brilho-ia`, `:123-125`) já troca sozinha e fica só em `:root`.
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

Grepe `export function Icone` antes de desenhar. Ícone que só muda de orientação ganha prop, não
cópia — `IconeChevron({ direcao })` (`Icones.tsx:324-334`).

**Glifo unicode que é sigla fica glifo.** As siglas de prazo e prioridade (`!`, `◷`, `▤`, `⬆`, `⬇`)
de `CartaoCard.tsx:19-30` e `pages/DashboardPage.tsx:19-23` são texto `aria-hidden` com o estado por
extenso ao lado (`CartaoCard.tsx:82-84`, `:90-91`): o sinal sem cor (§4). Não as troque por SVG.

## 4. Acessibilidade é requisito, não polimento

- **Estado nunca é comunicado só por cor.** Todo status carrega letra ou glifo: tipo de nota tem
  letra (`A/P/T/W/L`), prazo tem símbolo, link quebrado tem sublinhado tracejado **e** `(criar)`.
- Foco visível é global e incondicional; não remova `outline`. O `:focus-visible` global **não leva
  `border-radius`** (`index.css:241`): fora de camada vencia o `rounded-*` e o botão mudava de
  forma.
- Ícone sem texto leva rótulo `sr-only`.
- Erro usa `role="alert"`; status de salvamento usa `aria-live="polite"`.
- Lista de opções usa `role="listbox"`/`role="option"`; item de navegação ativo usa `aria-current`.
- Toda operação de arraste tem equivalente por teclado **e** é anunciada por `Announcements` (§11).
- **Ação que desmonta o elemento focado entrega o foco a um vizinho estável** (RNF-06 da Fase 1),
  ou ele cai no `<body>`. Recolher o painel contextual → `ID_MOSTRAR_CONTEXTO` (§5); tirar, remover
  ou mover um modelo → a coluna onde a mudança aconteceu (`focarColuna`,
  `components/ajustes/QuadroDeModelos.tsx:65-71`, que depende do `tabIndex={-1}` da coluna, `:183`).
- **Status derivado sai da função que o deriva:** passo de rotina cancelado é gravado `falhou` +
  `CANCELADA`; só `rotuloDoPasso`/`SeloPasso` (`rotinas/comum.tsx:142-157`) dizem "cancelado".
- Erro fica na tela, não vira toast que some. O usuário precisa poder ler e tentar de novo — é o
  `Aviso` de `components/base/` (§10).

## 5. Layout

- **Desktop-only por decisão.** `GuardaDesktop` (`apps/web/src/components/Colunas.tsx`) bloqueia
  abaixo de 1024px com um aviso. **Não escreva trabalho responsivo nem breakpoints de celular.**
- `PainelRedimensionavel` é a primitiva de layout: largura persistida em `localStorage`, divisor
  operável por teclado (`role="separator"`, setas), limites 180–520px por padrão e `min`/`max`
  por instância — o painel do assistente usa 320–640.
- Seção recolhível usa `Secao`/`useSecao`, e **uma seção fechada continua mostrando o que esconde**:
  o `resumo` — filtro de tipo ativo, contagem de tags — aparece fechada. Esconder o controle nunca
  esconde que o filtro continua valendo.

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
  (`Aplicacao.tsx:438-444`). O foco que ele levava junto vai para o botão que o traz de volta,
  `ID_MOSTRAR_CONTEXTO` (`Aplicacao.tsx:138-151`).
- **Recolhido, o trilho herda a regra da seção fechada:** o ponto de filtro ativo em Notas
  (`Trilho.tsx:194-202`, com o texto no `aria-label`, `:190`) e o selo do workspace ativo
  (`:276-291`).
  O ponto é calculado da última lista `/n?…` visitada (`Aplicacao.tsx:426`), não da rota atual —
  vale também fora de Notas. Controle novo no painel que filtre algo ganha sinal no trilho.
- **`/ajustes` é uma casca de rotas internas** (Etapa 4): `pages/AjustesPage.tsx` só tem o
  cabeçalho comum e as rotas `modelos`, `provedor` e `gasto`; as seções moram em
  `components/ajustes/`. A navegação entre elas é o painel contextual, que lê `SECOES_DE_AJUSTES`
  de `ajustes/comum.ts` — e não da página, que é `lazy()` (razão em `comum.ts:4-8`).
- **Painel do assistente** (`components/assistente/PainelAssistente.tsx`, Etapa 3): à direita, na
  mesma linha flex, **empurra** o conteúdo em vez de cobri-lo e segue aberto enquanto se navega.
  **Não é modal** (RNF-05 da Fase 1): sem véu, sem foco preso, e por isso não é `Dialogo`. O `Esc`
  global (`fecharTudo`) não o fecha; o `Esc` só vale com o foco dentro (`onKeyDown` do `<aside>`,
  `:60-64`), e quem tem `Esc` próprio lá dentro — menu do `@` no `Compositor`, `Menu`, renomear
  conversa — para a propagação. **`Dialogo` lá dentro é o avesso**: o `Esc` dele mora no
  `document`, e `stopPropagation` o calaria; ele vai num wrapper `contents` com `preventDefault`,
  e o `<aside>` ignora o `Esc` já tratado (`Conversa.tsx:530-538`; `PainelAssistente.tsx:61`).
  Fechar devolve o foco à origem ou ao botão do trilho `ID_BOTAO_PAINEL`
  (`lib/sessaoChat.tsx:278-287`). `Ctrl+Shift+Y` e o comando da paleta alternam; na tela do chat,
  onde o painel não existe, focam o campo (INV-56). **A tela do chat não tem id de conversa**:
  levar a uma é `selecionar(id)` e `abrirPainel()`, como a faixa da marca (`MarcaIA.tsx:145-148`).
- **A área Assistente é chat, agentes e rotinas; o painel só não existe no chat** (Etapas D e E):
  `/assistente`, `…/agentes…`, `…/rotinas…` e `…/execucoes/:runId` — o "Ver execução" da marca, que
  guarda a execução e não a rotina (`MarcaIA.tsx:84-87`). "Tela do chat?" é `naTelaDoChat`, nunca o
  prefixo (INV-56).
- **Levar texto ao assistente preenche e abre; nunca envia, e abre conversa nova.** Uma mensagem são
  até cinco chamadas pagas, e quem digitou ainda não viu modelo nem teto. Assim fazem o "Pergunte ao
  seu acervo" (`pages/DashboardPage.tsx:114-131`) e o "Perguntar ao assistente" da paleta
  (`Aplicacao.tsx:611-625`). Atalho novo para o chat segue os dois.

## 6. Chaves de `localStorage`

Prefixo `yb:`, sempre — grepe `"yb:` em `apps/web/src` antes de criar uma, para não colidir.

**Filtro de lista não é preferência de dispositivo:** os de notas moram na URL
(`lib/filtrosUrl.ts`), para o Voltar desfazer e o filtro virar link — e toda navegação em `/n`
precisa carregá-los (INV-55).

O princípio: **preferência com formato de dispositivo mora em `localStorage`; dado com formato de
conta mora no banco.**

## 7. Atalhos de teclado

`apps/web/src/components/Atalhos.tsx` é a **fonte única dos atalhos documentados**. Atalho novo sem
entrada lá quebra o contrato com o usuário.

Atalho global entra em **dois lugares**: o ouvinte único de `window`, `useAtalhosGlobais`
(`apps/web/src/lib/atalhosGlobais.ts`, ações num ref para registrar uma vez só), e a lista de
`Atalhos.tsx`. Ao adicionar um atalho: verifique conflito com esse ouvinte, e chame
`stopPropagation()` quando o atalho for local a um campo — `preventDefault()` sozinho não impede o
listener de `window` de receber o evento (INV-39 mostra onde isso já custou caro).

**A paleta também executa comandos** (Etapa 5): a lista mora em `Aplicacao.tsx:320-419`, e `>` no
início troca a busca por só comandos (`Paleta.tsx:31-32`, `:72-75`). O `atalho` de um comando é só
exibido (`Paleta.tsx:14-17`) — o atalho continua entrando nos dois lugares acima. Ação nova do
trilho ou de atalho ganha comando. O `Enter` espera a busca responder (`Paleta.tsx:137-142`).

**Atalho de uma tela vale só com o foco dentro dela.** O `Ctrl+S` dos editores de agentes e de
rotinas ouve no `document` e confere se o foco está na raiz: no compositor do painel ao lado não
salva, e o diálogo em portal fica de fora (`EditorAgente.tsx:440-471`,
`rotinas/EditorRotina.tsx:435-447`).

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
| `rotulo` (`@utility`, `index.css:215`) | Título de seção: miúdo, caixa alta, `ink-400` |
| `rounded-etiqueta` / `controle` / `cartao` / `dialogo` | Raio por papel |
| `shadow-e1` … `e4`, `shadow-brilho-ia` | Elevação crescente; o brilho só em área de IA |
| `ease-saida` / `ease-padrao` | Curvas de entrada e de transição comum |
| `animate-surgir` / `animate-surgir-veu` | Entrada de caixa flutuante e do véu atrás dela |
| `animate-deslizar-esquerda` / `-direita` | Painel que surge da direita (assistente) / `Dialogo` lateral que surge da esquerda (gaveta) |
| `animate-subir` | Entrada de `Toast` na pilha do pé da tela |
| `--veu` | Fundo atrás de diálogo — variável em `:root`, fora do `@theme`, porque não é cor de texto |
| `--z-popover` < `veu` < `dialogo` < `soltura` < `toast` | A escala de camadas (`index.css:129-133`); `z-(--z-dialogo)`, não `z-50` avulso |

- **`text-[10px]` e `text-[11px]` estão proibidos.** São `text-miudo`. 10px fica ilegível em Inter.
- **Toda animação nova passa pelo bloco `prefers-reduced-motion`** (`index.css:226`), que zera
  duração de animação e transição. Ele usa `0.01ms`, não `none`, para o `animationend` continuar
  disparando — não "simplifique". **Animação feita em JS o CSS não alcança**: ela lê
  `useMovimentoReduzido` (`lib/movimento.ts`) — hoje a soltura do `DragOverlay` do quadro de
  modelos, `dropAnimation={reduzido ? null : …}` (`QuadroDeModelos.tsx:525`).
- A Inter vem do Google Fonts por `<link>` em `index.html`, **depois** do script de tema: a fonte
  pode chegar atrasada (`display=swap`), o tema não. Não mova o `<link>` para antes do script.

## 10. Primitivos em `components/base/`

**A decisão de manter `Button` e `Modal` inexistentes foi revogada** na Etapa 1 do redesenho: as
cópias à mão tinham divergido (o porquê está em `components/base/Botao.tsx:4-9`). Hoje existem:

| Arquivo | Exporta |
|---|---|
| `Botao.tsx` | `Botao` (variantes `primario`, `secundario`, `fantasma`, `perigo`, `ia`; `carregando`) e `BotaoIcone`, cujo `rotulo` vira nome acessível e dica, com `tamanho` `p`/`m`/`g` |
| `Bloco.tsx` | `Bloco` (variante `ia` com fio de gradiente), `Vazio`, `Esqueleto` de altura fixa. **Tem `overflow-hidden`**: lista ou menu que abre para fora é cortado — seção de formulário é `Parte` |
| `Parte.tsx` | Seção de formulário com título e descrição, **sem** `overflow-hidden`; variante `ia` |
| `Aviso.tsx` | Aviso inline, tom `erro`/`alerta`/`info`, glifo sempre; `urgente` promove `status` a `alert` |
| `IndicadorSalvamento.tsx` | Estado do autosave com texto, único para nota e card |
| `Dialogo.tsx` | Modal com véu, portal, `Esc`, foco preso e devolvido na limpeza do efeito (`useFocoPreso`, `lib/foco.ts`) — por isso aceita as duas montagens (INV-53); `posicao` `centro`, `topo` (paleta) ou `lateral` (gaveta, encostada no trilho, altura toda) |
| `Toast.tsx` | `PilhaFlutuante`, o pé da tela que empilha o que flutua, e `Toast` (`role="status"`, uma ação no máximo); erro ali dentro continua `Aviso` |
| `Tecla.tsx` | Combinação de teclas partida em `<kbd>` |
| `Menu.tsx` | Menu de ações com gatilho por render prop; ↑/↓/Home/End, `Esc` para ali e devolve o foco; `lado` inclui `baixo-fim`, alinhado à direita do gatilho, e `cima`, para gatilho no pé |
| `Etiqueta.tsx` | Pílula de informação, tom `neutro`/`destaque`/`ia`; vira `<button>` só com `como="button"` |
| `Interruptor.tsx` | Liga/desliga: `<button role="switch">`, `aria-checked`, rótulo e descrição acessíveis, e "ligado"/"desligado" escrito à vista |

- **Primitivo só nasce na etapa que tem consumidor.** Campo e Dica não existem — não os antecipe.
- Botão novo é `Botao`, não `<button>` com classes copiadas. **Fora de `base/` também se reusa**:
  `CampoMarkdown` (textarea com prévia sanitizada), `SeletorDeNota` (combobox sobre `useTitulos()`),
  `agentes/AvatarAgente` (o único jeito de mostrar um agente) e `SeletorColuna`/`useEscolhaDeColuna`
  (`agentes/CamposDoAgente.tsx:113-133`; `quadroFixo` prende ao quadro da entrada, RN-04).
- **Formulário de salvar explícito usa `useGuardaDeSaida`** (`lib/guardaDeSaida.ts`): sem
  `useBlocker` no `BrowserRouter`, ela intercepta o `navigator`, e o Voltar fica de fora (`:16-20`).
- **O que a base já define não se varia por `className`.** O Tailwind v4 ordena utilitários da
  mesma propriedade pelo nome no CSS gerado, não pela ordem no atributo: um `size-6` ou uma cor
  passados a `Botao`/`BotaoIcone` perdem para os da base, calados (`Botao.tsx:76-80`). Tamanho é
  prop; cor vai no ícone. Precisa de outra variação? Vira prop do primitivo.
- **`Dialogo` não serve para painel que convive com o editor** (RNF-05 da Fase 1): nota, card e
  chat não são diálogos. Ele é para o que está fora do caminho de escrita — atalhos, busca, gaveta.
- **O que flutua fora de um `Dialogo` aberto fica inalcançável** por teclado e por leitor de tela:
  foco preso e `aria-modal`. Ação que precisa existir com ele aberto mora dentro dele — o desfazer
  do link aparece na gaveta (`GavetaLinks.tsx:453-463`) e a casca esconde o `Toast` enquanto ela
  está aberta (`Aplicacao.tsx:553-555`).
- **Handler do conteúdo de um `Dialogo` não pega o foco que está na caixa.** Ela tem
  `tabIndex={-1}` (`Dialogo.tsx:70`) e o recebe num clique em área vazia; dali o evento não passa
  por filho nenhum. Tecla de lista vai num wrapper e só vale com o foco num filho (`Paleta.tsx:191`);
  o que precisa valer sempre vai no `document` — o colar da gaveta (`GavetaLinks.tsx:201-219`).

## 11. Arraste

O projeto tem quatro: o kanban (`components/Quadro.tsx`), os favoritos da gaveta de links
(`components/GavetaLinks.tsx:152-159`, o mais simples), o quadro de modelos em `/ajustes/modelos`
(`components/ajustes/QuadroDeModelos.tsx`), que **copia o padrão do kanban sem compartilhar código
com ele** (`:42-55`), e o fluxo do editor de rotinas (`components/rotinas/FluxoEditavel.tsx`).
Arraste novo copia:

- `Espaço` pega e solta, `Esc` cancela, 4 px de folga no ponteiro. Com colunas como alvo, colisão
  `pointerWithin` com recuo para `rectIntersection` — sem ponteiro, só o segundo acha o alvo
  (`:78-86`); lista única usa `closestCenter` (`FluxoEditavel.tsx:51-54`). Setas pulam de destino em
  destino, não de 25 px em 25 px (`:88-124`).
- A origem some com `opacity-0` (INV-30); cópia que continua à vista esmaece (`opacity-50`, `:413-414`).
  Com controle interativo dentro do arrastável, **a alça é o único ativador** (INV-57).
- `onKeyDown` próprio no ativador **compõe** com o do sensor, e seta com outro uso num ancestral é
  ignorada durante o gesto (INV-30). O card do kanban ainda viola a primeira.
- Alvo que recusa mostra a recusa com forma, ícone e texto — borda tracejada, não só vermelha
  (`:185-208`) — e a regra aparece **antes** do arraste, numa `Etiqueta` na coluna (`:471-475`).
- `data-arrastando` no `<html>` mantém o cursor de "segurando" o gesto inteiro (`:237-242`).
- A mesma escolha existe sem arrastar, num `Menu`: "Usar para…" no quadro de modelos (`:431-438`,
  recusa igual nos dois por `podeServir`, `ajustes/comum.ts:40`) e "Mover para a esquerda/direita"
  no fluxo (`FluxoEditavel.tsx:275-282`).

## 12. A marca de conteúdo gerado por IA

Nota e card com `ai` não nulo (Etapa C da IA) se mostram só por `components/MarcaIA.tsx`: a pílula
`MarcaIA` nas listas (`curta` onde não cabe "· revisada") e a `FaixaIA` sob o cabeçalho, com o
agente que escreveu e "Abrir conversa" — ou, vinda de rotina, «Rotina» · «Agente» e "Ver execução".
A tela só **mostra** (INV-58); faísca **e** palavra, nunca só cor (RNF-09 da IA). Superfície nova
que liste nota ou card usa uma das duas.
