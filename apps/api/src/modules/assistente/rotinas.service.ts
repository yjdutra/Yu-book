import { Prisma } from "@prisma/client";
import {
  DEFINICOES_DO_ASSISTENTE,
  FERRAMENTAS_DO_CHAT,
  FUSO_PADRAO,
  PROXIMOS_HORARIOS,
  problemasDaAgenda,
  problemasDeForma,
  proximosHorarios,
  resumoDoPedido,
} from "@yu-book/shared";
import type {
  ChatSource,
  NomeDoAssistente,
  RoutineSchedule,
  RoutineColumnRef,
  RoutineConsumeAction,
  RoutineInputKind,
  RoutineInputRef,
  RoutineOutputKind,
  RoutineOutputRef,
  RoutineOutputTitle,
  RoutineDetail,
  RoutineProblem,
  RoutineRunDetail,
  RoutineRunPage,
  RoutineRunStep,
  RoutineRunSummary,
  RoutineRunsQuery,
  RoutineStep,
  RoutineSummary,
  routineInputSchema,
  routineUpdateSchema,
} from "@yu-book/shared";
import type { z } from "zod";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";

/**
 * Rotinas — Etapa E da frente de IA: o cadastro e a validação. O motor mora
 * em `execucao.service.ts`.
 *
 * Posse (INV-02, INV-59, RN-15): rotina, agente, coluna e workspace de outra
 * conta dão o mesmo 404 de um id inexistente. As colunas **não** são chave
 * estrangeira — `board_column` não tem `user_id` (INV-03) —, então a posse é
 * conferida pela cadeia coluna → quadro → usuário ao gravar, e de novo ao ler
 * e ao rodar. O workspace da nota de saída também não é chave estrangeira, e
 * pelo mesmo motivo que a coluna: o que some vira problema, não desvio calado.
 *
 * **Dois eixos de tipo** (emenda da Etapa E): a entrada é `coluna` ou `pedido`,
 * a saída é `card` ou `nota`. Cada conferência roda só no tipo que usa o campo,
 * e o que o tipo não usa é gravado nulo (`paraGravar`).
 *
 * **Rotina inválida não some nem vira erro de leitura.** Agente excluído,
 * coluna excluída ou modelo que saiu dos favoritos viram `problems`, apontados
 * no bloco que os tem; o detalhe abre normalmente, para o editor consertar, e
 * só o início da execução recusa (422 `ROTINA_INVALIDA`).
 */

type EntradaDaRotina = z.output<typeof routineInputSchema>;
type PatchDaRotina = z.output<typeof routineUpdateSchema>;

const invalida = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);

/**
 * As ferramentas que um passo de rotina oferece ao modelo: as do agente, só as
 * de **leitura**, e só dentro de `FERRAMENTAS_DO_CHAT`. A escrita da rotina é
 * do código, na saída — texto de instrução não concede ferramenta (RN-14), e
 * aqui nem a lista do agente concede escrita. `open_page` é de leitura e
 * passa (Etapa G): um passo que o agente liga à web lê páginas.
 *
 * **"Só leitura" não quer dizer "sem saída".** Um passo com `open_page` e as
 * leituras do acervo junta dado privado, página não confiável e rede: a
 * página pode mandar abrir um endereço com o que ele leu na query string, e a
 * cerca "é dado, não instrução" é forjável (risco descrito no cabeçalho de
 * `web/pagina.service.ts`). E a busca na web do agente parte do texto do
 * passo — a ideia ou o rascunho —, que vai ao motor de busca de terceiro. A
 * mitigação é o opt-in por agente e o aviso na tela, não garantia.
 */
export function ferramentasDaRotina(tools: readonly string[]): NomeDoAssistente[] {
  return FERRAMENTAS_DO_CHAT.filter(
    (nome) => tools.includes(nome) && !DEFINICOES_DO_ASSISTENTE[nome].escrita,
  );
}

function ferramentasDoAgente(tools: readonly string[]): NomeDoAssistente[] {
  return FERRAMENTAS_DO_CHAT.filter((nome) => tools.includes(nome));
}

/* ------------------------------------------------------------- execuções */

export const CAMPOS_DO_RUN = {
  id: true,
  routineId: true,
  routineName: true,
  status: true,
  inputKind: true,
  inputCardId: true,
  inputTitle: true,
  outputCardId: true,
  outputNoteId: true,
  costMicros: true,
  runCapMicros: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  endedAt: true,
  trigger: true,
  scheduledFor: true,
  attempts: true,
} satisfies Prisma.AiRoutineRunSelect;

type RunNoBanco = Prisma.AiRoutineRunGetPayload<{ select: typeof CAMPOS_DO_RUN }>;

