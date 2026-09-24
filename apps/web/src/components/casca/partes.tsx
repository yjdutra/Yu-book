import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSecao } from "../../lib/secoes";
import { casaTermo } from "../../lib/tags";
import { IconeSeta, IconeTag } from "../Icones";

/**
 * Peças do painel contextual — saíram da antiga `Navegacao` no redesenho de
 * UI (Etapa 2), com a mesma lógica e o visual novo.
 */

export function Item({
  ativo,
  onClick,
  children,
  contagem,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
  contagem?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativo ? "true" : undefined}
      className={`relative flex w-full items-center gap-2.5 rounded-controle px-2.5 py-1.5
                  text-left text-sm transition-colors duration-[120ms] ${
                    ativo
                      ? "bg-ink-800 text-titulo shadow-e1"
                      : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-200"
                  }`}
    >
      {/* Barra de ativo: forma, além da cor de fundo (RNF-09). */}
      {ativo && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-400"
        />
      )}
      {children}
      {contagem !== undefined && (
        <span className="ml-auto text-xs tabular-nums text-ink-400">{contagem}</span>
      )}
    </button>
  );
}

/**
 * Cabeçalho de seção não recolhível. O recuo à esquerda é o mesmo que a seta
 * das seções recolhíveis ocupa, para todos os títulos se alinharem.
 */
export function Titulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex items-center pl-6 pr-1">
      <p className="rotulo">{children}</p>
      {acao && <span className="ml-auto">{acao}</span>}
    </div>
  );
}

/**
 * Seção recolhível.
 *
 * Recolher esconde os itens, então o cabeçalho precisa continuar dizendo o que
 * ficou escondido: `resumo` é o que aparece no lugar deles quando a seção está
 * fechada — sem isso, um filtro ativo sumiria da vista sem deixar de valer.
 */
export function Secao({
  titulo,
  chave,
  contagem,
  resumo,
  children,
}: {
  titulo: string;
  chave: string;
  contagem?: number;
  resumo?: ReactNode;
  children: ReactNode;
}) {
  const [aberta, alternar] = useSecao(chave);
  const id = `secao-${chave}`;

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberta}
        aria-controls={id}
        className="flex w-full items-center gap-1 rounded-controle px-2 py-1 text-miudo
                   font-medium uppercase tracking-wider text-ink-400 transition-colors
                   hover:bg-ink-800/60 hover:text-ink-200"
      >
        <IconeSeta aberta={aberta} />
        <span>{titulo}</span>
        {!aberta && resumo}
        {contagem !== undefined && <span className="ml-auto tabular-nums">{contagem}</span>}
      </button>
      <div id={id} hidden={!aberta} className="mt-0.5 space-y-0.5">
        {children}
      </div>
    </section>
  );
}

/** Conteúdo do cartão de tags — separado só para ter o seu próprio recolhido. */
export function CartaoTags({
  tags,
  ativas,
  quantidadeAtiva,
  onAlternarTag,
}: {
  tags: { id: string; name: string; noteCount: number }[];
  ativas: string[];
  quantidadeAtiva: number;
  onAlternarTag: (nome: string) => void;
}) {
  const [aberto, alternar] = useSecao("tags");
  const [busca, setBusca] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);

  /**
   * RF-13 / RF-14: filtra sem acento e sem caixa, mas **uma tag ativa nunca
   * some**. Esconder um filtro que está valendo faria a tela mentir sobre o
   * que a lista de notas está mostrando.
   */
  const visiveis = useMemo(
    () => tags.filter((t) => ativas.includes(t.name) || casaTermo(t.name, busca)),
    [tags, ativas, busca],
  );

  return (
    <>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        aria-controls="secao-tags"
        className="flex w-full items-center gap-1 rounded-controle px-2 py-1.5 text-miudo
                   font-medium uppercase tracking-wider text-ink-400 transition-colors
                   hover:text-ink-200"
      >
        <IconeSeta aberta={aberto} />
        <IconeTag className="size-3.5" />
        <span>Tags</span>
        {/* Fechado, o cartão ainda avisa que há filtro de tag valendo. */}
        {!aberto && quantidadeAtiva > 0 && (
          <span className="rounded-full bg-accent-500 px-1.5 text-miudo text-white">
            {quantidadeAtiva}
          </span>
        )}
        <span className="ml-auto tabular-nums">{tags.length}</span>
      </button>

      <div id="secao-tags" hidden={!aberto} className="px-2 pb-2">
        {/* RF-12: o campo fica dentro do cartão, acima da lista. Não rouba foco
            ao abrir — abrir o cartão é para olhar, não necessariamente digitar. */}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // RF-16: primeiro limpa; já vazio, o Esc devolve o foco à lista.
            // Sem nenhum dos dois para fazer, deixa o Esc seguir para quem
            // tiver algo aberto na tela.
            const primeira = listaRef.current?.querySelector("button");
            if (!busca && !primeira) return;
            e.stopPropagation();
            e.preventDefault();
            if (busca) setBusca("");
            else primeira?.focus();
          }}
          placeholder="filtrar tags…"
          aria-label="Filtrar tags"
          className="mb-1.5 w-full rounded-etiqueta bg-ink-800 px-2 py-1 text-miudo text-ink-200
                     outline-none placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
        />

        {/* RF-15: só faz sentido dizer o recorte quando existe um recorte. */}
        {busca && (
          <p className="mb-1 text-miudo tabular-nums text-ink-400">
            {visiveis.length} de {tags.length}
          </p>
        )}

        <div ref={listaRef} className="flex flex-wrap gap-1">
          {visiveis.map((t) => {
            const ativa = ativas.includes(t.name);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onAlternarTag(t.name)}
                aria-pressed={ativa}
                className={`rounded-etiqueta px-1.5 py-0.5 text-miudo transition ${
                  ativa ? "bg-accent-500 text-white" : "bg-ink-800 text-ink-400 hover:text-ink-200"
                }`}
              >
                {t.name}
                <span className="ml-1 opacity-60">{t.noteCount}</span>
              </button>
            );
          })}
        </div>

        {/* RF-17: vazio explicado é melhor que área em branco. */}
        {visiveis.length === 0 && (
          <p className="py-1 text-miudo text-ink-400/70">nenhuma tag com «{busca}»</p>
        )}
      </div>
    </>
  );
}
