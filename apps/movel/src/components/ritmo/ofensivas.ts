import type { DiaDoCalendario } from "@yu-book/cliente/ritmo/CalendarioOfensiva";
import type { DiaDaChama } from "@yu-book/cliente/ritmo/CartaoChama";
import { inicioDaSemana, somarDias } from "@yu-book/shared";
import { DIAS_LONGOS, diaDaSemana, numeroDoDia, primeiroDoMes, somarMeses } from "../../lib/datas";

const LETRAS = ["D", "S", "T", "Q", "Q", "S", "S"] as const;

/** Os sete dias da semana de `hoje` para o cartão da chama (RF-37). */
export function semanaDaChama(ativos: ReadonlySet<string>, hoje: string): DiaDaChama[] {
  const segunda = inicioDaSemana(hoje);
  return Array.from({ length: 7 }, (_, i) => {
    const dia = somarDias(segunda, i);
    const n = diaDaSemana(dia);
    const estado: DiaDaChama["estado"] = ativos.has(dia)
      ? "feito"
      : dia === hoje
        ? "hoje"
        : dia > hoje
          ? "pendente"
          : "perdido";
    return { dia, letra: LETRAS[n] ?? "", nome: DIAS_LONGOS[n] ?? dia, estado };
  });
}

/**
 * A grade de um mês (`AAAA-MM`) começando na segunda, para o calendário da
 * ofensiva (RF-36). Só as casas do mês; o que vem antes do dia 1 é `null`.
 */
export function gradeDaOfensiva(
  mes: string,
  ativos: ReadonlySet<string>,
  hoje: string,
): (DiaDoCalendario | null)[] {
  const primeiro = primeiroDoMes(mes);
  const ultimo = somarDias(primeiroDoMes(somarMeses(mes, 1)), -1);
  const antes = (diaDaSemana(primeiro) + 6) % 7;
  const casas: (DiaDoCalendario | null)[] = Array.from({ length: antes }, () => null);
  for (let dia = primeiro; dia <= ultimo; dia = somarDias(dia, 1)) {
    const ativo = ativos.has(dia);
    casas.push({
      dia,
      numero: numeroDoDia(dia),
      ativo,
      hoje: dia === hoje,
      perdido: !ativo && dia < hoje,
    });
  }
  return casas;
}

/** "12 jul – 11 ago", "24 set – hoje": o período de uma sequência. */
export function periodoDaSequencia(
  inicio: string,
  fim: string,
  hoje: string,
  curto: (dia: string) => string,
): string {
  const final = fim >= hoje ? "hoje" : curto(fim);
  return inicio === fim ? curto(inicio) : `${curto(inicio)} – ${final}`;
}
