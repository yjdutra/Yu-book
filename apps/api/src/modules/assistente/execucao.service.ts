import { Prisma } from "@prisma/client";
import {
  MAX_CARD_DESCRICAO,
  MAX_CARD_TITULO,
  MAX_CONTEUDO,
  MAX_PASSOS_DO_LACO,
  MAX_TITULO,
  primeiraLinha,
  resumoDoPedido,
} from "@yu-book/shared";
import type {
  AiFavorite,
  RotinaEvent,
  RoutineRunDetail,
  RoutineRunStatus,
  RoutineConsumeAction,
  RoutineInputKind,
  RoutineOutputTitle,
  RoutineRunStarted,
  RoutineStepMode,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import type { OrigemIA } from "../../lib/marca.js";
import * as kanban from "../kanban/kanban.service.js";
import * as notas from "../notes/notes.service.js";
import * as agentes from "./agentes.service.js";
import { estimarCustoMicros, garantirTeto, MAX_SAIDA_TOKENS } from "./custo.service.js";
import * as ferramentas from "./ferramentas.service.js";
import {
  motivoDaFalha,
  paraToolCalls,
  passoNoProvedor,
  saidaDisponivel,
} from "./passo.service.js";
import type { MensagemDoProvedor, ResultadoDoPasso } from "./passo.service.js";
import { modeloParaTarefa, modeloPorId, preferenciaDe } from "./preferencias.service.js";
import type { PreferenciaDeIa } from "./preferencias.service.js";
import {
  CAMPOS_DO_PASSO_EXECUTADO,
  CAMPOS_DO_RUN,
  detalheDoRun,
  entradaPorColuna,
  ferramentasDaRotina,
  linhaDaRotina,
  ondeElegivel,
  paraPassoExecutado,
  paraRun,
  problemasDaRotina,
} from "./rotinas.service.js";

/**
 * O motor das rotinas — Etapa E da frente de IA.
 *
 * **Trabalho assíncrono dentro do processo da API, por decisão** (registrada
 * em `docs/historico.md`, e que revoga a de "sem trabalho assíncrono" do PRD
 * de IA). `iniciar` responde 202 na hora e a execução segue destacada da
 * requisição; a tela acompanha por SSE e pode fechar e voltar. O que isso
 * custa, e o que cada custo exige deste arquivo:
 *
 * - **O `Map` é de um processo só, e o deploy junta dois.** As execuções vivas
 *   moram num `Map` em memória (`vivas`), como as sessões do servidor MCP
 *   (`apps/mcp/src/http.ts`). A Railway sobe a instância nova **antes** do
 *   SIGTERM na antiga, e por essa janela as duas convivem sem se enxergar.
 *   Por isso nada que decide sobre uma execução pergunta ao `Map`, e sim ao
 *   banco: quem executa renova `heartbeatAt` (o **pulso**), e só a execução de
 *   pulso vencido é dada como morta (`fecharSemDono`). Toda gravação do motor
 *   é condicional a `em_andamento` — se outro processo já a encerrou, este
 *   larga a execução calado, sem sobrescrever (`perder`). O cancelamento e o
 *   SSE atravessam as instâncias pelo banco (`cancelar`, `remota`).
 * - **Execução perdida num redeploy.** No SIGTERM as vivas são abortadas e
 *   gravadas `interrompida` antes de `app.close()` (`encerrarExecucoes`); a
 *   que morrer sem SIGTERM para de pulsar, e a varredura a fecha
 *   (`reconciliarExecucoes`, no boot e a cada minuto). A ideia fica onde
 *   estava, e o próximo "Rodar agora" a pega — **salvo se a saída (card ou
 *   nota) já existir**: aí a execução termina `concluida` com aviso, nunca
 *   `falhou` (RN-16), e a ideia não volta a ser escolhida.
 *
 * **Dois tipos de entrada** (emenda da Etapa E): a ideia de uma coluna, ou o
 * pedido escrito na rotina. No pedido não há ideia a escolher nem a consumir,
 * e cada execução é independente — a idempotência pelo registro (RN-18) é só
 * da coluna; a de uma execução por conta (RN-19) vale para as duas.
 *
 * O que protege o gasto é o mesmo do chat, conferido **antes de cada chamada**
 * ao provedor (INV-47), com um corte a mais: o teto por execução.
 *
 * **A rotina só escreve pelo código, na saída.** Os passos recebem apenas as
 * ferramentas de leitura do agente (`ferramentasDaRotina`); o card ou a nota
 * de saída e a ação sobre a ideia são deste arquivo, no fim de uma execução
 * bem-sucedida.
 */

/// Quanto da descrição da ideia vai a cada passo. Ideia é uma linha ou um
/// parágrafo; um card com cem mil caracteres seria contexto de nota, não de
/// ideia, e pagaria isso em todo passo.
const LIMITE_DESCRICAO_DA_IDEIA = 8_000;

/// SSE parado por muito tempo é derrubado por proxy. Um comentário a cada
/// intervalo mantém a conexão sem virar evento para quem lê.
const INTERVALO_DO_PING_MS = 15_000;

/// Quanto o desligamento espera as execuções gravarem `interrompida`.
const ESPERA_NO_DESLIGAMENTO_MS = 5_000;

/// De quanto em quanto quem executa renova o pulso. Também é o atraso máximo
/// de um cancelamento pedido em outra instância durante uma chamada longa ao
/// provedor — entre passos e voltas ele é conferido na hora.
const INTERVALO_DO_PULSO_MS = 10_000;

/// Pulso mais velho que isto é execução sem dono. Mais de quatro pulsos: um
/// banco lento ou um GC longo não bastam para outra instância a dar por morta.
const PULSO_VENCIDO_MS = 45_000;

/// A varredura que fecha execução sem dono enquanto o processo vive — a do
/// boot não basta, porque a instância que morreu pode não ser a que sobe.
const INTERVALO_DA_VARREDURA_MS = 60_000;

/// O SSE de uma execução que roda em outra instância relê o banco neste passo.
const INTERVALO_DO_RETRATO_REMOTO_MS = 2_000;

const pulsoVencidoAntesDe = () => new Date(Date.now() - PULSO_VENCIDO_MS);

/// `null` é "acabou sem evento": a última rede do motor (o `.catch` de
/// `iniciar`) encerrou a execução sem passar pelo `fim` de `executar`.
type Assinante = (evento: RotinaEvent | null) => void;

interface Viva {
  userId: string;
  controlador: AbortController;
  /// Por que o sinal foi abortado. O status final depende disso: `cancelada`
  /// foi alguém na tela; `interrompida`, o processo saindo; `perdida`, outro
  /// processo já gravou um estado terminal — e aí este não grava nada.
  motivo: "cancelada" | "desligamento" | "perdida" | null;
  assinantes: Set<Assinante>;
  /// O texto da volta em curso do passo em curso, para quem assina no meio.
  parcial: { position: number; texto: string } | null;
  terminada: Promise<void>;
}

const vivas = new Map<string, Viva>();

/// Quem está iniciando agora, neste processo. **Não é o que garante RN-19** —
/// é o índice único parcial `ai_routine_run_uma_em_andamento_idx` (migration
/// `20260924233000_ia_etapa_e_uma_execucao`), que recusa a segunda execução
/// `em_andamento` da conta na própria escrita, inclusive vinda da instância
/// vizinha na janela de deploy (INV-04). Isto só poupa o segundo clique
/// rápido daqui de pagar as consultas de `iniciar` até esbarrar no índice.
const iniciando = new Set<string>();

/// O `P2002` do índice de RN-19. O Prisma não dá o nome de índice parcial: põe
/// em `meta.target` as colunas dele (`["user_id"]`, conferido no Prisma 6), e
/// é o único único de `ai_routine_run` só sobre `user_id`. O modelo é
/// conferido para que o `P2002` dos passos (`run_id, position`) suba como é.
function ehOutraEmAndamento(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== "P2002") {
    return false;
  }
  const alvo = erro.meta?.target;
  return (
    erro.meta?.modelName === "AiRoutineRun" &&
    Array.isArray(alvo) &&
    alvo.length === 1 &&
    alvo[0] === "user_id"
  );
}

