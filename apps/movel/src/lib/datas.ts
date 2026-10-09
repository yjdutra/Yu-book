import { DIAS_CURTOS } from "@yu-book/cliente/agenda";
import { diasEntre, ehDiaCivil, horaLocal, somarDias } from "@yu-book/shared";

/**
 * Dia civil no móvel (frente de agenda, Fase 4). Tudo aqui parte de texto
 * `AAAA-MM-DD` que **já é** o dia do usuário — a API converteu pelo fuso dele
 * (INV-66) — e o trata como calendário puro: `Date.UTC` e `getUTC*`, nunca o
 * `Date` local, que empurraria o dia para o fuso do navegador. A soma de dias é
 * `somarDias` de `shared`, a única do projeto (contrato §4.5).
 *
 * **A regra do relógio do aparelho:** ele só escolhe a janela de uma consulta
 * antes de a API dizer o hoje (`diaDoAparelho`, em `@yu-book/cliente/hoje`) ou
 * dá o instante de agora para comparar com outro instante (`proximaHoraCheia`,
 * o fim de um evento). Dia e hora que viram dado ou texto na tela saem sempre
 * pelo fuso do usuário, nunca pelo do navegador.
 *
 * Os dias curtos ("dom" a "sáb") são os de `@yu-book/cliente/agenda`, que o
 * web também diz; o plural ("1 evento") é `contar`, de `@yu-book/cliente/texto`.
 */

export const DIAS_LONGOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;
export const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;
const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

const doisDigitos = (n: number) => String(n).padStart(2, "0");

function partes(dia: string): { ano: number; mes: number; d: number } {
  const [ano, mes, d] = dia.split("-").map(Number);
  return { ano: ano ?? 1970, mes: mes ?? 1, d: d ?? 1 };
}

/** `?dia=` da URL: só um dia que existe; o resto é como não ter vindo. */
export function diaValido(valor: string | null): string | null {
  return valor && ehDiaCivil(valor) ? valor : null;
}

/** 0 = domingo. Do calendário, sem fuso. */
export function diaDaSemana(dia: string): number {
  const { ano, mes, d } = partes(dia);
  return new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
}

export function numeroDoDia(dia: string): number {
  return partes(dia).d;
}

/** `AAAA-MM` do dia. */
export function mesDoDia(dia: string): string {
  return dia.slice(0, 7);
}

export function primeiroDoMes(mes: string): string {
  return `${mes}-01`;
}

/** `AAAA-MM` mais `n` meses. O corte do ISO é seguro: `Date.UTC` é UTC. */
export function somarMeses(mes: string, n: number): string {
  const { ano, mes: m } = partes(`${mes}-01`);
  return new Date(Date.UTC(ano, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/**
 * Os 42 dias da grade do mês: seis semanas, domingo primeiro, começando no
 * domingo de antes (ou do) dia 1. Seis sempre, e não "as que o mês ocupar":
 * a altura da grade não salta entre meses de cinco e de seis semanas.
 */
export function gradeDoMes(mes: string): string[] {
  const primeiro = primeiroDoMes(mes);
  const inicio = somarDias(primeiro, -diaDaSemana(primeiro));
  return Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
}

/** "Outubro de 2026". */
export function tituloDoMes(mes: string): string {
  const { ano, mes: m } = partes(`${mes}-01`);
  const nome = MESES[m - 1] ?? "";
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`;
}

/** "sex, 10 de out". */
export function diaCurto(dia: string): string {
  const { mes, d } = partes(dia);
  return `${DIAS_CURTOS[diaDaSemana(dia)]}, ${d} de ${MESES_CURTOS[mes - 1]}`;
}

/** "18 de dez" — com o ano quando ele não é `anoDe` ("18 de dez de 2027"). */
export function diaMesCurto(dia: string, anoDe?: string | null): string {
  const { ano, mes, d } = partes(dia);
  const outroAno = anoDe && partes(anoDe).ano !== ano;
  return `${d} de ${MESES_CURTOS[mes - 1]}${outroAno ? ` de ${ano}` : ""}`;
}

/** "10 de outubro". */
export function diaPorExtenso(dia: string): string {
  const { mes, d } = partes(dia);
  return `${d} de ${MESES[mes - 1]}`;
}

/** "sexta-feira, 10 de outubro". */
export function diaLongo(dia: string): string {
  return `${DIAS_LONGOS[diaDaSemana(dia)]}, ${diaPorExtenso(dia)}`;
}

/** "hoje", "amanhã", "ontem" — ou "sex, 10 de out". `hoje` é o da API. */
export function diaRelativo(dia: string, hoje: string | null): string {
  if (hoje) {
    const distancia = diasEntre(hoje, dia);
    if (distancia === 0) return "hoje";
    if (distancia === 1) return "amanhã";
    if (distancia === -1) return "ontem";
  }
  return diaCurto(dia);
}

/**
 * O próximo sábado **depois** de hoje: no sábado, o da semana que vem; na
 * sexta, amanhã — que é como se diz "no sábado" numa sexta.
 */
export function proximoSabado(hoje: string): string {
  const faltam = (6 - diaDaSemana(hoje) + 7) % 7 || 7;
  return somarDias(hoje, faltam);
}

/**
 * A próxima hora cheia de hoje no fuso do usuário ("14:37" → "15:00"), ou
 * `null` depois das 23h, quando ela já seria amanhã. O instante é o do
 * aparelho; a hora de parede, a do fuso que a API devolveu.
 */
export function proximaHoraCheia(fuso: string): string | null {
  const [h] = horaLocal(new Date(), fuso).split(":").map(Number);
  if (h === undefined || h >= 23) return null;
  return `${doisDigitos(h + 1)}:00`;
}

/** "30 min", "1 h", "1 h 30", "2 d 3 h". */
export function duracaoCurta(minutos: number): string {
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const min = minutos % 60;
  if (dias > 0) return horas > 0 ? `${dias} d ${horas} h` : `${dias} d`;
  if (horas === 0) return `${min} min`;
  return min > 0 ? `${horas} h ${doisDigitos(min)}` : `${horas} h`;
}

/**
 * O mesmo dia do mês `n` meses adiante, ou o último dia dele quando não
 * existe (31 de janeiro + 1 mês = 28 ou 29 de fevereiro). O PageUp/PageDown
 * da grade.
 */
export function mesmoDiaEm(dia: string, n: number): string {
  const mes = somarMeses(mesDoDia(dia), n);
  const candidato = `${mes}-${dia.slice(8, 10)}`;
  return ehDiaCivil(candidato) ? candidato : somarDias(primeiroDoMes(somarMeses(mes, 1)), -1);
}
