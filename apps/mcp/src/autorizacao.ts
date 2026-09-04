import { env } from "./env.js";
import type { Extra } from "./notificacoes.js";

/**
 * A SEGUNDA CAMADA DA TRAVA DE ESCRITA.
 *
 * A primeira é o registro: `criarServidor({ escrita })` decide, uma vez por
 * sessão, se as quatro tools que mudam dado entram no `tools/list`. É uma trava
 * boa e é a que o cliente enxerga — mas é **uma só**, e falha do jeito mais
 * silencioso possível.
 *
 * Duas falhas concretas que só esta camada pega:
 *
 *   1. A tool nova no módulo errado. Uma quinta tool de escrita registrada
 *      dentro de `registrarToolsDeNotas` em vez de `registrarEscritaDeNotas`
 *      fica registrada **sempre** — para um token de leitura, e contra a API de
 *      produção no stdio. Nada reclama: nem o compilador, nem os testes, nem a
 *      execução.
 *
 *   2. O escopo que encolhe com a sessão viva. `exchangeRefreshToken` aceita
 *      `scope` no pedido e filtra o concedido, então um cliente pode renovar
 *      pedindo só leitura e seguir usando o mesmo `mcp-session-id`. O `http.ts`
 *      encerra a sessão quando percebe, mas quem garante que a escrita não
 *      acontece é a checagem aqui, no ponto da chamada.
 *
 * Esta fase já mostrou duas vezes que defesa única falha calada: o envelope sem
 * rótulo de tipo e o `client_id` vazio passaram por revisão e por 32 testes.
 */

export const ESCOPO_LEITURA = "yubook:read";
export const ESCOPO_ESCRITA = "yubook:write";

/**
 * A regra sob HTTP: o desligamento global **e** o escopo do token.
 *
 * `MCP_ESCRITA_HABILITADA=0` vence um token que traga `yubook:write` — é o
 * único desligamento global deste transporte, e a trava por host local não
 * participa dele.
 */
export function escritaPermitida(escopos: readonly string[]): boolean {
  return env.escritaHabilitada && escopos.includes(ESCOPO_ESCRITA);
}

/**
 * A mesma pergunta, no ponto da chamada, **e nos dois transportes**.
 *
 *   stdio  a API é local?          — não há identidade para conferir, mas há a
 *                                    pergunta que importa ali: estou escrevendo
 *                                    onde eu acho que estou?
 *   http   o token autoriza?       — o desligamento global e o escopo
 *
 * Não é `return true` no stdio, e a diferença é o que pega a falha 1: uma tool
 * de escrita registrada sem condição continuaria recusando contra uma API
 * remota, que é o desastre que `YUBOOK_ESCRITA_REMOTA` existe para evitar.
 */
export function podeEscrever(extra: Extra): boolean {
  if (!env.ehHttp) return env.escritaLiberada;
  return escritaPermitida(extra.authInfo?.scopes ?? []);
}

/** O que o modelo lê quando a escrita é recusada. Ver `comErroDeEscrita`. */
export function motivoDaRecusa(): string {
  if (!env.ehHttp) {
    return (
      "Esta operação muda dado, e o servidor MCP está apontado para uma API que não é local. " +
      "As tools de escrita ficam desligadas nessa situação. **Nada foi alterado.** " +
      "Quem resolve é o operador, apontando YUBOOK_API_URL para um host local ou declarando " +
      "YUBOOK_ESCRITA_REMOTA=1 — não há nada que você possa fazer daqui."
    );
  }
  if (!env.escritaHabilitada) {
    return (
      "A escrita está desligada neste servidor (MCP_ESCRITA_HABILITADA=0). **Nada foi alterado**, " +
      "e repetir a chamada não vai mudar isso. Quem resolve é o operador do servidor."
    );
  }
  return (
    "Esta autorização não inclui escrita — o token apresentado tem apenas leitura. " +
    "**Nada foi alterado.** Repetir a chamada não resolve: é preciso reconectar ao servidor " +
    "Yu-book e marcar a permissão de escrita na tela de autorização."
  );
}
