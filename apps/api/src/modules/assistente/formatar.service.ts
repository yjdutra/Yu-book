import type { AiCallUsage, FormatNoteResult } from "@yu-book/shared";
import { extrairWikilinks, normalizarTitulo } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import {
  custoDaResposta,
  estimarCustoMicros,
  garantirTeto,
  registrarUso,
  tokensAproximados,
  type UsoDoProvedor,
} from "./custo.service.js";
import { pedirDoProvedor } from "./openrouter.service.js";
import { modeloParaTarefa, preferenciaDe } from "./preferencias.service.js";

/**
 * Formatar uma nota (RF-10 a RF-16) — a primeira chamada de inferência do
 * projeto.
 *
 * O corpo vem **do pedido**, não do banco: entre a tecla e o autosave existem
 * 800 ms em que a tela e o banco divergem, e o RF-15 exige comparar contra o
 * que está na tela. O `:id` serve para posse e para carimbar o registro de uso.
 *
 * Nada aqui grava na nota. Quem grava é o autosave que já existe, e é o que faz
 * a formatação custar uma requisição em vez das seis que uma escrita pelo
 * servidor invalidaria (INV-23).
 */

/// Geração de texto é lenta; não é leitura de metadado.
const ORCAMENTO_MS = 60_000;

/// Folga para o que o modelo acrescenta de estrutura (títulos, marcadores).
const FATOR_SAIDA = 1.3;
const FOLGA_SAIDA_TOKENS = 512;
/// Abaixo disto não há resposta útil possível: o corpo não cabe no modelo.
const MINIMO_SAIDA_TOKENS = 256;

const INSTRUCOES = [
  "Você organiza a formatação de notas em Markdown.",
  "Devolva APENAS o Markdown resultante, sem explicação e sem cercar a resposta em bloco de código.",
  "",
  "Regras, todas obrigatórias:",
  "- Não altere o sentido de nenhuma frase, não resuma e não remova conteúdo.",
  "- Não invente seção, não acrescente informação e não traduza.",
  "- Não altere NADA entre colchetes duplos: `[[assim]]` é um link interno, e reescrevê-lo quebra",
  "  o grafo de notas.",
  "- Não acrescente título de primeiro nível: o título da nota é campo separado.",
  "- Aplique estrutura ao que já existe: títulos, listas, ênfase, blocos de código e tabelas.",
].join("\n");

interface RespostaDeChat {
  id?: unknown;
  model?: unknown;
  choices?: { message?: { content?: unknown } }[];
  usage?: UsoDoProvedor;
}

/**
 * Modelo costuma devolver a resposta inteira embrulhada em ```` ``` ````.
 *
 * Desembrulha só quando a cerca abre no primeiro caractere e fecha no último —
 * e **nunca** quando o texto original já começava com cerca, senão uma nota que
 * é um bloco de código só seria corrompida.
 */
function desembrulharCerca(saida: string, entrada: string): string {
  const texto = saida.trim();
  if (entrada.trimStart().startsWith("```")) return texto;

  const casou = /^```[a-zA-Z0-9+-]*\n([\s\S]*?)\n?```$/.exec(texto);
  return casou?.[1] ?? texto;
}

/**
 * RN-06: `note_link` é tabela derivada dos wikilinks do corpo. Se o modelo
 * reescrever um, o backlink some e **nada reclama** — por isso o prompt pede e
 * esta função confere. Prompt é pedido, não garantia.
 */
function mesmosWikilinks(entrada: string, saida: string): boolean {
  /// Compara **conjunto de alvos normalizados**, não lista ordenada.
  ///
  /// `note_link` é um conjunto: ordem e repetição não existem nela, e
  /// `[[Alpha]]` e `[[alpha]]` apontam para a mesma nota (o índice do banco é
  /// sem acento e sem caixa). Comparar por índice recusaria uma formatação só
  /// por ter agrupado itens numa seção — que é exatamente o que formatar faz —
  /// e a chamada já foi paga quando esta função roda.
  const antes = new Set(extrairWikilinks(entrada).map(normalizarTitulo));
  const depois = new Set(extrairWikilinks(saida).map(normalizarTitulo));
  return antes.size === depois.size && [...antes].every((alvo) => depois.has(alvo));
}

/**
 * O bloco `provider` da requisição, montado a partir da escolha do usuário.
 *
 * **Não é de graça pedir `deny`**, e é por isso que isto não volta a ser fixo:
 * medido em 2026-09-23, o mesmo modelo gratuito devolve **404** com
 * `data_collection: "deny"` ("No endpoints found matching your data policy") e
 * **200** sem ele. Endpoints gratuitos treinam com os dados; exigir que não
 * treinem é exigir um endpoint que não existe.
 *
 * Com a permissão ligada não mandamos bloco nenhum — deixar o roteamento livre
 * é o que abre os gratuitos, e a tela diz isso em voz alta.
 */
