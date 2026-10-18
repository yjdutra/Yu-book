/**
 * Plano reúne Agenda e Tarefas (frente Ritmo, RF-16 da Ritmo 2): as duas rotas
 * continuam, e o item da barra leva à última das duas aberta **nesta sessão**.
 *
 * Memória do módulo, e não `sessionStorage`: é conveniência de navegação, que
 * recarregar pode esquecer sem prejuízo — e assim não há armazenamento que
 * falhe em janela privada.
 */

export const AREAS_DO_PLANO = ["/agenda", "/tarefas"] as const;

let ultima: string = AREAS_DO_PLANO[0];

/** O pathname é de Plano (o seletor e o item da barra acendem nele). */
export function noPlano(pathname: string): boolean {
  return AREAS_DO_PLANO.some((a) => pathname === a || pathname.startsWith(`${a}/`));
}

/** A casca anota cada entrada em Plano, com a busca (o dia, a aba, o projeto). */
export function lembrarDoPlano(pathname: string, busca: string): void {
  if (noPlano(pathname)) ultima = `${pathname}${busca}`;
}

export function ultimaDoPlano(): string {
  return ultima;
}
