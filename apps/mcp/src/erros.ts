import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { ErroDaApi } from "./cliente.js";
import type { Extra } from "./notificacoes.js";

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
          "Confirme o id com search_notes, list_boards ou get_board — o id de coluna só sai " +
          "de get_board. Se a nota foi para a lixeira, nenhuma dessas a enxerga: o id dela " +
          "está na confirmação do trash_note que a excluiu."
        );
      case "VALIDATION_ERROR": {
        // A API responde a erro de Zod com `message: "Dados inválidos"` e o
        // detalhe todo em `issues`. Devolver só a mensagem daria ao modelo uma
        // frase sem informação nenhuma — e é justamente aqui que ele precisa
        // saber qual campo recusou, para corrigir em vez de tentar de novo
        // igual.
        const detalhes = erro.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
        return detalhes
          ? `A API recusou os argumentos: ${detalhes}`
          : `A API recusou a operação: ${erro.message}`;
      }
      case "TITULO_DUPLICADO":
        return (
          "Já existe outra nota ativa com esse título — títulos são únicos por conta, ignorando " +
          "acento e maiúscula. O índice não cobre a lixeira, então o título pode ter sido " +
          "reaproveitado enquanto a nota estava lá. Renomeie a outra nota no aplicativo e tente " +
          "de novo."
        );
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
 * O `extra` do SDK é repassado porque as tools de escrita precisam dele para
 * emitir log e progresso. As tools de leitura declaram handler de um parâmetro
 * só e continuam válidas sem mudar uma linha: em TypeScript, função de aridade
 * menor é atribuível a tipo de função com mais parâmetros.
 *
 * O tipo de retorno é o `CallToolResult` do próprio SDK, não um equivalente
 * escrito à mão: o SDK exige uma assinatura de índice que um tipo caseiro não
 * tem, e manter duas definições do mesmo contrato é o erro que a skill
 * `contrato-compartilhado` descreve.
 */
export function comErro<A>(
  handler: (args: A, extra: Extra) => Promise<CallToolResult>,
): (args: A, extra: Extra) => Promise<CallToolResult> {
  return async (args: A, extra: Extra) => {
    try {
      return await handler(args, extra);
    } catch (erro) {
      console.error("[yu-book-mcp]", erro);
      return { content: [{ type: "text", text: mensagemDeErro(erro) }], isError: true };
    }
  };
}

/**
 * Mesma tradução de erro das tools, para resources. Um resource que falha por
 * rede ou por id inexistente precisa dizer o que fazer, igual a uma tool —
 * quem lê a mensagem é o modelo, e ele vai tentar contornar o que ler.
 *
 * O tipo vem do SDK (`ReadResourceResult`), nunca escrito à mão: o SDK exige
 * uma assinatura de índice que um tipo caseiro não tem.
 */
export function comErroDeResource<A extends unknown[]>(
  handler: (uri: URL, ...args: A) => Promise<ReadResourceResult>,
): (uri: URL, ...args: A) => Promise<ReadResourceResult> {
  return async (uri: URL, ...args: A) => {
    try {
      return await handler(uri, ...args);
    } catch (erro) {
      console.error("[yu-book-mcp]", erro);
      // Resource não tem `isError`: a falha precisa ser exceção para o cliente
      // distinguir "não encontrei" de "aqui está, e está vazio".
      throw new Error(mensagemDeErro(erro));
    }
  };
}
