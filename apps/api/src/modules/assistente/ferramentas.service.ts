import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DEFINICOES_DO_ASSISTENTE,
  diaParaPrazo,
  FERRAMENTAS_DA_WEB,
  FERRAMENTAS_DO_ACERVO,
  FERRAMENTAS_DO_CHAT,
  formatarBusca,
  formatarCardDetalhe,
  formatarDashboard,
  formatarListaDeQuadros,
  formatarNota,
  formatarNotaBreve,
  formatarQuadro,
} from "@yu-book/shared";
import type { ChatSource, NomeDoAssistente } from "@yu-book/shared";
import { AppError } from "../../lib/errors.js";
import type { OrigemDoAssistente } from "../../lib/marca.js";
import * as dashboard from "../dashboard/dashboard.service.js";
import * as kanban from "../kanban/kanban.service.js";
import * as notes from "../notes/notes.service.js";
import * as search from "../notes/search.service.js";
import { abrirPagina, paginaComoTexto } from "../web/pagina.service.js";

/**
 * O outro consumidor do vocabulário do acervo (Etapa B da frente de IA).
 *
 * O servidor MCP publica estas mesmas ações e as resolve por HTTP contra esta
 * API; aqui elas chamam os services **direto**. O metadado é o mesmo objeto de
 * `packages/shared`, e a saída passa pelos mesmos formatadores — é o que faz o
 * CA-11 (o texto de uma nota pelo chat é idêntico ao de `yubook://nota/{id}`)
 * valer por construção, e não por alguém lembrar de conferir.
 *
 * **O chat lê, cria e conclui card; não move, não apaga, não edita texto.**
 * Desde a Etapa C da frente de IA, `create_card` e `create_note` têm executor,
 * e o que eles criam nasce com a marca de conteúdo gerado — a origem vem do
 * contexto, montado pelo servidor a partir da conversa, nunca dos argumentos do
 * modelo. Desde a Parte 1 da frente de cards, `complete_card` também, e deixa a
 * marca de quem concluiu pelo mesmo caminho. As outras três ações de escrita
 * seguem **sem executor**: um executor a mais neste mapa é a diferença entre
 * um chat que cria a pedido e um que apaga nota.
 *
 * **Desde a Etapa G uma ação sai do acervo**: `open_page`, de
 * `FERRAMENTAS_DA_WEB`, que o MCP não publica. O mapa abaixo cobre as duas
 * origens, e o tipo total cobra a decisão para cada nome das duas.
 */

/** Algo do acervo, que abre pelo id. É também a forma do que se cria. */
export interface FonteDoAcervo {
  tipo: "note" | "card" | "board";
  id: string;
  titulo: string;
}

/** Uma página da web: aberta por `open_page` ou citada pela busca (Etapa G). */
export interface FonteDaWeb {
  tipo: "web";
  url: string;
  titulo: string;
}

export type Fonte = FonteDoAcervo | FonteDaWeb;

export interface ResultadoDeFerramenta {
  /// O texto que volta ao modelo.
  texto: string;
  /**
   * O que foi consultado, para o painel citar a origem (RN-05).
   *
   * Vem daqui, e não de interpretar a resposta do modelo, porque é
   * **determinístico**: a lista existe mesmo quando o modelo esquece de citar,
   * e não inventa uma nota que ele tenha imaginado. O prompt ainda pede que o
   * texto nomeie a nota; as duas camadas resolvem coisas diferentes.
   */
  fontes: Fonte[];
  /**
   * O que a ação criou no acervo (Etapa C). Vazio nas de leitura. Vira o
   * evento `criado` e é gravado em `AiMessage.created`, para o chat mostrar
   * e oferecer desfazer. `board` nunca aparece aqui: o chat não cria quadro.
   */
  criados: FonteDoAcervo[];
}

