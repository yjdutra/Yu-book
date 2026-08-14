import { splitHighlight } from "@yu-book/shared";
import type { SearchResult } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import { useBusca } from "../lib/notas";
import { useWorkspaceAtivo } from "../lib/workspace";
import { RotuloTipo } from "./RotuloTipo";

interface PaletaProps {
  aberta: boolean;
  onFechar: () => void;
  onAbrirNota: (id: string) => void;
  /** RF-43: abrir um card leva ao board com o painel aberto. */
  onAbrirCard: (boardId: string, cardId: string) => void;
}

/** RF-28..37 (notas) e RF-41..45 (cards): busca global por teclado. */
export function Paleta({ aberta, onFechar, onAbrirNota, onAbrirCard }: PaletaProps) {
  const { ativo, ativoId } = useWorkspaceAtivo();
  const [texto, setTexto] = useState("");
  const [debounced, setDebounced] = useState("");
  const [indice, setIndice] = useState(0);
  const campoRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // RF-29: 200 ms entre a tecla e a consulta.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(texto), 200);
    return () => clearTimeout(t);
  }, [texto]);

  const { data, isFetching } = useBusca(debounced, aberta, ativoId);
  const resultados = data?.results ?? [];

  useEffect(() => {
    if (aberta) {
      setTexto("");
      setDebounced("");
      setIndice(0);
      // Sem rAF o input ainda não existe no DOM quando tentamos focar.
      requestAnimationFrame(() => campoRef.current?.focus());
    }
  }, [aberta]);

  useEffect(() => setIndice(0), [debounced]);

  // Mantém o item destacado visível ao navegar por teclado.
  useEffect(() => {
    listaRef.current
      ?.querySelector(`[data-indice="${indice}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [indice]);

  if (!aberta) return null;

  function escolher(resultado: SearchResult) {
    if (resultado.type === "card" && resultado.boardId) {
      onAbrirCard(resultado.boardId, resultado.id);
    } else {
      onAbrirNota(resultado.id);
    }
    onFechar();
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (resultados.length === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setIndice((i) => (i + passo + resultados.length) % resultados.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const escolhido = resultados[indice];
      if (escolhido) escolher(escolhido);
    }
  }

  const filtros = data?.filtros;
  const temChips =
    filtros && (filtros.kind || filtros.tag || filtros.workspace || filtros.card || ativo);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar notas"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={teclas}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-ink-700
                   bg-ink-800 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-ink-700 px-4">
          <span aria-hidden="true" className="text-ink-400">
            ⌕
          </span>
          <input
            ref={campoRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar…  tipo:aula · tipo:card · tag:jwt · #workspace"
            aria-label="Termo de busca"
            aria-controls="paleta-resultados"
            className="w-full bg-transparent py-3.5 text-sm text-ink-200 outline-none
                       placeholder:text-ink-400/60"
          />
          {isFetching && <span className="text-xs text-ink-400">…</span>}
        </div>

        {temChips && (
          <div className="flex flex-wrap gap-2 border-b border-ink-700 px-4 py-2">
            {/* RF-02: o escopo ativo é visível; RF-06: `#ws` digitado o substitui. */}
            {ativo && !filtros.workspace && (
              <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-200">
                em {ativo.name}
              </span>
            )}
            {filtros.card && <RotuloTipo tipo="card" />}
            {filtros.kind && <RotuloTipo tipo={filtros.kind} />}
            {filtros.tag && (
              <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-200">
                tag: {filtros.tag}
              </span>
            )}
            {filtros.workspace && (
              <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-200">
                #{filtros.workspace}
              </span>
            )}
          </div>
        )}

        {data?.approximate && (
          <p className="border-b border-ink-700 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            Nada exato. Mostrando resultados aproximados por semelhança de título.
          </p>
        )}

        <ul id="paleta-resultados" ref={listaRef} role="listbox" className="max-h-80 overflow-y-auto">
          {resultados.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-ink-400">
              {debounced ? (
                <>
                  Nada encontrado para <span className="text-ink-200">“{debounced}”</span>.
                </>
              ) : (
                "Digite para buscar."
              )}
            </li>
          )}

          {resultados.map((r, i) => (
            <li key={`${r.type}:${r.id}`}>
              <button
                type="button"
                role="option"
                data-indice={i}
                aria-selected={i === indice}
                onMouseEnter={() => setIndice(i)}
                onClick={() => escolher(r)}
                className={`w-full border-l-2 px-4 py-2.5 text-left ${
                  i === indice
                    ? "border-accent-400 bg-ink-700/70"
                    : "border-transparent hover:bg-ink-700/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-white">{r.title}</span>
                  {/* RF-41: card se identifica como card e diz de que board é. */}
                  <RotuloTipo tipo={r.kind ?? "card"} className="ml-auto shrink-0" />
                  {r.type === "card" ? (
                    <span className="shrink-0 text-[10px] text-ink-400">
                      {r.boardName} · {r.columnName}
                    </span>
                  ) : (
                    r.workspaceName && (
                      <span className="shrink-0 text-[10px] text-ink-400">#{r.workspaceName}</span>
                    )
                  )}
                </div>
                {r.snippet && (
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {/* RF-32: destaque vem por marcadores, não por HTML da API */}
                    {splitHighlight(r.snippet).map((parte, idx) =>
                      parte.hl ? (
                        <mark key={idx} className="bg-transparent font-medium text-accent-400">
                          {parte.text}
                        </mark>
                      ) : (
                        <span key={idx}>{parte.text}</span>
                      ),
                    )}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-4 border-t border-ink-700 px-4 py-2 text-[11px] text-ink-400">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  );
}
