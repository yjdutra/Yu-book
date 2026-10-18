import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  diasDasSiglas,
  FERRAMENTAS_DO_ACERVO,
  formatarEvento,
  formatarTarefa,
} from "@yu-book/shared";
import type { EventItem, TaskItem } from "@yu-book/shared";
import { origemDoCliente } from "../autor.js";
import { api, ErroDaApi } from "../cliente.js";
import { comErroDeEscrita } from "../erros.js";
import { relatar } from "../notificacoes.js";

/**
 * As tools que mudam a agenda (frente de agenda, Fase 2): `create_event`,
 * `create_task` e `complete_task`. Separadas de `tools/agenda.ts` pelo mesmo
 * motivo de `kanban-escrita.ts` — risco diferente, revisão diferente — e
 * registradas só quando a escrita está liberada (`criarServidor`), com
 * `comErroDeEscrita` reperguntando na chamada (INV-45).
 *
 * **Dia e hora vão crus, e não há `fusoDoUsuario` aqui.** O contrário de
 * `create_card`, e não por descuido: o prazo do card é um instante que o
 * **cliente** monta (23:59:59 locais), então o MCP precisa do fuso antes do
 * POST. Evento e tarefa recebem dia e hora **locais** e quem converte é a API,
 * pelo `ai_preference.timezone` (INV-66) — converter deste lado gravaria a
 * hora deslocada pelo fuso duas vezes. A resposta também volta em dia e hora
 * locais, e `formatarEvento`/`formatarTarefa` não pedem fuso.
 *
 * **Toda escrita manda `origin`** (INV-58, INV-63): as duas criações nascem
 * marcadas como geradas por IA, e a conclusão grava quem concluiu — pela rota
 * própria, `PATCH /tasks/:id/complete`, a única da tarefa que aceita `origin`.
 *
 * **`repeat` vai em número, e a falta dele na volta é avisada** (frente de
 * eventos recorrentes, R2). O modelo escreve siglas (`seg`, `qua`) e a API só
 * conhece 0–6: `diasDasSiglas` converte nesta fronteira. Uma API anterior à
 * série **não recusa** o `repeat` — o schema dela não é estrito e descarta a
 * chave (§2 de `contrato-compartilhado`) — e cria um evento avulso com 201. A
 * única pista é a resposta sem `recurrence`, e é ela que vira aviso. Sem
 * `isError` e sem reenvio: o evento existe, e um erro faria o modelo criar
 * outro.
 *
 * As três rotas são da Fase 1 da agenda: contra uma API mais velha elas voltam
 * `NOT_FOUND` (§13 da skill do MCP), e a tradução genérica desse código fala
 * de search_notes e get_board. Por isso cada tool intercepta o `NOT_FOUND` com
 * a frase do id que ela de fato recebe.
 */

/** A recusa de `NOT_FOUND`, com a frase que cabe à tool. */
function naoEncontrado(texto: string): CallToolResult {
  return { content: [{ type: "text", text: texto }], isError: true };
}

/** O `NOT_FOUND` de uma criação: o quadro, se veio um, ou a rota. */
function naoEncontradoNaCriacao(boardId: string | undefined): CallToolResult {
  return naoEncontrado(
    boardId
      ? "**Nada foi criado.** O quadro de `boardId` não existe nesta conta — o id do projeto " +
          "vem de `list_boards` —, ou a API no ar ainda não tem a agenda."
      : "**Nada foi criado.** A API do Yu-book no ar ainda não tem a agenda: tentar de novo " +
          "não resolve.",
  );
}

