# O móvel (`apps/movel`) — o que difere do web

Carregue antes de escrever em `apps/movel`. Tokens, primitivos e ícones são os mesmos do web
(`packages/cliente`, §1, §3 e §10 da skill); aqui está só o que o celular muda.

## Layout

- **Responsivo, celular primeiro.** O padrão é a tela de ~390px; `lg:` (1024px) é o desktop. A
  barra inferior vira coluna lateral (`src/components/Navegacao.tsx:95-98`) e a folha vira a caixa
  do centro (`packages/cliente/src/base/Dialogo.tsx:32-34`). Não existe `GuardaDesktop` aqui.
- **Item em posições diferentes por layout: um elemento por layout, nunca `order`.** Dois nós, um
  com `hidden lg:flex` e outro com `lg:hidden` (`Navegacao.tsx:105-116`, o `BotaoCriar`): a ordem do
  Tab segue o DOM (WCAG 2.4.3), e `order` mudaria só o desenho; o oculto, `display: none`, sai da
  árvore de acessibilidade.
- **Área segura por `env(safe-area-inset-*)`**, porque a página desce sob a barra de gestos
  (`viewport-fit=cover`, `index.html:5-9`): a barra (`Navegacao.tsx:96`), o conteúdo da casca
  (`Casca.tsx:94-95`) e a folha (`pb-[env(safe-area-inset-bottom)]` no `Dialogo`).
- **Camada própria abaixo do popover:** `--z-navegacao: 30` (`src/index.css:22`) — menu e diálogo
  passam por cima da barra. O CSS do app só mistura tokens, nunca cor nova (`src/index.css:10-14`).

## Folhas e toque

- **Folha é `Dialogo posicao="folha"`**, com a `Alca` decorativa no alto (`src/components/Alca.tsx`).
- **Toda folha tem um "Fechar" visível** (`Alca.tsx:1-8`; `folha/FormularioItem.tsx:1257-1259`,
  `Conta.tsx:117-119`): com TalkBack o véu fica fora da árvore (`aria-modal`), e o Voltar não é
  `Esc` nem existe no desktop. Arrastar a alça não fecha.
- **Toda folha entra no histórico** por `useFolhaNoHistorico` (`src/lib/historico.ts:49`; usos em
  `Conta.tsx:44` e `folha/FolhaItem.tsx:88`): o Voltar do Android fecha a folha em vez de sair da
  tela. Folha nova sem o hook compila, e o Voltar navega com ela aberta. Por que o `back()` da
  limpeza vai em microtask e só com a entrada no topo: `historico.ts:39-44`.
- **Folha com formulário tem guarda de descarte, e todo fechamento de fora passa por ela.** Véu,
  `Esc`, Voltar e "Fechar" chamam `pedirFechar` (`FolhaItem.tsx:76-88`, `:100`); `fechar` cru só
  depois de gravar ou no "Descartar" (`FormularioItem.tsx:607`, `:1073`). Ligar `fechar` ao `Dialogo`
  ou ao hook perde a alteração calado. A pergunta é inline, sem `Dialogo` aninhado (`:1055-1077`), e
  concluir com alteração pendente é "Salvar e concluir" — grava, depois conclui (`:662-687`). É o
  par móvel do `useGuardaDeSaida` do web (§10 da skill).
- **Ocorrência de série avisa antes e pergunta o alcance ao gravar** (frente de eventos recorrentes).
  O cabeçalho diz "Repete … · esta é a de …" (`FormularioItem.tsx:742-752`); salvar e excluir
  perguntam "só esta / esta e as seguintes / todas" inline no pé, como o descarte, com o foco no
  alcance menor — um Enter distraído mexe numa só — e sem "só esta" quando a regra mudou
  (`:1078-1194`). Em "todas" o `date` é o início da série, e o dia da ocorrência aberta não vai nele;
  as regras de horário estão em `mudancaDoEvento` (`:258-285`).
- **A seção "Repetir" só aparece no evento que cabe numa série** (`cabeRepetir`, `:209-219`): dias
  em pílulas com o nome por extenso no `aria-label` e o resumo da regra embaixo (`SecaoRepetir`,
  `:1376-1382`). Dia exibido sai de `descreverDias`/`NOMES_CURTOS_DOS_DIAS` (`sáb`);
  `SIGLAS_DOS_DIAS` (`sab`) é só entrada de ferramenta (`packages/shared/src/eventos.ts:401-416`).
  Não escreva outra lista de nomes de dia.