export function paraRun(linha: RunNoBanco): RoutineRunSummary {
  return {
    id: linha.id,
    routineId: linha.routineId,
    routineName: linha.routineName,
    status: linha.status,
    inputKind: linha.inputKind,
    inputCardId: linha.inputCardId,
    inputTitle: linha.inputTitle,
    outputCardId: linha.outputCardId,
    outputNoteId: linha.outputNoteId,
    costMicros: linha.costMicros,
    runCapMicros: linha.runCapMicros,
    errorCode: linha.errorCode,
    errorMessage: linha.errorMessage,
    startedAt: linha.startedAt.toISOString(),
    endedAt: linha.endedAt?.toISOString() ?? null,
    trigger: linha.trigger,
    scheduledFor: linha.scheduledFor?.toISOString() ?? null,
    attempts: linha.attempts,
  };
}

export const CAMPOS_DO_PASSO_EXECUTADO = {
  position: true,
  agentName: true,
  mode: true,
  instruction: true,
  modelId: true,
  modelUsed: true,
  status: true,
  text: true,
  promptTokens: true,
  completionTokens: true,
  costMicros: true,
  durationMs: true,
  errorCode: true,
  startedAt: true,
  endedAt: true,
  sources: true,
} satisfies Prisma.AiRoutineRunStepSelect;

type PassoExecutadoNoBanco = Prisma.AiRoutineRunStepGetPayload<{
  select: typeof CAMPOS_DO_PASSO_EXECUTADO;
}>;

/**
 * As fontes gravadas de um passo, relidas com a forma conferida item a item.
 * A coluna é JSON escrito só pelo motor, mas um item fora da forma — de uma
 * versão futura, ou escrito à mão — sai da lista em vez de derrubar a leitura
 * da execução. Na web, só `http`/`https`: a tela o transforma em link.
 */
export function fontesDoPasso(valor: Prisma.JsonValue | null): ChatSource[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((item): ChatSource[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { kind, id, url, title } = item as Record<string, unknown>;
    if (typeof title !== "string") return [];
    if (kind === "web") {
      return typeof url === "string" && /^https?:\/\//i.test(url) ? [{ kind, url, title }] : [];
    }
    if ((kind === "note" || kind === "card" || kind === "board") && typeof id === "string") {
      return [{ kind, id, title }];
    }
    return [];
  });
}

export function paraPassoExecutado(linha: PassoExecutadoNoBanco): RoutineRunStep {
  return {
    ...linha,
    startedAt: linha.startedAt?.toISOString() ?? null,
    endedAt: linha.endedAt?.toISOString() ?? null,
    sources: fontesDoPasso(linha.sources),
  };
}

/** O detalhe de uma execução, escopado. 404 para a alheia (INV-02). */
export async function detalheDoRun(userId: string, runId: string): Promise<RoutineRunDetail> {
  const linha = await prisma.aiRoutineRun.findFirst({
    where: { id: runId, userId },
    select: {
      ...CAMPOS_DO_RUN,
      steps: { orderBy: { position: "asc" }, select: CAMPOS_DO_PASSO_EXECUTADO },
    },
  });
  if (!linha) throw notFound("Execução não encontrada");
  const { steps, ...run } = linha;
  return { ...paraRun(run), steps: steps.map(paraPassoExecutado) };
}