export function registrarEscritaDeAgenda(server: McpServer): void {
  const evento = FERRAMENTAS_DO_ACERVO.create_event;
  server.registerTool(
    "create_event",
    {
      title: evento.titulo,
      description: evento.descricao,
      annotations: evento.anotacoes,
      inputSchema: evento.entrada,
    },
    comErroDeEscrita(async (entrada, extra) => {
      const relato = relatar(server, extra, "create_event", 1);
      const origin = await origemDoCliente(server, extra);

      let criado: EventItem;
      try {
        criado = await api.post<EventItem>("/events", {
          title: entrada.title,
          date: entrada.date,
          ...(entrada.startTime !== undefined && { startTime: entrada.startTime }),
          ...(entrada.endTime !== undefined && { endTime: entrada.endTime }),
          ...(entrada.endDate !== undefined && { endDate: entrada.endDate }),
          ...(entrada.allDay !== undefined && { allDay: entrada.allDay }),
          ...(entrada.location !== undefined && { location: entrada.location }),
          ...(entrada.description !== undefined && { description: entrada.description }),
          ...(entrada.boardId !== undefined && { boardId: entrada.boardId }),
          ...(entrada.repeat !== undefined && {
            repeat: {
              days: diasDasSiglas(entrada.repeat.days),
              ...(entrada.repeat.until !== undefined && { until: entrada.repeat.until }),
            },
          }),
          origin,
        });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return naoEncontradoNaCriacao(entrada.boardId);
        }
        throw erro;
      }

      // `?.` apesar do tipo: a API mais velha nem manda a chave (§13 da skill).
      const repeticaoPerdida = entrada.repeat !== undefined && !criado.recurrence?.days?.length;

      await relato.passo("evento criado");
      await relato.registrar("info", {
        acao: "evento criado",
        eventId: criado.id,
        title: criado.title,
        date: criado.date,
        startTime: criado.startTime,
        ...(criado.recurrence?.days && { repeatDays: criado.recurrence.days }),
        author: origin.author,
      });

      const texto = `Evento criado.\n\n${formatarEvento(criado)}`;
      if (!repeticaoPerdida) return { content: [{ type: "text", text: texto }] };
      return {
        content: [
          {
            type: "text",
            text:
              `${texto}\n\n**Atenção: o evento não se repete.** A API do Yu-book no ar ainda não ` +
              "tem eventos recorrentes e ignorou `repeat`: só esta ocorrência foi criada, " +
              "avulsa. Não chame `create_event` de novo — criaria um evento a mais, também " +
              "avulso. Diga ao usuário que a repetição não foi gravada.",
          },
        ],
      };
    }),
  );

  const tarefa = FERRAMENTAS_DO_ACERVO.create_task;
  server.registerTool(
    "create_task",
    {
      title: tarefa.titulo,
      description: tarefa.descricao,
      annotations: tarefa.anotacoes,
      inputSchema: tarefa.entrada,
    },
    comErroDeEscrita(async (entrada, extra) => {
      const relato = relatar(server, extra, "create_task", 1);
      const origin = await origemDoCliente(server, extra);

      let criada: TaskItem;
      try {
        criada = await api.post<TaskItem>("/tasks", {
          title: entrada.title,
          ...(entrada.date !== undefined && { date: entrada.date }),
          ...(entrada.time !== undefined && { time: entrada.time }),
          ...(entrada.descriptionMd !== undefined && { descriptionMd: entrada.descriptionMd }),
          ...(entrada.boardId !== undefined && { boardId: entrada.boardId }),
          ...(entrada.repeat !== undefined && {
            repeat: {
              days: diasDasSiglas(entrada.repeat.days),
              ...(entrada.repeat.until !== undefined && { until: entrada.repeat.until }),
            },
          }),
          origin,
        });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return naoEncontradoNaCriacao(entrada.boardId);
        }
        throw erro;
      }
      // Como o `repeat` do evento (§13 da skill): a API anterior à tarefa
      // recorrente descarta a chave e cria uma tarefa avulsa, com 201.
      const repeticaoPerdida = entrada.repeat !== undefined && !criada.series?.days?.length;

      await relato.passo("tarefa criada");
      await relato.registrar("info", {
        acao: "tarefa criada",
        taskId: criada.id,
        title: criada.title,
        date: criada.date,
        author: origin.author,
      });

      const texto = `Tarefa criada.\n\n${formatarTarefa(criada)}`;
      if (!repeticaoPerdida) return { content: [{ type: "text", text: texto }] };
      return {
        content: [
          {
            type: "text",
            text:
              `${texto}\n\n**Atenção: a tarefa não se repete.** A API do Yu-book no ar ainda não ` +
              "tem tarefa recorrente e ignorou `repeat`: só esta tarefa foi criada. Não chame " +
              "`create_task` de novo; diga ao usuário que a repetição não foi gravada.",
          },
        ],
      };
    }),
  );

  // O par de `complete_card`: escrita que não cria, e `completed: false` é o
  // desfazer. Idempotente pelo `where` do service (INV-63) — concluir de novo
  // não troca a data nem quem concluiu.
  const concluir = FERRAMENTAS_DO_ACERVO.complete_task;
  server.registerTool(
    "complete_task",
    {
      title: concluir.titulo,
      description: concluir.descricao,
      annotations: concluir.anotacoes,
      inputSchema: concluir.entrada,
    },
    comErroDeEscrita(async ({ taskId, completed = true }, extra) => {
      const relato = relatar(server, extra, "complete_task", 1);
      const origin = await origemDoCliente(server, extra);

      let atual: TaskItem;
      try {
        atual = await api.patch<TaskItem>(`/tasks/${taskId}/complete`, { completed, origin });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return naoEncontrado(
            "**Nada foi alterado.** Não existe tarefa com esse id nesta conta — o id vem de " +
              "`list_agenda`, e as tarefas sem data aparecem no fim dela —, ou a API no ar " +
              "ainda não tem a agenda.",
          );
        }
        throw erro;
      }

      const acao = completed ? "tarefa concluída" : "tarefa reaberta";
      await relato.passo(acao);
      await relato.registrar("info", { acao, taskId: atual.id });

      const cabeca = completed ? "Tarefa concluída." : "Tarefa reaberta.";
      return { content: [{ type: "text", text: `${cabeca}\n\n${formatarTarefa(atual)}` }] };
    }),
  );
}
