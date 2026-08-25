import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { normalizarTitulo } from "@yu-book/shared";

/**
 * A árvore de sintaxe, sem depender de `@lezer/common` direto — ele é
 * transitivo, e o pnpm não resolve o que não está declarado.
 */
type Arvore = ReturnType<typeof syntaxTree>;

/**
 * O live preview (RF-33 a RF-36): a marcação some do que já foi escrito e
 * reaparece na linha onde o cursor está.
 *
 * **Nada aqui monta HTML a partir do texto da nota.** As decorações escondem,
 * estilizam e substituem trechos por elementos construídos no código — o texto
 * do usuário nunca vira `innerHTML`. `renderMarkdown` com DOMPurify continua
 * sendo o único caminho de Markdown para DOM (INV-09), e ele serve os modos
 * `dividido` e `leitura`.
 */

/** Os marcadores que somem. Todos compartilham a tag `processingInstruction`. */
const MARCADORES = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
]);

/** Marcador de bloco: revela pela linha. O resto revela pelo nó que o contém. */
const DE_BLOCO = new Set(["HeaderMark", "QuoteMark", "ListMark"]);

/**
 * Num link, esconder só os colchetes e parênteses deixaria a URL solta no meio
 * do texto — `[texto](url)` viraria `textourl`. O endereço some junto com eles.
 * `Autolink` (`<https://…>`) não entra: ali a URL **é** o texto.
 */
const ALVO_DE_LINK = new Set(["Link", "Image"]);

const ESTILO_INLINE: Record<string, string> = {
  StrongEmphasis: "cm-md-forte",
  Emphasis: "cm-md-enfase",
  Strikethrough: "cm-md-riscado",
  InlineCode: "cm-md-codigo",
};

const esconder = Decoration.replace({});
const marca = Decoration.mark({ class: "cm-md-marca" });

/* ------------------------------------------------- títulos para o wikilink */

/**
 * O conjunto de títulos existentes muda fora de qualquer transação (chega pelo
 * cache do React Query). Um campo de estado é o jeito de o editor enxergar essa
 * mudança: o plugin compara o campo entre `startState` e `state` e redesenha.
 */
export const efeitoTitulos = StateEffect.define<Set<string>>();

const campoTitulos = StateField.define<Set<string>>({
  create: () => new Set(),
  update(atual, tr) {
    for (const efeito of tr.effects) if (efeito.is(efeitoTitulos)) return efeito.value;
    return atual;
  },
});

/* ------------------------------------------------------------- utilitários */

/** Linhas tocadas pela seleção — é o que revela a marcação de bloco. */
function linhasReveladas(state: EditorState): Set<number> {
  const linhas = new Set<number>();
  for (const r of state.selection.ranges) {
    const de = state.doc.lineAt(r.from).number;
    const ate = state.doc.lineAt(r.to).number;
    for (let n = de; n <= ate; n++) linhas.add(n);
  }
  return linhas;
}

