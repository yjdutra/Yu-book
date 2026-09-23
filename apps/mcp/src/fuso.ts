import { FUSO_PADRAO } from "@yu-book/shared";
import type { AiSettings } from "@yu-book/shared";
import { api } from "./cliente.js";

/**
 * O fuso horário **do usuário** — o que decide em que dia cai um prazo.
 *
 * Existe porque a alternativa estava errada e ninguém via. Os formatadores
 * usavam o fuso do *processo*: na máquina do operador isso acertava por acaso,
 * e no serviço hospedado, que roda em UTC, errava sempre. O front grava o prazo
 * às 23:59:59 locais, o que em UTC−3 vira 02:59 do dia seguinte — então o MCP
 * hospedado relatava **todo prazo um dia à frente**, calado.
 *
 * A fonte é `ai_preference.timezone`, a mesma que decide a janela do teto
 * diário de IA. Uma segunda fonte para "o fuso do usuário" divergiria.
 *
 * **Sem cache, de propósito.** Um mapa por credencial resolveria as **cinco**
 * consultas que `GET /ai/settings` custa (a preferência, a soma e a contagem do
 * gasto do dia, os favoritos e o mapa de tarefas), e traria de volta o defeito
 * que já está catalogado neste servidor: mapa indexado por sessão que ninguém
 * esvazia cresce calado — o mapa de sessões de `http.ts` precisou de cinco
 * guardas para não vazar. Uma requisição a mais numa tool que já fala com a API
 * pela rede é custo previsível; um vazamento não é. E um memo por **requisição**
 * economizaria zero: cada handler chama isto uma vez só, e a repetição é entre
 * chamadas de tool. Se um dia doer, o lugar é a `Sessao` de `http.ts`, que já
 * herda aquelas guardas.
 *
 * O custo medido: +1 requisição em `get_board`, `get_dashboard`, `create_card`,
 * `move_card` e `yubook://board/{id}`; zero nas outras cinco superfícies.
 */

/**
 * @param exigir quando `true`, falhar ao ler a preferência **sobe** em vez de
 * recuar. É a diferença entre rótulo e dado: numa leitura, recuar para
 * `FUSO_PADRAO` produz no máximo uma linha de texto com o dia de outro fuso, e
 * derrubar a leitura do quadro inteiro por causa disso seria pior. Numa
 * **escrita**, o fuso vira o instante que fica gravado no banco — recuar ali
 * gravaria um prazo errado em silêncio, que é a única das duas opções que este
 * projeto não aceita. O recuo **nunca** é o fuso do processo: cair no processo
 * é exatamente o defeito que este módulo existe para remover.
 */
export async function fusoDoUsuario({ exigir = false } = {}): Promise<string> {
  try {
    const ajustes = await api.get<AiSettings>("/ai/settings");
    return ajustes.timezone || FUSO_PADRAO;
  } catch (erro) {
    if (exigir) throw erro;
    return FUSO_PADRAO;
  }
}
