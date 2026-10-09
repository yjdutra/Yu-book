import { useAgendaAdiante } from "@yu-book/cliente/hoje";

// `useAgendaAdiante` subiu para o pacote na Fase 6 da frente de agenda: o
// bloco "Hoje" do Início do web parte da mesma janela, e uma cópia lá seria a
// segunda implementação da regra do INV-66. O que fica aqui é do móvel.

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
