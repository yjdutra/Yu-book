/**
 * O traço no alto da folha inferior: diz "isto é uma folha que sobe do pé".
 * Enfeite: arrastar não fecha. Toda folha tem um botão "Fechar" — com leitor de
 * tela (TalkBack) o véu fica fora da árvore (`aria-modal`), e o Voltar do
 * Android, que fecha a folha pelo histórico (`useFolhaNoHistorico`), não é
 * `Esc` nem existe no desktop: o botão é o caminho que vale em todo lugar.
 * Some no desktop, onde a folha vira caixa no centro.
 */
export function Alca() {
  return (
    <span aria-hidden="true" className="mx-auto block h-1 w-10 rounded-full bg-ink-700 lg:hidden" />
  );
}
