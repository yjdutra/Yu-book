import {
  MAX_INSTRUCAO_DO_PASSO,
  MAX_PASSOS_DA_ROTINA,
  TETO_POR_EXECUCAO_MAXIMO_MICROS,
  TETO_POR_EXECUCAO_PADRAO_MICROS,
  problemasDeForma,
} from "@yu-book/shared";
import type {
  AgentColor,
  RoutineConsumeAction,
  RoutineDetail,
  RoutineInput,
  RoutineOutputTitle,
  RoutineStepMode,
} from "@yu-book/shared";

/**
 * O rascunho do editor de rotinas e as regras que o cliente confere antes do
 * servidor. As que cruzam campo — pelo menos um "reescreve", a coluna das
 * ideias usadas — vêm de `problemasDeForma`, a mesma função que o servidor
 * aplica: duas cópias da regra divergiriam.
 */

export interface PassoRascunho {
  /// Chave local: o passo recém-inserido ainda não tem id nenhum, e a posição
  /// muda a cada arraste.
  chave: string;
  agentId: string | null;
  /// O nome e a cor à vista, para o bloco se desenhar antes da lista de
  /// agentes chegar — e para o agente excluído continuar com nome.
  agentName: string;
  agentColor: AgentColor | null;
  mode: RoutineStepMode;
  instruction: string;
  /// O agente que o modelo pronto pede e que não foi achado entre os seus —
  /// pela `chave` de `MODELOS_DE_AGENTE`. Só da tela: não vai ao servidor.
  sugestao?: { chave: string; nome: string };
}

export interface Rascunho {
  name: string;
  description: string;
  inputBoardId: string;
  inputColumnId: string;
  /// Só da tela: o servidor guarda a coluna, e o quadro vem resolvido nela.
  outputBoardId: string;
  outputColumnId: string;
  outputTitle: RoutineOutputTitle;
  includeNotes: boolean;
  consumeAction: RoutineConsumeAction;
  consumeColumnId: string | null;
  runCapMicros: number;
  passos: PassoRascunho[];
}

export type BlocoEscolhido =
  | { tipo: "entrada" }
  | { tipo: "passo"; chave: string }
  | { tipo: "saida" };

let proxima = 0;
export const novaChave = () => `p${++proxima}`;

export function passoVazio(mode: RoutineStepMode = "reescreve"): PassoRascunho {
  return {
    chave: novaChave(),
    agentId: null,
    agentName: "",
    agentColor: null,
    mode,
    instruction: "",
  };
}

export function rascunhoVazio(): Rascunho {
  return {
    name: "",
    description: "",
    inputBoardId: "",
    inputColumnId: "",
    outputBoardId: "",
    outputColumnId: "",
    outputTitle: "ideia",
    includeNotes: true,
    consumeAction: "mover",
    consumeColumnId: null,
    runCapMicros: TETO_POR_EXECUCAO_PADRAO_MICROS,
    passos: [passoVazio()],
  };
}

export function doDetalhe(d: RoutineDetail): Rascunho {
  return {
    name: d.name,
    description: d.description,
    inputBoardId: d.input.boardId ?? "",
    inputColumnId: d.input.columnId,
    outputBoardId: d.output.boardId ?? "",
    outputColumnId: d.output.columnId,
    outputTitle: d.outputTitle,
    includeNotes: d.includeNotes,
    consumeAction: d.consumeAction,
    consumeColumnId: d.consume?.columnId ?? null,
    runCapMicros: d.runCapMicros,
    passos: d.steps.map((s) => ({
      chave: novaChave(),
      agentId: s.agentId,
      agentName: s.agentName,
      agentColor: s.agentColor,
      mode: s.mode,
      instruction: s.instruction,
    })),
  };
}

