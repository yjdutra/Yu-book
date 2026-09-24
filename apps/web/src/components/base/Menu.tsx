import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Tecla } from "./Tecla";

export interface ItemMenu {
  rotulo: string;
  icone?: ReactNode;
  atalho?: string;
  aoEscolher: () => void;
  desabilitado?: boolean;
  /** Por que está desabilitado — vira a dica do item. */
  motivo?: string;
}

interface PropsGatilho {
  ref: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
}

/**
 * Menu de ações (redesenho de UI, Etapa 2) — o `+` e o avatar do trilho.
 *
 * Teclado completo: ↑/↓ circulam, Home/End vão às pontas, Enter/Espaço
 * escolhem (é `<button>`), Esc fecha e devolve o foco ao gatilho. O Esc para
 * aqui (`stopPropagation`), como no seletor de workspace: senão o atalho global
 * fecharia também a paleta ou a gaveta que estivessem abertas atrás.
 */
export function Menu({
  rotulo,
  gatilho,
  itens,
  lado = "baixo",
  cabecalho,
}: {
  rotulo: string;
  gatilho: (props: PropsGatilho) => ReactNode;
  itens: ItemMenu[];
  /**
   * `direita` abre ao lado do gatilho — o caso do trilho; `direita-acima`
   * cresce para cima, para o gatilho que fica no pé da tela.
   */
  lado?: "direita" | "direita-acima" | "baixo" | "baixo-fim";
  cabecalho?: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

  function fechar(devolverFoco: boolean) {
    setAberto(false);
    if (devolverFoco) botao.current?.focus();
  }

  useEffect(() => {
    if (!aberto) return;
    caixa.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    function fora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const botoes = [
      ...(caixa.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    let proximo: HTMLButtonElement | undefined;

    if (e.key === "ArrowDown") proximo = botoes[(atual + 1) % botoes.length];
    else if (e.key === "ArrowUp") proximo = botoes[(atual - 1 + botoes.length) % botoes.length];
    else if (e.key === "Home") proximo = botoes[0];
    else if (e.key === "End") proximo = botoes[botoes.length - 1];
    else if (e.key === "Escape") {
      e.stopPropagation();
      fechar(true);
      return;
    } else if (e.key === "Tab") {
      // Sair do menu por Tab o fecha, sem prender: menu não é diálogo.
      setAberto(false);
      return;
    } else return;

    e.preventDefault();
    proximo?.focus();
  }

  const posicao = {
    direita: "left-full top-0 ml-2",
    "direita-acima": "left-full bottom-0 ml-2",
    baixo: "left-0 top-full mt-1",
    // Alinhado pela direita: para o gatilho perto da borda direita da janela.
    "baixo-fim": "right-0 top-full mt-1",
  }[lado];

  return (
    <div className="relative">
      {gatilho({
        ref: botao,
        onClick: () => setAberto((v) => !v),
        "aria-haspopup": "menu",
        "aria-expanded": aberto,
        // Só aponta para a lista quando ela existe no DOM.
        "aria-controls": aberto ? id : undefined,
      })}
      {aberto && (
        <div
          ref={caixa}
          id={id}
          role="menu"
          aria-label={rotulo}
          onKeyDown={aoTeclar}
          className={`absolute z-(--z-popover) min-w-52 rounded-cartao border border-ink-700/70
                      bg-superficie p-1 shadow-e3 animate-surgir ${posicao}`}
        >
          {/* Visual só: dentro de role="menu" o leitor de tela ignora o que não
              é item. O que o cabeçalho diz precisa estar no `rotulo`. */}
          {cabecalho && (
            <div aria-hidden="true" className="border-b border-ink-800 px-2.5 pb-2 pt-1.5 text-xs">
              {cabecalho}
            </div>
          )}
          {itens.map((item) => (
            <button
              key={item.rotulo}
              type="button"
              role="menuitem"
              disabled={item.desabilitado}
              title={item.desabilitado ? item.motivo : undefined}
              onClick={() => {
                fechar(false);
                item.aoEscolher();
              }}
              className="flex w-full items-center gap-2.5 rounded-controle px-2.5 py-1.5 text-left
                         text-sm text-ink-200 transition-colors hover:bg-ink-800
                         focus-visible:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-ink-400">{item.icone}</span>
              <span className="flex-1">{item.rotulo}</span>
              {item.atalho && <Tecla combo={item.atalho} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
