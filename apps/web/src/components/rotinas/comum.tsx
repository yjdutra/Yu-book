import type {
  RoutineConsumeAction,
  RoutineRunStatus,
  RoutineRunTrigger,
  RoutineRunStep,
  RoutineRunStepStatus,
  RoutineStepMode,
} from "@yu-book/shared";
import type { ReactNode } from "react";
import { IconeAlerta, IconeCheck, IconeFechar, IconeParar, IconeRelogio } from "../Icones";

/**
 * A execução que pede atenção: falhou, foi interrompida (um deploy ou reinício
 * a cortou), ou foi pulada (Etapa F) — o horário agendado não conseguiu
 * começar. Não criou nada, e ninguém viu acontecer: é o "nada falha calado" da
 * agenda. Uma regra só para o painel contextual e o bloco do Início.
 */
export function pedeAtencao(
  status: RoutineRunStatus | undefined,
): "falhou" | "pulada" | "interrompida" | null {
  return status === "falhou" || status === "pulada" || status === "interrompida"
    ? status
    : null;
}

/**
 * O vocabulário das rotinas que a galeria, o editor e a execução dizem igual.
 *
 * Os `Record` são totais de propósito (INV-54): um status novo no enum de
 * `shared` não compila sem rótulo, glifo e tom aqui — e a tela que o percorre
 * o mostra sozinha.
 */

/** O modo de um passo, como a etiqueta do bloco o diz. */
export const ROTULO_MODO: Record<RoutineStepMode, { curto: string; explica: string }> = {
  reescreve: {
    curto: "reescreve",
    explica: "Substitui o rascunho pelo que este agente escrever.",
  },
  revisa: {
    curto: "revisa",
    explica:
      "Aponta observações sem mexer no rascunho. Elas seguem para o passo seguinte e vão " +
      "para a seção Observações do card.",
  },
};

/** Glifo do modo, sempre ao lado da palavra (RNF-09). */
export const GLIFO_MODO: Record<RoutineStepMode, string> = { reescreve: "✎", revisa: "◎" };

export const ROTULO_CONSUMO: Record<RoutineConsumeAction, { titulo: string; explica: string }> = {
  mover: {
    titulo: "Mover para outra coluna",
    explica: "A ideia usada sai da entrada — o próximo “Rodar agora” pega a seguinte.",
  },
  arquivar: {
    titulo: "Arquivar",
    explica: "A ideia usada vai para o arquivo do quadro.",
  },
  manter: {
    titulo: "Deixar onde está",
    explica:
      "A ideia fica na entrada. Mesmo assim ela não é pega de novo: a rotina lembra das " +
      "execuções concluídas.",
  },
};

type Tom = "neutro" | "andamento" | "ok" | "erro" | "alerta";

const CLASSE_TOM: Record<Tom, string> = {
  neutro: "border-ink-700 text-ink-400",
  andamento: "border-accent-500/50 bg-accent-500/10 text-accent-400",
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  erro: "border-red-500/40 bg-red-500/10 text-red-300",
  alerta: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

/** Ponto que pulsa — o "rodando". O bloco de `prefers-reduced-motion` o para. */
export function Pulso({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-flex size-2 shrink-0 ${className}`}>
      <span className="absolute inset-0 animate-ping rounded-full bg-accent-400 opacity-60" />
      <span className="relative size-2 rounded-full bg-accent-400" />
    </span>
  );
}

const ICONE_TOM: Record<Tom, ReactNode> = {
  neutro: <IconeRelogio className="size-3" />,
  andamento: <Pulso />,
  ok: <IconeCheck className="size-3" />,
  erro: <IconeFechar className="size-3" />,
  alerta: <IconeAlerta className="size-3" />,
};

export const STATUS_DA_EXECUCAO: Record<RoutineRunStatus, { rotulo: string; tom: Tom }> = {
  em_andamento: { rotulo: "em andamento", tom: "andamento" },
  concluida: { rotulo: "concluída", tom: "ok" },
  falhou: { rotulo: "falhou", tom: "erro" },
  cancelada: { rotulo: "cancelada", tom: "neutro" },
  interrompida: { rotulo: "interrompida", tom: "alerta" },
  pulada: { rotulo: "pulada", tom: "alerta" },
};

/**
 * Quem disparou a execução (Etapa F). "Agendada" é a palavra que a galeria, o
 * histórico, a execução e o Início dizem igual.
 */
export const ROTULO_GATILHO: Record<RoutineRunTrigger, string> = {
  manual: "manual",
  agenda: "agendada",
};

export const STATUS_DO_PASSO: Record<RoutineRunStepStatus, { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: "pendente", tom: "neutro" },
  rodando: { rotulo: "rodando", tom: "andamento" },
  concluido: { rotulo: "concluído", tom: "ok" },
  falhou: { rotulo: "falhou", tom: "erro" },
  pulado: { rotulo: "pulado", tom: "neutro" },
};

function Selo({ rotulo, tom, icone }: { rotulo: string; tom: Tom; icone: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-etiqueta border px-1.5 py-0.5
                  text-miudo font-medium ${CLASSE_TOM[tom]}`}
    >
      {icone}
      {rotulo}
    </span>
  );
}

