import { useCallback, useState } from "react";

const PREFIXO = "yb:secao:";

/**
 * Estado aberto/fechado de uma seção recolhível da navegação.
 *
 * Mora em `localStorage` pelo mesmo motivo do tema e da largura das colunas:
 * quanto do painel lateral cabe na tela é propriedade do dispositivo, não da
 * conta — quem usa um notebook pequeno recolhe e quer continuar recolhido.
 */
export function useSecao(chave: string, inicial = true) {
  const [aberta, setAberta] = useState(() => {
    const salvo = localStorage.getItem(PREFIXO + chave);
    return salvo === null ? inicial : salvo === "1";
  });

  const alternar = useCallback(() => {
    setAberta((v) => {
      localStorage.setItem(PREFIXO + chave, v ? "0" : "1");
      return !v;
    });
  }, [chave]);

  return [aberta, alternar] as const;
}
