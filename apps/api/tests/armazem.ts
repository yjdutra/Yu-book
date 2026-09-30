import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";

/**
 * O dublê do bucket S3 dos anexos (frente de cards, Parte 2), no molde de
 * `tests/provedor.ts`. Guarda o objeto inteiro — bytes e cabeçalhos — por
 * caminho, porque o que se confere é o que chegou ao bucket, e não o que a
 * API disse que mandou.
 *
 * A porta é a de `tests/setup.ts`, fixa porque `env.ts` congela o endereço na
 * importação. O caminho é `/<bucket>/<key>`: a suíte liga `S3_PATH_STYLE`,
 * porque subdomínio de `127.0.0.1` não resolve.
 *
 * Não confere a assinatura SigV4 — quem assina é `aws4fetch`, e o teste
 * afirma só que o cabeçalho de assinatura foi mandado.
 */

export const PORTA_DO_ARMAZEM = 39334;
export const BUCKET_DE_TESTE = "yubook-teste";

export interface ObjetoGuardado {
  corpo: Buffer;
  headers: IncomingHttpHeaders;
}

export interface PedidoRecebido {
  metodo: string;
  /// Sem a query: a URL assinada de leitura leva a assinatura nela.
  caminho: string;
  query: string;
  headers: IncomingHttpHeaders;
}

export interface DubleDoArmazem {
  server: Server;
  objetos: Map<string, ObjetoGuardado>;
  recebidas: PedidoRecebido[];
  /// Status forçado por método — é como o teste faz o bucket recusar.
  falhar: Partial<Record<"PUT" | "DELETE", number>>;
}

/** O caminho em que o dublê guarda uma chave. */
export const caminhoDaChave = (key: string) => `/${BUCKET_DE_TESTE}/${key}`;

/** Sobe o dublê na porta do `setup.ts`. Quem sobe fecha, no `afterAll`. */
export async function subirArmazem(): Promise<DubleDoArmazem> {
  const estado: DubleDoArmazem = {
    server: createServer(),
    objetos: new Map(),
    recebidas: [],
    falhar: {},
  };

  estado.server.on("request", (req, res) => {
    const bruto = req.url ?? "";
    const corte = bruto.indexOf("?");
    const caminho = decodeURIComponent(corte < 0 ? bruto : bruto.slice(0, corte));
    const query = corte < 0 ? "" : bruto.slice(corte + 1);
    const metodo = req.method ?? "";
    estado.recebidas.push({ metodo, caminho, query, headers: req.headers });

    const pedacos: Buffer[] = [];
    req.on("data", (c: Buffer) => pedacos.push(c));
    req.on("end", () => {
      const forcado = metodo === "PUT" || metodo === "DELETE" ? estado.falhar[metodo] : undefined;
      if (forcado !== undefined) {
        res.writeHead(forcado, { "content-type": "application/xml" });
        res.end("<Error><Code>InternalError</Code></Error>");
        return;
      }

      if (metodo === "PUT") {
        estado.objetos.set(caminho, { corpo: Buffer.concat(pedacos), headers: req.headers });
        res.writeHead(200);
        res.end();
        return;
      }

      if (metodo === "DELETE") {
        const existia = estado.objetos.delete(caminho);
        res.writeHead(existia ? 204 : 404);
        res.end();
        return;
      }

      if (metodo === "GET") {
        const objeto = estado.objetos.get(caminho);
        if (!objeto) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": String(objeto.headers["content-type"] ?? ""),
          "content-disposition": String(objeto.headers["content-disposition"] ?? ""),
        });
        res.end(objeto.corpo);
        return;
      }

      res.writeHead(405);
      res.end();
    });
  });

  await new Promise<void>((ok) => estado.server.listen(PORTA_DO_ARMAZEM, "127.0.0.1", ok));
  return estado;
}

export async function fecharArmazem(d: DubleDoArmazem): Promise<void> {
  if (!d.server.listening) return;
  await new Promise<void>((ok) => d.server.close(() => ok()));
}

/** Os pedidos de um método que chegaram ao dublê a partir de um marco. */
export const pedidosDesde = (d: DubleDoArmazem, marco: number, metodo?: string) =>
  d.recebidas.slice(marco).filter((p) => metodo === undefined || p.metodo === metodo);