/**
 * O status com ícone **e** palavra — nunca só a cor (RNF-09). "Cancelada" e
 * "pulado" trocam o relógio pelo quadrado de parar e pelo traço: o mesmo tom
 * neutro, formas diferentes. "Pulada" (a execução agendada que não chegou a
 * começar) divide o tom de alerta com "interrompida", e a seta de desvio a
 * separa dela.
 */
export function SeloStatus({
  status,
  tipo = "execucao",
}: {
  status: RoutineRunStatus | RoutineRunStepStatus;
  tipo?: "execucao" | "passo";
}) {
  const info =
    tipo === "execucao"
      ? STATUS_DA_EXECUCAO[status as RoutineRunStatus]
      : STATUS_DO_PASSO[status as RoutineRunStepStatus];
  const icone =
    status === "cancelada" ? (
      <IconeParar className="size-3" />
    ) : status === "pulado" ? (
      <span aria-hidden="true">–</span>
    ) : status === "pulada" ? (
      <span aria-hidden="true">↷</span>
    ) : (
      ICONE_TOM[info.tom]
    );
  return <Selo rotulo={info.rotulo} tom={info.tom} icone={icone} />;
}

/**
 * O passo interrompido pelo "Cancelar" é gravado `falhou` com o código
 * `CANCELADA` — o enum do passo não tem "cancelado", e o contrato fica como
 * está. A tela o diz como cancelamento, não como falha: quem cancelou não
 * precisa ler "falhou" no passo que ele mesmo parou.
 */
export function passoCancelado(passo: Pick<RoutineRunStep, "status" | "errorCode">): boolean {
  return passo.status === "falhou" && passo.errorCode === "CANCELADA";
}

/** A palavra do status do passo, com o cancelamento à parte — para selo e leitor de tela. */
export function rotuloDoPasso(passo: Pick<RoutineRunStep, "status" | "errorCode">): string {
  return passoCancelado(passo) ? "cancelado" : STATUS_DO_PASSO[passo.status].rotulo;
}

/** O selo de um passo gravado: o de `SeloStatus`, ou o de parar quando foi cancelado. */
export function SeloPasso({ passo }: { passo: Pick<RoutineRunStep, "status" | "errorCode"> }) {
  return passoCancelado(passo) ? (
    <Selo rotulo="cancelado" tom="neutro" icone={<IconeParar className="size-3" />} />
  ) : (
    <SeloStatus status={passo.status} tipo="passo" />
  );
}

/** "1,2 s", "3 min 20 s". */
export function duracao(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s.toLocaleString("pt-BR")} s`;
  const min = Math.floor(s / 60);
  return `${min} min ${Math.round(s % 60)} s`;
}

/** O tempo entre dois instantes, ou até agora se não terminou. */
export function duracaoEntre(inicio: string | null, fim: string | null, agora = Date.now()) {
  if (!inicio) return null;
  const fimMs = fim ? new Date(fim).getTime() : agora;
  return Math.max(0, fimMs - new Date(inicio).getTime());
}

/** "hoje, 14:32", "ontem, 09:10", "12/09, 18:03". */
export function quando(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}, ${hora}`;
}

