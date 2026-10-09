import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCAVEIS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Prende o Tab dentro de `ref` enquanto `ativo`, e devolve o foco a quem o tinha
 * antes quando deixa de estar ativo (RNF-06 da Fase 1: foco previsível).
 *
 * A devolução mora na **limpeza** do efeito, não num ramo `if (!ativo)`: assim
 * ela acontece tanto quando a prop vira `false` quanto quando o componente é
 * desmontado com a prop ainda `true` — a forma de montagem condicional que os
 * painéis do projeto usam, em que `aberto` nunca chega a ser `false`.
 */
export function useFocoPreso(
  ref: RefObject<HTMLElement | null>,
  ativo: boolean,
  focoInicial?: RefObject<HTMLElement | null>,
) {
  // Lido na hora, fora das deps: um ref recriado a cada render faria o efeito
  // rodar de novo com o foco já dentro da caixa — e `anterior` passaria a ser
  // um elemento do próprio diálogo, matando a devolução em silêncio.
  const inicial = useRef(focoInicial);
  inicial.current = focoInicial;

  useEffect(() => {
    if (!ativo) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const caixa = ref.current;
    const primeiro =
      inicial.current?.current ?? caixa?.querySelector<HTMLElement>(FOCAVEIS) ?? caixa;
    primeiro?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !caixa) return;
      const lista = [...caixa.querySelectorAll<HTMLElement>(FOCAVEIS)];
      const inicio = lista[0];
      const fim = lista[lista.length - 1];
      if (!inicio || !fim) {
        e.preventDefault();
        return;
      }
      // O foco pode estar fora da lista — na própria caixa, depois de um
      // clique em área não focável, ou num título com `tabIndex={-1}`. Dali,
      // Shift+Tab sairia do diálogo; por isso "não achei" conta como início.
      const posicao = lista.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && posicao <= 0) {
        e.preventDefault();
        fim.focus();
      } else if (!e.shiftKey && posicao === lista.length - 1) {
        e.preventDefault();
        inicio.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // `isConnected`: se quem tinha o foco sumiu enquanto o diálogo estava
      // aberto, focar um nó solto não faz nada — melhor deixar o navegador.
      if (anterior?.isConnected) anterior.focus();
    };
  }, [ref, ativo]);
}
