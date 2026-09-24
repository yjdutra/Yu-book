import type { ReactElement } from "react";
import type { ModoNota } from "../lib/modoNota";
import { IconeLapis, TRACO } from "./Icones";
import type { IconeProps } from "./Icones";

/** Texto já formatado, com o cursor dentro — o modo em que se escreve vendo. */
function AoVivo() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" {...TRACO}>
      <path d="M2.4 4h5.6" strokeWidth={2.4} />
      <path d="M2.4 8h8.4M2.4 11.6h5.6" />
      <path d="M13.2 6.4v6.4" />
    </svg>
  );
}

function Dividido() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" {...TRACO}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path d="M8 2.8v10.4" />
    </svg>
  );
}

function Olho() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" {...TRACO}>
      <path d="M1.4 8S3.8 3.8 8 3.8 14.6 8 14.6 8 12.2 12.2 8 12.2 1.4 8 1.4 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  );
}

const OPCOES: {
  modo: ModoNota;
  rotulo: string;
  dica: string;
  Icone: (p: IconeProps) => ReactElement;
}[] = [
  { modo: "aovivo", rotulo: "Ao vivo", dica: "A marcação some fora da linha do cursor", Icone: AoVivo },
  { modo: "edicao", rotulo: "Só edição", dica: "Só o Markdown", Icone: IconeLapis },
  { modo: "dividido", rotulo: "Edição e leitura", dica: "Markdown e resultado lado a lado", Icone: Dividido },
  { modo: "leitura", rotulo: "Só leitura", dica: "Só o resultado formatado", Icone: Olho },
];

interface SeletorModoProps {
  modo: ModoNota;
  onModo: (modo: ModoNota) => void;
}

/**
 * Alterna entre escrever, escrever vendo o resultado e só ler.
 *
 * Controle segmentado: o ativo se ergue do trilho como cartão (superfície e
 * sombra), então a escolha tem forma além da cor (RNF-09) — e `aria-pressed`
 * diz o mesmo ao leitor de tela. Os quatro modos ficam (INV-38).
 */
export function SeletorModo({ modo, onModo }: SeletorModoProps) {
  return (
    <div
      role="group"
      aria-label="Modo de exibição da nota"
      className="flex items-center gap-0.5 rounded-controle bg-ink-900 p-0.5"
    >
      {OPCOES.map(({ modo: valor, rotulo, dica, Icone }) => {
        const ativo = modo === valor;
        return (
          <button
            key={valor}
            type="button"
            onClick={() => onModo(valor)}
            aria-pressed={ativo}
            title={`${rotulo} — ${dica}`}
            className={`rounded-[8px] px-2 py-1 transition-colors duration-[120ms] ${
              ativo
                ? "bg-superficie text-titulo shadow-e1"
                : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
            }`}
          >
            <Icone />
            <span className="sr-only">{rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}
