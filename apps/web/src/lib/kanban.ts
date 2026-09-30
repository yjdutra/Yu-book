import type {
  BoardDetail,
  BoardInput,
  BoardSummary,
  CardDetail,
  CardInput,
  CardSummary,
  CardUpdateInput,
  ColumnInput,
} from "@yu-book/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

export const chaveBoard = (id: string) => ["board", id] as const;

export function useBoards(workspaceId: string | null) {
  return useQuery({
    queryKey: ["boards", workspaceId],
    queryFn: () =>
      api.get<BoardSummary[]>(`/boards${workspaceId ? `?workspaceId=${workspaceId}` : ""}`),
  });
}

export function useBoard(id: string | null) {
  return useQuery({
    queryKey: ["board", id],
    queryFn: () => api.get<BoardDetail>(`/boards/${id}`),
    enabled: Boolean(id),
  });
}

export function useArquivados(boardId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ["arquivados", boardId],
    queryFn: () => api.get<CardSummary[]>(`/boards/${boardId}/archived`),
    enabled: Boolean(boardId) && ativo,
  });
}

export function useCard(id: string | null) {
  return useQuery({
    queryKey: ["card", id],
    queryFn: () => api.get<CardDetail>(`/cards/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * O card pelo id, fora de um componente — pela mesma chave de `useCard`, então
 * o painel que abrir em seguida já o encontra em cache.
 *
 * Existe para o que conhece o card e não o quadro: o que o chat criou chega só
 * com o id, e card não tem rota sem o quadro (`/b/:boardId/c/:cardId`).
 */
export function carregarCard(qc: QueryClient, id: string): Promise<CardDetail> {
  return qc.fetchQuery({
    queryKey: ["card", id],
    queryFn: () => api.get<CardDetail>(`/cards/${id}`),
  });
}

/**
 * Invalida o que depende do conteúdo de um board.
 *
 * `workspaces` entra porque a contagem de cards por workspace alimenta a
 * confirmação de exclusão (RF-09), e `search` porque cards aparecem na
 * paleta (RF-41).
 */
function useInvalidarKanban() {
  const qc = useQueryClient();
  return (boardId?: string) => {
    if (boardId) void qc.invalidateQueries({ queryKey: chaveBoard(boardId) });
    void qc.invalidateQueries({ queryKey: ["boards"] });
    void qc.invalidateQueries({ queryKey: ["workspaces"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    void qc.invalidateQueries({ queryKey: ["arquivados"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
  };
}

export function useCriarBoard() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: (input: BoardInput) => api.post<BoardDetail>("/boards", input),
    onSuccess: (board) => invalidar(board.id),
  });
}

export function useAtualizarBoard() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<BoardDetail>(`/boards/${id}`, { name }),
    onSuccess: (board) => invalidar(board.id),
  });
}

export function useExcluirBoard() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/boards/${id}`),
    onSuccess: () => invalidar(),
  });
}

export function useCriarColuna() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: (input: ColumnInput) => api.post<BoardDetail>("/columns", input),
    onSuccess: (board) => invalidar(board.id),
  });
}

export function useAtualizarColuna() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; wipLimit?: number | null }) =>
      api.patch<BoardDetail>(`/columns/${id}`, input),
    onSuccess: (board) => invalidar(board.id),
  });
}

export function useMoverColuna() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) =>
      api.patch<BoardDetail>(`/columns/${id}/move`, { position }),
    onSuccess: (board) => invalidar(board.id),
  });
}

/** RF-16: `moveCardsTo` move os cards; `deleteCards` os exclui junto. */
export function useExcluirColuna() {
  const invalidar = useInvalidarKanban();
  return useMutation({
    mutationFn: ({ id, moveCardsTo, deleteCards }: {
      id: string;
      moveCardsTo?: string;
      deleteCards?: boolean;
    }) => {
      const p = new URLSearchParams();
      if (moveCardsTo) p.set("moveCardsTo", moveCardsTo);
      if (deleteCards) p.set("deleteCards", "true");
      const query = p.toString();
      return api.delete<BoardDetail>(`/columns/${id}${query ? `?${query}` : ""}`);
    },
    onSuccess: (board) => invalidar(board.id),
  });
}

/** Cards mexem no vínculo com nota (RF-38), então a nota também sai do cache. */
function useInvalidarCard() {
  const qc = useQueryClient();
  const invalidar = useInvalidarKanban();
  return (boardId?: string) => {
    invalidar(boardId);
    void qc.invalidateQueries({ queryKey: ["note"] });
  };
}

export function useCriarCard() {
  const invalidar = useInvalidarCard();
  return useMutation({
    mutationFn: (input: CardInput) => api.post<CardDetail>("/cards", input),
    onSuccess: (card) => invalidar(card.boardId),
  });
}

/** A face do card dentro do board, recalculada a partir do detalhe salvo. */
function paraFace(card: CardDetail): CardSummary {
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    position: card.position,
    dueDate: card.dueDate,
    priority: card.priority,
    checklistDone: card.checklistDone,
    checklistTotal: card.checklistTotal,
    tags: card.tags,
    note: card.note,
    updatedAt: card.updatedAt,
    // A face mostra "IA"; sem copiar, salvar o card a apagaria do quadro.
    ai: card.ai,
    completedAt: card.completedAt,
    aiCompletion: card.aiCompletion,
    fileCount: card.fileCount,
  };
}

