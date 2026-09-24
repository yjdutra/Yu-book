import { z } from "zod";
import type { AgentColor } from "./agentes.js";
import type { NomeDeFerramenta } from "./ferramentas.js";

/**
 * Rotinas — Etapa E da frente de IA (`docs/prd-ia-no-yu-book.md`).
 *
 * Uma rotina encadeia agentes numa sequência fixa, disparada à mão: pega a
 * próxima ideia de uma coluna, passa por cada agente e grava o resultado como
 * card numa coluna de saída. Quatro regras que a forma daqui não mostra e o
 * servidor garante:
 *
 * - **A rotina só escreve pelo código, na saída.** Os passos recebem apenas as
 *   ferramentas de **leitura** do agente; o card de saída e o destino da ideia
 *   são do código, no fim de uma execução bem-sucedida. Texto de instrução não
 *   concede ferramenta (RN-14).
 * - **Dois tetos cortam.** O diário, de sempre, e o por execução
 *   (`runCapMicros`), conferidos antes de **cada** chamada ao provedor.
 * - **Uma execução ativa por conta**, e a ideia é escolhida pelo registro: o
 *   primeiro card ativo da entrada sem execução `concluida` nem `em_andamento`
 *   desta rotina. Falhou ou foi cancelada, a mesma ideia volta na próxima.
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

/// Espelha `AiOutputTitle`: o título do card de saída é o da ideia, ou a
/// primeira linha do rascunho final.
export const ROUTINE_OUTPUT_TITLES = ["ideia", "primeira_linha"] as const;
export type RoutineOutputTitle = (typeof ROUTINE_OUTPUT_TITLES)[number];

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
  /// A coluna de entrada e o quadro dela. O quadro vem declarado e é conferido
  /// pela cadeia: coluna de outro quadro é recusada, não corrigida.
  inputBoardId: z.string().uuid(),
  inputColumnId: z.string().uuid(),
  /// De qualquer quadro: o card de saída nasce no fim dela.
  outputColumnId: z.string().uuid(),
  outputTitle: z.enum(ROUTINE_OUTPUT_TITLES).default("ideia"),
  /// Acrescenta ao card a seção "Observações", com o que os passos "revisa"
  /// apontaram.
  includeNotes: z.boolean().default(true),
  consumeAction: z.enum(ROUTINE_CONSUME_ACTIONS),
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
  steps: readonly { mode: RoutineStepMode }[];
  consumeAction: RoutineConsumeAction;
  consumeColumnId: string | null;
  inputColumnId: string;
}): { path: string; message: string }[] {
  const problemas: { path: string; message: string }[] = [];
  if (!rotina.steps.some((passo) => passo.mode === "reescreve")) {
    problemas.push({
      path: "steps",
      message: "Pelo menos um passo precisa reescrever — sem ele não há rascunho para o card",
    });
  }
  if (rotina.consumeAction === "mover") {
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
  inputCardId: string | null;
  inputTitle: string;
  outputCardId: string | null;
  costMicros: number;
  runCapMicros: number;
  /// Em `concluida` não é erro, é **aviso**: o card de saída existe, e o que
  /// veio depois dele não terminou — `CONSUMO_FALHOU` (a ideia não foi movida
  /// nem arquivada) ou `FINALIZACAO_PARCIAL` (o registro da execução falhou ou
  /// foi fechado por outra instância). Execução que criou o card termina
  /// `concluida`, sempre (RN-16).
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

/** O que a galeria mostra: a miniatura do fluxo e a última execução. */
export interface RoutineSummary {
  id: string;
  name: string;
  description: string;
  input: RoutineColumnRef;
  output: RoutineColumnRef;
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
  outputTitle: RoutineOutputTitle;
  includeNotes: boolean;
  runCapMicros: number;
  steps: RoutineStep[];
  problems: RoutineProblem[];
  /// Cards que o próximo "Rodar agora" poderia pegar, e o primeiro deles.
  eligibleCount: number;
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
 * Um modelo pronto de rotina. Não aponta para agente nem coluna nenhuma: os
 * agentes são pela `chave` de `MODELOS_DE_AGENTE`, e as colunas por nome
 * sugerido. A tela resolve os ids — casa o agente criado a partir daquele
 * modelo, oferece criá-lo se faltar, e pede as colunas.
 */
export interface ModeloDeRotina {
  chave: string;
  name: string;
  description: string;
  colunaDeEntrada: string;
  colunaDeSaida: string;
  colunaDeConsumidas: string | null;
  outputTitle: RoutineOutputTitle;
  includeNotes: boolean;
  consumeAction: RoutineConsumeAction;
  runCapMicros: number;
  steps: { agente: string; mode: RoutineStepMode; instruction: string }[];
}

export const MODELO_DE_ROTINA: ModeloDeRotina = {
  chave: "post-linkedin",
  name: "Post do LinkedIn",
  description: "Pega a próxima ideia, escreve, ajusta para o público e revisa.",
  colunaDeEntrada: "Ideias",
  colunaDeSaida: "Aguardando publicar",
  colunaDeConsumidas: "Usadas",
  outputTitle: "ideia",
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
};
