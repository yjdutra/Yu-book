import type { ReactNode } from "react";
import { IconeBoard, IconeCalendario, IconeHoje, IconeNotas, IconeTarefa } from "../Icones";

export interface Sugestao {
  texto: string;
  icone?: ReactNode;
}

/**
 * As perguntas de partida da conversa vazia, iguais no web e no móvel: a agenda
 * ao lado do acervo, porque o chat agenda e cria tarefa desde a Fase 2 da
 * frente de agenda, e quem não sabe disso não pede.
 */
export const SUGESTOES_INICIAIS: Sugestao[] = [
  { texto: "O que tenho hoje?", icone: <IconeHoje className="size-3.5" /> },
  { texto: "Marca dentista amanhã às 15h", icone: <IconeCalendario className="size-3.5" /> },
  { texto: "Me lembra de pagar o aluguel na sexta", icone: <IconeTarefa className="size-3.5" /> },
  {
    texto: "O que vence esta semana nos meus quadros?",
    icone: <IconeBoard className="size-3.5" />,
  },
  {
    texto: "Resuma o que anotei sobre o último projeto",
    icone: <IconeNotas className="size-3.5" />,
  },
];

/**
 * Perguntas de partida, em pílulas: mostram o que o assistente alcança, e um
 * toque as escreve no campo. **Escrever, nunca enviar** — uma mensagem são até
 * cinco chamadas pagas, e quem tocou ainda não viu o texto nem o modelo
 * (`design-system-yu-book` §5); quem usa liga `onEscolher` a preencher e focar.
 */
export function Sugestoes({
  itens,
  onEscolher,
  rotulo = "Sugestões",
  centralizar = false,
}: {
  itens: Sugestao[];
  onEscolher: (texto: string) => void;
  rotulo?: string;
  centralizar?: boolean;
}) {
  return (
    <ul
      aria-label={rotulo}
      className={`flex flex-wrap gap-2 ${centralizar ? "justify-center" : ""}`}
    >
      {itens.map((s) => (
        <li key={s.texto} className="max-w-full">
          <button
            type="button"
            onClick={() => onEscolher(s.texto)}
            className="inline-flex max-w-full items-center gap-2 rounded-full border
                       border-ink-700/80 bg-superficie py-1.5 pl-3 pr-3.5 text-left text-sm
                       text-ink-200 shadow-e1 transition duration-150 ease-(--ease-padrao)
                       hover:-translate-y-px hover:border-accent-400/60 hover:text-titulo
                       hover:shadow-e2"
          >
            {s.icone && <span className="shrink-0 text-accent-400">{s.icone}</span>}
            <span className="min-w-0 truncate">{s.texto}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
