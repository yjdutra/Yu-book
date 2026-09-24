import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type {
  AgentDetail,
  AgentInput,
  AgentPreview,
  AgentPreviewInput,
  AgentSummary,
  AgentUpdateInput,
} from "@yu-book/shared";
import { useEffect, useState } from "react";
import { api, apiStream } from "./api";
import { CHAVE_CONVERSAS } from "./chat";

/**
 * Agentes especialistas (Etapa D da frente de IA).
 *
 * Só `import type` de `@yu-book/shared`: o painel contextual lê a lista daqui,
 * e ele está no bundle inicial. Importar valor de `agentes.ts` traria os
 * schemas e o metadado das ferramentas para a primeira pintura.
 */

export const CHAVE_AGENTES = ["ia", "agentes"] as const;
export const chaveDoAgente = (id: string) => ["ia", "agente", id] as const;

export function useAgentes() {
  return useQuery({
    queryKey: CHAVE_AGENTES,
    queryFn: () => api.get<AgentSummary[]>("/ai/agents"),
    staleTime: 30_000,
  });
}

export function useAgente(id: string | null) {
  return useQuery({
    queryKey: chaveDoAgente(id ?? ""),
    queryFn: () => api.get<AgentDetail>(`/ai/agents/${id}`),
    enabled: Boolean(id),
  });
}

/** O resumo que a lista mostra, tirado do detalhe que o servidor devolveu. */
function paraResumo(a: AgentDetail): AgentSummary {
  const {
    instructionsMd: _instrucoes,
    tools: _ferramentas,
    baseNotes: _notas,
    liveSources: _fontes,
    ...resumo
  } = a;
  return resumo;
}

/**
 * Criar e editar devolvem o detalhe inteiro: costura no cache do detalhe e na
 * lista, em vez de refazer as duas consultas para descobrir o que acabou de
 * voltar.
 */
function useCosturar() {
  const qc = useQueryClient();
  return (agente: AgentDetail) => {
    qc.setQueryData(chaveDoAgente(agente.id), agente);
    qc.setQueryData<AgentSummary[]>(CHAVE_AGENTES, (lista) => {
      if (!lista) return lista;
      const resumo = paraResumo(agente);
      const existe = lista.some((a) => a.id === agente.id);
      const nova = existe
        ? lista.map((a) => (a.id === agente.id ? resumo : a))
        : [...lista, resumo];
      return nova.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    });
    // A lista do servidor é a ordem de verdade; marcar como obsoleta basta.
    void qc.invalidateQueries({ queryKey: CHAVE_AGENTES, refetchType: "none" });
  };
}

export function useCriarAgente() {
  const costurar = useCosturar();
  return useMutation({
    mutationFn: (input: AgentInput) => api.post<AgentDetail>("/ai/agents", input),
    onSuccess: costurar,
  });
}

export function useAtualizarAgente() {
  const costurar = useCosturar();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AgentUpdateInput }) =>
      api.patch<AgentDetail>(`/ai/agents/${id}`, patch),
    onSuccess: (agente) => {
      costurar(agente);
      // Nome e cor aparecem nas conversas dele.
      void qc.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void qc.invalidateQueries({ queryKey: ["ia", "conversa"] });
    },
  });
}

export function useExcluirAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ai/agents/${id}`),
    onSuccess: (_vazio, id) => {
      qc.setQueryData<AgentSummary[]>(CHAVE_AGENTES, (lista) =>
        lista?.filter((a) => a.id !== id),
      );
      qc.removeQueries({ queryKey: chaveDoAgente(id) });
      // As conversas do agente continuam, com o `id` dele nulo: a lista e a
      // conversa aberta precisam saber, ou o compositor aceitaria uma mensagem
      // que o servidor recusa.
      void qc.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void qc.invalidateQueries({ queryKey: ["ia", "conversa"] });
    },
  });
}

/**
 * O valor com espera: só muda depois de `ms` sem mudar. É o que segura a
 * prévia do editor — cada tecla nas instruções não pode virar uma requisição.
 */
export function useComEspera<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const timer = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(timer);
  }, [valor, ms]);
  return atrasado;
}

/**
 * `POST /ai/agents/preview`: o que o agente receberia, sem gravar nada. É
 * consulta, não mutação — a mesma entrada dá a mesma resposta —, então mora
 * no cache pela própria entrada, e voltar a um rascunho já visto não refaz a
 * requisição. `keepPreviousData` segura a prévia anterior na tela enquanto a
 * nova vem, sem o esqueleto piscar a cada pausa de digitação.
 */
export function usePreviaDoAgente(rascunho: AgentPreviewInput, ativo: boolean) {
  const chave = JSON.stringify(rascunho);
  return useQuery({
    queryKey: ["ia", "agente-previa", chave],
    queryFn: () => api.post<AgentPreview>("/ai/agents/preview", rascunho),
    enabled: ativo,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

/** O nome do arquivo quando o cabeçalho não chega — ver `baixarAgente`. */
function nomeDeArquivo(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "agente"}.md`;
}

/**
 * Exportar em Markdown. A rota pede o token, que vive em memória (e não em
 * cookie): um `<a href>` direto chegaria sem ele. Por isso o arquivo vem por
 * `fetch` autenticado — `apiStream`, que devolve a resposta sem consumir o
 * corpo e renova a sessão num 401 — e vira um `Blob` baixado por um link
 * temporário.
 *
 * O nome vem do `content-disposition` quando o navegador o deixa ler; entre
 * origens diferentes ele só é legível se a API o expuser no CORS, e sem isso
 * cai no nome do agente.
 */
export async function baixarAgente(id: string, nome: string): Promise<void> {
  const resposta = await apiStream(`/ai/agents/${id}/export`);
  const disposicao = resposta.headers.get("content-disposition") ?? "";
  const doCabecalho = /filename="?([^";]+)"?/i.exec(disposicao)?.[1];
  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = doCabecalho ?? nomeDeArquivo(nome);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar na hora pode cancelar o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
