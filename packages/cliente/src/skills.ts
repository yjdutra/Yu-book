import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SkillItem, SkillUseResult } from "@yu-book/shared";
import { api } from "./api";

/**
 * As skills nos fronts (frente Ritmo, Ritmo 5 — `docs/prd-ritmo.md`, §8).
 * Raiz de cache própria: usar uma skill não mexe em hábito, XP nem ofensiva
 * (RN-31), e não há por que reler o resto.
 */
export const CHAVE_SKILLS = ["skills"] as const;

/** RF-47: as skills ativas com usos e nível. */
export function useSkills() {
  return useQuery({
    queryKey: [...CHAVE_SKILLS, "lista"],
    queryFn: () => api.get<SkillItem[]>("/skills"),
    refetchOnWindowFocus: true,
  });
}

/**
 * RF-49: "Usei agora". A resposta já traz a skill atualizada, e ela entra no
 * cache na hora — o contador sobe sem esperar a releitura.
 */
export function useUsarSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SkillUseResult>(`/skills/${id}/uses`, {}),
    onSuccess: (resultado) => {
      qc.setQueryData<SkillItem[]>([...CHAVE_SKILLS, "lista"], (lista) =>
        lista?.map((s) => (s.id === resultado.skill.id ? resultado.skill : s)),
      );
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: CHAVE_SKILLS }),
  });
}
