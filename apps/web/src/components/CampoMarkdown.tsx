import { useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { renderMarkdown } from "../lib/markdown";

/**
 * Campo de Markdown com prévia alternável — a descrição do card (RF-28 da
 * Fase 3) e as instruções de um agente (Etapa D da IA).
 *
 * Coluna única, e não o split da nota: é campo de formulário, não editor. A
 * prévia passa por `renderMarkdown`, que sanitiza com DOMPurify antes de o
 * HTML virar DOM (INV-09), e só é calculada quando está à vista.
 */
export function CampoMarkdown({
  valor,
  onMudar,
  titulo,
  rotuloCampo,
  placeholder,
  linhas = 6,
  maxLength,
  onKeyDown,
  extra,
  descricao,
}: {
  valor: string;
  onMudar: (valor: string) => void;
  /** O título visível da seção. */
  titulo: string;
  /** O nome acessível do campo. */
  rotuloCampo: string;
  placeholder?: string;
  linhas?: number;
  maxLength?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Ao lado do alternador — contagem de caracteres, por exemplo. */
  extra?: ReactNode;
  /** Id de um texto que descreve o campo. */
  descricao?: string;
}) {
  const [previa, setPrevia] = useState(false);
  // Sanitizado por DOMPurify em renderMarkdown (RNF-16).
  const html = useMemo(() => (previa ? renderMarkdown(valor) : ""), [previa, valor]);

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="rotulo">{titulo}</p>
        <div className="flex items-center gap-2">
          {extra}
          <button
            type="button"
            onClick={() => setPrevia((v) => !v)}
            aria-pressed={previa}
            className="rounded-controle px-1.5 py-0.5 text-miudo text-ink-400 hover:text-ink-200"
          >
            {previa ? "editar" : "ver formatado"}
          </button>
        </div>
      </div>

      {previa ? (
        <div
          className="preview min-h-24 rounded-controle bg-ink-900/60 px-3 py-2 text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <textarea
          value={valor}
          onChange={(e) => onMudar(e.target.value)}
          onKeyDown={onKeyDown}
          rows={linhas}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={rotuloCampo}
          aria-describedby={descricao}
          className="w-full resize-y rounded-controle bg-ink-900/60 px-3 py-2 font-mono text-xs
                     leading-relaxed text-ink-200 outline-none placeholder:text-ink-400/50
                     focus:ring-1 focus:ring-accent-400"
        />
      )}
    </section>
  );
}
