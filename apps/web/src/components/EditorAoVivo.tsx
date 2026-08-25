import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import type { CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Prec } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { normalizarTitulo } from "@yu-book/shared";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { atalhosMd, linguagemMd, temaEditor } from "../lib/editorMd";
import { decoracoesMd, efeitoTitulos } from "../lib/editorMdDecoracoes";
import type { TituloSugerido } from "../lib/notas";
import type { FocoDoCorpo } from "./Editor";

interface EditorAoVivoProps {
  conteudo: string;
  onConteudo: (valor: string) => void;
  onSalvarAgora: () => void;
  /** Wikilink resolvido: navega. Não resolvido: cria (RF-36). */
  onAbrirTitulo: (titulo: string) => void;
  onCriarTitulo: (titulo: string) => void;
  /** Catálogo de notas: resolve wikilink e alimenta o autocomplete de `[[`. */
  titulos: TituloSugerido[];
  /** Id da nota aberta — ela não se sugere para si mesma. */
  notaId: string;
  rotulo: string;
  refFoco: RefObject<FocoDoCorpo | null>;
}

/**
 * RF-32: escrever vendo o resultado.
 *
 * O documento é, e continua sendo, a **string de Markdown** — não existe modelo
 * intermediário nem conversão de ida e volta. Abrir e fechar uma nota sem
 * digitar não altera um byte (RNF-08), e é por isso que o autosave e o resto da
 * aplicação não precisam saber que este editor existe.
 */
export function EditorAoVivo({
  conteudo,
  onConteudo,
  onSalvarAgora,
  onAbrirTitulo,
  onCriarTitulo,
  titulos,
  notaId,
  rotulo,
  refFoco,
}: EditorAoVivoProps) {
  const hospedeiroRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  /*
   * Tudo o que vem de fora e muda a cada render entra por ref, nunca por
   * dependência do efeito de montagem: recriar a `EditorView` a cada tecla
   * perderia cursor, seleção e histórico de desfazer.
   */
  const conteudoInicialRef = useRef(conteudo);
  const onConteudoRef = useRef(onConteudo);
  const onSalvarRef = useRef(onSalvarAgora);
  const titulosRef = useRef(titulos);
  const notaIdRef = useRef(notaId);
  const acoesRef = useRef({
    abrirNota: (t: string) => onAbrirTitulo(t),
    criarNota: (t: string) => onCriarTitulo(t),
  });

  useLayoutEffect(() => {
    onConteudoRef.current = onConteudo;
    onSalvarRef.current = onSalvarAgora;
    titulosRef.current = titulos;
    notaIdRef.current = notaId;
    acoesRef.current = { abrirNota: onAbrirTitulo, criarNota: onCriarTitulo };
  });

  // Montagem única. O `[]` e a limpeza incondicional são o que faz isto
  // sobreviver ao efeito duplo do StrictMode em desenvolvimento.
  useEffect(() => {
    const hospedeiro = hospedeiroRef.current;
    if (!hospedeiro) return;

    /** RF-37: `[[` abre a lista das notas existentes, sem rede por tecla. */
    const sugerirWikilink: CompletionSource = (contexto) => {
      const casou = contexto.matchBefore(/\[\[[^[\]\n]*$/);
      if (!casou) return null;

      const termo = normalizarTitulo(casou.text.slice(2));
      const opcoes = titulosRef.current
        .filter((t) => t.id !== notaIdRef.current && normalizarTitulo(t.title).includes(termo))
        .slice(0, 8)
        .map((t) => ({ label: t.title, detail: t.kind, apply: `${t.title}]]` }));

      if (opcoes.length === 0) return null;
      return { from: casou.from + 2, options: opcoes, validFor: /^[^[\]\n]*$/ };
    };

    const view = new EditorView({
      // Do ref, não da prop: na segunda montagem do StrictMode a prop pode já
      // ter avançado, e o documento inicial precisa ser o mesmo das duas vezes.
      doc: conteudoInicialRef.current,
      parent: hospedeiro,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        linguagemMd,
        /*
         * Sem `syntaxHighlighting(defaultHighlightStyle)` de propósito: aquele
         * estilo traz cores fixas, que não seguiriam os dois temas. Quem pinta
         * aqui são as decorações abaixo, que usam as variáveis do `index.css`.
         * Como não há linguagem aninhada dentro das cercas, também não há token
         * de código para colorir — o realce completo continua nos modos que
         * passam por `renderMarkdown`.
         */
        decoracoesMd(acoesRef),
        temaEditor,
        placeholder("Escreva em Markdown. Use [[titulo]] para ligar a outra nota."),
        autocompletion({ override: [sugerirWikilink] }),
        // `Tab` não vem no completionKeymap; aceitar com ele é o que a lista da
        // `<textarea>` já fazia. Devolve `false` sem lista aberta, então o Tab
        // continua sendo Tab.
        Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
        atalhosMd(() => onSalvarRef.current()),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // O CodeMirror não dá nome acessível ao próprio campo.
        EditorView.contentAttributes.of({ "aria-label": rotulo, spellcheck: "true" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onConteudoRef.current(u.state.doc.toString());
        }),
      ],
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O rótulo carrega o título da nota, que muda enquanto se digita.
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.contentDOM.setAttribute("aria-label", rotulo);
  }, [rotulo]);

  /*
   * Sincronia de fora para dentro. A comparação é o que corta o laço: sem ela,
   * o `updateListener` sobe o valor, o React devolve por prop, e o editor
   * reescreve o próprio documento para sempre.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === conteudo) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: conteudo },
    });
  }, [conteudo]);

  /** O conjunto de títulos resolve os wikilinks e chega fora de transação. */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: efeitoTitulos.of(new Set(titulos.map((t) => normalizarTitulo(t.title)))),
    });
  }, [titulos]);

  /** RNF-06: quem chama `.focus()` lá em cima não precisa saber qual motor é. */
  useLayoutEffect(() => {
    refFoco.current = { focus: () => viewRef.current?.focus() };
    return () => {
      refFoco.current = null;
    };
  }, [refFoco]);

  // `min-h-0`: sem isto o filho flex não encolhe abaixo do conteúdo e o
  // `overflow` do rolador do editor nunca dispara.
  return <div ref={hospedeiroRef} className="min-h-0 flex-1 overflow-hidden" />;
}
