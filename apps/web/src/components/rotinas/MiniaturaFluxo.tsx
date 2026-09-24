import type { AgentColor, RoutineStepMode } from "@yu-book/shared";
import { Fragment } from "react";
import { AvatarAgente } from "../agentes/AvatarAgente";
import { IconeBoard, IconeCheck } from "../Icones";
import { ROTULO_MODO } from "./comum";

export interface PassoDaMiniatura {
  nome: string;
  cor: AgentColor | null;
  mode: RoutineStepMode;
}

/** O traço entre dois nós, com a ponta — o mesmo desenho do conector do editor. */
function Ligacao() {
  return (
    <svg
      viewBox="0 0 20 8"
      aria-hidden="true"
      className="h-2 w-4 shrink-0 text-ink-700"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 4h16M14 1.5 17.5 4 14 6.5" />
    </svg>
  );
}

/**
 * O fluxo de uma rotina em uma linha: `Ideias → (LI) → (MK) → (RV) → Saída`.
 *
 * O desenho é `aria-hidden` e a frase por extenso vai para o leitor de tela —
 * uma fila de iniciais lida em voz alta não diz nada. O agente excluído
 * aparece tracejado **e** com "(excluído)" na frase.
 */
export function MiniaturaFluxo({
  entrada,
  passos,
  saida,
}: {
  entrada: string;
  passos: PassoDaMiniatura[];
  saida: string;
}) {
  const frase =
    `Fluxo: ideias de ${entrada}; ` +
    passos
      .map((p) => `${p.nome}${p.cor ? "" : " (excluído)"} ${ROTULO_MODO[p.mode].curto}`)
      .join(", depois ") +
    `; o card sai em ${saida}.`;

  return (
    <div className="min-w-0">
      <p className="sr-only">{frase}</p>
      <div aria-hidden="true" className="flex min-w-0 items-center gap-1 overflow-hidden">
        <span
          className="inline-flex min-w-0 shrink items-center gap-1 rounded-etiqueta border
                     border-ink-700 bg-ink-900/60 px-1.5 py-0.5 text-miudo text-ink-400"
        >
          <IconeBoard className="size-3" />
          <span className="truncate">{entrada}</span>
        </span>
        {passos.map((p, i) => (
          <Fragment key={i}>
            <Ligacao />
            <span title={`${p.nome} · ${ROTULO_MODO[p.mode].curto}`} className="shrink-0">
              <AvatarAgente nome={p.nome} cor={p.cor ?? "cinza"} tamanho="m" excluido={!p.cor} />
            </span>
          </Fragment>
        ))}
        <Ligacao />
        <span
          className="inline-flex min-w-0 shrink items-center gap-1 rounded-etiqueta border
                     border-ia-500/40 bg-linear-to-r from-accent-500/10 to-ia-500/10 px-1.5
                     py-0.5 text-miudo text-accent-400"
        >
          <IconeCheck className="size-3" />
          <span className="truncate">{saida}</span>
        </span>
      </div>
    </div>
  );
}
