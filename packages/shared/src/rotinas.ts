import { z } from "zod";
import type { AgentColor } from "./agentes.js";
import type { NomeDeFerramenta } from "./ferramentas.js";

/**
 * Rotinas — Etapa E da frente de IA (`docs/prd-ia-no-yu-book.md`).
 *
 * Uma rotina encadeia agentes numa sequência fixa, disparada à mão: parte da
 * próxima ideia de uma coluna **ou** de um pedido escrito nela, passa por cada
 * agente e grava o resultado como card numa coluna ou como nota nova (a
 * emenda da Etapa E trouxe o pedido e a nota). Quatro regras que a forma daqui
 * não mostra e o servidor garante:
 *
 * - **A rotina só escreve pelo código, na saída.** Os passos recebem apenas as
 *   ferramentas de **leitura** do agente; o card de saída e o destino da ideia
 *   são do código, no fim de uma execução bem-sucedida. Texto de instrução não
 *   concede ferramenta (RN-14).
 * - **Dois tetos cortam.** O diário, de sempre, e o por execução
 *   (`runCapMicros`), conferidos antes de **cada** chamada ao provedor.
 * - **Uma execução ativa por conta**, e a ideia é escolhida pelo registro: o
 *   primeiro card ativo da entrada sem execução `concluida` nem `em_andamento`
 *   desta rotina. Falhou ou foi cancelada, a mesma ideia volta na próxima. Na
 *   rotina por pedido não há ideia a escolher: cada execução é independente.
 * - **A execução roda no servidor, desacoplada da aba.** Iniciar responde na
 *   hora; a tela acompanha por SSE e pode fechar e voltar.
 */

export const MAX_NOME_ROTINA = 60;
export const MAX_DESCRICAO_ROTINA = 160;
export const MAX_PASSOS_DA_ROTINA = 6;
export const MAX_INSTRUCAO_DO_PASSO = 2_000;

/// US$ 0,50 por execução. Três passos com contexto de agente cabem com folga
/// nos modelos baratos, e um modelo caro em ciclo para antes de doer.
export const TETO_POR_EXECUCAO_PADRAO_MICROS = 500_000;
/// US$ 10. Acima disto o teto por execução deixa de ser um freio — e o diário
/// continua valendo por cima dele.
export const TETO_POR_EXECUCAO_MAXIMO_MICROS = 10_000_000;

/// Espelha o enum `AiStepMode` do Prisma. "reescreve" substitui o rascunho;
/// "revisa" registra observações e não mexe nele.
export const ROUTINE_STEP_MODES = ["reescreve", "revisa"] as const;
export type RoutineStepMode = (typeof ROUTINE_STEP_MODES)[number];

/// Espelha `AiConsumeAction`. O que o código faz com a ideia depois de uma
/// execução bem-sucedida.
export const ROUTINE_CONSUME_ACTIONS = ["mover", "arquivar", "manter"] as const;
export type RoutineConsumeAction = (typeof ROUTINE_CONSUME_ACTIONS)[number];

/// Espelha `AiOutputTitle`: o título da saída é o da ideia, a primeira linha
/// do rascunho final, ou um texto fixo (`outputTitleText`). `ideia` não vale
/// com entrada por pedido — não há ideia.
export const ROUTINE_OUTPUT_TITLES = ["ideia", "primeira_linha", "fixo"] as const;
export type RoutineOutputTitle = (typeof ROUTINE_OUTPUT_TITLES)[number];

/// Espelha `AiInputKind`: a próxima ideia de uma coluna, ou um pedido escrito
/// na rotina, o mesmo a cada execução.
export const ROUTINE_INPUT_KINDS = ["coluna", "pedido"] as const;
export type RoutineInputKind = (typeof ROUTINE_INPUT_KINDS)[number];

/// Espelha `AiOutputKind`: um card numa coluna, ou uma nota nova.
export const ROUTINE_OUTPUT_KINDS = ["card", "nota"] as const;
export type RoutineOutputKind = (typeof ROUTINE_OUTPUT_KINDS)[number];

export const MAX_PEDIDO_DA_ROTINA = 4_000;
/// Cabe no título de card (`MAX_CARD_TITULO`) e de nota com folga para o
/// sufixo de data e hora que a nota ganha quando o título já existe.
export const MAX_TITULO_FIXO_DA_ROTINA = 120;

