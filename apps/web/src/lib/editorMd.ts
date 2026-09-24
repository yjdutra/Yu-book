import { Language, defineLanguageFacet, languageDataProp } from "@codemirror/language";
import { EditorSelection, Prec } from "@codemirror/state";
import type { StateCommand } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { GFM, parser } from "@lezer/markdown";

/**
 * O motor do editor ao vivo (RF-32).
 *
 * **Por que não `@codemirror/lang-markdown`.** Ele importa `@codemirror/lang-html`
 * estaticamente e o avalia em escopo de módulo, então tree-shaking não remove:
 * viriam junto as pilhas de HTML, CSS e JavaScript, ~60 KB comprimidos que uma
 * nota em Markdown nunca usa — RNF-05 dá 120 KB para a etapa inteira.
 *
 * O peso não foi o único motivo. Aquele pacote também instala três coisas que
 * **mexem no documento sozinhas**: continuar marcador de lista no Enter (que
 * apaga o marcador de uma linha vazia), transformar URL colada sobre seleção em
 * `[texto](url)`, e completar tag HTML. Nada disso pode existir aqui — abrir e
 * fechar uma nota sem digitar não pode alterar um byte (RNF-08).
 *
 * O que sobra é montar o mesmo que ele monta por dentro: o parser do Lezer
 * embrulhado num `Language`.
 */
const dadosDaLinguagem = defineLanguageFacet({
  commentTokens: { block: { open: "<!--", close: "-->" } },
});

/**
 * GFM traz tabela, lista de tarefas (RF-39), riscado e autolink. O
 * `languageDataProp` prende o facet ao nó raiz — sem ele, `languageDataAt` não
 * acha nada e a linguagem fica muda para o resto do editor.
 */
const parserMd = parser.configure([
  GFM,
  { props: [languageDataProp.add({ Document: dadosDaLinguagem })] },
]);

export const linguagemMd = new Language(dadosDaLinguagem, parserMd, [], "markdown");

/* ------------------------------------------------------------------- tema */

/**
 * O tema é só string de CSS, então usa as variáveis que já existem em
 * `index.css`. É isso que faz o editor seguir os dois temas sem um único
 * condicional em JavaScript — o mesmo mecanismo do resto da aplicação.
 *
 * **Não** passe `{ dark: true }` aqui: fixaria um dos dois temas.
 */
export const temaEditor = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-ink-200)",
    backgroundColor: "transparent",
    fontSize: "0.875rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "1.25rem 0", caretColor: "var(--color-accent-400)" },
  ".cm-line": { padding: "0 1.5rem" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--color-accent-400)" },
  // Fundo translúcido de propósito: opaco esconderia a seleção por baixo.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent-500) 32%, transparent)",
  },

  /* A marcação que continua visível na linha do cursor fica apagada, para o
     olho pousar no texto e não nos símbolos. */
  ".cm-md-marca": { color: "var(--color-ink-400)", opacity: "0.65" },

  ".cm-md-h1": { fontSize: "1.6em", fontWeight: "600", color: "var(--color-titulo)" },
  ".cm-md-h2": { fontSize: "1.35em", fontWeight: "600", color: "var(--color-titulo)" },
  ".cm-md-h3": { fontSize: "1.15em", fontWeight: "600", color: "var(--color-titulo)" },
  ".cm-md-h4, .cm-md-h5, .cm-md-h6": {
    fontSize: "1em",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--color-ink-400)",
  },

  ".cm-md-forte": { fontWeight: "700", color: "var(--color-titulo)" },
  ".cm-md-enfase": { fontStyle: "italic" },
  ".cm-md-riscado": { textDecoration: "line-through", color: "var(--color-ink-400)" },
  ".cm-md-codigo": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, var(--color-ink-700) 45%, transparent)",
    borderRadius: "0.25rem",
    padding: "0.1em 0.3em",
  },
  ".cm-md-bloco": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in srgb, var(--color-ink-900) 70%, transparent)",
  },
  ".cm-md-citacao": {
    color: "var(--color-ink-400)",
    fontStyle: "italic",
    borderLeft: "2px solid color-mix(in srgb, var(--color-accent-500) 60%, transparent)",
    paddingLeft: "0.75rem",
    marginLeft: "-0.75rem",
  },

  /* Wikilink: a mesma leitura do preview — resolvido é um link, não resolvido
     é um convite a criar. */
  ".cm-md-wikilink": {
    color: "var(--color-accent-400)",
    backgroundColor: "color-mix(in srgb, var(--color-accent-500) 12%, transparent)",
    borderRadius: "0.25rem",
    padding: "0.05em 0.3em",
    cursor: "pointer",
  },
  ".cm-md-wikilink-quebrado": {
    color: "var(--color-ink-400)",
    textDecoration: "underline dashed",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-md-tarefa": { accentColor: "var(--color-accent-500)", cursor: "pointer" },
});

/* ---------------------------------------------------------------- atalhos */

/**
 * RF-38: envolve a seleção com marcadores.
 *
 * Diferente do que a `<textarea>` fazia, a mudança e a seleção saem na **mesma
 * transação** — não há `requestAnimationFrame` restaurando o cursor depois, e o
 * desfazer enxerga um passo só (CA-31).
 */
function envolver(antes: string, depois: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    dispatch(
      state.update(
        state.changeByRange((range) => ({
          changes: [
            { from: range.from, insert: antes },
            { from: range.to, insert: depois },
          ],
          // Coordenadas já no documento resultante: tudo desloca por `antes`.
          range: EditorSelection.range(range.from + antes.length, range.to + antes.length),
        })),
        { scrollIntoView: true, userEvent: "input.envolver" },
      ),
    );
    return true;
  };
}

/**
 * `stopPropagation` é o que impede o atalho de vazar para o listener de
 * `window` em `Aplicacao.tsx` — sem ele, `Ctrl+K` inseria o link **e** abria a
 * paleta de busca. `preventDefault` explícito no `Ctrl+S` porque o comando pode
 * devolver `false`, e aí o "Salvar página" do navegador apareceria.
 */
export function atalhosMd(salvarAgora: () => void) {
  return Prec.high(
    keymap.of([
      { key: "Mod-b", run: envolver("**", "**"), preventDefault: true, stopPropagation: true },
      { key: "Mod-i", run: envolver("_", "_"), preventDefault: true, stopPropagation: true },
      { key: "Mod-k", run: envolver("[", "](url)"), preventDefault: true, stopPropagation: true },
      { key: "Mod-`", run: envolver("`", "`"), preventDefault: true, stopPropagation: true },
      {
        key: "Mod-s",
        run: () => {
          salvarAgora();
          return true;
        },
        preventDefault: true,
        stopPropagation: true,
      },
    ]),
  );
}
