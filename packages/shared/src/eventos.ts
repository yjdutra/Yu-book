import { z } from "zod";
import { HORA_DA_AGENDA, somarDias } from "./agenda.js";
import type { CardComPrazo } from "./dashboard.js";
import type { FieldIssue } from "./errors.js";
import type { BoardRef } from "./kanban.js";
import { MAX_URL } from "./links.js";
import type { AiMark } from "./marca.js";
import { origemMcpSchema } from "./marca.js";
import type { TaskItem } from "./tarefas.js";

/**
 * Eventos da agenda — frente de agenda, Fase 1.
 *
 * Não confundir com `agenda.ts`, que é a agenda **de rotina** (Etapa F da
 * frente de IA): horários em que uma rotina roda sozinha.
 *
 * **O cliente não converte fuso.** Entrada e saída falam em dia (`AAAA-MM-DD`)
 * e hora (`HH:MM`) locais do usuário; o servidor converte pelo
 * `ai_preference.timezone` e devolve também o instante (`startsAt`), para
 * ordenar. É o que fecha, por construção, o defeito do §4.5 do contrato — o
 * fuso do navegador decidindo o dia — para estas entidades.
 *
 * As regras que cruzam campos (fim depois do início, hora exigida fora do dia
 * inteiro, duração máxima) moram em `resolverHorario`, uma função só: o schema
 * de criação a usa, e o servidor a reaplica sobre o valor **mesclado** do
 * PATCH, que o schema parcial não enxerga.
 */

export const MAX_EVENTO_TITULO = 200;
export const MAX_EVENTO_DESCRICAO = 5000;
export const MAX_EVENTO_LOCAL = 200;

/// Do início ao fim, contando o dia inteiro inclusive: mais que isso não é
/// evento, é período — e a agenda desenharia uma faixa por duas semanas.
export const MAX_DIAS_DO_EVENTO = 14;

/// Sem hora de término, o evento dura isto.
export const DURACAO_PADRAO_DO_EVENTO_MIN = 60;

/// A maior janela de `GET /agenda` e `GET /events`: um mês com as semanas das
/// bordas, que é o que o calendário mensal desenha, com folga.
export const MAX_DIAS_DA_AGENDA = 62;

const DIA_MS = 24 * 60 * 60_000;
const DIA_CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `AAAA-MM-DD` no formato **e** no calendário: `2026-02-30` casa com o regex e
 * não existe. Uma função só, para o schema não acumular duas mensagens sobre o
 * mesmo campo.
 */