export interface ContextoDeFerramenta {
  userId: string;
  /// O fuso do usuário, de `ai_preference`. Os formatadores o exigem, e não há
  /// valor padrão: cair no fuso do processo é o defeito que o MCP hospedado
  /// teve por semanas, relatando todo prazo um dia à frente.
  fuso: string;
  /// Quem escreve, quando a ação cria alguma coisa. Montado pelo servidor — o
  /// chat a partir da conversa e do modelo, a rotina a partir da execução —,
  /// nunca pelos argumentos: o modelo não tem como declarar a própria origem,
  /// nem escapar da marca. A união é por `via` (INV-58): o chat não compila
  /// sem `conversationId`, nem a rotina sem `runId` e `routineName`.
  origem: OrigemDoAssistente;
  /**
   * O que **esta** conversa pode executar (Etapa D): a lista do agente, já
   * cortada por `FERRAMENTAS_DO_CHAT`. O Assistente sem agente passa
   * `FERRAMENTAS_SEM_AGENTE` — o acervo, sem a web (Etapa G) —,
   * **explicitamente**: sem valor padrão, esquecer o campo é
   * erro de compilação, e não uma conversa que ganha tudo em silêncio. É uma
   * terceira condição, e não substitui as duas de INV-52: um nome aqui que não
   * esteja no chat continua recusado.
   */
  permitidas: readonly NomeDoAssistente[];
}

type Executor = (
  argumentos: unknown,
  contexto: ContextoDeFerramenta,
) => Promise<ResultadoDeFerramenta>;

/**
 * Valida os argumentos com o **mesmo** schema que o provedor recebeu.
 *
 * O modelo não é entrada confiável — é um terceiro que devolve JSON conforme
 * um schema que ele pode ignorar. Sem este passo, um `limit: 5000` inventado
 * por ele atravessaria até o `LIMIT` do SQL. O `parse` também aplica os
 * padrões declarados, como o `limit` de 8 da busca.
 */
function conferir<T extends z.ZodRawShape>(
  entrada: T,
  argumentos: unknown,
): z.infer<z.ZodObject<T>> {
  return z.object(entrada).parse(argumentos ?? {});
}

/**
 * O dia `AAAA-MM-DD` do modelo vira o fim daquele dia no fuso do usuário — a
 * mesma conversão do MCP (`diaParaPrazo`, §4.5 da skill do contrato).
 *
 * O `Error` cru dela vira `AppError` aqui porque o laço só repassa ao modelo a
 * mensagem de `AppError` e de `ZodError`; qualquer outro vira "falha ao
 * executar", e `2026-02-30` é justamente o erro que o modelo sabe consertar.
 */
function prazoDoDia(dia: string, fuso: string): Date {
  try {
    return new Date(diaParaPrazo(dia, fuso));
  } catch (erro) {
    throw new AppError(422, "VALIDATION_ERROR", erro instanceof Error ? erro.message : dia);
  }
}

