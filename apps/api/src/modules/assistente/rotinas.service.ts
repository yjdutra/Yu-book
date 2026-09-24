import { Prisma } from "@prisma/client";
import { FERRAMENTAS_DO_ACERVO, FERRAMENTAS_DO_CHAT, problemasDeForma } from "@yu-book/shared";
import type {
  NomeDeFerramenta,
  RoutineColumnRef,
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
 * Posse (INV-02, INV-59, RN-15): rotina, agente e coluna de outra conta dão o
 * mesmo 404 de um id inexistente. As colunas **não** são chave estrangeira —
 * `board_column` não tem `user_id` (INV-03) —, então a posse é conferida pela
 * cadeia coluna → quadro → usuário ao gravar, e de novo ao ler e ao rodar.
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
 * aqui nem a lista do agente concede escrita.
 */
export function ferramentasDaRotina(tools: readonly string[]): NomeDeFerramenta[] {
  return FERRAMENTAS_DO_CHAT.filter(
    (nome) => tools.includes(nome) && !FERRAMENTAS_DO_ACERVO[nome].escrita,
  );
}

function ferramentasDoAgente(tools: readonly string[]): NomeDeFerramenta[] {
  return FERRAMENTAS_DO_CHAT.filter((nome) => tools.includes(nome));
}

/* ------------------------------------------------------------- execuções */

export const CAMPOS_DO_RUN = {
  id: true,
  routineId: true,
  routineName: true,
  status: true,
  inputCardId: true,
  inputTitle: true,
  outputCardId: true,
  costMicros: true,
  runCapMicros: true,
  errorCode: true,
  errorMessage: true,
  startedAt: true,
  endedAt: true,
} satisfies Prisma.AiRoutineRunSelect;

type RunNoBanco = Prisma.AiRoutineRunGetPayload<{ select: typeof CAMPOS_DO_RUN }>;

export function paraRun(linha: RunNoBanco): RoutineRunSummary {
  return {
    id: linha.id,
    routineId: linha.routineId,
    routineName: linha.routineName,
    status: linha.status,
    inputCardId: linha.inputCardId,
    inputTitle: linha.inputTitle,
    outputCardId: linha.outputCardId,
    costMicros: linha.costMicros,
    runCapMicros: linha.runCapMicros,
    errorCode: linha.errorCode,
    errorMessage: linha.errorMessage,
    startedAt: linha.startedAt.toISOString(),
    endedAt: linha.endedAt?.toISOString() ?? null,
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
} satisfies Prisma.AiRoutineRunStepSelect;

type PassoExecutadoNoBanco = Prisma.AiRoutineRunStepGetPayload<{
  select: typeof CAMPOS_DO_PASSO_EXECUTADO;
}>;

export function paraPassoExecutado(linha: PassoExecutadoNoBanco): RoutineRunStep {
  return {
    ...linha,
    startedAt: linha.startedAt?.toISOString() ?? null,
    endedAt: linha.endedAt?.toISOString() ?? null,
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
  inputBoardId: true,
  inputColumnId: true,
  outputColumnId: true,
  outputTitle: true,
  includeNotes: true,
  consumeAction: true,
  consumeColumnId: true,
  runCapMicros: true,
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
      agent: { select: { name: true, color: true, tools: true, modelId: true } },
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
 * os favoritos e o modelo do chat. Montado uma vez para a lista inteira.
 */
interface Ambiente {
  colunas: Map<string, ColunaResolvida>;
  favoritos: Map<string, { name: string; supportsTools: boolean }>;
  modeloDoChat: string | null;
}

async function ambienteDe(userId: string, rotinas: RotinaNoBanco[]): Promise<Ambiente> {
  const ids = new Set<string>();
  for (const r of rotinas) {
    ids.add(r.inputColumnId);
    ids.add(r.outputColumnId);
    if (r.consumeColumnId) ids.add(r.consumeColumnId);
  }
  const [colunas, favoritos, chat] = await Promise.all([
    /// INV-03: a coluna só resolve se o quadro for do usuário.
    prisma.boardColumn.findMany({
      where: { id: { in: [...ids] }, board: { userId } },
      select: { id: true, name: true, boardId: true, board: { select: { name: true } } },
    }),
    prisma.aiModelFavorite.findMany({
      where: { userId },
      select: { modelId: true, name: true, supportsTools: true },
    }),
    prisma.aiTaskModel.findUnique({ where: { userId_task: { userId, task: "chat" } } }),
  ]);
  return {
    colunas: new Map(
      colunas.map((c) => [c.id, { name: c.name, boardId: c.boardId, boardName: c.board.name }]),
    ),
    favoritos: new Map(
      favoritos.map((f) => [f.modelId, { name: f.name, supportsTools: f.supportsTools }]),
    ),
    modeloDoChat: chat?.modelId ?? null,
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

  const entrada = ambiente.colunas.get(rotina.inputColumnId);
  if (!entrada || entrada.boardId !== rotina.inputBoardId) {
    problemas.push({
      block: "entrada",
      position: null,
      message: "A coluna de entrada não existe mais. Escolha outra.",
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

  if (!ambiente.colunas.has(rotina.outputColumnId)) {
    problemas.push({
      block: "saida",
      position: null,
      message: "A coluna de saída não existe mais. Escolha outra.",
    });
  }
  if (rotina.consumeAction === "mover") {
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

function paraResumo(rotina: RotinaNoBanco, ambiente: Ambiente): RoutineSummary {
  const ultima = rotina.runs[0];
  return {
    id: rotina.id,
    name: rotina.name,
    description: rotina.description,
    input: refDaColuna(ambiente, rotina.inputColumnId),
    output: refDaColuna(ambiente, rotina.outputColumnId),
    consumeAction: rotina.consumeAction,
    consume:
      rotina.consumeAction === "mover" && rotina.consumeColumnId
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
    valid: problemasDe(rotina, ambiente).length === 0,
    lastRun: ultima ? paraRun(ultima) : null,
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

/**
 * Os cards que o próximo "Rodar agora" pode pegar, na ordem da coluna.
 *
 * **Idempotência pelo registro, não pela posição.** Elegível é o card ativo da
 * entrada que não tem execução `concluida` nem `em_andamento` **desta**
 * rotina. Com a ação "manter", a ideia usada continua na coluna e é pulada; a
 * que falhou ou foi cancelada volta a ser a primeira. A posse vai na mesma
 * consulta, pela cadeia até o quadro declarado (INV-03).
 */
export function ondeElegivel(
  userId: string,
  rotina: { id: string; inputBoardId: string; inputColumnId: string },
): Prisma.CardWhereInput {
  return {
    columnId: rotina.inputColumnId,
    archived: false,
    column: { boardId: rotina.inputBoardId, board: { userId } },
    runsComoIdeia: {
      none: { routineId: rotina.id, status: { in: ["concluida", "em_andamento"] } },
    },
  };
}

export async function buscarPorId(userId: string, id: string): Promise<RoutineDetail> {
  const rotina = await linhaDaRotina(userId, id);
  const onde = ondeElegivel(userId, rotina);
  const [ambiente, eligibleCount, proxima] = await Promise.all([
    ambienteDe(userId, [rotina]),
    prisma.card.count({ where: onde }),
    prisma.card.findFirst({
      where: onde,
      orderBy: { position: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  const resumo = paraResumo(rotina, ambiente);
  const steps: RoutineStep[] = rotina.steps.map((passo, indice) => ({
    ...(resumo.steps[indice] as RoutineSummary["steps"][number]),
    instruction: passo.instruction,
    agentTools: passo.agent ? ferramentasDoAgente(passo.agent.tools) : [],
  }));

  return {
    ...resumo,
    outputTitle: rotina.outputTitle,
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

/** O que já está gravado e, por isso, não se confere de novo num PATCH. */
interface JaGravado {
  inputBoardId: string;
  inputColumnId: string;
  outputColumnId: string;
  consumeColumnId: string | null;
  agentIds: Set<string>;
}

interface Referencias {
  inputBoardId: string;
  inputColumnId: string;
  outputColumnId: string;
  consumeColumnId: string | null;
  agentIds: string[];
}

/**
 * Colunas e agentes são do usuário (RN-15, INV-59), com o mesmo 404 para o
 * alheio e o inexistente (INV-02). Devolve o nome atual de cada agente, que o
 * passo grava.
 *
 * **Só o que é novo é conferido**, como nas fontes vivas do agente: o editor
 * manda a rotina inteira a cada PATCH, e uma coluna excluída depois de salvar
 * não pode tornar impossível editar o resto — ela aparece nos `problems` do
 * detalhe. A coluna de consumidas é conferida de novo sempre que ela **ou** o
 * quadro da entrada mudam: a regra é "do mesmo quadro", e os dois lados dela
 * podem mudar.
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
  if (entradaMudou) {
    const coluna = await prisma.boardColumn.findFirst({
      where: { id: refs.inputColumnId, boardId: refs.inputBoardId, board: { userId } },
      select: { id: true },
    });
    if (!coluna) throw notFound("Coluna de entrada não encontrada");
  }

  if (!jaGravado || jaGravado.outputColumnId !== refs.outputColumnId) {
    const coluna = await prisma.boardColumn.findFirst({
      where: { id: refs.outputColumnId, board: { userId } },
      select: { id: true },
    });
    if (!coluna) throw notFound("Coluna de saída não encontrada");
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

export async function criar(userId: string, entrada: EntradaDaRotina): Promise<RoutineDetail> {
  const consumeColumnId = entrada.consumeAction === "mover" ? entrada.consumeColumnId : null;
  const nomes = await conferirReferencias(userId, {
    inputBoardId: entrada.inputBoardId,
    inputColumnId: entrada.inputColumnId,
    outputColumnId: entrada.outputColumnId,
    consumeColumnId,
    agentIds: entrada.steps.map((p) => p.agentId),
  });

  try {
    const rotina = await prisma.$transaction(async (tx) => {
      const criada = await tx.aiRoutine.create({
        data: {
          userId,
          name: entrada.name,
          description: entrada.description,
          inputBoardId: entrada.inputBoardId,
          inputColumnId: entrada.inputColumnId,
          outputColumnId: entrada.outputColumnId,
          outputTitle: entrada.outputTitle,
          includeNotes: entrada.includeNotes,
          consumeAction: entrada.consumeAction,
          consumeColumnId,
          runCapMicros: entrada.runCapMicros,
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
 * frase do schema de criação (`problemasDeForma`).
 */
export async function atualizar(
  userId: string,
  id: string,
  patch: PatchDaRotina,
): Promise<RoutineDetail> {
  const atual = await prisma.aiRoutine.findFirst({
    where: { id, userId },
    select: {
      inputBoardId: true,
      inputColumnId: true,
      outputColumnId: true,
      consumeAction: true,
      consumeColumnId: true,
      steps: { select: { agentId: true, agentName: true, mode: true } },
    },
  });
  if (!atual) throw notFound("Rotina não encontrada");

  const consumeAction = patch.consumeAction ?? atual.consumeAction;
  const mesclada = {
    inputBoardId: patch.inputBoardId ?? atual.inputBoardId,
    inputColumnId: patch.inputColumnId ?? atual.inputColumnId,
    outputColumnId: patch.outputColumnId ?? atual.outputColumnId,
    consumeAction,
    consumeColumnId:
      consumeAction === "mover"
        ? patch.consumeColumnId !== undefined
          ? patch.consumeColumnId
          : atual.consumeColumnId
        : null,
    steps: patch.steps ?? atual.steps,
  };
  const forma = problemasDeForma(mesclada);
  if (forma[0]) throw invalida(forma[0].message);

  const agentIdsGravados = atual.steps.flatMap((p) => (p.agentId ? [p.agentId] : []));
  const nomes = await conferirReferencias(
    userId,
    {
      ...mesclada,
      agentIds: patch.steps ? patch.steps.map((p) => p.agentId) : [],
    },
    {
      inputBoardId: atual.inputBoardId,
      inputColumnId: atual.inputColumnId,
      outputColumnId: atual.outputColumnId,
      consumeColumnId: atual.consumeColumnId,
      agentIds: new Set(agentIdsGravados),
    },
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
          ...(patch.inputBoardId !== undefined && { inputBoardId: patch.inputBoardId }),
          ...(patch.inputColumnId !== undefined && { inputColumnId: patch.inputColumnId }),
          ...(patch.outputColumnId !== undefined && { outputColumnId: patch.outputColumnId }),
          ...(patch.outputTitle !== undefined && { outputTitle: patch.outputTitle }),
          ...(patch.includeNotes !== undefined && { includeNotes: patch.includeNotes }),
          ...(patch.runCapMicros !== undefined && { runCapMicros: patch.runCapMicros }),
          /// Ação e coluna andam juntas: sair de `mover` zera a coluna.
          consumeAction: mesclada.consumeAction,
          consumeColumnId: mesclada.consumeColumnId,
          /// Explícito: um patch só de passos não toca em coluna nenhuma de
          /// `ai_routine`, e o "editado em" ficaria parado.
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