/// Espelha `AiRunStatus`. `interrompida` é a execução que o processo perdeu
/// (redeploy, queda): parou de pulsar, e a varredura a fechou.
export const ROUTINE_RUN_STATUSES = [
  "em_andamento",
  "concluida",
  "falhou",
  "cancelada",
  "interrompida",
] as const;
export type RoutineRunStatus = (typeof ROUTINE_RUN_STATUSES)[number];

/// Espelha `AiRunStepStatus`. `pulado` é o passo que não chegou a rodar porque
/// a execução parou antes dele.
export const ROUTINE_RUN_STEP_STATUSES = [
  "pendente",
  "rodando",
  "concluido",
  "falhou",
  "pulado",
] as const;
export type RoutineRunStepStatus = (typeof ROUTINE_RUN_STEP_STATUSES)[number];

/// O resumo de um pedido: o que a miniatura mostra e o `inputTitle` da execução.
export const MAX_RESUMO_DO_PEDIDO = 80;

/**
 * A primeira linha com texto, sem a marcação de título e de ênfase. É o título
 * da saída em `primeira_linha` e o resumo do pedido — uma definição só, para o
 * bloco de Entrada da tela, a galeria e o histórico dizerem a mesma coisa.
 */
export function primeiraLinha(texto: string): string {
  const linha = texto.split("\n").find((l) => l.trim()) ?? "";
  return linha
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .trim();
}

/** A primeira linha do pedido, cortada em `MAX_RESUMO_DO_PEDIDO`. Vazia se não há. */
export function resumoDoPedido(pedido: string): string {
  const linha = primeiraLinha(pedido);
  return linha.length <= MAX_RESUMO_DO_PEDIDO
    ? linha
    : `${linha.slice(0, MAX_RESUMO_DO_PEDIDO - 1)}…`;
}

/* ---------------------------------------------------------------- entrada */

export const routineStepInputSchema = z.object({
  agentId: z.string().uuid("Escolha um agente"),
  mode: z.enum(ROUTINE_STEP_MODES),
  instruction: z.string().trim().max(MAX_INSTRUCAO_DO_PASSO).default(""),
});

/**
 * Os campos, sem as regras que cruzam campo. Separado porque `.partial()` não
 * existe depois de um `superRefine`: o schema de atualização deriva daqui, e
 * o servidor confere a rotina **mesclada** com `problemasDeForma`.
 */
const camposDaRotina = z.object({
  name: z.string().trim().min(1, "Dê um nome à rotina").max(MAX_NOME_ROTINA),
  description: z.string().trim().max(MAX_DESCRICAO_ROTINA).default(""),
  /// Padrão `coluna`: a forma de antes da emenda continua válida sem mudar.
  inputKind: z.enum(ROUTINE_INPUT_KINDS).default("coluna"),
  /// Só em `coluna`: a coluna de entrada e o quadro dela. O quadro vem
  /// declarado e é conferido pela cadeia: coluna de outro quadro é recusada,
  /// não corrigida.
  inputBoardId: z.string().uuid().nullable().default(null),
  inputColumnId: z.string().uuid().nullable().default(null),
  /// Só em `pedido`: a tarefa de cada execução.
  inputPrompt: z
    .string()
    .trim()
    .max(MAX_PEDIDO_DA_ROTINA, `O pedido passa de ${MAX_PEDIDO_DA_ROTINA} caracteres`)
    .nullable()
    .default(null),
  outputKind: z.enum(ROUTINE_OUTPUT_KINDS).default("card"),
  /// Só em `card`, de qualquer quadro: o card de saída nasce no fim dela.
  outputColumnId: z.string().uuid().nullable().default(null),
  /// Só em `nota`. Nulo é "sem workspace".
  outputWorkspaceId: z.string().uuid().nullable().default(null),
  outputTitle: z.enum(ROUTINE_OUTPUT_TITLES).default("ideia"),
  /// Só com `outputTitle: "fixo"`.
  outputTitleText: z
    .string()
    .trim()
    .max(MAX_TITULO_FIXO_DA_ROTINA, `O título passa de ${MAX_TITULO_FIXO_DA_ROTINA} caracteres`)
    .nullable()
    .default(null),
  /// Acrescenta ao card a seção "Observações", com o que os passos "revisa"
  /// apontaram.
  includeNotes: z.boolean().default(true),
  /// Só vale com entrada `coluna`. Padrão `manter` para que a rotina por
  /// pedido não precise mandá-la; nela o servidor grava `manter` sempre.
  consumeAction: z.enum(ROUTINE_CONSUME_ACTIONS).default("manter"),
  /// Só com `mover`, e do mesmo quadro da entrada: card não atravessa quadro
  /// (RN-04 da Fase 2). Com as outras ações o servidor grava `null`.
  consumeColumnId: z.string().uuid().nullable().default(null),
  runCapMicros: z
    .number()
    .int()
    .min(0)
    .max(TETO_POR_EXECUCAO_MAXIMO_MICROS, "Teto por execução acima do limite aceito")
    .default(TETO_POR_EXECUCAO_PADRAO_MICROS),
  /// Em ordem: é a ordem de execução.
  steps: z
    .array(routineStepInputSchema)
    .min(1, "A rotina precisa de pelo menos um passo")
    .max(MAX_PASSOS_DA_ROTINA, `No máximo ${MAX_PASSOS_DA_ROTINA} passos`),
});

