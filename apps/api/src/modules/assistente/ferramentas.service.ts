import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  FERRAMENTAS_DE_LEITURA,
  FERRAMENTAS_DO_ACERVO,
  formatarBusca,
  formatarDashboard,
  formatarListaDeQuadros,
  formatarNota,
  formatarQuadro,
} from "@yu-book/shared";
import type { NomeDeFerramenta } from "@yu-book/shared";
import { AppError } from "../../lib/errors.js";
import * as dashboard from "../dashboard/dashboard.service.js";
import * as kanban from "../kanban/kanban.service.js";
import * as notes from "../notes/notes.service.js";
import * as search from "../notes/search.service.js";

/**
 * O outro consumidor do vocabulário do acervo (Etapa B da frente de IA).
 *
 * O servidor MCP publica estas mesmas ações e as resolve por HTTP contra esta
 * API; aqui elas chamam os services **direto**. O metadado é o mesmo objeto de
 * `packages/shared`, e a saída passa pelos mesmos formatadores — é o que faz o
 * CA-11 (o texto de uma nota pelo chat é idêntico ao de `yubook://nota/{id}`)
 * valer por construção, e não por alguém lembrar de conferir.
 *
 * **O laço nasce só com leitura.** As quatro ações de escrita existem no
 * catálogo com `escrita: true` e **nenhum executor aqui** — a Etapa C é que
 * decide faixas de risco e registro. Um executor a mais neste mapa é a
 * diferença entre um chat que lê e um que apaga nota.
 */

export interface Fonte {
  tipo: "note" | "card" | "board";
  id: string;
  titulo: string;
}

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
}

export interface ContextoDeFerramenta {
  userId: string;
  /// O fuso do usuário, de `ai_preference`. Os formatadores o exigem, e não há
  /// valor padrão: cair no fuso do processo é o defeito que o MCP hospedado
  /// teve por semanas, relatando todo prazo um dia à frente.
  fuso: string;
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

const EXECUTORES: Record<NomeDeFerramenta, Executor | undefined> = {
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
    };
  },

  get_note: async (argumentos, { userId }) => {
    const { id } = conferir(FERRAMENTAS_DO_ACERVO.get_note.entrada, argumentos);
    const nota = await notes.buscarPorId(userId, id);
    return {
      texto: formatarNota(nota),
      fontes: [{ tipo: "note", id: nota.id, titulo: nota.title }],
    };
  },

  list_boards: async (argumentos, { userId }) => {
    const { workspaceId } = conferir(FERRAMENTAS_DO_ACERVO.list_boards.entrada, argumentos);
    const boards = await kanban.listarBoards(userId, workspaceId);
    return {
      texto: formatarListaDeQuadros(boards),
      fontes: boards.map((b) => ({ tipo: "board" as const, id: b.id, titulo: b.name })),
    };
  },

  get_board: async (argumentos, { userId, fuso }) => {
    const { id } = conferir(FERRAMENTAS_DO_ACERVO.get_board.entrada, argumentos);
    const board = await kanban.buscarBoard(userId, id);
    return {
      texto: formatarQuadro(board, fuso),
      fontes: [{ tipo: "board", id: board.id, titulo: board.name }],
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
    };
  },

  create_card: undefined,
  move_card: undefined,
  trash_note: undefined,
  restore_note: undefined,
};

/** A forma que o provedor espera no campo `tools` da requisição. */
export interface FerramentaParaProvedor {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/**
 * O catálogo oferecido ao modelo — **só o que tem executor**.
 *
 * A fonte da lista é `FERRAMENTAS_DE_LEITURA`, e o `EXECUTORES[nome]` é
 * conferido de novo aqui de propósito: são duas condições para uma ação de
 * escrita aparecer, e as duas teriam que falhar juntas.
 *
 * O JSON Schema sai do mesmo `ZodRawShape` que o SDK do MCP converte para
 * publicar `tools/list`, pela mesma biblioteca — as duas superfícies descrevem
 * as nove ações pelo mesmo código, não por duas traduções parecidas.
 */
export function catalogoParaProvedor(): FerramentaParaProvedor[] {
  return FERRAMENTAS_DE_LEITURA.filter((nome) => EXECUTORES[nome]).map((nome) => {
    const definicao = FERRAMENTAS_DO_ACERVO[nome];
    return {
      type: "function",
      function: {
        name: nome,
        description: definicao.descricao,
        parameters: zodToJsonSchema(z.object(definicao.entrada), { target: "openApi3" }),
      },
    };
  });
}

/**
 * Executa o que o modelo pediu.
 *
 * Nome desconhecido e nome de escrita caem no **mesmo** ramo, e de propósito:
 * os dois são "esta ação não existe para você". Distinguir diria ao modelo que
 * a ação existe e está trancada, que é um convite a insistir.
 */
export async function executar(
  nome: string,
  argumentos: unknown,
  contexto: ContextoDeFerramenta,
): Promise<ResultadoDeFerramenta> {
  const executor = EXECUTORES[nome as NomeDeFerramenta];
  if (!executor) {
    throw new AppError(422, "VALIDATION_ERROR", `Ferramenta desconhecida: ${nome}`);
  }
  return executor(argumentos, contexto);
}
