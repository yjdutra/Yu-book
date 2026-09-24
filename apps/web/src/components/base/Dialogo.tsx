import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocoPreso } from "../../lib/foco";

/**
 * Diálogo modal — a anatomia que Paleta, Atalhos, gaveta de links e chat
 * copiavam cada um com um `pt-[Nvh]` diferente, e nenhum prendia o foco.
 *
 * Só para o que não está no caminho de escrita (RNF-05 da Fase 1): atalhos,
 * busca, gaveta. Painel que convive com o editor não é diálogo.
 *
 * Funciona com as duas formas de montagem do projeto — prop viva
 * (`aberto` alterna) e montagem condicional (`{x && <Dialogo aberto />}`) —
 * porque a devolução de foco mora na limpeza do efeito, em `useFocoPreso`.
 */
export function Dialogo({
  aberto,
  onFechar,
  rotulo,
  posicao = "centro",
  largura = "max-w-md",
  focoInicial,
  children,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** Nome acessível do diálogo. */
  rotulo: string;
  /**
   * `lateral` encosta a caixa à esquerda, logo depois do trilho, na altura
   * toda — a gaveta de links, que entra de onde o botão dela mora.
   */
  posicao?: "centro" | "topo" | "lateral";
  /** Classe `max-w-*` da caixa. */
  largura?: string;
  focoInicial?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useFocoPreso(caixa, aberto, focoInicial);

  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-(--z-veu) flex bg-(--veu) animate-surgir-veu ${
        posicao === "lateral"
          ? "items-stretch justify-start pl-14"
          : posicao === "topo"
            ? "items-start justify-center px-4 pt-[12vh]"
            : "items-center justify-center px-4"
      }`}
      onMouseDown={onFechar}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`z-(--z-dialogo) w-full overflow-y-auto border-ink-700/70 bg-superficie
                    shadow-e4 ${
                      posicao === "lateral"
                        ? "flex h-full flex-col rounded-r-dialogo border-y border-r animate-deslizar-direita"
                        : "max-h-[80vh] rounded-dialogo border animate-surgir"
                    } ${largura}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
