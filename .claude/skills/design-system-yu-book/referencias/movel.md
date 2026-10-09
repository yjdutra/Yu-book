# O móvel (`apps/movel`) — o que difere do web

Carregue antes de escrever em `apps/movel`. Tokens, primitivos e ícones são os mesmos do web
(`packages/cliente`, §1, §3 e §10 da skill); aqui está só o que o celular muda.

## Layout

- **Responsivo, celular primeiro.** O padrão é a tela de ~390px; `lg:` (1024px) é o desktop. A
  barra inferior vira coluna lateral (`src/components/Navegacao.tsx:90-97`) e a folha vira a caixa
  do centro (`packages/cliente/src/base/Dialogo.tsx:32-34`). Não existe `GuardaDesktop` aqui.
- **Item em posições diferentes por layout: um elemento por layout, nunca `order`.** Dois nós, um
  com `hidden lg:flex` e outro com `lg:hidden` (`Navegacao.tsx:99-110`, o `BotaoCriar`): a ordem do
  Tab segue o DOM (WCAG 2.4.3), e `order` mudaria só o desenho; o oculto, `display: none`, sai da
  árvore de acessibilidade.
- **Área segura por `env(safe-area-inset-*)`**, porque a página desce sob a barra de gestos
  (`viewport-fit=cover`, `index.html:5-9`): a barra (`Navegacao.tsx:90`), o conteúdo da casca
  (`Casca.tsx:48-49`) e a folha (`pb-[env(safe-area-inset-bottom)]` no `Dialogo`).
- **Camada própria abaixo do popover:** `--z-navegacao: 30` (`src/index.css:20`) — menu e diálogo
  passam por cima da barra. O CSS do app só mistura tokens, nunca cor nova (`src/index.css:8-12`).

## Folhas e toque

- **Folha é `Dialogo posicao="folha"`**, com a `Alca` decorativa no alto (`src/components/Alca.tsx`).
- **Toda folha tem um "Fechar" visível** (`Alca.tsx:2-6`; `FolhaCriar.tsx:68-69`,
  `Conta.tsx:114-116`): com TalkBack o véu fica fora da árvore (`aria-modal`) e o Voltar do
  Android não vira `Esc`. Arrastar a alça não fecha. Hoje o Voltar **navega** com a folha aberta —
  falta integrar com o histórico; o botão continua obrigatório depois disso.
- **Alvo de toque ≥ 44px:** botão de folha e de ação usa `Botao tamanho="g"` (48px,
  `packages/cliente/src/base/Botao.tsx:29-30`). Pelo mesmo motivo o avatar abre **folha**, não
  `Menu`: o item do menu do web tem 32px (`Conta.tsx:29-34`).
- Escolha entre poucos continua controle segmentado, como o `SeletorModo` do web (§4 da skill).

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
