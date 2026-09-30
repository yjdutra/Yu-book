import type { CardFilesResponse, CardFileWithUrl } from "@yu-book/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { chaveBoard } from "./kanban";

/**
 * Anexos do card (frente de cards, Parte 2).
 *
 * A chave mora **sob** `["card", id]`: invalidar o card leva os anexos junto.
 * As URLs vêm assinadas por uma hora, e a lista vale 30 minutos — abaixo da
 * validade, para uma miniatura nunca apontar para uma assinatura vencida.
 */
export const chaveArquivos = (cardId: string) => ["card", cardId, "files"] as const;

const MEIA_HORA = 30 * 60 * 1000;

export function useArquivosDoCard(cardId: string) {
  return useQuery({
    queryKey: chaveArquivos(cardId),
    queryFn: () => api.get<CardFilesResponse>(`/cards/${cardId}/files`),
    staleTime: MEIA_HORA,
    refetchInterval: MEIA_HORA,
  });
}

/**
 * Subir ou apagar anexo é raro: aqui não há cirurgia de cache (INV-23), e o
 * card e o quadro vão inteiros — o detalhe lista os anexos e a face os conta.
 */
function invalidar(qc: QueryClient, cardId: string, boardId: string): void {
  void qc.invalidateQueries({ queryKey: ["card", cardId] });
  void qc.invalidateQueries({ queryKey: chaveBoard(boardId) });
}

export function useEnviarArquivo(cardId: string, boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arquivo: File) => {
      const form = new FormData();
      form.append("file", arquivo, arquivo.name);
      return api.upload<CardFileWithUrl>(`/cards/${cardId}/files`, form);
    },
    onSuccess: () => invalidar(qc, cardId, boardId),
  });
}

export function useExcluirArquivo(cardId: string, boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => api.delete<void>(`/cards/${cardId}/files/${fileId}`),
    onSuccess: () => invalidar(qc, cardId, boardId),
  });
}
