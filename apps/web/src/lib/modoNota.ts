import { useEffect, useState } from "react";

export type ModoNota = "edicao" | "dividido" | "leitura";

const CHAVE = "yb:modo-nota";
const MODOS: ModoNota[] = ["edicao", "dividido", "leitura"];

/** O modo é da pessoa, não da nota: escolher uma vez vale para todas. */
export function useModoNota() {
  const [modo, setModo] = useState<ModoNota>(() => {
    const salvo = localStorage.getItem(CHAVE) as ModoNota | null;
    return salvo && MODOS.includes(salvo) ? salvo : "dividido";
  });

  useEffect(() => {
    localStorage.setItem(CHAVE, modo);
  }, [modo]);

  return [modo, setModo] as const;
}
