import { createServer } from "node:http";
import type { Server } from "node:http";

/**
 * O dublê do provedor para as suítes que conversam: `chat.test.ts` e
 * `agentes.test.ts`. Extraído do primeiro sem mudar uma linha do que ele
 * responde — a forma do fluxo SSE é o que faz o dublê valer alguma coisa.
 *
 * A porta é a de `tests/setup.ts`, fixa porque `env.ts` congela o endereço na
 * importação. Uma suíte por vez: `fileParallelism: false` garante isso, e cada
 * uma sobe e derruba o seu.
 */

export const MODELOS = [
  {
    id: "estudio/conversa",
    name: "Estúdio: Conversa",
    context_length: 128_000,
    /// Gratuito de propósito: com preço zero a estimativa de custo é zero, e o
    /// teste do teto pode afirmar sobre o **gasto registrado** em vez de sobre
    /// a estimativa, que é heurística.
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["temperature", "tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  },
  {
    id: "estudio/mudo",
    name: "Estúdio: Mudo",
    context_length: 128_000,
    pricing: { prompt: "0", completion: "0" },
    /// Sem "tools" — é o modelo que o chat precisa recusar antes de gastar.
    supported_parameters: ["temperature"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  },
];

/** Um turno roteirizado do provedor. */
export type Turno =
  | { tipo: "texto"; texto: string; custoMicros?: number }
  | { tipo: "ferramenta"; nome: string; argumentos: string; custoMicros?: number }
  /// O provedor respondendo 500 — o passo morre antes do primeiro byte do fluxo.
  | { tipo: "falha" };

/**
 * O turno no formato `text/event-stream`, **na forma real do provedor**
 * (capturada em 2026-09-23). Duas propriedades importam e são o que faz este
 * dublê valer alguma coisa:
 *
 * - o `tool_calls` sai **fatiado**: um evento com `id`/`name` e `arguments`
 *   vazio, e outro só com um naco de `arguments`;
 * - o `usage` **não** vem no evento do `finish_reason`, vem no seguinte.
 *
 * Um dublê que mandasse tudo junto passaria com um parser ingênuo, que é
 * exatamente o parser que quebraria em produção.
 */
export function comoSse(turno: Exclude<Turno, { tipo: "falha" }>): string {
  const id = "gen-teste";
  const base = { id, object: "chat.completion.chunk", model: "estudio/conversa" };
  const eventos: unknown[] = [];

  if (turno.tipo === "texto") {
    for (const pedaco of turno.texto.match(/.{1,12}/gs) ?? []) {
      eventos.push({ ...base, choices: [{ index: 0, delta: { content: pedaco } }] });
    }
    eventos.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  } else {
    eventos.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            content: "",
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: turno.nome, arguments: "" } },
            ],
          },
        },
      ],
    });
    /// Os argumentos em **dois** nacos, e não num só: é o que torna a
    /// concatenação por `index` obrigatória. Com um naco único, um parser que
    /// sobrescrevesse em vez de concatenar passaria neste dublê e quebraria no
    /// provedor de verdade.
    const meio = Math.ceil(turno.argumentos.length / 2);
    for (const naco of [turno.argumentos.slice(0, meio), turno.argumentos.slice(meio)]) {
      eventos.push({
        ...base,
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: naco } }] } }],
      });
    }
    eventos.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  }

  /// O evento separado do `usage`, depois do `finish_reason`.
  eventos.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: turno.tipo === "texto" ? "stop" : "tool_calls" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      cost: (turno.custoMicros ?? 0) / 1_000_000,
    },
  });

  return `${eventos.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
}

export interface Dublê {
  server: Server;
  recebidas: string[];
  corpos: Record<string, unknown>[];
  /// Um turno por chamada, na ordem. Esvaziou, repete o último.
  roteiro: Turno[];
}

const PORTA = 39333;

/** Sobe o dublê na porta do `setup.ts`. Quem sobe fecha, no `afterAll`. */
export async function subirProvedor(): Promise<Dublê> {
  const estado: Dublê = { server: createServer(), recebidas: [], corpos: [], roteiro: [] };
  estado.server.on("request", (req, res) => {
    const url = req.url ?? "";
    estado.recebidas.push(url);
    const pedacos: Buffer[] = [];
    req.on("data", (c: Buffer) => pedacos.push(c));
    req.on("end", () => {
      if (pedacos.length > 0) {
        try {
          estado.corpos.push(JSON.parse(Buffer.concat(pedacos).toString()) as Record<string, unknown>);
        } catch {
          estado.corpos.push({});
        }
      }

      if (url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: MODELOS }));
        return;
      }

      if (url.endsWith("/chat/completions")) {
        const turno = estado.roteiro.shift() ?? { tipo: "texto" as const, texto: "pronto." };
        if (estado.roteiro.length === 0) estado.roteiro.push(turno);
        if (turno.tipo === "falha") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "falha roteirizada" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(comoSse(turno));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { label: "chave de teste" } }));
    });
  });
  await new Promise<void>((ok) => estado.server.listen(PORTA, "127.0.0.1", ok));
  return estado;
}

/** As chamadas de inferência que chegaram ao dublê. */
export const chamadasAoChat = (d: Dublê) =>
  d.recebidas.filter((u) => u.endsWith("/chat/completions"));
