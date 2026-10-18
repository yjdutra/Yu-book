import { z } from "zod";
import { HORA_DA_AGENDA, diaDaSemana, horaLocal, instanteLocal, somarDias } from "./agenda.js";
import type { CardComPrazo } from "./dashboard.js";
import type { FieldIssue } from "./errors.js";
import { diaLocal } from "./ia.js";
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
 *
 * **Repetição semanal** (frente de eventos recorrentes, R1): a série é um
 * evento só, com a regra junto (`repeat_days`, `repeat_until`, `exdates`), e as
 * ocorrências se calculam na leitura, no fuso **atual** do usuário
 * (`ocorrenciasNoPeriodo`) — nada de uma linha por ocorrência. As regras dela
 * moram em `resolverSerie`, irmã de `resolverHorario`, pelo mesmo motivo.
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

/// Teto de ocorrências de uma série numa chamada de `ocorrenciasNoPeriodo`. A
/// série dá no máximo uma por dia, e a janela da API tem `MAX_DIAS_DA_AGENDA`
/// dias: o teto só corta chamada fora da API, com período sem limite.
export const MAX_OCORRENCIAS_POR_CONSULTA = MAX_DIAS_DA_AGENDA * 7;

/**
 * O alcance de uma edição ou exclusão numa série: só a ocorrência, ela e as
 * seguintes, ou a série inteira. Num evento simples, o escopo não conta.
 */
