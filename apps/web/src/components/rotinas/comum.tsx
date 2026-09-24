import type {
  RoutineConsumeAction,
  RoutineRunStatus,
  RoutineRunStep,
  RoutineRunStepStatus,
  RoutineStepMode,
} from "@yu-book/shared";
import type { ReactNode } from "react";
import { IconeAlerta, IconeCheck, IconeFechar, IconeParar, IconeRelogio } from "../Icones";

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
 * neutro, formas diferentes.
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
