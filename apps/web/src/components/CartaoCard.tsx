import type { CardPriority, CardSummary } from "@yu-book/shared";
import { memo } from "react";

/** RF-32: vencido e "vence logo" são estados diferentes, com destaques diferentes. */
export type EstadoPrazo = "vencido" | "proximo" | "normal";

const HORAS_48 = 48 * 60 * 60 * 1000;

export function estadoDoPrazo(dueDate: string | null, agora = Date.now()): EstadoPrazo | null {
  if (!dueDate) return null;
  const prazo = new Date(dueDate).getTime();
  if (prazo < agora) return "vencido";
  if (prazo - agora <= HORAS_48) return "proximo";
  return "normal";
}

const ESTILO_PRAZO: Record<EstadoPrazo, { classe: string; sigla: string; rotulo: string }> = {
  // RNF-07: cada estado tem símbolo próprio, então não depende de cor.
  vencido: { classe: "border-red-500/40 text-red-300", sigla: "!", rotulo: "vencido" },
  proximo: { classe: "border-amber-500/40 text-amber-300", sigla: "◷", rotulo: "vence logo" },
  normal: { classe: "border-ink-700 text-ink-400", sigla: "▤", rotulo: "prazo" },
};

const ESTILO_PRIORIDADE: Record<CardPriority, { sigla: string; classe: string }> = {
  alta: { sigla: "⬆", classe: "text-rose-300" },
  media: { sigla: "=", classe: "text-ink-400" },
  baixa: { sigla: "⬇", classe: "text-sky-300" },
};

/** RF-07: a face mostra três; o resto vira `+n`, com todas no `title`. */
const TAGS_NA_FACE = 3;

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

interface CartaoCardProps {
  card: CardSummary;
  /** Sombra e rotação do card enquanto está sendo arrastado. */
  arrastando?: boolean;
}

/**
 * RF-31: a face do card. Sem descrição — ela vive no painel.
 *
 * RF-25: memoizado porque é o único componente da árvore do quadro que não lê
 * o contexto do `SortableContext` — quem lê repinta de qualquer jeito. Durante
 * o arraste, `moverLocal` preserva a identidade de todo card que não se moveu,
 * então nenhum deles repinta.
 */
export const CartaoCard = memo(function CartaoCard({
  card,
  arrastando = false,
}: CartaoCardProps) {
  const prazo = estadoDoPrazo(card.dueDate);
  const prioridade = ESTILO_PRIORIDADE[card.priority];

  return (
    <div
      className={`rounded-lg border bg-ink-800 px-3 py-2 text-left transition ${
        arrastando
          ? "border-accent-400 shadow-2xl"
          : "border-ink-700 hover:border-ink-400"
      } ${prazo === "vencido" ? "border-l-2 border-l-red-500" : ""}`}
    >
      <p className="text-sm leading-snug text-ink-200">{card.title}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {card.dueDate && prazo && (
          <span
            className={`inline-flex items-center gap-1 rounded border px-1 ${ESTILO_PRAZO[prazo].classe}`}
            title={`${ESTILO_PRAZO[prazo].rotulo}: ${new Date(card.dueDate).toLocaleDateString("pt-BR")}`}
          >
            <span aria-hidden="true">{ESTILO_PRAZO[prazo].sigla}</span>
            {dataCurta(card.dueDate)}
            <span className="sr-only"> — {ESTILO_PRAZO[prazo].rotulo}</span>
          </span>
        )}

        {card.priority !== "media" && (
          <span className={`inline-flex items-center gap-0.5 ${prioridade.classe}`}>
            <span aria-hidden="true">{prioridade.sigla}</span>
            {card.priority}
          </span>
        )}

        {card.checklistTotal > 0 && (
          <span
            className="tabular-nums text-ink-400"
            title={`${card.checklistDone} de ${card.checklistTotal} itens feitos`}
          >
            ☑ {card.checklistDone}/{card.checklistTotal}
          </span>
        )}

        {/* RF-07: rótulo, não botão — o card inteiro é a alça de arraste, e um
            alvo clicável aqui dentro competiria com o gesto. */}
        {card.tags.slice(0, TAGS_NA_FACE).map((tag) => (
          <span key={tag} className="rounded bg-ink-700 px-1.5 text-ink-400">
            {tag}
          </span>
        ))}
        {card.tags.length > TAGS_NA_FACE && (
          <span className="text-ink-400" title={card.tags.join(", ")}>
            +{card.tags.length - TAGS_NA_FACE}
          </span>
        )}

        {/* RF-31: o vínculo com nota é visível sem abrir o card. */}
        {card.note && (
          <span className="inline-flex max-w-32 items-center gap-1 text-ink-400" title={card.note.title}>
            <span aria-hidden="true">📎</span>
            <span className="truncate">{card.note.title}</span>
          </span>
        )}
      </div>
    </div>
  );
});
