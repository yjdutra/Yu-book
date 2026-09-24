import { Prisma } from "@prisma/client";
import {
  FERRAMENTAS_DO_ACERVO,
  FERRAMENTAS_DO_CHAT,
  formatarCard,
  formatarNota,
  liveSourceSchema,
  MAX_PREMISSAS_DO_AGENTE,
} from "@yu-book/shared";
import type {
  AgentBaseNote,
  AgentContextBlock,
  AgentDetail,
  AgentLiveSource,
  AgentPreview,
  AgentSummary,
  agentInputSchema,
  agentPreviewSchema,
  agentUpdateSchema,
  LiveSource,
  NomeDeFerramenta,
} from "@yu-book/shared";
import type { z } from "zod";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import * as kanban from "../kanban/kanban.service.js";
import * as notes from "../notes/notes.service.js";
import { blocoComoTexto, montarContexto } from "./conversas.service.js";
import { estimarCustoMicros, MAX_SAIDA_TOKENS, tokensAproximados } from "./custo.service.js";
import { modeloParaTarefa, modeloPorId, preferenciaDe } from "./preferencias.service.js";

/**
 * Agentes especialistas — Etapa D da frente de IA.
 *
 * Um agente não é um chat diferente: é o **mesmo** laço, com a mensagem
 * `system` montada por `montarContextoDoAgente` em vez do texto fixo, o modelo
 * do agente em vez do da tarefa `chat`, e a lista de ferramentas estreitada.
 * A prévia do editor e o chat chamam a mesma montagem — o que o editor mostra
 * é o que o modelo recebe, byte a byte.
 *
 * Posse (INV-02, INV-59, RN-15): agente, nota-base, quadro e coluna de outra
 * conta dão o mesmo 404 de um id inexistente. A coluna é conferida pela cadeia
 * coluna → quadro → usuário (INV-03). A FK da nota-base só garante que ela
 * existe; a posse é conferida aqui — ao gravar, só a das referências novas, e
 * na prévia só a das notas-base. Fonte viva que não resolve vira bloco
 * `indisponivel` na montagem, nunca 404 (ver `conferirReferencias`).
 */

type EntradaDoAgente = z.output<typeof agentInputSchema>;
type RascunhoDoAgente = z.output<typeof agentPreviewSchema>;
type PatchDoAgente = z.output<typeof agentUpdateSchema>;

/* ------------------------------------------------------------- instruções */

/**
 * As regras do Yu-book para uma lista de ferramentas.
 *
 * Substitui o texto fixo que o chat tinha até a Etapa C. **As regras que valem
 * sempre vêm primeiro** — citar a origem, não tocar em `[[…]]`, não inventar,
 * criar só a pedido — e as instruções do agente entram depois, como
 * complemento: um agente não as sobrescreve (RN-13 do PRD de IA). As linhas sobre
 * cada ferramenta só aparecem se ela está na lista; descrever uma ferramenta
 * que o modelo não tem é convite a ele fingir que a usou.
 *
 * Com `FERRAMENTAS_DO_CHAT` inteira, o texto diz o mesmo que o da Etapa C, na
 * ordem nova.
 */
