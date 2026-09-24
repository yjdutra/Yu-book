import type { TagDoBoard } from "../lib/tags";
import { Botao } from "./base/Botao";
import { IconeCheck, IconeTag } from "./Icones";

interface BarraDeTagsProps {
  tags: TagDoBoard[];
  selecionadas: string[];
  onAlternar: (nome: string) => void;
  onLimpar: () => void;
  /** Quantos cards o filtro está escondendo agora (RF-09). */
  escondidos: number;
}

/**
 * RF-08 / RF-09: o segundo recorte do board.
 *
 * **O filtro é OU, não E.** Duas tags selecionadas mostram os cards que têm
 * *qualquer uma* delas. Diverge de propósito do filtro de notas do painel
 * lateral, que é E (RF-07 da Fase 1): lá o objetivo é estreitar até achar uma
 * nota; aqui é agregar assuntos relacionados que estão espalhados por colunas
 * diferentes. Trocar para E faria selecionar a segunda tag quase sempre
 * esvaziar o quadro.
 */
export function BarraDeTags({
  tags,
  selecionadas,
  onAlternar,
  onLimpar,
  escondidos,
}: BarraDeTagsProps) {
  const filtrando = selecionadas.length > 0;

  return (
    <div
      role="group"
      aria-label="Filtrar cards por tag"
      className="shrink-0 border-b border-ink-800 px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <IconeTag className="size-3.5 shrink-0 text-ink-400" />

        {tags.map((tag) => {
          const ativa = selecionadas.includes(tag.nome);
          return (
            <button
              key={tag.nome}
              type="button"
              onClick={() => onAlternar(tag.nome)}
              aria-pressed={ativa}
              className={`inline-flex items-center gap-1 rounded-etiqueta px-1.5 py-0.5 text-miudo
                          transition ${
                ativa
                  ? "bg-accent-500 text-white ring-1 ring-accent-400"
                  : "bg-ink-800 text-ink-400 hover:text-ink-200"
              }`}
            >
              {/* RNF-12: a marca ativa não é só a cor de fundo. */}
              {ativa && <IconeCheck className="size-3" />}
              {tag.nome}
              <span className="tabular-nums opacity-60">{tag.quantidade}</span>
            </button>
          );
        })}

        {filtrando && (
          <Botao variante="fantasma" tamanho="p" onClick={onLimpar} className="ml-auto">
            Limpar filtro
          </Botao>
        )}
      </div>

      {/* RN-05: dizer que o arraste parou é parte do filtro — sem isto, o card
          que não pega parece defeito. */}
      {filtrando && (
        <p aria-live="polite" className="mt-1.5 text-miudo text-ink-400">
          {escondidos > 0
            ? `${escondidos} card(s) escondido(s) pelo filtro.`
            : "Nenhum card escondido pelo filtro."}{" "}
          Arrastar fica desligado enquanto ele estiver ativo — a posição seria
          calculada sobre uma lista incompleta.
        </p>
      )}
    </div>
  );
}