function mesmoConjunto(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

/** Wikilink dentro de código é texto, não link. */
function dentroDeCodigo(arvore: Arvore, pos: number): boolean {
  let no = arvore.resolveInner(pos, 1);
  while (no.parent) {
    if (no.name === "InlineCode" || no.name === "FencedCode" || no.name === "CodeBlock") return true;
    no = no.parent;
  }
  return false;
}

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/* ---------------------------------------------------------------- widgets */

interface Acoes {
  abrirNota: (titulo: string) => void;
  criarNota: (titulo: string) => void;
}

class WikilinkWidget extends WidgetType {
  constructor(
    readonly titulo: string,
    readonly resolvido: boolean,
  ) {
    super();
  }

  /**
   * Sem `eq`, o padrão do CodeMirror é redesenhar sempre — e como as decorações
   * são reconstruídas a cada movimento de cursor, todos os widgets visíveis
   * seriam recriados a cada seta pressionada.
   */
  eq(outro: WikilinkWidget): boolean {
    return outro.titulo === this.titulo && outro.resolvido === this.resolvido;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.resolvido ? "cm-md-wikilink" : "cm-md-wikilink-quebrado";
    // textContent, nunca innerHTML: o título é texto do usuário (INV-09).
    el.textContent = this.titulo;
    el.dataset.wikilink = this.titulo;
    el.setAttribute("role", "link");
    el.setAttribute("aria-label", this.resolvido ? this.titulo : `${this.titulo} (criar)`);
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class TarefaWidget extends WidgetType {
  constructor(readonly marcada: boolean) {
    super();
  }

  /** A posição não entra: se só ela mudou, o DOM é idêntico. */
  eq(outro: TarefaWidget): boolean {
    return outro.marcada === this.marcada;
  }

  toDOM(view: EditorView): HTMLElement {
    const caixa = document.createElement("input");
    caixa.type = "checkbox";
    caixa.checked = this.marcada;
    caixa.className = "cm-md-tarefa";
    caixa.setAttribute("aria-label", this.marcada ? "tarefa feita" : "tarefa pendente");

    caixa.addEventListener("mousedown", (evento) => {
      // Sem isto o navegador tenta pôr o cursor dentro do trecho substituído.
      evento.preventDefault();

      // A posição é derivada do DOM na hora, e não guardada no widget: guardada,
      // ela envelhece a cada edição acima da tarefa.
      const inicio = view.posAtDOM(caixa);
      const marcador = view.state.doc.sliceString(inicio, inicio + 3);
      if (!/^\[[ xX]\]$/.test(marcador)) return;

      const feita = marcador[1] !== " ";
      view.dispatch({
        // Um byte, no meio dos colchetes. O resto da linha não é tocado.
        changes: { from: inicio + 1, to: inicio + 2, insert: feita ? " " : "x" },
        userEvent: "input.tarefa",
        effects: EditorView.announce.of(feita ? "Tarefa desmarcada." : "Tarefa marcada."),
      });
    });

    return caixa;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/* ------------------------------------------------------------ construção */

function construir(view: EditorView): DecorationSet {
  const { state } = view;
  const titulos = state.field(campoTitulos);
  const linhas = linhasReveladas(state);
  const ranges: Range<Decoration>[] = [];

  const selecaoToca = (de: number, ate: number) =>
    state.selection.ranges.some((r) => r.from <= ate && r.to >= de);

  for (const { from, to } of view.visibleRanges) {
    /*
     * Numa nota grande a árvore **vem incompleta**: o parse síncrono inicial
     * cobre poucos milhares de caracteres e o resto acontece em segundo plano.
     * `ensureSyntaxTree` compra um orçamento curto para o trecho visível; o
     * `null` dele significa "não deu", e aí vale o que já existe. O que fecha a
     * conta é a comparação de árvore no `update` abaixo, que redesenha quando o
     * parser de fundo avança.
     */
    const arvore = ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);

    arvore.iterate({
      from,
      to,
      enter: (no) => {
        const nome = no.name;

        if (nome.startsWith("ATXHeading") || nome.startsWith("SetextHeading")) {
          const nivel = nome.slice(-1);
          // A decoração de linha é ignorada se não estiver no início exato.
          ranges.push(
            Decoration.line({ class: `cm-md-h${nivel}` }).range(state.doc.lineAt(no.from).from),
          );
          return;
        }

        if (nome === "FencedCode" || nome === "CodeBlock" || nome === "Blockquote") {
          const classe = nome === "Blockquote" ? "cm-md-citacao" : "cm-md-bloco";
          const primeira = state.doc.lineAt(no.from).number;
          const ultima = state.doc.lineAt(no.to).number;
          for (let n = primeira; n <= ultima; n++) {
            ranges.push(Decoration.line({ class: classe }).range(state.doc.line(n).from));
          }
          return;
        }

        const estilo = ESTILO_INLINE[nome];
        if (estilo && no.to > no.from) {
          ranges.push(Decoration.mark({ class: estilo }).range(no.from, no.to));
          return;
        }

        if (nome === "TaskMarker") {
          const texto = state.doc.sliceString(no.from, no.to);
          if (selecaoToca(no.from, no.to)) return; // com o cursor em cima, edite o texto
          ranges.push(
            Decoration.replace({ widget: new TarefaWidget(texto[1] !== " ") }).range(
              no.from,
              no.to,
            ),
          );
          return;
        }

        const paiDoEndereco = no.node.parent;
        const ehEndereco =
          (nome === "URL" || nome === "LinkTitle") &&
          paiDoEndereco !== null &&
          ALVO_DE_LINK.has(paiDoEndereco.name);

        if (!MARCADORES.has(nome) && !ehEndereco) return;

        // Bloco revela pela linha; inline revela pelo nó que o contém — é o que
        // faz `**forte**` mostrar os dois asteriscos ao mesmo tempo.
        const pai = no.node.parent;
        const revelado = DE_BLOCO.has(nome)
          ? linhas.has(state.doc.lineAt(no.from).number)
          : selecaoToca(pai ? pai.from : no.from, pai ? pai.to : no.to);

        if (revelado) {
          ranges.push(marca.range(no.from, no.to));
          return;
        }

        // O nó do `#` não cobre o espaço depois dele; sem estender, sobraria um
        // recuo à esquerda do título.
        let fim = no.to;
        if (nome === "HeaderMark" || nome === "ListMark" || nome === "QuoteMark") {
          while (fim < state.doc.length && state.doc.sliceString(fim, fim + 1) === " ") fim += 1;
        }
        if (fim > no.from) ranges.push(esconder.range(no.from, fim));
      },
    });

    // `[[wikilink]]` não é nó do parser — varredura própria, pulando código.
    const texto = state.doc.sliceString(from, to);
    WIKILINK.lastIndex = 0;
    let achado: RegExpExecArray | null;
    while ((achado = WIKILINK.exec(texto)) !== null) {
      const de = from + achado.index;
      const ate = de + achado[0].length;
      const titulo = (achado[1] ?? "").trim();
      if (!titulo || selecaoToca(de, ate) || dentroDeCodigo(arvore, de)) continue;
      ranges.push(
        Decoration.replace({
          widget: new WikilinkWidget(titulo, titulos.has(normalizarTitulo(titulo))),
        }).range(de, ate),
      );
    }
  }

  // Os nós saem em pre-order, então a ordem não é a do documento. `true` manda
  // a biblioteca ordenar em vez de a gente garantir.
  return Decoration.set(ranges, true);
}

/* -------------------------------------------------------------- extensão */

export function decoracoesMd(acoesRef: { current: Acoes }): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private linhas: Set<number>;

      constructor(view: EditorView) {
        this.decorations = construir(view);
        this.linhas = linhasReveladas(view.state);
      }

      update(u: ViewUpdate) {
        /*
         * Trocar DOM debaixo de uma composição ativa a quebra ou duplica
         * caractere. Em português isso é o caminho comum, não a exceção: cada
         * acento morto (á, ã, ç) é uma composição.
         */
        if (u.view.composing) return;

        const mudouArvore = syntaxTree(u.startState) !== syntaxTree(u.state);
        const mudaramTitulos = u.startState.field(campoTitulos) !== u.state.field(campoTitulos);

        if (u.docChanged || u.viewportChanged || mudouArvore || mudaramTitulos) {
          this.decorations = construir(u.view);
          this.linhas = linhasReveladas(u.state);
          return;
        }

        if (u.selectionSet) {
          // Mover o cursor dentro da mesma linha não muda nada visualmente.
          // Sem esta comparação, segurar uma seta redesenha a cada quadro.
          const agora = linhasReveladas(u.state);
          if (!mesmoConjunto(agora, this.linhas)) {
            this.decorations = construir(u.view);
            this.linhas = agora;
          }
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      // Sem isto o cursor entra num trecho escondido e some da tela.
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
      eventHandlers: {
        mousedown(evento) {
          const alvo = evento.target as HTMLElement | null;
          const link = alvo?.closest<HTMLElement>("[data-wikilink]");
          if (!link) return false;
          evento.preventDefault();

          const titulo = link.dataset.wikilink ?? "";
          if (link.classList.contains("cm-md-wikilink")) acoesRef.current.abrirNota(titulo);
          else acoesRef.current.criarNota(titulo);
          return true;
        },
      },
    },
  );

  return [campoTitulos, plugin];
}