function politicaDeDados(permiteTreino: boolean): Record<string, unknown> {
  return permiteTreino ? {} : { provider: { data_collection: "deny" } };
}

export async function formatarNota(
  userId: string,
  noteId: string,
  contentMd: string,
): Promise<FormatNoteResult> {
  /// Só a posse: o corpo veio no pedido, então trazer a nota inteira por
  /// `notes.buscarPorId` seriam três consultas e o conteúdo todo à toa.
  const nota = await prisma.note.findFirst({
    where: { id: noteId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!nota) throw notFound("Nota não encontrada");

  const modelo = await modeloParaTarefa(userId, "formatar");
  const preferencia = await preferenciaDe(userId);

  const tokensEntrada = tokensAproximados(contentMd.length);
  const maxTokens = Math.min(
    Math.ceil(tokensEntrada * FATOR_SAIDA) + FOLGA_SAIDA_TOKENS,
    modelo.contextLength - tokensEntrada - FOLGA_SAIDA_TOKENS,
  );
  /// Cortar aqui, com os dois números — nunca mandar e deixar o provedor
  /// truncar em silêncio no meio da nota.
  if (maxTokens < MINIMO_SAIDA_TOKENS) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      `Esta nota é grande demais para ${modelo.name}: ~${tokensEntrada} tokens contra um ` +
        `contexto de ${modelo.contextLength}. Escolha um modelo com contexto maior.`,
    );
  }

  const estimativa = estimarCustoMicros(modelo, contentMd.length, maxTokens);
  /// Recusa **antes de abrir conexão**, e devolve o dia que o registro vai usar.
  const { localDay } = await garantirTeto(userId, preferencia, estimativa);

  const inicio = Date.now();
  let resposta: RespostaDeChat;
  try {
    resposta = await pedirDoProvedor<RespostaDeChat>("/chat/completions", {
      metodo: "POST",
      orcamentoMs: ORCAMENTO_MS,
      corpo: {
        model: modelo.id,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: INSTRUCOES },
          { role: "user", content: contentMd },
        ],
        ...politicaDeDados(preferencia.allowTraining),
      },
    });
  } catch (erro) {
    /// A chamada pode ter custado mesmo falhando, e o registro é a trilha de
    /// auditoria do teto. Nunca engole o erro original.
    await registrarUso({
      userId,
      task: "formatar",
      modelId: modelo.id,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      costSource: "desconhecido",
      durationMs: Date.now() - inicio,
      ok: false,
      errorCode: erro instanceof AppError ? erro.code : "INTERNAL_ERROR",
      localDay,
      noteId,
    });
    throw erro;
  }

  const apurado = custoDaResposta(resposta.usage, modelo);
  const comum = {
    userId,
    task: "formatar" as const,
    modelId: modelo.id,
    modelUsed: typeof resposta.model === "string" ? resposta.model : null,
    generationId: typeof resposta.id === "string" ? resposta.id : null,
    durationMs: Date.now() - inicio,
    localDay,
    noteId,
    ...apurado,
  };

  async function recusar(motivo: string): Promise<never> {
    await registrarUso({ ...comum, ok: false, errorCode: "RESPOSTA_INVALIDA" });
    throw new AppError(502, "RESPOSTA_INVALIDA", motivo);
  }

  const bruto = resposta.choices?.[0]?.message?.content;
  if (typeof bruto !== "string" || !bruto.trim()) {
    // Acontece de verdade: há modelos gratuitos que respondem 200 com conteúdo
    // vazio. A mensagem precisa dizer o que fazer, não só que falhou.
    return recusar(
      "O modelo não devolveu texto. A nota não foi alterada — tente outro modelo nos ajustes.",
    );
  }

  const formatado = desembrulharCerca(bruto, contentMd);
  if (!mesmosWikilinks(contentMd, formatado)) {
    return recusar("O modelo alterou um [[wikilink]]. A nota não foi alterada.");
  }

  await registrarUso({ ...comum, ok: true });

  const usage: AiCallUsage = {
    modelId: modelo.id,
    modelUsed: comum.modelUsed,
    promptTokens: apurado.promptTokens,
    completionTokens: apurado.completionTokens,
    costMicros: apurado.costMicros,
    costSource: apurado.costSource,
  };
  return { contentMd: formatado, usage };
}
