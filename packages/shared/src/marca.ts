import { z } from "zod";
import type { AiVia } from "./enums.js";

/**
 * A marca de conteúdo gerado por IA — Etapa C da frente de IA
 * (`docs/prd-ia-no-yu-book.md`). O NO2 revisto permite nota escrita por modelo
 * **desde que marcada no dado**; esta é a marca.
 *
 * Três regras que a forma daqui não mostra e o servidor garante:
 *
 * - **É gravada só pelo servidor.** O chat passa a origem ao service por
 *   parâmetro; o MCP a declara em `origin` (ver `origemMcpSchema`). O front
 *   nunca a envia, e nenhuma rota de atualização a aceita.
 * - **Nunca some.** Editar título ou corpo à mão preenche `revisedAt` e deixa
 *   o resto como estava — "gerada · revisada", e não "deixou de ser gerada".
 * - **Mover, favoritar ou mudar tag não é revisão.** Só o texto conta.
 *
 * `null` quando o conteúdo é humano, que é o caso comum — por isso o campo é
 * um objeto anulável e não cinco campos soltos no resumo.
 */
export interface AiMark {
  generatedAt: string;
  via: AiVia;
  /// No chat, o modelo que respondeu; no MCP, o nome do cliente. `null` quando
  /// a superfície não soube dizer.
  author: string | null;
  /// De que conversa veio. Some se a conversa for apagada; a marca, não.
  conversationId: string | null;
  revisedAt: string | null;
}

export const MAX_AUTOR_IA = 120;

/**
 * O que o servidor MCP declara ao criar nota ou card. Só `mcp`: o chat não
 * passa pelo corpo da requisição, e aceitar `chat` aqui deixaria um cliente
 * HTTP qualquer se passar pelo assistente — com um `conversationId` alheio.
 */
export const origemMcpSchema = z.object({
  via: z.literal("mcp"),
  author: z.string().trim().min(1).max(MAX_AUTOR_IA),
});

export type OrigemMcp = z.infer<typeof origemMcpSchema>;
