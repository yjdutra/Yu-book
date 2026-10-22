import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { AiHealth } from "@yu-book/shared";
import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";

/**
 * Transporte para a API da Anthropic — o segundo provedor, onde caem os
 * créditos mensais do plano do Claude (docs/plano-provedor-anthropic.md).
 *
 * Saída com **host fixo**, como `openrouter.service.ts`: o alvo vem do ambiente
 * e nenhuma parte dele é escolhida por quem chama, então não há superfície de
 * SSRF e nada passa por `saidaSegura.ts` (INV-08). A busca na web é uma
 * ferramenta de servidor da própria Anthropic, não uma saída nossa.
 *
 * Pelo **SDK oficial**, e não por `fetch` à mão nem por um endpoint
 * "compatível com OpenAI": o formato de mensagens, o fluxo e os erros são os
 * da Anthropic, e o SDK é quem os acompanha. O que este módulo acrescenta é o
 * que o resto do Yu-book espera de um provedor: erro com código estável, a
 * guarda que impede a suíte de gastar de verdade, e a saúde sem inferência.
 */

/**
 * Sem isto, um dia em que `tests/setup.ts` não rodar, a suíte chama a
 * Anthropic de verdade e ninguém descobre pela saída verde — mesma razão de
 * `garantirDestinoDeTeste` no OpenRouter. Aqui a regra é pelo host do dublê,
 * não pelo do provedor, porque é o SDK quem monta a URL.
 */
function garantirDestinoDeTeste(baseUrl: string): void {
  if (env.NODE_ENV === "test" && new URL(baseUrl).hostname !== "127.0.0.1") {
    throw new Error(
      "teste tentou falar com a Anthropic de verdade — aponte ANTHROPIC_BASE_URL para o dublê",
    );
  }
}

/**
 * Sem chave, os modelos da Anthropic ficam indisponíveis e o resto não muda
 * (RNF-03). Parâmetro obrigatório e sem valor padrão, pelo motivo escrito em
 * `temChave` do OpenRouter: um padrão cairia na chave do ambiente justamente
 * no teste de "sem chave".
 */
export function temChaveAnthropic(chave: string | undefined): boolean {
  return Boolean(chave);
}

export interface OpcoesDoCliente {
  /// Trocável só nos testes, como em `temChaveAnthropic`.
  chave?: string | undefined;
  /// Teto de tempo da chamada inteira, fluxo incluído.
  orcamentoMs: number;
}

/**
 * Um cliente do SDK, com a chave do ambiente ou a injetada.
 *
 * `maxRetries: 0` de propósito: o SDK repete 429 e 5xx sozinho, e uma
 * repetição invisível é uma chamada que o teto diário não conferiu (INV-47) e
 * que o registro de uso não vê. Quem decide tentar de novo é quem chama, com o
 * teto na frente — como sempre foi com o OpenRouter.
 */
export function clienteAnthropic(opcoes: OpcoesDoCliente): Anthropic {
  const chave = "chave" in opcoes ? opcoes.chave : env.ANTHROPIC_API_KEY;
  if (!temChaveAnthropic(chave)) {
    throw new AppError(
      503,
      "PROVEDOR_INDISPONIVEL",
      "Nenhuma chave da Anthropic configurada no servidor (ANTHROPIC_API_KEY)",
    );
  }
  garantirDestinoDeTeste(env.ANTHROPIC_BASE_URL);
  return new Anthropic({
    apiKey: chave,
    baseURL: env.ANTHROPIC_BASE_URL,
    timeout: opcoes.orcamentoMs,
    maxRetries: 0,
  });
}

/**
 * A mensagem que a Anthropic pôs no corpo do erro, truncada — é texto de
 * terceiro e vai parar na tela. O corpo é `{ type: "error", error: { type,
 * message } }`, e o SDK o expõe em `erro.error`.
 */
function mensagemDaAnthropic(erro: APIError): string {
  const corpo = erro.error as { error?: { message?: unknown } } | undefined;
  const mensagem = corpo?.error?.message;
  return typeof mensagem === "string" ? mensagem.slice(0, 200) : "";
}

/**
 * Traduz o erro do SDK para os mesmos códigos estáveis do OpenRouter, para a
 * tela e os chamadores não precisarem saber qual provedor falhou.
 *
 * Devolve o erro a lançar — quem chama faz `throw traduzirErroAnthropic(e)`, e
 * o que não é do SDK volta como veio: um defeito nosso não pode se disfarçar
 * de provedor indisponível. Cancelamento por quem chamou também volta cru;
 * quem cancelou sabe que cancelou (`signal.aborted`).
 */
export function traduzirErroAnthropic(erro: unknown): unknown {
  if (erro instanceof Anthropic.APIUserAbortError) return erro;
  if (erro instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError(504, "PROVEDOR_DEMOROU", "A Anthropic não respondeu a tempo");
  }
  if (erro instanceof Anthropic.APIConnectionError) {
    return new AppError(503, "PROVEDOR_INDISPONIVEL", "Não foi possível falar com a Anthropic");
  }
  if (!(erro instanceof Anthropic.APIError)) return erro;

  /// Sem o detalhe, como no OpenRouter: é onde o provedor pode ecoar a chave.
  if (
    erro instanceof Anthropic.AuthenticationError ||
    erro instanceof Anthropic.PermissionDeniedError
  ) {
    return new AppError(503, "PROVEDOR_INDISPONIVEL", "A Anthropic recusou a chave configurada");
  }

  const detalhe = mensagemDaAnthropic(erro);
  if (erro instanceof Anthropic.RateLimitError) {
    return new AppError(
      402,
      "COTA_EXCEDIDA",
      `A Anthropic recusou por limite de uso${detalhe ? ` — ${detalhe}` : ""}. Tente mais tarde.`,
    );
  }
  /// Crédito acabado não é 402 na Anthropic: é 400 com "credit balance is too
  /// low" na mensagem. Para quem está na tela é a mesma situação da cota.
  if (erro.status === 400 && /credit balance/i.test(detalhe)) {
    return new AppError(
      402,
      "COTA_EXCEDIDA",
      "Os créditos da API da Anthropic acabaram. Recarregue em platform.claude.com " +
        "ou troque o modelo.",
    );
  }
  return new AppError(
    503,
    "PROVEDOR_INDISPONIVEL",
    `A Anthropic respondeu ${erro.status ?? "com erro"}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

/// Checagem de chave é leve; não vale esperar um orçamento de geração.
const ORCAMENTO_SAUDE_MS = 5_000;

/**
 * RF-08 para a Anthropic: diz se a chave responde, **sem inferência** — lista
 * um modelo só. A Anthropic não tem rótulo de chave legível pela própria
 * chave, então `label` é sempre `null`.
 */
export async function saudeAnthropic(
  opcoes: { chave?: string | undefined } = {},
): Promise<AiHealth> {
  const chave = "chave" in opcoes ? opcoes.chave : env.ANTHROPIC_API_KEY;
  const checkedAt = new Date().toISOString();
  const base = { provider: "anthropic" as const, label: null, checkedAt };

  /// Sem chave, nenhuma conexão é aberta (CA-02).
  if (!temChaveAnthropic(chave)) return { ...base, configured: false, reachable: false };

  try {
    await clienteAnthropic({ chave, orcamentoMs: ORCAMENTO_SAUDE_MS }).models.list({ limit: 1 });
    return { ...base, configured: true, reachable: true };
  } catch (erro) {
    const traduzido = traduzirErroAnthropic(erro);
    if (!(traduzido instanceof AppError)) throw traduzido;
    return { ...base, configured: true, reachable: false };
  }
}