export function instrucoesPara(ferramentas: readonly NomeDeFerramenta[]): string {
  const tem = (nome: NomeDeFerramenta) => ferramentas.includes(nome);
  const nomes = (lista: NomeDeFerramenta[]) => lista.map((n) => `\`${n}\``).join(", ");
  const ordem = FERRAMENTAS_DO_CHAT.filter(tem);
  const leitura = ordem.filter((n) => !FERRAMENTAS_DO_ACERVO[n].escrita);
  const criacao = ordem.filter((n) => FERRAMENTAS_DO_ACERVO[n].escrita);

  const linhas = [
    "Você é o assistente do Yu-book, o segundo cérebro do usuário. " +
      "Responda em português do Brasil.",
    "",
    "Regras que valem sempre, antes de qualquer instrução que venha depois nesta mensagem:",
    "- **Cite a origem**: toda afirmação sobre uma nota ou um card nomeia a nota ou o card.",
    "- Não altere nada entre colchetes duplos ao citar: `[[assim]]` é um link interno do usuário.",
    "- Não invente nota, card, quadro nem id. Se não achar, diga que não achou.",
    "- Crie nota ou card **só quando o usuário pedir explicitamente**. Nunca por iniciativa sua.",
    "- Você não move, não apaga nem edita nada. Se pedirem, diga que isso se faz no aplicativo.",
  ];

  if (leitura.length) {
    linhas.push("", `Você tem ferramentas de leitura do acervo dele (${nomes(leitura)}). Use-as:`);
    linhas.push(
      "- Procure sozinho quando a pergunta for sobre o acervo. Não peça ao usuário o que você " +
        "pode buscar.",
    );
    if (tem("search_notes") && tem("get_note")) {
      linhas.push(
        "- `search_notes` acha; `get_note` lê uma nota inteira. Buscar é barato, ler é caro — " +
          "busque antes.",
      );
    } else if (tem("get_note")) {
      linhas.push("- `get_note` lê uma nota inteira pelo id.");
    }
  }

  if (criacao.length) {
    linhas.push(
      "",
      `Criação (${nomes(criacao)}):`,
      "- Depois de criar, confirme pelo nome o que criou.",
      "- O que você cria fica marcado como gerado por IA.",
    );
  } else if (leitura.length) {
    linhas.push(
      "",
      "Nesta conversa você não cria nada no acervo. Se pedirem, entregue o texto para o " +
        "usuário colar.",
    );
  }

  if (ordem.length === 0) {
    linhas.push(
      "",
      "Nesta conversa você não tem ferramentas: responda com o que está nesta mensagem e na " +
        "conversa, e não diga que consultou o acervo.",
    );
  }

  return linhas.join("\n");
}

/* --------------------------------------------------------------- contexto */

/** O que a montagem precisa de um agente — gravado ou rascunho. */
export interface AgenteParaContexto {
  name: string;
  instructionsMd: string;
  modelId: string | null;
  tools: readonly NomeDeFerramenta[];
  baseNoteIds: string[];
  liveSources: LiveSource[];
}

export interface ContextoDoAgente {
  sistema: string;
  chars: number;
  tokens: number;
  premissasChars: number;
  /// Títulos das premissas que não couberam (RNF-04). Declarados na própria
  /// mensagem `system` e no evento `inicio`.
  cortados: string[];
  avisos: string[];
  blocos: AgentContextBlock[];
  /// `FERRAMENTAS_DO_CHAT ∩ agente.tools`, na ordem do chat.
  permitidas: NomeDeFerramenta[];
}

interface Premissa {
  titulo: string;
  texto: string;
  tipo: "nota" | "fonte";
}

async function fonteComoTexto(
  userId: string,
  fonte: LiveSource,
  fuso: string,
): Promise<Premissa | null> {
  try {
    const coluna = await kanban.cardsDaColuna(userId, fonte.columnId, fonte.limite);
    /// INV-03: a coluna precisa estar no quadro declarado. Os cards lidos são
    /// do próprio usuário — a leitura já é pela cadeia —, então descartá-los
    /// aqui não esconde nada alheio; só mantém a fonte fiel ao que foi gravado.
    if (coluna.boardId !== fonte.boardId) return null;
    const linhas =
      fonte.detalhe === "faces"
        ? coluna.cards.map((card) => formatarCard(card, fuso))
        : coluna.cards.map((card) => `- ${card.title}`);
    const cabeca =
      coluna.total > coluna.cards.length
        ? `${coluna.cards.length} de ${coluna.total} cards, na ordem da coluna:`
        : `${coluna.total} card(s), na ordem da coluna:`;
    return {
      tipo: "fonte",
      titulo: `${coluna.boardName} / ${coluna.name}`,
      texto: linhas.length ? `${cabeca}\n${linhas.join("\n")}` : "_(coluna vazia)_",
    };
  } catch (erro) {
    /// A coluna não resolve para o usuário: excluída depois de o agente ser
    /// salvo, ou — só na prévia, que não confere fonte — de outra conta. Os
    /// dois casos são indistinguíveis de propósito (INV-02) e viram aviso,
    /// sem nada da coluna: derrubar a conversa ou a prévia por isso puniria
    /// quem só quer perguntar, ou quem abriu o editor para tirar a fonte.
    if (erro instanceof AppError && erro.statusCode === 404) return null;
    throw erro;
  }
}

