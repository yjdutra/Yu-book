import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult, JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { criarServidor } from "../src/servidor.js";

/**
 * Um cliente MCP em memória, falando JSON-RPC de verdade com o servidor.
 *
 * É o primeiro arnês deste tipo no repositório, e existe por um motivo que os
 * testes anteriores não alcançavam: eles constroem os objetos que a integração
 * deveria fornecer, então provam as peças e não a superfície. Os dois últimos
 * defeitos desta fase — o `client_id` vazio e o `McpServer` vazado — apareceram
 * à mão, contra o servidor de pé, justamente aí.
 *
 * **Não usa o `Client` do SDK, de propósito.** O que precisa ser controlado aqui
 * é o `authInfo` de **cada** mensagem, e o cliente do SDK não o envia. O
 * `InMemoryTransport.send(msg, { authInfo })` envia — o próprio SDK documenta o
 * parâmetro como "useful for testing authentication scenarios" —, e
 * `shared/protocol.js` o repassa para o `extra` do handler. É esse fio que
 * permite chamar uma tool de escrita com um token de leitura.
 *
 * Nada aqui toca rede: os dois transportes são o mesmo processo.
 */
/** O que o `tools/list` devolve, na parte de que os testes precisam. */
export interface ToolAnunciada {
  name: string;
  inputSchema: {
    properties?: Record<string, { type?: string; format?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

export interface ClienteDeTeste {
  listarTools(): Promise<ToolAnunciada[]>;
  chamarTool(nome: string, argumentos?: Record<string, unknown>): Promise<CallToolResult>;
  encerrar(): Promise<void>;
}

/** O `AuthInfo` que o SDK entregaria a partir de um token com estes escopos. */
export function identidade(escopos: string[], tokenDaApi = "TOKEN-DA-API"): AuthInfo {
  return {
    token: "irrelevante-para-o-teste",
    clientId: "cliente-de-teste",
    scopes: escopos,
    extra: { userId: "usuario-1", tokenDaApi },
  };
}

export async function abrirCliente(
  opcoes: { escrita: boolean; nomeDoCliente?: string },
  authInfo?: AuthInfo,
): Promise<ClienteDeTeste> {
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  const servidor = criarServidor({ escrita: opcoes.escrita });
  await servidor.connect(doServidor);

  // O SDK não expõe um "espere a resposta deste id", então a correspondência é
  // por `id` num mapa — é o mínimo que um cliente JSON-RPC precisa ter.
  const pendentes = new Map<number, (resposta: Record<string, unknown>) => void>();
  doCliente.onmessage = (mensagem) => {
    const m = mensagem as unknown as Record<string, unknown>;
    if (typeof m["id"] === "number") pendentes.get(m["id"])?.(m);
  };
  await doCliente.start();

  let proximoId = 0;
  async function pedir(metodo: string, params: unknown): Promise<Record<string, unknown>> {
    const id = ++proximoId;
    const resposta = new Promise<Record<string, unknown>>((resolver) => {
      pendentes.set(id, resolver);
    });
    await doCliente.send({ jsonrpc: "2.0", id, method: metodo, params } as JSONRPCMessage, {
      ...(authInfo && { authInfo }),
    });
    return resposta;
  }

  await pedir("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    // O `clientInfo` é uma das fontes do autor da marca de IA (`src/autor.ts`).
    clientInfo: { name: opcoes.nomeDoCliente ?? "arnes", version: "1" },
  });
  await doCliente.send({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage, {
    ...(authInfo && { authInfo }),
  });

  return {
    async listarTools() {
      const r = await pedir("tools/list", {});
      const resultado = r["result"] as { tools: ToolAnunciada[] };
      return [...resultado.tools].sort((a, b) => a.name.localeCompare(b.name));
    },

    async chamarTool(nome, argumentos = {}) {
      const r = await pedir("tools/call", { name: nome, arguments: argumentos });
      // Uma tool que nem existe volta como erro JSON-RPC, não como resultado —
      // e confundir os dois faria o teste passar por engano.
      if (r["error"]) {
        const erro = r["error"] as { message: string };
        throw new Error(`erro de protocolo em ${nome}: ${erro.message}`);
      }
      return r["result"] as CallToolResult;
    },

    async encerrar() {
      await doCliente.close();
      await servidor.close();
    },
  };
}
