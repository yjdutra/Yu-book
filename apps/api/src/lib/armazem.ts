import { AwsClient } from "aws4fetch";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../env.js";
import { AppError } from "./errors.js";

/**
 * Transporte para o bucket dos anexos (frente de cards, Parte 2) — saída com
 * **host fixo**, como `openrouter.service.ts`: o endereço sai do ambiente, e a
 * chave do objeto é montada pelo servidor (`cards/<cardId>/<uuid>`), sem nada
 * escolhido pelo usuário. Não há superfície de SSRF aqui, e nada passa por
 * `pedirPublico` (INV-08).
 *
 * S3 por `aws4fetch` — assinatura SigV4 sobre o `fetch` global —, e não pelo
 * SDK da AWS: o que se usa são três operações (PUT, DELETE e a URL de leitura
 * pré-assinada), e o SDK traria megabytes de cliente para elas.
 *
 * A leitura **não passa pela API**: o front recebe uma URL assinada de uma hora
 * e o `<img>` lê direto do bucket. É o que deixa de fora o token em memória e o
 * CORP `same-origin` do helmet.
 */

export interface ConfigDoArmazem {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathStyle: boolean;
}

interface FonteDaConfig {
  S3_ENDPOINT?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  S3_REGION: string;
  S3_PATH_STYLE: boolean;
}

/**
 * Sem as quatro variáveis, os anexos ficam indisponíveis e o resto do app não
 * muda (RNF-03). Recebe a fonte por parâmetro, e não lê `env` direto: o `env`
 * congela na importação, e é assim que a suíte testa o caso "sem bucket".
 */
export function configDoArmazem(fonte: FonteDaConfig): ConfigDoArmazem | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = fonte;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: S3_ENDPOINT,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    region: fonte.S3_REGION,
    pathStyle: fonte.S3_PATH_STYLE,
  };
}

const config = configDoArmazem(env);
const cliente = config
  ? new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: config.region,
      // A repetição é nossa decisão, não da biblioteca: um PUT de 25 MB
      // repetido em silêncio prenderia a requisição do usuário.
      retries: 0,
    })
  : null;

/// O upload de 25 MB atravessa a rede da Railway até o bucket; o resto é leve.
const ORCAMENTO_ENVIO_MS = 60_000;
const ORCAMENTO_MS = 10_000;

/// Quantos DELETE ao bucket de uma vez, na exclusão em massa.
const APAGAR_POR_VEZ = 8;

/// Uma hora: o front mantém a lista por 30 minutos, abaixo disto.
export const VALIDADE_DA_URL_S = 3600;

export function armazemDisponivel(): boolean {
  return config !== null;
}

function indisponivel(motivo: string): AppError {
  return new AppError(503, "ARMAZENAMENTO_INDISPONIVEL", motivo);
}

function exigir(): { cfg: ConfigDoArmazem; aws: AwsClient } {
  if (!config || !cliente) {
    throw indisponivel("Anexos indisponíveis: o armazenamento não está configurado no servidor");
  }
  return { cfg: config, aws: cliente };
}

/**
 * Quem apaga objeto depois de um commit não pode falhar a requisição por isso
 * — o card já saiu do banco. A falha vira log, e o log precisa de um logger que
 * só o Fastify tem. `app.ts` o entrega aqui uma vez, na montagem.
 */
let registro: Pick<FastifyBaseLogger, "warn"> | null = null;

export function usarRegistro(logger: Pick<FastifyBaseLogger, "warn">): void {
  registro = logger;
}

/**
 * Mesma defesa de `openrouter.service.ts`: sem isto, um dia em que o
 * `tests/setup.ts` não rodar a suíte grava no bucket de verdade.
 */
function garantirDestinoDeTeste(url: string): void {
  if (env.NODE_ENV === "test" && new URL(url).hostname !== "127.0.0.1") {
    throw new Error(
      "teste tentou falar com um bucket de verdade — aponte S3_ENDPOINT para o dublê",
    );
  }
}

