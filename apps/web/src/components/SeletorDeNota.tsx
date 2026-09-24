import { useId, useMemo, useRef, useState } from "react";
import { useTitulos } from "../lib/notas";
import type { TituloSugerido } from "../lib/notas";
import { casaTermo } from "../lib/tags";
import { RotuloTipo } from "./RotuloTipo";

const MAX_SUGESTOES = 8;

/**
 * Escolher uma nota pelo título (Etapa D da IA — as notas-base de um agente).
 *
 * Filtra **local**, sobre `useTitulos()`, que já está em cache para o `[[` do
 * editor: uma lista de títulos inteira, sem rede por tecla. O casamento é o de
 * `casaTermo` — sem acento e sem caixa, a mesma chave que o banco usa.
 *
 * Combobox do ARIA: o foco fica no campo, e a opção ativa é apontada por
 * `aria-activedescendant`. ↑/↓ andam, Enter escolhe, Esc fecha a lista (e,
 * fechada, limpa o campo). O Esc que fecha para aqui — sem isso ele subiria
 * até o painel do assistente ou ao ouvinte global.
 */
export function SeletorDeNota({
  onEscolher,
  excluidos,
  rotulo,
  desabilitado = false,
  placeholder = "Buscar nota pelo título…",
}: {
  onEscolher: (nota: TituloSugerido) => void;
  /** Ids que já foram escolhidos — não aparecem de novo. */
  excluidos: readonly string[];
  rotulo: string;
  desabilitado?: boolean;
  placeholder?: string;
}) {
  const { data: titulos, isLoading } = useTitulos();
  const [termo, setTermo] = useState("");
  const [aberta, setAberta] = useState(false);
  const [indice, setIndice] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const idLista = useId();

  const opcoes = useMemo(() => {
    const fora = new Set(excluidos);
    return (titulos ?? [])
      .filter((t) => !fora.has(t.id) && casaTermo(t.title, termo))
      .slice(0, MAX_SUGESTOES);
  }, [titulos, excluidos, termo]);

  const ativa = opcoes[Math.min(indice, opcoes.length - 1)];
  const mostrar = aberta && !desabilitado;

  function escolher(nota: TituloSugerido) {
    onEscolher(nota);
    setTermo("");
    setIndice(0);
    campo.current?.focus();
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAberta(true);
      if (opcoes.length === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setIndice((i) => (i + passo + opcoes.length) % opcoes.length);
      return;
    }
    if (e.key === "Enter") {
      // Enter num campo de formulário não envia nada aqui: escolhe.
      e.preventDefault();
      if (mostrar && ativa) escolher(ativa);
      return;
    }
    if (e.key === "Escape") {
      if (!mostrar && !termo) return;
      e.preventDefault();
      e.stopPropagation();
      if (mostrar) setAberta(false);
      else setTermo("");
    }
  }

  return (
    <div className="relative">
      <input
        ref={campo}
        type="text"
        role="combobox"
        aria-label={rotulo}
        aria-expanded={mostrar}
        // A lista só existe aberta: apontar para ela fechada é apontar para nada.
        aria-controls={mostrar ? idLista : undefined}
        aria-autocomplete="list"
        aria-activedescendant={mostrar && ativa ? `${idLista}-${ativa.id}` : undefined}
        value={termo}
        disabled={desabilitado}
        placeholder={isLoading ? "Carregando títulos…" : placeholder}
        onChange={(e) => {
          setTermo(e.target.value);
          setIndice(0);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
        onBlur={() => setAberta(false)}
        onKeyDown={teclas}
        className="h-8 w-full rounded-controle border border-ink-700 bg-ink-900 px-2.5 text-sm
                   text-ink-200 outline-none transition-colors placeholder:text-ink-400/70
                   focus:border-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {mostrar && (
        <ul
          id={idLista}
          role="listbox"
          aria-label={rotulo}
          className="absolute left-0 right-0 top-full z-(--z-popover) mt-1 max-h-60 overflow-y-auto
                     rounded-cartao border border-ink-700/70 bg-superficie p-1 shadow-e3
                     animate-surgir"
        >
          {opcoes.length === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-ink-400">
              {termo ? `Nenhuma nota com «${termo}».` : "Nenhuma nota para escolher."}
            </li>
          ) : (
            opcoes.map((t) => (
              <li
                key={t.id}
                id={`${idLista}-${t.id}`}
                role="option"
                aria-selected={t.id === ativa?.id}
                // `onMouseDown` com `preventDefault`, e não `onClick`: o clique
                // tiraria o foco do campo antes da escolha, e o `onBlur`
                // fecharia a lista com o item ainda por escolher.
                onMouseDown={(e) => {
                  e.preventDefault();
                  escolher(t);
                }}
                onMouseEnter={() => setIndice(opcoes.indexOf(t))}
                className={`flex cursor-pointer items-center gap-2 rounded-controle px-2.5 py-1.5
                            text-sm ${
                              t.id === ativa?.id ? "bg-ink-800 text-titulo" : "text-ink-200"
                            }`}
              >
                <RotuloTipo tipo={t.kind} />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
