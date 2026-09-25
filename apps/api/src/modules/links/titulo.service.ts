import { pedirPublico, todosPublicos } from "../../lib/saidaSegura.js";
import type { Guarda } from "../../lib/saidaSegura.js";

/// A guarda de endereço mora em `lib/saidaSegura.ts` desde a Etapa G da
/// frente de IA, que abriu o segundo consumidor. Reexportada porque a suíte de
/// links a importa daqui.
export { ehEnderecoPublico } from "../../lib/saidaSegura.js";

/**
 * Leitor de título de página — um dos dois lugares do Yu-book em que o
 * servidor abre conexão para um endereço escolhido de fora (o outro é o
 * `open_page` do assistente, `modules/web/pagina.service.ts`). A saída em si,
 * com todas as defesas, é `pedirPublico`; aqui ficam só os limites deste uso
 * e a leitura do título. Ver seção 6.1 do PRD da Fase 3.
 */

const ORCAMENTO_MS = 2000; // RNF-03: tempo total, somando todos os saltos
const MAX_BYTES = 512 * 1024; // RNF-04
const MAX_SALTOS = 3; // RNF-02
const AGENTE = "Yu-book/1.0 (+leitor de titulo)";

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function limpar(bruto: string): string {
  return bruto
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTIDADES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTitulo(html: string): string | null {
  const og = html.match(
    /<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  if (og?.[1]) return limpar(og[1]);

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) return limpar(title[1]);

  return null;
}

/**
 * Devolve o título da página, ou `null` por qualquer motivo — DNS que não
 * resolve, destino interno, TLS quebrado, 404, timeout, corpo que não é HTML.
 *
 * RNF-05: quem chama trata `null` como "salva com o domínio". Falhar aqui
 * nunca pode impedir o link de ser salvo.
 */
export async function buscarTitulo(
  url: string,
  /**
   * Trocável **só nos testes**. Qualquer servidor de teste vive em 127.0.0.1,
   * que é justamente o que a guarda padrão recusa — sem esta costura não
   * haveria como exercitar redirecionamento, limite de tamanho e leitura de
   * título sem depender da internet. Produção nunca passa este argumento.
   */
  permitido: Guarda = todosPublicos,
): Promise<string | null> {
  const resposta = await pedirPublico(url, {
    orcamentoMs: ORCAMENTO_MS,
    maxBytes: MAX_BYTES,
    maxSaltos: MAX_SALTOS,
    aceitaTipo: (tipo) => tipo.includes("html"),
    cabecalhos: { "user-agent": AGENTE, accept: "text/html,application/xhtml+xml" },
    permitido,
  });
  if (!resposta.ok || resposta.status < 200 || resposta.status >= 300) return null;

  try {
    return extrairTitulo(new TextDecoder("utf-8").decode(resposta.corpo));
  } catch {
    return null;
  }
}
