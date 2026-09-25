import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import * as zlib from "node:zlib";

/**
 * A saída para um endereço que **não** é nosso (INV-08, primeira classe: o
 * alvo vem de fora — do usuário que cola um link, ou do modelo que pede
 * `open_page`).
 *
 * Tudo aqui parte do princípio de que a URL é hostil: ela pode apontar para a
 * rede interna da Railway, redirecionar para lá depois do primeiro salto,
 * responder 2 GB de lixo ou nunca responder. Ver seção 6.1 do PRD da Fase 3.
 *
 * **O que esta função fecha e o `fetch` não fechava: DNS rebinding.** Até a
 * Etapa G o leitor de título conferia o IP com `dns.lookup` e depois chamava
 * `fetch`, que resolvia o nome **de novo**. Um DNS que responde público na
 * primeira pergunta e `127.0.0.1` na segunda passava pela guarda e conectava
 * no interno. Aqui o nome é resolvido uma vez por salto, a guarda confere
 * **esses** endereços, e o socket recebe exatamente eles pelo `lookup` da
 * conexão — não há segunda resolução para o atacante responder diferente. O
 * nome original continua indo no `Host` e no SNI, então TLS e hospedagem
 * virtual funcionam como antes.
 *
 * Por isso `node:http`/`node:https` e não `fetch`: o `fetch` do Node não aceita
 * `lookup` por requisição.
 */

/// RNF-02 da Fase 3.
const MAX_SALTOS_PADRAO = 3;

/** RNF-01 da Fase 3: só IP público passa. Na dúvida, recusa. */
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

export interface Resolvido {
  address: string;
  family: 4 | 6;
}

/** Nome → endereços. Trocável só em teste, para simular um DNS hostil. */
export type Resolvedor = (hostname: string) => Promise<Resolvido[]>;

/**
 * A guarda de cada salto: recebe o nome e **os endereços que o socket vai
 * usar**. Trocável só em teste — todo servidor de teste vive em 127.0.0.1, que
 * é justamente o que a guarda padrão recusa.
 */
export type Guarda = (hostname: string, enderecos: readonly Resolvido[]) => boolean | Promise<boolean>;

export const resolverNoSistema: Resolvedor = async (hostname) => {
  const enderecos = await lookup(hostname, { all: true });
  return enderecos.map((e) => ({ address: e.address, family: e.family === 6 ? 6 : 4 }));
};

/**
 * Exige que **todos** os endereços sejam públicos. Recusar quando só um é
 * interno fecha o truque de publicar um A record duplo, um público e um
 * privado, e torcer para o sorteio cair no lado errado.
 */
export const todosPublicos: Guarda = (_hostname, enderecos) =>
  enderecos.length > 0 && enderecos.every((e) => ehEnderecoPublico(e.address));

export interface PedidoPublico {
  /// Tempo total, somando resolução, todos os saltos e a leitura do corpo.
  orcamentoMs: number;
  /// Corte duro: o corpo devolvido nunca passa disto, já descomprimido.
  maxBytes: number;
  /// Recebe o `content-type` em minúsculas (vazio se não veio). Só vale para
  /// resposta 2xx — o status de erro é relatado sem ler corpo.
  aceitaTipo: (tipo: string) => boolean;
  cabecalhos: Record<string, string>;
  maxSaltos?: number;
  /// Recusa por nome, antes de resolver, a cada salto — o LinkedIn de
  /// `open_page`. Um redirecionamento para lá é recusado como o original.
  hostRecusado?: (hostname: string) => boolean;
  permitido?: Guarda;
  resolver?: Resolvedor;
}

export type MotivoDaRecusa =
  | "url_invalida"
  | "esquema"
  | "host_recusado"
  | "nao_resolve"
  | "nao_publico"
  | "saltos"
  | "tempo"
  | "rede"
  | "tipo";

export type RespostaPublica =
  | {
      ok: true;
      status: number;
      urlFinal: string;
      tipo: string;
      /// Vazio quando o status não é 2xx.
      corpo: Buffer;
      /// O corpo foi cortado em `maxBytes`.
      truncado: boolean;
    }
  | { ok: false; motivo: MotivoDaRecusa; urlFinal: string; tipo?: string };

