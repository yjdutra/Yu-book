import { useEffect, useRef } from "react";

export interface AcoesGlobais {
  irParaBoards: () => void;
  alternarGaveta: () => void;
  alternarChat: () => void;
  abrirPaleta: () => void;
  novaNota: () => void;
  alternarAtalhos: () => void;
  alternarContexto: () => void;
  fecharTudo: () => void;
}

/**
 * RNF-01: atalhos globais, válidos em qualquer tela — um ouvinte só, na
 * `window`. A lista que o usuário vê mora em `Atalhos.tsx`; atalho novo entra
 * nos dois lugares.
 *
 * As ações vão por ref: o ouvinte é registrado uma vez e sempre chama a versão
 * mais nova delas, sem se desregistrar a cada render da casca.
 */
export function useAtalhosGlobais(acoes: AcoesGlobais) {
  const ref = useRef(acoes);
  ref.current = acoes;

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const a = ref.current;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        a.irParaBoards();
        return;
      }
      // RF-15. Ctrl+L puro é a barra de endereço do navegador — daí o Shift.
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        a.alternarGaveta();
        return;
      }
      // RF-17. Y porque as teclas vizinhas já estão tomadas pelo navegador:
      // Ctrl+Shift+I e Ctrl+Shift+J abrem as ferramentas de desenvolvedor no
      // Chrome, Ctrl+Shift+K o console no Firefox, e Ctrl+Shift+C o inspetor
      // nos dois. Y está livre em ambos.
      if (mod && e.shiftKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        a.alternarChat();
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        a.abrirPaleta();
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        a.novaNota();
        return;
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        a.alternarAtalhos();
        return;
      }
      // Redesenho de UI, Etapa 2: recolhe o painel contextual. A barra
      // invertida está livre no Chrome e no Firefox.
      if (mod && e.key === "\\") {
        e.preventDefault();
        a.alternarContexto();
        return;
      }
      if (e.key === "Escape") a.fecharTudo();
    }

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
}
