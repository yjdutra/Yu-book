import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FocusSessionInput, FocusSessionItem, FocusSessionResult } from "@yu-book/shared";
import { api } from "./api";
import { CHAVE_HABITOS } from "./agenda";

/**
 * O foco nos fronts (frente Ritmo, Ritmo 6 — `docs/prd-ritmo.md`, §9). Não se
 * confunde com `foco.ts`, que prende o foco do teclado nos diálogos.
 *
 * As chaves começam por `CHAVE_HABITOS`: o pomodoro numa atividade que pontua
 * grava um registro, e a semana e o XP ficam velhos.
 */

/** RF-57: as sessões de hoje, para o ciclo de 4. */
export function useSessoesDeFoco() {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "foco", "hoje"],
    queryFn: () => api.get<FocusSessionItem[]>("/focus-sessions"),
  });
}

/** RF-56: grava o pomodoro concluído. Idempotente pelo `clientId`. */
export function useGravarFoco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: FocusSessionInput) =>
      api.post<FocusSessionResult>("/focus-sessions", corpo),
    onSettled: () => void qc.invalidateQueries({ queryKey: CHAVE_HABITOS }),
  });
}
