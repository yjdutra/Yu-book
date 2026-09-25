import { z } from "zod";
import { diaLocal } from "./ia.js";

/**
 * Agenda de rotina — Etapa F da frente de IA (`docs/prd-ia-no-yu-book.md`).
 *
 * Uma rotina agendada roda sozinha em dias da semana e horários escolhidos,
 * **no fuso do usuário** (`ai_preference.timezone`). Quem dispara é um relógio
 * dentro da API (`agendador.service.ts`); a tela usa as mesmas funções daqui
 * para a prévia "Próximas", e as duas concordam porque a conta é uma só.
 *
 * O projeto não tem biblioteca de datas. O deslocamento do fuso vem do `Intl`,
 * que resolve horário de verão sem tabela nossa — a mesma técnica que
 * `diaParaPrazo` (`formato.ts`) usava sozinha e agora usa daqui.
 *
 * **Nenhuma função daqui tem `fuso` com valor padrão.** Um padrão traria de
 * volta o defeito que a Etapa B consertou: o fuso do *processo* passando por
 * fuso do usuário (§4.5 da skill do contrato). Quem chama diz de qual fuso
 * está falando.
 */

/// Até quatro horários por rotina: mais que isso é um laço, não uma agenda.
export const MAX_HORARIOS_DA_AGENDA = 4;

/// Quantos próximos horários a rotina e o Início mostram.
export const PROXIMOS_HORARIOS = 3;

/**
 * A regra de recusa no horário, decidida pelo operador: recusa de início
 * (outra execução rodando, sem ideia, teto do dia, rotina inválida) tenta de
 * novo a cada 5 minutos, no máximo 3 vezes no total, e depois fica `pulada`
 * com o motivo. Recusa de início não chama o provedor e não custa nada;
 * execução que **começou** e falhou nunca é repetida — é ela que cobraria de
 * novo a cada tentativa.
 */
export const TENTATIVAS_DO_HORARIO = 3;
export const INTERVALO_ENTRE_TENTATIVAS_MS = 5 * 60_000;

/**
 * Até quanto tempo depois do horário o agendador ainda o atende. Cobre as três
 * tentativas (0, 5 e 10 min) com a folga do relógio de 1 minuto, e um
 * reinício curto da API. Horário perdido com a API fora por mais que isso
 * **não é recuperado** — rodar às 14h o post das 8h não é o que se pediu.
 */
export const JANELA_DO_AGENDADOR_MS = 15 * 60_000;

/// `HH:MM`, 00:00 a 23:59.
export const HORA_DA_AGENDA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A agenda como o banco a guarda. Dias 0–6, com 0 = domingo. */
export interface RoutineSchedule {
  days: number[];
  times: string[];
  active: boolean;
}

/// A agenda de quem nunca agendou: a forma de antes da Etapa F.
export const AGENDA_DESLIGADA: RoutineSchedule = { days: [], times: [], active: false };

const semRepetir = (lista: readonly unknown[]) => new Set(lista).size === lista.length;

/**
 * Os campos, sem a regra que cruza campo. O PATCH manda só o que muda
 * (pausar e retomar é `{ active }` sozinho), e o servidor confere a agenda
 * **mesclada** com `problemasDaAgenda` — mesmo arranjo de `problemasDeForma`.
 */
export const camposDaAgenda = z.object({
  days: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine(semRepetir, "Dia da semana repetido"),
  times: z
    .array(z.string().regex(HORA_DA_AGENDA, "Horário no formato HH:MM"))
    .max(MAX_HORARIOS_DA_AGENDA, `No máximo ${MAX_HORARIOS_DA_AGENDA} horários`)
    .refine(semRepetir, "Horário repetido"),
  active: z.boolean(),
});

/**
 * Agenda desligada pode ficar vazia — é a de quem nunca agendou. Ligada
 * precisa de pelo menos um dia e um horário, ou "Rodar sozinha" não rodaria
 * nunca, calado.
 */
export function problemasDaAgenda(agenda: RoutineSchedule): { path: string; message: string }[] {
  if (!agenda.active) return [];
  const problemas: { path: string; message: string }[] = [];
  if (agenda.days.length === 0) {
    problemas.push({ path: "schedule.days", message: "Escolha pelo menos um dia da semana" });
  }
  if (agenda.times.length === 0) {
    problemas.push({ path: "schedule.times", message: "Escolha pelo menos um horário" });
  }
  return problemas;
}

