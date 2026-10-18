import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  descreverDias,
  diasDasSiglas,
  FERRAMENTAS_DO_ACERVO,
  formatarEvento,
  formatarTarefa,
} from "@yu-book/shared";
import type { EscopoDoEvento, EventItem, SiglaDoDia, TaskItem } from "@yu-book/shared";
import { api, ErroDaApi } from "../cliente.js";
import { comErroDeEscrita } from "../erros.js";
import { relatar } from "../notificacoes.js";

/**
 * O controle da agenda: editar, excluir e converter evento e tarefa. As
 * criações e a conclusão continuam em `agenda-escrita.ts`; estas mexem no que
 * **já existe**, e por isso moram à parte — risco diferente, e duas delas
 * apagam sem desfazer.
 *
 * **Esta é uma decisão que muda o README do pacote.** Excluir era a operação
 * irreversível que ficava no aplicativo, com um humano confirmando (§9 da skill
 * do MCP). O operador pediu controle total da agenda pelo MCP para reorganizar
 * eventos já marcados; a exclusão entrou com `destructiveHint`, com a
 * `description` mandando conferir o título antes, e **só aqui**: o chat da API
 * não ganha nenhuma destas (`FERRAMENTAS_DO_CHAT`, RN-03).
 *
 * **Numa série, o alcance não se presume.** A API trata `scope` ausente como
 * `todas` — o padrão certo para o Desfazer do chat, e o errado para um modelo
 * que quis mexer numa ocorrência e esqueceu o campo: a série inteira mudaria
 * ou sumiria calada. Por isso, sem `scope`, a tool lê o evento antes e recusa
 * se ele se repete. Custa um GET nas escritas sem `scope`, que são as de
 * evento simples.
 *
 * Dia e hora vão crus, como nas criações: quem converte fuso é a API (INV-66).
 * Nenhuma destas manda `origin`: editar, excluir e converter não geram
 * conteúdo, e a marca de IA do item convertido é a do original (INV-58).
 */

function recusa(texto: string): CallToolResult {
  return { content: [{ type: "text", text: texto }], isError: true };
}

const EVENTO_NAO_ENCONTRADO =
  "**Nada foi alterado.** Não existe evento com esse id nesta conta — o id vem de " +
  "`list_agenda` —, ou, numa série, a ocorrência de `occurrenceDate` não existe (dia que a " +
  "série não tem, ou já cancelado). Liste a agenda de novo antes de tentar.";

const TAREFA_NAO_ENCONTRADA =
  "**Nada foi alterado.** Não existe tarefa com esse id nesta conta — o id vem de " +
  "`list_agenda`, e as tarefas sem data aparecem no fim dela.";

function caminhoComAlcance(
  base: string,
  alcance: { scope: EscopoDoEvento; occurrenceDate?: string | undefined } | null,
): string {
  if (!alcance) return base;
  const busca = new URLSearchParams({ scope: alcance.scope });
  if (alcance.occurrenceDate) busca.set("occurrenceDate", alcance.occurrenceDate);
  return `${base}?${busca.toString()}`;
}

/**
 * O alcance de uma escrita num evento. Com `scope`, vai como veio. Sem ele, o
 * evento é lido: simples, segue sem alcance; série, a escrita é recusada antes
 * de tocar em nada. `NOT_FOUND` da leitura vira a recusa do id.
 */
async function alcanceDe(
  eventId: string,
  scope: EscopoDoEvento | undefined,
  occurrenceDate: string | undefined,
): Promise<{ alcance: { scope: EscopoDoEvento; occurrenceDate?: string } | null } | CallToolResult> {
  if (scope) {
    return { alcance: { scope, ...(occurrenceDate !== undefined && { occurrenceDate }) } };
  }
  let atual: EventItem;
  try {
    atual = await api.get<EventItem>(`/events/${eventId}`);
  } catch (erro) {
    if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") return recusa(EVENTO_NAO_ENCONTRADO);
    throw erro;
  }
  if (atual.recurrence?.days?.length) {
    return recusa(
      `**Nada foi alterado.** **${atual.title}** é uma série (repete ` +
        `${descreverDias(atual.recurrence.days)}). Diga o alcance em \`scope\`: \`esta\` ou ` +
        "`seguintes`, com o dia da ocorrência em `occurrenceDate`, ou `todas`. Na dúvida, " +
        "pergunte ao usuário.",
    );
  }
  return { alcance: null };
}

