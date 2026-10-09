import { useEffect, useState } from "react";

export interface AreaVisivel {
  /** Altura do que se vê, em px — encolhe quando o teclado sobe. `null` sem a API. */
  altura: number | null;
  /** Quanto a área visível desceu na página (o navegador rola para mostrar o campo). */
  topo: number;
}

/**
 * A área da tela que o teclado deixa à vista (Fase 5 da frente de agenda).
 *
 * No Chrome do Android, desde a versão 108, o teclado encolhe só a *visual
 * viewport*: `100dvh` e `position: fixed` continuam com a altura da tela
 * inteira, e o compositor do chat, preso ao pé, ficaria atrás do teclado. Quem
 * diz o que sobrou é `window.visualViewport`. A meta `interactive-widget` faria
 * o mesmo para a página toda, e mexeria nas folhas e na barra de todas as
 * telas; aqui vale só para a conversa.
 */
export function useAreaVisivel(): AreaVisivel {
  const [area, setArea] = useState<AreaVisivel>(() => ler());

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const atualizar = () => setArea(ler());
    vv.addEventListener("resize", atualizar);
    vv.addEventListener("scroll", atualizar);
    atualizar();
    return () => {
      vv.removeEventListener("resize", atualizar);
      vv.removeEventListener("scroll", atualizar);
    };
  }, []);

  return area;
}

function ler(): AreaVisivel {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  return vv ? { altura: vv.height, topo: vv.offsetTop } : { altura: null, topo: 0 };
}