/**
 * As regras que cruzam campo. Uma função, e não só o `superRefine`, porque o
 * servidor as aplica também à rotina **mesclada** num PATCH — que pode mudar a
 * ação de consumo sem mandar a coluna, ou tirar o último "reescreve" sem mandar
 * mais nada. Duas cópias da regra divergiriam.
 */
export function problemasDeForma(rotina: {
  inputKind: RoutineInputKind;
  inputBoardId: string | null;
  inputColumnId: string | null;
  inputPrompt: string | null;
  outputKind: RoutineOutputKind;
  outputColumnId: string | null;
  outputTitle: RoutineOutputTitle;
  outputTitleText: string | null;
  steps: readonly { mode: RoutineStepMode }[];
  consumeAction: RoutineConsumeAction;
  consumeColumnId: string | null;
}): { path: string; message: string }[] {
  const problemas: { path: string; message: string }[] = [];
  if (!rotina.steps.some((passo) => passo.mode === "reescreve")) {
    problemas.push({
      path: "steps",
      message: "Pelo menos um passo precisa reescrever — sem ele não há rascunho para a saída",
    });
  }

  if (rotina.inputKind === "coluna") {
    if (!rotina.inputBoardId || !rotina.inputColumnId) {
      problemas.push({
        path: "inputColumnId",
        message: "Escolha a coluna de onde as ideias saem",
      });
    }
  } else {
    if (!rotina.inputPrompt?.trim()) {
      problemas.push({
        path: "inputPrompt",
        message: "Escreva o pedido que cada execução vai cumprir",
      });
    }
    if (rotina.outputTitle === "ideia") {
      problemas.push({
        path: "outputTitle",
        message: "Sem coluna de ideias não há título de ideia: use a primeira linha ou um fixo",
      });
    }
    /// `arquivar` e `manter` são ignorados no pedido (o servidor grava
    /// `manter`); `mover` é recusado porque traz uma coluna que nada usaria.
    if (rotina.consumeAction === "mover") {
      problemas.push({
        path: "consumeAction",
        message: "Mover a ideia usada só vale quando a rotina parte de uma coluna",
      });
    }
  }

  if (rotina.outputKind === "card" && !rotina.outputColumnId) {
    problemas.push({
      path: "outputColumnId",
      message: "Escolha a coluna onde o card de saída nasce",
    });
  }
  if (rotina.outputTitle === "fixo" && !rotina.outputTitleText?.trim()) {
    problemas.push({
      path: "outputTitleText",
      message: "Escreva o título fixo da saída",
    });
  }

  if (rotina.inputKind === "coluna" && rotina.consumeAction === "mover") {
    if (!rotina.consumeColumnId) {
      problemas.push({
        path: "consumeColumnId",
        message: "Escolha para qual coluna a ideia usada vai",
      });
    } else if (rotina.consumeColumnId === rotina.inputColumnId) {
      problemas.push({
        path: "consumeColumnId",
        message: "A coluna das ideias usadas precisa ser outra que não a de entrada",
      });
    }
  }
  return problemas;
}

