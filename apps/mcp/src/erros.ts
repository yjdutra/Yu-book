import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { motivoDaRecusa, podeEscrever } from "./autorizacao.js";
import { comIdentidadeDaApi, ErroDaApi } from "./cliente.js";
import { env } from "./env.js";
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
        // A instrução tem que caber no transporte. Sob HTTP, `YUBOOK_EMAIL` e
        // `YUBOOK_PASSWORD` são **proibidas** pelo `superRefine` do `env.ts` —
        // mandar conferi-las seria mandar o operador procurar uma variável que
        // o boot recusa. Ali a identidade vem do token de quem chamou, e quem
        // pode consertar é o cliente MCP, renovando.
        return env.ehHttp
          ? "A autorização deste cliente no Yu-book não vale mais. O cliente MCP precisa renovar " +
              "o token — reconecte-se ao servidor. Nenhum dado foi alterado."
          : "Não foi possível autenticar na API do Yu-book. " +
              "Confira YUBOOK_EMAIL e YUBOOK_PASSWORD no ambiente do servidor.";
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
 * Abre o contexto de identidade, se a requisição trouxe uma.
 *
 * O caminho é `req.auth` → `extra.authInfo` → `extra` do `AuthInfo`, que é onde
 * `verifyAccessToken` (`auth/provedor.ts`) põe o `accessToken` da API já
 * decifrado. Sem `authInfo` — que é o caso do stdio — roda direto, e o
 * `cliente.ts` decide o que fazer com a ausência.
 */
function comIdentidade<T>(extra: Extra, fn: () => Promise<T>): Promise<T> {
  const tokenDaApi = extra.authInfo?.extra?.["tokenDaApi"];
  return typeof tokenDaApi === "string" ? comIdentidadeDaApi(tokenDaApi, fn) : fn();
}

/**
 * Envolve o handler de uma tool para que erro vire resultado com `isError`, e
 * não exceção crua. O log vai para stderr — em stdio, stdout é do protocolo.
 *
 * **É AQUI QUE A IDENTIDADE DE QUEM CHAMOU ENTRA EM CENA.** Este invólucro
 * envolve todo handler de tool que existe, então abrir o contexto aqui cobre
 * 100% deles sem tocar em nenhuma assinatura. O `authInfo` é posto pelo SDK a
 * partir do `req.auth` da requisição HTTP, e `verifyAccessToken` decifra ali o
 * `accessToken` da API. Em stdio não há `authInfo`, e o `cliente.ts` cai na
 * conta do ambiente — que naquele transporte é a identidade certa.
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
      return await comIdentidade(extra, () => handler(args, extra));
    } catch (erro) {
      console.error("[yu-book-mcp]", erro);
      return { content: [{ type: "text", text: mensagemDeErro(erro) }], isError: true };
    }
  };
}

/**
 * O invólucro das tools que **mudam dado**, e a segunda camada da trava.
 *
 * A primeira camada é o registro: `criarServidor({ escrita })` decide, uma vez
 * por sessão, se estas tools entram no `tools/list`. Esta aqui pergunta de
 * novo, na chamada — porque a primeira falha calada, e esta fase já mostrou
 * duas vezes que defesa única não basta. Ver `autorizacao.ts` para as duas
 * falhas concretas que só esta camada pega.
 *
 * A ORDEM É PARTE DA CORREÇÃO: o guarda roda antes de `relatar(...)` e antes de
 * qualquer chamada de API. Uma recusa não pode emitir log de uma escrita que
 * não aconteceu — o log das tools de escrita é a única trilha de auditoria que
 * chega ao usuário, e um registro de escrita falsa é pior que nenhum.
 *
 * A recusa volta como `isError`, com texto que diz ao modelo que **nada foi
 * alterado** e que repetir não resolve. É a primeira coisa que ele tenta
 * descobrir depois de um erro numa tool que muda dado; sem isso ele tenta de
 * novo, e uma escrita que "falhou" duas vezes pode ter acontecido duas vezes.
 */
export function comErroDeEscrita<A>(
  handler: (args: A, extra: Extra) => Promise<CallToolResult>,
): (args: A, extra: Extra) => Promise<CallToolResult> {
  const protegido = comErro(handler);
  return async (args: A, extra: Extra) => {
    if (!podeEscrever(extra)) {
      console.error("[yu-book-mcp] escrita recusada: o pedido não tem autorização para ela");
      return { content: [{ type: "text", text: motivoDaRecusa() }], isError: true };
    }
    return protegido(args, extra);
  };
}

/**
 * Mesma tradução de erro das tools, para resources. Um resource que falha por
 * rede ou por id inexistente precisa dizer o que fazer, igual a uma tool —
 * quem lê a mensagem é o modelo, e ele vai tentar contornar o que ler.
 *
 * O tipo vem do SDK (`ReadResourceResult`), nunca escrito à mão: o SDK exige
 * uma assinatura de índice que um tipo caseiro não tem.
 *
 * O `extra` **não** aparece no handler declarado, e mesmo assim precisa chegar
 * aqui — é dele que sai a identidade. O SDK o manda sempre por último, nas duas
 * formas de callback que ele tem: `(uri, extra)` para resource direto e
 * `(uri, variables, extra)` para template. Daí o tipo de retorno acrescentar
 * `Extra` ao fim da tupla: quem escreve o handler continua ignorando o
 * parâmetro, e o invólucro o retira antes de repassar.
 */
export function comErroDeResource<A extends unknown[]>(
  handler: (uri: URL, ...args: A) => Promise<ReadResourceResult>,
): (uri: URL, ...args: [...A, Extra]) => Promise<ReadResourceResult> {
  return async (uri: URL, ...args: [...A, Extra]) => {
    const extra = args[args.length - 1] as Extra;
    const doHandler = args.slice(0, -1) as unknown as A;
    try {
      return await comIdentidade(extra, () => handler(uri, ...doHandler));
    } catch (erro) {
      console.error("[yu-book-mcp]", erro);
      // Resource não tem `isError`: a falha precisa ser exceção para o cliente
      // distinguir "não encontrei" de "aqui está, e está vazio".
      throw new Error(mensagemDeErro(erro));
    }
  };
}
