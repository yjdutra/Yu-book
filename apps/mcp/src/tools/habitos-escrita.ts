import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  FERRAMENTAS_DO_ACERVO,
  formatarHabitos,
  formatarRegistroDeHabito,
} from "@yu-book/shared";
import type { HabitActivityItem, HabitEntryItem, HabitItem } from "@yu-book/shared";
import { origemDoCliente } from "../autor.js";
import { api, ErroDaApi } from "../cliente.js";
import { comErroDeEscrita, mensagemDeErro } from "../erros.js";
import { relatar } from "../notificacoes.js";

/**
 * As tools que mudam hábitos (frente Ritmo, Ritmo 1 — RF-13): `create_habit`,
 * `update_habit` e `log_habit`, e, desde a Ritmo 2 (RF-30), `check_in_event`.
 * Registradas só com a escrita liberada
 * (`criarServidor`), com `comErroDeEscrita` reperguntando na chamada (INV-45).
 *
 * **Só `log_habit` e `check_in_event` mandam `origin`**: o registro guarda quem
 * registrou (RN-12),
 * como a conclusão da tarefa (INV-63). Hábito e atividade não têm marca de IA —
 * são configuração, não conteúdo do acervo.
 *
 * **`update_habit` não é atômico.** O hábito e cada atividade são rotas
 * próprias, e uma falha no meio deixa o que já passou gravado. Por isso a tool
 * confere tudo o que pode antes da primeira escrita, e, se uma falhar depois,
 * devolve o que foi aplicado e o que falhou: sem isso o modelo repetiria a
 * chamada inteira e criaria a atividade nova duas vezes.
 *
 * As rotas são da frente Ritmo: contra uma API mais velha elas voltam
 * `NOT_FOUND` (§13 da skill do MCP), e cada tool intercepta com a frase do id
 * que ela de fato recebe.
 */

function recusa(texto: string): CallToolResult {
  return { content: [{ type: "text", text: texto }], isError: true };
}

const HABITO_NAO_ENCONTRADO =
  "**Nada foi alterado.** Não existe hábito com esse id nesta conta — o id vem de " +
  "`list_habits` —, ou a API no ar ainda não tem hábitos.";