/* ------------------------------------------------------------ pulso e dono */

/**
 * O resultado de um pulso: a execução segue (`vivo`), alguém pediu para
 * cancelar em qualquer instância (`cancelar`), ou ela já não está em andamento
 * — outro processo a encerrou — (`perdida`).
 */
type Pulso = "vivo" | "cancelar" | "perdida";

/** Renova o pulso e lê o pedido de cancelamento, numa consulta só. */
async function pulsar(runId: string): Promise<Pulso> {
  const [linha] = await prisma.aiRoutineRun.updateManyAndReturn({
    where: { id: runId, status: "em_andamento" },
    data: { heartbeatAt: new Date() },
    select: { cancelRequestedAt: true },
  });
  if (!linha) return "perdida";
  return linha.cancelRequestedAt ? "cancelar" : "vivo";
}

interface Desfecho {
  status: Extract<RoutineRunStatus, "interrompida" | "cancelada" | "falhou">;
  code: string;
  mensagem: string;
  /// Na execução por pedido não há ideia para ter ficado onde estava.
  mensagemNoPedido?: string;
}

const INTERROMPIDA: Desfecho = {
  status: "interrompida",
  code: "INTERROMPIDA",
  mensagem: "A API foi reiniciada no meio da execução. A ideia ficou onde estava.",
  mensagemNoPedido: "A API foi reiniciada no meio da execução.",
};

const CANCELADA: Desfecho = {
  status: "cancelada",
  code: "CANCELADA",
  mensagem: "Execução cancelada. A ideia ficou onde estava.",
  mensagemNoPedido: "Execução cancelada.",
};

const mensagemDo = (desfecho: Desfecho, tipo: RoutineInputKind) =>
  tipo === "pedido" ? (desfecho.mensagemNoPedido ?? desfecho.mensagem) : desfecho.mensagem;

/** A saída que a execução criou. Uma só, conforme o tipo de saída da rotina. */
type Saida = { cardId: string } | { noteId: string };

/// As colunas de `ai_routine_run` que registram a saída.
const camposDaSaida = (saida: Saida) =>
  "cardId" in saida ? { outputCardId: saida.cardId } : { outputNoteId: saida.noteId };

function finalizacaoParcial(saida: Saida, tipo: RoutineInputKind): string {
  const criada = "cardId" in saida ? "O card foi criado" : "A nota foi criada";
  return (
    `${criada}, mas a execução não terminou de ser registrada.` +
    (tipo === "coluna" ? " A ideia pode não ter sido movida nem arquivada." : "")
  );
}

/**
 * Fecha, pelo banco, execuções em andamento que ninguém vai terminar: a de
 * pulso vencido (varredura, cancelamento de órfã) e a que escapou do motor.
 *
 * **A saída decide o desfecho** (RN-16): execução que já criou o card ou a
 * nota vira `concluida` com `FINALIZACAO_PARCIAL`, qualquer que seja o motivo
 * — senão a ideia voltaria a ser elegível com o post dela já pronto. A saída é
 * achada por `outputCardId`/`outputNoteId` ou pela marca (`card.aiRunId`,
 * `note.aiRunId`), que o motor grava junto com ela: é o que cobre a morte
 * entre criar a saída e registrá-la.
 *
 * O `where` é reaplicado na escrita, com `em_andamento`: uma execução que
 * pulsou entre a leitura e a escrita não é fechada.
 */
async function fecharSemDono(
  onde: Prisma.AiRoutineRunWhereInput,
  desfecho: Desfecho,
): Promise<number> {
  const candidatas = await prisma.aiRoutineRun.findMany({
    where: { ...onde, status: "em_andamento" },
    select: {
      id: true,
      inputKind: true,
      outputCardId: true,
      outputNoteId: true,
      cards: { select: { id: true }, take: 1 },
      /// A marca não distingue nota viva de nota na lixeira: as duas foram
      /// criadas por esta execução, e é isso que decide o desfecho.
      notas: { select: { id: true }, take: 1 },
    },
  });
  let fechadas = 0;
  for (const candidata of candidatas) {
    const card = candidata.outputCardId ?? candidata.cards[0]?.id ?? null;
    const nota = candidata.outputNoteId ?? candidata.notas[0]?.id ?? null;
    const saida: Saida | null = card ? { cardId: card } : nota ? { noteId: nota } : null;
    const agora = new Date();
    const fechou = await prisma.$transaction(async (tx) => {
      const { count } = await tx.aiRoutineRun.updateMany({
        where: { ...onde, id: candidata.id, status: "em_andamento" },
        data: saida
          ? {
              status: "concluida",
              ...camposDaSaida(saida),
              errorCode: "FINALIZACAO_PARCIAL",
              errorMessage: finalizacaoParcial(saida, candidata.inputKind),
              endedAt: agora,
            }
          : {
              status: desfecho.status,
              errorCode: desfecho.code,
              errorMessage: mensagemDo(desfecho, candidata.inputKind),
              endedAt: agora,
            },
      });
      if (count === 0) return false;
      await tx.aiRoutineRunStep.updateMany({
        where: { runId: candidata.id, status: "rodando" },
        data: { status: "falhou", errorCode: desfecho.code, endedAt: agora },
      });
      await tx.aiRoutineRunStep.updateMany({
        where: { runId: candidata.id, status: "pendente" },
        data: { status: "pulado" },
      });
      return true;
    });
    if (fechou) fechadas += 1;
  }
  return fechadas;
}

/** Grava `concluida`, só se ninguém a encerrou antes. `null` quando outro encerrou. */
async function concluir(
  runId: string,
  dados: { saida: Saida; costMicros: number; aviso: { code: string; mensagem: string } | null },
) {
  const [run] = await prisma.aiRoutineRun.updateManyAndReturn({
    where: { id: runId, status: "em_andamento" },
    data: {
      status: "concluida",
      ...camposDaSaida(dados.saida),
      costMicros: dados.costMicros,
      endedAt: new Date(),
      ...(dados.aviso && { errorCode: dados.aviso.code, errorMessage: dados.aviso.mensagem }),
    },
    select: CAMPOS_DO_RUN,
  });
  return run ?? null;
}

function emitir(viva: Viva, evento: RotinaEvent): void {
  for (const assinante of viva.assinantes) {
    try {
      assinante(evento);
    } catch {
      /// Um assinante com defeito não derruba a execução nem os outros.
    }
  }
}

/* ----------------------------------------------------------------- início */

interface PassoDoPlano {
  position: number;
  agentId: string;
  mode: RoutineStepMode;
  instruction: string;
}

/**
 * O que a execução precisa da rotina, copiado no início. Editar ou excluir a
 * rotina com a execução em curso não muda o que ela faz.
 */
interface Plano {
  runId: string;
  userId: string;
  routineName: string;
  /// A ideia é relida no início de `executar`; o pedido é copiado aqui.
  entrada: { tipo: "ideia"; ideiaId: string } | { tipo: "pedido"; texto: string };
  saida: { tipo: "card"; columnId: string } | { tipo: "nota"; workspaceId: string | null };
  outputTitle: RoutineOutputTitle;
  outputTitleText: string | null;
  includeNotes: boolean;
  consumeAction: RoutineConsumeAction;
  consumeColumnId: string | null;
  runCapMicros: number;
  passos: PassoDoPlano[];
}

