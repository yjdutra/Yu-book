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
}