/**
 * O contexto de um agente, ou do Assistente sem agente (`null`).
 *
 * **A mesma função para a prévia e para o chat.** O chat a chama a cada
 * mensagem, para que as fontes vivas venham frescas; a prévia, a cada
 * alteração do editor. A ordem é a do plano da Etapa D: regras do Yu-book,
 * instruções do agente, premissas (notas-base) e fontes vivas. Notas-base e
 * fontes cortam juntas, por bloco inteiro, dentro de `MAX_PREMISSAS_DO_AGENTE`
 * — pela mesma `montarContexto` dos anexos.
 *
 * Não confere posse das notas-base: quem chama já conferiu
 * (`conferirReferencias` ao gravar e na prévia), e a leitura é por `userId`
 * de qualquer jeito. Uma nota que falte aqui é uma nota apagada de vez, e a
 * cascata já a teria tirado do agente. As colunas **não** são conferidas
 * antes: a leitura delas é pela cadeia (INV-03), e a que não resolve vira
 * bloco `indisponivel`.
 */
export async function montarContextoDoAgente(
  userId: string,
  agente: AgenteParaContexto | null,
  fuso: string,
): Promise<ContextoDoAgente> {
  if (!agente) {
    const sistema = instrucoesPara(FERRAMENTAS_DO_CHAT);
    return {
      sistema,
      chars: sistema.length,
      tokens: tokensAproximados(sistema.length),
      premissasChars: 0,
      cortados: [],
      avisos: [],
      blocos: [
        { kind: "regras", title: "Regras do Yu-book", chars: sistema.length, status: "incluido" },
      ],
      permitidas: [...FERRAMENTAS_DO_CHAT],
    };
  }

  /// A lista do chat é a fonte; a do agente só estreita. Um nome gravado que
  /// o chat deixou de oferecer cai aqui, sem erro.
  const permitidas = FERRAMENTAS_DO_CHAT.filter((n) => agente.tools.includes(n));
  const regras = instrucoesPara(permitidas);
  const avisos: string[] = [];
  const blocos: AgentContextBlock[] = [
    { kind: "regras", title: "Regras do Yu-book", chars: regras.length, status: "incluido" },
  ];

  const nome = agente.name.trim() || "sem nome";
  const instrucoes = agente.instructionsMd.trim()
    ? `## Instruções do agente «${nome}»\n\n${agente.instructionsMd.trim()}`
    : "";
  if (instrucoes) {
    blocos.push({
      kind: "instrucoes",
      title: `Instruções de «${nome}»`,
      chars: instrucoes.length,
      status: "incluido",
    });
  }

  /// As notas-base, em ordem. A lixeira sai do contexto e entra nos avisos:
  /// a nota continua ligada ao agente e volta sozinha se for restaurada.
  const linhas = agente.baseNoteIds.length
    ? await prisma.note.findMany({
        where: { id: { in: agente.baseNoteIds }, userId },
        select: { id: true, title: true, deletedAt: true },
      })
    : [];
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const premissas: Premissa[] = [];
  const statusDaPremissa = new Map<Premissa, AgentContextBlock>();

  for (const id of agente.baseNoteIds) {
    const linha = porId.get(id);
    if (!linha) continue;
    if (linha.deletedAt) {
      avisos.push(`A nota-base «${linha.title}» está na lixeira e ficou fora.`);
      blocos.push({ kind: "nota", title: linha.title, chars: 0, status: "lixeira" });
      continue;
    }
    const nota = await notes.buscarPorId(userId, id);
    const premissa: Premissa = { tipo: "nota", titulo: nota.title, texto: formatarNota(nota, fuso) };
    const bloco: AgentContextBlock = {
      kind: "nota",
      title: nota.title,
      chars: blocoComoTexto(premissa).length,
      status: "incluido",
    };
    premissas.push(premissa);
    statusDaPremissa.set(premissa, bloco);
    blocos.push(bloco);
  }

  const fontes = await Promise.all(
    agente.liveSources.map((fonte) => fonteComoTexto(userId, fonte, fuso)),
  );
  for (const fonte of fontes) {
    if (!fonte) {
      avisos.push("Uma fonte viva aponta para uma coluna que não está disponível e ficou fora.");
      blocos.push({
        kind: "fonte",
        title: "Coluna indisponível",
        chars: 0,
        status: "indisponivel",
      });
      continue;
    }
    const bloco: AgentContextBlock = {
      kind: "fonte",
      title: fonte.titulo,
      chars: blocoComoTexto(fonte).length,
      status: "incluido",
    };
    premissas.push(fonte);
    statusDaPremissa.set(fonte, bloco);
    blocos.push(bloco);
  }

  const corte = montarContexto(premissas, MAX_PREMISSAS_DO_AGENTE);
  const incluidas = new Set(corte.incluidos);
  for (const premissa of premissas) {
    const bloco = statusDaPremissa.get(premissa);
    if (bloco && !incluidas.has(premissa)) bloco.status = "cortado";
  }

  const notasIncluidas = corte.incluidos.filter((p) => p.tipo === "nota");
  const fontesIncluidas = corte.incluidos.filter((p) => p.tipo === "fonte");
  const partes = [regras];
  if (instrucoes) partes.push(instrucoes);
  if (notasIncluidas.length) {
    partes.push(
      "## Premissas\n\nNotas que o usuário escolheu como base deste agente, na íntegra.\n\n" +
        notasIncluidas.map(blocoComoTexto).join("\n\n"),
    );
  }
  if (fontesIncluidas.length) {
    partes.push(
      "## Fontes vivas\n\nColunas de quadro lidas agora, a cada mensagem.\n\n" +
        fontesIncluidas.map(blocoComoTexto).join("\n\n"),
    );
  }
  /// RNF-04 também para o modelo: ele precisa saber que há premissa que não
  /// viu, ou responde como se a base estivesse completa.
  if (corte.cortados.length) {
    partes.push(
      `[${corte.cortados.length} premissa(s) não couberam no limite de contexto e ficaram de ` +
        `fora: ${corte.cortados.join(", ")}]`,
    );
  }

  const sistema = partes.join("\n\n");
  return {
    sistema,
    chars: sistema.length,
    tokens: tokensAproximados(sistema.length),
    premissasChars: corte.tamanho,
    cortados: corte.cortados,
    avisos,
    blocos,
    permitidas,
  };
}

