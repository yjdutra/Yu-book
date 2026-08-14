import type { BoardSummary } from "@yu-book/shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useBoards, useCriarBoard, useExcluirBoard } from "../lib/kanban";
import { useWorkspaceAtivo } from "../lib/workspace";

function agrupar(boards: BoardSummary[]): [string, BoardSummary[]][] {
  const grupos = new Map<string, BoardSummary[]>();
  for (const b of boards) {
    grupos.set(b.workspaceName, [...(grupos.get(b.workspaceName) ?? []), b]);
  }
  return [...grupos.entries()];
}

/** RF-11: os boards do workspace ativo; com "todos", agrupados por workspace. */
export function BoardsPage() {
  const navigate = useNavigate();
  const { workspaces, ativo, ativoId } = useWorkspaceAtivo();
  const { data: boards, isLoading } = useBoards(ativoId);
  const criar = useCriarBoard();
  const excluir = useExcluirBoard();

  const [nome, setNome] = useState("");
  const [workspaceEscolhido, setWorkspaceEscolhido] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  // RN-03: board sempre pertence a um workspace. Com "todos" ativo, é preciso
  // escolher um na hora de criar.
  const destino = ativoId ?? workspaceEscolhido ?? "";

  function criarBoard(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const name = nome.trim();
    if (!name) return;
    if (!destino) {
      setErro("Escolha o workspace do board.");
      return;
    }

    criar.mutate(
      { name, workspaceId: destino },
      {
        onSuccess: (board) => {
          setNome("");
          navigate(`/b/${board.id}`);
        },
        onError: (e) =>
          setErro(e instanceof ApiError ? e.message : "Não foi possível criar o board."),
      },
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6">
      <header className="mb-6">
        <h2 className="text-lg font-semibold text-titulo">Boards</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          {ativo ? `Workspace ${ativo.name}` : "Todos os workspaces"}
        </p>
      </header>

      {workspaces.length === 0 ? (
        // RNF-19: estado vazio acionável — sem workspace não existe board.
        <p className="text-sm text-ink-400">
          Crie um workspace no seletor acima. Todo board pertence a um.
        </p>
      ) : (
        <form onSubmit={criarBoard} className="mb-6 flex flex-wrap items-center gap-2">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do novo board"
            aria-label="Nome do novo board"
            className="w-64 rounded bg-ink-800 px-3 py-1.5 text-sm text-ink-200 outline-none
                       placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
          />
          {!ativoId && (
            <select
              value={workspaceEscolhido}
              onChange={(e) => setWorkspaceEscolhido(e.target.value)}
              aria-label="Workspace do board"
              className="rounded bg-ink-800 px-2 py-1.5 text-sm text-ink-200 outline-none
                         focus:ring-1 focus:ring-accent-400"
            >
              <option value="">escolha o workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded bg-accent-500 px-3 py-1.5 text-sm font-medium text-white
                       hover:bg-accent-400"
          >
            Criar board
          </button>
          {erro && (
            <p role="alert" className="text-xs text-red-300">
              {erro}
            </p>
          )}
        </form>
      )}

      {isLoading && <p className="animate-pulse text-sm text-ink-400">Carregando boards…</p>}

      {boards?.length === 0 && !isLoading && workspaces.length > 0 && (
        <p className="text-sm text-ink-400">
          {ativo
            ? `Nenhum board em ${ativo.name} ainda. Crie o primeiro acima — ele já nasce com “A fazer”, “Fazendo” e “Feito”.`
            : "Nenhum board ainda."}
        </p>
      )}

      {boards && boards.length > 0 && (
        <div className="space-y-6">
          {agrupar(boards).map(([workspace, doGrupo]) => (
            <section key={workspace}>
              {!ativoId && (
                <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                  {workspace}
                </h3>
              )}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {doGrupo.map((b) => (
                  <li key={b.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => navigate(`/b/${b.id}`)}
                      className="w-full rounded-lg border border-ink-700 bg-ink-900/60 p-4 text-left
                                 transition hover:border-accent-400"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: b.workspaceColor }}
                        />
                        <span className="truncate text-sm font-medium text-titulo">{b.name}</span>
                      </span>
                      <span className="mt-2 block text-xs text-ink-400">
                        {b.columnCount} colunas · {b.cardCount} cards
                      </span>
                    </button>

                    {/* RF-12: a confirmação diz quantos cards se perdem. */}
                    <button
                      type="button"
                      aria-label={`Excluir board ${b.name}`}
                      onClick={() => {
                        const aviso =
                          b.cardCount > 0
                            ? ` Isso exclui ${b.cardCount} card(s).`
                            : "";
                        if (confirm(`Excluir o board "${b.name}"?${aviso}`)) excluir.mutate(b.id);
                      }}
                      className="absolute right-2 top-2 hidden rounded px-1 text-xs text-ink-400
                                 hover:text-red-400 group-hover:block group-focus-within:block"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