export interface Registro {
  error: (dados: object, mensagem: string) => void;
}

async function modeloDoAgente(
  userId: string,
  agente: { name: string; modelId: string | null },
): Promise<AiFavorite> {
  return agente.modelId
    ? modeloPorId(userId, agente.modelId, { agente: agente.name })
    : modeloParaTarefa(userId, "chat");
}

/**
 * "Rodar agora". Tudo o que pode ser recusado é recusado **aqui**, com status
 * HTTP e código estável; depois do 202 não há mais status, e a falha vira
 * registro na execução e evento no SSE.
 */
export async function iniciar(
  userId: string,
  routineId: string,
  registro: Registro,
): Promise<RoutineRunStarted> {
  const rotina = await linhaDaRotina(userId, routineId);

  const problemas = await problemasDaRotina(userId, rotina);
  if (problemas[0]) {
    throw new AppError(
      422,
      "ROTINA_INVALIDA",
      problemas.length > 1
        ? `${problemas[0].message} (e mais ${problemas.length - 1} problema(s) no editor)`
        : problemas[0].message,
    );
  }

  const emAndamento = () =>
    new AppError(
      409,
      "ROTINA_EM_ANDAMENTO",
      "Já há uma rotina rodando. Espere ela terminar ou cancele-a antes de rodar outra.",
    );
  if (iniciando.has(userId)) throw emAndamento();
  iniciando.add(userId);

  try {
    /// RN-19 pelo banco, porque o `Map` não vê a outra instância. Primeiro se
    /// fecha a execução desta conta que ninguém pulsa mais; o que sobra
    /// `em_andamento` tem dono vivo, aqui ou na instância vizinha — e a ideia
    /// da que foi fechada volta a ser elegível já nesta consulta. A consulta
    /// é o caminho comum e barato; a garantia é o índice, na criação abaixo.
    await fecharSemDono(
      { userId, heartbeatAt: { lt: pulsoVencidoAntesDe() }, id: { notIn: [...vivas.keys()] } },
      INTERROMPIDA,
    );
    const ativa = await prisma.aiRoutineRun.findFirst({
      where: { userId, status: "em_andamento" },
      select: { id: true },
    });
    if (ativa) throw emAndamento();

    /// O teto diário antes de criar qualquer coisa: é o 402 de quem já
    /// estourou antes de clicar. A estimativa é a saída máxima do primeiro
    /// passo — sem o contexto, que só se monta ao rodar; o corte de verdade é
    /// o de cada chamada, dentro de `passoNoProvedor`.
    const preferencia = await preferenciaDe(userId);
    const primeiro = rotina.steps[0]?.agent;
    if (primeiro) {
      const modelo = await modeloDoAgente(userId, primeiro);
      await garantirTeto(userId, preferencia, estimarCustoMicros(modelo, 0, MAX_SAIDA_TOKENS));
    }

    /// `problemasDaRotina` já recusou a rotina sem coluna, sem pedido ou sem
    /// coluna de saída; as guardas abaixo são para o compilador.
    const invalida = () =>
      new AppError(422, "ROTINA_INVALIDA", "A rotina está incompleta. Abra o editor.");
    let entrada: Plano["entrada"];
    let inputCardId: string | null = null;
    let inputTitle: string | null;
    if (rotina.inputKind === "coluna") {
      const porColuna = entradaPorColuna(rotina);
      if (!porColuna) throw invalida();
      const ideia = await prisma.card.findFirst({
        where: ondeElegivel(userId, porColuna),
        orderBy: { position: "asc" },
        select: { id: true, title: true },
      });
      if (!ideia) {
        throw new AppError(
          404,
          "SEM_IDEIA",
          "Nenhuma ideia para usar: a coluna de entrada está vazia, ou todas as ideias dela já " +
            "passaram por esta rotina.",
        );
      }
      entrada = { tipo: "ideia", ideiaId: ideia.id };
      inputCardId = ideia.id;
      inputTitle = ideia.title;
    } else {
      /// Sem ideia a escolher: cada execução é independente, e rodar de novo
      /// cumpre o mesmo pedido outra vez.
      const texto = rotina.inputPrompt?.trim() ?? "";
      if (!texto) throw invalida();
      entrada = { tipo: "pedido", texto };
      inputTitle = resumoDoPedido(texto) || null;
    }

    let saida: Plano["saida"];
    if (rotina.outputKind === "card") {
      if (!rotina.outputColumnId) throw invalida();
      saida = { tipo: "card", columnId: rotina.outputColumnId };
    } else {
      saida = { tipo: "nota", workspaceId: rotina.outputWorkspaceId };
    }

    /// Dois `iniciar` que passaram juntos pela consulta de cima — um em cada
    /// instância — escolheram a mesma ideia; o índice deixa só um criar, e o
    /// outro recebe o mesmo 409, sem saída nem passo gravado (RN-18). No
    /// pedido o índice é o mesmo, e a regra é só a de RN-19.
    const run = await prisma.$transaction(async (tx) => {
      const criado = await tx.aiRoutineRun.create({
        data: {
          userId,
          routineId: rotina.id,
          routineName: rotina.name,
          inputKind: rotina.inputKind,
          inputCardId,
          inputTitle,
          runCapMicros: rotina.runCapMicros,
          heartbeatAt: new Date(),
        },
        select: { id: true },
      });
      await tx.aiRoutineRunStep.createMany({
        data: rotina.steps.map((passo, position) => ({
          runId: criado.id,
          position,
          agentName: passo.agent?.name ?? passo.agentName,
          mode: passo.mode,
          instruction: passo.instruction,
        })),
      });
      return criado;
    }).catch((erro: unknown) => {
      if (ehOutraEmAndamento(erro)) throw emAndamento();
      throw erro;
    });

    const plano: Plano = {
      runId: run.id,
      userId,
      routineName: rotina.name,
      entrada,
      saida,
      outputTitle: rotina.outputTitle,
      outputTitleText: rotina.outputTitleText,
      includeNotes: rotina.includeNotes,
      consumeAction: rotina.consumeAction,
      consumeColumnId: rotina.consumeColumnId,
      runCapMicros: rotina.runCapMicros,
      passos: rotina.steps.map((passo, position) => ({
        position,
        /// `problemasDaRotina` já recusou passo sem agente.
        agentId: passo.agentId ?? "",
        mode: passo.mode,
        instruction: passo.instruction,
      })),
    };

    const viva: Viva = {
      userId,
      controlador: new AbortController(),
      motivo: null,
      assinantes: new Set(),
      parcial: null,
      terminada: Promise.resolve(),
    };
    vivas.set(run.id, viva);

    /// Destacada da requisição **de propósito**: é a decisão da etapa. O
    /// `catch` é a última rede — `executar` já grava a própria falha, e isto
    /// só pega o que escapar dela (o banco fora do ar no meio do registro).
    /// Passa por `fecharSemDono` para que uma saída já criada ainda dê
    /// `concluida` (RN-16); o que nem isso gravar, a varredura fecha quando o
    /// pulso vencer.
    viva.terminada = executar(plano, viva, preferencia)
      .catch(async (erro: unknown) => {
        registro.error({ err: erro, runId: run.id }, "execução de rotina escapou do motor");
        await fecharSemDono(
          { id: run.id },
          {
            status: "falhou",
            code: "INTERNAL_ERROR",
            mensagem: "Falha inesperada no motor de rotinas.",
          },
        ).catch(() => undefined);
      })
      .finally(() => {
        vivas.delete(run.id);
        for (const assinante of viva.assinantes) assinante(null);
        viva.assinantes.clear();
      });

    return { runId: run.id };
  } finally {
    iniciando.delete(userId);
  }
}

