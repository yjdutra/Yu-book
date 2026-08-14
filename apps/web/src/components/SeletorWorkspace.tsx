import type { Workspace } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import { useAtualizarWorkspace, useCriarWorkspace, useExcluirWorkspace } from "../lib/notas";
import { useWorkspaceAtivo } from "../lib/workspace";

/**
 * RF-09: a confirmação diz exatamente o que se perde junto. Board e card caem
 * por cascata; nota, não.
 */
function textoDeExclusao(w: Workspace): string {
  const kanban =
    w.boardCount > 0
      ? ` Isso exclui ${w.boardCount} board(s) e ${w.cardCount} card(s).`
      : "";
  const notas = w.noteCount > 0 ? ` As ${w.noteCount} nota(s) são mantidas, sem workspace.` : "";
  return `Excluir o workspace "${w.name}"?${kanban}${notas}`;
}

/**
 * Seletor global (RF-01).
 *
 * Ele é o contexto da aplicação, não um filtro da tela de notas: o que for
 * escolhido aqui vale para notas, busca e boards ao mesmo tempo (RF-02).
 */
export function SeletorWorkspace() {
  const { workspaces, ativo, ativoId, definirAtivo } = useWorkspaceAtivo();
  const criar = useCriarWorkspace();
  const atualizar = useAtualizarWorkspace();
  const excluir = useExcluirWorkspace();

  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [novo, setNovo] = useState("");
  const caixaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function fora(e: MouseEvent) {
      if (!caixaRef.current?.contains(e.target as Node)) setAberto(false);
    }
    function escapar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAberto(false);
      botaoRef.current?.focus();
    }

    document.addEventListener("mousedown", fora);
    caixaRef.current?.addEventListener("keydown", escapar);
    const caixa = caixaRef.current;
    return () => {
      document.removeEventListener("mousedown", fora);
      caixa?.removeEventListener("keydown", escapar);
    };
  }, [aberto]);

  function escolher(id: string | null) {
    definirAtivo(id);
    setAberto(false);
    setEditando(null);
  }

  return (
    <div ref={caixaRef} className="relative">
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 rounded border border-ink-700 px-2 py-1.5
                   text-left text-sm text-ink-200 transition hover:border-ink-400"
      >
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: ativo?.color ?? "#64748b" }}
        />
        <span className="truncate">{ativo?.name ?? "Todos os workspaces"}</span>
        <span aria-hidden="true" className="ml-auto text-xs text-ink-400">
          ▾
        </span>
      </button>

      {aberto && (
        <div
          role="menu"
          aria-label="Trocar de workspace"
          className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg
                     border border-ink-700 bg-ink-800 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => escolher(null)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              ativoId === null ? "bg-ink-700 text-titulo" : "text-ink-200 hover:bg-ink-700/50"
            }`}
          >
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-ink-400" />
            Todos os workspaces
            {ativoId === null && <span className="ml-auto text-xs">✓</span>}
          </button>

          <div className="max-h-64 overflow-y-auto border-t border-ink-700">
            {workspaces.map((w) =>
              editando === w.id ? (
                <form
                  key={w.id}
                  className="flex items-center gap-2 px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = rascunho.trim();
                    if (name && name !== w.name) atualizar.mutate({ id: w.id, input: { name } });
                    setEditando(null);
                  }}
                >
                  <input
                    type="color"
                    value={w.color}
                    onChange={(e) => atualizar.mutate({ id: w.id, input: { color: e.target.value } })}
                    aria-label={`Cor do workspace ${w.name}`}
                    className="size-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <input
                    autoFocus
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onBlur={() => setEditando(null)}
                    aria-label={`Novo nome do workspace ${w.name}`}
                    className="min-w-0 flex-1 rounded bg-ink-900 px-2 py-1 text-sm text-ink-200
                               outline-none focus:ring-1 focus:ring-accent-400"
                  />
                </form>
              ) : (
                <div key={w.id} className="group relative flex items-center">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => escolher(w.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-16 text-left
                                text-sm ${
                                  ativoId === w.id
                                    ? "bg-ink-700 text-titulo"
                                    : "text-ink-200 hover:bg-ink-700/50"
                                }`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: w.color }}
                    />
                    <span className="truncate">{w.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-ink-400">
                      {w.noteCount}n · {w.boardCount}b
                    </span>
                  </button>

                  {/* RF-08: renomear, recolorir e excluir sem sair do seletor. */}
                  <span className="absolute right-1 hidden gap-0.5 group-hover:flex group-focus-within:flex">
                    <button
                      type="button"
                      aria-label={`Renomear workspace ${w.name}`}
                      onClick={() => {
                        setEditando(w.id);
                        setRascunho(w.name);
                      }}
                      className="rounded px-1 text-xs text-ink-400 hover:text-ink-200"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir workspace ${w.name}`}
                      onClick={() => {
                        if (!confirm(textoDeExclusao(w))) return;
                        excluir.mutate(w.id);
                        if (ativoId === w.id) definirAtivo(null);
                      }}
                      className="rounded px-1 text-xs text-ink-400 hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ),
            )}
          </div>

          <form
            className="border-t border-ink-700"
            onSubmit={(e) => {
              e.preventDefault();
              const name = novo.trim();
              if (!name) return;
              criar.mutate({ name }, { onSuccess: (w) => definirAtivo(w.id) });
              setNovo("");
              setAberto(false);
            }}
          >
            <input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              placeholder="+ novo workspace"
              aria-label="Nome do novo workspace"
              className="w-full bg-transparent px-3 py-2 text-sm text-ink-200 outline-none
                         placeholder:text-ink-400/60 focus:bg-ink-700/40"
            />
          </form>
        </div>
      )}
    </div>
  );
}
