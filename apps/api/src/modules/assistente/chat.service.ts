import { z } from "zod";
import { MAX_PASSOS_DO_LACO } from "@yu-book/shared";
import type {
  AiCallUsage,
  ChatEvent,
  ChatMessage,
  ChatMessageInput,
  ChatSource,
} from "@yu-book/shared";
import type { AiFavorite } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import * as conversas from "./conversas.service.js";
import {
  custoDaResposta,
  estimarCustoMicros,
  garantirTeto,
  registrarUso,
  tokensAproximados,
} from "./custo.service.js";
import * as ferramentas from "./ferramentas.service.js";
import { lerFluxo } from "./fluxo.js";
import type { PedidoDeFerramenta } from "./fluxo.js";
import { abrirNoProvedor, politicaDeDados } from "./openrouter.service.js";
import { modeloParaTarefa, preferenciaDe } from "./preferencias.service.js";
import type { PreferenciaDeIa } from "./preferencias.service.js";

/**
 * O laço de ferramenta (Etapa B da frente de IA, RF-17 a RF-26).
 *
 * A diferença de fundo em relação a formatar nota: **uma mensagem do usuário
 * não é uma chamada ao provedor, são até cinco.** O modelo pede uma ação, o
 * Yu-book executa, o resultado volta, ele decide se acabou. Disso decorre tudo
 * o que parece exagero aqui:
 *
 * - **O teto é conferido por passo, não por mensagem.** Uma pergunta que
 *   dispara cinco chamadas gasta cinco vezes, e um teto conferido uma vez só
 *   autorizaria a primeira e pagaria as outras quatro sem olhar.
 * - **Cada passo grava sua própria linha em `ai_usage`.** O gasto de uma
 *   conversa é a soma delas, e uma falha no passo 3 não apaga o que os passos
 *   1 e 2 custaram.
 * - **O laço tem fim declarado** (`MAX_PASSOS_DO_LACO`). Modelo em ciclo —
 *   buscar, não achar, buscar de novo — é o caso que gasta um teto inteiro numa
 *   pergunta.
 *
 * O laço nasce **só com leitura**: quem decide o que pode ser executado é
 * `ferramentas.service.ts`, e lá as quatro ações de escrita não têm executor.
 */

/// Geração de texto é lenta, e aqui ela acontece até cinco vezes — o orçamento
/// é **por passo**, não pela mensagem inteira.
const ORCAMENTO_MS = 60_000;
const FOLGA_SAIDA_TOKENS = 512;
/// Abaixo disto não sobra resposta: o histórico já não cabe no modelo.
const MINIMO_SAIDA_TOKENS = 256;
/// Teto de saída por passo. O passo que só chama ferramenta gasta muito menos.
const MAX_SAIDA_TOKENS = 2_048;

const INSTRUCOES = [
  "Você é o assistente do Yu-book, o segundo cérebro do usuário. " +
    "Responda em português do Brasil.",
  "",
  "Você tem ferramentas de **leitura** do acervo dele. Use-as:",
  "- Procure sozinho quando a pergunta for sobre o acervo. Não peça ao usuário o que você " +
    "pode buscar.",
  "- `search_notes` acha; `get_note` lê uma nota inteira. Buscar é barato, ler é caro — " +
    "busque antes.",
  "- Não invente nota, card, quadro nem id. Se não achar, diga que não achou.",
  "",
  "Regras da resposta:",
  "- **Cite a origem**: toda afirmação sobre uma nota ou um card nomeia a nota ou o card.",
  "- Não altere nada entre colchetes duplos ao citar: `[[assim]]` é um link interno do usuário.",
  "- Você não consegue criar, alterar nem apagar nada. Se pedirem, diga que só sabe ler.",
].join("\n");

type MensagemDoProvedor =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** O que dizer ao modelo sobre a própria chamada malfeita. */
function motivoDaFalha(erro: unknown): string {
  if (erro instanceof z.ZodError) {
    return erro.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
  }
  if (erro instanceof SyntaxError) return "os argumentos não são JSON válido";
  if (erro instanceof AppError) return erro.message;
  return "falha ao executar";
}

function paraToolCalls(pedidos: PedidoDeFerramenta[]): unknown[] {
  return pedidos.map((p) => ({
    id: p.id,
    type: "function",
    function: { name: p.nome, arguments: p.argumentos },
  }));
}

