---
name: design-system-yu-book
description: Design system manual do Yu-book — rampa de cor semântica ink/accent, os dois temas em CSS puro sem usar a variante dark do Tailwind, ícones SVG desenhados à mão em Icones.tsx, ausência deliberada de biblioteca de UI, limite desktop-only e as regras de acessibilidade tratadas como requisito. Use antes de criar ou alterar qualquer componente, cor, ícone, atalho de teclado ou estado visual em apps/web.
---

# Design system do Yu-book

Tudo aqui é feito à mão. **Não existe shadcn, Radix, Headless UI, Material nem biblioteca de
ícones**, e isso é decisão registrada em comentário no código. Não instale nenhuma.

**A única exceção é o CodeMirror 6**, e ela é estreita: motor de edição de texto não é biblioteca
de UI nem de ícones, e o operador autorizou nominalmente essa dependência e nenhuma outra — a
decisão e seus limites estão na §12/D-01 de `docs/prd-fase-5-refino.md`. Ela não abre precedente:
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

## 2. O tema não existe em React

**Nunca use a variante `dark:` do Tailwind.** Não há uma única ocorrência dela em `apps/web/src`, e
nenhum componente tem condicional de tema. O mecanismo é:

1. Um IIFE bloqueante em `apps/web/index.html` roda **antes da primeira pintura**, lê
   `localStorage["yb:tema"]` (caindo para `prefers-color-scheme`) e define
   `document.documentElement.dataset.tema`.
2. `index.css` redefine **as mesmas variáveis** sob `:root[data-tema="claro"]`.
3. `apps/web/src/lib/tema.ts` apenas **lê** o que o script já aplicou, e só assume a partir do
   primeiro clique no seletor.

Consequências obrigatórias:

- **Cor nova exige duas entradas**: uma no bloco `@theme` e outra em `:root[data-tema="claro"]`.
  Definir só uma quebra um dos temas.
- Cores de estado (`red`, `amber`, `emerald`, `sky`, `rose`, `violet`) têm valores próprios no tema
  claro — um vermelho calibrado para fundo escuro reprova em contraste sobre fundo claro.
- **Não mova a decisão de tema para o React.** O comentário em `index.html` registra que isso
  reintroduz o flash de tema errado.

O contraste dos dois temas foi verificado por cálculo: 74 pares texto/fundo em WCAG AA. Cor nova
entra com essa verificação feita, não por impressão.

## 3. Ícones

`apps/web/src/components/Icones.tsx` é a única fonte. Grade 16×16, traço único compartilhado pela
constante `TRACO`, `currentColor` para seguir tema e estado, `aria-hidden` porque todo item tem
texto ao lado. Ícone novo é desenhado ali, no mesmo estilo. Não instale pacote de ícones.

`ICONE_TIPO` mapeia `NoteKind` para ícone e precisa continuar total — um `kind` novo no enum exige
entrada nova ali.

## 4. Acessibilidade é requisito, não polimento

- **Estado nunca é comunicado só por cor.** Todo status carrega letra ou glifo: o tipo de nota tem
  letra (`A/P/T/W/L`), o prazo tem símbolo, o link quebrado tem sublinhado tracejado **e** o sufixo
  `(criar)`.
- Foco visível é global e incondicional. Não remova `outline` de nada.
- Ícone sem texto leva rótulo `sr-only`.
- Erro usa `role="alert"`; status de salvamento usa `aria-live="polite"`.
- Lista de opções usa `role="listbox"`/`role="option"`; item de navegação ativo usa `aria-current`.
- Toda operação de arraste tem equivalente por teclado **e** é anunciada por `Announcements`.
- Erro fica na tela, não vira toast que some. O usuário precisa poder ler e tentar de novo.

## 5. Layout

- **Desktop-only por decisão.** `GuardaDesktop` (`apps/web/src/components/Colunas.tsx`) bloqueia
  abaixo de 1024px com um aviso. **Não escreva trabalho responsivo nem breakpoints de celular.**
- `PainelRedimensionavel` é a primitiva de layout: largura persistida em `localStorage`, divisor
  operável por teclado (`role="separator"`, setas), limites 180–520px.
- Seção recolhível usa `Secao`/`useSecao`, e vale uma invariante: **uma seção fechada precisa
  continuar mostrando o que está escondido.** O `resumo` aparece quando fechada — o filtro de tipo
  ativo, a contagem de tags selecionadas. Esconder o controle nunca pode esconder que o filtro
  continua valendo.

## 6. Chaves de `localStorage`

Prefixo `yb:`. Hoje: `yb:tema`, `yb:workspace`, `yb:modo-nota`, `yb:secao:<chave>`, `yb:col-nav`,
`yb:col-lista`, `yb:col-card`.

O princípio: **preferência com formato de dispositivo mora em `localStorage`; dado com formato de
conta mora no banco.** Chave nova segue o prefixo.

## 7. Atalhos de teclado

`apps/web/src/components/Atalhos.tsx` é a **fonte única dos atalhos documentados**. Atalho novo sem
entrada lá quebra o contrato com o usuário.

Ao adicionar um atalho: verifique conflito com o handler global de `Aplicacao.tsx`, e chame
`stopPropagation()` quando o atalho for local a um campo — `preventDefault()` sozinho não impede o
listener de `window` de receber o evento (INV-39 mostra onde isso já custou caro).

**No editor de notas o atalho entra em dois lugares ou em nenhum**: a `<textarea>` casa a tecla à
mão em `Editor.tsx`, e o modo ao vivo declara no `keymap` de `editorMd.ts`. Cobrir só um faz o
atalho existir num modo e não no outro, sem nada acusar.

## 8. Markdown renderizado

A classe `.preview` em `index.css` é uma escala tipográfica escrita à mão — não há
`@tailwindcss/typography`. Largura de linha limitada a `72ch`. As cores do realce de sintaxe são
variáveis `--hljs-*`, definidas nos dois temas.
