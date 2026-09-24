import type {
  CreateNoteInput,
  NoteCounts,
  NoteDetail,
  NoteKind,
  NoteListResponse,
  NoteSort,
  NoteSummary,
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
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface Filtros {
  q: string;
  kind: NoteKind | null;
  tags: string[];
  /**
   * Vem do workspace ativo (RF-02), não de um filtro da tela. Quem o define é
   * o contexto global — o painel lateral só mexe nos outros campos.
   */
  workspaceId: string | null;
  favorite: boolean;
  /** Só as geradas por IA (Etapa C da frente de IA) — `GET /notes?ai=true`. */
  ai: boolean;
  sort: NoteSort;
  trash: boolean;
}

export const FILTROS_VAZIOS: Filtros = {
  q: "",
  kind: null,
  tags: [],
  workspaceId: null,
  favorite: false,
  ai: false,
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
  if (filtros.ai) p.set("ai", "true");
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

/**
 * Invalida tudo que depende do conjunto de notas.
 *
 * Serve para criar, excluir e restaurar — operações pontuais, em que refazer
 * meia dúzia de consultas é irrelevante. Exportado para o "virar nota" do chat
 * (`chat.ts`), que é criar por outra rota. **Não** serve para o autosave: ali o
 * custo é por pausa de digitação (ver `useAtualizarNota`).
 */
export function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["notes"] });
    void qc.invalidateQueries({ queryKey: ["counts"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    void qc.invalidateQueries({ queryKey: ["tags"] });
    void qc.invalidateQueries({ queryKey: ["titles"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
  };
}

/** O que a lista mostra de uma nota — o detalhe carrega o corpo junto, a lista não. */
function paraResumo(nota: NoteDetail): NoteSummary {
  return {
    id: nota.id,
    title: nota.title,
    kind: nota.kind,
    excerpt: nota.excerpt,
    workspaceId: nota.workspaceId,
    workspaceName: nota.workspaceName,
    tags: nota.tags,
    isFavorite: nota.isFavorite,
    occurredAt: nota.occurredAt,
    updatedAt: nota.updatedAt,
    createdAt: nota.createdAt,
    deletedAt: nota.deletedAt,
    // Sem copiar a marca, o autosave a apagaria da lista na primeira pausa; e é
    // a resposta do PATCH que traz o `revisedAt` novo, sem refetch.
    ai: nota.ai,
  };
}

/**
 * Costura a nota salva nas listas que já estão em cache, em vez de invalidá-las.
 *
 * A resposta do PATCH já traz o resumo recalculado pelo servidor — refazer
 * `GET /notes` para descobrir o que acabamos de receber é uma requisição paga
 * a cada pausa de digitação.
 */
function costurarNasListas(qc: QueryClient, nota: NoteDetail): void {
  qc.setQueriesData<InfiniteData<NoteListResponse>>({ queryKey: ["notes"] }, (dados) => {
    if (!dados) return dados;

    let mudou = false;
    const pages = dados.pages.map((pagina) => {
      if (!pagina.items.some((i) => i.id === nota.id)) return pagina;
      mudou = true;
      return {
        ...pagina,
        items: pagina.items.map((i) => (i.id === nota.id ? paraResumo(nota) : i)),
      };
    });

    return mudou ? { ...dados, pages } : dados;
  });
}

const mesmasTags = (a: NoteDetail["tags"], b: NoteDetail["tags"]) =>
  a.length === b.length && a.every((t, i) => t.id === b[i]?.id);

export function useCriarNota() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api.post<NoteDetail>("/notes", input),
    onSuccess: invalidar,
  });
}

/**
 * O caminho do autosave — o mais percorrido da aplicação.
 *
 * O que invalidar é decidido comparando o estado anterior com o que voltou do
 * servidor, não pelo que foi enviado: salvar só o corpo (o caso comum, a cada
 * 800 ms de pausa) não derruba lista, contadores, tags nem títulos. Antes, uma
 * pausa de digitação custava 6 requisições; agora custa 1.
 */
export function useAtualizarNota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNoteInput }) =>
      api.patch<NoteDetail>(`/notes/${id}`, input),
    onSuccess: (nota) => {
      const anterior = qc.getQueryData<NoteDetail>(["note", nota.id]);
      qc.setQueryData(["note", nota.id], nota);
      costurarNasListas(qc, nota);

      // Sem estado anterior não dá para saber o que mudou: cai no caminho caro.
      if (!anterior) {
        void qc.invalidateQueries({ queryKey: ["notes"] });
        void qc.invalidateQueries({ queryKey: ["counts"] });
        void qc.invalidateQueries({ queryKey: ["titles"] });
        return;
      }

      if (anterior.title !== nota.title) {
        void qc.invalidateQueries({ queryKey: ["titles"] });
        // RN-03: renomear reescreve [[...]] em outras notas — o cache delas
        // ficou velho, e a ordenação e os trechos da lista também.
        void qc.invalidateQueries({ queryKey: ["note"] });
        void qc.invalidateQueries({ queryKey: ["notes"] });
      }

      if (!mesmasTags(anterior.tags, nota.tags)) {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }

      if (
        anterior.kind !== nota.kind ||
        anterior.workspaceId !== nota.workspaceId ||
        anterior.isFavorite !== nota.isFavorite
      ) {
        void qc.invalidateQueries({ queryKey: ["counts"] });
        void qc.invalidateQueries({ queryKey: ["notes"] });
      }

      // A paleta e a home releem ao abrir; marcar como velhas não custa rede.
      void qc.invalidateQueries({ queryKey: ["search"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
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
