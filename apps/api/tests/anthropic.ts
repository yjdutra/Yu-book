import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";

/**
 * O dublê da API da Anthropic, o segundo provedor de IA. A porta é a de
 * `tests/setup.ts`, fixa porque `env.ts` congela o endereço na importação.
 *
 * Responde na forma da API real — é o SDK oficial quem o consome, e um corpo
 * fora da forma faria o SDK falhar antes do código do Yu-book.
 */

export const PORTA_ANTHROPIC = 39336;

/**
 * Três modelos: dois com preço na tabela de `packages/shared` e um que a
 * tabela não conhece — esse tem de ficar fora do catálogo. Campos na forma de
 * `GET /v1/models`, com `capabilities` reduzido ao que o catálogo lê.
 */
export const MODELOS_ANTHROPIC = [
  {
    type: "model",
    id: "claude-opus-5-5",
    display_name: "Claude Opus 5.5",
    created_at: "2026-09-01T00:00:00Z",
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: { image_input: { supported: true }, thinking: { supported: true } },
  },
  {
    type: "model",
    id: "claude-haiku-5-5",
    display_name: "Claude Haiku 5.5",
    created_at: "2026-09-01T00:00:00Z",
    max_input_tokens: 1_000_000,
    max_tokens: 64_000,
    capabilities: { image_input: { supported: false }, thinking: { supported: true } },
  },
  {
    type: "model",
    id: "claude-sem-preco-9",
    display_name: "Claude Sem Preço 9",
    created_at: "2026-10-01T00:00:00Z",
    max_input_tokens: 200_000,
    max_tokens: 64_000,
    capabilities: { image_input: { supported: true }, thinking: { supported: true } },
  },
];

export interface RespostaDoDublê {
  status?: number;
  corpo?: unknown;
}

/**
 * Um turno roteirizado de `POST /v1/messages`, consumido em ordem (F2).
 *
 * - `texto`: uma fala, fatiada em pedaços;
 * - `ferramenta`: um bloco de pensamento com assinatura e um `tool_use`, com
 *   os argumentos fatiados em `input_json_delta` — é o par que tem de voltar
 *   intacto no passo seguinte;
 * - `busca`: a busca do servidor (`server_tool_use` + resultado) e uma fala
 *   com citação, cobrando uma busca no `usage`;
 * - `recusa` e `cortada`: 200 com `stop_reason` de `refusal` e `max_tokens`;
 * - `erro`: status e mensagem do corpo de erro, antes do primeiro byte.
 */
export type TurnoAnthropic =
  | { tipo: "texto"; texto: string }
  | { tipo: "ferramenta"; nome: string; argumentos: string; cortada?: boolean }
  | { tipo: "pausa"; texto: string }
  | { tipo: "busca"; texto: string; url: string; titulo: string }
  | { tipo: "recusa" }
  | { tipo: "cortada"; texto: string }
  | { tipo: "erro"; status: number; mensagem: string };

/// O `usage` que todo turno devolve: números redondos para a conta do custo.
export const USO_DO_TURNO = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_creation_input_tokens: 2_000,
  cache_read_input_tokens: 10_000,
};

export interface DubleAnthropic {
  server: Server;
  /// `MÉTODO caminho`, na ordem em que chegaram.
  recebidas: string[];
  cabecalhos: IncomingHttpHeaders[];
  corpos: Record<string, unknown>[];
  responder: (metodo: string, url: string) => RespostaDoDublê;
  /// Os turnos de `POST /v1/messages`, consumidos um por pedido.
  roteiro: TurnoAnthropic[];
}

function evento(nome: string, dados: Record<string, unknown>): string {
  return `event: ${nome}\ndata: ${JSON.stringify({ type: nome, ...dados })}\n\n`;
}

/** Um texto em três pedaços, no bloco `indice`. */
function blocoDeTexto(indice: number, texto: string, citacao?: Record<string, unknown>): string[] {
  const terco = Math.ceil(texto.length / 3) || 1;
  const pedacos = [texto.slice(0, terco), texto.slice(terco, terco * 2), texto.slice(terco * 2)];
  return [
    evento("content_block_start", {
      index: indice,
      content_block: { type: "text", text: "", ...(citacao && { citations: [] }) },
    }),
    ...(citacao
      ? [
          evento("content_block_delta", {
            index: indice,
            delta: { type: "citations_delta", citation: citacao },
          }),
        ]
      : []),
    ...pedacos
      .filter((p) => p.length > 0)
      .map((p) =>
        evento("content_block_delta", { index: indice, delta: { type: "text_delta", text: p } }),
      ),
    evento("content_block_stop", { index: indice }),
  ];
}