/// Cada segmento codificado, a barra preservada: a chave é `cards/<id>/<uuid>`.
/// Exportada só para a suíte, que não alcança o estilo virtual-hosted pela rede.
export function urlDoObjeto(cfg: ConfigDoArmazem, key: string): string {
  const base = new URL(cfg.endpoint);
  const caminho = key.split("/").map(encodeURIComponent).join("/");
  // O bucket da Railway fala só virtual-hosted; o caminho é do dublê local.
  return cfg.pathStyle
    ? `${base.origin}/${cfg.bucket}/${caminho}`
    : `${base.protocol}//${cfg.bucket}.${base.host}/${caminho}`;
}

async function executar(pedido: Request, orcamentoMs: number): Promise<Response> {
  try {
    return await fetch(pedido, { signal: AbortSignal.timeout(orcamentoMs) });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "TimeoutError") {
      throw indisponivel("O armazenamento de anexos não respondeu a tempo");
    }
    throw indisponivel("Não foi possível falar com o armazenamento de anexos");
  }
}

/**
 * Grava o objeto com o tipo e a disposição **no próprio objeto**: a URL
 * assinada de leitura já sai abrindo a imagem na tela e baixando o resto com
 * o nome certo, sem depender de o bucket aceitar sobrescrita por parâmetro.
 */
export async function guardarObjeto(
  key: string,
  corpo: Uint8Array,
  tipo: string,
  disposicao: string,
): Promise<void> {
  const { cfg, aws } = exigir();
  const url = urlDoObjeto(cfg, key);
  garantirDestinoDeTeste(url);

  const pedido = await aws.sign(url, {
    method: "PUT",
    body: corpo,
    headers: { "content-type": tipo, "content-disposition": disposicao },
  });
  const resposta = await executar(pedido, ORCAMENTO_ENVIO_MS);
  if (!resposta.ok) {
    // O corpo do erro do S3 é XML de terceiro: não vai para a tela.
    throw indisponivel(`O armazenamento recusou o arquivo (status ${resposta.status})`);
  }
}

/** A leitura de uma hora. Não sai rede nenhuma: é só assinatura. */
export async function urlAssinada(key: string): Promise<string> {
  const { cfg, aws } = exigir();
  const url = new URL(urlDoObjeto(cfg, key));
  url.searchParams.set("X-Amz-Expires", String(VALIDADE_DA_URL_S));
  const pedido = await aws.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return pedido.url;
}

/**
 * Apaga os objetos, com o melhor esforço. Nunca lança: roda depois do commit,
 * e a linha no banco já não existe — falhar aqui só deixaria o usuário com um
 * erro sobre algo que ele já não vê. O que não saiu fica órfão no bucket e no
 * log; a varredura de órfãos é dívida declarada.
 *
 * Sem bucket configurado não há o que apagar — mas, se houver chave, é porque
 * o bucket foi desligado depois de usado, e isso também vai para o log.
 */
export async function apagarObjetos(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  if (!config || !cliente) {
    registro?.warn({ total: keys.length }, "anexos sem bucket configurado ficaram órfãos");
    return;
  }
  const cfg = config;
  const aws = cliente;

  const apagar = async (key: string) => {
    const url = urlDoObjeto(cfg, key);
    garantirDestinoDeTeste(url);
    const resposta = await executar(await aws.sign(url, { method: "DELETE" }), ORCAMENTO_MS);
    // 404 é sucesso: o objeto já não estava lá.
    if (!resposta.ok && resposta.status !== 404) throw new Error(`status ${resposta.status}`);
  };

  // Em levas: um workspace com centenas de anexos não pode abrir centenas de
  // conexões de uma vez — o bucket responderia "devagar" a metade delas, e
  // cada uma viraria órfão no log.
  const falhas: string[] = [];
  for (let i = 0; i < keys.length; i += APAGAR_POR_VEZ) {
    const leva = keys.slice(i, i + APAGAR_POR_VEZ);
    const resultados = await Promise.allSettled(leva.map(apagar));
    falhas.push(...leva.filter((_, j) => resultados[j]?.status === "rejected"));
  }
  if (falhas.length > 0) {
    registro?.warn({ falhas }, "não foi possível apagar anexos do bucket");
  }
}