const ehRecusa = (valor: object): valor is CallToolResult => "content" in valor;

function semIndefinidos<T extends Record<string, unknown>>(objeto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, valor]) => valor !== undefined),
  ) as Partial<T>;
}

/** Siglas para os números que a API conhece; `null` passa (deixar de repetir). */
function repeticaoDaApi(
  repeat: { days: SiglaDoDia[]; until?: string | undefined } | null | undefined,
) {
  if (repeat === undefined || repeat === null) return repeat;
  return {
    days: diasDasSiglas(repeat.days),
    ...(repeat.until !== undefined && { until: repeat.until }),
  };
}

export function registrarControleDaAgenda(server: McpServer): void {
  const alterarEvento = FERRAMENTAS_DO_ACERVO.update_event;
  server.registerTool(
    "update_event",
    {
      title: alterarEvento.titulo,
      description: alterarEvento.descricao,
      annotations: alterarEvento.anotacoes,
      inputSchema: alterarEvento.entrada,
    },
    comErroDeEscrita(async ({ eventId, scope, occurrenceDate, repeat, ...campos }, extra) => {
      const relato = relatar(server, extra, "update_event", 2);
      const mudanca = {
        ...semIndefinidos(campos),
        ...(repeat !== undefined && { repeat: repeticaoDaApi(repeat) }),
      };
      if (Object.keys(mudanca).length === 0) {
        return recusa("**Nada foi alterado.** Mande pelo menos um campo para mudar.");
      }
      const conferido = await alcanceDe(eventId, scope, occurrenceDate);
      if (ehRecusa(conferido)) return conferido;
      await relato.passo("alcance conferido");

      let atual: EventItem;
      try {
        atual = await api.patch<EventItem>(
          caminhoComAlcance(`/events/${eventId}`, conferido.alcance),
          mudanca,
        );
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(EVENTO_NAO_ENCONTRADO);
        }
        throw erro;
      }

      await relato.passo("evento alterado");
      await relato.registrar("info", {
        acao: "evento alterado",
        eventId: atual.id,
        scope: conferido.alcance?.scope ?? null,
        campos: Object.keys(mudanca),
      });
      // Em `esta` e `seguintes` a API devolve o avulso ou a série nova, com id
      // próprio: o texto mostra o id que vale dali em diante.
      return { content: [{ type: "text", text: `Evento alterado.\n\n${formatarEvento(atual)}` }] };
    }),
  );

  const excluirEvento = FERRAMENTAS_DO_ACERVO.delete_event;
  server.registerTool(
    "delete_event",
    {
      title: excluirEvento.titulo,
      description: excluirEvento.descricao,
      annotations: excluirEvento.anotacoes,
      inputSchema: excluirEvento.entrada,
    },
    comErroDeEscrita(async ({ eventId, scope, occurrenceDate }, extra) => {
      const relato = relatar(server, extra, "delete_event", 2);
      const conferido = await alcanceDe(eventId, scope, occurrenceDate);
      if (ehRecusa(conferido)) return conferido;
      await relato.passo("alcance conferido");

      try {
        await api.remover(caminhoComAlcance(`/events/${eventId}`, conferido.alcance));
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(EVENTO_NAO_ENCONTRADO);
        }
        throw erro;
      }

      const alcance = conferido.alcance;
      await relato.passo("evento excluído");
      await relato.registrar("info", {
        acao: "evento excluído",
        eventId,
        scope: alcance?.scope ?? null,
        occurrenceDate: alcance?.occurrenceDate ?? null,
      });
      const quais =
        alcance?.scope === "esta"
          ? `A ocorrência de ${alcance.occurrenceDate} saiu da série; as outras continuam.`
          : alcance?.scope === "seguintes"
            ? `A série termina antes de ${alcance.occurrenceDate}.`
            : "O evento saiu da agenda.";
      return { content: [{ type: "text", text: `Evento excluído. ${quais}` }] };
    }),
  );

  const alterarTarefa = FERRAMENTAS_DO_ACERVO.update_task;
  server.registerTool(
    "update_task",
    {
      title: alterarTarefa.titulo,
      description: alterarTarefa.descricao,
      annotations: alterarTarefa.anotacoes,
      inputSchema: alterarTarefa.entrada,
    },
    comErroDeEscrita(async ({ taskId, ...campos }, extra) => {
      const relato = relatar(server, extra, "update_task", 1);
      const mudanca = semIndefinidos(campos);
      if (Object.keys(mudanca).length === 0) {
        return recusa("**Nada foi alterado.** Mande pelo menos um campo para mudar.");
      }
      let atual: TaskItem;
      try {
        atual = await api.patch<TaskItem>(`/tasks/${taskId}`, mudanca);
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(TAREFA_NAO_ENCONTRADA);
        }
        throw erro;
      }
      await relato.passo("tarefa alterada");
      await relato.registrar("info", {
        acao: "tarefa alterada",
        taskId: atual.id,
        campos: Object.keys(mudanca),
      });
      return { content: [{ type: "text", text: `Tarefa alterada.\n\n${formatarTarefa(atual)}` }] };
    }),
  );

  const excluirTarefa = FERRAMENTAS_DO_ACERVO.delete_task;
  server.registerTool(
    "delete_task",
    {
      title: excluirTarefa.titulo,
      description: excluirTarefa.descricao,
      annotations: excluirTarefa.anotacoes,
      inputSchema: excluirTarefa.entrada,
    },
    comErroDeEscrita(async ({ taskId }, extra) => {
      const relato = relatar(server, extra, "delete_task", 1);
      try {
        await api.remover(`/tasks/${taskId}`);
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(TAREFA_NAO_ENCONTRADA);
        }
        throw erro;
      }
      await relato.passo("tarefa excluída");
      await relato.registrar("info", { acao: "tarefa excluída", taskId });
      return { content: [{ type: "text", text: "Tarefa excluída." }] };
    }),
  );

  const paraTarefa = FERRAMENTAS_DO_ACERVO.convert_event_to_task;
  server.registerTool(
    "convert_event_to_task",
    {
      title: paraTarefa.titulo,
      description: paraTarefa.descricao,
      annotations: paraTarefa.anotacoes,
      inputSchema: paraTarefa.entrada,
    },
    comErroDeEscrita(async ({ eventId, occurrenceDate, ...campos }, extra) => {
      const relato = relatar(server, extra, "convert_event_to_task", 1);
      // Com o dia, é uma ocorrência (`esta`); sem ele, a API recusa a série
      // com a frase que pede o dia — num evento simples, o escopo não conta.
      const alcance = occurrenceDate ? { scope: "esta" as const, occurrenceDate } : null;
      let tarefa: TaskItem;
      try {
        tarefa = await api.post<TaskItem>(
          caminhoComAlcance(`/events/${eventId}/to-task`, alcance),
          semIndefinidos(campos),
        );
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(
            `${EVENTO_NAO_ENCONTRADO} Se o id está certo, a API no ar pode ainda não ter a ` +
              "conversão.",
          );
        }
        throw erro;
      }
      await relato.passo("evento convertido");
      await relato.registrar("info", {
        acao: "evento convertido em tarefa",
        eventId,
        taskId: tarefa.id,
      });
      return {
        content: [
          { type: "text", text: `Evento convertido em tarefa.\n\n${formatarTarefa(tarefa)}` },
        ],
      };
    }),
  );

  const paraEvento = FERRAMENTAS_DO_ACERVO.convert_task_to_event;
  server.registerTool(
    "convert_task_to_event",
    {
      title: paraEvento.titulo,
      description: paraEvento.descricao,
      annotations: paraEvento.anotacoes,
      inputSchema: paraEvento.entrada,
    },
    comErroDeEscrita(async ({ taskId, repeat, ...campos }, extra) => {
      const relato = relatar(server, extra, "convert_task_to_event", 1);
      let evento: EventItem;
      try {
        evento = await api.post<EventItem>(`/tasks/${taskId}/to-event`, {
          ...semIndefinidos(campos),
          ...(repeat !== undefined && { repeat: repeticaoDaApi(repeat) }),
        });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(
            `${TAREFA_NAO_ENCONTRADA} Se o id está certo, a API no ar pode ainda não ter a ` +
              "conversão.",
          );
        }
        throw erro;
      }
      await relato.passo("tarefa convertida");
      await relato.registrar("info", {
        acao: "tarefa convertida em evento",
        taskId,
        eventId: evento.id,
      });
      return {
        content: [
          { type: "text", text: `Tarefa convertida em evento.\n\n${formatarEvento(evento)}` },
        ],
      };
    }),
  );
}