/* ------------------------------------------------------------------ posse */

/** O que já está gravado no agente e, por isso, não se confere de novo. */
interface JaGravado {
  baseNoteIds: Set<string>;
  fontes: Set<string>;
}

const chaveDaFonte = (fonte: { boardId: string; columnId: string }) =>
  `${fonte.boardId}/${fonte.columnId}`;

/**
 * Notas-base e colunas de fonte viva são do usuário (RN-15, INV-59). O mesmo
 * 404 para o alheio e o inexistente (INV-02). A coluna precisa estar **no
 * quadro declarado** e o quadro ser do usuário — a cadeia inteira na mesma
 * consulta.
 *
 * **Só o que é novo é conferido.** O editor manda a lista inteira a cada
 * PATCH; se o que já estava gravado fosse conferido de novo, uma coluna
 * excluída depois de salvar tornaria o agente impossível de editar até o
 * usuário tirar a fonte — e o 404 nem diria qual. O gravado já passou por
 * aqui quando entrou, e a montagem trata o que deixou de resolver
 * (`indisponivel`, aviso). No POST, `jaGravado` não vem e tudo é novo.
 */
async function conferirReferencias(
  userId: string,
  entrada: { baseNoteIds?: string[] | undefined; liveSources?: LiveSource[] | undefined },
  jaGravado?: JaGravado,
): Promise<void> {
  const ids = (entrada.baseNoteIds ?? []).filter((id) => !jaGravado?.baseNoteIds.has(id));
  if (ids.length) {
    const achadas = await prisma.note.count({ where: { id: { in: ids }, userId } });
    if (achadas !== ids.length) throw notFound("Nota não encontrada");
  }

  const novas = (entrada.liveSources ?? []).filter(
    (fonte) => !jaGravado?.fontes.has(chaveDaFonte(fonte)),
  );
  for (const fonte of novas) {
    const coluna = await prisma.boardColumn.findFirst({
      where: { id: fonte.columnId, boardId: fonte.boardId, board: { userId } },
      select: { id: true },
    });
    if (!coluna) throw notFound("Coluna não encontrada");
  }
}

