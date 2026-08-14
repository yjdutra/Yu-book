import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const LARGURA_MIN = 180;
const LARGURA_MAX = 520;

/** RNF-03: largura da coluna persistida entre sessões. */
function useLarguraPersistida(chave: string, inicial: number) {
  const [largura, setLargura] = useState(() => {
    const salvo = localStorage.getItem(chave);
    const n = salvo ? Number(salvo) : Number.NaN;
    return Number.isFinite(n) ? Math.min(Math.max(n, LARGURA_MIN), LARGURA_MAX) : inicial;
  });

  useEffect(() => {
    localStorage.setItem(chave, String(largura));
  }, [chave, largura]);

  return [largura, setLargura] as const;
}

interface DivisorProps {
  onArrastar: (deltaX: number) => void;
  rotulo: string;
}

/**
 * Divisor arrastável. Também é operável por teclado (setas) — é um elemento
 * interativo, então precisa ser alcançável por Tab (RNF-08).
 */
function Divisor({ onArrastar, rotulo }: DivisorProps) {
  const arrastando = useRef(false);
  const ultimoX = useRef(0);

  useEffect(() => {
    function mover(e: MouseEvent) {
      if (!arrastando.current) return;
      onArrastar(e.clientX - ultimoX.current);
      ultimoX.current = e.clientX;
    }
    function soltar() {
      arrastando.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
    return () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
  }, [onArrastar]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={rotulo}
      tabIndex={0}
      onMouseDown={(e) => {
        arrastando.current = true;
        ultimoX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onArrastar(-16);
        if (e.key === "ArrowRight") onArrastar(16);
      }}
      className="group relative w-px shrink-0 cursor-col-resize bg-ink-800
                 focus-visible:outline-none"
    >
      {/* Alvo de clique maior que o traço de 1px, sem ocupar espaço no layout */}
      <div
        className="absolute inset-y-0 -left-1 -right-1 transition-colors
                   group-hover:bg-accent-500/40 group-focus-visible:bg-accent-400"
      />
    </div>
  );
}

interface PainelProps {
  chave: string;
  inicial: number;
  rotulo: string;
  className?: string;
  /** De que lado do painel fica o divisor. Painel à direita arrasta ao contrário. */
  divisor?: "direita" | "esquerda";
  children: ReactNode;
}

/**
 * Coluna de largura ajustável, com o divisor à direita.
 *
 * Existe como peça solta porque a Fase 2 tem dois layouts: navegação + lista +
 * editor (notas) e navegação + quadro + painel do card (kanban). A navegação é
 * a mesma coluna nos dois (RNF-05).
 */
export function PainelRedimensionavel({
  chave,
  inicial,
  rotulo,
  className = "",
  divisor = "direita",
  children,
}: PainelProps) {
  const [largura, setLargura] = useLarguraPersistida(chave, inicial);
  const sinal = divisor === "direita" ? 1 : -1;

  const ajustar = useCallback(
    (delta: number) =>
      setLargura((atual) =>
        Math.min(Math.max(atual + delta * sinal, LARGURA_MIN), LARGURA_MAX),
      ),
    [setLargura, sinal],
  );

  const painel = (
    <div style={{ width: largura }} className={`shrink-0 ${className}`}>
      {children}
    </div>
  );

  return divisor === "direita" ? (
    <>
      {painel}
      <Divisor rotulo={rotulo} onArrastar={ajustar} />
    </>
  ) : (
    <>
      <Divisor rotulo={rotulo} onArrastar={ajustar} />
      {painel}
    </>
  );
}

/**
 * RNF-05: abaixo de 1024px mostramos um aviso em vez de degradar o layout.
 * A decisão de ser desktop-only é explícita, então a tela estreita também é.
 */
export function GuardaDesktop({ children }: { children: ReactNode }) {
  const [estreito, setEstreito] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const ouvir = (e: MediaQueryListEvent) => setEstreito(e.matches);
    mq.addEventListener("change", ouvir);
    setEstreito(mq.matches);
    return () => mq.removeEventListener("change", ouvir);
  }, []);

  if (!estreito) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-white">Yu-book é para desktop</h1>
        <p className="mt-2 text-sm text-ink-400">
          A escrita em três colunas precisa de pelo menos 1024px de largura. Abra numa janela
          maior.
        </p>
      </div>
    </div>
  );
}
