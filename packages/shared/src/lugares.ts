import { z } from "zod";
import type { EventPlace } from "./eventos.js";

/* ---------------------------------------------------------------
   Lugares do Google para o local do evento. Quem fala com o Google
   é a API (a chave não sai dela); aqui ficam o contrato das rotas
   `/places/…` e os links públicos do Maps, que não pedem chave.
   --------------------------------------------------------------- */

/** O token de sessão do autocomplete: o Google cobra a sessão, não cada tecla. */
const sessaoSchema = z.string().uuid("Sessão inválida");

export const MIN_BUSCA_DE_LUGAR = 3;

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(MIN_BUSCA_DE_LUGAR).max(200),
  session: sessaoSchema,
});

export const placeDetailQuerySchema = z.object({ session: sessaoSchema.optional() });

export const placeMapQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  tema: z.enum(["claro", "escuro"]).default("escuro"),
});

/** Uma sugestão do autocomplete: o nome em cima, o resto do endereço embaixo. */
export interface PlaceSuggestion {
  placeId: string;
  name: string;
  secondary: string;
}

/** O detalhe do lugar escolhido: o nome vai para `location`, o resto para `place`. */
export interface PlaceDetail extends EventPlace {
  name: string;
}

const MAPS = "https://www.google.com/maps";

/**
 * O lugar no Google Maps — pelo `placeId` quando há, senão pela busca do
 * texto. Link público: no celular abre o app de mapas.
 */
export function linkDoMapa(local: string, place: EventPlace | null): string {
  const q = encodeURIComponent(place ? `${local}, ${place.address}` : local);
  return place
    ? `${MAPS}/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(place.placeId)}`
    : `${MAPS}/search/?api=1&query=${q}`;
}

/** A rota até o lugar, a partir de onde o aparelho estiver. */
export function linkComoChegar(local: string, place: EventPlace | null): string {
  if (!place) return `${MAPS}/dir/?api=1&destination=${encodeURIComponent(local)}`;
  return (
    `${MAPS}/dir/?api=1&destination=${place.lat},${place.lng}` +
    `&destination_place_id=${encodeURIComponent(place.placeId)}`
  );
}