/* ---------------------------------------------------------------- leitura */

const CAMPOS_DO_AGENTE = {
  id: true,
  name: true,
  description: true,
  color: true,
  instructionsMd: true,
  modelId: true,
  tools: true,
  liveSources: true,
  createdAt: true,
  updatedAt: true,
  baseNotes: {
    orderBy: { position: "asc" },
    select: { note: { select: { id: true, title: true, deletedAt: true } } },
  },
} satisfies Prisma.AiAgentSelect;

type AgenteNoBanco = Prisma.AiAgentGetPayload<{ select: typeof CAMPOS_DO_AGENTE }>;

/**
 * O JSON gravado, relido pelo mesmo schema que o validou. Uma linha que não
 * passe — escrita à mão no banco, ou de uma versão futura — vira lista vazia
 * em vez de derrubar a leitura do agente.
 */
function fontesGravadas(valor: Prisma.JsonValue): LiveSource[] {
  const lido = liveSourceSchema.array().safeParse(valor);
  return lido.success ? lido.data : [];
}

function ferramentasGravadas(valor: string[]): NomeDeFerramenta[] {
  return FERRAMENTAS_DO_CHAT.filter((n) => valor.includes(n));
}

async function nomesDosFavoritos(userId: string): Promise<Map<string, string>> {
  const favoritos = await prisma.aiModelFavorite.findMany({
    where: { userId },
    select: { modelId: true, name: true },
  });
  return new Map(favoritos.map((f) => [f.modelId, f.name]));
}

function paraResumo(linha: AgenteNoBanco, favoritos: Map<string, string>): AgentSummary {
  const tools = ferramentasGravadas(linha.tools);
  return {
    id: linha.id,
    name: linha.name,
    description: linha.description,
    color: linha.color,
    modelId: linha.modelId,
    modelName: linha.modelId ? (favoritos.get(linha.modelId) ?? null) : null,
    modelMissing: linha.modelId !== null && !favoritos.has(linha.modelId),
    baseNoteTitles: linha.baseNotes.map((b) => b.note.title),
    toolCount: tools.length,
    writes: tools.some((n) => FERRAMENTAS_DO_ACERVO[n].escrita),
    liveSourceCount: fontesGravadas(linha.liveSources).length,
    createdAt: linha.createdAt.toISOString(),
    updatedAt: linha.updatedAt.toISOString(),
  };
}

export async function listar(userId: string): Promise<AgentSummary[]> {
  const [linhas, favoritos] = await Promise.all([
    prisma.aiAgent.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      select: CAMPOS_DO_AGENTE,
    }),
    nomesDosFavoritos(userId),
  ]);
  return linhas.map((l) => paraResumo(l, favoritos));
}

async function linhaDoAgente(userId: string, id: string): Promise<AgenteNoBanco> {
  const linha = await prisma.aiAgent.findFirst({ where: { id, userId }, select: CAMPOS_DO_AGENTE });
  if (!linha) throw notFound("Agente não encontrado");
  return linha;
}

