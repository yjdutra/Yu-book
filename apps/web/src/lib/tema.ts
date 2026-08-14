import { useEffect, useState } from "react";

export type Tema = "claro" | "escuro";

const CHAVE = "yb:tema";

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
  const [tema, setTema] = useState<Tema>(
    () => (document.documentElement.dataset.tema as Tema | undefined) ?? "escuro",
  );

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    localStorage.setItem(CHAVE, tema);
  }, [tema]);

  return [tema, setTema] as const;
}
