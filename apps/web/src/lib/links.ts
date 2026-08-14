import type { Link, LinkInput, LinkKind, LinkUpdateInput } from "@yu-book/shared";
import { normalizarUrl } from "@yu-book/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

const CHAVE = ["links"] as const;

/**
 * A gaveta inteira em uma consulta.
 *
 * São dezenas de itens (S-04): buscar as duas listas juntas evita uma
 * requisição por aba e deixa a contagem de "ver depois" disponível na
 * navegação sem custo nenhum.
 */
export function useLinks() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () => api.get<Link[]>("/links"),
    staleTime: 60_000,
  });
}

/** Chave do item otimista, que vive só até a API responder (RF-08). */
const ehProvisorio = (id: string) => id.startsWith("provisorio-");

export function useCriarLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: LinkInput) => api.post<Link>("/links", input),

    // RF-08: o item aparece antes de a rede responder — a captura precisa
    // parecer instantânea, ou você volta a deixar a aba aberta.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: CHAVE });
      const anterior = qc.getQueryData<Link[]>(CHAVE) ?? [];

      const normalizada = normalizarUrl(input.url);
      if (!normalizada) return { anterior, provisorio: null };

      const provisorio: Link = {
        id: `provisorio-${crypto.randomUUID()}`,
        url: normalizada.url,
        title: input.title ?? normalizada.domain,
        domain: normalizada.domain,
        kind: (input.kind ?? "depois") as LinkKind,
        position: anterior.length,
        createdAt: new Date().toISOString(),
        semTitulo: !input.title,
      };

      qc.setQueryData<Link[]>(CHAVE, [...anterior, provisorio]);
      return { anterior, provisorio };
    },

    // RF-10: falhou, o item some — e quem chamou mostra a URL para não perdê-la.
    onError: (_erro, _input, contexto) => {
      if (contexto?.anterior) qc.setQueryData(CHAVE, contexto.anterior);
    },

    // RF-09: o provisório dá lugar ao que o servidor gravou, já com o título.
    onSuccess: (link, _input, contexto) => {
      qc.setQueryData<Link[]>(CHAVE, (atual) => {
        const semProvisorio = (atual ?? contexto?.anterior ?? []).filter(
          (l) => !ehProvisorio(l.id),
        );
        // RN-02: URL repetida devolve o item que já existia, não um novo.
        return semProvisorio.some((l) => l.id === link.id)
          ? semProvisorio.map((l) => (l.id === link.id ? link : l))
          : [...semProvisorio, link];
      });
      void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
    },
  });
}

export function useAtualizarLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LinkUpdateInput }) =>
      api.patch<Link>(`/links/${id}`, input),
    onSuccess: (link) => {
      qc.setQueryData<Link[]>(CHAVE, (atual) =>
        (atual ?? []).map((l) => (l.id === link.id ? link : l)),
      );
      // Mudar de lista remexe as posições dos favoritos; o servidor é a fonte.
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
  });
}

export function useExcluirLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/links/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: CHAVE });
      const anterior = qc.getQueryData<Link[]>(CHAVE) ?? [];
      qc.setQueryData<Link[]>(CHAVE, anterior.filter((l) => l.id !== id));
      void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
      return { anterior };
    },
    onError: (_erro, _id, contexto) => {
      if (contexto?.anterior) qc.setQueryData(CHAVE, contexto.anterior);
    },
  });
}

export function useMoverLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) =>
      api.patch<Link[]>(`/links/${id}/move`, { position }),
    // A resposta traz os favoritos já renumerados (RN-03).
    onSuccess: (favoritos) => {
      qc.setQueryData<Link[]>(CHAVE, (atual) => [
        ...favoritos,
        ...(atual ?? []).filter((l) => l.kind !== "favorito"),
      ]);
    },
  });
}

export function useRebuscarTitulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Link>(`/links/${id}/title`),
    onSuccess: (link) => {
      qc.setQueryData<Link[]>(CHAVE, (atual) =>
        (atual ?? []).map((l) => (l.id === link.id ? link : l)),
      );
    },
  });
}

/** Ordena como cada lista deve aparecer: grade manual e fila por chegada. */
export function ordenar(links: Link[], kind: LinkKind): Link[] {
  const lista = links.filter((l) => l.kind === kind);
  return kind === "favorito"
    ? lista.sort((a, b) => a.position - b.position)
    : lista.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