export function ehDiaCivil(dia: string): boolean {
  const m = DIA_CIVIL.exec(dia);
  if (!m) return false;
  const [ano, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const conferido = new Date(Date.UTC(ano, mes - 1, d));
  /// O ano também: `Date.UTC` joga 0–99 para 1900–1999.
  return (
    conferido.getUTCFullYear() === ano &&
    conferido.getUTCMonth() === mes - 1 &&
    conferido.getUTCDate() === d
  );
}

/**
 * Uma instância nova a cada chamada. Os schemas de ferramenta (Fase 2) não
 * podem repetir a mesma: dois campos sobre um só `refine` viram `$ref` no JSON
 * Schema que o chat e o MCP publicam — `.describe()` copia o embrulho, não o
 * `z.string()` de dentro.
 */
export const novoDiaCivilSchema = () =>
  z.string().refine(ehDiaCivil, "Use uma data que exista, no formato AAAA-MM-DD");

export const diaCivilSchema = novoDiaCivilSchema();

/// A mesma `HH:MM` da agenda de rotina: uma regra de hora no projeto.
export const horaCivilSchema = z.string().regex(HORA_DA_AGENDA, "Hora no formato HH:MM");

/** Dias de calendário de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  const inicio = Date.UTC(a1 ?? 0, (m1 ?? 1) - 1, d1 ?? 1);
  const fim = Date.UTC(a2 ?? 0, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((fim - inicio) / DIA_MS);
}

function minutosDaHora(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Relógio de parede mais `minutos`, virando o dia quando passa da meia-noite.
 * Aritmética **civil**, sem fuso: é o "termina uma hora depois" que o usuário
 * lê no relógio. O instante sai depois, por `instanteLocal`.
 */
export function somarMinutos(
  dia: string,
  hora: string,
  minutos: number,
): { dia: string; hora: string } {
  const total = minutosDaHora(hora) + minutos;
  const dias = Math.floor(total / 1440);
  const resto = total - dias * 1440;
  return {
    dia: somarDias(dia, dias),
    hora: `${doisDigitos(Math.floor(resto / 60))}:${doisDigitos(resto % 60)}`,
  };
}

/**
 * Minutos de um relógio de parede a outro, contando os dias entre eles —
 * aritmética civil, sem fuso. Exportada para a duração gravada que a folha do
 * móvel mostra (frente de agenda, Fase 4): uma conta só, a mesma que o
 * servidor usa para conferir o evento.
 */
export function minutosEntre(dia1: string, hora1: string, dia2: string, hora2: string): number {
  return diasEntre(dia1, dia2) * 1440 + minutosDaHora(hora2) - minutosDaHora(hora1);
}

/** O horário de um evento como o usuário o lê, já completo. */
export interface HorarioDoEvento {
  allDay: boolean;
  date: string;
  /// No dia inteiro, o último dia, inclusive; com hora, o dia do término (ver
  /// `EventItem.endDate` e `diasDoEvento`).
  endDate: string;
  /// `null` no dia inteiro.
  startTime: string | null;
  endTime: string | null;
}

/** O que se pede: o fim pode faltar (`undefined` ou `null` = o padrão). */
export interface PedidoDeHorario {
  allDay: boolean;
  date: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

/**
 * Completa o horário com os padrões e confere as regras que cruzam campos.
 *
 * - **Dia inteiro**: hora não conta; `endDate` padrão é o próprio dia.
 * - **Com hora**: `startTime` é obrigatório. Sem `endTime`, o fim é uma hora
 *   depois, e pode cair no dia seguinte — o `endDate` acompanha. Com `endTime`
 *   antes do início e sem `endDate`, o evento atravessa a meia-noite ("das 22h
 *   à 1h"), que é o que quem escreve assim quer dizer.
 * - Fim estritamente depois do início, e no máximo `MAX_DIAS_DO_EVENTO` dias.
 *
 * Data ou hora fora do formato devolvem `horario: null` **sem** problema: quem
 * os acusa é o schema do próprio campo, e repetir a queixa aqui só duplicaria
 * a mensagem.
 */
export function resolverHorario(pedido: PedidoDeHorario): {
  horario: HorarioDoEvento | null;
  problemas: FieldIssue[];
} {
  const { allDay, date } = pedido;
  const bemFormados =
    ehDiaCivil(date) &&
    (pedido.endDate == null || ehDiaCivil(pedido.endDate)) &&
    (pedido.startTime == null || HORA_DA_AGENDA.test(pedido.startTime)) &&
    (pedido.endTime == null || HORA_DA_AGENDA.test(pedido.endTime));
  if (!bemFormados) return { horario: null, problemas: [] };

  if (allDay) {
    const endDate = pedido.endDate ?? date;
    const dias = diasEntre(date, endDate);
    if (dias < 0) {
      return {
        horario: null,
        problemas: [{ path: "endDate", message: "O último dia não pode ser antes do primeiro" }],
      };
    }
    if (dias + 1 > MAX_DIAS_DO_EVENTO) {
      return {
        horario: null,
        problemas: [
          { path: "endDate", message: `Um evento dura no máximo ${MAX_DIAS_DO_EVENTO} dias` },
        ],
      };
    }
    return { horario: { allDay, date, endDate, startTime: null, endTime: null }, problemas: [] };
  }

  const startTime = pedido.startTime;
  if (!startTime) {
    return {
      horario: null,
      problemas: [
        { path: "startTime", message: "Informe a hora de início, ou marque o dia inteiro" },
      ],
    };
  }

  let endDate: string;
  let endTime: string;
  if (pedido.endTime) {
    endTime = pedido.endTime;
    endDate = pedido.endDate ?? (endTime < startTime ? somarDias(date, 1) : date);
  } else {
    /// Sem hora de término, um `endDate` diferente do início não diz quando
    /// acaba — recusar é melhor que inventar a hora.
    if (pedido.endDate && pedido.endDate !== date) {
      return {
        horario: null,
        problemas: [{ path: "endTime", message: "Informe a hora de término" }],
      };
    }
    const fim = somarMinutos(date, startTime, DURACAO_PADRAO_DO_EVENTO_MIN);
    endDate = fim.dia;
    endTime = fim.hora;
  }

  const duracao = minutosEntre(date, startTime, endDate, endTime);
  if (duracao <= 0) {
    return {
      horario: null,
      problemas: [{ path: "endTime", message: "O fim precisa ser depois do início" }],
    };
  }
  if (duracao > MAX_DIAS_DO_EVENTO * 1440) {
    return {
      horario: null,
      problemas: [
        { path: "endDate", message: `Um evento dura no máximo ${MAX_DIAS_DO_EVENTO} dias` },
      ],
    };
  }
  return { horario: { allDay, date, endDate, startTime, endTime }, problemas: [] };
}

/** Os campos de horário de um PATCH; `null` no fim pede o padrão. */
export interface MudancaDeHorario {
  allDay?: boolean;
  date?: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

/**
 * O horário pedido por um PATCH, sobre o gravado. Uma regra só, sem `endDate`
 * gravado vazando para um início que mudou:
 *
 * - **`endDate` no PATCH** vence; `null` pede o padrão, como na criação.
 * - **Sem `endDate`, o vão em dias anda com o início**: o último dia é o novo
 *   `date` mais os dias que o evento já atravessava. Mover para o dia 10 um
 *   evento do dia 15 não o estica de 10 a 15.
 * - **Só o início mudou** (com hora): preserva a duração — a reunião de uma
 *   hora arrastada das 10h para as 14h termina às 15h.
 * - **`endTime` sem `endDate`**, num evento de menos de 24 h: a mesma
 *   inferência da criação — fim antes do início atravessa a meia-noite, senão
 *   é o mesmo dia. Num evento de vários dias, o vão fica, e só a hora muda.
 *   `endTime: null` volta ao padrão (início + 60 min), com a mesma inferência.
 * - **Trocar entre dia inteiro e com hora** não tem vão nem duração que valham
 *   no outro tipo: o fim volta ao padrão.
 *
 * O resultado ainda passa por `resolverHorario`.
 */
export function mesclarHorario(atual: HorarioDoEvento, mudanca: MudancaDeHorario): PedidoDeHorario {
  const allDay = mudanca.allDay ?? atual.allDay;
  const date = mudanca.date ?? atual.date;
  const startTime = mudanca.startTime !== undefined ? mudanca.startTime : atual.startTime;
  const mesmoTipo = allDay === atual.allDay;
  const vao = diasEntre(atual.date, atual.endDate);

  if (mudanca.endDate !== undefined) {
    const endTime =
      mudanca.endTime !== undefined ? mudanca.endTime : mesmoTipo ? atual.endTime : null;
    return { allDay, date, startTime, endDate: mudanca.endDate, endTime };
  }
  if (!mesmoTipo) {
    return { allDay, date, startTime, endDate: null, endTime: mudanca.endTime ?? null };
  }
  if (allDay) return { allDay, date, endDate: somarDias(date, vao) };

  const duracaoAtual =
    atual.startTime && atual.endTime
      ? minutosEntre(atual.date, atual.startTime, atual.endDate, atual.endTime)
      : 0;

  if (mudanca.endTime !== undefined) {
    // Padrão, ou evento curto: quem decide o dia do fim é a inferência da criação.
    if (mudanca.endTime === null || duracaoAtual < 1440) {
      return { allDay, date, startTime, endDate: null, endTime: mudanca.endTime };
    }
    return { allDay, date, startTime, endDate: somarDias(date, vao), endTime: mudanca.endTime };
  }

  if (!startTime || !atual.startTime || !atual.endTime) {
    return { allDay, date, startTime, endDate: null, endTime: null };
  }
  const fim = somarMinutos(date, startTime, duracaoAtual);
  return { allDay, date, startTime, endDate: fim.dia, endTime: fim.hora };
}

/**
 * Em quais dias locais o evento **aparece** — a regra única para o calendário
 * (e para quem mais desenhar dia a dia), coerente com a consulta da API, que é
 * sobreposição semiaberta `[startsAt, endsAt)`.
 *
 * O `endDate` de um evento com hora é o dia do instante de término, e por isso
 * o que termina às 00:00 tem `endDate` no dia seguinte — mas não ocupa nada
 * dele, e `GET /agenda` desse dia não o traz. Aqui também não: com hora e
 * `endTime` 00:00 num dia posterior, o último dia não conta. No dia inteiro,
 * `endDate` já é o último dia, inclusive.
 */
export function diasDoEvento(
  evento: Pick<EventItem, "date" | "endDate" | "allDay" | "endTime">,
): string[] {
  let ultimo = evento.endDate;
  if (!evento.allDay && evento.endTime === "00:00" && diasEntre(evento.date, ultimo) > 0) {
    ultimo = somarDias(ultimo, -1);
  }
  const dias = Math.max(0, diasEntre(evento.date, ultimo));
  return Array.from({ length: dias + 1 }, (_, i) => somarDias(evento.date, i));
}

/* --------------------------------------------------------------- schemas */

/// Só http e https — o mesmo corte de `normalizarUrl`. Vazio apaga o campo.
const urlDoEventoSchema = z
  .string()
  .trim()
  .max(MAX_URL, "Endereço grande demais")
  .refine((valor) => {
    if (valor === "") return true;
    try {
      const url = new URL(valor);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use um endereço http:// ou https://");

const camposDoEvento = z.object({
  title: z.string().trim().min(1, "Informe um título").max(MAX_EVENTO_TITULO),
  description: z.string().max(MAX_EVENTO_DESCRICAO, "Descrição grande demais").default(""),
  date: diaCivilSchema,
  /// `null` ou ausente: o padrão (o mesmo dia, ou o que a hora de término pedir).
  endDate: diaCivilSchema.nullable().optional(),
  allDay: z.boolean().default(false),
  startTime: horaCivilSchema.nullable().optional(),
  endTime: horaCivilSchema.nullable().optional(),
  location: z.string().trim().max(MAX_EVENTO_LOCAL, "Local grande demais").nullable().default(null),
  url: urlDoEventoSchema.nullable().default(null),
  /// O projeto. Quadro de outra conta é 404, como inexistente.
  boardId: z.string().uuid("Quadro inválido").nullable().default(null),
  /// Só o servidor MCP envia — ver `createNoteSchema.origin`.
  origin: origemMcpSchema.optional(),
});

function acusar(problemas: FieldIssue[], ctx: z.RefinementCtx) {
  for (const problema of problemas) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problema.path], message: problema.message });
  }
}

export const eventInputSchema = camposDoEvento.superRefine((evento, ctx) => {
  acusar(resolverHorario(evento).problemas, ctx);
});

/// Sem `origin`: a marca nasce na criação (INV-58). A regra cruzada roda no
/// servidor, sobre o horário mesclado (`mesclarHorario`).
export const eventUpdateSchema = camposDoEvento
  .omit({ origin: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/**
 * A janela de `GET /events` e `GET /agenda`, os dois dias inclusive, no fuso do
 * usuário.
 */
export const agendaQuerySchema = z
  .object({ from: diaCivilSchema, to: diaCivilSchema })
  .superRefine(({ from, to }, ctx) => {
    if (!ehDiaCivil(from) || !ehDiaCivil(to)) return;
    const dias = diasEntre(from, to);
    if (dias < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "O fim do período não pode ser antes do início",
      });
    } else if (dias + 1 > MAX_DIAS_DA_AGENDA) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `No máximo ${MAX_DIAS_DA_AGENDA} dias por consulta`,
      });
    }
  });