/** `[::1]` → `::1`: o `URL` devolve o IPv6 literal entre colchetes. */
function semColchetes(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * O `lookup` da conexão: devolve os endereços **já conferidos**, sem resolver
 * nada. É a peça que fecha o rebinding. Atende as duas formas com que o Node
 * pergunta — `all: true` (a escolha de família automática, padrão desde o
 * Node 20) e um endereço só.
 */
function lookupPreso(enderecos: readonly Resolvido[]) {
  return (
    _hostname: string,
    opcoes: LookupOptions,
    callback: (
      erro: NodeJS.ErrnoException | null,
      endereco: string | LookupAddress[],
      familia?: number,
    ) => void,
  ): void => {
    const familia = opcoes.family === 4 || opcoes.family === 6 ? opcoes.family : null;
    const candidatos = familia ? enderecos.filter((e) => e.family === familia) : [...enderecos];
    const primeiro = candidatos[0];
    if (!primeiro) {
      const erro: NodeJS.ErrnoException = new Error("sem endereço conferido para a família");
      erro.code = "ENOTFOUND";
      callback(erro, "", undefined);
      return;
    }
    if (opcoes.all) {
      callback(
        null,
        candidatos.map((e) => ({ address: e.address, family: e.family })),
      );
    } else {
      callback(null, primeiro.address, primeiro.family);
    }
  };
}

type Salto =
  | { tipo: "redirecionar"; destino: string }
  | { tipo: "final"; status: number; conteudo: string; corpo: Buffer; truncado: boolean }
  | { tipo: "falha"; motivo: MotivoDaRecusa; conteudo?: string };

function descomprimido(resposta: IncomingMessage): Readable | null {
  const codificacao = String(resposta.headers["content-encoding"] ?? "")
    .toLowerCase()
    .trim();
  if (!codificacao || codificacao === "identity") return resposta;
  if (codificacao === "gzip" || codificacao === "x-gzip") {
    return resposta.pipe(zlib.createGunzip());
  }
  if (codificacao === "deflate") return resposta.pipe(zlib.createInflate());
  if (codificacao === "br") return resposta.pipe(zlib.createBrotliDecompress());
  return null;
}

/** Um salto: uma requisição GET, presa aos endereços conferidos. */
function umSalto(
  alvo: URL,
  enderecos: readonly Resolvido[],
  restanteMs: number,
  pedido: PedidoPublico,
): Promise<Salto> {
  return new Promise<Salto>((resolver) => {
    const host = semColchetes(alvo.hostname);
    const modulo = alvo.protocol === "https:" ? https : http;
    let terminou = false;
    let fluxo: Readable | null = null;

    const acabar = (salto: Salto) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(relogio);
      requisicao.destroy();
      fluxo?.destroy();
      resolver(salto);
    };

    const requisicao = modulo.request({
      protocol: alvo.protocol,
      hostname: host,
      port: alvo.port || undefined,
      path: `${alvo.pathname}${alvo.search}`,
      method: "GET",
      headers: { ...pedido.cabecalhos, "accept-encoding": "gzip, deflate, br" },
      lookup: lookupPreso(enderecos),
      /// SNI e verificação do certificado pelo **nome**, não pelo IP. IP
      /// literal não vai no SNI (a RFC 6066 não o admite).
      ...(alvo.protocol === "https:" && !isIP(host) && { servername: host }),
      /// Sem reaproveitar socket: cada salto conecta no endereço conferido
      /// agora, não num que ficou aberto de outra requisição.
      agent: false,
    });

    const relogio = setTimeout(() => acabar({ tipo: "falha", motivo: "tempo" }), restanteMs);

    requisicao.on("error", () => acabar({ tipo: "falha", motivo: "rede" }));

    requisicao.on("response", (resposta) => {
      const status = resposta.statusCode ?? 0;
      const conteudo = String(resposta.headers["content-type"] ?? "").toLowerCase();

      if (status >= 300 && status < 400 && resposta.headers.location) {
        acabar({ tipo: "redirecionar", destino: resposta.headers.location });
        return;
      }
      if (status < 200 || status >= 300) {
        acabar({ tipo: "final", status, conteudo, corpo: Buffer.alloc(0), truncado: false });
        return;
      }
      if (!pedido.aceitaTipo(conteudo)) {
        acabar({ tipo: "falha", motivo: "tipo", conteudo });
        return;
      }

      fluxo = descomprimido(resposta);
      if (!fluxo) {
        acabar({ tipo: "falha", motivo: "tipo", conteudo });
        return;
      }

      const partes: Buffer[] = [];
      let recebido = 0;
      fluxo.on("data", (pedaco: Buffer) => {
        if (terminou) return;
        const cabe = pedido.maxBytes - recebido;
        if (pedaco.length > cabe) {
          // Corte duro: para de ler no limite, sem esperar o resto. Pedaço que
          // enche o limite **exatamente** não corta aqui: só se sabe se havia
          // mais quando o próximo chega (então corta, `cabe` = 0) ou quando o
          // fluxo acaba (então não havia). O gunzip entrega 16 KiB por vez, e
          // 1 MB é múltiplo disso — sem esta regra o corte saía calado.
          partes.push(pedaco.subarray(0, cabe));
          acabar({ tipo: "final", status, conteudo, corpo: Buffer.concat(partes), truncado: true });
          return;
        }
        partes.push(pedaco);
        recebido += pedaco.length;
      });
      fluxo.on("end", () =>
        acabar({ tipo: "final", status, conteudo, corpo: Buffer.concat(partes), truncado: false }),
      );
      fluxo.on("error", () => acabar({ tipo: "falha", motivo: "rede" }));
      resposta.on("error", () => acabar({ tipo: "falha", motivo: "rede" }));
    });

    requisicao.end();
  });
}

