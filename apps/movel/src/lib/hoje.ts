import { useAgenda } from "@yu-book/cliente/agenda";
import { somarDias } from "@yu-book/shared";
import { useState } from "react";
import { diaDoAparelho } from "./datas";

/**
 * A agenda de hoje até `dias` adiante, numa consulta, **sem esperar** saber o
 * hoje do usuário (INV-66). A janela parte da data do aparelho — a única coisa
 * que ela decide —, e a resposta traz o `today` de verdade. Quase sempre os
 * dois coincidem e acabou ali: nenhuma cascata de "primeiro o hoje, depois a
 * semana". Quando não coincidem (aparelho noutro fuso), uma segunda consulta,
 * já pela janela certa, toma o lugar da primeira.
 *
 * A data do aparelho é guardada na montagem, para a chave não mudar à
 * meia-noite no meio do uso.
 */
export function useAgendaAdiante(dias: number) {
  const [aparelho] = useState(diaDoAparelho);
  const primeira = useAgenda(aparelho, somarDias(aparelho, dias));
  const hoje = primeira.data?.today ?? null;
  const errada = hoje !== null && hoje !== aparelho;
  const certa = useAgenda(errada ? hoje : null, errada ? somarDias(hoje, dias) : null);
  return {
    hoje,
    fuso: primeira.data?.timezone ?? null,
    consulta: errada ? certa : primeira,
  };
}

/// A janela do Início: hoje e os seis dias seguintes. É a mesma consulta de
/// `useHoje`, de propósito — a casca a mantém quente, e o Início chega com ela.
export const DIAS_DA_SEMANA_ADIANTE = 6;

/**
 * O hoje e o fuso **do usuário**, que só a API sabe (`AgendaRange.today` e
 * `timezone`). Pela mesma consulta do Início (`useAgendaAdiante` de sete
 * dias), para não abrir uma requisição só para saber a data. Enquanto a
 * resposta não chega, os dois são `null`, e quem usa espera em vez de chutar —
 * e, se ela falhar, mostra o erro (`erro`), ou esperaria para sempre.
 */
export function useHoje(): {
  hoje: string | null;
  fuso: string | null;
  /** A consulta falhou: quem espera o hoje mostra o erro, não o esqueleto. */
  erro: boolean;
  tentar: () => void;
} {
  const { hoje, fuso, consulta } = useAgendaAdiante(DIAS_DA_SEMANA_ADIANTE);
  return { hoje, fuso, erro: consulta.isError, tentar: () => void consulta.refetch() };
}