export type EventInput = z.input<typeof eventInputSchema>;
export type EventUpdateInput = z.input<typeof eventUpdateSchema>;
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;

/* ------------------------------------------------------------- respostas */

export interface EventItem {
  id: string;
  title: string;
  description: string;
  allDay: boolean;
  /// Dia e hora **locais do usuário**, já convertidos pelo servidor.
  date: string;
  /// No dia inteiro, o último dia, inclusive. Com hora, o dia do instante de
  /// término — o que acaba às 00:00 traz o dia seguinte sem ocupar nada dele.
  /// Para saber em que dias o evento aparece, `diasDoEvento`.
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  /// Os instantes, ISO. No dia inteiro, `endsAt` é a meia-noite local do dia
  /// seguinte ao último.
  startsAt: string;
  endsAt: string;
  location: string | null;
  url: string | null;
  board: BoardRef | null;
  ai: AiMark | null;
  createdAt: string;
  updatedAt: string;
}

/** Card com prazo visto pela agenda: `date` é o dia do prazo no fuso do usuário. */
export interface AgendaCard extends CardComPrazo {
  date: string;
}

/**
 * Tudo o que a agenda desenha num período, numa requisição. `timezone` vai
 * junto para o cliente desenhar no fuso certo sem segunda consulta, e `today`
 * é o dia de hoje **nele** — não o do aparelho.
 */
export interface AgendaRange {
  timezone: string;
  today: string;
  from: string;
  to: string;
  /// Os que se sobrepõem ao período, em ordem de início.
  events: EventItem[];
  /// Tarefas com data no período, abertas e concluídas.
  tasks: TaskItem[];
  /// Abertas com data antes de `min(today, from)`: as atrasadas **anteriores
  /// ao período**, que ele não mostraria. As atrasadas dentro do período já
  /// vêm em `tasks`, com `overdue: true` — nenhuma tarefa sai nas duas listas.
  overdueTasks: TaskItem[];
  /// Abertas e sem data, as mais recentes primeiro, até `LIMITE_TAREFAS_SEM_DATA`.
  /// Não dependem do período: vêm em toda consulta, para que o chat ache o id
  /// delas (`complete_task`) e o celular as liste junto da agenda.
  undatedTasks: TaskItem[];
  /// Abertos, não arquivados, com o dia do prazo no período.
  cards: AgendaCard[];
}
