import type { AgentColor } from "@yu-book/shared";

/**
 * A cor de cada agente, com o nome por extenso.
 *
 * `Record` total sobre `AgentColor` (INV-54): uma cor nova no enum não compila
 * sem classe e nome aqui. As classes são literais por inteiro — o Tailwind só
 * gera a utilidade que encontra escrita no código.
 *
 * O tipo vem só como `type` de propósito: este arquivo mora no painel
 * contextual, que está no bundle inicial, e importar valor de `agentes.ts`
 * traria junto os schemas e o metadado das ferramentas.
 */
export const COR_DO_AGENTE: Record<AgentColor, { fundo: string; tinta: string; nome: string }> = {
  violeta: {
    fundo: "bg-agente-violeta",
    tinta: "bg-agente-violeta/15 border-agente-violeta/50",
    nome: "violeta",
  },
  azul: { fundo: "bg-agente-azul", tinta: "bg-agente-azul/15 border-agente-azul/50", nome: "azul" },
  verde: {
    fundo: "bg-agente-verde",
    tinta: "bg-agente-verde/15 border-agente-verde/50",
    nome: "verde",
  },
  ambar: {
    fundo: "bg-agente-ambar",
    tinta: "bg-agente-ambar/15 border-agente-ambar/50",
    nome: "âmbar",
  },
  rosa: { fundo: "bg-agente-rosa", tinta: "bg-agente-rosa/15 border-agente-rosa/50", nome: "rosa" },
  cinza: {
    fundo: "bg-agente-cinza",
    tinta: "bg-agente-cinza/15 border-agente-cinza/50",
    nome: "cinza",
  },
};

/** Até duas iniciais: "Especialista em LinkedIn" → "EL"; "Revisor" → "RE". */
export function iniciais(nome: string): string {
  const palavras = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p));
  const primeira = palavras[0] ?? nome.trim();
  const ultima = palavras.length > 1 ? palavras[palavras.length - 1] : undefined;
  const letras = ultima ? `${primeira.charAt(0)}${ultima.charAt(0)}` : primeira.slice(0, 2);
  return letras.toUpperCase() || "?";
}

const TAMANHO = {
  p: "size-5 text-miudo tracking-tighter rounded-etiqueta",
  m: "size-6 text-miudo rounded-etiqueta",
  g: "size-9 text-xs rounded-controle",
  xg: "size-12 text-base rounded-cartao",
} as const;

/**
 * O avatar de um agente: iniciais sobre a cor escolhida. A cor não diz nada
 * sozinha (RNF-09) — o nome acessível é o do agente, e quem mostra o avatar
 * mostra o nome ao lado; onde o nome não está à vista, `rotulado` o anuncia.
 *
 * `excluido` é o agente que saiu depois da conversa: fica em cinza e tracejado,
 * forma além da cor.
 */
export function AvatarAgente({
  nome,
  cor,
  tamanho = "m",
  rotulado = false,
  excluido = false,
}: {
  nome: string;
  cor: AgentColor;
  tamanho?: keyof typeof TAMANHO;
  /** Sem o nome à vista ao lado, o avatar precisa dizê-lo. */
  rotulado?: boolean;
  excluido?: boolean;
}) {
  return (
    <span
      role={rotulado ? "img" : undefined}
      aria-label={rotulado ? `Agente ${nome}${excluido ? " (excluído)" : ""}` : undefined}
      aria-hidden={rotulado ? undefined : true}
      className={`inline-flex shrink-0 select-none items-center justify-center font-semibold
                  leading-none tracking-tight text-white shadow-e1 ${TAMANHO[tamanho]} ${
                    excluido
                      ? "border border-dashed border-ink-400 bg-ink-700 text-ink-200"
                      : COR_DO_AGENTE[cor].fundo
                  }`}
    >
      {iniciais(nome)}
    </span>
  );
}