export const ESCOPOS_DO_EVENTO = ["esta", "seguintes", "todas"] as const;
export type EscopoDoEvento = (typeof ESCOPOS_DO_EVENTO)[number];

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
 *   é o mesmo dia. Num de exatas 24 h, idem, e o fim igual ao início é o dia
 *   seguinte. Num evento de mais de 24 h, o vão fica, e só a hora muda.
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
    // Exatas 24 h (o teto da série, frente de eventos recorrentes) são "um
    // dia", não "vários": a mesma inferência, com fim igual ao início valendo
    // o dia seguinte — 08:00→08:00 continua de 24 h, e 09:00→10:00 volta a
    // ser do mesmo dia em vez de durar 25 h e ser recusada na série.
    if (duracaoAtual === 1440 && startTime) {
      const endDate = mudanca.endTime <= startTime ? somarDias(date, 1) : date;
      return { allDay, date, startTime, endDate, endTime: mudanca.endTime };
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

/**
 * O horário de um evento gravado, lido em `fuso`. Dia inteiro termina na
 * meia-noite **seguinte** ao último dia, então o último dia é o de `endsAt`
 * menos um.
 *
 * Mudar o fuso em `/ajustes` move o evento com hora no relógio — é o mesmo
 * instante, visto de outro lugar, e é o certo (INV-66). O dia inteiro também
 * se lê pelo fuso atual: gravado em São Paulo e lido muito a oeste, pode
 * recuar um dia.
 *
 * Morava no service da API; subiu para cá com a série (frente de eventos
 * recorrentes, R1), que lê daqui a hora de parede das ocorrências. Uma
 * conversão só de volta, a mesma para o evento simples e para a série.
 */
export function horarioNoFuso(
  evento: { allDay: boolean; startsAt: Date; endsAt: Date },
  fuso: string,
): HorarioDoEvento {
  const date = diaLocal(evento.startsAt, fuso);
  if (evento.allDay) {
    const endDate = somarDias(diaLocal(evento.endsAt, fuso), -1);
    return {
      allDay: true,
      date,
      endDate: endDate < date ? date : endDate,
      startTime: null,
      endTime: null,
    };
  }
  return {
    allDay: false,
    date,
    endDate: diaLocal(evento.endsAt, fuso),
    startTime: horaLocal(evento.startsAt, fuso),
    endTime: horaLocal(evento.endsAt, fuso),
  };
}

/* ----------------------------------------------------------------- séries */

/** A regra de uma série como a resposta a devolve. */
export interface EventRecurrence {
  /// Dias da semana, 0 = domingo … 6 = sábado, em ordem e sem repetir.
  days: number[];
  /// O último dia da série, inclusive; `null` = sem fim.
  until: string | null;
}

/**
 * As siglas dos dias da semana, na ordem de `diaDaSemana` (0 = domingo). São o
 * vocabulário do `repeat` de `create_event` (frente de eventos recorrentes,
 * R2) — sigla em português o modelo erra menos que número, que ele lê como
 * segunda = 1 ou como domingo = 7 — e o da descrição da série no texto e nas
 * telas. A API guarda e devolve número; a conversão é só nesta fronteira.
 */
export const SIGLAS_DOS_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export type SiglaDoDia = (typeof SIGLAS_DOS_DIAS)[number];

/**
 * O que se **mostra**: as siglas com o acento do sábado. A entrada da
 * ferramenta continua `sab` (sem acento, mais fácil para o modelo acertar);
 * a tela, o "repete …" do chat e o texto do MCP escrevem `sáb`.
 */
export const NOMES_CURTOS_DOS_DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** `["sex", "seg", "seg"]` → `[1, 5]`: em ordem e sem repetir, como a regra grava. */
export function diasDasSiglas(siglas: readonly SiglaDoDia[]): number[] {
  const dias = siglas.map((s) => SIGLAS_DOS_DIAS.indexOf(s)).filter((d) => d >= 0);
  return [...new Set(dias)].sort((a, b) => a - b);
}

/**
 * `[1, 3, 5]` → `"seg, qua, sex"`; os sete dias, `"todo dia"`. Pronta para
 * "repete …" — no formatador e no `ChatCreated.repeat`, que as telas mostram
 * sem importar este módulo.
 */
export function descreverDias(dias: readonly number[]): string {
  const siglas = [...new Set(dias)]
    .sort((a, b) => a - b)
    .map((d) => NOMES_CURTOS_DOS_DIAS[d])
    .filter((s) => s !== undefined);
  return siglas.length === NOMES_CURTOS_DOS_DIAS.length ? "todo dia" : siglas.join(", ");
}

/** O que se pede: `until` pode faltar. */
export interface PedidoDeRepeticao {
  days: number[];
  until?: string | null;
}

/**
 * A primeira data, de `dia` em diante, que cai num dos dias da semana da
 * série. A série **começa em `date` e só tem ocorrência nos dias escolhidos**:
 * "toda segunda e quarta a partir de 15/10 (quinta)" começa na segunda 19/10,
 * e é esse o `starts_at` gravado — a primeira ocorrência de verdade, nunca uma
 * fora da regra.
 */
export function primeiroDiaDaSerie(dia: string, dias: readonly number[]): string | null {
  for (let i = 0; i < 7; i += 1) {
    const candidato = somarDias(dia, i);
    if (dias.includes(diaDaSemana(candidato))) return candidato;
  }
  return null;
}

const semRepetir = (lista: readonly unknown[]) => new Set(lista).size === lista.length;

function diasBemFormados(dias: readonly number[]): boolean {
  return (
    dias.length > 0 &&
    dias.length <= 7 &&
    dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    semRepetir(dias)
  );
}

export interface SerieResolvida {
  horario: HorarioDoEvento | null;
  /// `null` quando não repete.
  recurrence: EventRecurrence | null;
  problemas: FieldIssue[];
}

/**
 * Horário **e** repetição: completa o horário por `resolverHorario` e, se há
 * repetição, confere as regras dela e leva o horário para a primeira
 * ocorrência (`primeiroDiaDaSerie`). Uma função só para o schema de criação e
 * para o servidor, que a reaplica sobre o valor mesclado do PATCH.
 *
 * - **Série é de um dia**: com hora, dura até 24 h (pode atravessar a
 *   meia-noite); de dia inteiro, um dia só. Repetir um evento de vários dias
 *   ficou fora da frente.
 * - `until` não vem antes de `date`, e pelo menos um dia escolhido cai entre
 *   os dois — senão a série nasceria sem ocorrência nenhuma.
 *
 * `horario` devolvido é o **da primeira ocorrência**: com `date` numa quinta e
 * a série às segundas, o `date` dele é a segunda seguinte, e o `endDate` anda
 * junto. Formato ruim devolve `horario: null` sem problema, como em
 * `resolverHorario`: quem o acusa é o schema do campo.
 */
export function resolverSerie(
  pedido: PedidoDeHorario,
  repeticao: PedidoDeRepeticao | null | undefined,
): SerieResolvida {
  const resolvido = resolverHorario(pedido);
  const { horario } = resolvido;
  if (!horario || !repeticao) {
    return { horario, recurrence: null, problemas: resolvido.problemas };
  }
  const until = repeticao.until ?? null;
  if (!diasBemFormados(repeticao.days) || (until !== null && !ehDiaCivil(until))) {
    return { horario: null, recurrence: null, problemas: [] };
  }

  const recusar = (path: string, message: string): SerieResolvida => ({
    horario: null,
    recurrence: null,
    problemas: [{ path, message }],
  });
  if (horario.allDay ? horario.endDate !== horario.date : duracaoEmMinutos(horario) > 1440) {
    return recusar(
      "repeat",
      horario.allDay
        ? "Um evento que se repete dura um dia só"
        : "Um evento que se repete dura no máximo 24 horas",
    );
  }
  if (until !== null && until < horario.date) {
    return recusar("repeat.until", "A repetição não pode terminar antes do início");
  }
  const primeiro = primeiroDiaDaSerie(horario.date, repeticao.days);
  if (!primeiro || (until !== null && primeiro > until)) {
    return recusar("repeat.until", "Nenhum dos dias escolhidos cai até o fim da repetição");
  }

  const desvio = diasEntre(horario.date, primeiro);
  return {
    horario: { ...horario, date: primeiro, endDate: somarDias(horario.endDate, desvio) },
    recurrence: { days: [...repeticao.days].sort((a, b) => a - b), until },
    problemas: [],
  };
}

function duracaoEmMinutos(horario: HorarioDoEvento): number {
  if (!horario.startTime || !horario.endTime) return 0;
  return minutosEntre(horario.date, horario.startTime, horario.endDate, horario.endTime);
}

/** Uma série como o banco a guarda, com as datas civis já em `AAAA-MM-DD`. */
export interface SerieDoEvento {
  allDay: boolean;
  /// A primeira ocorrência, como gravada.
  startsAt: Date;
  endsAt: Date;
  recurrence: EventRecurrence;
  /// As ocorrências canceladas, pelo dia em que começam.
  exdates: readonly string[];
}

/** Uma ocorrência: o horário dela, lido no fuso, e os instantes. */
export interface OcorrenciaDoEvento extends HorarioDoEvento {
  /// O dia da série a que ela corresponde — a identidade da ocorrência.
  occurrenceDate: string;
  startsAt: Date;
  endsAt: Date;
}

/** O que se calcula uma vez por série, e não por dia. */
function baseDaSerie(serie: SerieDoEvento, fuso: string) {
  const horario = horarioNoFuso(serie, fuso);
  return { horario, vao: Math.max(0, diasEntre(horario.date, horario.endDate)) };
}

function ehDiaDaSerie(serie: SerieDoEvento, primeiro: string, dia: string): boolean {
  return (
    dia >= primeiro &&
    (serie.recurrence.until === null || dia <= serie.recurrence.until) &&
    serie.recurrence.days.includes(diaDaSemana(dia)) &&
    !serie.exdates.includes(dia)
  );
}

function ocorrenciaSobre(
  serie: SerieDoEvento,
  base: ReturnType<typeof baseDaSerie>,
  dia: string,
  fuso: string,
): OcorrenciaDoEvento | null {
  if (!ehDiaDaSerie(serie, base.horario.date, dia)) return null;
  // A primeira é a gravada, ao milissegundo: nada a recalcular.
  if (dia === base.horario.date) {
    return { ...base.horario, occurrenceDate: dia, startsAt: serie.startsAt, endsAt: serie.endsAt };
  }
  let startsAt: Date;
  let endsAt: Date;
  if (serie.allDay) {
    startsAt = instanteLocal(dia, "00:00", fuso);
    endsAt = instanteLocal(somarDias(dia, 1), "00:00", fuso);
  } else {
    // A hora de parede da série, não o instante mais N semanas: 8:00 continua
    // 8:00 do outro lado de uma virada de horário de verão.
    startsAt = instanteLocal(dia, base.horario.startTime ?? "00:00", fuso);
    endsAt = instanteLocal(somarDias(dia, base.vao), base.horario.endTime ?? "00:00", fuso);
    // Uma virada no meio da ocorrência pode encostar o fim no início; aí vale
    // a duração gravada.
    if (endsAt.getTime() <= startsAt.getTime()) {
      endsAt = new Date(startsAt.getTime() + serie.endsAt.getTime() - serie.startsAt.getTime());
    }
  }
  const horario = horarioNoFuso({ allDay: serie.allDay, startsAt, endsAt }, fuso);
  return { ...horario, occurrenceDate: dia, startsAt, endsAt };
}

/**
 * A ocorrência da série no dia `dia`, ou `null` se ela não existe ali — antes
 * do início, depois do fim, fora dos dias escolhidos ou cancelada. É a
 * conferência de "esta" e "seguintes" no servidor.
 */
export function ocorrenciaDoDia(
  serie: SerieDoEvento,
  dia: string,
  fuso: string,
): OcorrenciaDoEvento | null {
  return ocorrenciaSobre(serie, baseDaSerie(serie, fuso), dia, fuso);
}

/**
 * As ocorrências da série que se sobrepõem ao período, em ordem — a mesma
 * sobreposição semiaberta `[startsAt, endsAt)` da consulta do evento simples,
 * com a janela da meia-noite local de `de` à do dia seguinte a `ate`. A
 * ocorrência que atravessa a meia-noite aparece nos dois dias, coerente com
 * `diasDoEvento`.
 *
 * A hora de parede sai do instante gravado, lido em `fuso` (`horarioNoFuso`),
 * e cada ocorrência é `instanteLocal(dia, hora, fuso)`: as ocorrências seguem o
 * fuso **atual**, como o evento simples (INV-66).
 *
 * **Limitação aceita:** os dias da semana da regra são os do calendário do fuso
 * em que a série foi gravada, e o fuso não é gravado. Toda troca de fuso que
 * leve a hora da série para o outro lado da meia-noite — não só as extremas:
 * aula às 22:00 de São Paulo lida em Lisboa vira 01:00 do dia seguinte — faz
 * a série andar um dia (a de seg/qua/sex passa a cair às 01:00 de seg/qua/sex
 * de Lisboa, que são dom/ter/qui 21:00 em São Paulo), e a primeira ocorrência
 * gravada **some**, porque o dia dela (terça, em Lisboa) não está na regra. O
 * dia inteiro lido muito a oeste já recua um dia pelo mesmo motivo.
 *
 * Sem fuso padrão (§4.5 do contrato). Corta em `MAX_OCORRENCIAS_POR_CONSULTA`.
 */
export function ocorrenciasNoPeriodo(
  serie: SerieDoEvento,
  de: string,
  ate: string,
  fuso: string,
): OcorrenciaDoEvento[] {
  const base = baseDaSerie(serie, fuso);
  const inicio = instanteLocal(de, "00:00", fuso).getTime();
  const fim = instanteLocal(somarDias(ate, 1), "00:00", fuso).getTime();
  // A ocorrência que começa até `vao` dias antes de `de` ainda pode entrar
  // nele; um dia a mais cobre a virada de horário de verão.
  const recuo = somarDias(de, -(base.vao + 1));
  const primeiro = recuo > base.horario.date ? recuo : base.horario.date;
  const { until } = serie.recurrence;
  const ultimo = until !== null && until < ate ? until : ate;

  const achadas: OcorrenciaDoEvento[] = [];
  for (
    let dia = primeiro;
    dia <= ultimo && achadas.length < MAX_OCORRENCIAS_POR_CONSULTA;
    dia = somarDias(dia, 1)
  ) {
    const ocorrencia = ocorrenciaSobre(serie, base, dia, fuso);
    if (!ocorrencia) continue;
    if (ocorrencia.startsAt.getTime() < fim && ocorrencia.endsAt.getTime() > inicio) {
      achadas.push(ocorrencia);
    }
  }
  return achadas;
}

/**
 * A primeira ocorrência **viva** da série — a gravada, salvo se cancelada;
 * então a seguinte que não esteja em `exdates`. `null` se não sobra nenhuma.
 * É o que `GET /events/:id` mostra da série: a gravada em `exdates` não
 * aparece em lugar nenhum, e abri-la seria editar o que não existe.
 */
export function primeiraOcorrenciaViva(
  serie: SerieDoEvento,
  fuso: string,
): OcorrenciaDoEvento | null {
  const base = baseDaSerie(serie, fuso);
  const primeiro = base.horario.date;
  // Sem fim, cada cancelamento tira no máximo um dia: uma semana a mais que
  // eles garante achar a viva sem varrer o futuro.
  const ultimo = serie.recurrence.until ?? somarDias(primeiro, 7 * (serie.exdates.length + 1));
  for (let dia = primeiro; dia <= ultimo; dia = somarDias(dia, 1)) {
    const ocorrencia = ocorrenciaSobre(serie, base, dia, fuso);
    if (ocorrencia) return ocorrencia;
  }
  return null;
}

/**
 * Se a série ainda tem alguma ocorrência viva. Cancelar a última que restava
 * ("esta") ou encerrar antes da primeira viva ("seguintes") deixaria uma linha
 * que não aparece em lugar nenhum; o servidor a apaga.
 */
export function restaOcorrencia(serie: SerieDoEvento, fuso: string): boolean {
  return primeiraOcorrenciaViva(serie, fuso) !== null;
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

/// A regra que cruza com o horário (série de um dia, `until` depois do início)
/// roda em `resolverSerie`, sobre o evento inteiro.
export const repeticaoSchema = z.object({
  days: z
    .array(z.number().int().min(0, "Dia da semana de 0 a 6").max(6, "Dia da semana de 0 a 6"))
    .min(1, "Escolha pelo menos um dia da semana")
    .max(7)
    .refine(semRepetir, "Dia da semana repetido"),
  until: diaCivilSchema.nullable().optional(),
});

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
  /// Repetição semanal. `null` ou ausente: não repete. No PATCH, `null` faz da
  /// série um evento simples (na primeira ocorrência).
  repeat: repeticaoSchema.nullable().optional(),
  /// Só o servidor MCP envia — ver `createNoteSchema.origin`.
  origin: origemMcpSchema.optional(),
});