export const scheduleSchema = camposDaAgenda.superRefine((agenda, ctx) => {
  for (const problema of problemasDaAgenda(agenda)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [problema.path.replace("schedule.", "")],
      message: problema.message,
    });
  }
});

/// O PATCH da agenda: só o que muda. Vazio não é pedido de nada.
export const scheduleUpdateSchema = camposDaAgenda
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar na agenda");

export type ScheduleInput = z.input<typeof scheduleSchema>;
export type ScheduleUpdateInput = z.input<typeof scheduleUpdateSchema>;

/* -------------------------------------------------------------- instantes */

/**
 * As partes de um instante vistas em `fuso`, reinterpretadas como se fossem
 * UTC. A diferença para o próprio instante é o deslocamento do fuso naquela
 * data — inclusive horário de verão, sem tabela nossa.
 */
function comoSeFosseUtc(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instante));

  const campo = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  /// `hour12: false` devolve 24 na meia-noite em algumas plataformas.
  const hora = campo("hour") % 24;
  return Date.UTC(
    campo("year"),
    campo("month") - 1,
    campo("day"),
    hora,
    campo("minute"),
    campo("second"),
  );
}

const DIA_MS = 24 * 60 * 60_000;
const MINUTO_MS = 60_000;

/**
 * O instante em que o relógio de parede de `fuso` marca `dia` e `hora`.
 *
 * `hora` é `HH:MM` ou `HH:MM:SS` (o prazo usa 23:59:59). O deslocamento
 * depende da própria data, e perto de uma virada de horário de verão ele muda
 * entre um lado e outro — por isso se tentam os deslocamentos de um dia antes
 * e de um dia depois, e fica o candidato cujo relógio marca de fato o alvo:
 *
 * - **Hora repetida** (o relógio volta): as duas servem, fica a **primeira**.
 *   O horário roda uma vez só.
 * - **Hora que não existe** (o relógio pula): nenhuma serve, e o resultado é
 *   a **primeira hora que existe** depois dela — 02:30 em Nova York no dia da
 *   virada vira 03:00. Rodar um pouco depois é melhor que não rodar.
 *
 * Formato ou data impossível (`2026-02-30`, `24:00`) lança `RangeError`.
 */
export function instanteLocal(dia: string, hora: string, fuso: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  const h = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
  if (!d || !h) throw new RangeError(`Data ou hora fora do formato: ${dia} ${hora}`);
  const [ano, mes, dd] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hh, mm, ss] = [Number(h[1]), Number(h[2]), Number(h[3] ?? "0")];
  const alvo = Date.UTC(ano, mes - 1, dd, hh, mm, ss);
  const conferido = new Date(alvo);
  if (
    hh > 23 ||
    mm > 59 ||
    ss > 59 ||
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dd
  ) {
    throw new RangeError(`Data ou hora inexistente: ${dia} ${hora}`);
  }

  const deslocamento = (instante: number) => comoSeFosseUtc(instante, fuso) - instante;
  const candidatos = [alvo - deslocamento(alvo - DIA_MS), alvo - deslocamento(alvo + DIA_MS)];
  const validos = candidatos.filter((t) => comoSeFosseUtc(t, fuso) === alvo);
  if (validos.length > 0) return new Date(Math.min(...validos));

  /// No buraco: o menor instante cujo relógio já passou do alvo. O relógio é
  /// crescente entre os dois candidatos, e a virada cai em minuto cheio.
  let baixo = Math.floor(Math.min(...candidatos) / MINUTO_MS);
  let alto = Math.ceil(Math.max(...candidatos) / MINUTO_MS);
  while (baixo < alto) {
    const meio = Math.floor((baixo + alto) / 2);
    if (comoSeFosseUtc(meio * MINUTO_MS, fuso) >= alvo) alto = meio;
    else baixo = meio + 1;
  }
  return new Date(alto * MINUTO_MS);
}

/**
 * `AAAA-MM-DD` mais `n` dias de calendário (`n` pode ser negativo).
 *
 * Aritmética sobre as partes do texto, com `Date.UTC` e o corte do ISO — que é
 * UTC por construção, e por isso aqui o `.slice(0, 10)` é seguro. Não passa
 * pelo fuso do processo nem pelo do usuário: o dia já chega local. Exportada
 * para a janela do AI usage dash (`uso.service.ts`), que conta dias sobre o
 * `localDay` gravado; uma segunda cópia seria mais um lugar para divergir.
 */