/** O turno no formato `text/event-stream` da Anthropic, como o SDK o lê. */
export function sseDoTurno(turno: TurnoAnthropic, modelo: string): string {
  const inicio = evento("message_start", {
    message: {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      type: "message",
      role: "assistant",
      model: modelo,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { ...USO_DO_TURNO, output_tokens: 1, server_tool_use: null },
    },
  });
  const fim = (parou: string, buscas = 0) => [
    evento("message_delta", {
      delta: { stop_reason: parou, stop_sequence: null },
      usage: {
        output_tokens: USO_DO_TURNO.output_tokens,
        ...(buscas > 0 && {
          server_tool_use: { web_search_requests: buscas, web_fetch_requests: 0 },
        }),
      },
    }),
    evento("message_stop", {}),
  ];

  if (turno.tipo === "texto") {
    return [inicio, ...blocoDeTexto(0, turno.texto), ...fim("end_turn")].join("");
  }
  if (turno.tipo === "cortada") {
    return [inicio, ...blocoDeTexto(0, turno.texto), ...fim("max_tokens")].join("");
  }
  if (turno.tipo === "recusa") return [inicio, ...fim("refusal")].join("");
  if (turno.tipo === "pausa") {
    return [inicio, ...blocoDeTexto(0, turno.texto), ...fim("pause_turn")].join("");
  }

  if (turno.tipo === "ferramenta") {
    const meio = Math.ceil(turno.argumentos.length / 2);
    return [
      inicio,
      evento("content_block_start", {
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      }),
      evento("content_block_delta", {
        index: 0,
        delta: { type: "signature_delta", signature: "assinatura-do-pensamento" },
      }),
      evento("content_block_stop", { index: 0 }),
      evento("content_block_start", {
        index: 1,
        content_block: { type: "tool_use", id: "toolu_01", name: turno.nome, input: {} },
      }),
      evento("content_block_delta", {
        index: 1,
        delta: { type: "input_json_delta", partial_json: turno.argumentos.slice(0, meio) },
      }),
      evento("content_block_delta", {
        index: 1,
        delta: { type: "input_json_delta", partial_json: turno.argumentos.slice(meio) },
      }),
      evento("content_block_stop", { index: 1 }),
      ...fim(turno.cortada ? "max_tokens" : "tool_use"),
    ].join("");
  }

  if (turno.tipo === "busca") {
    return [
      inicio,
      evento("content_block_start", {
        index: 0,
        content_block: {
          type: "server_tool_use",
          id: "srvtoolu_01",
          name: "web_search",
          input: { query: "yu-book" },
        },
      }),
      evento("content_block_stop", { index: 0 }),
      evento("content_block_start", {
        index: 1,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_01",
          content: [
            {
              type: "web_search_result",
              url: turno.url,
              title: turno.titulo,
              encrypted_content: "conteudo-cifrado",
              page_age: null,
            },
          ],
        },
      }),
      evento("content_block_stop", { index: 1 }),
      ...blocoDeTexto(2, turno.texto, {
        type: "web_search_result_location",
        url: turno.url,
        title: turno.titulo,
        cited_text: "trecho",
        encrypted_index: "indice-cifrado",
      }),
      ...fim("end_turn", 1),
    ].join("");
  }

  return "";
}

export function respostaPadraoAnthropic(_metodo: string, url: string): RespostaDoDublê {
  if (url.startsWith("/v1/models")) {
    return {
      corpo: {
        data: MODELOS_ANTHROPIC,
        has_more: false,
        first_id: MODELOS_ANTHROPIC[0]?.id ?? null,
        last_id: MODELOS_ANTHROPIC.at(-1)?.id ?? null,
      },
    };
  }
  return {
    status: 404,
    corpo: { type: "error", error: { type: "not_found_error", message: url } },
  };
}

export async function subirDubleAnthropic(): Promise<DubleAnthropic> {
  const estado: DubleAnthropic = {
    server: createServer(),
    recebidas: [],
    cabecalhos: [],
    corpos: [],
    responder: respostaPadraoAnthropic,
    roteiro: [],
  };
  estado.server.on("request", (req, res) => {
    const metodo = req.method ?? "GET";
    const url = req.url ?? "";
    estado.recebidas.push(`${metodo} ${url}`);
    estado.cabecalhos.push(req.headers);
    const pedacos: Buffer[] = [];
    req.on("data", (c: Buffer) => pedacos.push(c));
    req.on("end", () => {
      if (pedacos.length > 0) {
        try {
          estado.corpos.push(
            JSON.parse(Buffer.concat(pedacos).toString()) as Record<string, unknown>,
          );
        } catch {
          estado.corpos.push({});
        }
      }
      if (metodo === "POST" && url.startsWith("/v1/messages")) {
        const turno = estado.roteiro.shift() ?? { tipo: "texto", texto: "(roteiro vazio)" };
        if (turno.tipo === "erro") {
          res.writeHead(turno.status, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ type: "error", error: { type: "erro", message: turno.mensagem } }),
          );
          return;
        }
        const modelo = estado.corpos.at(-1)?.["model"];
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sseDoTurno(turno, typeof modelo === "string" ? modelo : "claude-x"));
        return;
      }
      const { status = 200, corpo = {} } = estado.responder(metodo, url);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(corpo));
    });
  });
  await new Promise<void>((ok) => estado.server.listen(PORTA_ANTHROPIC, "127.0.0.1", ok));
  return estado;
}

export async function derrubarDubleAnthropic(duble: DubleAnthropic): Promise<void> {
  await new Promise<void>((ok) => duble.server.close(() => ok()));
}