export const NUMERO = new Intl.NumberFormat("pt-BR");

/* ------------------------------------------------------------------ agenda */

/**
 * Os dias da semana na ordem do contrato: 0 = domingo (`RoutineSchedule`).
 * O nome curto vai escrito na pílula — "D S T Q Q S S" repete letra e não se
 * lê sozinho —, e o longo, no nome acessível.
 */
export const DIAS_DA_SEMANA = [
  { curto: "Dom", longo: "domingo" },
  { curto: "Seg", longo: "segunda-feira" },
  { curto: "Ter", longo: "terça-feira" },
  { curto: "Qua", longo: "quarta-feira" },
  { curto: "Qui", longo: "quinta-feira" },
  { curto: "Sex", longo: "sexta-feira" },
  { curto: "Sáb", longo: "sábado" },
] as const;

/**
 * Formatadores por fuso, guardados: montar um `Intl.DateTimeFormat` custa, e
 * a mesma tela formata dezenas de horários a cada render.
 */
const FORMATADORES = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string, opcoes: Intl.DateTimeFormatOptions, chave: string) {
  const id = `${fuso}|${chave}`;
  let f = FORMATADORES.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: fuso });
    FORMATADORES.set(id, f);
  }
  return f;
}

/** `AAAA-MM-DD` do instante no relógio de `fuso` — só para comparar dias. */
function diaNoFuso(instante: Date, fuso: string): string {
  const partes = formatador(
    fuso,
    { year: "numeric", month: "2-digit", day: "2-digit" },
    "dia",
  ).formatToParts(instante);
  const campo = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${campo("year")}-${campo("month")}-${campo("day")}`;
}

/**
 * Um horário da agenda como o relógio **do usuário** o marca: "hoje 08:00",
 * "amanhã 08:00", "ter 30/09 08:00". O fuso é o de `/ajustes`
 * (`ai_preference.timezone`), nunca o do navegador — é por ele que o servidor
 * dispara, e os dois podem divergir (a pessoa viajando). Por isso não tem
 * valor padrão: quem chama diz de qual fuso fala.
 *
 * `curto` tira a data dos dias da próxima semana ("ter 08:00") — é o selo do
 * cabeçalho e a linha do cartão, onde cabe pouco.
 */
export function horarioNoFuso(
  iso: string | Date,
  fuso: string,
  forma: "curto" | "longo" = "longo",
  agora: Date = new Date(),
): string {
  const instante = typeof iso === "string" ? new Date(iso) : iso;
  const hora = horaNoFuso(instante, fuso);
  const dia = diaNoFuso(instante, fuso);
  const hoje = diaNoFuso(agora, fuso);
  const amanha = diaNoFuso(new Date(agora.getTime() + 24 * 60 * 60_000), fuso);
  if (dia === hoje) return `hoje ${hora}`;
  if (dia === amanha) return `amanhã ${hora}`;
  const semana = formatador(fuso, { weekday: "short" }, "semana")
    .format(instante)
    .replace(".", "");
  const emSeisDias = instante.getTime() - agora.getTime() < 6 * 24 * 60 * 60_000;
  if (forma === "curto" && emSeisDias) return `${semana} ${hora}`;
  const data = formatador(fuso, { day: "2-digit", month: "2-digit" }, "data").format(instante);
  return `${semana} ${data} ${hora}`;
}

/** Só a hora, no relógio do usuário: "08:05". */
export function horaNoFuso(iso: string | Date, fuso: string): string {
  const instante = typeof iso === "string" ? new Date(iso) : iso;
  /// `h23`, e não `hour12: false`: este devolve "24:00" à meia-noite em
  /// alguns motores.
  const opcoes = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  return formatador(fuso, opcoes, "hora").format(instante);
}

/** "America/Sao_Paulo" → "America/Sao Paulo": o nome IANA, legível. */
export const nomeDoFuso = (fuso: string) => fuso.replaceAll("_", " ");
