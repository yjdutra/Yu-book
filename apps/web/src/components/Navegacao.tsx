import { NOTE_KINDS } from "@yu-book/shared";
import type { NoteKind } from "@yu-book/shared";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import {
  useContadores,
  useCriarWorkspace,
  useExcluirWorkspace,
  useTags,
  useWorkspaces,
} from "../lib/notas";
import type { Filtros } from "../lib/notas";

interface NavegacaoProps {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  onNovaNota: () => void;
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

export function Navegacao({ filtros, onFiltros, onNovaNota }: NavegacaoProps) {
  const { user, logout } = useAuth();
  const { data: contadores } = useContadores();
  const { data: workspaces } = useWorkspaces();
  const { data: tags } = useTags();
  const criarWorkspace = useCriarWorkspace();
  const excluirWorkspace = useExcluirWorkspace();
  const [novoWorkspace, setNovoWorkspace] = useState("");

  const limpo = (extra: Partial<Filtros>): Filtros => ({
    ...filtros,
    kind: null,
    workspaceId: null,
    favorite: false,
    trash: false,
    tags: [],
    ...extra,
  });

  const nenhumFiltro =
    !filtros.kind && !filtros.workspaceId && !filtros.favorite && !filtros.trash &&
    filtros.tags.length === 0;

  return (
    <nav className="flex h-full flex-col p-3">
      <div className="mb-4 flex items-center justify-between px-2">
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

      <Item ativo={nenhumFiltro} onClick={() => onFiltros(limpo({}))} contagem={contadores?.total}>
        Todas as notas
      </Item>
      <Item
        ativo={filtros.favorite}
        onClick={() => onFiltros(limpo({ favorite: true }))}
        contagem={contadores?.favorites}
      >
        Favoritas
      </Item>

      <p className="mt-5 px-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
        Tipos
      </p>
      {NOTE_KINDS.map((tipo: NoteKind) => (
        <Item
          key={tipo}
          ativo={filtros.kind === tipo}
          onClick={() => onFiltros(limpo({ kind: tipo }))}
          contagem={contadores?.byKind[tipo]}
        >
          <span className="capitalize">{tipo}</span>
        </Item>
      ))}

      <p className="mt-5 px-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
        Workspaces
      </p>
      {workspaces?.map((w) => (
        <div key={w.id} className="group relative">
          <Item
            ativo={filtros.workspaceId === w.id}
            onClick={() => onFiltros(limpo({ workspaceId: w.id }))}
            contagem={w.noteCount}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: w.color }}
            />
            <span className="truncate">{w.name}</span>
          </Item>
          <button
            type="button"
            aria-label={`Excluir workspace ${w.name}`}
            onClick={() => {
              if (confirm(`Excluir o workspace "${w.name}"? As notas dele são mantidas.`)) {
                excluirWorkspace.mutate(w.id);
              }
            }}
            className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded px-1 text-xs
                       text-ink-400 hover:text-red-400 group-hover:block
                       focus-visible:block"
          >
            ×
          </button>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const nome = novoWorkspace.trim();
          if (!nome) return;
          criarWorkspace.mutate({ name: nome });
          setNovoWorkspace("");
        }}
      >
        <input
          value={novoWorkspace}
          onChange={(e) => setNovoWorkspace(e.target.value)}
          placeholder="+ novo workspace"
          aria-label="Nome do novo workspace"
          className="mt-1 w-full rounded bg-transparent px-2 py-1.5 text-sm text-ink-200
                     outline-none placeholder:text-ink-400/60 hover:bg-ink-800
                     focus:bg-ink-800"
        />
      </form>

      {tags && tags.length > 0 && (
        <>
          <p className="mt-5 px-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            Tags
          </p>
          <div className="flex flex-wrap gap-1 px-2">
            {tags.map((t) => {
              const ativa = filtros.tags.includes(t.name);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    onFiltros({
                      ...filtros,
                      trash: false,
                      tags: ativa
                        ? filtros.tags.filter((n) => n !== t.name)
                        : [...filtros.tags, t.name],
                    })
                  }
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
        <Item
          ativo={filtros.trash}
          onClick={() => onFiltros(limpo({ trash: true }))}
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
