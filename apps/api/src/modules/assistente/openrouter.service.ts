import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";

/**
 * Transporte para o OpenRouter — o **terceiro** ponto em que este servidor abre
 * conexão para fora, e o segundo com host fixo.
 *
 * Como em `youtube.service.ts`, o alvo não vem do usuário: sai do ambiente e
 * nenhuma parte da URL é escolhida por quem chama. **Não há superfície de SSRF
 * aqui**, ao contrário da busca genérica de título — por isso nada passa por
 * `destinoPermitido`.
 *
 * A diferença em relação aos outros dois: lá falhar vira `null`, porque não pode
 * impedir o link de ser salvo. Aqui o erro **sobe** com código estável — o
 * usuário clicou num botão e precisa saber que não aconteceu (RF-06).
 */

/// Leitura de metadado é barata; geração de texto não passa por aqui ainda.
const ORCAMENTO_MS = 8_000;

/**
 * Sem isto, um dia em que o `tests/setup.ts` não rodar — arquivo novo, runner
 * novo — a suíte chama o OpenRouter de verdade e ninguém descobre pela saída
 * verde. É a diferença entre "tomamos cuidado" e "não dá".
 */
function garantirDestinoDeTeste(url: string): void {
  if (env.NODE_ENV === "test" && url.includes("openrouter.ai")) {
    throw new Error(
      "teste tentou falar com o OpenRouter de verdade — aponte OPENROUTER_BASE_URL para o dublê",
    );
  }
}

/**
 * A mensagem que o provedor pôs no corpo do erro, quando pôs.
 *
 * Truncada: é texto de terceiro e vai parar na tela. Se não for o JSON
 * esperado, devolve vazio — nunca despeja HTML de página de erro na interface.
 */
function mensagemDoProvedor(corpo: string): string {
  try {
    const json = JSON.parse(corpo) as { error?: { message?: unknown } };
    const mensagem = json.error?.message;
    return typeof mensagem === "string" ? mensagem.slice(0, 200) : "";
  } catch {
    return "";
  }
}

function indisponivel(motivo: string): AppError {
  return new AppError(503, "PROVEDOR_INDISPONIVEL", motivo);
}

/**
 * Sem chave o módulo inteiro fica indisponível, e o resto do app não muda (RNF-03).
 *
 * O parâmetro é **obrigatório, e sem valor padrão de propósito**: um padrão é
 * aplicado quando o argumento é `undefined`, então `temChave(chaveQueNaoExiste)`
 * cairia de volta na chave do ambiente e responderia `true` — foi exatamente
 * isso que fez o teste de "sem chave" passar a mentir quando a suíte ganhou uma
 * chave de mentira. Quem quer a do ambiente passa `env.OPENROUTER_API_KEY`.
 */
export function temChave(chave: string | undefined): boolean {
  return Boolean(chave);
}

/**
 * Uma requisição ao provedor, com teto de tempo e erro traduzido para código
 * estável. `T` é a forma do corpo, conferida por quem chama.
 */
export async function pedirDoProvedor<T>(
  caminho: string,
  opcoes: {
    metodo?: "GET" | "POST";
    corpo?: unknown;
    orcamentoMs?: number;
    /// Trocável só nos testes, como em `temChave`.
    chave?: string | undefined;
    /// O catálogo de modelos é público no provedor. Marcar assim é o que faz a
    /// tela de ajustes continuar listando modelos num servidor sem chave — o
    /// que some sem chave é gerar texto, não olhar o cardápio (RNF-03).
    publico?: boolean;
  } = {},
): Promise<T> {
  const chave = "chave" in opcoes ? opcoes.chave : env.OPENROUTER_API_KEY;
  if (!chave && !opcoes.publico) {
    throw indisponivel("Nenhuma chave de IA configurada no servidor");
  }

  const url = `${env.OPENROUTER_BASE_URL.replace(/\/$/, "")}${caminho}`;
  garantirDestinoDeTeste(url);

  const cabecalhos: Record<string, string> = {};
  if (chave) cabecalhos["Authorization"] = `Bearer ${chave}`;
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  /// Atribuição no painel do provedor. Opcional, e a chamada funciona sem ela.
  if (env.OPENROUTER_APP_URL) {
    cabecalhos["HTTP-Referer"] = env.OPENROUTER_APP_URL;
    cabecalhos["X-Title"] = "Yu-book";
  }

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: opcoes.metodo ?? "GET",
      headers: cabecalhos,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      signal: AbortSignal.timeout(opcoes.orcamentoMs ?? ORCAMENTO_MS),
    });
  } catch (erro) {
    /// `AbortSignal.timeout` rejeita com `TimeoutError`; queda de rede, com `TypeError`.
    if (erro instanceof DOMException && erro.name === "TimeoutError") {
      throw new AppError(504, "PROVEDOR_DEMOROU", "O provedor de IA não respondeu a tempo");
    }
    throw indisponivel("Não foi possível falar com o provedor de IA");
  }

  if (!resposta.ok) {
    /// O que o provedor disse, e em qual caminho. Sem isto a mensagem é
    /// "respondeu 404" e não diz a ninguém o que fazer — e o 404 mais provável
    /// não vem do provedor recusar, vem de `OPENROUTER_BASE_URL` apontar para
    /// um caminho que não existe (sem `/v1`, por exemplo). O caminho é literal
    /// e não carrega chave nem dado do usuário.
    const detalhe = mensagemDoProvedor(await resposta.text().catch(() => ""));
    const onde = `${caminho}${detalhe ? ` — ${detalhe}` : ""}`;

    if (resposta.status === 401 || resposta.status === 403) {
      /// Sem o `detalhe` aqui, e só aqui: é o ramo em que o provedor costuma
      /// ecoar a credencial na própria mensagem ("Invalid API key: sk-…"), e
      /// 200 caracteres cabem um prefixo de chave com folga. É também onde o
      /// detalhe menos acrescenta — a frase já diz o que aconteceu.
      throw indisponivel(`O provedor de IA recusou a chave configurada (${caminho})`);
    }
    /// 402 é crédito acabado; 429 é limite de taxa **ou** cota diária do modelo
    /// gratuito. Os dois pedem a mesma coisa de quem está na tela: esperar.
    if (resposta.status === 402 || resposta.status === 429) {
      throw new AppError(
        402,
        "COTA_EXCEDIDA",
        `O provedor de IA recusou por cota ou limite de uso (${onde}). Tente mais tarde.`,
      );
    }
    throw indisponivel(`O provedor de IA respondeu ${resposta.status} em ${onde}`);
  }

  return (await resposta.json()) as T;
}
