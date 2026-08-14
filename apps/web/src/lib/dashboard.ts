import type { Dashboard } from "@yu-book/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** RF-04: a tela inicial inteira em uma requisição. */
export function useDashboard(workspaceId: string | null) {
  return useQuery({
    queryKey: ["dashboard", workspaceId],
    queryFn: () =>
      api.get<Dashboard>(`/dashboard${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
    // Prazo vencido não muda de minuto a minuto; revalidar ao voltar basta.
    staleTime: 60_000,
  });
}