/** O histórico de uma rotina, do mais recente, pelo cursor de `notes.service`. */
export async function historico(
  userId: string,
  routineId: string,
  query: RoutineRunsQuery,
): Promise<RoutineRunPage> {
  const rotina = await prisma.aiRoutine.findFirst({
    where: { id: routineId, userId },
    select: { id: true },
  });
  if (!rotina) throw notFound("Rotina não encontrada");

  const linhas = await prisma.aiRoutineRun.findMany({
    where: { routineId, userId },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: CAMPOS_DO_RUN,
    take: query.limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const temMais = linhas.length > query.limit;
  const items = (temMais ? linhas.slice(0, query.limit) : linhas).map(paraRun);
  return { items, nextCursor: temMais ? (items.at(-1)?.id ?? null) : null };
}

/* ---------------------------------------------------------------- leitura */

const CAMPOS_DA_ROTINA = {
  id: true,
  name: true,
  description: true,
  inputKind: true,
  inputBoardId: true,
  inputColumnId: true,
  inputPrompt: true,
  outputKind: true,
  outputColumnId: true,
  outputWorkspaceId: true,
  outputTitle: true,
  outputTitleText: true,
  includeNotes: true,
  consumeAction: true,
  consumeColumnId: true,
  runCapMicros: true,
  scheduleDays: true,
  scheduleTimes: true,
  scheduleActive: true,
  createdAt: true,
  updatedAt: true,
  steps: {
    orderBy: { position: "asc" },
    select: {
      position: true,
      agentId: true,
      agentName: true,
      mode: true,
      instruction: true,
      agent: {
        select: { name: true, color: true, tools: true, webSearch: true, modelId: true },
      },
    },
  },
  runs: { orderBy: { startedAt: "desc" }, take: 1, select: CAMPOS_DO_RUN },
} satisfies Prisma.AiRoutineSelect;

export type RotinaNoBanco = Prisma.AiRoutineGetPayload<{ select: typeof CAMPOS_DA_ROTINA }>;

interface ColunaResolvida {
  name: string;
  boardId: string;
  boardName: string;
}

/**
 * O que a validação precisa além da rotina: as colunas resolvidas pela cadeia,
 * os workspaces, os favoritos e o modelo do chat. Montado uma vez para a lista
 * inteira.
 */
interface Ambiente {
  colunas: Map<string, ColunaResolvida>;
  workspaces: Map<string, string>;
  favoritos: Map<string, { name: string; supportsTools: boolean }>;
  modeloDoChat: string | null;
  /// O fuso do dono, para os próximos horários da agenda (Etapa F).
  fuso: string;
}

async function ambienteDe(userId: string, rotinas: RotinaNoBanco[]): Promise<Ambiente> {
  const ids = new Set<string>();
  const idsDeWorkspace = new Set<string>();
  for (const r of rotinas) {
    /// Só o que o tipo usa: o resto está gravado nulo.
    if (r.inputColumnId) ids.add(r.inputColumnId);
    if (r.outputColumnId) ids.add(r.outputColumnId);
    if (r.consumeColumnId) ids.add(r.consumeColumnId);
    if (r.outputWorkspaceId) idsDeWorkspace.add(r.outputWorkspaceId);
  }
  const [colunas, workspaces, favoritos, chat, preferencia] = await Promise.all([
    /// INV-03: a coluna só resolve se o quadro for do usuário.
    prisma.boardColumn.findMany({
      where: { id: { in: [...ids] }, board: { userId } },
      select: { id: true, name: true, boardId: true, board: { select: { name: true } } },
    }),
    idsDeWorkspace.size
      ? prisma.workspace.findMany({
          where: { id: { in: [...idsDeWorkspace] }, userId },
          select: { id: true, name: true },
        })
      : [],
    prisma.aiModelFavorite.findMany({
      where: { userId },
      select: { modelId: true, name: true, supportsTools: true },
    }),
    prisma.aiTaskModel.findUnique({ where: { userId_task: { userId, task: "chat" } } }),
    prisma.aiPreference.findUnique({ where: { userId }, select: { timezone: true } }),
  ]);
  return {
    colunas: new Map(
      colunas.map((c) => [c.id, { name: c.name, boardId: c.boardId, boardName: c.board.name }]),
    ),
    workspaces: new Map(workspaces.map((w) => [w.id, w.name])),
    favoritos: new Map(
      favoritos.map((f) => [f.modelId, { name: f.name, supportsTools: f.supportsTools }]),
    ),
    modeloDoChat: chat?.modelId ?? null,
    /// Sem linha de preferência vale o padrão de `packages/shared`, como em
    /// `preferenciaDe` — é o fuso que o teto diário também usa.
    fuso: preferencia?.timezone ?? FUSO_PADRAO,
  };
}

function refDaColuna(ambiente: Ambiente, columnId: string): RoutineColumnRef {
  const coluna = ambiente.colunas.get(columnId);
  return {
    columnId,
    columnName: coluna?.name ?? null,
    boardId: coluna?.boardId ?? null,
    boardName: coluna?.boardName ?? null,
  };
}

/**
 * Por que a rotina não pode rodar, bloco a bloco. Vazio é válida.
 *
 * Confere o que o início da execução também conferiria, na mesma ordem, para
 * a tela mostrar antes de alguém clicar: colunas pela cadeia, agente de cada
 * passo, e o modelo que cada passo usaria. O modelo é conferido com a mesma
 * régua de `modeloPorId` — favorito, e com ferramenta quando o passo lê o
 * acervo —, mas sem lançar.
 */
export function problemasDe(rotina: RotinaNoBanco, ambiente: Ambiente): RoutineProblem[] {
  const problemas: RoutineProblem[] = [];

  if (rotina.inputKind === "coluna") {
    const entrada = rotina.inputColumnId ? ambiente.colunas.get(rotina.inputColumnId) : undefined;
    if (!entrada || entrada.boardId !== rotina.inputBoardId) {
      problemas.push({
        block: "entrada",
        position: null,
        message: "A coluna de entrada não existe mais. Escolha outra.",
      });
    }
  } else if (!rotina.inputPrompt?.trim()) {
    /// O schema já recusa; isto cobre a linha gravada fora dele.
    problemas.push({
      block: "entrada",
      position: null,
      message: "O pedido está vazio. Escreva o que cada execução deve fazer.",
    });
  }

  rotina.steps.forEach((passo, indice) => {
    if (!passo.agent) {
      problemas.push({
        block: "passo",
        position: indice,
        message: `O agente «${passo.agentName}» foi excluído. Escolha outro para este passo.`,
      });
      return;
    }
    const nome = passo.agent.name;
    const modelId = passo.agent.modelId ?? ambiente.modeloDoChat;
    if (!modelId) {
      problemas.push({
        block: "passo",
        position: indice,
        message:
          `«${nome}» usa o modelo do chat, e não há modelo escolhido para o chat. ` +
          "Escolha um em Ajustes → Modelos.",
      });
      return;
    }
    const favorito = ambiente.favoritos.get(modelId);
    if (!favorito) {
      problemas.push({
        block: "passo",
        position: indice,
        message: `O modelo de «${nome}» (${modelId}) saiu dos favoritos. Troque no agente.`,
      });
      return;
    }
    if (ferramentasDaRotina(passo.agent.tools).length > 0 && !favorito.supportsTools) {
      problemas.push({
        block: "passo",
        position: indice,
        message:
          `"${favorito.name}" não sabe chamar ferramenta, e «${nome}» lê o acervo. Troque o ` +
          "modelo ou tire as ferramentas no editor do agente.",
      });
    }
  });

  if (rotina.outputKind === "card") {
    if (!rotina.outputColumnId || !ambiente.colunas.has(rotina.outputColumnId)) {
      problemas.push({
        block: "saida",
        position: null,
        message: "A coluna de saída não existe mais. Escolha outra.",
      });
    }
  } else if (rotina.outputWorkspaceId && !ambiente.workspaces.has(rotina.outputWorkspaceId)) {
    problemas.push({
      block: "saida",
      position: null,
      message: "O workspace da nota não existe mais. Escolha outro, ou deixe sem workspace.",
    });
  }
  if (rotina.inputKind === "coluna" && rotina.consumeAction === "mover") {
    const consumidas = rotina.consumeColumnId
      ? ambiente.colunas.get(rotina.consumeColumnId)
      : undefined;
    if (!consumidas) {
      problemas.push({
        block: "saida",
        position: null,
        message: "A coluna das ideias usadas não existe mais. Escolha outra.",
      });
    } else if (consumidas.boardId !== rotina.inputBoardId) {
      problemas.push({
        block: "saida",
        position: null,
        message: "A coluna das ideias usadas precisa ser do quadro da entrada.",
      });
    }
  }

  return problemas;
}

function refDaEntrada(rotina: RotinaNoBanco, ambiente: Ambiente): RoutineInputRef {
  return rotina.inputKind === "pedido"
    ? { kind: "pedido", resumo: resumoDoPedido(rotina.inputPrompt ?? "") }
    : { kind: "coluna", ...refDaColuna(ambiente, rotina.inputColumnId ?? "") };
}

function refDaSaida(rotina: RotinaNoBanco, ambiente: Ambiente): RoutineOutputRef {
  return rotina.outputKind === "nota"
    ? {
        kind: "nota",
        workspaceId: rotina.outputWorkspaceId,
        workspaceName: rotina.outputWorkspaceId
          ? (ambiente.workspaces.get(rotina.outputWorkspaceId) ?? null)
          : null,
      }
    : { kind: "card", ...refDaColuna(ambiente, rotina.outputColumnId ?? "") };
}

export function agendaDe(rotina: {
  scheduleDays: number[];
  scheduleTimes: string[];
  scheduleActive: boolean;
}): RoutineSchedule {
  return { days: rotina.scheduleDays, times: rotina.scheduleTimes, active: rotina.scheduleActive };
}

function paraResumo(rotina: RotinaNoBanco, ambiente: Ambiente): RoutineSummary {
  const ultima = rotina.runs[0];
  const problemas = problemasDe(rotina, ambiente);
  const agenda = agendaDe(rotina);
  return {
    id: rotina.id,
    name: rotina.name,
    description: rotina.description,
    input: refDaEntrada(rotina, ambiente),
    output: refDaSaida(rotina, ambiente),
    consumeAction: rotina.consumeAction,
    consume:
      rotina.inputKind === "coluna" && rotina.consumeAction === "mover" && rotina.consumeColumnId
        ? refDaColuna(ambiente, rotina.consumeColumnId)
        : null,
    steps: rotina.steps.map((passo) => ({
      position: passo.position,
      agentId: passo.agentId,
      /// O nome atual do agente, se ele existe; o gravado, se foi excluído.
      agentName: passo.agent?.name ?? passo.agentName,
      agentColor: passo.agent?.color ?? null,
      mode: passo.mode,
    })),
    valid: problemas.length === 0,
    lastRun: ultima ? paraRun(ultima) : null,
    schedule: agenda,
    /// Inválida não mostra próximos: não vai rodar enquanto houver problema.
    /// O agendador continua olhando para ela e registra cada horário como
    /// `pulada` com o motivo — nada falha calado.
    nextRuns:
      agenda.active && problemas.length === 0
        ? proximosHorarios(agenda, ambiente.fuso, new Date(), PROXIMOS_HORARIOS).map((t) =>
            t.toISOString(),
          )
        : [],
    createdAt: rotina.createdAt.toISOString(),
    updatedAt: rotina.updatedAt.toISOString(),
  };
}

export async function listar(userId: string): Promise<RoutineSummary[]> {
  const rotinas = await prisma.aiRoutine.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    select: CAMPOS_DA_ROTINA,
  });
  const ambiente = await ambienteDe(userId, rotinas);
  return rotinas.map((r) => paraResumo(r, ambiente));
}