const EXECUTORES: Record<NomeDoAssistente, Executor | undefined> = {
  search_notes: async (argumentos, { userId }) => {
    const { q, limit } = conferir(FERRAMENTAS_DO_ACERVO.search_notes.entrada, argumentos);
    const dados = await search.buscar(userId, q, limit);
    return {
      texto: formatarBusca(dados, q),
      fontes: dados.results.map((r) => ({
        tipo: r.type === "card" ? ("card" as const) : ("note" as const),
        id: r.id,
        titulo: r.title,
      })),
      criados: [],
    };
  },

  get_note: async (argumentos, { userId, fuso }) => {
    const { id } = conferir(FERRAMENTAS_DO_ACERVO.get_note.entrada, argumentos);
    const nota = await notes.buscarPorId(userId, id);
    return {
      texto: formatarNota(nota, fuso),
      fontes: [{ tipo: "note", id: nota.id, titulo: nota.title }],
      criados: [],
    };
  },

  list_boards: async (argumentos, { userId }) => {
    const { workspaceId } = conferir(FERRAMENTAS_DO_ACERVO.list_boards.entrada, argumentos);
    const boards = await kanban.listarBoards(userId, workspaceId);
    return {
      texto: formatarListaDeQuadros(boards),
      fontes: boards.map((b) => ({ tipo: "board" as const, id: b.id, titulo: b.name })),
      criados: [],
    };
  },

  get_board: async (argumentos, { userId, fuso }) => {
    const { id } = conferir(FERRAMENTAS_DO_ACERVO.get_board.entrada, argumentos);
    const board = await kanban.buscarBoard(userId, id);
    return {
      texto: formatarQuadro(board, fuso),
      fontes: [{ tipo: "board", id: board.id, titulo: board.name }],
      criados: [],
    };
  },

  get_dashboard: async (argumentos, { userId, fuso }) => {
    const { workspaceId } = conferir(FERRAMENTAS_DO_ACERVO.get_dashboard.entrada, argumentos);
    const dados = await dashboard.montar(userId, workspaceId);
    return {
      texto: formatarDashboard(dados, fuso),
      /// O painel agrega vários quadros e não é um recurso abrível: citar
      /// "o painel" não leva a lugar nenhum. As notas dele, sim.
      fontes: dados.notas.map((n) => ({ tipo: "note" as const, id: n.id, titulo: n.title })),
      criados: [],
    };
  },

  create_card: async (argumentos, { userId, fuso, origem }) => {
    const entrada = conferir(FERRAMENTAS_DO_ACERVO.create_card.entrada, argumentos);
    const card = await kanban.criarCard(
      userId,
      {
        columnId: entrada.columnId,
        title: entrada.title,
        ...(entrada.descriptionMd !== undefined && { descriptionMd: entrada.descriptionMd }),
        ...(entrada.dueDate !== undefined && { dueDate: prazoDoDia(entrada.dueDate, fuso) }),
        ...(entrada.priority !== undefined && { priority: entrada.priority }),
        ...(entrada.tags !== undefined && { tags: entrada.tags }),
        ...(entrada.noteId !== undefined && { noteId: entrada.noteId }),
      },
      origem,
    );
    const criado = { tipo: "card" as const, id: card.id, titulo: card.title };
    return { texto: formatarCardDetalhe(card, fuso), fontes: [], criados: [criado] };
  },

  create_note: async (argumentos, { userId, origem }) => {
    const entrada = conferir(FERRAMENTAS_DO_ACERVO.create_note.entrada, argumentos);
    const nota = await notes.criar(
      userId,
      {
        title: entrada.title,
        contentMd: entrada.contentMd,
        ...(entrada.kind !== undefined && { kind: entrada.kind }),
        ...(entrada.workspaceId !== undefined && { workspaceId: entrada.workspaceId }),
        ...(entrada.tags !== undefined && { tags: entrada.tags }),
      },
      origem,
    );
    const criado = { tipo: "note" as const, id: nota.id, titulo: nota.title };
    return { texto: formatarNotaBreve(nota), fontes: [], criados: [criado] };
  },

  /// Não entra em `criados`: não há nada novo a mostrar nem a desfazer pelo
  /// chat — reabrir é a mesma ação com `completed: false`.
  complete_card: async (argumentos, { userId, fuso, origem }) => {
    const entrada = conferir(FERRAMENTAS_DO_ACERVO.complete_card.entrada, argumentos);
    const card = await kanban.concluirCard(
      userId,
      entrada.cardId,
      entrada.completed ?? true,
      origem,
    );
    return { texto: formatarCardDetalhe(card, fuso), fontes: [], criados: [] };
  },

  move_card: undefined,
  trash_note: undefined,
  restore_note: undefined,

  /// A URL vem do modelo: `abrirPagina` sai só por `pedirPublico` (INV-08).
  /// Página que não abriu **não** lança — volta como texto, e sem fonte: não
  /// se cita o que não foi lido. Página que respondeu, mesmo 404, é fonte: é
  /// dela que vem o status que a resposta relata.
  open_page: async (argumentos) => {
    const { url } = conferir(FERRAMENTAS_DA_WEB.open_page.entrada, argumentos);
    const pagina = await abrirPagina(url);
    const titulo = pagina.ok ? (pagina.titulo ?? tituloDoEndereco(pagina.urlFinal)) : "";
    const fontes: Fonte[] = pagina.ok ? [{ tipo: "web", url: pagina.urlFinal, titulo }] : [];
    return { texto: paginaComoTexto(pagina, url), fontes, criados: [] };
  },
};