export function somarDias(dia: string, n: number): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** 0 = domingo. O dia da semana é do calendário, não depende de fuso. */
function diaDaSemana(dia: string): number {
  const [ano, mes, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Os horários de um dia local, em ordem e sem repetir instante. */
function horariosDoDia(agenda: Pick<RoutineSchedule, "days" | "times">, dia: string, fuso: string) {
  if (!agenda.days.includes(diaDaSemana(dia))) return [];
  return agenda.times.map((hora) => instanteLocal(dia, hora, fuso));
}

/// Dois horários no mesmo buraco de horário de verão viram o mesmo instante —
/// e o mesmo horário não roda duas vezes.
function ordenarSemRepetir(instantes: Date[]): Date[] {
  const vistos = new Map<number, Date>();
  for (const t of instantes) vistos.set(t.getTime(), t);
  return [...vistos.values()].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Os próximos `n` horários **depois** de `depoisDe` (estritamente), em ordem.
 * Vazio se a agenda não tem dia ou horário. Não olha `active`: quem chama
 * decide se a rotina pausada mostra alguma coisa.
 */
export function proximosHorarios(
  agenda: Pick<RoutineSchedule, "days" | "times">,
  fuso: string,
  depoisDe: Date,
  n: number,
): Date[] {
  if (agenda.days.length === 0 || agenda.times.length === 0 || n <= 0) return [];
  const achados: Date[] = [];
  let dia = diaLocal(depoisDe, fuso);
  /// Uma semana e um dia bastam para achar ao menos um horário; o resto é
  /// para `n` maior que os horários de uma semana.
  const limite = 8 + Math.ceil(n / (agenda.days.length * agenda.times.length)) * 7;
  for (let volta = 0; volta < limite && achados.length < n; volta += 1) {
    for (const t of ordenarSemRepetir(horariosDoDia(agenda, dia, fuso))) {
      if (t.getTime() > depoisDe.getTime() && !achados.some((a) => a.getTime() === t.getTime())) {
        achados.push(t);
      }
    }
    dia = somarDias(dia, 1);
  }
  return achados.slice(0, n);
}

/**
 * Os horários em `[de, ate]`, com as duas pontas, em ordem. É o que o
 * agendador atende numa volta: `de` é o começo da janela de recuperação.
 */
export function horariosDevidos(
  agenda: Pick<RoutineSchedule, "days" | "times">,
  fuso: string,
  de: Date,
  ate: Date,
): Date[] {
  if (agenda.days.length === 0 || agenda.times.length === 0) return [];
  const instantes: Date[] = [];
  /// Um dia de folga de cada lado: o dia local de `de` e o de `ate` podem ser
  /// diferentes, e o instante de um horário pode cair no dia vizinho perto de
  /// uma virada de horário de verão.
  const ultimo = somarDias(diaLocal(ate, fuso), 1);
  for (let dia = somarDias(diaLocal(de, fuso), -1); dia <= ultimo; dia = somarDias(dia, 1)) {
    for (const t of horariosDoDia(agenda, dia, fuso)) {
      if (t.getTime() >= de.getTime() && t.getTime() <= ate.getTime()) instantes.push(t);
    }
  }
  return ordenarSemRepetir(instantes);
}

/**
 * Quando o horário recusado tenta de novo, ou `null` se não tenta mais. Uma
 * definição só para o agendador decidir e para a tela dizer "tenta de novo às
 * 08:05" em vez de "pulada" enquanto ainda há tentativa.
 *
 * Só a linha `pulada` de um horário agendado tenta de novo; a tentativa
 * precisa caber na janela do agendador, ou ele nem vai olhar para o horário.
 * Uma pausa ou uma troca de horário no meio também encerram as tentativas —
 * isso a linha não sabe dizer.
 */
export function proximaTentativa(run: {
  status: string;
  attempts: number | null;
  endedAt: string | null;
  scheduledFor: string | null;
}): Date | null {
  if (run.status !== "pulada" || !run.scheduledFor || !run.endedAt) return null;
  if ((run.attempts ?? TENTATIVAS_DO_HORARIO) >= TENTATIVAS_DO_HORARIO) return null;
  const quando = new Date(run.endedAt).getTime() + INTERVALO_ENTRE_TENTATIVAS_MS;
  const fimDaJanela = new Date(run.scheduledFor).getTime() + JANELA_DO_AGENDADOR_MS;
  return quando <= fimDaJanela ? new Date(quando) : null;
}