/** Resolve dentro do orçamento; o que não resolve a tempo não vira conexão. */
async function resolverComPrazo(
  resolver: Resolvedor,
  hostname: string,
  restanteMs: number,
): Promise<Resolvido[] | "tempo" | "nao_resolve"> {
  let relogio: NodeJS.Timeout | undefined;
  const prazo = new Promise<"tempo">((ok) => {
    relogio = setTimeout(() => ok("tempo"), restanteMs);
  });
  try {
    return await Promise.race([resolver(hostname), prazo]);
  } catch {
    return "nao_resolve";
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * GET num endereço de terceiro, com as defesas inteiras: só `http`/`https`;
 * guarda de endereço **a cada salto**, antes de conectar; conexão presa aos
 * endereços conferidos; redirecionamento manual, até `maxSaltos`; orçamento
 * de tempo total; corte duro de bytes; `content-type` aceito por parâmetro.
 *
 * Nunca lança: toda falha volta como `{ ok: false, motivo }`, e quem chama
 * decide o que ela vira — `null` no título de link, texto para o modelo no
 * `open_page`.
 */
export async function pedirPublico(url: string, pedido: PedidoPublico): Promise<RespostaPublica> {
  const inicio = Date.now();
  const maxSaltos = pedido.maxSaltos ?? MAX_SALTOS_PADRAO;
  const permitido = pedido.permitido ?? todosPublicos;
  const resolver = pedido.resolver ?? resolverNoSistema;
  let atual = url;

  for (let salto = 0; salto <= maxSaltos; salto++) {
    const falha = (motivo: MotivoDaRecusa, tipo?: string): RespostaPublica => ({
      ok: false,
      motivo,
      urlFinal: atual,
      ...(tipo !== undefined && { tipo }),
    });

    const restante = () => pedido.orcamentoMs - (Date.now() - inicio);
    if (restante() <= 0) return falha("tempo");

    let alvo: URL;
    try {
      alvo = new URL(atual);
    } catch {
      return falha("url_invalida");
    }
    if (alvo.protocol !== "http:" && alvo.protocol !== "https:") return falha("esquema");

    const host = semColchetes(alvo.hostname);
    if (pedido.hostRecusado?.(host.toLowerCase().replace(/\.$/, ""))) {
      return falha("host_recusado");
    }

    // IP literal não passa pelo resolvedor: o Node não chama `lookup` para
    // ele, então o endereço conferido tem de ser o próprio literal — nenhum
    // resolvedor, nem o de teste, pode trocá-lo.
    const versao = isIP(host);
    let enderecos: Resolvido[];
    if (versao === 4 || versao === 6) {
      enderecos = [{ address: host, family: versao }];
    } else {
      const resolvidos = await resolverComPrazo(resolver, host, restante());
      if (resolvidos === "tempo") return falha("tempo");
      if (resolvidos === "nao_resolve" || resolvidos.length === 0) return falha("nao_resolve");
      enderecos = resolvidos;
    }

    // RNF-02 da Fase 3: cada salto é validado de novo. Redirecionar para
    // 127.0.0.1 é recusado exatamente como se fosse o endereço original.
    if (!(await permitido(host, enderecos))) return falha("nao_publico");

    const tempo = restante();
    if (tempo <= 0) return falha("tempo");
    const resultado = await umSalto(alvo, enderecos, tempo, pedido);

    if (resultado.tipo === "falha") return falha(resultado.motivo, resultado.conteudo);
    if (resultado.tipo === "final") {
      return {
        ok: true,
        status: resultado.status,
        urlFinal: alvo.toString(),
        tipo: resultado.conteudo,
        corpo: resultado.corpo,
        truncado: resultado.truncado,
      };
    }

    try {
      atual = new URL(resultado.destino, alvo).toString();
    } catch {
      return falha("url_invalida");
    }
  }

  return { ok: false, motivo: "saltos", urlFinal: atual };
}
