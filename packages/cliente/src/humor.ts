import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoodDayItem, MoodInput, MoodsInsights } from "@yu-book/shared";
import { api } from "./api";
import { CHAVE_HABITOS } from "./agenda";

/**
 * O humor nos fronts (frente Ritmo, Ritmo 4 — `docs/prd-ritmo.md`, §7). As
 * chaves começam por `CHAVE_HABITOS`: gravar humor muda a ofensiva geral
 * (RF-43), e uma invalidação do prefixo alcança as duas.
 */

/** RF-41: os dias com humor de `de` a `ate`. */
export function useHumor(de: string | null, ate: string | null) {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "humor", de, ate],
    queryFn: () => api.get<MoodDayItem[]>(`/moods?from=${de}&to=${ate}`),
    enabled: Boolean(de && ate),
    refetchOnWindowFocus: true,
  });
}

/** RF-42: os cartões "O que anda junto". */
export function useCruzamentoDoHumor() {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "humor", "cruzamento"],
    queryFn: () => api.get<MoodsInsights>("/moods/insights"),
  });
}

/// `origin` fica de fora: a marca de IA é do MCP, nunca da tela.
export type NovoHumor = Omit<MoodInput, "origin">;

/** RF-40: grava (mescla) o humor de um dia. */
export function useGravarHumor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovoHumor) => api.put<MoodDayItem | null>("/moods", corpo),
    onSettled: () => void qc.invalidateQueries({ queryKey: CHAVE_HABITOS }),
  });
}
