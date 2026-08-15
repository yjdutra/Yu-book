import { duracaoIso8601EmSegundos, idDoYoutube } from "@yu-book/shared";
import { env } from "../../env.js";

/**
 * Metadados de vídeo do YouTube.
 *
 * Por que não usar o leitor genérico de título: a página de um vídeo tem
 * ~1,3 MB e o `<title>` fica além do limite de 512 KB que a busca genérica lê
 * (RNF-04 da Fase 3). O resultado era o link salvo como "youtube.com".
 *
 * O oEmbed resolve isso com ~1 KB de JSON, sem chave de API e sem cota.
 */

const OEMBED = "https://www.youtube.com/oembed";
const DATA_API = "https://www.googleapis.com/youtube/v3/videos";
const ORCAMENTO_MS = 2000;

export interface MetadadosYoutube {
  title: string;
  durationSeconds: number | null;
}

interface RespostaOembed {
  title?: unknown;
}

interface RespostaDataApi {
  items?: { contentDetails?: { duration?: unknown } }[];
}

/**
 * Duração só existe com `YOUTUBE_API_KEY` configurada.
 *
 * Sem chave não há caminho barato: o `lengthSeconds` da página do vídeo fica
 * por volta do byte 700.000, e baixar 750 KB por link salvo não se paga.
 * Sem a variável, esta função nem faz a requisição.
 */
async function duracao(id: string, restante: number): Promise<number | null> {
  if (!env.YOUTUBE_API_KEY || restante <= 0) return null;

  try {
    const url = `${DATA_API}?id=${id}&part=contentDetails&key=${env.YOUTUBE_API_KEY}`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(restante) });
    if (!resposta.ok) return null;

    const dados = (await resposta.json()) as RespostaDataApi;
    const iso = dados.items?.[0]?.contentDetails?.duration;
    return typeof iso === "string" ? duracaoIso8601EmSegundos(iso) : null;
  } catch {
    return null;
  }
}

/**
 * Título e duração de um vídeo, ou `null` quando a URL não é do YouTube ou o
 * vídeo não responde (privado, removido, id inválido).
 *
 * Como na busca genérica, falhar aqui nunca impede o link de ser salvo: quem
 * chama trata `null` como "siga pelo caminho normal".
 */
export async function metadadosDoYoutube(url: string): Promise<MetadadosYoutube | null> {
  const id = idDoYoutube(url);
  if (!id) return null;

  const inicio = Date.now();

  let titulo: string;
  try {
    // Host fixo e nosso: o alvo não vem do usuário, só o parâmetro. Não há
    // superfície de SSRF aqui, ao contrário da busca genérica de título.
    const resposta = await fetch(
      `${OEMBED}?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(ORCAMENTO_MS) },
    );
    if (!resposta.ok) return null;

    const dados = (await resposta.json()) as RespostaOembed;
    if (typeof dados.title !== "string" || !dados.title.trim()) return null;
    titulo = dados.title.trim();
  } catch {
    return null;
  }

  const restante = ORCAMENTO_MS - (Date.now() - inicio);
  return { title: titulo, durationSeconds: await duracao(id, restante) };
}
