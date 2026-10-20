import { useMapaDoLugar } from "@yu-book/cliente/lugares";
import { IconeLink, IconeLocal, IconeRota } from "@yu-book/cliente/icones";
import { linkComoChegar, linkDoMapa } from "@yu-book/shared";
import type { EventPlace } from "@yu-book/shared";

/** RNF-16 do web, aqui também: a página aberta não tem referência a esta. */
const FORA = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * O local do evento na visualização: o mapa (quando o lugar veio do Google e
 * o servidor tem chave), o nome, o endereço e as duas saídas para o app de
 * mapas — "Como chegar" e "Abrir no Maps". Sem lugar, só o texto e as
 * saídas, que buscam pelo texto: o link público não pede chave.
 */
export function LocalDoEvento({ local, place }: { local: string; place: EventPlace | null }) {
  const mapa = useMapaDoLugar(place);
  return (
    <div className="overflow-hidden rounded-cartao border border-ink-800/70 bg-ink-900">
      {place && (mapa.url || mapa.carregando) && (
        <a
          {...FORA}
          href={linkDoMapa(local, place)}
          aria-label={`Ver ${local} no Google Maps`}
          className="block aspect-[640/280] w-full bg-ink-800"
        >
          {mapa.url ? (
            <img src={mapa.url} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden="true" className="block size-full animate-pulse bg-ink-800" />
          )}
        </a>
      )}
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent-500/15
                     text-accent-400"
        >
          <IconeLocal className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold text-titulo">{local}</span>
          {place?.address && (
            <span className="block break-words text-xs text-ink-400">{place.address}</span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <a
          {...FORA}
          href={linkComoChegar(local, place)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-controle bg-accent-500
                     text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          <IconeRota className="size-4" />
          Como chegar
        </a>
        <a
          {...FORA}
          href={linkDoMapa(local, place)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-controle bg-ink-800
                     text-sm font-medium text-ink-200 transition active:scale-[0.98]"
        >
          <IconeLink className="size-4" />
          Abrir no Maps
        </a>
      </div>
    </div>
  );
}