/**
 * O histórico da conversa na forma que o provedor espera.
 *
 * O anexo de uma mensagem **antiga** entra como uma linha nomeando o que foi
 * anexado, não como o conteúdo de novo. Reinjetar o corpo de cada nota anexada
 * em toda a conversa estouraria o contexto em três mensagens, e o corpo pode
 * ter mudado desde então — o id na linha é o que permite ao modelo relê-la com
 * `get_note` se precisar. É o laço de ferramenta fazendo o trabalho em vez de
 * um contexto que só cresce.
 */
async function historicoDoProvedor(conversationId: string): Promise<MensagemDoProvedor[]> {
  const linhas = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { attachments: true },
  });

  /**
   * Quais pedidos de ferramenta de fato têm resposta gravada.
   *
   * **Existe porque o par pode quebrar, e a conversa não pode morrer por
   * isso.** A fala do assistente que pede ferramenta é gravada antes de a
   * ferramenta rodar; se o fluxo parar no meio — cliente desconecta, processo
   * cai —, sobra um `assistant` com `tool_calls` sem o `tool` que responde. O
   * provedor **recusa** um histórico assim, e a conversa ficaria inutilizável
   * para sempre, com um erro que não aponta para cá.
   *
   * Conserto na leitura, e não na escrita, de propósito: a escrita não tem como
   * ser atômica (a ferramenta roda entre as duas gravações), e o conserto na
   * leitura cobre também a linha que já ficou quebrada no banco.
   */
  const respondidos = new Set(
    linhas.filter((m) => m.role === "tool" && m.toolCallId).map((m) => m.toolCallId),
  );

  const pedidosVivos = (m: (typeof linhas)[number]): unknown[] => {
    if (!Array.isArray(m.toolCalls)) return [];
    return (m.toolCalls as { id?: unknown }[]).filter(
      (p) => typeof p.id === "string" && respondidos.has(p.id),
    );
  };

  return linhas
    .filter((m) => {
      /// Fala que só pedia ferramenta e perdeu todas as respostas não tem o que
      /// dizer ao modelo — e mandá-la sem `tool_calls` seria uma fala vazia.
      if (m.role !== "assistant") return true;
      if (m.content.trim()) return true;
      return pedidosVivos(m).length > 0;
    })
    .map((m): MensagemDoProvedor => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
    }
    if (m.role === "assistant") {
      const pedidos = pedidosVivos(m);
      return {
        role: "assistant",
        content: m.content,
        ...(pedidos.length && { tool_calls: pedidos }),
      };
    }

    const anexos = m.attachments
      .map((a) => {
        const alvo = a.noteId ?? a.cardId ?? a.boardId;
        return alvo ? `${a.title} (${alvo})` : a.title;
      })
      .join(", ");
    return {
      role: "user",
      content: anexos ? `[o usuário anexou: ${anexos}]\n${m.content}` : m.content,
    };
  });
}

export interface Sessao {
  userId: string;
  conversationId: string;
  modelo: AiFavorite;
  preferencia: PreferenciaDeIa;
  /// A mensagem do usuário, já persistida. É o que a tela mostra de volta.
  mensagemDoUsuario: ChatMessage;
  mensagens: MensagemDoProvedor[];
  /// Anexos que não couberam no orçamento de contexto (RNF-04). O aviso sai na
  /// resposta, nunca calado.
  cortados: string[];
}

/**
 * Tudo o que se decide **antes** de o primeiro byte sair.
 *
 * Separado do laço de propósito: aqui as recusas ainda podem ser status HTTP
 * com código estável, como em toda rota do projeto. Depois que o fluxo começa
 * não existe mais status para usar, e o erro precisa virar evento.
 */