/** O corpo de `POST`/`PATCH`. Só vai ao servidor sem problemas do cliente. */
export function paraEntrada(r: Rascunho): RoutineInput {
  return {
    name: r.name.trim(),
    description: r.description.trim(),
    inputBoardId: r.inputBoardId,
    inputColumnId: r.inputColumnId,
    outputColumnId: r.outputColumnId,
    outputTitle: r.outputTitle,
    includeNotes: r.includeNotes,
    consumeAction: r.consumeAction,
    // Com as outras ações o servidor grava `null`; mandar a coluna velha só
    // sujaria a comparação.
    consumeColumnId: r.consumeAction === "mover" ? r.consumeColumnId : null,
    runCapMicros: r.runCapMicros,
    steps: r.passos.map((p) => ({
      agentId: p.agentId ?? "",
      mode: p.mode,
      instruction: p.instruction.trim(),
    })),
  };
}

/** O que decide "há alterações". O quadro de saída sem coluna já muda a coluna. */
export function assinatura(r: Rascunho): string {
  return JSON.stringify(paraEntrada(r));
}

export interface Problema {
  bloco: "entrada" | "passo" | "saida";
  /// Só em passo: qual. Sem chave, o problema é dos passos em conjunto.
  chave: string | null;
  mensagem: string;
}

/**
 * Os problemas que o cliente vê sozinho, apontados no bloco que os tem.
 * `agentes` é o conjunto de ids que existem — `null` enquanto a lista não
 * chegou, e aí o agente excluído não é acusado ainda.
 */
export function problemasDoRascunho(r: Rascunho, agentes: Set<string> | null): Problema[] {
  const lista: Problema[] = [];
  if (!r.inputColumnId) {
    lista.push({
      bloco: "entrada",
      chave: null,
      mensagem: "Escolha a coluna de onde saem as ideias",
    });
  }
  for (const p of r.passos) {
    if (!p.agentId) {
      lista.push({
        bloco: "passo",
        chave: p.chave,
        mensagem: p.sugestao
          ? `Crie ou escolha o agente «${p.sugestao.nome}»`
          : p.agentName
            ? `O agente «${p.agentName}» foi excluído — escolha outro`
            : "Escolha o agente deste passo",
      });
    } else if (agentes && !agentes.has(p.agentId)) {
      lista.push({
        bloco: "passo",
        chave: p.chave,
        mensagem: `O agente «${p.agentName}» foi excluído — escolha outro`,
      });
    }
    if (p.instruction.length > MAX_INSTRUCAO_DO_PASSO) {
      lista.push({
        bloco: "passo",
        chave: p.chave,
        mensagem: `Instrução acima de ${MAX_INSTRUCAO_DO_PASSO} caracteres`,
      });
    }
  }
  if (r.passos.length > MAX_PASSOS_DA_ROTINA) {
    lista.push({
      bloco: "passo",
      chave: null,
      mensagem: `No máximo ${MAX_PASSOS_DA_ROTINA} passos`,
    });
  }
  if (!r.outputColumnId) {
    lista.push({ bloco: "saida", chave: null, mensagem: "Escolha a coluna onde o card nasce" });
  }
  if (r.runCapMicros <= 0 || r.runCapMicros > TETO_POR_EXECUCAO_MAXIMO_MICROS) {
    lista.push({
      bloco: "saida",
      chave: null,
      mensagem: "O teto por execução precisa ficar entre US$ 0,01 e US$ 10",
    });
  }
  for (const f of problemasDeForma({
    steps: r.passos,
    consumeAction: r.consumeAction,
    consumeColumnId: r.consumeColumnId,
    inputColumnId: r.inputColumnId,
  })) {
    lista.push({
      bloco: f.path === "steps" ? "passo" : "saida",
      chave: null,
      mensagem: f.message,
    });
  }
  return lista;
}

/**
 * Os problemas que só o servidor vê (coluna excluída, agente que sumiu entre
 * uma leitura e outra), convertidos para o bloco do rascunho. Valem só com o
 * rascunho igual ao que está salvo: depois de uma edição, podem já não valer.
 */
export function problemasDoServidor(d: RoutineDetail, r: Rascunho): Problema[] {
  return d.problems.map((p) => ({
    bloco: p.block,
    chave:
      p.block === "passo" && p.position !== null ? (r.passos[p.position]?.chave ?? null) : null,
    mensagem: p.message,
  }));
}
