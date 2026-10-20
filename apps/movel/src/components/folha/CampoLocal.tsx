import type { EventPlace } from "@yu-book/shared";
import { ApiError } from "@yu-book/cliente/api";
import { detalharLugar, useSugestoesDeLugar } from "@yu-book/cliente/lugares";
import { IconeCheck, IconeLocal } from "@yu-book/cliente/icones";
import { useId, useRef, useState } from "react";
import { ErroDoCampo } from "./Pilulas";

/**
 * O local do evento com as sugestões do Google. Digitar é texto livre — e
 * desfaz o lugar escolhido antes, porque o texto escrito à mão é só texto —;
 * tocar numa sugestão grava o nome no campo e o lugar (endereço e
 * coordenadas) ao lado. Sem chave no servidor, o campo é só o texto, calado:
 * o "Abrir no Maps" da visualização busca por ele.
 *
 * O token de sessão é um por busca: o Google cobra a sessão, que fecha no
 * detalhe do lugar escolhido; depois dele nasce outro.
 */
export function CampoLocal({
  valor,
  lugar,
  erro,
  onMudar,
}: {
  valor: string;
  lugar: EventPlace | null;
  erro?: string;
  onMudar: (local: string, lugar: EventPlace | null) => void;
}) {
  const id = useId();
  const idLista = `${id}-sugestoes`;
  const sessao = useRef(crypto.randomUUID());
  const [focado, setFocado] = useState(false);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const sugestoes = useSugestoesDeLugar(valor, sessao.current, focado && lugar === null);
  const lista = focado && lugar === null ? (sugestoes.data ?? []) : [];
  const semChave =
    sugestoes.error instanceof ApiError && sugestoes.error.code === "MAPAS_INDISPONIVEL";

  async function escolher(placeId: string) {
    setEscolhendo(placeId);
    setFalha(null);
    try {
      const detalhe = await detalharLugar(placeId, sessao.current);
      const { name, ...place } = detalhe;
      onMudar(name, place);
      sessao.current = crypto.randomUUID();
      setFocado(false);
    } catch (e) {
      setFalha(e instanceof ApiError ? e.message : "Não deu para buscar o lugar.");
    } finally {
      setEscolhendo(null);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="rotulo">
        Local
      </label>
      <div className="relative mt-2">
        <IconeLocal
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2
                     text-ink-400"
        />
        <input
          id={id}
          value={valor}
          maxLength={200}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={lista.length > 0}
          aria-controls={idLista}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}-e` : undefined}
          placeholder={semChave ? "Onde vai ser" : "Busque um lugar ou escreva"}
          onFocus={() => setFocado(true)}
          onBlur={() => setFocado(false)}
          onChange={(ev) => onMudar(ev.target.value, null)}
          className="h-12 w-full rounded-controle border border-ink-700 bg-ink-900 pl-10 pr-4
                     text-base text-titulo placeholder:text-ink-400 focus:border-accent-500"
        />
      </div>

      {lista.length > 0 && (
        <ul
          id={idLista}
          role="listbox"
          aria-label="Lugares sugeridos"
          className="mt-1.5 overflow-hidden rounded-cartao border border-ink-700 bg-superficie
                     shadow-e2"
        >
          {lista.map((s) => (
            <li key={s.placeId} role="option" aria-selected={false}>
              <button
                type="button"
                // `mousedown` sem padrão: o campo não perde o foco antes do
                // toque chegar, e a lista não some debaixo do dedo.
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => void escolher(s.placeId)}
                disabled={escolhendo !== null}
                className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left
                           transition-colors active:bg-ink-800 hover:bg-ink-800
                           disabled:opacity-60"
              >
                <IconeLocal className="size-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-titulo">{s.name}</span>
                  {s.secondary && (
                    <span className="block truncate text-xs text-ink-400">{s.secondary}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
          <li aria-hidden="true" className="px-3.5 py-1.5 text-right text-miudo text-ink-400">
            sugestões do Google
          </li>
        </ul>
      )}

      {lugar && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-400">
          <IconeCheck className="mt-px size-3.5 shrink-0 text-sucesso-300" />
          <span className="min-w-0 break-words">{lugar.address || "Lugar do Google Maps"}</span>
        </p>
      )}
      {falha && <ErroDoCampo id={`${id}-f`}>{falha}</ErroDoCampo>}
      {erro && <ErroDoCampo id={`${id}-e`}>{erro}</ErroDoCampo>}
    </div>
  );
}