/** A fonte na forma do contrato do chat (`ChatSource`). */
export function paraFonteDoChat(fonte: Fonte): ChatSource {
  return fonte.tipo === "web"
    ? { kind: "web", url: fonte.url, title: fonte.titulo }
    : { kind: fonte.tipo, id: fonte.id, title: fonte.titulo };
}

/** O nome do site, para a fonte web que não trouxe título. */
export function tituloDoEndereco(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A forma que o provedor espera no campo `tools` da requisição. */
export interface FerramentaParaProvedor {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/**
 * O catálogo oferecido ao modelo — **só o que tem executor**.
 *
 * A fonte da lista é `FERRAMENTAS_DO_CHAT` — as leituras mais `create_card` e
 * `create_note` —, e o `EXECUTORES[nome]` é conferido de novo aqui de
 * propósito: são duas condições para uma ação de escrita aparecer, e as duas
 * teriam que falhar juntas. Mover card e mandar nota para a lixeira falham nas
 * duas.
 *
 * O JSON Schema sai do mesmo `ZodRawShape` que o SDK do MCP converte para
 * publicar `tools/list`, pela mesma biblioteca — as duas superfícies descrevem
 * as ações pelo mesmo código, não por duas traduções parecidas.
 */
export function catalogoParaProvedor(
  permitidas: readonly NomeDoAssistente[],
): FerramentaParaProvedor[] {
  /// A lista do chat continua sendo a fonte: `permitidas` só estreita. Um nome
  /// fora dela, vindo de um agente gravado antes de a lista mudar, não entra.
  return FERRAMENTAS_DO_CHAT.filter((nome) => permitidas.includes(nome) && EXECUTORES[nome]).map(
    (nome) => {
      const definicao = DEFINICOES_DO_ASSISTENTE[nome];
      return {
        type: "function",
        function: {
          name: nome,
          description: definicao.descricao,
          parameters: zodToJsonSchema(z.object(definicao.entrada), { target: "openApi3" }),
        },
      };
    },
  );
}

/**
 * Executa o que o modelo pediu.
 *
 * Nome desconhecido, nome fora de `FERRAMENTAS_DO_CHAT`, nome fora da lista do
 * agente e nome sem executor caem no **mesmo** ramo, e de propósito: os quatro
 * são "esta ação não existe para você". Distinguir diria ao modelo que a ação
 * existe e está trancada, que é um convite a insistir.
 *
 * A lista é conferida aqui, e não só em `catalogoParaProvedor`: o catálogo diz
 * o que se **oferece**, esta checagem diz o que se **executa**. Sem ela, um
 * executor escrito amanhã para outra ação — um `move_card` para outra
 * superfície — ficaria executável pelo chat a quem adivinhasse o nome.
 */
export async function executar(
  nome: string,
  argumentos: unknown,
  contexto: ContextoDeFerramenta,
): Promise<ResultadoDeFerramenta> {
  const permitida =
    FERRAMENTAS_DO_CHAT.includes(nome as NomeDoAssistente) &&
    contexto.permitidas.includes(nome as NomeDoAssistente);
  const executor = permitida ? EXECUTORES[nome as NomeDoAssistente] : undefined;
  if (!executor) {
    throw new AppError(422, "VALIDATION_ERROR", `Ferramenta desconhecida: ${nome}`);
  }
  return executor(argumentos, contexto);
}
