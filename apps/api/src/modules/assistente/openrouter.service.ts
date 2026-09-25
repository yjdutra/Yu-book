import { env } from "../../env.js";
import { AppError } from "../../lib/errors.js";

/**
 * Transporte para o OpenRouter — saída com **host fixo**.
 *
 * Como em `youtube.service.ts`, o alvo não vem do usuário nem do modelo: sai do
 * ambiente e nenhuma parte da URL é escolhida por quem chama. **Não há
 * superfície de SSRF aqui**, ao contrário da leitura de título dos links e da
 * ferramenta `open_page`, cujo alvo é de terceiro — por isso nada passa por
 * `pedirPublico` (INV-08). A busca na web é um campo `plugins` deste pedido, não
 * uma saída nossa.
 *
 * A diferença em relação às saídas de alvo de terceiro: lá a falha vira `null`
 * (o link é salvo mesmo assim) ou texto para o modelo (`open_page`). Aqui o erro
 * **sobe** com código estável — o usuário clicou num botão e precisa saber que
 * não aconteceu (RF-06).
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
 * O rótulo da chave que pode sair para o navegador.
 *
 * O rótulo padrão do provedor é o prefixo da própria chave (`sk-or-v1-…`).
 * Esconder isso no JSX não bastava: o corpo da resposta chega ao navegador, à
 * aba de rede e a qualquer cache no caminho. A redação pertence ao servidor, e
 * mora aqui para `saude()` e o painel do OpenRouter seguirem a mesma regra. Só
 * sai rótulo que a pessoa nomeou no painel do provedor.
 */
export function rotuloPublico(bruto: unknown): string | null {
  if (typeof bruto !== "string" || /^sk-/i.test(bruto)) return null;
  return bruto;
}

export interface OpcoesDoProvedor {
  metodo?: "GET" | "POST";
  corpo?: unknown;
  /**
   * Teto de tempo da chamada inteira. Num fluxo ele **não** para no primeiro
   * byte: o `AbortSignal` continua preso ao corpo, então o orçamento vale até
   * o último pedaço — que é o que se quer, porque um fluxo que trava no meio
   * prenderia a requisição para sempre.
   */
  orcamentoMs?: number;
  /// Trocável só nos testes, como em `temChave`.
  chave?: string | undefined;
  /// O catálogo de modelos é público no provedor. Marcar assim é o que faz a
  /// tela de ajustes continuar listando modelos num servidor sem chave — o
  /// que some sem chave é gerar texto, não olhar o cardápio (RNF-03).
  publico?: boolean;
  /**
   * Cancelamento de quem chama (Etapa E: "Cancelar" numa execução de rotina).
   * Combinado com o orçamento de tempo, e não no lugar dele: uma execução que
   * ninguém cancela continua precisando de teto de tempo por chamada.
   */
  signal?: AbortSignal;
  /**
   * Qual chave o provedor recusou, na frase do 401/403 — "a chave de
   * gerenciamento" em vez de "a chave configurada". Existe porque o painel do
   * OpenRouter fala com duas chaves, e "recusou a chave configurada" diante de
   * um `/credits` mandaria a pessoa conferir a chave errada.
   */
  nomeDaChave?: string;
  /// Frase que segue a recusa, dita por quem conhece o erro provável — no painel,
  /// colar a chave comum no lugar da de gerenciamento. Texto nosso, nunca do provedor.
  dicaSeRecusada?: string;
}

/**
 * Uma requisição ao provedor, com teto de tempo e erro traduzido para código
 * estável. Devolve a `Response` **sem consumir o corpo**: o chat precisa lê-lo
 * como fluxo, e `.json()` esperaria a resposta inteira — que é exatamente o
 * que streaming existe para não fazer.
 *
 * O erro **antes** do primeiro byte continua sendo um status HTTP comum, com
 * `application/json` no corpo, mesmo quando o pedido tinha `stream: true`
 * (medido em 2026-09-23: 429 no modelo saturado, 400 no modelo inexistente).
 * Por isso a tradução de erro vale para os dois caminhos sem ramo novo — o que
 * o fluxo acrescenta é o erro que chega **depois** do 200, e esse é assunto de
 * quem lê o fluxo.
 */
export async function abrirNoProvedor(
  caminho: string,
  opcoes: OpcoesDoProvedor = {},
): Promise<Response> {
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

  const prazo = AbortSignal.timeout(opcoes.orcamentoMs ?? ORCAMENTO_MS);
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: opcoes.metodo ?? "GET",
      headers: cabecalhos,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      signal: opcoes.signal ? AbortSignal.any([prazo, opcoes.signal]) : prazo,
    });
  } catch (erro) {
    /// Cancelado por quem chamou: sobe cru, sem virar "provedor indisponível".
    /// Quem cancelou sabe que cancelou (`signal.aborted`) e decide o registro.
    if (opcoes.signal?.aborted) throw erro;
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
      const qual = opcoes.nomeDaChave ?? "configurada";
      const dica = opcoes.dicaSeRecusada ? `. ${opcoes.dicaSeRecusada}` : "";
      throw indisponivel(`O provedor de IA recusou a chave ${qual} (${caminho})${dica}`);
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

  return resposta;
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
 *
 * Mora aqui, e não na tarefa, porque **toda** chamada de inferência precisa
 * dela: formatar nota e chat tomam a mesma decisão, e a Etapa A a deixou fixa
 * numa linha de `formatar.service.ts` — foi assim que ela atravessou uma etapa
 * inteira sendo escolha nossa escondida em vez de escolha do usuário.
 */
export function politicaDeDados(permiteTreino: boolean): Record<string, unknown> {
  return permiteTreino ? {} : { provider: { data_collection: "deny" } };
}

/** A mesma requisição, com o corpo já lido como JSON. `T` é conferido por quem chama. */
export async function pedirDoProvedor<T>(
  caminho: string,
  opcoes: OpcoesDoProvedor = {},
): Promise<T> {
  const resposta = await abrirNoProvedor(caminho, opcoes);
  return (await resposta.json()) as T;
}
