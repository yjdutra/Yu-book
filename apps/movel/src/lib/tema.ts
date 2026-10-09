import { useCallback, useSyncExternalStore } from "react";

/**
 * Tema do móvel. O web só alterna claro e escuro; aqui o menu da conta tem
 * também "sistema", que é o que vale enquanto nada foi escolhido — e que
 * precisa acompanhar o aparelho ao vivo, porque o Android troca de esquema
 * sozinho no fim do dia.
 *
 * Mesma chave do web (`yb:tema`) e o mesmo princípio: o valor inicial é do
 * script do `index.html`, antes da primeira pintura; isto só lê e passa a
 * mandar na primeira troca. A preferência é do aparelho, não da conta (RN-06
 * da Fase 4).
 */
export type PreferenciaTema = "claro" | "escuro" | "sistema";

const CHAVE = "yb:tema";
const sistemaClaro = window.matchMedia("(prefers-color-scheme: light)");

/// Um armazenamento só, como no web: quem mostra o tema vê a troca de quem
/// trocou.
const ouvintes = new Set<() => void>();

function lerPreferencia(): PreferenciaTema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    return salvo === "claro" || salvo === "escuro" ? salvo : "sistema";
  } catch {
    return "sistema";
  }
}

let preferencia = lerPreferencia();

function aplicar() {
  const claro = preferencia === "sistema" ? sistemaClaro.matches : preferencia === "claro";
  const raiz = document.documentElement;
  raiz.dataset.tema = claro ? "claro" : "escuro";
  // A barra do sistema acompanha o fundo do tema aplicado. A cor é lida do
  // token, já trocado, para não repetir aqui o `ink-950` de cada tema.
  const fundo = getComputedStyle(raiz).getPropertyValue("--color-ink-950").trim();
  if (!fundo) return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = fundo;
  }
}

sistemaClaro.addEventListener("change", () => {
  if (preferencia === "sistema") aplicar();
});

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  return () => ouvintes.delete(avisar);
}

export function useTema() {
  const atual = useSyncExternalStore(assinar, () => preferencia);

  const escolher = useCallback((nova: PreferenciaTema) => {
    preferencia = nova;
    try {
      if (nova === "sistema") localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, nova);
    } catch {
      // Sem armazenamento (aba anônima restrita): vale até recarregar.
    }
    aplicar();
    for (const avisar of ouvintes) avisar();
  }, []);

  return [atual, escolher] as const;
}
