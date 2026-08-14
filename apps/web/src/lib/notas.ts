import type {
  CreateNoteInput,
  NoteCounts,
  NoteDetail,
  NoteKind,
  NoteListResponse,
  NoteSort,
  SearchResponse,
  Tag,
  UpdateNoteInput,
  Workspace,
  WorkspaceInput,
} from "@yu-book/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";

export interface Filtros {
  q: string;
  kind: NoteKind | null;
  tags: string[];
  /**
   * Vem do workspace ativo (RF-02), não de um filtro da tela. Quem o define é
   * o contexto global — a barra lateral só mexe nos outros campos.
   */
  workspaceId: string | null;
  favorite: boolean;
  sort: NoteSort;
  trash: boolean;
}

export const FILTROS_VAZIOS: Filtros = {
  q: "",
  kind: null,
  tags: [],
  workspaceId: null,
  favorite: false,
  sort: "updatedAt",
  trash: false,
};

function queryString(filtros: Filtros, cursor?: string): string {
  const p = new URLSearchParams();
  if (filtros.q) p.set("q", filtros.q);
  if (filtros.kind) p.set("kind", filtros.kind);
  if (filtros.tags.length) p.set("tags", filtros.tags.join(","));
  if (filtros.workspaceId) p.set("workspaceId", filtros.workspaceId);
  if (filtros.favorite) p.set("favorite", "true");
  if (filtros.trash) p.set("trash", "true");
  p.set("sort", filtros.sort);
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

export function useNotas(filtros: Filtros) {
  return useInfiniteQuery({
    queryKey: ["notes", filtros],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<NoteListResponse>(`/notes?${queryString(filtros, pageParam)}`),
    getNextPageParam: (ultima) => ultima.nextCursor ?? undefined,
  });
}

export function useNota(id: string | null) {
  return useQuery({
    queryKey: ["note", id],
    queryFn: () => api.get<NoteDetail>(`/notes/${id}`),
    enabled: Boolean(id),
  });
}

export function useContadores(workspaceId: string | null) {
  return useQuery({
    queryKey: ["counts", workspaceId],
    queryFn: () =>
      api.get<NoteCounts>(`/notes/counts${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
  });
}

export function useWorkspaces() {
  return useQuery({ queryKey: ["workspaces"], queryFn: () => api.get<Workspace[]>("/workspaces") });
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
}

/** RF-02: a paleta busca dentro do workspace ativo, quando há um. */
export function useBusca(termo: string, ativo: boolean, workspaceId: string | null) {
  return useQuery({
    queryKey: ["search", termo, workspaceId],
    queryFn: () =>
      api.get<SearchResponse>(
        `/search?q=${encodeURIComponent(termo)}${workspaceId ? `&workspaceId=${workspaceId}` : ""}`,
      ),
    enabled: ativo,
    // A paleta reconsulta a cada tecla; sem isso, voltar uma letra refaz a rede.
    staleTime: 15_000,
  });
}

/** Invalida tudo que depende do conjunto de notas. */
function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["notes"] });
    void qc.invalidateQueries({ queryKey: ["counts"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    void qc.invalidateQueries({ queryKey: ["tags"] });
    void qc.invalidateQueries({ queryKey: ["titles"] });
  };
}

export function useCriarNota() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api.post<NoteDetail>("/notes", input),
    onSuccess: invalidar,
  });
}

export function useAtualizarNota() {
  const qc = useQueryClient();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNoteInput }) =>
      api.patch<NoteDetail>(`/notes/${id}`, input),
    onSuccess: (nota) => {
      qc.setQueryData(["note", nota.id], nota);
      invalidar();
      // Renomear reescreve [[...]] em outras notas (RN-03): o cache delas
      // ficou velho e precisa cair inteiro.
      void qc.invalidateQueries({ queryKey: ["note"] });
    },
  });
}

export function useExcluirNota() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/notes/${id}`),
    onSuccess: invalidar,
  });
}

export function useRestaurarNota() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.post<NoteDetail>(`/notes/${id}/restore`),
    onSuccess: invalidar,
  });
}

export function useExcluirDefinitivo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/notes/${id}/permanent`),
    onSuccess: invalidar,
  });
}

export function useCriarWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceInput) => api.post<Workspace>("/workspaces", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useAtualizarWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<WorkspaceInput> }) =>
      api.patch<Workspace>(`/workspaces/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

export function useExcluirWorkspace() {
  const qc = useQueryClient();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/workspaces/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      invalidar();
    },
  });
}

export interface TituloSugerido {
  id: string;
  title: string;
  kind: NoteKind;
}

/**
 * Todos os títulos ativos, carregados uma vez e cacheados.
 *
 * Alimenta o autocomplete de `[[` (filtragem local, sem rede por tecla) e a
 * marcação de links quebrados no preview.
 */
export function useTitulos() {
  return useQuery({
    queryKey: ["titles"],
    queryFn: () => api.get<TituloSugerido[]>("/notes/titles"),
    staleTime: 10_000,
  });
}