export const routineInputSchema = camposDaRotina.superRefine((rotina, ctx) => {
  for (const problema of problemasDeForma(rotina)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [problema.path],
      message: problema.message,
    });
  }
});

export const routineUpdateSchema = camposDaRotina
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

export const routineRunsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RoutineStepInput = z.input<typeof routineStepInputSchema>;
export type RoutineInput = z.input<typeof routineInputSchema>;
export type RoutineUpdateInput = z.input<typeof routineUpdateSchema>;
export type RoutineRunsQuery = z.infer<typeof routineRunsQuerySchema>;

/* ------------------------------------------------------------------ saída */

/** Uma coluna citada pela rotina, com os nomes resolvidos. `null` se sumiu. */
export interface RoutineColumnRef {
  columnId: string;
  columnName: string | null;
  boardId: string | null;
  boardName: string | null;
}

/** O passo como a miniatura do fluxo o desenha. */
export interface RoutineStepSummary {
  position: number;
  /// `null`: o agente foi excluído, e a rotina está inválida até trocar.
  agentId: string | null;
  agentName: string;
  agentColor: AgentColor | null;
  mode: RoutineStepMode;
}

export interface RoutineStep extends RoutineStepSummary {
  instruction: string;
  /// As ferramentas do agente, para o painel mostrar só para leitura. Na
  /// rotina valem só as de leitura (`FERRAMENTAS_DE_LEITURA`), e o painel diz
  /// isso.
  agentTools: NomeDeFerramenta[];
}

/** Um problema que impede a rotina de rodar, apontado no bloco que o tem. */
export interface RoutineProblem {
  block: "entrada" | "passo" | "saida";
  /// Só em `passo`: a posição, a partir de 0.
  position: number | null;
  message: string;
}