/** Costura o card no board em cache, em vez de refazer `GET /boards/:id`. */
function costurarNoBoard(qc: QueryClient, card: CardDetail): void {
  qc.setQueryData<BoardDetail>(chaveBoard(card.boardId), (board) => {
    if (!board) return board;
    if (!board.columns.some((c) => c.cards.some((x) => x.id === card.id))) return board;

    return {
      ...board,
      columns: board.columns.map((coluna) => ({
        ...coluna,
        cards: coluna.cards.map((x) => (x.id === card.id ? paraFace(card) : x)),
      })),
    };
  });
}

/**
 * Mesma lógica do autosave da nota: a descrição do card salva a cada pausa de
 * digitação, então o caminho comum não pode arrastar board, workspaces e busca
 * junto. Só o que mudou de fato é invalidado.
 */
export function useAtualizarCard() {
  const qc = useQueryClient();
  const invalidar = useInvalidarCard();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CardUpdateInput }) =>
      api.patch<CardDetail>(`/cards/${id}`, input),
    onSuccess: (card) => {
      const anterior = qc.getQueryData<CardDetail>(["card", card.id]);
      qc.setQueryData(["card", card.id], card);

      if (!anterior) {
        invalidar(card.boardId);
        return;
      }

      // Arquivar tira o card do board e mexe nas contagens: aí sim, refetch.
      if (anterior.archived !== card.archived) {
        invalidar(card.boardId);
        return;
      }

      costurarNoBoard(qc, card);

      // Card concluído sai dos prazos da home (frente de cards, Parte 1).
      if (anterior.completedAt !== card.completedAt) {
        void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
      }
      // O vínculo aparece do lado da nota também (RF-38).
      if (anterior.note?.id !== card.note?.id) {
        void qc.invalidateQueries({ queryKey: ["note"] });
      }
      if (anterior.title !== card.title) {
        void qc.invalidateQueries({ queryKey: ["search"], refetchType: "none" });
      }
    },
  });
}

/**
 * O check da face do card (frente de cards, Parte 1). Otimista como o arraste:
 * o clique é o gesto inteiro, e esperar a volta do servidor para esmaecer o
 * card faria o botão parecer quebrado. A data provisória some quando a
 * resposta costura a de verdade.
 */
export function useConcluirCard(boardId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.patch<CardDetail>(`/cards/${id}`, { completed }),

    onMutate: async ({ id, completed }) => {
      await qc.cancelQueries({ queryKey: chaveBoard(boardId) });
      const anterior = qc.getQueryData<BoardDetail>(chaveBoard(boardId));
      if (anterior) {
        const completedAt = completed ? new Date().toISOString() : null;
        qc.setQueryData<BoardDetail>(chaveBoard(boardId), {
          ...anterior,
          columns: anterior.columns.map((coluna) => ({
            ...coluna,
            cards: coluna.cards.map((c) =>
              c.id === id ? { ...c, completedAt, aiCompletion: null } : c,
            ),
          })),
        });
      }
      return { anterior };
    },

    onError: (_erro, _variaveis, contexto) => {
      if (contexto?.anterior) qc.setQueryData(chaveBoard(boardId), contexto.anterior);
    },

    onSuccess: (card) => {
      qc.setQueryData(["card", card.id], card);
      costurarNoBoard(qc, card);
      void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
    },
  });
}

export function useExcluirCard() {
  const invalidar = useInvalidarCard();
  return useMutation({
    mutationFn: ({ id }: { id: string; boardId: string }) => api.delete<void>(`/cards/${id}`),
    onSuccess: (_dados, { boardId }) => invalidar(boardId),
  });
}

/**
 * Reordena o board em memória — a mesma conta que a API faz (RN-01, RN-02).
 *
 * É o que sustenta o movimento otimista: a interface já mostra o resultado
 * final enquanto a requisição está no ar (RNF-11).
 */
export function moverNoBoard(
  board: BoardDetail,
  cardId: string,
  columnId: string,
  position: number,
): BoardDetail {
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
  if (!card) return board;

  const semCard = board.columns.map((coluna) => ({
    ...coluna,
    cards: coluna.cards.filter((c) => c.id !== cardId),
  }));

  return {
    ...board,
    columns: semCard.map((coluna) => {
      if (coluna.id !== columnId) {
        return { ...coluna, cards: coluna.cards.map((c, i) => ({ ...c, position: i })) };
      }
      const cards = [...coluna.cards];
      cards.splice(Math.min(Math.max(position, 0), cards.length), 0, { ...card, columnId });
      return { ...coluna, cards: cards.map((c, i) => ({ ...c, position: i })) };
    }),
  };
}

export function useMoverCard(boardId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, columnId, position }: { id: string; columnId: string; position: number }) =>
      api.patch<CardDetail>(`/cards/${id}/move`, { columnId, position }),

    onMutate: async ({ id, columnId, position }) => {
      await qc.cancelQueries({ queryKey: chaveBoard(boardId) });
      const anterior = qc.getQueryData<BoardDetail>(chaveBoard(boardId));
      if (anterior) {
        qc.setQueryData(chaveBoard(boardId), moverNoBoard(anterior, id, columnId, position));
      }
      return { anterior };
    },

    // RNF-20: falhou, o card volta para onde estava — sem recarregar o board.
    onError: (_erro, _variaveis, contexto) => {
      if (contexto?.anterior) qc.setQueryData(chaveBoard(boardId), contexto.anterior);
    },

    // Só o board e a home: mover card não muda contagem de workspace nem busca.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveBoard(boardId) });
      void qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
    },
  });
}
