import { FERRAMENTAS_DO_ACERVO, FERRAMENTAS_DO_CHAT } from "@yu-book/shared";
import type { NomeDeFerramenta } from "@yu-book/shared";

/**
 * O que cada ação faz, dito para quem configura um agente — não para o modelo.
 *
 * Mora aqui, e não em `packages/shared/src/ferramentas.ts`: a `descricao` de lá
 * é o contrato com o modelo, publicada pelo MCP e paga em todo turno do chat
 * (skill `contrato-compartilhado` §4.6). Uma frase de interface ali mudaria as
 * duas superfícies sem ninguém pedir.
 *
 * `Record` total: ação nova no acervo não compila sem uma frase aqui — mesmo
 * as que o chat não oferece, para a próxima que ele passar a oferecer já
 * chegar explicada.
 */
const EXPLICACAO: Record<NomeDeFerramenta, string> = {
  search_notes: "Procura nas suas notas e cards por palavra, e lê só os trechos que casam.",
  get_note: "Abre uma nota inteira para ler — o passo depois de achá-la na busca.",
  list_boards: "Vê quais quadros existem e quantos cards cada um tem.",
  get_board: "Abre um quadro com colunas e cards, para saber o que está em cada etapa.",
  get_dashboard: "Confere o que vence, o que atrasou e o que precisa de atenção agora.",
  create_card: "Cria um card numa coluna, quando você pedir.",
  create_note: "Cria uma nota nova, quando você pedir.",
  move_card: "Move um card de coluna.",
  trash_note: "Manda uma nota para a lixeira.",
  restore_note: "Tira uma nota da lixeira.",
};

export interface FerramentaOferecida {
  nome: NomeDeFerramenta;
  titulo: string;
  explicacao: string;
  escrita: boolean;
}

/**
 * As ações que um agente pode receber: as do chat, e só elas. Derivado de
 * `FERRAMENTAS_DO_CHAT` (INV-54) — uma ação que passe a valer no chat aparece
 * no editor sozinha; uma que não vale não é oferecida, porque o servidor a
 * recusaria ao salvar.
 */
export const FERRAMENTAS_DO_AGENTE: readonly FerramentaOferecida[] = FERRAMENTAS_DO_CHAT.map(
  (nome) => ({
    nome,
    titulo: FERRAMENTAS_DO_ACERVO[nome].titulo,
    explicacao: EXPLICACAO[nome],
    escrita: FERRAMENTAS_DO_ACERVO[nome].escrita,
  }),
);

/** Agente novo nasce lendo e sem escrever: escrever é uma decisão, não um padrão. */
export const FERRAMENTAS_PADRAO: NomeDeFerramenta[] = FERRAMENTAS_DO_AGENTE.filter(
  (f) => !f.escrita,
).map((f) => f.nome);
