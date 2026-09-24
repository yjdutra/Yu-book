import { useCallback, useSyncExternalStore } from "react";

export type Tema = "claro" | "escuro";

const CHAVE = "yb:tema";

/// Quem está ouvindo o tema. Um armazenamento só para a aplicação inteira: com
/// um `useState` por componente, trocar o tema pela paleta deixava o botão do
/// trilho mostrando o ícone velho, e o clique seguinte nele não fazia nada.
const ouvintes = new Set<() => void>();

function lerTema(): Tema {
  return (document.documentElement.dataset.tema as Tema | undefined) ?? "escuro";
}

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  return () => ouvintes.delete(avisar);
}

/**
 * Tema da aplicação (RF-19 a RF-21).
 *
 * O valor inicial **não** é lido daqui: quem decide é o script embutido no
 * `index.html`, que roda antes da primeira pintura (RNF-07). Este hook só lê o
 * que ele já aplicou e passa a mandar a partir da primeira troca — dois lugares
 * decidindo o valor inicial dariam a piscada que o script existe para evitar.
 *
 * RN-06: a preferência é do dispositivo, então mora em `localStorage`, não no
 * banco. Sala clara e quarto escuro são propriedades do lugar, não da conta.
 */
export function useTema() {
  const tema = useSyncExternalStore(assinar, lerTema);

  const setTema = useCallback((novo: Tema) => {
    document.documentElement.dataset.tema = novo;
    localStorage.setItem(CHAVE, novo);
    for (const avisar of ouvintes) avisar();
  }, []);

  return [tema, setTema] as const;
}