export async function linhaDaRotina(userId: string, id: string): Promise<RotinaNoBanco> {
  const linha = await prisma.aiRoutine.findFirst({
    where: { id, userId },
    select: CAMPOS_DA_ROTINA,
  });
  if (!linha) throw notFound("Rotina não encontrada");
  return linha;
}

interface EntradaPorColuna {
  id: string;
  inputBoardId: string;
  inputColumnId: string;
}

/**
 * A entrada da rotina, se ela parte de uma coluna. `null` na rotina por pedido
 * — ali não há ideia a escolher, nem `eligibleCount`, nem `SEM_IDEIA`.
 */
export function entradaPorColuna(rotina: {
  id: string;
  inputKind: RoutineInputKind;
  inputBoardId: string | null;
  inputColumnId: string | null;
}): EntradaPorColuna | null {
  if (rotina.inputKind !== "coluna" || !rotina.inputBoardId || !rotina.inputColumnId) return null;
  return { id: rotina.id, inputBoardId: rotina.inputBoardId, inputColumnId: rotina.inputColumnId };
}

/**
 * Os cards que o próximo "Rodar agora" pode pegar, na ordem da coluna.
 *
 * **Idempotência pelo registro, não pela posição.** Elegível é o card ativo e
 * não concluído da entrada que não tem execução `concluida` nem `em_andamento`
 * **desta** rotina. Com a ação "manter", a ideia usada continua na coluna e é pulada; a
 * que falhou ou foi cancelada volta a ser a primeira. A posse vai na mesma
 * consulta, pela cadeia até o quadro declarado (INV-03).
 */