export function registrarEscritaDeHabitos(server: McpServer): void {
  const criar = FERRAMENTAS_DO_ACERVO.create_habit;
  server.registerTool(
    "create_habit",
    {
      title: criar.titulo,
      description: criar.descricao,
      annotations: criar.anotacoes,
      inputSchema: criar.entrada,
    },
    comErroDeEscrita(async (entrada, extra) => {
      const relato = relatar(server, extra, "create_habit", 1);
      let criado: HabitItem;
      try {
        criado = await api.post<HabitItem>("/habits", {
          name: entrada.name,
          weeklyGoal: entrada.weeklyGoal,
          targetDays: entrada.targetDays,
          ...(entrada.color !== undefined && { color: entrada.color }),
          ...(entrada.emblem !== undefined && { emblem: entrada.emblem }),
          ...(entrada.activities !== undefined && { activities: entrada.activities }),
        });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(
            "**Nada foi criado.** A API do Yu-book no ar ainda não tem hábitos: tentar de novo " +
              "não resolve.",
          );
        }
        throw erro;
      }
      await relato.passo("hábito criado");
      await relato.registrar("info", {
        acao: "hábito criado",
        habitId: criado.id,
        name: criado.name,
        activities: criado.activities.length,
      });
      return {
        content: [{ type: "text", text: `Hábito criado.\n\n${formatarHabitos([criado])}` }],
      };
    }),
  );

  const alterar = FERRAMENTAS_DO_ACERVO.update_habit;
  server.registerTool(
    "update_habit",
    {
      title: alterar.titulo,
      description: alterar.descricao,
      annotations: alterar.anotacoes,
      inputSchema: alterar.entrada,
    },
    comErroDeEscrita(async ({ habitId, activities = [], ...campos }, extra) => {
      const mudanca = Object.fromEntries(
        Object.entries(campos).filter(([, valor]) => valor !== undefined),
      );
      if (Object.keys(mudanca).length === 0 && activities.length === 0) {
        return recusa("**Nada foi alterado.** Mande pelo menos um campo para mudar.");
      }
      // Tudo o que dá para conferir sem rede, antes da primeira escrita.
      for (const [i, a] of activities.entries()) {
        if (!a.id && (a.name === undefined || a.points === undefined)) {
          return recusa(
            `**Nada foi alterado.** A atividade ${i + 1} não tem \`id\`, então seria criada — ` +
              "e atividade nova precisa de `name` e `points`.",
          );
        }
        if (
          a.id &&
          a.name === undefined &&
          a.points === undefined &&
          a.pointsPerPomodoro === undefined &&
          a.archived === undefined
        ) {
          return recusa(
            `**Nada foi alterado.** A atividade ${i + 1} tem \`id\` mas nenhum campo para mudar.`,
          );
        }
      }

      // O `PATCH /habit-activities/:id` escopa por usuário, não por hábito: um
      // id de atividade de outro hábito da conta seria aceito e relatado como
      // deste. Conferido antes da primeira escrita, por uma leitura.
      const editadas = activities.flatMap((a) => (a.id ? [a.id] : []));
      if (editadas.length > 0) {
        let atualAntes: HabitItem;
        try {
          atualAntes = await api.get<HabitItem>(`/habits/${habitId}`);
        } catch (erro) {
          if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
            return recusa(HABITO_NAO_ENCONTRADO);
          }
          throw erro;
        }
        const deste = new Set(atualAntes.activities.map((a) => a.id));
        const alheia = editadas.find((id) => !deste.has(id));
        if (alheia) {
          return recusa(
            `**Nada foi alterado.** A atividade ${alheia} não é deste hábito — os ids de ` +
              "cada hábito estão em `list_habits`.",
          );
        }
      }

      const passos = (Object.keys(mudanca).length > 0 ? 1 : 0) + activities.length + 1;
      const relato = relatar(server, extra, "update_habit", passos);
      const feito: string[] = [];
      try {
        if (Object.keys(mudanca).length > 0) {
          await api.patch<HabitItem>(`/habits/${habitId}`, mudanca);
          feito.push("hábito alterado");
          await relato.passo("hábito alterado");
        }
        for (const a of activities) {
          if (a.id) {
            const { id, ...resto } = a;
            const editada = await api.patch<HabitActivityItem>(`/habit-activities/${id}`, resto);
            feito.push(`atividade «${editada.name}» ${a.archived ? "arquivada" : "alterada"}`);
          } else {
            const nova = await api.post<HabitActivityItem>(`/habits/${habitId}/activities`, {
              name: a.name,
              points: a.points,
              ...(a.pointsPerPomodoro != null && { pointsPerPomodoro: a.pointsPerPomodoro }),
            });
            feito.push(`atividade «${nova.name}» criada`);
          }
          await relato.passo("atividade");
        }
      } catch (erro) {
        if (feito.length === 0) {
          if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
            return recusa(
              `${HABITO_NAO_ENCONTRADO} Se o hábito existe, confira os \`id\` das atividades, ` +
                "também em `list_habits`.",
            );
          }
          throw erro;
        }
        return recusa(
          `**Alteração parcial.** Já aplicado: ${feito.join("; ")}. Depois disso falhou: ` +
            `${mensagemDeErro(erro)} Não repita o que já foi aplicado; confira em ` +
            "`list_habits` e mande só o que falta.",
        );
      }

      const atual = await api.get<HabitItem>(`/habits/${habitId}`);
      await relato.passo("hábito relido");
      await relato.registrar("info", { acao: "hábito alterado", habitId, feito });
      return {
        content: [
          {
            type: "text",
            text: `Hábito alterado (${feito.join("; ")}).\n\n${formatarHabitos([atual])}`,
          },
        ],
      };
    }),
  );

  const registrar = FERRAMENTAS_DO_ACERVO.log_habit;
  server.registerTool(
    "log_habit",
    {
      title: registrar.titulo,
      description: registrar.descricao,
      annotations: registrar.anotacoes,
      inputSchema: registrar.entrada,
    },
    comErroDeEscrita(async ({ habitId, ...entrada }, extra) => {
      if (entrada.activityId === undefined && entrada.points === undefined) {
        return recusa("**Nada foi registrado.** Mande `activityId` ou `points`.");
      }
      const relato = relatar(server, extra, "log_habit", 2);
      const origin = await origemDoCliente(server, extra);
      let registro: HabitEntryItem;
      try {
        registro = await api.post<HabitEntryItem>(`/habits/${habitId}/entries`, {
          ...(entrada.activityId !== undefined && { activityId: entrada.activityId }),
          ...(entrada.points !== undefined && { points: entrada.points }),
          ...(entrada.day !== undefined && { day: entrada.day }),
          ...(entrada.note !== undefined && { note: entrada.note }),
          origin,
        });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(
            "**Nada foi registrado.** O hábito ou a atividade não existe nesta conta — os ids " +
              "vêm de `list_habits`, e a atividade precisa ser do hábito —, ou a API no ar " +
              "ainda não tem hábitos.",
          );
        }
        throw erro;
      }
      await relato.passo("pontos registrados");
      // O nome do hábito não vem no registro: uma leitura a mais, só para a
      // confirmação dizer em que hábito caiu.
      const habito = await api.get<HabitItem>(`/habits/${habitId}`);
      await relato.passo("hábito relido");
      await relato.registrar("info", {
        acao: "pontos registrados",
        habitId,
        entryId: registro.id,
        points: registro.points,
        day: registro.day,
        author: origin.author,
      });
      const semana = habito.week;
      return {
        content: [
          {
            type: "text",
            text:
              `Registrado.\n\n${formatarRegistroDeHabito(registro, habito.name)}\n` +
              `semana: ${semana.progress}/${habito.weeklyGoal} pts` +
              (semana.extra > 0 ? ` · ${semana.extra} acima do teto` : ""),
          },
        ],
      };
    }),
  );

  const checkIn = FERRAMENTAS_DO_ACERVO.check_in_event;
  server.registerTool(
    "check_in_event",
    {
      title: checkIn.titulo,
      description: checkIn.descricao,
      annotations: checkIn.anotacoes,
      inputSchema: checkIn.entrada,
    },
    comErroDeEscrita(async ({ eventId, day, done = true }, extra) => {
      const relato = relatar(server, extra, "check_in_event", done ? 2 : 1);
      const semEvento = recusa(
        `**Nada foi ${done ? "registrado" : "desfeito"}.** Não existe evento com esse id nesta ` +
          "conta — o id vem de `list_agenda` —, ou a API no ar ainda não tem check-in.",
      );
      if (!done) {
        try {
          // Idempotente na API: sem check-in naquele dia, nada a desfazer.
          await api.remover(`/events/${eventId}/check-in?day=${day}`);
        } catch (erro) {
          if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") return semEvento;
          throw erro;
        }
        await relato.passo("check-in desfeito");
        await relato.registrar("info", { acao: "check-in desfeito", eventId, day });
        const texto = `Check-in de ${day} desfeito (ou não havia).`;
        return { content: [{ type: "text", text: texto }] };
      }

      const origin = await origemDoCliente(server, extra);
      let registro: HabitEntryItem;
      try {
        registro = await api.post<HabitEntryItem>(`/events/${eventId}/check-in`, { day, origin });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") return semEvento;
        throw erro;
      }
      await relato.passo("check-in feito");
      // Como em `log_habit`: o nome do hábito e a semana não vêm no registro.
      const habito = await api.get<HabitItem>(`/habits/${registro.habitId}`);
      await relato.passo("hábito relido");
      await relato.registrar("info", {
        acao: "check-in feito",
        eventId,
        day,
        entryId: registro.id,
        points: registro.points,
        author: origin.author,
      });
      const semana = habito.week;
      return {
        content: [
          {
            type: "text",
            text:
              `Check-in feito.\n\n${formatarRegistroDeHabito(registro, habito.name)}\n` +
              `semana: ${semana.progress}/${habito.weeklyGoal} pts` +
              (semana.extra > 0 ? ` · ${semana.extra} acima do teto` : ""),
          },
        ],
      };
    }),
  );
}
