import type { NoteKind } from "@yu-book/shared";

/**
 * Ícones da navegação (RNF-07).
 *
 * São desenhados aqui, e não trazidos de uma biblioteca, pelo mesmo motivo do
 * `SeletorTema`: são poucos, todos no mesmo traço de 16×16 com `currentColor`,
 * e assim acompanham o tema e o estado do item sem uma dependência a mais.
 *
 * Nenhum deles carrega significado sozinho — todo item da navegação tem texto
 * ao lado —, então todos ficam `aria-hidden`.
 */
const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type IconeProps = { className?: string; style?: React.CSSProperties };

function Icone({
  className = "size-4",
  style,
  children,
}: IconeProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      style={style}
      aria-hidden="true"
      {...TRACO}
    >
      {children}
    </svg>
  );
}

export function IconeInicio(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M2.5 7 8 2.5 13.5 7v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z" />
      <path d="M6.3 14V9.6h3.4V14" />
    </Icone>
  );
}

export function IconeNotas(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3M5.5 8.5h5M5.5 11h3.5" />
    </Icone>
  );
}

export function IconeEstrela(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M8 2.2l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.2l-3.52 1.85.67-3.92L2.3 6.34l3.94-.57Z" />
    </Icone>
  );
}

export function IconeBoard(p: IconeProps) {
  return (
    <Icone {...p}>
      <rect x="2.3" y="2.8" width="11.4" height="10.4" rx="1.2" />
      <path d="M6 2.8v10.4M10 2.8v10.4" />
    </Icone>
  );
}

export function IconeLink(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M6.6 9.4a2.4 2.4 0 0 0 3.4 0l2-2a2.4 2.4 0 0 0-3.4-3.4l-.9.9" />
      <path d="M9.4 6.6a2.4 2.4 0 0 0-3.4 0l-2 2a2.4 2.4 0 0 0 3.4 3.4l.9-.9" />
    </Icone>
  );
}

export function IconeLixeira(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M2.8 4.2h10.4M6.2 4.2V3a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.2" />
      <path d="M4.2 4.2 4.8 13a.9.9 0 0 0 .9.8h4.6a.9.9 0 0 0 .9-.8l.6-8.8" />
      <path d="M6.8 6.8v4.4M9.2 6.8v4.4" />
    </Icone>
  );
}

export function IconeTag(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M2.6 7.5V3.4a.8.8 0 0 1 .8-.8h4.1a.8.8 0 0 1 .57.24l5.1 5.1a.8.8 0 0 1 0 1.13l-4.1 4.1a.8.8 0 0 1-1.13 0l-5.1-5.1a.8.8 0 0 1-.24-.57Z" />
      <circle cx="5.4" cy="5.4" r=".9" />
    </Icone>
  );
}

/** Duas folhas sobrepostas — RF-28, o botão de copiar a nota. */
export function IconeCopiar(p: IconeProps) {
  return (
    <Icone {...p}>
      <rect x="5.6" y="5.6" width="7.6" height="8.2" rx="1.2" />
      <path d="M10.6 5.6V3.4a1.2 1.2 0 0 0-1.2-1.2H4a1.2 1.2 0 0 0-1.2 1.2v7a1.2 1.2 0 0 0 1.2 1.2h1.6" />
    </Icone>
  );
}

/** Engrenagem — a entrada de ajustes na navegação. */
export function IconeAjustes(p: IconeProps) {
  return (
    <Icone {...p}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M2.2 8h1.6M12.2 8h1.6M3.9 3.9l1.1 1.1M11 11l1.1 1.1M12.1 3.9 11 5M5 11l-1.1 1.1" />
    </Icone>
  );
}

/** Varinha com faíscas — o botão de formatar a nota por IA (RF-10). */
export function IconeFormatar(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M3 13 10.4 5.6" />
      <path d="M9.4 4.6 11.4 6.6" />
      <path d="M12.2 2v2.4M11 3.2h2.4" />
      <path d="M13.4 8.6v1.8M12.5 9.5h1.8" />
    </Icone>
  );
}

export function IconeInfo(p: IconeProps) {
  return (
    <Icone {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7.2v4" />
      <circle cx="8" cy="4.9" r=".75" fill="currentColor" stroke="none" />
    </Icone>
  );
}

/** Seta da seção recolhível: aponta para a direita fechada, para baixo aberta. */
export function IconeSeta({ aberta, className = "size-3" }: IconeProps & { aberta: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`shrink-0 transition-transform duration-150 ${aberta ? "rotate-90" : ""} ${className}`}
      aria-hidden="true"
      {...TRACO}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function IconeAula(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M8 2.6 14.2 5.6 8 8.6 1.8 5.6Z" />
      <path d="M4.4 7.1v3.4c0 .9 1.6 1.9 3.6 1.9s3.6-1 3.6-1.9V7.1" />
    </Icone>
  );
}

function IconeProjeto(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M2.4 5.2a1 1 0 0 1 1-1h2.4l1.2 1.6h4.6a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1Z" />
    </Icone>
  );
}

function IconeTrilha(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M4.6 13.4V5.1M11.4 10.9V2.6" />
      <path d="M4.6 5.1a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5ZM11.4 13.4a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
      <path d="M4.6 3.9h4.3a2.5 2.5 0 0 1 2.5 2.5v.9" />
    </Icone>
  );
}

function IconeTrabalho(p: IconeProps) {
  return (
    <Icone {...p}>
      <rect x="2.3" y="5.2" width="11.4" height="8" rx="1.1" />
      <path d="M6 5.2V3.9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.3M2.3 8.6h11.4" />
    </Icone>
  );
}

function IconeLivre(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M10.6 2.8 13.2 5.4 6.1 12.5l-3.3.7.7-3.3Z" />
      <path d="M9.2 4.2 11.8 6.8" />
    </Icone>
  );
}

/** Cada tipo de nota tem a sua figura, além da cor e da inicial (RNF-07). */
export const ICONE_TIPO: Record<NoteKind, (p: IconeProps) => React.ReactElement> = {
  aula: IconeAula,
  projeto: IconeProjeto,
  trilha: IconeTrilha,
  trabalho: IconeTrabalho,
  livre: IconeLivre,
};