export function ondeElegivel(userId: string, rotina: EntradaPorColuna): Prisma.CardWhereInput {
  return {
    columnId: rotina.inputColumnId,
    archived: false,
    // Frente de cards, Parte 1: ideia concluída já foi resolvida, e fica na
    // coluna só porque concluir não move o card.
    completedAt: null,
    column: { boardId: rotina.inputBoardId, board: { userId } },
    runsComoIdeia: {
      none: { routineId: rotina.id, status: { in: ["concluida", "em_andamento"] } },
    },
  };
}

export async function buscarPorId(userId: string, id: string): Promise<RoutineDetail> {
  const rotina = await linhaDaRotina(userId, id);
  const porColuna = entradaPorColuna(rotina);
  const onde = porColuna ? ondeElegivel(userId, porColuna) : null;
  const [ambiente, eligibleCount, proxima] = await Promise.all([
    ambienteDe(userId, [rotina]),
    onde ? prisma.card.count({ where: onde }) : null,
    onde
      ? prisma.card.findFirst({
          where: onde,
          orderBy: { position: "asc" },
          select: { id: true, title: true },
        })
      : null,
  ]);

  const resumo = paraResumo(rotina, ambiente);
  const steps: RoutineStep[] = rotina.steps.map((passo, indice) => ({
    ...(resumo.steps[indice] as RoutineSummary["steps"][number]),
    instruction: passo.instruction,
    agentTools: passo.agent ? ferramentasDoAgente(passo.agent.tools) : [],
    agentWebSearch: passo.agent?.webSearch ?? false,
  }));

  return {
    ...resumo,
    inputPrompt: rotina.inputPrompt,
    outputTitle: rotina.outputTitle,
    outputTitleText: rotina.outputTitleText,
    includeNotes: rotina.includeNotes,
    runCapMicros: rotina.runCapMicros,
    steps,
    problems: problemasDe(rotina, ambiente),
    eligibleCount,
    nextIdea: proxima,
  };
}

/**
 * Os problemas de uma rotina já carregada — o que o motor confere antes de
 * criar a execução.
 */
export async function problemasDaRotina(
  userId: string,
  rotina: RotinaNoBanco,
): Promise<RoutineProblem[]> {
  return problemasDe(rotina, await ambienteDe(userId, [rotina]));
}

/* ------------------------------------------------------------------ posse */