- **Uma folha só de criar e editar evento e tarefa**, na casca (`ProvedorFolhaItem`,
  `FolhaItem.tsx:42-47`; `Casca.tsx:67`, `:85`): o "+" da barra, o "+" do dia e o toque num item a abrem
  por `useFolhaItem`. Não monte outra por tela.
- **Alvo de toque ≥ 44px:** botão de folha e de ação usa `Botao tamanho="g"` (48px,
  `packages/cliente/src/base/Botao.tsx:29-30`). Pelo mesmo motivo o avatar abre **folha**, não
  `Menu`: o item do menu do web tem 32px (`Conta.tsx:30-35`).
- Escolha entre poucos continua controle segmentado, como o `SeletorModo` do web (§4 da skill); na
  folha, em pílulas que quebram linha, e a escolhida muda de forma, cheia e com check
  (`GrupoPilulas`, `src/components/folha/Pilulas.tsx:5-11`).

## O chat

- **A conversa é `lazy`** (`src/components/Casca.tsx:13-20`): Markdown e highlight.js só nela. Tela
  do chunk inicial que mostra o avatar do assistente importa `chat/AvatarIA`, nunca
  `chat/FalaAssistente`, que arrasta o renderizador (razão em `packages/cliente/src/chat/AvatarIA.tsx:3-8`).
- **O teclado do Android encolhe só a visual viewport** (Chrome 108+): `dvh` e `fixed` seguem com a
  tela inteira. O que fica preso ao pé acima do teclado lê `useAreaVisivel` (`src/lib/viewport.ts:10-20`);
  só a conversa o usa, e a meta `interactive-widget` mexeria em todas as telas.
- **A conversa é uma rota só, fora do `<main key>`**, e nada depois do `await` navega sem conferir o
  abortado: INV-56 (`referencias/front.md` de `invariantes-yu-book`).

## Agenda e listas

- **Tipo de item tem tom e forma.** O tom sai de `TOM_DO_TIPO`
  (`src/components/agenda/Calendario.tsx:19-25` — cores de agente: azul evento, verde tarefa, âmbar
  prazo), usado em toda lista e página; a forma, de `Marca`: ponto cheio, anel e losango
  (`:290-310`), em três vagas fixas (`:278-284`), com legenda sob a grade (`:311`) e as contagens no
  `aria-label` do dia (`:265`). Tipo novo entra nos dois, e na legenda.
- **Item que some com o foco dentro devolve o foco** (`useFocoQueSobrevive`, do pacote e também
  do web, `packages/cliente/src/focoQueSobrevive.ts:3-16`): ao vizinho na lista, ou ao título da
  seção mais próxima que sobreviveu. **Toda seção que hospeda itens** leva
  `data-foco-retorno="<id do título>"` e o título `tabIndex={-1}` (`tarefas/ListaAgrupada.tsx:57-60`,
  `agenda/ListaDoDia.tsx:52-55`, `pages/InicioPage.tsx:285-287`). Seção nova sem a marca compila e
  manda o foco ao `<body>`.

## Tema

- **Três valores, não dois:** claro, escuro e "sistema", o padrão enquanto nada foi escolhido, que
  acompanha o aparelho ao vivo por `matchMedia` (`src/lib/tema.ts:3-13`, `:47-49`). Mesma chave
  `yb:tema` do web; "sistema" é a chave apagada. O script de `index.html` decide antes da pintura,
  como no web.
- **`theme-color` sai do token**, lido de `--color-ink-950` já trocado (`tema.ts:38-44`). Hex literal
  só onde o CSS não chega: os dois `<meta name="theme-color">` (`index.html:11-13`) e o
  `public/manifest.webmanifest`. **Os três espelham `ink-950` à mão**: mudar o token obriga os três.
- **O manifest fixa o escuro** (`background_color`/`theme_color` `#0b0e14`): manifest não aceita cor
  por tema, e a splash sai escura no tema claro — deliberado, não "corrija" com o claro.
- **Os ícones do PWA** (`public/*.png`) saem de `apps/movel/scripts/gerar-icones.py` (uso e Pillow
  no cabeçalho, `:1-4`), na cor `#6366f1` do favicon do web, não em `accent-500`: mudar a marca
  obriga rodá-lo de novo e versionar os PNGs.