/** Tamanho do corpo sem trazer o corpo: uma nota pode ter 1 MB. */
async function tamanhosDasNotas(userId: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const linhas = await prisma.$queryRaw<{ id: string; chars: number }[]>`
    SELECT id, char_length(content_md)::int AS chars
    FROM note
    WHERE user_id = ${userId}::uuid AND id = ANY(${ids}::uuid[])`;
  return new Map(linhas.map((l) => [l.id, Number(l.chars)]));
}

async function fontesComNomes(userId: string, fontes: LiveSource[]): Promise<AgentLiveSource[]> {
  if (!fontes.length) return [];
  const colunas = await prisma.boardColumn.findMany({
    where: { id: { in: fontes.map((f) => f.columnId) }, board: { userId } },
    select: { id: true, name: true, boardId: true, board: { select: { name: true } } },
  });
  const porId = new Map(colunas.map((c) => [c.id, c]));
  return fontes.map((fonte) => {
    const coluna = porId.get(fonte.columnId);
    const valida = coluna && coluna.boardId === fonte.boardId;
    return {
      ...fonte,
      boardName: valida ? coluna.board.name : null,
      columnName: valida ? coluna.name : null,
    };
  });
}

export async function buscarPorId(userId: string, id: string): Promise<AgentDetail> {
  const [linha, favoritos] = await Promise.all([
    linhaDoAgente(userId, id),
    nomesDosFavoritos(userId),
  ]);
  const ids = linha.baseNotes.map((b) => b.note.id);
  const [tamanhos, liveSources] = await Promise.all([
    tamanhosDasNotas(userId, ids),
    fontesComNomes(userId, fontesGravadas(linha.liveSources)),
  ]);

  const baseNotes: AgentBaseNote[] = linha.baseNotes.map(({ note }) => ({
    id: note.id,
    title: note.title,
    chars: tamanhos.get(note.id) ?? 0,
    trashed: note.deletedAt !== null,
  }));

  return {
    ...paraResumo(linha, favoritos),
    instructionsMd: linha.instructionsMd,
    tools: ferramentasGravadas(linha.tools),
    baseNotes,
    liveSources,
  };
}

/**
 * O agente de uma conversa, pronto para a montagem. 404 se sumiu — quem chama
 * (o chat) já tratou o caso de agente excluído antes, pela conversa.
 */
export async function carregarParaChat(
  userId: string,
  id: string,
): Promise<AgenteParaContexto> {
  const linha = await linhaDoAgente(userId, id);
  return {
    name: linha.name,
    instructionsMd: linha.instructionsMd,
    modelId: linha.modelId,
    tools: ferramentasGravadas(linha.tools),
    baseNoteIds: linha.baseNotes.map((b) => b.note.id),
    liveSources: fontesGravadas(linha.liveSources),
  };
}

/* ---------------------------------------------------------------- escrita */

const nomeDuplicado = (nome: string) =>
  new AppError(409, "NOME_DUPLICADO", `Já existe um agente chamado "${nome}"`);

function ehDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

