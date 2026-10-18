import { DEFINICOES_DO_ASSISTENTE, FERRAMENTAS_DA_WEB, FERRAMENTAS_DO_CHAT } from "@yu-book/shared";
import type { NomeDoAssistente } from "@yu-book/shared";

/**
 * O que cada ação faz, dito para quem configura um agente — não para o modelo.
 *
 * Mora aqui, e não em `packages/shared/src/ferramentas.ts`: a `descricao` de lá
 * é o contrato com o modelo, publicada pelo MCP e paga em todo turno do chat
 * (skill `contrato-compartilhado` §4.6). Uma frase de interface ali mudaria as
 * duas superfícies sem ninguém pedir.
 *
 * `Record` total sobre as duas origens, o acervo e a web (Etapa G): ação nova
 * não compila sem uma frase aqui — mesmo as que o chat não oferece, para a
 * próxima que ele passar a oferecer já chegar explicada.
 */
const EXPLICACAO: Record<NomeDoAssistente, string> = {
  search_notes: "Procura nas suas notas e cards por palavra, e lê só os trechos que casam.",
  get_note: "Abre uma nota inteira para ler — o passo depois de achá-la na busca.",
  list_boards: "Vê quais quadros existem e quantos cards cada um tem.",
  get_board: "Abre um quadro com colunas e cards, para saber o que está em cada etapa.",
  get_dashboard: "Confere o que vence, o que atrasou e o que precisa de atenção agora.",
  create_card: "Cria um card numa coluna, quando você pedir.",
  create_note: "Cria uma nota nova, quando você pedir.",
  move_card: "Move um card de coluna.",
  complete_card: "Marca um card como concluído, ou o reabre, quando você pedir — sem movê-lo.",
  trash_note: "Manda uma nota para a lixeira.",
  restore_note: "Tira uma nota da lixeira.",
  // Frente de agenda, Fase 2.
  list_agenda:
    "Vê a agenda de um período, dia a dia: eventos, tarefas e cards com prazo — o que " +
    "ele confere antes de dizer se você está livre.",
  create_event: "Marca um compromisso na agenda, no dia e na hora que você pedir.",
  create_task: "Cria uma tarefa, com ou sem dia e hora, quando você pedir.",
  complete_task: "Marca uma tarefa como feita, ou a reabre, quando você pedir.",
  // Controle da agenda — só o MCP as publica; o chat não as oferece (RN-03).
  update_event: "Muda horário, título ou detalhes de um evento da agenda.",
  delete_event: "Exclui um evento da agenda, sem desfazer.",
  update_task: "Muda título, dia, hora ou detalhes de uma tarefa.",
  delete_task: "Exclui uma tarefa, sem desfazer.",
  convert_event_to_task: "Transforma um evento em tarefa.",
  convert_task_to_event: "Transforma uma tarefa em evento.",
  // Frente Ritmo. Criar e alterar hábito são só do MCP; o chat lê e registra.
  list_habits: "Vê seus hábitos, as atividades e como está a semana de cada um.",
  log_habit: "Registra pontos num hábito pelo que você fez fora do plano, quando você pedir.",
  create_habit: "Cria um hábito com meta semanal e atividades pontuadas.",
  update_habit: "Muda a meta, as atividades ou arquiva um hábito.",
  check_in_event: "Marca presença num evento ligado a hábito, e pontua a atividade dele.",
  get_mood: "Vê como você esteve nos últimos dias: manhã, durante e noite.",
  log_mood: "Registra como você está, de péssimo a ótimo, em até três momentos do dia.",
  list_skills: "Vê as suas skills, com quantas vezes você usou cada uma e o nível.",
  upsert_skill: "Cria uma skill nova ou muda uma que já existe.",
  log_skill_use: "Registra que você usou uma skill agora, quando você contar.",
  open_page:
    "Lê o texto de uma página pública, pelo endereço — o seu ou um que a busca achou. " +
    "LinkedIn nunca, nem endereço da rede interna.",
};

/**
 * O nome do interruptor, quando a permissão pede outra forma que a ação. A
 * ferramenta é "Abrir uma página" — é o que aparece no passo da rotina e na
 * execução, uma vez por uso —, mas o que se liga no agente é a capacidade.
 */
const ROTULO_DO_INTERRUPTOR: Partial<Record<NomeDoAssistente, string>> = {
  open_page: "Abrir páginas",
};

export interface FerramentaOferecida {
  nome: NomeDoAssistente;
  titulo: string;
  explicacao: string;
  escrita: boolean;
  /// Sai do acervo para a web (Etapa G): vai no grupo "Na web" do editor.
  web: boolean;
}

/** A ação sai do Yu-book para a web — o endereço é de terceiro. */
export const ehDaWeb = (nome: NomeDoAssistente) => nome in FERRAMENTAS_DA_WEB;

/** Lê o acervo sem escrever nem sair dele: as de leitura do grupo "Ler". */
export const leOAcervo = (nome: NomeDoAssistente) =>
  !DEFINICOES_DO_ASSISTENTE[nome].escrita && !ehDaWeb(nome);

/**
 * O agente abre endereço na web **e** tem o acervo à mão — por ferramenta de
 * leitura ou já no contexto, em notas-base e fontes vivas. Juntas, as duas
 * coisas são um canal de saída: uma página pode pedir que ele abra outro
 * endereço com as notas embutidas nele. O servidor só *instrui* o modelo a
 * ignorar pedidos escritos em página; isso não é garantia, e por isso a tela
 * avisa. Qualquer ação da web conta, não só `open_page`: toda ela é um endereço
 * que o modelo escolhe — e a que vier depois nasce avisada.
 */
export function levaOAcervoParaFora(
  tools: readonly NomeDoAssistente[],
  acervoNoContexto: boolean,
): boolean {
  return tools.some(ehDaWeb) && (acervoNoContexto || tools.some(leOAcervo));
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
    titulo: ROTULO_DO_INTERRUPTOR[nome] ?? DEFINICOES_DO_ASSISTENTE[nome].titulo,
    explicacao: EXPLICACAO[nome],
    escrita: DEFINICOES_DO_ASSISTENTE[nome].escrita,
    web: ehDaWeb(nome),
  }),
);

/**
 * Agente novo nasce lendo o acervo, sem escrever e sem sair para a web:
 * escrever é uma decisão, e abrir página é saída de rede — o agente liga de
 * propósito (Etapa G). Tirar `!f.web` daqui daria rede a todo agente novo.
 *
 * A agenda também fica desligada: `list_agenda` é leitura, mas de outro
 * domínio que não o acervo, e cada ferramenta ligada é paga em todo turno —
 * o agente de posts não precisa saber do dentista. Quem quer agenda liga, ou
 * parte do modelo "Agenda" (frente de agenda, Fase 2).
 */
const FORA_DO_PADRAO: readonly NomeDoAssistente[] = ["list_agenda"];

export const FERRAMENTAS_PADRAO: NomeDoAssistente[] = FERRAMENTAS_DO_AGENTE.filter(
  (f) => !f.escrita && !f.web && !FORA_DO_PADRAO.includes(f.nome),
).map((f) => f.nome);