function acusar(problemas: FieldIssue[], ctx: z.RefinementCtx) {
  for (const problema of problemas) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: problema.path.split("."),
      message: problema.message,
    });
  }
}

export const eventInputSchema = camposDoEvento.superRefine((evento, ctx) => {
  acusar(resolverSerie(evento, evento.repeat).problemas, ctx);
});

/// Sem `origin`: a marca nasce na criação (INV-58). A regra cruzada roda no
/// servidor, sobre o horário mesclado (`mesclarHorario`).
export const eventUpdateSchema = camposDoEvento
  .omit({ origin: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/**
 * O corpo de `POST /tasks/:id/to-event`: a tarefa vira evento, e o que vier
 * aqui passa por cima do que se tira dela (título, descrição, dia, hora,
 * projeto). Tudo opcional, inclusive o corpo vazio — ao contrário do PATCH,
 * converter sem mudar nada é o caso comum. Sem `origin`: a marca de IA do
 * evento é a da tarefa, copiada (INV-58).
 */
export const taskToEventSchema = camposDoEvento.omit({ origin: true }).partial();

/**
 * O alcance de `PATCH` e `DELETE /events/:id`, pela query string. Sem `scope`,
 * vale `todas` — o que a rota fazia antes da série, e o que o Desfazer do chat
 * (apagar o que criou) quer. `occurrenceDate` é o `EventItem.occurrenceDate`
 * da ocorrência tocada: obrigatório para `esta` e `seguintes` numa série, e
 * quem o cobra é o servidor, que sabe se é série. Num evento simples o escopo
 * não conta.
 */
export const eventScopeSchema = z.object({
  scope: z.enum(ESCOPOS_DO_EVENTO).default("todas"),
  occurrenceDate: diaCivilSchema.optional(),
});

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
export type TaskToEventInput = z.input<typeof taskToEventSchema>;
export type EventScope = z.infer<typeof eventScopeSchema>;

/**
 * O alcance de `POST /events/:id/to-task`. Ao contrário do PATCH e do DELETE,
 * **sem padrão**: numa série, converter sem dizer o alcance é recusado —
 * `todas` faz da série uma tarefa recorrente, e isso não se faz por omissão.
 */
export const conversionScopeSchema = z.object({
  scope: z.enum(["esta", "todas"]).optional(),
  occurrenceDate: diaCivilSchema.optional(),
});
export type ConversionScope = z.infer<typeof conversionScopeSchema>;
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
  /// O dia da ocorrência (frente de eventos recorrentes): numa série listada
  /// por período, cada ocorrência é um item, com `id` da série e os campos de
  /// horário acima **daquela ocorrência** — a chave na tela é `id` +
  /// `occurrenceDate`, e é ele que vai no `occurrenceDate` de PATCH e DELETE.
  /// No evento simples, e na série lida por `GET /events/:id`, é o `date`.
  occurrenceDate: string;
  /// A regra, ou `null` no evento simples.
  recurrence: EventRecurrence | null;
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