export async function preparar(
  userId: string,
  conversationId: string,
  entrada: ChatMessageInput,
): Promise<Sessao> {
  await conversas.garantirPosse(userId, conversationId);

  const preferencia = await preferenciaDe(userId);
  const modelo = await modeloParaTarefa(userId, "chat");

  /// A bandeira vem da cópia do catálogo no favorito, capturada desde a Etapa A
  /// justamente para isto. Um modelo que não sabe chamar ferramenta conversa
  /// bem e não consegue consultar o acervo — e falharia no meio, depois de
  /// pagar a chamada.
  if (!modelo.supportsTools) {
    throw new AppError(
      422,
      "MODELO_SEM_FERRAMENTA",
      `"${modelo.name}" não sabe chamar ferramenta, e sem isso o chat não consulta o acervo. ` +
        "Escolha outro modelo para o chat nos ajustes de IA.",
    );
  }

  const resolvidos = await conversas.resolverAnexos(
    userId,
    entrada.attachments,
    preferencia.timezone,
  );
  const { texto: contexto, cortados } = conversas.montarContexto(resolvidos);

  /// O histórico **antes** de gravar a nova mensagem: gravar primeiro a traria
  /// duplicada, uma vez pela consulta e outra pelo turno que montamos abaixo.
  const anteriores = await historicoDoProvedor(conversationId);

  const turno = [
    contexto ? `O usuário anexou isto ao contexto:\n\n${contexto}\n\n---\n` : "",
    cortados.length
      ? `[${cortados.length} anexo(s) não couberam no limite de contexto e ficaram de fora: ` +
        `${cortados.join(", ")}]\n`
      : "",
    entrada.content,
  ].join("");

  const mensagens: MensagemDoProvedor[] = [
    { role: "system", content: INSTRUCOES },
    ...anteriores,
    { role: "user", content: turno },
  ];

  /// O teto conferido aqui, **e** outra vez dentro do laço. Não é redundância
  /// à toa: esta é a recusa de quem já estourou o teto antes de perguntar, e
  /// ela tem que ser um 402 com nada transmitido, igual à formatação. A do laço
  /// existe porque o histórico cresce a cada passo, e o passo 4 custa mais que
  /// o passo 1.
  await garantirTeto(userId, preferencia, estimarPasso(modelo, mensagens));

  /// **Só agora a pergunta é gravada**, e a ordem é o requisito.
  ///
  /// Gravando antes, uma recusa por teto deixaria a pergunta persistida sem
  /// resposta — ela reapareceria no histórico quando a tela recarregasse a
  /// conversa, e voltaria ao provedor no turno seguinte como se tivesse sido
  /// feita. A recusa irmã, a de `MODELO_SEM_FERRAMENTA`, já acontecia antes de
  /// gravar; agora as duas tratam o mesmo caso do mesmo jeito.
  const mensagemDoUsuario = await gravarMensagem({
    conversationId,
    role: "user",
    content: entrada.content,
    anexos: resolvidos,
  });

  return { userId, conversationId, modelo, preferencia, mensagemDoUsuario, mensagens, cortados };
}

function charsDe(mensagens: MensagemDoProvedor[]): number {
  return mensagens.reduce((soma, m) => soma + m.content.length, 0);
}

function estimarPasso(modelo: AiFavorite, mensagens: MensagemDoProvedor[]): number {
  return estimarCustoMicros(modelo, charsDe(mensagens), MAX_SAIDA_TOKENS);
}

interface GravarMensagem {
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  modelId?: string | null;
  modelUsed?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  toolCalls?: unknown[] | null;
  sources?: ChatSource[];
  anexos?: conversas.AnexoResolvido[];
}

async function gravarMensagem(dados: GravarMensagem): Promise<ChatMessage> {
  const linha = await prisma.aiMessage.create({
    data: {
      conversationId: dados.conversationId,
      role: dados.role,
      content: dados.content,
      modelId: dados.modelId ?? null,
      modelUsed: dados.modelUsed ?? null,
      toolName: dados.toolName ?? null,
      toolCallId: dados.toolCallId ?? null,
      ...(dados.toolCalls?.length && { toolCalls: dados.toolCalls as never }),
      ...(dados.sources?.length && { sources: dados.sources as never }),
      attachments: {
        create: (dados.anexos ?? []).map((a) => ({
          noteId: a.entrada.noteId ?? null,
          cardId: a.entrada.cardId ?? null,
          boardId: a.entrada.boardId ?? null,
          title: a.titulo,
        })),
      },
    },
    include: { attachments: true },
  });

  /// `updatedAt` da conversa é o que ordena a lista da tela.
  await prisma.aiConversation.update({
    where: { id: dados.conversationId },
    data: { updatedAt: new Date() },
  });

  return {
    id: linha.id,
    role: linha.role,
    content: linha.content,
    modelId: linha.modelId,
    modelUsed: linha.modelUsed,
    toolName: linha.toolName,
    sources: Array.isArray(linha.sources) ? (linha.sources as unknown as ChatSource[]) : [],
    createdAt: linha.createdAt.toISOString(),
    attachments: linha.attachments.map((a) => ({
      id: a.id,
      noteId: a.noteId,
      cardId: a.cardId,
      boardId: a.boardId,
      title: a.title,
    })),
  };
}

