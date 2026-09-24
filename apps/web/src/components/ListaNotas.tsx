import { NOTE_SORTS } from "@yu-book/shared";
import type { NoteSort, NoteSummary } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFiltrosDaUrl } from "../lib/filtrosUrl";
import { useNotas } from "../lib/notas";
import { Botao } from "./base/Botao";
import { Etiqueta } from "./base/Etiqueta";
import { IconeEstrela, IconeFechar } from "./Icones";
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

/**
 * RNF-11: esqueleto com as mesmas dimensões do item real, sem salto — a mesma
 * margem, o mesmo recuo e as mesmas três faixas (título, trecho, rótulos).
 */
function Esqueleto() {
  return (
    <div className="mx-2 my-0.5 animate-pulse rounded-controle px-3 py-2.5">
      <div className="h-5 w-2/3 rounded-etiqueta bg-ink-800" />
      <div className="mt-1 h-5 w-full rounded-etiqueta bg-ink-800/60" />
      <div className="mt-1.5 h-5.5 w-1/3 rounded-etiqueta bg-ink-800/60" />
    </div>
  );
}

/** Chip de filtro ativo — o recorte da lista fica à vista, e sai com um clique. */
function Chip({ children, rotulo, onRemover }: {
  children: ReactNode;
  rotulo: string;
  onRemover: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-etiqueta bg-accent-500/15 py-0.5 pl-1.5
                 pr-0.5 text-miudo text-accent-400"
    >
      {children}
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Remover filtro ${rotulo}`}
        title={`Remover filtro ${rotulo}`}
        className="rounded-sm p-0.5 hover:bg-accent-500/20"
      >
        <IconeFechar className="size-3" />
      </button>
    </span>
  );
}

interface ListaNotasProps {
  notaAtiva: string | null;
  onAbrirNota: (id: string) => void;
  onNovaNota: () => void;
}

export function ListaNotas({
  notaAtiva,
  onAbrirNota,
  onNovaNota,
}: ListaNotasProps) {
  const [filtros, definir] = useFiltrosDaUrl();
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotas(filtros);

  /**
   * O campo tem texto próprio e só grava na URL depois de 200ms parado: cada
   * tecla na URL seria uma busca por tecla. Quando a URL muda por fora (Voltar,
   * chip, link), o campo acompanha.
   *
   * "Por fora" é o que importa: o react-router faz a navegação dentro de
   * `startTransition`, então o valor que o próprio campo gravou chega de volta
   * atrasado — e, se o campo o aceitasse, apagaria o que foi digitado nesse
   * meio-tempo. `gravado` guarda o último eco esperado, e o eco é ignorado.
   */
  const [texto, setTexto] = useState(filtros.q);
  const gravado = useRef(filtros.q);
  useEffect(() => {
    if (filtros.q === gravado.current) return;
    gravado.current = filtros.q;
    setTexto(filtros.q);
  }, [filtros.q]);
  useEffect(() => {
    if (texto === gravado.current) return;
    const t = setTimeout(() => {
      gravado.current = texto;
      definir({ q: texto }, { substituir: true });
    }, 200);
    return () => clearTimeout(t);
  }, [texto, definir]);

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
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Filtrar nesta lista…"
          aria-label="Filtrar notas da lista"
          className="min-w-0 flex-1 rounded bg-ink-800 px-2 py-1.5 text-xs text-ink-200
                     outline-none placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
        />
        <select
          value={filtros.sort}
          onChange={(e) => definir({ sort: e.target.value as NoteSort })}
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

      {(filtros.kind || filtros.favorite || filtros.trash || filtros.tags.length > 0) && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-ink-800 px-3 py-2">
          {filtros.kind && (
            <Chip rotulo={`tipo ${filtros.kind}`} onRemover={() => definir({ kind: null })}>
              <span className="capitalize">{filtros.kind}</span>
            </Chip>
          )}
          {filtros.favorite && (
            <Chip rotulo="favoritas" onRemover={() => definir({ favorite: false })}>
              Favoritas
            </Chip>
          )}
          {filtros.trash && (
            <Chip rotulo="lixeira" onRemover={() => definir({ trash: false })}>
              Lixeira
            </Chip>
          )}
          {filtros.tags.map((t) => (
            <Chip
              key={t}
              rotulo={`tag ${t}`}
              onRemover={() => definir({ tags: filtros.tags.filter((n) => n !== t) })}
            >
              #{t}
            </Chip>
          ))}
        </div>
      )}

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
            <Botao onClick={() => void refetch()} className="mt-2">
              Tentar de novo
            </Botao>
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
            ) : filtros.kind || filtros.tags.length > 0 || filtros.favorite ? (
              <p className="text-sm text-ink-400">Nenhuma nota com esses filtros.</p>
            ) : (
              // Workspace ativo e vazio ainda é um estado acionável: a nota
              // nova já nasce nele (RF-05).
              <>
                <p className="text-sm text-ink-400">
                  {filtros.workspaceId ? "Nenhuma nota neste workspace ainda." : "Nenhuma nota ainda."}
                </p>
                <Botao variante="primario" onClick={onNovaNota} className="mt-2">
                  Criar a primeira — Ctrl+N
                </Botao>
              </>
            )}
          </div>
        )}

        <ul className="py-1">
          {notas.map((n) => {
            const ativa = n.id === notaAtiva;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onAbrirNota(n.id)}
                  aria-current={ativa ? "true" : undefined}
                  className={`relative mx-2 my-0.5 block w-[calc(100%-1rem)] rounded-controle
                              px-3 py-2.5 text-left transition-colors ${
                                ativa ? "bg-superficie shadow-e1" : "hover:bg-ink-800/40"
                              }`}
                >
                  {/* RNF-09: o item ativo tem uma barra de forma, não só um fundo
                      mais claro — e o `aria-current` diz o mesmo ao leitor de tela. */}
                  {ativa && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent-400"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex min-w-0 items-center gap-1 text-sm font-medium ${
                        ativa ? "text-titulo" : "text-ink-200"
                      }`}
                    >
                      {n.isFavorite && (
                        <span role="img" aria-label="favorita" className="shrink-0">
                          <IconeEstrela className="size-3 fill-current text-amber-400" />
                        </span>
                      )}
                      <span className="truncate">{n.title}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-miudo tabular-nums text-ink-400">
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
                      <span className="text-miudo text-ink-400">#{n.workspaceName}</span>
                    )}
                    {n.tags.map((t) => (
                      <Etiqueta key={t.id}>{t.name}</Etiqueta>
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