/* --------------------------------------------------------------- execução */

/// O que o passo recebe como ponto de partida. O pedido não tem limite próprio
/// aqui: o schema já o corta em `MAX_PEDIDO_DA_ROTINA`.
type EntradaDoPasso =
  | { tipo: "ideia"; title: string; descriptionMd: string }
  | { tipo: "pedido"; texto: string };

function secaoDaEntrada(entrada: EntradaDoPasso): string[] {
  if (entrada.tipo === "pedido") return ["## Pedido", "", entrada.texto];
  const descricao = entrada.descriptionMd.trim();
  const corpoDaIdeia = !descricao
    ? "_(sem descrição)_"
    : descricao.length > LIMITE_DESCRICAO_DA_IDEIA
      ? `${descricao.slice(0, LIMITE_DESCRICAO_DA_IDEIA)}\n\n_(descrição cortada aqui)_`
      : descricao;
  return ["## Ideia", "", `**${entrada.title}**`, "", corpoDaIdeia];
}

function pedidoDoPasso(dados: {
  rotina: string;
  indice: number;
  total: number;
  entrada: EntradaDoPasso;
  saida: "card" | "nota";
  rascunho: string;
  observacoes: { agentName: string; texto: string }[];
  mode: RoutineStepMode;
  instruction: string;
}): string {
  const semRascunho = !dados.rascunho.trim();
  const partes = [
    `Você está no passo ${dados.indice + 1} de ${dados.total} da rotina «${dados.rotina}». ` +
      "Ninguém vai responder perguntas durante a rotina: decida sozinho, e use as ferramentas " +
      "de leitura se precisar do acervo.",
    "",
    ...secaoDaEntrada(dados.entrada),
    "",
    "## Rascunho atual",
    "",
    dados.rascunho.trim() || "_(ainda não há rascunho — você escreve o primeiro)_",
  ];

  if (dados.observacoes.length) {
    partes.push("", "## Observações dos passos anteriores", "");
    for (const o of dados.observacoes) partes.push(`**«${o.agentName}»:**`, "", o.texto.trim(), "");
  }

  partes.push(
    "",
    "## Sua tarefa neste passo",
    "",
    dados.instruction.trim() ||
      (dados.mode === "revisa"
        ? "Revise o rascunho."
        : dados.entrada.tipo === "pedido" && semRascunho
          ? "Cumpra o pedido."
          : "Melhore o rascunho."),
    "",
    dados.mode === "reescreve"
      ? "Responda **só** com o texto completo do novo rascunho, pronto para usar: sem " +
          "preâmbulo, sem comentário depois, sem cercar em bloco de código. O que você " +
          "escrever substitui o rascunho inteiro."
      : "**Não reescreva o rascunho.** Responda só com as suas observações sobre ele, em " +
          "lista. Elas seguem para os próximos passos e vão para a seção Observações " +
          (dados.saida === "card" ? "do card." : "da nota."),
  );
  return partes.join("\n");
}

