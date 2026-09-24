import type { NoteDetail } from "@yu-book/shared";
import { normalizarTitulo } from "@yu-book/shared";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { posicaoDoCursor, wikilinkEmDigitacao } from "../lib/caret";
import type { PosicaoCursor } from "../lib/caret";
import { marcarNaoResolvidos, renderMarkdown } from "../lib/markdown";
import { useTitulos } from "../lib/notas";
import type { TituloSugerido } from "../lib/notas";
import type { ModoNota } from "../lib/modoNota";
import { RotuloTipo } from "./RotuloTipo";

/**
 * O que quem está de fora precisa do corpo da nota: pôr o foco nele. A
 * `<textarea>` e o editor ao vivo cumprem isso de formas diferentes, e nem
 * `NotasPage` nem `PainelEditor` deveriam saber qual dos dois está montado.
 */
export interface FocoDoCorpo {
  focus: () => void;
}

/**
 * O CodeMirror sai do bundle inicial (RNF-05). O corte é dentro da tela de
 * notas e não por rota, mas o motivo é o mesmo do kanban e da gaveta: quem abre
 * a aplicação não paga por um motor de edição que talvez não use nesta sessão.
 */
const EditorAoVivo = lazy(() =>
  import("./EditorAoVivo").then((m) => ({ default: m.EditorAoVivo })),
);

interface EditorProps {
  nota: NoteDetail;
  conteudo: string;
  onConteudo: (valor: string) => void;
  onSalvarAgora: () => void;
  onAbrirNota: (id: string) => void;
  onCriarPorTitulo: (titulo: string) => void;
  refCorpo: RefObject<FocoDoCorpo | null>;
  /** Escrever, escrever vendo o resultado, ou só ler. */
  modo: ModoNota;
}

/** Envolve a seleção com marcadores (RF-19), preservando o que estava selecionado. */
function envolver(
  campo: HTMLTextAreaElement,
  antes: string,
  depois: string,
  onValor: (v: string) => void,
): void {
  const { selectionStart: ini, selectionEnd: fim, value } = campo;
  const selecionado = value.slice(ini, fim);
  onValor(value.slice(0, ini) + antes + selecionado + depois + value.slice(fim));
  requestAnimationFrame(() => {
    campo.focus();
    campo.setSelectionRange(ini + antes.length, ini + antes.length + selecionado.length);
  });
}

interface Sugestao {
  aberto: boolean;
  termo: string;
  inicio: number;
  posicao: PosicaoCursor;
  indice: number;
}

const SUGESTAO_FECHADA: Sugestao = {
  aberto: false,
  termo: "",
  inicio: 0,
  posicao: { topo: 0, esquerda: 0, altura: 0 },
  indice: 0,
};

