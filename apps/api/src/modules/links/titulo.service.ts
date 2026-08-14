import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Leitor de título de página — o único lugar do Yu-book em que o servidor
 * abre conexão para um endereço escolhido por quem chama.
 *
 * A aplicação fica exposta na internet, então tudo aqui é escrito partindo do
 * princípio de que a URL é hostil: ela pode apontar para a rede interna da
 * Railway, redirecionar para lá depois do primeiro salto, responder 2 GB de
 * lixo ou simplesmente nunca responder. Ver seção 6.1 do PRD da Fase 3.
 */

const ORCAMENTO_MS = 2000; // RNF-03: tempo total, somando todos os saltos
const MAX_BYTES = 512 * 1024; // RNF-04
const MAX_SALTOS = 3; // RNF-02
const AGENTE = "Yu-book/1.0 (+leitor de titulo)";

/** RNF-01: só IP público passa. Na dúvida, recusa. */
export function ehEnderecoPublico(ip: string): boolean {
  const versao = isIP(ip);
  if (versao === 4) return ehIpv4Publico(ip);
  if (versao === 6) return ehIpv6Publico(ip);
  return false;
}

function ehIpv4Publico(ip: string): boolean {
  const partes = ip.split(".").map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a = 0, b = 0] = partes;

  if (a === 0) return false; // "este host"
  if (a === 10) return false; // privado
  if (a === 127) return false; // laço
  if (a === 169 && b === 254) return false; // link-local — inclui 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return false; // privado
  if (a === 192 && b === 168) return false; // privado
  if (a === 192 && b === 0) return false; // 192.0.0.0/24, uso especial
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmark
  if (a >= 224) return false; // multicast e reservado

  return true;
}

function ehIpv6Publico(ip: string): boolean {
  const endereco = ip.toLowerCase().split("%")[0] ?? "";

  // IPv4 embutido (`::ffff:127.0.0.1`) vale pelo endereço que carrega.
  const mapeado = endereco.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado?.[1]) return ehIpv4Publico(mapeado[1]);

  // Qualquer coisa começando em `::` é laço, não especificado ou mapeado.
  if (endereco.startsWith("::")) return false;

  const primeiroHextet = Number.parseInt(endereco.split(":")[0] ?? "", 16);
  if (Number.isNaN(primeiroHextet)) return false;

  // Unicast global é 2000::/3 e nada mais. Fora disso (laço, ULA fc00::/7,
  // link-local fe80::/10, multicast ff00::/8, reservado) não se conecta.
  const primeiroByte = primeiroHextet >> 8;
  return primeiroByte >= 0x20 && primeiroByte <= 0x3f;
}

/**
 * Resolve o nome e exige que **todos** os endereços sejam públicos.
 *
 * Recusar quando só um dos endereços é interno fecha o truque de publicar um
 * A record duplo, um público e um privado, e torcer para o sorteio cair no
 * lado errado.
 */
export async function destinoPermitido(hostname: string): Promise<boolean> {
  try {
    const enderecos = await lookup(hostname, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => ehEnderecoPublico(e.address));
  } catch {
    return false; // nome que não resolve não vira conexão
  }
}

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

/** RNF-04: para de ler no limite, sem esperar o corpo inteiro. */
async function lerLimitado(resposta: Response): Promise<string> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return "";

  const partes: Uint8Array[] = [];
  let recebido = 0;

  try {
    while (recebido < MAX_BYTES) {
      const { done, value } = await leitor.read();
      if (done) break;
      if (value) {
        partes.push(value);
        recebido += value.length;
      }
    }
  } finally {
    await leitor.cancel().catch(() => undefined);
  }

  return new TextDecoder("utf-8").decode(Buffer.concat(partes));
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
   * que é justamente o que `destinoPermitido` recusa — sem esta costura não
   * haveria como exercitar redirecionamento, limite de tamanho e leitura de
   * título sem depender da internet. Produção nunca passa este argumento.
   */
  permitido: (hostname: string) => Promise<boolean> = destinoPermitido,
): Promise<string | null> {
  const inicio = Date.now();
  let atual = url;

  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    const restante = ORCAMENTO_MS - (Date.now() - inicio);
    if (restante <= 0) return null;

    let alvo: URL;
    try {
      alvo = new URL(atual);
    } catch {
      return null;
    }
    if (alvo.protocol !== "http:" && alvo.protocol !== "https:") return null;

    // RNF-02: cada salto é validado de novo. Redirecionar para 127.0.0.1 é
    // recusado exatamente como se fosse o endereço original.
    if (!(await permitido(alvo.hostname))) return null;

    let resposta: Response;
    try {
      resposta = await fetch(alvo, {
        redirect: "manual",
        signal: AbortSignal.timeout(restante),
        headers: { "user-agent": AGENTE, accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      return null;
    }

    if (resposta.status >= 300 && resposta.status < 400) {
      const destino = resposta.headers.get("location");
      if (!destino) return null;
      await resposta.body?.cancel().catch(() => undefined);
      atual = new URL(destino, alvo).toString();
      continue;
    }

    if (!resposta.ok) {
      await resposta.body?.cancel().catch(() => undefined);
      return null;
    }

    const tipo = resposta.headers.get("content-type") ?? "";
    if (!tipo.includes("html")) {
      await resposta.body?.cancel().catch(() => undefined);
      return null;
    }

    try {
      return extrairTitulo(await lerLimitado(resposta));
    } catch {
      return null;
    }
  }

  return null; // saltos demais
}
