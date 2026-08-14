import type { Workspace } from "@yu-book/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspaces } from "./notas";

/** RF-04: o contexto sobrevive a recarregar a página. */
const CHAVE = "yb:workspace";

interface WorkspaceContexto {
  workspaces: Workspace[];
  /** null = "Todos os workspaces" (RF-03). */
  ativoId: string | null;
  ativo: Workspace | null;
  definirAtivo: (id: string | null) => void;
  carregando: boolean;
}

const Contexto = createContext<WorkspaceContexto | null>(null);

/**
 * Workspace ativo — o contexto da aplicação inteira (RF-01, RF-02).
 *
 * Não é um filtro de tela: notas, busca e boards leem daqui, então trocar de
 * workspace troca tudo de uma vez.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: workspaces, isLoading } = useWorkspaces();
  const [ativoId, setAtivoId] = useState<string | null>(() => localStorage.getItem(CHAVE));

  const definirAtivo = useCallback((id: string | null) => {
    setAtivoId(id);
    if (id) localStorage.setItem(CHAVE, id);
    else localStorage.removeItem(CHAVE);
  }, []);

  // RF-04: workspace salvo que não existe mais (excluído em outra aba, por
  // exemplo) volta para "todos" em vez de filtrar por um id fantasma.
  useEffect(() => {
    if (!workspaces || !ativoId) return;
    if (!workspaces.some((w) => w.id === ativoId)) definirAtivo(null);
  }, [workspaces, ativoId, definirAtivo]);

  const valor = useMemo<WorkspaceContexto>(() => {
    const lista = workspaces ?? [];
    const ativo = lista.find((w) => w.id === ativoId) ?? null;
    return {
      workspaces: lista,
      // Enquanto a lista não chegou, não filtramos por um id ainda não validado.
      ativoId: ativo?.id ?? null,
      ativo,
      definirAtivo,
      carregando: isLoading,
    };
  }, [workspaces, ativoId, definirAtivo, isLoading]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useWorkspaceAtivo(): WorkspaceContexto {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useWorkspaceAtivo fora do WorkspaceProvider");
  return ctx;
}
