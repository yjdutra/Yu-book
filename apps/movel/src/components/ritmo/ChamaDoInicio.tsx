import { useHabitos, useOfensivas } from "@yu-book/cliente/habitos";
import { CartaoChama } from "@yu-book/cliente/ritmo/CartaoChama";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { semanaDaChama } from "./ofensivas";

/**
 * A chama no Início (frente Ritmo, RF-37): a ofensiva geral e os sete dias da
 * semana. Toca e vai a Ritmo › Ofensivas. Some para quem não tem hábito, como
 * "Hoje no ritmo" (RN-19), e espera a leitura em vez de mostrar zero falso.
 */
export function ChamaDoInicio() {
  const habitos = useHabitos();
  const ofensivas = useOfensivas();
  const dados = ofensivas.data;
  const semana = useMemo(
    () => (dados ? semanaDaChama(new Set(dados.activeDays), dados.today) : undefined),
    [dados],
  );
  if (!habitos.data || habitos.data.length === 0 || !dados) return null;
  return (
    <Link to="/ritmo/ofensivas" className="block rounded-dialogo transition active:scale-[0.99]">
      <CartaoChama
        dias={dados.general.current}
        recorde={dados.general.best}
        hojeFeito={dados.general.todayDone}
        semana={semana}
      />
    </Link>
  );
}