/**
 * Os campos que dependem do tipo, como vão ao banco: o que o tipo não usa é
 * nulo, e a rotina por pedido grava `manter`. Mesma regra de `consumeColumnId`
 * antes da emenda — sair de `mover` zera a coluna —, estendida aos dois eixos:
 * trocar de tipo não deixa referência velha gravada, que um `problems` ou uma
 * conferência de posse iriam cobrar depois.
 */
interface Forma {
  inputKind: RoutineInputKind;
  inputBoardId: string | null;
  inputColumnId: string | null;
  inputPrompt: string | null;
  outputKind: RoutineOutputKind;
  outputColumnId: string | null;
  outputWorkspaceId: string | null;
  outputTitle: RoutineOutputTitle;
  outputTitleText: string | null;
  consumeAction: RoutineConsumeAction;
  consumeColumnId: string | null;
}

/** Só depois de `problemasDeForma`: aqui `mover` num pedido viraria `manter` calado. */
function paraGravar(f: Forma): Forma {
  const coluna = f.inputKind === "coluna";
  const consumeAction = coluna ? f.consumeAction : "manter";
  return {
    inputKind: f.inputKind,
    inputBoardId: coluna ? f.inputBoardId : null,
    inputColumnId: coluna ? f.inputColumnId : null,
    inputPrompt: coluna ? null : f.inputPrompt,
    outputKind: f.outputKind,
    outputColumnId: f.outputKind === "card" ? f.outputColumnId : null,
    outputWorkspaceId: f.outputKind === "nota" ? f.outputWorkspaceId : null,
    outputTitle: f.outputTitle,
    outputTitleText: f.outputTitle === "fixo" ? f.outputTitleText : null,
    consumeAction,
    consumeColumnId: consumeAction === "mover" ? f.consumeColumnId : null,
  };
}

type Referencias = Forma & { agentIds: string[] };

/** O que já está gravado e, por isso, não se confere de novo num PATCH. */
type JaGravado = Forma & { agentIds: Set<string> };

/**
 * Colunas, workspace e agentes são do usuário (RN-15, INV-59), com o mesmo 404
 * para o alheio e o inexistente (INV-02). Devolve o nome atual de cada agente,
 * que o passo grava. Recebe a forma **já normalizada** (`paraGravar`): cada
 * referência só existe no tipo que a usa, e só nele é conferida.
 *
 * **Só o que é novo é conferido**, como nas fontes vivas do agente: o editor
 * manda a rotina inteira a cada PATCH, e uma coluna excluída depois de salvar
 * não pode tornar impossível editar o resto — ela aparece nos `problems` do
 * detalhe. A coluna de consumidas é conferida de novo sempre que ela **ou** o
 * quadro da entrada mudam: a regra é "do mesmo quadro", e os dois lados dela
 * podem mudar. Trocar de tipo conta como mudar: a referência gravada no tipo
 * anterior está nula.
 */
async function conferirReferencias(
  userId: string,
  refs: Referencias,
  jaGravado?: JaGravado,
): Promise<Map<string, string>> {
  const entradaMudou =
    !jaGravado ||
    jaGravado.inputBoardId !== refs.inputBoardId ||
    jaGravado.inputColumnId !== refs.inputColumnId;
  if (refs.inputKind === "coluna" && refs.inputBoardId && refs.inputColumnId && entradaMudou) {
    const coluna = await prisma.boardColumn.findFirst({
      where: { id: refs.inputColumnId, boardId: refs.inputBoardId, board: { userId } },
      select: { id: true },
    });
    if (!coluna) throw notFound("Coluna de entrada não encontrada");
  }

  if (
    refs.outputColumnId &&
    (!jaGravado || jaGravado.outputColumnId !== refs.outputColumnId)
  ) {
    const coluna = await prisma.boardColumn.findFirst({
      where: { id: refs.outputColumnId, board: { userId } },
      select: { id: true },
    });
    if (!coluna) throw notFound("Coluna de saída não encontrada");
  }

  /// A nota de saída é criada por `notes.criar`, que confere o workspace de
  /// novo a cada execução; conferir aqui é o que recusa o id alheio ao salvar,
  /// com o mesmo 404 do inexistente e a mesma frase de `conferirWorkspace`.
  if (
    refs.outputWorkspaceId &&
    (!jaGravado || jaGravado.outputWorkspaceId !== refs.outputWorkspaceId)
  ) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: refs.outputWorkspaceId, userId },
      select: { id: true },
    });
    if (!workspace) throw notFound("Workspace não encontrado");
  }

  const consumidasMudou =
    !jaGravado ||
    jaGravado.consumeColumnId !== refs.consumeColumnId ||
    jaGravado.inputBoardId !== refs.inputBoardId;
  if (refs.consumeColumnId && consumidasMudou) {
    const coluna = await prisma.boardColumn.findFirst({
      where: { id: refs.consumeColumnId, board: { userId } },
      select: { boardId: true },
    });
    if (!coluna) throw notFound("Coluna não encontrada");
    /// Existe e é do usuário, mas de outro quadro: aqui a recusa pode dizer o
    /// motivo, porque não revela nada que o usuário não tenha.
    if (coluna.boardId !== refs.inputBoardId) {
      throw invalida(
        "A coluna das ideias usadas precisa ser do quadro da entrada: card não muda de quadro.",
      );
    }
  }

  const unicos = [...new Set(refs.agentIds)];
  const agentes = unicos.length
    ? await prisma.aiAgent.findMany({
        where: { id: { in: unicos }, userId },
        select: { id: true, name: true },
      })
    : [];
  const nomes = new Map(agentes.map((a) => [a.id, a.name]));
  const novos = unicos.filter((id) => !jaGravado?.agentIds.has(id));
  if (novos.some((id) => !nomes.has(id))) throw notFound("Agente não encontrado");
  return nomes;
}