export async function criar(userId: string, entrada: EntradaDoAgente): Promise<AgentDetail> {
  await conferirReferencias(userId, entrada);

  try {
    const agente = await prisma.$transaction(async (tx) => {
      const criado = await tx.aiAgent.create({
        data: {
          userId,
          name: entrada.name,
          description: entrada.description,
          color: entrada.color,
          instructionsMd: entrada.instructionsMd,
          modelId: entrada.modelId,
          tools: entrada.tools,
          liveSources: entrada.liveSources as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.aiAgentBaseNote.createMany({
        data: entrada.baseNoteIds.map((noteId, position) => ({
          agentId: criado.id,
          noteId,
          position,
        })),
      });
      return criado;
    });
    return buscarPorId(userId, agente.id);
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(entrada.name);
    throw erro;
  }
}

/**
 * INV-04: a posse vai no `where` do `updateMany`, e `count === 0` é o 404.
 * As notas-base, quando vêm, são substituídas inteiras na mesma transação —
 * a ordem é a da lista, e reordenar é mandar a lista de novo.
 */
export async function atualizar(
  userId: string,
  id: string,
  patch: PatchDoAgente,
): Promise<AgentDetail> {
  if (patch.baseNoteIds !== undefined || patch.liveSources !== undefined) {
    /// O gravado, lido com o escopo do usuário: agente alheio já é 404 aqui,
    /// antes de qualquer conferência, igual ao `updateMany` mais abaixo.
    const atual = await prisma.aiAgent.findFirst({
      where: { id, userId },
      select: { liveSources: true, baseNotes: { select: { noteId: true } } },
    });
    if (!atual) throw notFound("Agente não encontrado");
    await conferirReferencias(userId, patch, {
      baseNoteIds: new Set(atual.baseNotes.map((b) => b.noteId)),
      fontes: new Set(fontesGravadas(atual.liveSources).map(chaveDaFonte)),
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.aiAgent.updateMany({
        where: { id, userId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.color !== undefined && { color: patch.color }),
          ...(patch.instructionsMd !== undefined && { instructionsMd: patch.instructionsMd }),
          ...(patch.modelId !== undefined && { modelId: patch.modelId }),
          ...(patch.tools !== undefined && { tools: patch.tools }),
          ...(patch.liveSources !== undefined && {
            liveSources: patch.liveSources as Prisma.InputJsonValue,
          }),
          /// Explícito: um patch só de notas-base não toca em coluna nenhuma
          /// de `ai_agent`, e o "editado em" da galeria ficaria parado.
          updatedAt: new Date(),
        },
      });
      if (count === 0) throw notFound("Agente não encontrado");

      if (patch.baseNoteIds !== undefined) {
        await tx.aiAgentBaseNote.deleteMany({ where: { agentId: id } });
        await tx.aiAgentBaseNote.createMany({
          data: patch.baseNoteIds.map((noteId, position) => ({ agentId: id, noteId, position })),
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
 * Excluir o agente não apaga conversa: `agentId` vira nulo por `SetNull`, e
 * `agentName` continua dizendo quem respondeu. A marca de nota e card gerados
 * guarda o nome como texto, e também sobrevive.
 */
export async function excluir(userId: string, id: string): Promise<void> {
  const { count } = await prisma.aiAgent.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Agente não encontrado");
}

/* ----------------------------------------------------------------- prévia */

/**
 * O que o agente receberia, a partir do **rascunho** do editor, sem gravar
 * nada. O custo é de um passo, com o preço do favorito escolhido — ou do
 * modelo do chat, se o agente não tem um próprio. Sem modelo utilizável a
 * prévia não falha: devolve `costPerStepMicros: null` e diz por quê, porque é
 * justamente no editor que se conserta isso.
 */
export async function previa(
  userId: string,
  rascunho: RascunhoDoAgente,
  fuso: string,
): Promise<AgentPreview> {
  /// Só as notas-base: nota alheia ou inexistente segue 404 (RN-15, INV-59).
  /// As fontes vivas não passam por aqui — a prévia é o editor reabrindo o
  /// agente, e uma coluna excluída depois de salvar precisa aparecer como
  /// `indisponivel`, não travar o editor. Coluna alheia ou fora do quadro
  /// declarado cai no mesmo bloco, sem ler nada alheio: `cardsDaColuna`
  /// resolve pela cadeia até `board.userId` (INV-03), e o 404 dela vira aviso.
  await conferirReferencias(userId, { baseNoteIds: rascunho.baseNoteIds });
  const contexto = await montarContextoDoAgente(userId, rascunho, fuso);
  const avisos = [...contexto.avisos];

  let modelo = null;
  try {
    modelo = rascunho.modelId
      ? await modeloPorId(userId, rascunho.modelId, { agente: rascunho.name || "sem nome" })
      : await modeloParaTarefa(userId, "chat");
  } catch (erro) {
    if (!(erro instanceof AppError)) throw erro;
    avisos.push(erro.message);
  }
  if (modelo && contexto.permitidas.length && !modelo.supportsTools) {
    avisos.push(
      `"${modelo.name}" não sabe chamar ferramenta: com ferramentas ligadas, o chat recusa.`,
    );
  }

  return {
    system: contexto.sistema,
    chars: contexto.chars,
    tokens: contexto.tokens,
    premisesChars: contexto.premissasChars,
    premisesLimit: MAX_PREMISSAS_DO_AGENTE,
    costPerStepMicros: modelo
      ? estimarCustoMicros(modelo, contexto.chars, MAX_SAIDA_TOKENS)
      : null,
    modelId: modelo?.id ?? null,
    modelName: modelo?.name ?? null,
    blocks: contexto.blocos,
    cut: contexto.cortados,
    warnings: avisos,
  };
}

/** A prévia no fuso do usuário — o mesmo que o chat usa para as datas. */
export async function previaDoUsuario(
  userId: string,
  rascunho: RascunhoDoAgente,
): Promise<AgentPreview> {
  const { timezone } = await preferenciaDe(userId);
  return previa(userId, rascunho, timezone);
}

/* ------------------------------------------------------------- exportação */

type ValorYaml = string | number | boolean | null | ValorYaml[] | { [chave: string]: ValorYaml };

/**
 * Escalar YAML sempre entre aspas duplas. O JSON de uma string já é escalar
 * YAML de aspas duplas válido — `\"`, `\\`, `\n`, `\uXXXX` são os mesmos
 * escapes —, com três exceções que o JSON deixa cruas e o YAML não aceita
 * cruas: DEL e os controles C1, os separadores U+2028/U+2029 e o BOM. Aspas
 * sempre, e não só quando precisa: `: `, `#`, `yes` e `- ` no começo são os
 * casos em que um nome de agente viraria outra coisa sem elas.
 */
function escalarYaml(valor: string | number | boolean | null): string {
  if (valor === null) return "null";
  if (typeof valor !== "string") return String(valor);
  return JSON.stringify(valor).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Serializa só as formas que a exportação usa: escalar, lista e objeto raso. */
function yaml(objeto: Record<string, ValorYaml>, recuo = ""): string {
  const linhas: string[] = [];
  for (const [chave, valor] of Object.entries(objeto)) {
    if (Array.isArray(valor)) {
      if (!valor.length) {
        linhas.push(`${recuo}${chave}: []`);
        continue;
      }
      linhas.push(`${recuo}${chave}:`);
      for (const item of valor) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const dentro = yaml(item, `${recuo}    `).split("\n");
          linhas.push(`${recuo}  - ${(dentro[0] ?? "").trimStart()}`, ...dentro.slice(1));
        } else {
          linhas.push(`${recuo}  - ${escalarYaml(item as string | number | boolean | null)}`);
        }
      }
    } else if (valor !== null && typeof valor === "object") {
      linhas.push(`${recuo}${chave}:`, yaml(valor, `${recuo}  `));
    } else {
      linhas.push(`${recuo}${chave}: ${escalarYaml(valor)}`);
    }
  }
  return linhas.join("\n");
}

function nomeDeArquivo(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "agente"}.md`;
}

/**
 * O agente em Markdown com frontmatter: é a portabilidade que a tabela própria
 * não dá sozinha. O corpo são as instruções; as notas-base saem por **título**
 * — o id não significa nada fora deste banco — e as fontes, por quadro e
 * coluna.
 */
export async function exportar(
  userId: string,
  id: string,
): Promise<{ arquivo: string; markdown: string }> {
  const agente = await buscarPorId(userId, id);
  const frontmatter = yaml({
    name: agente.name,
    description: agente.description,
    color: agente.color,
    model: agente.modelId,
    tools: agente.tools,
    baseNotes: agente.baseNotes.map((n) => n.title),
    liveSources: agente.liveSources.map((f) => ({
      board: f.boardName,
      column: f.columnName,
      limit: f.limite,
      detail: f.detalhe,
    })),
  });
  const corpo = agente.instructionsMd.trim();
  return {
    arquivo: nomeDeArquivo(agente.name),
    markdown: `---\n${frontmatter}\n---\n${corpo ? `\n${corpo}\n` : ""}`,
  };
}
