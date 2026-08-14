import { NOTE_SORTS } from "@yu-book/shared";
import type { NoteSort, NoteSummary } from "@yu-book/shared";
import { useEffect, useRef } from "react";
import { useNotas } from "../lib/notas";
import type { Filtros } from "../lib/notas";
import { RotuloTipo } from "./RotuloTipo";

const ROTULO_ORDEM: Record<NoteSort, string> = {
  updatedAt: "editada",
  createdAt: "criada",
  occurredAt: "data da aula",
  title: "título",
};

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** RNF-11: esqueleto com as mesmas dimensões do item real, sem salto. */
function Esqueleto() {
  return (
    <div className="animate-pulse border-b border-ink-800 px-4 py-3">
      <div className="h-4 w-2/3 rounded bg-ink-800" />
      <div className="mt-2 h-3 w-full rounded bg-ink-800/60" />
      <div className="mt-1.5 h-3 w-1/3 rounded bg-ink-800/60" />
    </div>
  );
}

interface ListaNotasProps {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  notaAtiva: string | null;
  onAbrirNota: (id: string) => void;
  onNovaNota: () => void;
}

export function ListaNotas({
  filtros,
  onFiltros,
  notaAtiva,
  onAbrirNota,
  onNovaNota,
}: ListaNotasProps) {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotas(filtros);

  const sentinela = useRef<HTMLDivElement>(null);

  // RF-09: carrega a próxima página quando o fim da lista aparece.
  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entrada]) => {
        if (entrada?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    observer.observe(alvo);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const notas: NoteSummary[] = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-3 py-2">
        <input
          value={filtros.q}
          onChange={(e) => onFiltros({ ...filtros, q: e.target.value })}
          placeholder="Filtrar nesta lista…"
          aria-label="Filtrar notas da lista"
          className="min-w-0 flex-1 rounded bg-ink-800 px-2 py-1.5 text-xs text-ink-200
                     outline-none placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
        />
        <select
          value={filtros.sort}
          onChange={(e) => onFiltros({ ...filtros, sort: e.target.value as NoteSort })}
          aria-label="Ordenar por"
          className="shrink-0 rounded bg-ink-800 px-1.5 py-1.5 text-xs text-ink-400 outline-none
                     focus:ring-1 focus:ring-accent-400"
        >
          {NOTE_SORTS.map((s) => (
            <option key={s} value={s}>
              {ROTULO_ORDEM[s]}
            </option>
          ))}
        </select>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <>
            <Esqueleto />
            <Esqueleto />
            <Esqueleto />
          </>
        )}

        {/* RNF-23: erro não apaga o que já estava na tela e oferece retry. */}
        {isError && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-ink-400">Não foi possível carregar as notas.</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-2 rounded border border-ink-700 px-3 py-1 text-xs text-ink-200
                         hover:border-ink-400"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {/* RNF-22: cada lista vazia tem um estado próprio e acionável. */}
        {!isLoading && !isError && notas.length === 0 && (
          <div className="px-4 py-10 text-center">
            {filtros.trash ? (
              <p className="text-sm text-ink-400">A lixeira está vazia.</p>
            ) : filtros.q ? (
              <p className="text-sm text-ink-400">
                Nada encontrado para <span className="text-ink-200">“{filtros.q}”</span>.
              </p>
            ) : filtros.kind || filtros.workspaceId || filtros.tags.length > 0 ? (
              <p className="text-sm text-ink-400">Nenhuma nota com esses filtros.</p>
            ) : (
              <>
                <p className="text-sm text-ink-400">Nenhuma nota ainda.</p>
                <button
                  type="button"
                  onClick={onNovaNota}
                  className="mt-2 rounded bg-accent-500 px-3 py-1.5 text-xs font-medium text-white
                             hover:bg-accent-400"
                >
                  Criar a primeira — Ctrl+N
                </button>
              </>
            )}
          </div>
        )}

        <ul>
          {notas.map((n) => {
            const ativa = n.id === notaAtiva;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onAbrirNota(n.id)}
                  aria-current={ativa ? "true" : undefined}
                  className={`w-full border-b border-ink-800 border-l-2 px-4 py-3 text-left
                              transition-colors ${
                                ativa
                                  ? "border-l-accent-400 bg-ink-800/80"
                                  : "border-l-transparent hover:bg-ink-800/40"
                              }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`truncate text-sm ${ativa ? "text-white" : "text-ink-200"}`}
                    >
                      {n.isFavorite && (
                        <span aria-label="favorita" className="mr-1 text-amber-400">
                          ★
                        </span>
                      )}
                      {n.title}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-400">
                      {dataCurta(n.updatedAt)}
                    </span>
                  </div>

                  {n.excerpt && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-400">
                      {n.excerpt}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <RotuloTipo tipo={n.kind} />
                    {n.workspaceName && (
                      <span className="text-[10px] text-ink-400">#{n.workspaceName}</span>
                    )}
                    {n.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded bg-ink-800 px-1 py-0.5 text-[10px] text-ink-400"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div ref={sentinela} className="h-4" />
        {isFetchingNextPage && <Esqueleto />}
      </div>
    </>
  );
}
