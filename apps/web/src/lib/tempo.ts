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

/** RF-26: acima disto, o item ganha destaque de esquecido. */
export const DIAS_PARA_ENVELHECER = 30;