/* ---------------------------------------------------------------- escrita */

const nomeDuplicado = (nome: string) =>
  new AppError(409, "NOME_DUPLICADO", `Já existe uma rotina chamada "${nome}"`);

function ehDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

function passosParaGravar(
  routineId: string,
  steps: EntradaDaRotina["steps"],
  nomes: Map<string, string>,
  nomesGravados: Map<string, string>,
): Prisma.AiRoutineStepCreateManyInput[] {
  return steps.map((passo, position) => ({
    routineId,
    position,
    agentId: passo.agentId,
    agentName: nomes.get(passo.agentId) ?? nomesGravados.get(passo.agentId) ?? "",
    mode: passo.mode,
    instruction: passo.instruction,
  }));
}

/** Os campos de tipo de uma entrada ou de uma linha, sem os demais. */
function formaDe(f: Forma): Forma {
  return {
    inputKind: f.inputKind,
    inputBoardId: f.inputBoardId,
    inputColumnId: f.inputColumnId,
    inputPrompt: f.inputPrompt,
    outputKind: f.outputKind,
    outputColumnId: f.outputColumnId,
    outputWorkspaceId: f.outputWorkspaceId,
    outputTitle: f.outputTitle,
    outputTitleText: f.outputTitleText,
    consumeAction: f.consumeAction,
    consumeColumnId: f.consumeColumnId,
  };
}

/**
 * A agenda como vai ao banco: dias e horários em ordem. A ordem não muda o que
 * roda, mas a tela e a comparação de rascunho ficam estáveis.
 */
function paraGravarAgenda(agenda: RoutineSchedule) {
  return {
    scheduleDays: [...agenda.days].sort((a, b) => a - b),
    scheduleTimes: [...agenda.times].sort(),
    scheduleActive: agenda.active,
  };
}

export async function criar(userId: string, entrada: EntradaDaRotina): Promise<RoutineDetail> {
  /// `routineInputSchema` já passou `problemasDeForma` sobre a entrada crua.
  const forma = paraGravar(formaDe(entrada));
  const nomes = await conferirReferencias(userId, {
    ...forma,
    agentIds: entrada.steps.map((p) => p.agentId),
  });

  try {
    const rotina = await prisma.$transaction(async (tx) => {
      const criada = await tx.aiRoutine.create({
        data: {
          userId,
          name: entrada.name,
          description: entrada.description,
          ...forma,
          includeNotes: entrada.includeNotes,
          runCapMicros: entrada.runCapMicros,
          ...paraGravarAgenda(entrada.schedule),
        },
        select: { id: true },
      });
      await tx.aiRoutineStep.createMany({
        data: passosParaGravar(criada.id, entrada.steps, nomes, new Map()),
      });
      return criada;
    });
    return buscarPorId(userId, rotina.id);
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(entrada.name);
    throw erro;
  }
}

/**
 * INV-04: a posse vai no `where` do `updateMany`, e `count === 0` é o 404. Os
 * passos, quando vêm, são substituídos inteiros na mesma transação — a ordem
 * é a da lista, como as notas-base do agente.
 *
 * As regras que cruzam campo valem para a rotina **mesclada**: um PATCH que
 * troca a ação para `mover` sem mandar a coluna é recusado aqui, com a mesma
 * frase do schema de criação (`problemasDeForma`). Campo ausente mantém o
 * gravado; `null` explícito limpa.
 */