/**
 * O laço. Cada `yield` é um evento do `text/event-stream`.
 *
 * Nada aqui lança para fora depois do primeiro evento: quem chama já respondeu
 * 200 e não tem mais status HTTP disponível. Falha vira evento `erro`, com o
 * mesmo `code` estável que a rota usaria.
 */
export async function* conversar(sessao: Sessao): AsyncGenerator<ChatEvent> {
  const { userId, conversationId, modelo, preferencia } = sessao;
  const mensagens = [...sessao.mensagens];
  const usos: AiCallUsage[] = [];
  /**
   * O que o turno inteiro consultou, acumulado entre os passos. Vai gravado na
   * fala que fecha a resposta, para o histórico continuar citando a origem
   * depois de recarregar a página (RF-20 + CA-10).
   *
   * **Começa com o que o usuário anexou**, e não vazio. A origem de uma
   * resposta é o que ela usou, não o caminho pelo qual aquilo chegou: com a
   * nota no contexto o modelo responde sem chamar ferramenta nenhuma, e sem
   * esta semente a resposta certa ficaria sem origem clicável justamente no
   * caso em que o usuário sabe qual ela é.
   */
  const fontesDoTurno: ChatSource[] = sessao.mensagemDoUsuario.attachments.flatMap(
    (a): ChatSource[] => {
      if (a.noteId) return [{ kind: "note", id: a.noteId, title: a.title }];
      if (a.cardId) return [{ kind: "card", id: a.cardId, title: a.title }];
      if (a.boardId) return [{ kind: "board", id: a.boardId, title: a.title }];
      return [];
    },
  );
  let ultima: ChatMessage | null = null;

  for (let passo = 1; passo <= MAX_PASSOS_DO_LACO; passo += 1) {
    const tokensEntrada = tokensAproximados(charsDe(mensagens));
    const maxTokens = Math.min(
      MAX_SAIDA_TOKENS,
      modelo.contextLength - tokensEntrada - FOLGA_SAIDA_TOKENS,
    );
    if (maxTokens < MINIMO_SAIDA_TOKENS) {
      yield {
        tipo: "erro",
        code: "VALIDATION_ERROR",
        mensagem:
          `A conversa já não cabe em ${modelo.name}: ~${tokensEntrada} tokens contra um ` +
          `contexto de ${modelo.contextLength}. Comece uma conversa nova ou escolha um modelo ` +
          "com contexto maior.",
      };
      return;
    }

    let localDay: string;
    try {
      const resumo = await garantirTeto(userId, preferencia, estimarPasso(modelo, mensagens));
      localDay = resumo.localDay;
    } catch (erro) {
      /// Corte no meio do laço: o que já foi gerado **fica**. Os passos
      /// anteriores custaram dinheiro e renderam alguma coisa, e um erro que
      /// apagasse tudo faria o usuário pagar por nada.
      if (erro instanceof AppError && erro.code === "TETO_DIARIO_ATINGIDO") {
        yield { tipo: "teto", mensagem: erro.message };
        if (ultima) yield { tipo: "fim", mensagem: ultima, usage: usos };
        return;
      }
      throw erro;
    }

    const inicio = Date.now();
    const registro = {
      userId,
      task: "chat" as const,
      modelId: modelo.id,
      localDay,
      conversationId,
    };

    let resultado;
    try {
      const resposta = await abrirNoProvedor("/chat/completions", {
        metodo: "POST",
        orcamentoMs: ORCAMENTO_MS,
        corpo: {
          model: modelo.id,
          max_tokens: maxTokens,
          stream: true,
          /// Sem isto o `usage` não vem, e todo passo gravaria custo
          /// `desconhecido` — o teto viraria decorativo (INV-48).
          stream_options: { include_usage: true },
          messages: mensagens,
          tools: ferramentas.catalogoParaProvedor(),
          ...politicaDeDados(preferencia.allowTraining),
        },
      });

      const fluxo = lerFluxo(resposta);
      while (true) {
        const pedaco = await fluxo.next();
        if (pedaco.done) {
          resultado = pedaco.value;
          break;
        }
        yield { tipo: "delta", texto: pedaco.value };
      }
    } catch (erro) {
      await registrarUso({
        ...registro,
        promptTokens: 0,
        completionTokens: 0,
        costMicros: 0,
        costSource: "desconhecido",
        durationMs: Date.now() - inicio,
        ok: false,
        errorCode: erro instanceof AppError ? erro.code : "INTERNAL_ERROR",
      });
      yield {
        tipo: "erro",
        code: erro instanceof AppError ? erro.code : "INTERNAL_ERROR",
        mensagem:
          erro instanceof AppError ? erro.message : "Falha ao falar com o provedor de IA.",
      };
      return;
    }

    const apurado = custoDaResposta(resultado.usage, modelo);
    await registrarUso({
      ...registro,
      modelUsed: resultado.modelUsed,
      generationId: resultado.generationId,
      durationMs: Date.now() - inicio,
      ok: true,
      ...apurado,
    });
    usos.push({
      modelId: modelo.id,
      modelUsed: resultado.modelUsed,
      promptTokens: apurado.promptTokens,
      completionTokens: apurado.completionTokens,
      costMicros: apurado.costMicros,
      costSource: apurado.costSource,
    });

    /// A fala do assistente é gravada mesmo quando ela é só um pedido de
    /// ferramenta sem texto: é ela que carrega os `tool_calls` que o provedor
    /// exige ver antes dos resultados, no turno seguinte.
    ultima = await gravarMensagem({
      conversationId,
      role: "assistant",
      content: resultado.texto,
      modelId: modelo.id,
      modelUsed: resultado.modelUsed,
      toolCalls: resultado.pedidos.length ? paraToolCalls(resultado.pedidos) : null,
      /// Só na fala que fecha: repetir a lista em cada passo intermediário
      /// mostraria a mesma nota três vezes na tela.
      ...(resultado.pedidos.length === 0 && { sources: fontesDoTurno }),
    });
    mensagens.push({
      role: "assistant",
      content: resultado.texto,
      ...(resultado.pedidos.length && { tool_calls: paraToolCalls(resultado.pedidos) }),
    });

    if (resultado.pedidos.length === 0) {
      yield { tipo: "fim", mensagem: ultima, usage: usos };
      return;
    }

    for (const pedido of resultado.pedidos) {
      yield { tipo: "ferramenta", nome: pedido.nome, passo };

      let texto: string;
      try {
        const argumentos = pedido.argumentos.trim() ? JSON.parse(pedido.argumentos) : {};
        const saida = await ferramentas.executar(pedido.nome, argumentos, {
          userId,
          fuso: preferencia.timezone,
        });
        texto = saida.texto;
        if (saida.fontes.length) {
          const fontes = saida.fontes.map((f) => ({ kind: f.tipo, id: f.id, title: f.titulo }));
          /// Sem repetir: duas ferramentas costumam tocar a mesma nota — buscar
          /// e depois lê-la é o caminho normal.
          for (const fonte of fontes) {
            if (!fontesDoTurno.some((j) => j.kind === fonte.kind && j.id === fonte.id)) {
              fontesDoTurno.push(fonte);
            }
          }
          yield { tipo: "fontes", fontes };
        }
      } catch (erro) {
        /// O erro da ferramenta volta **ao modelo**, não ao usuário: id que não
        /// existe, argumento inválido e nota na lixeira são coisas que ele pode
        /// corrigir na volta seguinte. Derrubar a conversa por isso desperdiça
        /// os passos já pagos.
        ///
        /// O `ZodError` entra com as falhas campo a campo de propósito: é o
        /// único erro daqui que o modelo consegue consertar sozinho, e "erro
        /// em search_notes" sem dizer qual campo o faria repetir a mesma
        /// chamada errada até o teto de passos.
        texto = `Erro em ${pedido.nome}: ${motivoDaFalha(erro)}`;
      }

      await gravarMensagem({
        conversationId,
        role: "tool",
        content: texto,
        toolName: pedido.nome,
        toolCallId: pedido.id,
      });
      mensagens.push({ role: "tool", tool_call_id: pedido.id, content: texto });
    }
  }

  /// Chegou ao teto de passos com o modelo ainda pedindo ferramenta. Não é erro
  /// do usuário e não é silêncio: ele precisa saber que a resposta parou por
  /// limite, não por ter acabado.
  yield {
    tipo: "erro",
    code: "RESPOSTA_INVALIDA",
    mensagem:
      `O assistente consultou o acervo ${MAX_PASSOS_DO_LACO} vezes e não fechou uma resposta. ` +
      "Tente perguntar de forma mais específica.",
  };
}
