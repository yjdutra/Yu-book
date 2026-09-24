import { useQueries } from "@tanstack/react-query";
import { FERRAMENTAS_DO_ACERVO, MAX_PASSOS_DO_LACO } from "@yu-book/shared";
import type { AgentDetail, AgentPreview, AgentPreviewInput } from "@yu-book/shared";
import { chaveDoAgente } from "../../lib/agentes";
import { api } from "../../lib/api";
import { emDolares } from "../ajustes/comum";
import { IconeAlerta } from "../Icones";
import type { PassoRascunho } from "./rascunho";

/**
 * O contexto que o agente recebe num passo de rotina: o dele, com só as
 * ferramentas de leitura — as de escrita não vão ao provedor na rotina, e o
 * catálogo delas também custa.
 */
function entradaDaPrevia(a: AgentDetail): AgentPreviewInput {
  return {
    name: a.name,
    description: a.description,
    color: a.color,
    instructionsMd: a.instructionsMd,
    modelId: a.modelId,
    tools: a.tools.filter((t) => !FERRAMENTAS_DO_ACERVO[t].escrita),
    baseNoteIds: a.baseNotes.map((n) => n.id),
    liveSources: a.liveSources
      .filter((f) => f.columnName !== null)
      .map((f) => ({
        tipo: "coluna" as const,
        boardId: f.boardId,
        columnId: f.columnId,
        limite: f.limite,
        detalhe: f.detalhe,
      })),
  };
}

/**
 * A estimativa de custo por execução: a prévia de contexto de cada agente
 * (`POST /ai/agents/preview`, a mesma do editor de agentes) vezes os passos
 * que o usam. É o piso — uma chamada por passo; cada consulta ao acervo é mais
 * uma, até `MAX_PASSOS_DO_LACO` por passo. Por isso o texto diz "a partir de".
 *
 * As consultas moram no cache pela própria entrada, como no editor de agentes:
 * reordenar passos não refaz nada, e trocar o agente de um passo pede só a
 * prévia dele.
 */
export function Estimativa({
  passos,
  tetoMicros,
}: {
  passos: PassoRascunho[];
  tetoMicros: number;
}) {
  const ids = [...new Set(passos.flatMap((p) => (p.agentId ? [p.agentId] : [])))];

  const detalhes = useQueries({
    queries: ids.map((id) => ({
      queryKey: chaveDoAgente(id),
      queryFn: () => api.get<AgentDetail>(`/ai/agents/${id}`),
    })),
  });

  const entradas = detalhes.map((d) => (d.data ? entradaDaPrevia(d.data) : null));
  const previas = useQueries({
    queries: entradas.map((e) => ({
      queryKey: ["ia", "agente-previa", JSON.stringify(e)],
      queryFn: () => api.post<AgentPreview>("/ai/agents/preview", e),
      enabled: e !== null,
      staleTime: 15_000,
      retry: false,
    })),
  });

  const porAgente = new Map<string, AgentPreview | undefined>(
    ids.map((id, i) => [id, previas[i]?.data]),
  );
  const carregando =
    detalhes.some((d) => d.isLoading) || previas.some((p, i) => entradas[i] && p.isLoading);

  let piso = 0;
  const semEstimativa: string[] = [];
  let semAgente = 0;
  for (const p of passos) {
    if (!p.agentId) {
      semAgente += 1;
      continue;
    }
    const previa = porAgente.get(p.agentId);
    if (previa?.costPerStepMicros != null) piso += previa.costPerStepMicros;
    else if (previa) semEstimativa.push(p.agentName);
  }
  const estoura = piso > tetoMicros && tetoMicros > 0;

  return (
    // Largura fixa: numa coluna `auto`, o texto longo esticaria a caixa até
    // caber numa linha e espremeria a identidade ao lado.
    <div className="w-80 rounded-cartao border border-ink-800 bg-superficie px-4 py-3 shadow-e1">
      <p className="rotulo">Custo estimado por execução</p>
      {carregando ? (
        <div
          aria-hidden="true"
          className="mt-1.5 h-6 w-28 animate-pulse rounded-etiqueta bg-ink-800"
        />
      ) : (
        // Só o número é anunciado quando muda — a explicação abaixo não.
        <p aria-live="polite" className="mt-1 flex items-baseline gap-1.5">
          <span className="text-miudo text-ink-400">a partir de</span>
          <span className="text-lg font-semibold tabular-nums text-titulo">
            {emDolares(piso)}
          </span>
        </p>
      )}
      <p className="mt-0.5 text-miudo text-ink-400">
        Uma chamada por passo, com o contexto de cada agente e a saída máxima. Consultar o acervo
        soma chamadas — até {MAX_PASSOS_DO_LACO} por passo. Teto: {emDolares(tetoMicros)}.
      </p>
      {semAgente > 0 && (
        <p className="mt-1 text-miudo text-ink-400">
          {semAgente === 1 ? "Um passo" : `${semAgente} passos`} sem agente, fora da conta.
        </p>
      )}
      {semEstimativa.length > 0 && (
        <p className="mt-1 flex items-start gap-1 text-miudo text-amber-300">
          <IconeAlerta className="mt-px size-3" />
          Sem estimativa para {semEstimativa.map((n) => `«${n}»`).join(", ")}: o agente está sem
          modelo utilizável.
        </p>
      )}
      {estoura && !carregando && (
        <p className="mt-1 flex items-start gap-1 text-miudo text-amber-300">
          <IconeAlerta className="mt-px size-3" />
          Já o piso passa do teto por execução: ela vai parar no meio. Suba o teto na Saída.
        </p>
      )}
    </div>
  );
}