export async function atualizar(
  userId: string,
  id: string,
  patch: PatchDaRotina,
): Promise<RoutineDetail> {
  const atual = await prisma.aiRoutine.findFirst({
    where: { id, userId },
    select: {
      inputKind: true,
      inputBoardId: true,
      inputColumnId: true,
      inputPrompt: true,
      outputKind: true,
      outputColumnId: true,
      outputWorkspaceId: true,
      outputTitle: true,
      outputTitleText: true,
      consumeAction: true,
      consumeColumnId: true,
      scheduleDays: true,
      scheduleTimes: true,
      scheduleActive: true,
      steps: { select: { agentId: true, agentName: true, mode: true } },
    },
  });
  if (!atual) throw notFound("Rotina não encontrada");

  /// Etapa F. A agenda chega parcial — pausar e retomar mandam só `active` —
  /// e a regra que cruza campo vale para a mesclada: retomar uma agenda sem
  /// dia é recusado aqui, com a frase do schema de criação.
  const gravada = agendaDe(atual);
  const agenda: RoutineSchedule | undefined = patch.schedule && {
    days: patch.schedule.days ?? gravada.days,
    times: patch.schedule.times ?? gravada.times,
    active: patch.schedule.active ?? gravada.active,
  };
  const naAgenda = agenda ? problemasDaAgenda(agenda) : [];
  if (naAgenda[0]) throw invalida(naAgenda[0].message);

  const valor = <T>(novo: T | undefined, gravado: T): T => (novo !== undefined ? novo : gravado);
  const inputKind = valor(patch.inputKind, atual.inputKind);
  const mesclada: Forma = {
    inputKind,
    inputBoardId: valor(patch.inputBoardId, atual.inputBoardId),
    inputColumnId: valor(patch.inputColumnId, atual.inputColumnId),
    inputPrompt: valor(patch.inputPrompt, atual.inputPrompt),
    outputKind: valor(patch.outputKind, atual.outputKind),
    outputColumnId: valor(patch.outputColumnId, atual.outputColumnId),
    outputWorkspaceId: valor(patch.outputWorkspaceId, atual.outputWorkspaceId),
    outputTitle: valor(patch.outputTitle, atual.outputTitle),
    outputTitleText: valor(patch.outputTitleText, atual.outputTitleText),
    /// A ação gravada era da configuração por coluna: um PATCH que passa a
    /// pedido sem mandá-la não é recusado por um `mover` que ninguém pediu
    /// agora. Mandada explícita, `problemasDeForma` a julga.
    consumeAction:
      patch.consumeAction ?? (inputKind === "pedido" ? "manter" : atual.consumeAction),
    consumeColumnId: valor(patch.consumeColumnId, atual.consumeColumnId),
  };
  const forma = problemasDeForma({ ...mesclada, steps: patch.steps ?? atual.steps });
  if (forma[0]) throw invalida(forma[0].message);
  const gravar = paraGravar(mesclada);

  const agentIdsGravados = atual.steps.flatMap((p) => (p.agentId ? [p.agentId] : []));
  const nomes = await conferirReferencias(
    userId,
    {
      ...gravar,
      agentIds: patch.steps ? patch.steps.map((p) => p.agentId) : [],
    },
    { ...formaDe(atual), agentIds: new Set(agentIdsGravados) },
  );
  const nomesGravados = new Map(
    atual.steps.flatMap((p) => (p.agentId ? [[p.agentId, p.agentName] as const] : [])),
  );

  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.aiRoutine.updateMany({
        where: { id, userId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.includeNotes !== undefined && { includeNotes: patch.includeNotes }),
          ...(patch.runCapMicros !== undefined && { runCapMicros: patch.runCapMicros }),
          ...(agenda && paraGravarAgenda(agenda)),
          /// Os campos de tipo vão sempre, normalizados: trocar de tipo zera o
          /// que o tipo novo não usa, como sair de `mover` zera a coluna.
          ...gravar,
          /// Explícito: um patch só de passos não toca em coluna nenhuma de
          /// `ai_routine`, e o "editado em" ficaria parado. E o agendador
          /// depende dele: horário anterior à última gravação não é atendido
          /// (`pendentesDaRotina`, Etapa F) — ligar ou retomar a agenda não
          /// dispara o horário que acabou de passar. Por isso nenhuma escrita
          /// do motor de execução toca `ai_routine`.
          updatedAt: new Date(),
        },
      });
      if (count === 0) throw notFound("Rotina não encontrada");

      if (patch.steps !== undefined) {
        await tx.aiRoutineStep.deleteMany({ where: { routineId: id } });
        await tx.aiRoutineStep.createMany({
          data: passosParaGravar(id, patch.steps, nomes, nomesGravados),
        });
      }
    });
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(patch.name ?? "");
    throw erro;
  }

  return buscarPorId(userId, id);
}

/**
 * Excluir a rotina não apaga o histórico: `routineId` da execução vira nulo
 * por `SetNull`, e `routineName` continua dizendo qual era. Execução em
 * andamento segue até o fim — o motor não depende da rotina gravada depois de
 * começar.
 */
export async function excluir(userId: string, id: string): Promise<void> {
  const { count } = await prisma.aiRoutine.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Rotina não encontrada");
}
