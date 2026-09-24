import type { BoardSummary } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Aviso } from "../components/base/Aviso";
import { Esqueleto } from "../components/base/Bloco";
import { Botao, BotaoIcone } from "../components/base/Botao";
import { IconeFechar } from "../components/Icones";
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
  const { data: boards, isLoading, isError, refetch } = useBoards(ativoId);
  const criar = useCriarBoard();
  const excluir = useExcluirBoard();

  const [nome, setNome] = useState("");
  const [workspaceEscolhido, setWorkspaceEscolhido] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  // "Novo board" do menu de criar do trilho chega aqui com o pedido de foco.
  const campoNome = useRef<HTMLInputElement>(null);
  const { state, key } = useLocation();
  const focarNovo = (state as { focarNovo?: boolean } | null)?.focarNovo === true;
  // `key` nas deps: pedir de novo, já estando aqui, é outra navegação e foca de novo.
  useEffect(() => {
    if (focarNovo) campoNome.current?.focus();
  }, [focarNovo, key]);

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
            ref={campoNome}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do novo board"
            aria-label="Nome do novo board"
            className="h-8 w-64 rounded-controle bg-ink-800 px-3 text-sm text-ink-200 outline-none
                       placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
          />
          {!ativoId && (
            <select
              value={workspaceEscolhido}
              onChange={(e) => setWorkspaceEscolhido(e.target.value)}
              aria-label="Workspace do board"
              className="h-8 rounded-controle bg-ink-800 px-2 text-sm text-ink-200 outline-none
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
          <Botao type="submit" variante="primario" tamanho="m" carregando={criar.isPending}>
            Criar board
          </Botao>
          {erro && (
            <Aviso tom="erro" onFechar={() => setErro(null)} className="basis-full">
              {erro}
            </Aviso>
          )}
        </form>
      )}

      {isLoading && (
        <div className="-mx-4" role="status" aria-label="Carregando boards">
          <Esqueleto linhas={3} alturaLinha={72} />
        </div>
      )}

      {isError && (
        <Aviso tom="erro">
          <span className="flex flex-wrap items-center gap-2">
            Não foi possível carregar os boards.
            <Botao tamanho="p" onClick={() => void refetch()}>
              Tentar de novo
            </Botao>
          </span>
        </Aviso>
      )}

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
                <h3 className="mb-2 rotulo">
                  {workspace}
                </h3>
              )}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {doGrupo.map((b) => (
                  <li key={b.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => navigate(`/b/${b.id}`)}
                      className="relative w-full overflow-hidden rounded-cartao border
                                 border-ink-800 bg-superficie p-4 pt-5 text-left shadow-e1
                                 transition duration-[120ms] ease-(--ease-padrao)
                                 hover:border-accent-400/60 hover:shadow-e2"
                    >
                      {/* A faixa repete a cor do workspace; o nome dele vem no cabeçalho do grupo
                          ou no seletor, então a cor nunca é a única pista. */}
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-[3px]"
                        style={{ backgroundColor: b.workspaceColor }}
                      />
                      <span className="block truncate pr-6 text-sm font-medium text-titulo">
                        {b.name}
                      </span>
                      <span className="mt-2 block text-xs text-ink-400">
                        {b.columnCount} colunas · {b.cardCount} cards
                      </span>
                    </button>

                    {/* RF-12: a confirmação diz quantos cards se perdem. */}
                    <BotaoIcone
                      rotulo={`Excluir board ${b.name}`}
                      icone={<IconeFechar className="size-3.5" />}
                      onClick={() => {
                        const aviso =
                          b.cardCount > 0
                            ? ` Isso exclui ${b.cardCount} card(s).`
                            : "";
                        if (confirm(`Excluir o board "${b.name}"?${aviso}`)) excluir.mutate(b.id);
                      }}
                      className="absolute right-2 top-2.5 opacity-0
                                 focus-visible:opacity-100 group-hover:opacity-100
                                 group-focus-within:opacity-100"
                    />
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
