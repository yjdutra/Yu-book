import { useEffect, useState } from "react";

export type ModoNota = "aovivo" | "edicao" | "dividido" | "leitura";

/**
 * A chave mudou de nome ao entrar o modo "ao vivo" (RF-32). É uma migração de
 * uma vez só: quem já tinha escolhido um modo cai no novo padrão uma vez, em
 * vez de nunca ver o modo que a etapa existe para construir. Trocar só o
 * default não bastaria — o valor antigo continuaria valendo.
 */
const CHAVE = "yb:modo-nota-2";
const CHAVE_ANTIGA = "yb:modo-nota";
const MODOS: ModoNota[] = ["aovivo", "edicao", "dividido", "leitura"];

/** O modo é da pessoa, não da nota: escolher uma vez vale para todas. */
export function useModoNota() {
  const [modo, setModo] = useState<ModoNota>(() => {
    // A chave antiga não é lida, só varrida: deixá-la para trás seria lixo que
    // ninguém mais consulta.
    localStorage.removeItem(CHAVE_ANTIGA);
    const salvo = localStorage.getItem(CHAVE) as ModoNota | null;
    return salvo && MODOS.includes(salvo) ? salvo : "aovivo";
  });

  useEffect(() => {
    localStorage.setItem(CHAVE, modo);
  }, [modo]);

  return [modo, setModo] as const;
}
