import type { ReactNode } from "react";

/**
 * A pilha do pé da tela (redesenho de UI, Etapa 5). O que flutua mora aqui, um
 * embaixo do outro: antes, o erro de criar nota e o "desfazer" do link
 * ocupavam o mesmo ponto e se cobriam.
 *
 * Erro de tela continua sendo `Aviso`, persistente, com fechar — só a posição
 * é a da pilha. O `Toast` é para o que some sozinho.
 */
export function PilhaFlutuante({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-(--z-toast) flex w-full max-w-md
                 -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      {children}
    </div>
  );
}

/** Mensagem breve com, no máximo, uma ação — o "desfazer". */
export function Toast({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full items-center gap-3 rounded-cartao border
                 border-ink-700/70 bg-superficie px-4 py-2.5 text-sm text-ink-200 shadow-e3
                 animate-subir"
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {acao}
    </div>
  );
}
