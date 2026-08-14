import { NOTE_KINDS } from "@yu-book/shared";
import type { NoteKind } from "@yu-book/shared";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useBoards } from "../lib/kanban";
import { useContadores, useTags } from "../lib/notas";
import type { Filtros } from "../lib/notas";
import { useWorkspaceAtivo } from "../lib/workspace";
import { SeletorWorkspace } from "./SeletorWorkspace";

interface NavegacaoProps {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  onNovaNota: () => void;
  onAbrirGaveta: () => void;
  /** Quantos itens esperam na fila de "ver depois" (RF-16). */
  linksParaVer: number;
}

function Item({
  ativo,
  onClick,
  children,
  contagem,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  contagem?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "true" : undefined}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm
                  transition-colors ${
                    ativo ? "bg-ink-700 text-white" : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                  }`}
    >
      {children}
      {contagem !== undefined && (
        <span className="ml-auto text-xs tabular-nums text-ink-400">{contagem}</span>
      )}
    </button>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 px-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
      {children}
    </p>
  );
}

export function Navegacao({
  filtros,
  onFiltros,
  onNovaNota,
  onAbrirGaveta,
  linksParaVer,
}: NavegacaoProps) {
  const { user, logout } = useAuth();
  const { ativoId, ativo } = useWorkspaceAtivo();
  const { data: contadores } = useContadores(ativoId);
  const { data: tags } = useTags();
  const { data: boards } = useBoards(ativoId);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const emBoards = pathname.startsWith("/b");

  /**
   * Filtro de nota escolhido a partir de um board leva de volta para as notas —
   * senão o clique não teria efeito visível.
   */
  const aplicar = (extra: Partial<Filtros>) => {
    onFiltros({
      ...filtros,
      kind: null,
      favorite: false,
      trash: false,
      tags: [],
      ...extra,
    });
    if (emBoards) navigate("/");
  };

  const nenhumFiltro =
    !filtros.kind && !filtros.favorite && !filtros.trash && filtros.tags.length === 0;

  return (
    <nav className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between px-2">
        <h1 className="text-sm font-semibold text-white">Yu-book</h1>
        <button
          type="button"
          onClick={onNovaNota}
          title="Nova nota (Ctrl+N)"
          aria-label="Nova nota"
          className="rounded bg-accent-500 px-2 py-0.5 text-sm font-medium text-white
                     transition hover:bg-accent-400"
        >
          +
        </button>
      </div>

      {/* RF-01: o contexto da aplicação inteira vive aqui, no topo. */}
      <SeletorWorkspace />

      <div className="mt-3">
        <Item ativo={!emBoards && nenhumFiltro} onClick={() => aplicar({})} contagem={contadores?.total}>
          Todas as notas
        </Item>
        <Item
          ativo={!emBoards && filtros.favorite}
          onClick={() => aplicar({ favorite: true })}
          contagem={contadores?.favorites}
        >
          Favoritas
        </Item>
      </div>

      <Titulo>Tipos</Titulo>
      {NOTE_KINDS.map((tipo: NoteKind) => (
        <Item
          key={tipo}
          ativo={!emBoards && filtros.kind === tipo}
          onClick={() => aplicar({ kind: tipo })}
          contagem={contadores?.byKind[tipo]}
        >
          <span className="capitalize">{tipo}</span>
        </Item>
      ))}

      <div className="flex items-center justify-between">
        <Titulo>Boards</Titulo>
        <button
          type="button"
          onClick={() => navigate("/b")}
          title="Todos os boards (Ctrl+Shift+B)"
          className="mt-5 rounded px-2 text-[10px] uppercase tracking-wider text-ink-400
                     hover:text-ink-200"
        >
          ver todos
        </button>
      </div>

      {/* RF-11: os boards do workspace ativo. Sem workspace ativo, todos. */}
      {boards?.length === 0 && (
        <p className="px-2 py-1 text-xs text-ink-400/70">
          {ativo ? `Nenhum board em ${ativo.name}.` : "Nenhum board ainda."}
        </p>
      )}
      {boards?.map((b) => (
        <Item
          key={b.id}
          ativo={pathname.startsWith(`/b/${b.id}`)}
          onClick={() => navigate(`/b/${b.id}`)}
          contagem={b.cardCount}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: b.workspaceColor }}
          />
          <span className="truncate">{b.name}</span>
        </Item>
      ))}

      {tags && tags.length > 0 && (
        <>
          <Titulo>Tags</Titulo>
          <div className="flex flex-wrap gap-1 px-2">
            {tags.map((t) => {
              const ativa = !emBoards && filtros.tags.includes(t.name);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onFiltros({
                      ...filtros,
                      trash: false,
                      tags: ativa
                        ? filtros.tags.filter((n) => n !== t.name)
                        : [...filtros.tags, t.name],
                    });
                    if (emBoards) navigate("/");
                  }}
                  aria-pressed={ativa}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                    ativa
                      ? "bg-accent-500 text-white"
                      : "bg-ink-800 text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {t.name}
                  <span className="ml-1 opacity-60">{t.noteCount}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-auto pt-4">
        {/* RF-16: a gaveta é sobreposta, então aqui é só a porta de entrada. */}
        <Item ativo={false} onClick={onAbrirGaveta} contagem={linksParaVer || undefined}>
          <span title="Ctrl+Shift+L">Links</span>
        </Item>
        <Item
          ativo={!emBoards && filtros.trash}
          onClick={() => aplicar({ trash: true })}
          contagem={contadores?.trash}
        >
          Lixeira
        </Item>
        <div className="mt-2 flex items-center justify-between px-2">
          <span className="truncate text-xs text-ink-400">{user?.name}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-xs text-ink-400 transition hover:text-ink-200"
          >
            sair
          </button>
        </div>
      </div>
    </nav>
  );
}