export function Editor({
  nota,
  conteudo,
  onConteudo,
  onSalvarAgora,
  onAbrirNota,
  onCriarPorTitulo,
  refCorpo,
  modo,
}: EditorProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  /** A `<textarea>` em si. `refCorpo` é o contrato de fora, e é mais estreito. */
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { data: titulos } = useTitulos();
  const [sugestao, setSugestao] = useState<Sugestao>(SUGESTAO_FECHADA);

  // RF-11: o preview não reprocessa a cada tecla. 60 ms mantém a digitação
  // fluida e fica bem abaixo do limite de 100 ms.
  const [paraRenderizar, setParaRenderizar] = useState(conteudo);
  useEffect(() => {
    const t = setTimeout(() => setParaRenderizar(conteudo), 60);
    return () => clearTimeout(t);
  }, [conteudo]);

  const html = useMemo(() => renderMarkdown(paraRenderizar), [paraRenderizar]);

  const porTitulo = useMemo(() => {
    const mapa = new Map<string, TituloSugerido>();
    for (const t of titulos ?? []) mapa.set(normalizarTitulo(t.title), t);
    return mapa;
  }, [titulos]);

  // useLayoutEffect: marcar depois da pintura faria os links piscarem
  // como "quebrados" a cada render.
  useLayoutEffect(() => {
    if (previewRef.current) {
      marcarNaoResolvidos(previewRef.current, new Set(porTitulo.keys()));
    }
  }, [html, porTitulo]);

  /** RF-23 / RF-25: resolvido navega, não resolvido cria a nota. */
  const clicarPreview = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const alvo = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.wikilink");
      if (!alvo) return;
      e.preventDefault();

      const existente = porTitulo.get(alvo.dataset.wikilink ?? "");
      if (existente) onAbrirNota(existente.id);
      else onCriarPorTitulo(alvo.textContent ?? "");
    },
    [porTitulo, onAbrirNota, onCriarPorTitulo],
  );

  // RF-12: scroll proporcional entre os dois painéis. A trava evita que o
  // painel movido por sincronia devolva o movimento para o outro.
  const sincronizando = useRef<"editor" | "preview" | null>(null);
  const sincronizar = useCallback(
    (origem: "editor" | "preview") => {
      if (sincronizando.current && sincronizando.current !== origem) return;

      const editor = areaRef.current;
      const preview = previewRef.current;
      if (!editor || !preview) return;

      sincronizando.current = origem;
      const de = origem === "editor" ? editor : preview;
      const para = origem === "editor" ? preview : editor;

      const rolavel = de.scrollHeight - de.clientHeight;
      const proporcao = rolavel > 0 ? de.scrollTop / rolavel : 0;
      para.scrollTop = proporcao * (para.scrollHeight - para.clientHeight);

      requestAnimationFrame(() => {
        sincronizando.current = null;
      });
    },
    [],
  );

  /** Filtragem local: os títulos já estão em cache, então não há rede por tecla. */
  const sugestoes = useMemo(() => {
    if (!sugestao.aberto) return [];
    const termo = normalizarTitulo(sugestao.termo);
    return (titulos ?? [])
      .filter((t) => t.id !== nota.id && normalizarTitulo(t.title).includes(termo))
      .slice(0, 8);
  }, [sugestao.aberto, sugestao.termo, titulos, nota.id]);

  function avaliarSugestao(campo: HTMLTextAreaElement, valor: string) {
    const emDigitacao = wikilinkEmDigitacao(valor, campo.selectionStart);
    if (!emDigitacao) {
      setSugestao(SUGESTAO_FECHADA);
      return;
    }
    setSugestao({
      aberto: true,
      termo: emDigitacao.termo,
      inicio: emDigitacao.inicio,
      posicao: posicaoDoCursor(campo, campo.selectionStart),
      indice: 0,
    });
  }

  function inserirSugestao(titulo: string) {
    const campo = areaRef.current;
    if (!campo) return;

    const antes = conteudo.slice(0, sugestao.inicio);
    const depois = conteudo.slice(campo.selectionStart);
    const inserido = `[[${titulo}]]`;
    onConteudo(antes + inserido + depois);
    setSugestao(SUGESTAO_FECHADA);

    const cursor = antes.length + inserido.length;
    requestAnimationFrame(() => {
      campo.focus();
      campo.setSelectionRange(cursor, cursor);
    });
  }

  function teclas(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Com a lista aberta, as setas navegam nela e não no texto.
    if (sugestao.aberto && sugestoes.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const passo = e.key === "ArrowDown" ? 1 : -1;
        setSugestao((s) => ({
          ...s,
          indice: (s.indice + passo + sugestoes.length) % sugestoes.length,
        }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const escolhida = sugestoes[sugestao.indice];
        if (escolhida) inserirSugestao(escolhida.title);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSugestao(SUGESTAO_FECHADA);
        return;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    // Com Shift, o atalho é de outra pessoa: `Ctrl+Shift+B` e `Ctrl+Shift+L` são
    // da navegação, em Aplicacao.tsx. Sem este teste, `e.key.toLowerCase()`
    // transforma `Ctrl+Shift+B` em negrito e o card navega *e* fica em negrito.
    if (!mod || e.shiftKey || e.altKey) return;

    const atalhos: Record<string, [string, string]> = {
      b: ["**", "**"],
      i: ["_", "_"],
      k: ["[", "](url)"],
      "`": ["`", "`"],
    };

    const par = atalhos[e.key.toLowerCase()];
    if (par) {
      e.preventDefault();
      // `preventDefault` sozinho não basta: o listener global de `window`
      // (Aplicacao.tsx) recebe o evento mesmo assim, e `Ctrl+K` abria a paleta
      // ao mesmo tempo em que inseria o link.
      e.stopPropagation();
      envolver(e.currentTarget, par[0], par[1], onConteudo);
      return;
    }

    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      onSalvarAgora();
    }
  }

  const aoVivo = modo === "aovivo";
  const mostraEditor = modo === "edicao" || modo === "dividido";
  const mostraPreview = modo === "dividido" || modo === "leitura";

  /**
   * Com a `<textarea>` montada, é ela quem responde ao pedido de foco; no modo
   * ao vivo quem se registra é o `EditorAoVivo`. Os dois escrevem no mesmo
   * `refCorpo`, e cada um limpa o que escreveu ao sair.
   */
  useLayoutEffect(() => {
    if (!mostraEditor) return;
    refCorpo.current = { focus: () => areaRef.current?.focus() };
    return () => {
      refCorpo.current = null;
    };
  }, [mostraEditor, refCorpo]);

  return (
    <div className="relative flex min-h-0 flex-1">
      {aoVivo && (
        <Suspense
          fallback={
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-400">
              <span className="animate-pulse">Carregando o editor…</span>
            </div>
          }
        >
          <EditorAoVivo
            conteudo={conteudo}
            onConteudo={onConteudo}
            onSalvarAgora={onSalvarAgora}
            onAbrirTitulo={(titulo) => {
              const existente = porTitulo.get(normalizarTitulo(titulo));
              if (existente) onAbrirNota(existente.id);
              else onCriarPorTitulo(titulo);
            }}
            onCriarTitulo={onCriarPorTitulo}
            titulos={titulos ?? []}
            notaId={nota.id}
            rotulo={`Conteúdo da nota ${nota.title}`}
            refFoco={refCorpo}
          />
        </Suspense>
      )}

      {mostraEditor && (
      <div
        className={`relative flex min-w-0 flex-1 flex-col ${
          mostraPreview ? "border-r border-ink-800" : ""
        }`}
      >
        <textarea
          ref={areaRef}
          value={conteudo}
          onChange={(e) => {
            onConteudo(e.target.value);
            avaliarSugestao(e.currentTarget, e.target.value);
          }}
          onKeyDown={teclas}
          onClick={(e) => avaliarSugestao(e.currentTarget, conteudo)}
          onBlur={() => setSugestao(SUGESTAO_FECHADA)}
          onScroll={() => sincronizar("editor")}
          spellCheck
          placeholder="Escreva em Markdown. Use [[titulo]] para ligar a outra nota."
          aria-label={`Conteúdo da nota ${nota.title}`}
          className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-mono text-sm
                     leading-relaxed text-ink-200 outline-none placeholder:text-ink-400/50"
        />

        {sugestao.aberto && sugestoes.length > 0 && (
          <ul
            role="listbox"
            aria-label="Notas para vincular"
            style={{
              top: sugestao.posicao.topo + sugestao.posicao.altura + 20,
              left: Math.min(sugestao.posicao.esquerda + 24, 400),
            }}
            className="absolute z-(--z-popover) w-72 overflow-hidden rounded-cartao border
                       border-ink-700/70 bg-superficie shadow-e3"
          >
            {sugestoes.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sugestao.indice}
                  // onMouseDown: o clique não pode tirar o foco do textarea antes de inserir.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    inserirSugestao(s.title);
                  }}
                  onMouseEnter={() => setSugestao((atual) => ({ ...atual, indice: i }))}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    i === sugestao.indice ? "bg-accent-500 text-white" : "text-ink-200"
                  }`}
                >
                  <span className="truncate">{s.title}</span>
                  <RotuloTipo tipo={s.kind} className="ml-auto shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {mostraPreview && (
        <div
          ref={previewRef}
          onScroll={() => sincronizar("preview")}
          onClick={clicarPreview}
          // Sozinho na tela, o texto é centralizado: linha de 72ch encostada na
          // esquerda de uma tela larga é desconfortável de ler (RNF-10).
          className={`preview min-w-0 flex-1 overflow-y-auto px-6 py-5 ${
            mostraEditor ? "" : "mx-auto w-full max-w-4xl"
          }`}
          // Já sanitizado por DOMPurify dentro de renderMarkdown (RNF-19).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
