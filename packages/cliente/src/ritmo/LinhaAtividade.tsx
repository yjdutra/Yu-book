import type { ReactNode } from "react";
import { IconeCheck } from "../Icones";

/**
 * Uma atividade de hábito com o check (frente Ritmo, RF-26): a caixa de 44px é
 * uma `checkbox` de verdade, e o marcado muda de forma — cheio em
 * `sucesso-500` com o check branco, o nome riscado —, não só de cor. O ponto
 * colorido é o tom do hábito (`--tom` num ancestral), e o nome do hábito vai
 * ao lado dele em `meta`.
 */
export function LinhaAtividade({
  nome,
  meta,
  pontos,
  feita,
  rotuloAcao,
  onAlternar,
  desabilitada = false,
  className = "",
  acao,
}: {
  nome: string;
  /** "Inglês · 19:00" — o hábito e o quando. */
  meta: ReactNode;
  pontos: number;
  feita: boolean;
  /** O nome da caixa: "Concluir “App de inglês”". */
  rotuloAcao: string;
  onAlternar: () => void;
  desabilitada?: boolean;
  /** A classe de `TOM_DO_HABITO`, para o ponto e o check. */
  className?: string;
  /** Um controle a mais no fim da linha — o foco da atividade (Ritmo 6). */
  acao?: ReactNode;
}) {
  return (
    <li
      className={`flex min-h-15 items-center gap-2 rounded-cartao py-1.5 pl-1 pr-3 transition-colors
                  duration-200 ${feita ? "bg-sucesso-500/12" : "bg-ink-900"} ${className}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={feita}
        aria-label={rotuloAcao}
        onClick={onAlternar}
        disabled={desabilitada}
        className="grid size-11 shrink-0 place-items-center rounded-cartao disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`grid size-8 place-items-center rounded-[11px] border-2 transition duration-200 ${
            feita ? "border-sucesso-500 bg-sucesso-500 text-white" : "border-ink-700 text-transparent"
          }`}
        >
          <IconeCheck className="size-4.5" />
        </span>
      </button>
      {/* O nome inteiro em cima, quebrando linha; meta, pontos e ação embaixo —
          numa linha só, eles espremiam o nome até o truncar. */}
      <span className="min-w-0 flex-1">
        <span
          className={`block break-words text-[0.9375rem] font-semibold ${
            feita ? "text-ink-400 line-through decoration-ink-700" : "text-titulo"
          }`}
        >
          {nome}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-400">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-(--tom)" />
            <span className="truncate">{meta}</span>
          </span>
          <PilulaPontos pontos={pontos} />
          {acao}
        </span>
      </span>
    </li>
  );
}

/** "+30" em ouro: os pontos de uma atividade. O sinal "+" e o número dizem tudo. */
export function PilulaPontos({ pontos }: { pontos: number }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full bg-ouro-500/14 px-2 py-0.5 text-xs
                 font-bold tabular-nums text-ouro-300"
    >
      +{pontos}
      <span className="sr-only"> pontos</span>
    </span>
  );
}
