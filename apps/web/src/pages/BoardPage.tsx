import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BarraDeTags } from "../components/BarraDeTags";
import { CartaoCard } from "../components/CartaoCard";
import { PainelRedimensionavel } from "../components/Colunas";
import { PainelCard } from "../components/PainelCard";
import { Quadro } from "../components/Quadro";
import { ApiError } from "../lib/api";
import { useArquivados, useAtualizarBoard, useBoard, useCriarColuna } from "../lib/kanban";
import { cardCasaFiltro, catalogoDeTags } from "../lib/tags";

/** RF-13: board completo em uma requisição; o painel do card empurra, não cobre. */
export function BoardPage() {
  const { boardId = "", cardId = null } = useParams<{ boardId: string; cardId: string }>();
  const navigate = useNavigate();
  const { data: board, isLoading, isError } = useBoard(boardId);
  const criarColuna = useCriarColuna();
  const atualizarBoard = useAtualizarBoard();

  const [novaColuna, setNovaColuna] = useState("");
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState("");
  const [arquivadosAbertos, setArquivadosAbertos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tagsFiltro, setTagsFiltro] = useState<string[]>([]);
  const { data: arquivados } = useArquivados(boardId, arquivadosAbertos);

  // RF-10: a página não remonta ao navegar entre boards, então o filtro
  // sobreviveria à troca e recortaria um quadro onde aquela tag nem existe.
  useEffect(() => setTagsFiltro([]), [boardId]);

  const tagsDoBoard = useMemo(() => catalogoDeTags(board?.columns ?? []), [board]);

  const escondidos = useMemo(() => {
    const cards = board?.columns.flatMap((c) => c.cards) ?? [];
    return cards.filter((c) => !cardCasaFiltro(c.tags, tagsFiltro)).length;
  }, [board, tagsFiltro]);

  if (isError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-ink-400">Board não encontrado.</p>
        <button
          type="button"
          onClick={() => navigate("/b")}
          className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200
                     hover:border-accent-400"
        >
          Ver todos os boards
        </button>
      </main>
    );
  }

  if (isLoading || !board) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-ink-400">
        <span className="animate-pulse">Carregando board…</span>
      </main>
    );
  }

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-ink-800 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {renomeando ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const novo = nome.trim();
                  if (novo && novo !== board.name) {
                    atualizarBoard.mutate(
                      { id: board.id, name: novo },
                      {
                        onError: (err) =>
                          setErro(
                            err instanceof ApiError ? err.message : "Não foi possível renomear.",
                          ),
                      },
                    );
                  }
                  setRenomeando(false);
                }}
              >
                <input
                  autoFocus
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  onBlur={() => setRenomeando(false)}
                  aria-label="Novo nome do board"
                  className="rounded bg-ink-800 px-2 py-1 text-base font-semibold text-titulo
                             outline-none focus:ring-1 focus:ring-accent-400"
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNome(board.name);
                  setRenomeando(true);
                }}
                title="Renomear board"
                className="text-base font-semibold text-titulo"
              >
                {board.name}
              </button>
            )}

            <span className="text-xs text-ink-400">#{board.workspaceName}</span>

            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = novaColuna.trim();
                if (!name) return;
                setErro(null);
                criarColuna.mutate(
                  { boardId: board.id, name, wipLimit: null },
                  {
                    onSuccess: () => setNovaColuna(""),
                    onError: (err) =>
                      setErro(
                        err instanceof ApiError ? err.message : "Não foi possível criar a coluna.",
                      ),
                  },
                );
              }}
            >
              <input
                value={novaColuna}
                onChange={(e) => setNovaColuna(e.target.value)}
                placeholder="+ nova coluna"
                aria-label="Nome da nova coluna"
                className="w-40 rounded bg-ink-800 px-2 py-1 text-xs text-ink-200 outline-none
                           placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
              />
            </form>

            {/* RF-33 */}
            <button
              type="button"
              onClick={() => setArquivadosAbertos((v) => !v)}
              aria-expanded={arquivadosAbertos}
              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-400
                         hover:border-ink-400 hover:text-ink-200"
            >
              Arquivados ({board.archivedCount})
            </button>
          </div>

          {erro && (
            <p role="alert" className="mt-2 text-xs text-red-300">
              {erro}
            </p>
          )}
        </header>

        {/* RF-08: só aparece quando há o que filtrar. */}
        {tagsDoBoard.length > 0 && (
          <BarraDeTags
            tags={tagsDoBoard}
            selecionadas={tagsFiltro}
            escondidos={escondidos}
            onAlternar={(nome) =>
              setTagsFiltro((atual) =>
                atual.includes(nome) ? atual.filter((t) => t !== nome) : [...atual, nome],
              )
            }
            onLimpar={() => setTagsFiltro([])}
          />
        )}

        {arquivadosAbertos && (
          <section
            aria-label="Cards arquivados"
            className="max-h-56 shrink-0 overflow-y-auto border-b border-ink-800 bg-ink-900/40 p-4"
          >
            {arquivados?.length === 0 ? (
              <p className="text-xs text-ink-400">Nenhum card arquivado neste board.</p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                {arquivados?.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/b/${board.id}/c/${card.id}`)}
                      className="w-full text-left opacity-70 transition hover:opacity-100"
                    >
                      <CartaoCard card={card} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {board.columns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-400">
            Sem colunas. Crie a primeira no campo “+ nova coluna”.
          </div>
        ) : (
          <Quadro
            board={board}
            cardAtivoId={cardId}
            tagsFiltro={tagsFiltro}
            onAbrirCard={(id) => navigate(`/b/${board.id}/c/${id}`)}
          />
        )}
      </main>

      {/* RF-27: 420px à direita, empurrando o board em vez de cobri-lo. */}
      {cardId && (
        <PainelRedimensionavel
          chave="yb:col-card"
          inicial={420}
          rotulo="Largura do painel do card"
          divisor="esquerda"
          className="border-l border-ink-800 bg-ink-900/50"
        >
          <PainelCard
            key={cardId}
            cardId={cardId}
            onFechar={() => navigate(`/b/${board.id}`)}
            onAbrirNota={(id) => navigate(`/n/${id}`)}
          />
        </PainelRedimensionavel>
      )}
    </>
  );
}