function cortar(texto: string, limite: number): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`;
}

/**
 * O título da saída. `ideia` só existe na entrada por coluna (o schema recusa
 * no pedido); cada modo cai no seguinte quando não dá texto, e o nome da
 * rotina é o último recurso — rascunho sem linha de texto não pode deixar a
 * saída sem título.
 */
function tituloDaSaida(
  plano: Pick<Plano, "outputTitle" | "outputTitleText" | "routineName">,
  rascunho: string,
  tituloDaIdeia: string | null,
): string {
  const fixo = plano.outputTitle === "fixo" ? plano.outputTitleText?.trim() : "";
  const linha = plano.outputTitle === "primeira_linha" ? primeiraLinha(rascunho) : "";
  return fixo || linha || tituloDaIdeia || primeiraLinha(rascunho) || plano.routineName;
}

/// `25/09/2026 14:03` no fuso do usuário — o de `/ajustes`, não o do processo
/// (a API roda em UTC).
function diaEHoraLocal(instante: Date, fuso: string): string {
  const partes = new Map(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  return (
    `${partes.get("day")}/${partes.get("month")}/${partes.get("year")} ` +
    `${partes.get("hour")}:${partes.get("minute")}`
  );
}

/**
 * Os títulos que a nota de saída tenta, em ordem. Título de nota é único por
 * conta (INV-16), e uma rotina com título fixo — ou a mesma primeira linha —
 * colide a partir da segunda execução: a segunda tentativa ganha dia e hora, e
 * a terceira, para duas execuções no mesmo minuto, o começo do id da execução.
 */
function titulosDaNota(base: string, fuso: string, runId: string): string[] {
  const quando = diaEHoraLocal(new Date(), fuso);
  const curto = runId.slice(0, 6);
  return [
    cortar(base, MAX_TITULO),
    `${cortar(base, MAX_TITULO - quando.length - 3)} · ${quando}`,
    `${cortar(base, MAX_TITULO - quando.length - curto.length - 6)} · ${quando} · ${curto}`,
  ];
}

/**
 * Cria a nota de saída pelo service de notas — posse do workspace (INV-59),
 * wikilinks e marca vêm de lá. `conferir` roda imediatamente antes de **cada**
 * tentativa, sem `await` entre ele e a criação (INV-60): a tentativa que
 * colidiu não criou nada, e cancelar até a próxima ainda deixa tudo intacto.
 */
async function criarNotaDeSaida(
  userId: string,
  dados: { titulos: string[]; contentMd: string; workspaceId: string | null },
  origem: OrigemIA,
  conferir: () => Promise<void>,
): Promise<string> {
  let ultimoErro: unknown = null;
  for (const title of dados.titulos) {
    await conferir();
    try {
      const nota = await notas.criar(
        userId,
        { title, contentMd: dados.contentMd, workspaceId: dados.workspaceId, kind: "livre" },
        origem,
      );
      return nota.id;
    } catch (erro) {
      if (!(erro instanceof AppError && erro.code === "TITULO_DUPLICADO")) throw erro;
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

/** O acumulado de um passo entre as voltas do laço de ferramenta. */
interface Acumulado {
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  durationMs: number;
  modelUsed: string | null;
}

async function executar(plano: Plano, viva: Viva, preferencia: PreferenciaDeIa): Promise<void> {
  const { runId, userId } = plano;
  const signal = viva.controlador.signal;

  let rascunho = "";
  const observacoes: { agentName: string; texto: string }[] = [];
  /// A marca da saída (card ou nota): o modelo e o agente do último passo que
  /// **reescreveu** — é ele que escreveu o texto que o card leva.
  let autor: string | null = null;
  let agenteAutor: string | null = null;
  let custoDoRun = 0;

  /// O passo em curso, para o `catch` gravar o que ele já gastou.
  let emCurso: { position: number; acumulado: Acumulado } | null = null;
  /// A saída, assim que existe. Daqui em diante a execução só termina
  /// `concluida` (RN-16), com aviso se o resto falhar.
  let saidaCriada: Saida | null = null;
  const tipoDaEntrada: RoutineInputKind = plano.entrada.tipo === "ideia" ? "coluna" : "pedido";

  /// Depois de começar a gravar o desfecho, o pulso não decide mais nada: um
  /// pulso em voo que voltasse "perdida" por causa da **nossa** gravação
  /// terminal não pode reescrever o motivo.
  let encerrando = false;
  const aplicar = (pulso: Pulso) => {
    if (encerrando) return;
    if (pulso === "perdida") {
      viva.motivo = "perdida";
      viva.controlador.abort();
    } else if (pulso === "cancelar" && !signal.aborted) {
      viva.motivo = "cancelada";
      viva.controlador.abort();
    }
  };
  /// O pulso por relógio cobre a chamada longa ao provedor, em que o laço não
  /// passa por `conferir`. Abortar aqui corta o fluxo do provedor na hora.
  const relogio = setInterval(() => {
    pulsar(runId).then(aplicar, () => undefined);
  }, INTERVALO_DO_PULSO_MS);
  relogio.unref();

  /// Só desvia para o `catch`: quem decide o status ali é `signal.aborted` e
  /// `viva.motivo`, não este erro.
  const parar = (): never => {
    throw new AppError(409, "VALIDATION_ERROR", "Execução interrompida.");
  };
  /// Antes de cada passo e de cada volta: renova o pulso e lê o cancelamento
  /// pedido em qualquer instância.
  const conferir = async () => {
    aplicar(await pulsar(runId));
    if (signal.aborted) parar();
  };
  /// Uma gravação condicional não achou a execução em andamento: outro
  /// processo a encerrou. Larga tudo sem gravar mais nada.
  const perder = (): never => {
    viva.motivo = "perdida";
    viva.controlador.abort();
    return parar();
  };

  try {
    let ideia: { title: string; descriptionMd: string } | null = null;
    if (plano.entrada.tipo === "ideia") {
      ideia = await prisma.card.findFirst({
        where: { id: plano.entrada.ideiaId, column: { board: { userId } } },
        select: { title: true, descriptionMd: true },
      });
      if (!ideia) throw notFound("A ideia foi excluída antes de a execução começar.");
    }
    const entradaDoPasso: EntradaDoPasso = ideia
      ? { tipo: "ideia", ...ideia }
      : { tipo: "pedido", texto: plano.entrada.tipo === "pedido" ? plano.entrada.texto : "" };

    for (const passo of plano.passos) {
      await conferir();
      const agente = await agentes.carregarParaChat(userId, passo.agentId);
      const modelo = await modeloDoAgente(userId, agente);
      /// A lista do agente, só a leitura: a rotina não escreve pelo modelo.
      const leitura = ferramentasDaRotina(agente.tools);
      if (leitura.length > 0 && !modelo.supportsTools) {
        throw new AppError(
          422,
          "MODELO_SEM_FERRAMENTA",
          `"${modelo.name}" não sabe chamar ferramenta, e «${agente.name}» lê o acervo.`,
        );
      }
      /// O mesmo contexto do chat (Etapa D), montado **por passo**: as fontes
      /// vivas vêm frescas, e as regras dizem que ele não cria nada — porque a
      /// lista que entra aqui já é só de leitura.
      const contexto = await agentes.montarContextoDoAgente(
        userId,
        { ...agente, tools: leitura },
        preferencia.timezone,
      );
      const catalogo = ferramentas.catalogoParaProvedor(contexto.permitidas);

      const acumulado: Acumulado = {
        promptTokens: 0,
        completionTokens: 0,
        costMicros: 0,
        durationMs: 0,
        modelUsed: null,
      };
      emCurso = { position: passo.position, acumulado };
      /// Condicional pela execução: o passo de uma execução que outro processo
      /// encerrou não volta a `rodando`.
      const comecou = await prisma.aiRoutineRunStep.updateMany({
        where: { runId, position: passo.position, run: { status: "em_andamento" } },
        data: {
          status: "rodando",
          agentName: agente.name,
          modelId: modelo.id,
          startedAt: new Date(),
        },
      });
      if (comecou.count === 0) perder();
      viva.parcial = { position: passo.position, texto: "" };
      emitir(viva, {
        tipo: "passo-inicio",
        position: passo.position,
        agentName: agente.name,
        modelId: modelo.id,
      });

      const mensagens: MensagemDoProvedor[] = [
        { role: "system", content: contexto.sistema },
        {
          role: "user",
          content: pedidoDoPasso({
            rotina: plano.routineName,
            indice: passo.position,
            total: plano.passos.length,
            entrada: entradaDoPasso,
            saida: plano.saida.tipo,
            rascunho,
            observacoes,
            mode: passo.mode,
            instruction: passo.instruction,
          }),
        },
      ];

      let final: string | null = null;
      for (let volta = 1; volta <= MAX_PASSOS_DO_LACO; volta += 1) {
        if (volta > 1) await conferir();
        else if (signal.aborted) parar();
        const saida = saidaDisponivel(modelo, mensagens);
        if (saida.maxTokens === null) {
          throw new AppError(
            422,
            "VALIDATION_ERROR",
            `O passo de «${agente.name}» já não cabe em ${modelo.name}: ~${saida.tokensEntrada} ` +
              `tokens contra um contexto de ${modelo.contextLength}.`,
          );
        }

        viva.parcial = { position: passo.position, texto: "" };
        let resultado: ResultadoDoPasso;
        const chamada = passoNoProvedor({
          userId,
          preferencia,
          modelo,
          mensagens,
          catalogo,
          maxTokens: saida.maxTokens,
          task: "rotina",
          vinculo: { runId },
          signal,
          /// O teto da execução, no mesmo ponto do diário: antes de a conexão
          /// sair, com a mesma estimativa. `custoDoRun` já inclui as voltas
          /// anteriores deste passo.
          tetoExtra: (estimativa) => {
            if (custoDoRun + estimativa > plano.runCapMicros) {
              throw new AppError(
                402,
                "TETO_DA_EXECUCAO",
                "A próxima chamada passaria do teto desta execução. Aumente o teto da rotina " +
                  "ou use modelos mais baratos nos agentes.",
              );
            }
          },
        });
        while (true) {
          const pedaco = await chamada.next();
          if (pedaco.done) {
            resultado = pedaco.value;
            break;
          }
          viva.parcial.texto += pedaco.value;
          emitir(viva, { tipo: "delta", position: passo.position, texto: pedaco.value });
        }

        custoDoRun += resultado.custo.costMicros;
        acumulado.promptTokens += resultado.custo.promptTokens;
        acumulado.completionTokens += resultado.custo.completionTokens;
        acumulado.costMicros += resultado.custo.costMicros;
        acumulado.durationMs += resultado.durationMs;
        acumulado.modelUsed = resultado.modelUsed ?? acumulado.modelUsed;

        if (resultado.pedidos.length === 0) {
          final = resultado.texto;
          break;
        }

        mensagens.push({
          role: "assistant",
          content: resultado.texto,
          tool_calls: paraToolCalls(resultado.pedidos),
        });
        /// O texto até a consulta era preâmbulo, e a tela o apaga no evento
        /// `ferramenta`. O parcial é zerado **junto**, para que quem assinar
        /// agora receba no retrato o mesmo que a tela aberta tem (`dobrar`).
        viva.parcial = { position: passo.position, texto: "" };
        for (const pedido of resultado.pedidos) {
          emitir(viva, { tipo: "ferramenta", position: passo.position, nome: pedido.nome });
          let texto: string;
          try {
            const argumentos = pedido.argumentos.trim() ? JSON.parse(pedido.argumentos) : {};
            /// `permitidas` é só a leitura do agente, e `executar` confere de
            /// novo (INV-52): um `create_card` pedido pelo modelo cai no mesmo
            /// "não existe" de um nome inventado.
            const saidaDaFerramenta = await ferramentas.executar(pedido.nome, argumentos, {
              userId,
              fuso: preferencia.timezone,
              origem: {
                via: "rotina",
                author: resultado.modelUsed ?? modelo.id,
                agentName: agente.name,
                runId,
                routineName: plano.routineName,
              },
              permitidas: contexto.permitidas,
            });
            texto = saidaDaFerramenta.texto;
          } catch (erro) {
            /// Volta ao modelo, como no chat: é erro que ele pode corrigir.
            texto = `Erro em ${pedido.nome}: ${motivoDaFalha(erro)}`;
          }
          mensagens.push({ role: "tool", tool_call_id: pedido.id, content: texto });
        }
      }

      if (final === null) {
        throw new AppError(
          502,
          "RESPOSTA_INVALIDA",
          `«${agente.name}» consultou o acervo ${MAX_PASSOS_DO_LACO} vezes e não entregou o ` +
            "passo.",
        );
      }
      if (!final.trim()) {
        throw new AppError(502, "RESPOSTA_INVALIDA", `«${agente.name}» respondeu vazio.`);
      }

      const [gravado] = await prisma.aiRoutineRunStep.updateManyAndReturn({
        where: { runId, position: passo.position, run: { status: "em_andamento" } },
        data: {
          status: "concluido",
          text: final,
          modelUsed: acumulado.modelUsed,
          promptTokens: acumulado.promptTokens,
          completionTokens: acumulado.completionTokens,
          costMicros: acumulado.costMicros,
          durationMs: acumulado.durationMs,
          endedAt: new Date(),
        },
        select: CAMPOS_DO_PASSO_EXECUTADO,
      });
      if (!gravado) return perder();
      const custoGravado = await prisma.aiRoutineRun.updateMany({
        where: { id: runId, status: "em_andamento" },
        data: { costMicros: custoDoRun, heartbeatAt: new Date() },
      });
      if (custoGravado.count === 0) perder();
      emCurso = null;
      viva.parcial = null;
      emitir(viva, {
        tipo: "passo-fim",
        step: paraPassoExecutado(gravado),
        runCostMicros: custoDoRun,
      });

      if (passo.mode === "reescreve") {
        rascunho = final.trim();
        autor = acumulado.modelUsed ?? modelo.id;
        agenteAutor = agente.name;
      } else {
        observacoes.push({ agentName: agente.name, texto: final.trim() });
      }
    }

    /* ------------------------------------------------------------ saída */

    const titulo = tituloDaSaida(plano, rascunho, ideia?.title ?? null);
    const secoes = [rascunho];
    if (plano.includeNotes && observacoes.length) {
      secoes.push(
        [
          "### Observações",
          "",
          ...observacoes.flatMap((o) => [`**«${o.agentName}»:**`, "", o.texto, ""]),
        ]
          .join("\n")
          .trim(),
      );
    }
    secoes.push(
      plano.entrada.tipo === "pedido"
        ? `---\nPedido: ${resumoDoPedido(plano.entrada.texto)}`
        : `---\nIdeia de origem: ${ideia?.title ?? ""}`,
    );
    /// A marca vem da execução, nunca do modelo (INV-58). O `runId` dela é
    /// também o que deixa `fecharSemDono` achar a saída se o processo morrer
    /// antes do registro logo abaixo.
    const origem: OrigemIA = {
      via: "rotina",
      author: autor,
      agentName: agenteAutor,
      runId,
      routineName: plano.routineName,
    };

    let saida: Saida;
    if (plano.saida.tipo === "card") {
      /// O último ponto em que cancelar ainda deixa a ideia intacta.
      await conferir();
      const card = await kanban.criarCard(
        userId,
        {
          columnId: plano.saida.columnId,
          title: cortar(titulo, MAX_CARD_TITULO),
          descriptionMd: cortar(secoes.join("\n\n"), MAX_CARD_DESCRICAO),
        },
        origem,
      );
      saida = { cardId: card.id };
    } else {
      saida = {
        noteId: await criarNotaDeSaida(
          userId,
          {
            titulos: titulosDaNota(titulo, preferencia.timezone, runId),
            contentMd: cortar(secoes.join("\n\n"), MAX_CONTEUDO),
            workspaceId: plano.saida.workspaceId,
          },
          origem,
          conferir,
        ),
      };
    }
    saidaCriada = saida;

    /// RN-16: a saída é gravada na execução **antes** de tocar na ideia. Daqui
    /// em diante, qualquer falha — do consumo, do registro, do processo —
    /// termina `concluida` com aviso, e `ondeElegivel` não devolve a ideia.
    const registrado = await prisma.aiRoutineRun.updateMany({
      where: { id: runId, status: "em_andamento" },
      data: { ...camposDaSaida(saida), costMicros: custoDoRun, heartbeatAt: new Date() },
    });
    if (registrado.count === 0) {
      /// Outro processo a fechou entre `conferir` e a saída (pulso vencido). A
      /// saída existe, e é o fato mais forte: é a única gravação do motor que
      /// passa por cima de um estado terminal alheio, e só para o `concluida`
      /// que `fecharSemDono` teria gravado se a tivesse visto.
      await prisma.aiRoutineRun.updateMany({
        where: {
          id: runId,
          outputCardId: null,
          outputNoteId: null,
          status: { not: "concluida" },
        },
        data: {
          status: "concluida",
          ...camposDaSaida(saida),
          errorCode: "FINALIZACAO_PARCIAL",
          errorMessage: finalizacaoParcial(saida, tipoDaEntrada),
        },
      });
      perder();
    }

    /// O destino da ideia é do código, e só depois da saída existir e estar
    /// registrada: falha em qualquer ponto antes dela deixa a ideia intacta,
    /// e o próximo "Rodar agora" a pega de novo. Falha **aqui** não desfaz a
    /// saída — ela já está pronta e marcada —, e a execução termina
    /// `concluida` com o aviso: pelo registro, a ideia não volta a ser
    /// escolhida. No pedido não há ideia, e nada a consumir.
    let aviso: { code: string; mensagem: string } | null = null;
    const ideiaId = plano.entrada.tipo === "ideia" ? plano.entrada.ideiaId : null;
    try {
      if (ideiaId) {
        if (plano.consumeAction === "mover" && plano.consumeColumnId) {
          await kanban.moverCard(userId, ideiaId, {
            columnId: plano.consumeColumnId,
            /// `moverCard` limita ao tamanho da coluna: é o fim dela.
            position: Number.MAX_SAFE_INTEGER,
          });
        } else if (plano.consumeAction === "arquivar") {
          await kanban.atualizarCard(userId, ideiaId, { archived: true });
        }
      }
    } catch (erro) {
      aviso = {
        code: "CONSUMO_FALHOU",
        mensagem:
          `${"cardId" in saida ? "O card foi criado" : "A nota foi criada"}, mas a ideia não ` +
          "pôde ser " +
          `${plano.consumeAction === "mover" ? "movida" : "arquivada"}: ` +
          (erro instanceof AppError ? erro.message : "falha inesperada") +
          ".",
      };
    }

    encerrando = true;
    clearInterval(relogio);
    const run = await concluir(runId, { saida, costMicros: custoDoRun, aviso });
    /// `null`: outro processo a fechou — como `concluida`, pela saída. Calado.
    if (!run) {
      viva.motivo = "perdida";
      return;
    }
    emitir(viva, { tipo: "fim", run: paraRun(run) });
  } catch (erro) {
    encerrando = true;
    clearInterval(relogio);
    /// Outro processo já gravou o desfecho. Os assinantes daqui recebem o
    /// `null` do `finally` de `iniciar` e releem o gravado.
    if (viva.motivo === "perdida") return;

    if (saidaCriada) {
      const run = await concluir(runId, {
        saida: saidaCriada,
        costMicros: custoDoRun,
        aviso: {
          code: "FINALIZACAO_PARCIAL",
          mensagem:
            finalizacaoParcial(saidaCriada, tipoDaEntrada) +
            (erro instanceof AppError && !signal.aborted ? ` (${erro.message})` : ""),
        },
      });
      if (run) emitir(viva, { tipo: "fim", run: paraRun(run) });
      return;
    }

    const abortado = signal.aborted
      ? viva.motivo === "desligamento"
        ? INTERROMPIDA
        : CANCELADA
      : null;
    const desfecho: Desfecho = abortado
      ? { ...abortado, mensagem: mensagemDo(abortado, tipoDaEntrada) }
      : {
          status: "falhou",
          code: erro instanceof AppError ? erro.code : "INTERNAL_ERROR",
          mensagem:
            erro instanceof AppError ? erro.message : "Falha inesperada na execução da rotina.",
        };

    /// Tudo condicional à execução ainda em andamento: se outro processo a
    /// encerrou enquanto este falhava, o registro dele fica.
    const agora = new Date();
    if (emCurso) {
      await prisma.aiRoutineRunStep.updateMany({
        where: { runId, position: emCurso.position, run: { status: "em_andamento" } },
        data: {
          status: "falhou",
          errorCode: desfecho.code,
          /// O que chegou antes da falha fica, para a tela mostrar onde parou.
          text: viva.parcial?.position === emCurso.position ? viva.parcial.texto : "",
          modelUsed: emCurso.acumulado.modelUsed,
          promptTokens: emCurso.acumulado.promptTokens,
          completionTokens: emCurso.acumulado.completionTokens,
          costMicros: emCurso.acumulado.costMicros,
          durationMs: emCurso.acumulado.durationMs,
          endedAt: agora,
        },
      });
    }
    await prisma.aiRoutineRunStep.updateMany({
      where: { runId, status: "pendente", run: { status: "em_andamento" } },
      data: { status: "pulado" },
    });
    const [run] = await prisma.aiRoutineRun.updateManyAndReturn({
      where: { id: runId, status: "em_andamento" },
      data: {
        status: desfecho.status,
        errorCode: desfecho.code,
        errorMessage: desfecho.mensagem,
        costMicros: custoDoRun,
        endedAt: agora,
      },
      select: CAMPOS_DO_RUN,
    });
    viva.parcial = null;
    if (!run) {
      viva.motivo = "perdida";
      return;
    }
    emitir(viva, { tipo: "erro", code: desfecho.code, mensagem: desfecho.mensagem });
    emitir(viva, { tipo: "fim", run: paraRun(run) });
  } finally {
    clearInterval(relogio);
  }
}

/* ---------------------------------------------------------------- consulta */

/**
 * Os eventos de uma execução, para o SSE: o **retrato** primeiro, depois os
 * eventos ao vivo, e `fim` por último. Execução já terminada manda o retrato
 * e o `fim`, e acaba. `"ping"` é o comentário que mantém a conexão viva.
 *
 * A posse é conferida **antes** do primeiro evento (`detalheDoRun`, 404 para
 * a alheia), porque depois do primeiro byte não há mais status HTTP.
 *
 * Três caminhos, decididos pelo `Map` **e** pelo banco:
 *
 * - viva aqui: retrato mais eventos ao vivo, com deltas;
 * - em andamento no banco e fora do `Map`: roda na outra instância, na janela
 *   de deploy (`remota`) — retratos relidos do banco, **sem deltas**;
 * - terminada: retrato e `fim`.
 *
 * A ordem da inscrição importa: o assinante entra **antes** de o retrato ser
 * lido, e os eventos que chegam no meio ficam num buffer. Quando o retrato
 * volta, o `parcial` é copiado e o buffer é dobrado nele no mesmo instante,
 * sem `await` entre os dois (`dobrar`, que diz a regra).
 *
 * **E a inscrição mora dentro do gerador**, na primeira linha que ele roda —
 * não aqui fora, antes de devolvê-lo. O `finally` que a desfaz só existe
 * para gerador que começou: se o cliente fecha antes de o `Readable.from`
 * puxar o primeiro evento, o gerador é descartado sem rodar, e um assinante
 * inscrito fora dele acumularia deltas até a execução acabar. Dentro, quem
 * nunca começou nunca se inscreveu. O preço é a execução poder terminar entre
 * o `vivas.get` daqui e a inscrição — aí o aviso de fim (`null`) já foi dado
 * a quem estava inscrito, e o gerador confere o `Map` depois de se inscrever.
 */
export async function assinar(
  userId: string,
  runId: string,
  fechou: AbortSignal,
): Promise<AsyncGenerator<RotinaEvent | "ping">> {
  const retrato = await detalheDoRun(userId, runId);
  const viva = vivas.get(runId);
  if (!viva || viva.userId !== userId) {
    /// Em andamento e fora daqui: ou roda na outra instância, ou terminou
    /// entre a leitura de cima e o `vivas.get` — `remota` relê antes do
    /// primeiro evento, e os dois casos saem certos. Mandar o retrato de cima
    /// com `fim` seria um `fim` com status `em_andamento`.
    return retrato.status === "em_andamento"
      ? remota(userId, runId, fechou)
      : terminada(retrato);
  }

  const fila: (RotinaEvent | null)[] = [];
  let acordar: (() => void) | null = null;
  const assinante: Assinante = (evento) => {
    fila.push(evento);
    acordar?.();
  };

  return (async function* () {
    viva.assinantes.add(assinante);
    try {
      /// Relido depois da inscrição: o de cima pode ser anterior a eventos
      /// que o buffer não viu.
      const lido = await detalheDoRun(userId, runId);
      /// Saiu do `Map` antes de este gerador se inscrever: o `null` do fim não
      /// vem mais. O relido decide, como no caminho de fora do `Map`.
      if (vivas.get(runId) !== viva && fila.length === 0) {
        yield* lido.status === "em_andamento"
          ? remota(userId, runId, fechou)
          : terminada(lido);
        return;
      }
      const parcial = viva.parcial;
      const { run: atual, resto } = dobrar(lido, fila);
      fila.length = 0;
      fila.push(...resto);
      yield {
        tipo: "retrato",
        run: atual,
        parcial: parcial ? parcial.texto : null,
      } satisfies RotinaEvent;

      while (!fechou.aborted) {
        const evento = fila.shift();
        if (evento === undefined) {
          const ping = await esperar(INTERVALO_DO_PING_MS, fechou, (soltar) => {
            acordar = soltar;
          });
          acordar = null;
          if (ping) yield "ping";
          continue;
        }
        /// A execução acabou sem `fim` daqui — a última rede do motor, ou
        /// outro processo que a encerrou. O gravado é relido.
        if (evento === null) {
          const { steps: _passos, ...fim } = await detalheDoRun(userId, runId);
          yield { tipo: "fim", run: fim } satisfies RotinaEvent;
          return;
        }
        yield evento;
        if (evento.tipo === "fim") return;
      }
    } finally {
      viva.assinantes.delete(assinante);
    }
  })();
}

/// Quantos SSE estão inscritos numa execução viva daqui; `null` se ela não
/// está viva neste processo. Só a suíte lê: é o que prova que o SSE fechado
/// antes do primeiro evento não deixa assinante acumulando deltas (`assinar`),
/// coisa que nenhuma resposta HTTP mostra.
export function assinantesDe(runId: string): number | null {
  return vivas.get(runId)?.assinantes.size ?? null;
}

/**
 * Espera `ms`, ou até o cliente fechar, ou até `acordar` ser chamado.
 * `true` quando o tempo esgotou.
 */
function esperar(
  ms: number,
  fechou: AbortSignal,
  expor?: (acordar: () => void) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolver) => {
    if (fechou.aborted) return resolver(false);
    const soltar = (esgotou: boolean) => {
      clearTimeout(relogio);
      fechou.removeEventListener("abort", aoFechar);
      resolver(esgotou);
    };
    const aoFechar = () => soltar(false);
    const relogio = setTimeout(() => soltar(true), ms);
    expor?.(() => soltar(false));
    fechou.addEventListener("abort", aoFechar);
  });
}

/**
 * Dobra no retrato os eventos que chegaram enquanto ele era lido. **Regra: sai
 * do buffer todo evento cujo efeito já está no retrato ou no `parcial`**, e só
 * ficam os que encerram (`erro`, `fim`, o `null` da última rede).
 *
 * Nenhum evento que muda um passo pode seguir depois do retrato, porque a tela
 * os aplica por cima: um `passo-inicio` repetido zera o parcial que o retrato
 * acabou de entregar, e um `ferramenta` também. E a leitura do banco pode ter
 * visto a gravação de um evento ou não — a consulta corre enquanto o motor
 * grava —, então cada um é aplicado aqui, sem regredir o que o banco já tem:
 *
 * - `delta`: descartado, o `parcial` (lido depois de tudo o que está no
 *   buffer) já o contém;
 * - `ferramenta`: descartado, o motor zera o `parcial` junto com ele;
 * - `passo-inicio`: o passo que o banco ainda lê `pendente` vira `rodando`,
 *   com agente e modelo do evento;
 * - `passo-fim`: o passo gravado substitui o lido, e o custo fica o maior.
 */
function dobrar(
  lido: RoutineRunDetail,
  fila: readonly (RotinaEvent | null)[],
): { run: RoutineRunDetail; resto: (RotinaEvent | null)[] } {
  let run = lido;
  const resto: (RotinaEvent | null)[] = [];
  for (const evento of fila) {
    if (evento === null || evento.tipo === "erro" || evento.tipo === "fim") {
      resto.push(evento);
    } else if (evento.tipo === "passo-inicio") {
      run = {
        ...run,
        steps: run.steps.map((s) =>
          s.position === evento.position && s.status === "pendente"
            ? { ...s, status: "rodando", agentName: evento.agentName, modelId: evento.modelId }
            : s,
        ),
      };
    } else if (evento.tipo === "passo-fim") {
      run = {
        ...run,
        costMicros: Math.max(run.costMicros, evento.runCostMicros),
        steps: run.steps.map((s) => (s.position === evento.step.position ? evento.step : s)),
      };
    }
    /// `delta`, `ferramenta` e um `retrato` (que o motor não emite): fora.
  }
  return { run, resto };
}

/**
 * O SSE de uma execução que roda em **outra instância** — só acontece na
 * janela de deploy, quando a nova já atende e a velha ainda executa.
 *
 * Sem deltas, por decisão: o texto ao vivo mora na memória da outra instância,
 * e trazê-lo exigiria um barramento entre as duas para cobrir uma janela de
 * minutos. A tela recebe o `retrato` do banco a cada ~2 s quando ele muda —
 * passo a passo, com o texto de cada um ao terminar —, e o `fim` relido.
 */
async function* remota(
  userId: string,
  runId: string,
  fechou: AbortSignal,
): AsyncGenerator<RotinaEvent | "ping"> {
  let anterior = "";
  let calado = 0;
  while (!fechou.aborted) {
    const atual = await detalheDoRun(userId, runId);
    if (atual.status !== "em_andamento") {
      yield* terminada(atual);
      return;
    }
    const forma = JSON.stringify(atual);
    if (forma !== anterior) {
      anterior = forma;
      calado = 0;
      yield { tipo: "retrato", run: atual, parcial: null };
    } else if ((calado += INTERVALO_DO_RETRATO_REMOTO_MS) >= INTERVALO_DO_PING_MS) {
      calado = 0;
      yield "ping";
    }
    await esperar(INTERVALO_DO_RETRATO_REMOTO_MS, fechou);
  }
}

/** Retrato e `fim` de uma execução **já terminada** — quem chama garante. */
async function* terminada(retrato: RoutineRunDetail): AsyncGenerator<RotinaEvent | "ping"> {
  yield { tipo: "retrato", run: retrato, parcial: null };
  const { steps: _passos, ...run } = retrato;
  yield { tipo: "fim", run };
}

/* ------------------------------------------------------------ cancelamento */

/**
 * Cancelar. Idempotente: execução já terminada não muda.
 *
 * O pedido vai **para o banco** (`cancelRequestedAt`), porque quem executa
 * pode ser a outra instância: ela o lê no pulso e antes de cada passo e volta,
 * e grava `cancelada` ela mesma. Se executa aqui, aborta na hora. Se ninguém
 * pulsa mais, ninguém vai ler o pedido — fecha-se aqui, pelo banco.
 */
export async function cancelar(userId: string, runId: string): Promise<void> {
  const pedido = await prisma.aiRoutineRun.updateMany({
    where: { id: runId, userId, status: "em_andamento", cancelRequestedAt: null },
    data: { cancelRequestedAt: new Date() },
  });
  if (pedido.count === 0) {
    const run = await prisma.aiRoutineRun.findFirst({
      where: { id: runId, userId },
      select: { status: true },
    });
    if (!run) throw notFound("Execução não encontrada");
    if (run.status !== "em_andamento") return;
    /// Já pedido antes: segue, para repetir o que couber abaixo.
  }

  const viva = vivas.get(runId);
  if (viva) {
    if (!viva.controlador.signal.aborted) {
      viva.motivo = "cancelada";
      viva.controlador.abort();
    }
    return;
  }
  await fecharSemDono(
    { id: runId, userId, heartbeatAt: { lt: pulsoVencidoAntesDe() } },
    CANCELADA,
  );
}

/* ------------------------------------------------------- ciclo do processo */

/**
 * Fecha as execuções sem dono: `em_andamento`, fora do `Map` daqui **e** de
 * pulso vencido. O pulso é o que protege a execução viva na instância vizinha
 * durante o deploy — sem ele, a nova daria por morta a que a velha ainda roda,
 * reabriria a ideia (RN-18) e liberaria outra execução (RN-19), e a velha
 * sobrescreveria o status no fim.
 *
 * Roda no boot e a cada minuto (`vigiarExecucoes`).
 */
export async function reconciliarExecucoes(): Promise<number> {
  return fecharSemDono(
    { heartbeatAt: { lt: pulsoVencidoAntesDe() }, id: { notIn: [...vivas.keys()] } },
    INTERROMPIDA,
  );
}

export interface RegistroDaVarredura {
  info: (dados: object, mensagem: string) => void;
  warn: (dados: object, mensagem: string) => void;
}

/**
 * A varredura periódica. Devolve quem a desliga. `unref`: ela não segura o
 * processo vivo.
 */
export function vigiarExecucoes(registro: RegistroDaVarredura): () => void {
  const relogio = setInterval(() => {
    reconciliarExecucoes().then(
      (fechadas) => {
        if (fechadas > 0) registro.info({ fechadas }, "execuções de rotina sem dono fechadas");
      },
      (erro: unknown) => registro.warn({ err: erro }, "varredura de execuções de rotina falhou"),
    );
  }, INTERVALO_DA_VARREDURA_MS);
  relogio.unref();
  return () => clearInterval(relogio);
}

/**
 * No SIGTERM, antes de `app.close()`: aborta as vivas e espera cada uma gravar
 * `interrompida` — condicional, como toda gravação do motor. Com teto de
 * espera: um banco travado não pode segurar o desligamento; o que não gravar a
 * tempo para de pulsar, e a varredura de quem ficar no ar o fecha.
 */
export async function encerrarExecucoes(): Promise<number> {
  const lista = [...vivas.values()];
  for (const viva of lista) {
    if (viva.controlador.signal.aborted) continue;
    viva.motivo = "desligamento";
    viva.controlador.abort();
  }
  await Promise.race([
    Promise.allSettled(lista.map((v) => v.terminada)),
    new Promise((resolver) => setTimeout(resolver, ESPERA_NO_DESLIGAMENTO_MS).unref()),
  ]);
  return lista.length;
}
