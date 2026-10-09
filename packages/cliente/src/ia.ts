/**
 * As chaves de cache da IA que os dois fronts leem (frente de agenda, Fase
 * 6). As consultas continuam em cada app — o web tem a tela de
 * ajustes, o móvel só lê —, mas a chave de cache é uma só: quem invalida num
 * lugar alcança o outro.
 *
 * Só as chaves, de propósito: no web este módulo vai ao chunk inicial (a
 * sessão do chat invalida `CHAVE_AJUSTES`), e o porquê do campo bloqueado, que
 * só o compositor lê, mora em `motivoSemChat.ts` (contrato §6).
 */

export const CHAVE_SAUDE_IA = ["ia", "saude"] as const;
/// A tela de ajustes mostra o gasto do dia, e uma mensagem do chat o move.
export const CHAVE_AJUSTES = ["ia", "ajustes"] as const;
export const CHAVE_AGENTES = ["ia", "agentes"] as const;
