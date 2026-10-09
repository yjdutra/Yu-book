import type { ReactNode } from "react";

/**
 * Bloco de conteúdo — o cartão que o Dashboard e os Ajustes copiavam um do
 * outro. A cópia se justificava por "os dois vão divergir"; não divergiram, e o
 * redesenho quer os dois com a mesma superfície.
 *
 * A variante `ia` ganha um fio de gradiente no topo: é a marca visual das áreas
 * que falam com o modelo, sempre acompanhada de texto (RNF-09).
 */
export function Bloco({
  titulo,
  acao,
  variante = "padrao",
  children,
}: {
  titulo: string;
  acao?: ReactNode;
  variante?: "padrao" | "ia";
  children: ReactNode;
}) {
  return (
    <section
      className="relative min-w-0 overflow-hidden rounded-cartao border border-ink-800
                 bg-superficie shadow-e1"
    >
      {variante === "ia" && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
        />
      )}
      <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
        <h3 className="rotulo">{titulo}</h3>
        {acao && <span className="ml-auto">{acao}</span>}
      </header>
      {children}
    </section>
  );
}

export function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  // RF-06 / CA-10 da Fase 4: nenhum bloco aparece em branco.
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm text-ink-400">{texto}</p>
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

/**
 * RNF-11 da Fase 1: o esqueleto ocupa a altura do conteúdo que virá, para a
 * chegada dos dados não empurrar nada. Por isso a altura é fixa, não "auto".
 */
export function Esqueleto({
  linhas = 3,
  alturaLinha = 20,
}: {
  linhas?: number;
  alturaLinha?: number;
}) {
  return (
    <div className="space-y-2 px-4 py-3" aria-hidden="true">
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-etiqueta bg-ink-800"
          style={{ height: alturaLinha, width: `${90 - ((i * 17) % 35)}%` }}
        />
      ))}
    </div>
  );
}
