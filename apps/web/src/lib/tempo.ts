const DIA = 24 * 60 * 60 * 1000;

/** Dias inteiros desde a data — a idade que a fila de "ver depois" exibe. */
export function diasDesde(iso: string, agora = Date.now()): number {
  return Math.max(0, Math.floor((agora - new Date(iso).getTime()) / DIA));
}

/**
 * RF-25: idade em texto, não em data.
 *
 * "há 3 dias" responde a pergunta que se faz olhando a fila ("isso está
 * parado há quanto tempo?"); "12/08" obrigaria a fazer a conta de cabeça.
 */
export function idadeRelativa(iso: string, agora = Date.now()): string {
  const dias = diasDesde(iso, agora);

  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;

  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;

  const anos = Math.floor(dias / 365);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

/**
 * Saudação do início do dia ao fim (redesenho de UI, Etapa 5). A hora é a do
 * navegador: é uma cortesia de tela, não um dado que o servidor precisa
 * concordar.
 */
export function saudacao(agora = Date.now()): string {
  const hora = new Date(agora).getHours();
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** RF-26: acima disto, o item ganha destaque de esquecido. */
export const DIAS_PARA_ENVELHECER = 30;

/** Diferença em dias de calendário, ignorando a hora. */
function diasDeCalendario(iso: string, agora: number): number {
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(iso);
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / DIA);
}

/**
 * RF-09: prazo em texto, contado por dia de calendário.
 *
 * O prazo é gravado às 23:59 do dia escolhido (Fase 2), então contar por horas
 * diria "em 20 horas" para algo que vence hoje. O que importa é o dia.
 */
export function prazoRelativo(iso: string, agora = Date.now()): string {
  const dias = diasDeCalendario(iso, agora);

  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias === -1) return "venceu ontem";
  if (dias < -1) return `venceu há ${-dias} dias`;
  return `vence em ${dias} dias`;
}
