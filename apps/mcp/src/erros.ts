import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErroDaApi } from "./cliente.js";

/**
 * Erro que chega ao modelo é texto, e ele vai tentar contornar o que ler —
 * então o que ele lê precisa dizer o que fazer. Traduzimos os códigos estáveis
 * da API em instrução acionável. Ramificamos por `code`, nunca por `message`:
 * é a mesma regra do front (`packages/shared/src/errors.ts`).
 */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroDaApi) {
    switch (erro.code) {
      case "NOT_FOUND":
        return (
          "Não existe recurso com esse id, ou ele pertence a outra conta. " +
          "Confirme o id com search_notes ou list_boards."
        );
      case "VALIDATION_ERROR":
        return `A API recusou os argumentos: ${erro.message}`;
      case "RATE_LIMITED":
        return "A API está limitando as requisições. Espere alguns segundos antes de tentar de novo.";
      case "UNAUTHORIZED":
      case "TOKEN_EXPIRED":
        return (
          "Não foi possível autenticar na API do Yu-book. " +
          "Confira YUBOOK_EMAIL e YUBOOK_PASSWORD no ambiente do servidor."
        );
      default:
        return `A API do Yu-book respondeu ${erro.status} (${erro.code}): ${erro.message}`;
    }
  }

  // `fetch` falha com TypeError quando não consegue abrir a conexão.
  if (erro instanceof TypeError) {
    return `A API do Yu-book não respondeu. Ela está no ar? (${erro.message})`;
  }

  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Envolve o handler de uma tool para que erro vire resultado com `isError`, e
 * não exceção crua. O log vai para stderr — em stdio, stdout é do protocolo.
 *
 * O tipo de retorno é o `CallToolResult` do próprio SDK, não um equivalente
 * escrito à mão: o SDK exige uma assinatura de índice que um tipo caseiro não
 * tem, e manter duas definições do mesmo contrato é o erro que a skill
 * `contrato-compartilhado` descreve.
 */
export function comErro<A>(
  handler: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (erro) {
      console.error("[yu-book-mcp]", erro);
      return { content: [{ type: "text", text: mensagemDeErro(erro) }], isError: true };
    }
  };
}