export interface RoutineRunSummary {
  id: string;
  routineId: string | null;
  routineName: string;
  status: RoutineRunStatus;
  /// O da rotina no início da execução: ela pode mudar de tipo depois.
  inputKind: RoutineInputKind;
  /// Só em `coluna`; nulo também quando a ideia foi excluída depois.
  inputCardId: string | null;
  /// O título da ideia, ou a primeira linha do pedido. Nulo se o pedido não
  /// tem linha com texto fora da marcação.
  inputTitle: string | null;
  /// No máximo um dos dois, conforme a saída da rotina; nulo também quando o
  /// card ou a nota foram excluídos depois.
  outputCardId: string | null;
  outputNoteId: string | null;
  costMicros: number;
  runCapMicros: number;
  /// Em `concluida` não é erro, é **aviso**: a saída (card ou nota) existe, e
  /// o que veio depois dela não terminou — `CONSUMO_FALHOU` (a ideia não foi
  /// movida nem arquivada) ou `FINALIZACAO_PARCIAL` (o registro da execução
  /// falhou ou foi fechado por outra instância). Execução que criou a saída
  /// termina `concluida`, sempre (RN-16).
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RoutineRunStep {
  position: number;
  agentName: string;
  mode: RoutineStepMode;
  instruction: string;
  modelId: string | null;
  modelUsed: string | null;
  status: RoutineRunStepStatus;
  /// A saída do passo: o rascunho em "reescreve", as observações em "revisa".
  text: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  durationMs: number;
  errorCode: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface RoutineRunDetail extends RoutineRunSummary {
  steps: RoutineRunStep[];
}

export interface RoutineRunPage {
  items: RoutineRunSummary[];
  nextCursor: string | null;
}

/** A entrada como a miniatura a desenha. */
export type RoutineInputRef =
  | ({ kind: "coluna" } & RoutineColumnRef)
  /// `resumo`: a primeira linha do pedido, cortada. O texto inteiro vem em
  /// `RoutineDetail.inputPrompt`.
  | { kind: "pedido"; resumo: string };

/** A saída como a miniatura a desenha. */
export type RoutineOutputRef =
  | ({ kind: "card" } & RoutineColumnRef)
  /// `workspaceId` nulo é "sem workspace". Com id e `workspaceName` nulo, o
  /// workspace foi excluído — e a rotina tem um problema na saída.
  | { kind: "nota"; workspaceId: string | null; workspaceName: string | null };

/** O que a galeria mostra: a miniatura do fluxo e a última execução. */
export interface RoutineSummary {
  id: string;
  name: string;
  description: string;
  input: RoutineInputRef;
  output: RoutineOutputRef;
  /// Na rotina por pedido é sempre `manter`, e `consume` é nulo.
  consumeAction: RoutineConsumeAction;
  consume: RoutineColumnRef | null;
  steps: RoutineStepSummary[];
  /// Sem problemas: pode rodar. O detalhe diz quais.
  valid: boolean;
  lastRun: RoutineRunSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineDetail extends Omit<RoutineSummary, "steps"> {
  /// O texto inteiro do pedido; nulo em `coluna`.
  inputPrompt: string | null;
  outputTitle: RoutineOutputTitle;
  /// Só com `outputTitle: "fixo"`.
  outputTitleText: string | null;
  includeNotes: boolean;
  runCapMicros: number;
  steps: RoutineStep[];
  problems: RoutineProblem[];
  /// Cards que o próximo "Rodar agora" poderia pegar, e o primeiro deles.
  /// Nulos na rotina por pedido, que não escolhe ideia.
  eligibleCount: number | null;
  nextIdea: { id: string; title: string } | null;
}

/** `POST /ai/routines/:id/runs` — 202. */
export interface RoutineRunStarted {
  runId: string;
}

/**
 * O que trafega no SSE de `GET /ai/runs/:runId/events`.
 *
 * Primeiro, sempre, o `retrato`: o que está gravado, mais o texto parcial do
 * passo em curso — é o que deixa a tela fechar e voltar no meio. Execução já
 * terminada manda `retrato` e `fim`, e fecha. `position` é a do passo, a
 * partir de 0.
 *
 * **O `retrato` pode se repetir.** Numa janela de deploy duas instâncias da
 * API convivem, e o SSE pode cair na que não executa: ali não há `delta`,
 * `passo-inicio` nem `ferramenta` — só o `retrato` lido do banco a cada ~2 s
 * quando muda, com `parcial: null`, e o `fim` quando ela termina. Quem lê
 * trata cada `retrato` como o estado inteiro, não como soma.
 */
export type RotinaEvent =
  | { tipo: "retrato"; run: RoutineRunDetail; parcial: string | null }
  | { tipo: "passo-inicio"; position: number; agentName: string; modelId: string }
  /// Um pedaço do texto do passo em curso. Chega em ordem; concatenar basta.
  | { tipo: "delta"; position: number; texto: string }
  /// O passo pediu uma leitura do acervo e ela está rodando.
  | { tipo: "ferramenta"; position: number; nome: string }
  /// O passo terminou (bem ou mal) e já está gravado.
  | { tipo: "passo-fim"; step: RoutineRunStep; runCostMicros: number }
  /// A execução terminou, em qualquer status. É o último evento.
  | { tipo: "fim"; run: RoutineRunSummary }
  /// Por que a execução parou. Vem antes do `fim`, com o `code` estável.
  | { tipo: "erro"; code: string; mensagem: string };

/* ----------------------------------------------------------------- modelo */

/**
 * Um modelo pronto de rotina. Não aponta para agente, coluna nem workspace
 * nenhum: os agentes são pela `chave` de `MODELOS_DE_AGENTE`, e as colunas por
 * nome sugerido. A tela resolve os ids — casa o agente criado a partir daquele
 * modelo, oferece criá-lo se faltar, e pede as colunas.
 *
 * União pelos dois eixos da emenda da Etapa E, para que a tela não tenha
 * coluna de entrada a procurar num modelo por pedido nem coluna de saída num
 * que sai em nota.
 */
export type ModeloDeRotina = {
  chave: string;
  name: string;
  description: string;
  outputTitle: RoutineOutputTitle;
  outputTitleText: string | null;
  includeNotes: boolean;
  runCapMicros: number;
  steps: { agente: string; mode: RoutineStepMode; instruction: string }[];
} & (
  | {
      inputKind: "coluna";
      colunaDeEntrada: string;
      inputPrompt: null;
      consumeAction: RoutineConsumeAction;
      colunaDeConsumidas: string | null;
    }
  | {
      inputKind: "pedido";
      colunaDeEntrada: null;
      inputPrompt: string;
      consumeAction: "manter";
      colunaDeConsumidas: null;
    }
) &
  ({ outputKind: "card"; colunaDeSaida: string } | { outputKind: "nota"; colunaDeSaida: null });

const POST_DO_LINKEDIN = {
  chave: "post-linkedin",
  name: "Post do LinkedIn",
  description: "Pega a próxima ideia, escreve, ajusta para o público e revisa.",
  inputKind: "coluna",
  colunaDeEntrada: "Ideias",
  inputPrompt: null,
  outputKind: "card",
  colunaDeSaida: "Aguardando publicar",
  colunaDeConsumidas: "Usadas",
  outputTitle: "ideia",
  outputTitleText: null,
  includeNotes: true,
  consumeAction: "mover",
  runCapMicros: TETO_POR_EXECUCAO_PADRAO_MICROS,
  steps: [
    {
      agente: "linkedin",
      mode: "reescreve",
      instruction: [
        "Escreva o primeiro rascunho de um post do LinkedIn a partir da ideia.",
        "- Siga o guia e o tom dos exemplos das suas premissas.",
        "- Se a ideia já aparece nas fontes vivas, escolha um ângulo que ainda não saiu.",
        "- Use o acervo quando a ideia citar algo que você não conhece — busque antes de supor.",
        "- Entregue só o post, pronto para colar: sem título, sem comentário antes ou depois.",
      ].join("\n"),
    },
    {
      agente: "marketing",
      mode: "reescreve",
      instruction: [
        "Ajuste o rascunho ao público e ao posicionamento das suas premissas.",
        "- Gancho mais concreto nas duas primeiras linhas.",
        "- Os termos que o público usa, no lugar dos genéricos.",
        "- Fechamento com uma pergunta ou uma chamada prática.",
        "- Preserve a voz e o tamanho do autor. Não acrescente dado, número nem promessa que o " +
          "rascunho não tenha.",
        "- Entregue o post inteiro ajustado, e só ele.",
      ].join("\n"),
    },
    {
      agente: "revisor",
      mode: "revisa",
      instruction: [
        "Revise o rascunho sem reescrevê-lo.",
        "- Aponte em lista, um item por problema: o trecho, o problema e a sugestão.",
        "- Olhe correção, clareza, repetição e afirmação sem apoio no acervo.",
        "- Se o post estiver bom, diga isso em uma linha. Não fabrique problema.",
      ].join("\n"),
    },
  ],
} satisfies ModeloDeRotina;

/**
 * O estado vazio que ensina a rotina por pedido: um passo só, saída em nota.
 *
 * **O agente é o `marketing`, por ser o mais genérico dos três modelos de
 * agente:** o `linkedin` impõe forma de post e o `revisor` é instruído a não
 * reescrever — os dois brigariam com um pedido qualquer num passo "reescreve".
 * O `marketing` só exige coerência com as premissas, e é o único com
 * `get_dashboard`, que o pedido de exemplo usa. A tela deixa trocar.
 */
const PEDIDO_DIRETO = {
  chave: "pedido-direto",
  name: "Pedido direto",
  description: "Um pedido seu, cumprido por um agente, que vira nota nova a cada execução.",
  inputKind: "pedido",
  colunaDeEntrada: null,
  inputPrompt:
    "Monte um resumo da minha semana a partir do painel e dos quadros: o que está atrasado, " +
    "o que andou e o que merece atenção nos próximos dias.",
  outputKind: "nota",
  colunaDeSaida: null,
  colunaDeConsumidas: null,
  outputTitle: "primeira_linha",
  outputTitleText: null,
  includeNotes: false,
  consumeAction: "manter",
  runCapMicros: TETO_POR_EXECUCAO_PADRAO_MICROS,
  steps: [
    {
      agente: "marketing",
      mode: "reescreve",
      instruction: [
        "Cumpra o pedido.",
        "- Busque no acervo antes de supor; diga de que nota ou card veio cada afirmação.",
        "- Comece por uma linha curta que sirva de título: ela vira o título da nota.",
        "- Entregue só o resultado, pronto para guardar: sem comentário antes ou depois.",
      ].join("\n"),
    },
  ],
} satisfies ModeloDeRotina;

export const MODELOS_DE_ROTINA: readonly ModeloDeRotina[] = [POST_DO_LINKEDIN, PEDIDO_DIRETO];
