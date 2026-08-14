import type { NoteDetail } from "@yu-book/shared";
import { normalizarTitulo } from "@yu-book/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { posicaoDoCursor, wikilinkEmDigitacao } from "../lib/caret";
import type { PosicaoCursor } from "../lib/caret";
import { marcarNaoResolvidos, renderMarkdown } from "../lib/markdown";
import { useTitulos } from "../lib/notas";
import type { TituloSugerido } from "../lib/notas";
import { RotuloTipo } from "./RotuloTipo";

interface EditorProps {
  nota: NoteDetail;
  conteudo: string;
  onConteudo: (valor: string) => void;
  onSalvarAgora: () => void;
  onAbrirNota: (id: string) => void;
  onCriarPorTitulo: (titulo: string) => void;
  refCorpo: RefObject<HTMLTextAreaElement | null>;
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
}: EditorProps) {
  const previewRef = useRef<HTMLDivElement>(null);
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

      const editor = refCorpo.current;
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
    [refCorpo],
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
    const campo = refCorpo.current;
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
    if (!mod) return;

    const atalhos: Record<string, [string, string]> = {
      b: ["**", "**"],
      i: ["_", "_"],
      k: ["[", "](url)"],
      "`": ["`", "`"],
    };

    const par = atalhos[e.key.toLowerCase()];
    if (par) {
      e.preventDefault();
      envolver(e.currentTarget, par[0], par[1], onConteudo);
      return;
    }

    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSalvarAgora();
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col border-r border-ink-800">
        <textarea
          ref={refCorpo}
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
            className="absolute z-20 w-72 overflow-hidden rounded-lg border border-ink-700
                       bg-ink-800 shadow-2xl"
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

      <div
        ref={previewRef}
        onScroll={() => sincronizar("preview")}
        onClick={clicarPreview}
        className="preview min-w-0 flex-1 overflow-y-auto px-6 py-5"
        // Já sanitizado por DOMPurify dentro de renderMarkdown (RNF-19).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
