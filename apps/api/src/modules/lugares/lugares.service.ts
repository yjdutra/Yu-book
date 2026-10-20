import type { PlaceDetail, PlaceSuggestion } from "@yu-book/shared";
import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";

/* ---------------------------------------------------------------
   O Google para o local do evento: Places API (New) e Maps Static.
   Saída de host fixo (INV-08): o endereço é o de `env`, e o que vem
   de fora só entra codificado na query ou no caminho — nunca escolhe
   o host. A chave não sai da API: nem na resposta, nem no mapa, que
   volta como imagem.
   --------------------------------------------------------------- */

const ORCAMENTO_MS = 4000;

const indisponivel = () =>
  new AppError(
    503,
    "MAPAS_INDISPONIVEL",
    "O servidor não tem chave do Google Maps: o local fica só como texto.",
  );
const falhou = () =>
  new AppError(502, "MAPAS_FALHOU", "O Google Maps não respondeu. Tente de novo.");

/// Lida a cada chamada, e não guardada numa constante do módulo: o teste do
/// "sem chave" a apaga de `env` e a devolve, sem reimportar nada.
function chave(): string {
  const valor = env.GOOGLE_MAPS_API_KEY;
  if (!valor) throw indisponivel();
  return valor;
}

/// Em teste, só o dublê local: a suíte nunca gasta cota do Google.
function conferirHost(url: string): void {
  if (env.NODE_ENV === "test" && !new URL(url).hostname.startsWith("127.")) {
    throw new Error("teste tentou falar com o Google de verdade — aponte para o dublê");
  }
}

async function pedir(url: string, init: RequestInit): Promise<Response> {
  conferirHost(url);
  let resposta: Response;
  try {
    resposta = await fetch(url, { ...init, signal: AbortSignal.timeout(ORCAMENTO_MS) });
  } catch {
    throw falhou();
  }
  if (!resposta.ok) throw falhou();
  return resposta;
}

interface RespostaAutocomplete {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
}

/** As sugestões para o que se digitou, em português e com o Brasil como região. */
export async function sugerir(q: string, sessao: string): Promise<PlaceSuggestion[]> {
  const resposta = await pedir(`${env.GOOGLE_PLACES_BASE_URL}/places:autocomplete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": chave() },
    body: JSON.stringify({ input: q, sessionToken: sessao, languageCode: "pt-BR", regionCode: "br" }),
  });
  const corpo = (await resposta.json()) as RespostaAutocomplete;
  return (corpo.suggestions ?? []).flatMap(({ placePrediction: p }) => {
    const nome = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
    if (!p?.placeId || !nome) return [];
    return [{ placeId: p.placeId, name: nome, secondary: p.structuredFormat?.secondaryText?.text ?? "" }];
  });
}

interface RespostaDetalhe {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

/**
 * O lugar escolhido: nome, endereço e coordenadas — só esses campos (a
 * máscara decide o preço da chamada). A sessão fecha a cobrança do
 * autocomplete que levou até aqui.
 */
export async function detalhar(placeId: string, sessao?: string): Promise<PlaceDetail> {
  const query = new URLSearchParams({ languageCode: "pt-BR", regionCode: "br" });
  if (sessao) query.set("sessionToken", sessao);
  const resposta = await pedir(
    `${env.GOOGLE_PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}?${query}`,
    {
      headers: {
        "x-goog-api-key": chave(),
        "x-goog-fieldmask": "id,displayName,formattedAddress,location",
      },
    },
  );
  const corpo = (await resposta.json()) as RespostaDetalhe;
  const lat = corpo.location?.latitude;
  const lng = corpo.location?.longitude;
  if (!corpo.id || typeof lat !== "number" || typeof lng !== "number") throw falhou();
  return {
    placeId: corpo.id,
    name: (corpo.displayName?.text ?? corpo.formattedAddress ?? "").slice(0, 200),
    address: (corpo.formattedAddress ?? "").slice(0, 300),
    lat,
    lng,
  };
}

/// O mapa no tema do app: no escuro, as cores da rampa `ink`, e sem os pontos
/// de interesse que disputariam com o marcador.
const ESTILO_ESCURO = [
  "element:geometry|color:0x161b26",
  "element:labels.text.fill|color:0x8a93a6",
  "element:labels.text.stroke|color:0x0b0e14",
  "feature:road|element:geometry|color:0x273049",
  "feature:water|element:geometry|color:0x0e1626",
  "feature:poi|visibility:off",
  "feature:transit|visibility:off",
];

/** A imagem do mapa em volta do ponto, 2× para tela de celular. */
export async function mapa(
  lat: number,
  lng: number,
  tema: "claro" | "escuro",
): Promise<{ bytes: Buffer; tipo: string }> {
  const ponto = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const query = new URLSearchParams({
    center: ponto,
    zoom: "15",
    size: "640x280",
    scale: "2",
    markers: `color:0x5b5bd6|${ponto}`,
    key: chave(),
  });
  if (tema === "escuro") for (const estilo of ESTILO_ESCURO) query.append("style", estilo);
  const resposta = await pedir(`${env.GOOGLE_STATICMAP_BASE_URL}?${query}`, {});
  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw falhou();
  return { bytes: Buffer.from(await resposta.arrayBuffer()), tipo };
}
