import { useEffect, useState } from "react";

const CONSULTA = "(prefers-reduced-motion: reduce)";

/**
 * O sistema pediu menos movimento. O CSS já zera as animações por conta
 * própria (`index.css`); isto é para o que anima por JavaScript — a animação
 * de soltura do `DragOverlay`, que o CSS não alcança.
 */
export function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(() => window.matchMedia(CONSULTA).matches);

  useEffect(() => {
    const mq = window.matchMedia(CONSULTA);
    const ouvir = (e: MediaQueryListEvent) => setReduzido(e.matches);
    mq.addEventListener("change", ouvir);
    return () => mq.removeEventListener("change", ouvir);
  }, []);

  return reduzido;
}
