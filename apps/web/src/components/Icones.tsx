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
export const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export type IconeProps = { className?: string; style?: React.CSSProperties };

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

/**
 * Folha com um "+" no canto — virar nota (Etapa C da IA): a resposta do
 * assistente vira nota nova. A folha é a de `IconeNotas`, aberta embaixo à
 * direita para o sinal caber.
 */
export function IconeVirarNota(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M12 8.2V5L9 2H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4.4" />
      <path d="M9 2v3h3M5.5 8.5h3.5M5.5 11h2" />
      <path d="M12.4 10.4v4.2M10.3 12.5h4.2" />
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

/** Faísca de quatro pontas — o assistente e tudo o que vem da IA. */
export function IconeAssistente(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M7 2.2 8.2 6.3 12.3 7.5 8.2 8.7 7 12.8 5.8 8.7 1.7 7.5 5.8 6.3Z" />
      <path d="M12.4 10.6v3M10.9 12.1h3" />
    </Icone>
  );
}

export function IconeFechar(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icone>
  );
}

/** Triângulo com exclamação — o glifo que acompanha a cor de erro e alerta (RNF-09). */
export function IconeAlerta(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M7.1 2.6a1 1 0 0 1 1.8 0l5.2 9.6a1 1 0 0 1-.9 1.5H2.8a1 1 0 0 1-.9-1.5Z" />
      <path d="M8 6.2v3" />
      <circle cx="8" cy="11.3" r=".7" fill="currentColor" stroke="none" />
    </Icone>
  );
}

export function IconeBusca(p: IconeProps) {
  return (
    <Icone {...p}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.2 10.2 13.6 13.6" />
    </Icone>
  );
}

export function IconeMais(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M8 3v10M3 8h10" />
    </Icone>
  );
}

/** Painel com a seta para dentro — recolher o painel contextual. */
export function IconeRecolher(p: IconeProps) {
  return (
    <Icone {...p}>
      <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.6" />
      <path d="M6 2.8v10.4M10.6 6.2 8.8 8l1.8 1.8" />
    </Icone>
  );
}

/** Três pontos — o menu de ações de um item. */
export function IconeOpcoes(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.4} />
    </Icone>
  );
}

/** Seis pontos — a alça de arrastar. */
export function IconeAlca(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" strokeWidth={2.2} />
    </Icone>
  );
}

/** Dois balões — a lista de conversas do assistente. */
export function IconeConversas(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M10.6 6.2V3.6a1.2 1.2 0 0 0-1.2-1.2H3a1.2 1.2 0 0 0-1.2 1.2v4.2A1.2 1.2 0 0 0 3 9h.6v2l2.4-2" />
      <path d="M7.4 7.6a1.2 1.2 0 0 1 1.2-1.2H13a1.2 1.2 0 0 1 1.2 1.2v3.4a1.2 1.2 0 0 1-1.2 1.2h-.6v1.8L10 12.2H8.6a1.2 1.2 0 0 1-1.2-1.2Z" />
    </Icone>
  );
}

/** Janela com a faixa da direita — o painel lateral do assistente. */
export function IconePainelDireito(p: IconeProps) {
  return (
    <Icone {...p}>
      <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.6" />
      <path d="M10 2.8v10.4" />
    </Icone>
  );
}

/** Duas setas para os cantos — levar o painel para a tela cheia. */
export function IconeExpandir(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M9.4 2.6h4v4M13.4 2.6 9 7M6.6 13.4h-4v-4M2.6 13.4 7 9" />
    </Icone>
  );
}

export function IconeLapis(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M11.6 2.4a1.6 1.6 0 0 1 2.2 2.2L5.5 13 2.4 14l1-3.1 8.2-8.5Z" />
      <path d="M10.4 3.6l2 2" />
    </Icone>
  );
}

export function IconeTeclado(p: IconeProps) {
  return (
    <Icone {...p}>
      <rect x="1.8" y="4" width="12.4" height="8" rx="1.4" />
      <path d="M4.4 6.6h.01M6.8 6.6h.01M9.2 6.6h.01M11.6 6.6h.01M5.2 9.4h5.6" />
    </Icone>
  );
}

/** Relógio — prazo que ainda não venceu, e a fila de "ver depois". */
export function IconeRelogio(p: IconeProps) {
  return (
    <Icone {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </Icone>
  );
}

export function IconeCheck(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M3.2 8.4 6.4 11.4 12.8 4.8" />
    </Icone>
  );
}

/** Clipe — a nota vinculada a um card. */
export function IconeClipe(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M11.6 7.2 7.3 11.5a2.6 2.6 0 0 1-3.7-3.7l4.9-4.9a1.7 1.7 0 0 1 2.4 2.4L6 10.2a.8.8 0 0 1-1.1-1.1l4.2-4.2" />
    </Icone>
  );
}

/** Seta curta, para qualquer lado — lista suspensa, subir e descer item. */
export function IconeChevron({
  direcao = "baixo",
  ...p
}: IconeProps & { direcao?: "cima" | "baixo" | "esquerda" | "direita" }) {
  const giro = { baixo: "", cima: "rotate-180", direita: "-rotate-90", esquerda: "rotate-90" };
  return (
    <Icone {...p} className={`${p.className ?? "size-4"} ${giro[direcao]}`}>
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </Icone>
  );
}

/** Seta em círculo — "ver de novo" na fila de links. */
export function IconeRecarregar(p: IconeProps) {
  return (
    <Icone {...p}>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.8v2.6h-2.6" />
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
