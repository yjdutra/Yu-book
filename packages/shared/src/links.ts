import { z } from "zod";
import { LINK_KINDS } from "./enums.js";
import type { LinkKind } from "./enums.js";

export const MAX_URL = 2000;
export const MAX_TITULO_LINK = 200;

export const linkKindSchema = z.enum(LINK_KINDS);

export interface UrlNormalizada {
  url: string;
  domain: string;
}

/**
 * Normaliza a URL para comparação e para gravar (RN-02).
 *
 * A mesma função roda no servidor (que decide o que grava) e no front (que
 * recusa cedo o que não é link e mostra o domínio no item otimista) — duas
 * implementações divergiriam, e a unicidade do banco depende disto.
 *
 * O que é descartado: fragmento (`#…`), `www.`, barras finais e credenciais.
 * O que é preservado: a query string — `watch?v=A` e `watch?v=B` são vídeos
 * diferentes, e essa é justamente a informação que distingue um do outro.
 *
 * Devolve `null` para qualquer coisa que não seja http/https (RF-07).
 */
export function normalizarUrl(entrada: string): UrlNormalizada | null {
  const texto = entrada.trim();
  if (!texto || texto.length > MAX_URL) return null;

  // "github.com" digitado à mão é uma URL sem esquema, não um esquema inválido.
  const temEsquema = /^[a-z][a-z0-9+.-]*:/i.test(texto);
  const candidato = temEsquema ? texto : `https://${texto}`;

  let url: URL;
  try {
    url = new URL(candidato);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || !url.hostname.includes(".")) return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "");

  // `URL` sempre renderiza a barra do caminho vazio; para comparar, ela sai.
  const normalizada = url.toString().replace(/\/$/, "");
  if (normalizada.length > MAX_URL) return null;

  return { url: normalizada, domain: url.hostname };
}

/* ------------------------------------------------------------- YouTube */

const HOSTS_YOUTUBE = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];
/** Id de vídeo do YouTube: 11 caracteres de um alfabeto fixo. */
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrai o id do vídeo, ou `null` se não for um link de vídeo do YouTube.
 *
 * Cobre as quatro formas que aparecem na prática: `watch?v=`, `youtu.be/`,
 * `/shorts/` e `/embed/`. A URL chega aqui já normalizada (sem `www.`).
 */
export function idDoYoutube(url: string): string | null {
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return null;
  }

  const host = alvo.hostname.replace(/^www\./, "");
  if (!HOSTS_YOUTUBE.includes(host)) return null;

  const candidato =
    host === "youtu.be"
      ? alvo.pathname.slice(1)
      : (alvo.searchParams.get("v") ??
        alvo.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ??
        "");

  return ID_YOUTUBE.test(candidato) ? candidato : null;
}

/**
 * Miniatura do vídeo, montada a partir do id — sem requisição no salvamento.
 *
 * `mqdefault` tem 320×180 e ~10 KB: o suficiente para reconhecer o vídeo numa
 * lista, sem pesar. Quem baixa é o navegador, na hora de exibir.
 */
export function thumbnailDoYoutube(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Segundos em `4:12` ou `1:02:33` — como o próprio YouTube mostra. */
export function formatarDuracao(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}

/** `PT1H2M33S` (formato do YouTube Data API) em segundos. */
export function duracaoIso8601EmSegundos(iso: string): number | null {
  const m = iso.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h = "0", min = "0", s = "0"] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

export const linkInputSchema = z.object({
  url: z.string().trim().min(1, "Informe uma URL").max(MAX_URL),
  kind: linkKindSchema.default("depois"),
  /** Só o desfazer usa: recria o link com o nome que ele tinha (RN-05). */
  title: z.string().trim().min(1).max(MAX_TITULO_LINK).optional(),
});

export const linkUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITULO_LINK).optional(),
    kind: linkKindSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

export const linkMoveSchema = z.object({ position: z.number().int().min(0) });

export const listLinksQuerySchema = z.object({ kind: linkKindSchema.optional() });

export type LinkInput = z.input<typeof linkInputSchema>;
export type LinkUpdateInput = z.input<typeof linkUpdateSchema>;

export interface Link {
  id: string;
  url: string;
  title: string;
  domain: string;
  kind: LinkKind;
  position: number;
  createdAt: string;
  /** true quando o título é o domínio, porque a página não respondeu (RF-14). */
  semTitulo: boolean;
  /** Duração do vídeo, quando dá para saber. Hoje, só YouTube com chave. */
  durationSeconds: number | null;
}
