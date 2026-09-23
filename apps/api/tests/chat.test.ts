import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  FERRAMENTAS_DE_LEITURA,
  MAX_PASSOS_DO_LACO,
  formatarNota,
} from "@yu-book/shared";
import type { ChatEvent, NoteDetail } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { esquecerCatalogo } from "../src/modules/assistente/modelos.service.js";
import { criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * O laço de ferramenta (Etapa B da frente de IA).
 *
 * O que esta suíte protege, em uma frase: **uma mensagem do usuário é até
 * cinco chamadas ao provedor**, e tudo o que decorre disso — o teto conferido
 * por passo, o fim declarado do laço, o argumento do modelo revalidado antes
 * de tocar num service, e a ausência das quatro ações de escrita no catálogo
 * oferecido.
 *
 * Como em `assistente.test.ts`, nenhuma conexão sai para o provedor de
 * verdade: `tests/setup.ts` aponta o `OPENROUTER_BASE_URL` para o dublê, e
 * `openrouter.service.ts` ainda lança se o host real aparecer.
 */

const MODELOS = [
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
type Turno =
  | { tipo: "texto"; texto: string; custoMicros?: number }
  | { tipo: "ferramenta"; nome: string; argumentos: string; custoMicros?: number };

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
function comoSse(turno: Turno): string {
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

interface Dublê {
  server: Server;
  recebidas: string[];
  corpos: Record<string, unknown>[];
  /// Um turno por chamada, na ordem. Esvaziou, repete o último.
  roteiro: Turno[];
}

const PORTA = 39333;

let app: FastifyInstance;
let dublê: Dublê;

beforeAll(async () => {
  await limpar();

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
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(comoSse(turno));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { label: "chave de teste" } }));
    });
  });
  await new Promise<void>((ok) => estado.server.listen(PORTA, "127.0.0.1", ok));
  dublê = estado;

  app = await subirApp();
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((ok) => dublê.server.close(() => ok()));
  await limpar();
});

beforeEach(() => {
  dublê.recebidas = [];
  dublê.corpos = [];
  dublê.roteiro = [];
  esquecerCatalogo();
});

/** Um usuário pronto para conversar: modelo favoritado e escolhido para `chat`. */
async function comChat(apelido: string, modelId = "estudio/conversa"): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await prisma.aiModelFavorite.create({
    data: {
      userId: usuario.id,
      modelId,
      name: modelId,
      contextLength: 128_000,
      promptMicros: 0,
      completionMicros: 0,
      supportsTools: modelId === "estudio/conversa",
    },
  });
  await prisma.aiTaskModel.create({ data: { userId: usuario.id, task: "chat", modelId } });
  return usuario;
}

async function novaConversa(usuario: Usuario, titulo = "Conversa"): Promise<string> {
  const conversa = await prisma.aiConversation.create({
    data: { userId: usuario.id, title: titulo },
  });
  return conversa.id;
}

interface Resultado {
  status: number;
  eventos: ChatEvent[];
}

/**
 * Um IP diferente por chamada.
 *
 * A rota tem limite próprio de 10/min **por IP**, e `app.inject` usa sempre o
 * mesmo endereço — sem isto a suíte se derruba sozinha a partir da décima
 * mensagem, com 429 no lugar da asserção. É a armadilha que `apoio.ts` já
 * documenta para as outras rotas com limite próprio.
 */
let proximoIp = 0;

async function enviar(
  usuario: Usuario,
  conversationId: string,
  corpo: unknown,
  ip = `10.0.0.${(proximoIp += 1) % 250}`,
): Promise<Resultado> {
  const resposta = await app.inject({
    method: "POST",
    url: `/ai/conversations/${conversationId}/messages`,
    headers: { authorization: `Bearer ${usuario.token}` },
    remoteAddress: ip,
    payload: corpo as object,
  });

  if (resposta.headers["content-type"]?.toString().includes("event-stream") !== true) {
    return { status: resposta.statusCode, eventos: [] };
  }

  const eventos = resposta.body
    .split("\n\n")
    .map((bloco) => bloco.replace(/^data: /, "").trim())
    .filter((linha) => linha.length > 0)
    .map((linha) => JSON.parse(linha) as ChatEvent);

  return { status: resposta.statusCode, eventos };
}

const tipos = (r: Resultado) => r.eventos.map((e) => e.tipo);

/**
 * A sequência de eventos com os `delta` colapsados num só.
 *
 * Quantos `delta` chegam depende de como o provedor fatia o texto, que não é
 * contrato nosso — fixar o número aqui seria um teste que quebra quando o
 * dublê muda de tamanho de pedaço, sem nada de errado ter acontecido.
 */
const roteiroDeEventos = (r: Resultado) =>
  tipos(r).filter((tipo, i, todos) => tipo !== "delta" || todos[i - 1] !== "delta");

/** Todo o texto que chegou em pedaços. */
const textoRecebido = (r: Resultado) =>
  r.eventos.filter((e) => e.tipo === "delta").map((e) => (e.tipo === "delta" ? e.texto : "")).join("");

async function criarNota(usuario: Usuario, title: string, contentMd: string): Promise<string> {
  const nota = await prisma.note.create({
    data: { userId: usuario.id, title, kind: "livre", contentMd },
  });
  return nota.id;
}

describe("o laço de ferramenta", () => {
  test("o modelo procura sozinho, o Yu-book executa, e a resposta cita a origem", async () => {
    // O caminho inteiro da Etapa B numa mensagem: sem nada anexado, o modelo
    // decide buscar, o resultado volta a ele, e ele fecha a resposta.
    const usuario = await comChat("laco-feliz");
    await criarNota(usuario, "Fuso no Postgres", "timestamptz guarda em UTC.");
    const conversa = await novaConversa(usuario);

    dublê.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"fuso"}' },
      { tipo: "texto", texto: "Está na nota Fuso no Postgres." },
    ];

    const r = await enviar(usuario, conversa, { content: "o que anotei sobre fuso?" });

    expect(r.status).toBe(200);
    expect(roteiroDeEventos(r)).toEqual(["inicio", "ferramenta", "fontes", "delta", "fim"]);
    // O texto chega fatiado e remontá-lo é trabalho de quem lê (RF-22).
    expect(textoRecebido(r)).toBe("Está na nota Fuso no Postgres.");

    const ferramenta = r.eventos.find((e) => e.tipo === "ferramenta");
    expect(ferramenta).toMatchObject({ nome: "search_notes", passo: 1 });

    const fontes = r.eventos.find((e) => e.tipo === "fontes");
    expect(fontes?.tipo === "fontes" && fontes.fontes[0]?.title).toBe("Fuso no Postgres");

    const fim = r.eventos.find((e) => e.tipo === "fim");
    expect(fim?.tipo === "fim" && fim.mensagem.content).toBe("Está na nota Fuso no Postgres.");

    // Duas voltas ao provedor: a que pediu a ferramenta e a que respondeu.
    const chamadas = dublê.recebidas.filter((u) => u.endsWith("/chat/completions"));
    expect(chamadas).toHaveLength(2);

    // O histórico guarda os quatro papéis, e a mensagem `tool` existe porque é
    // ela que volta ao provedor no turno seguinte.
    const mensagens = await prisma.aiMessage.findMany({
      where: { conversationId: conversa },
      orderBy: { createdAt: "asc" },
    });
    expect(mensagens.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(mensagens[2]?.toolName).toBe("search_notes");
    expect(mensagens[2]?.toolCallId).toBe("call_1");
  });

  test("resposta sem pedido de ferramenta fecha em um passo", async () => {
    const usuario = await comChat("laco-curto");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "oi" }];

    const r = await enviar(usuario, conversa, { content: "oi" });

    expect(roteiroDeEventos(r)).toEqual(["inicio", "delta", "fim"]);
    expect(dublê.recebidas.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(1);
  });

  test("o laço tem fim: modelo em ciclo para em MAX_PASSOS_DO_LACO", async () => {
    // O caso que gastaria um teto inteiro numa pergunta só — buscar, não achar,
    // buscar de novo. O roteiro nunca devolve texto.
    const usuario = await comChat("laco-em-ciclo");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"nada"}' }];

    const r = await enviar(usuario, conversa, { content: "procure para sempre" });

    const ultimo = r.eventos.at(-1);
    expect(ultimo?.tipo).toBe("erro");
    expect(ultimo?.tipo === "erro" && ultimo.code).toBe("RESPOSTA_INVALIDA");

    expect(dublê.recebidas.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(
      MAX_PASSOS_DO_LACO,
    );
    const usos = await prisma.aiUsage.count({ where: { userId: usuario.id, task: "chat" } });
    expect(usos).toBe(MAX_PASSOS_DO_LACO);
  });
});

describe("o teto por passo", () => {
  test("uma linha de uso por passo, não uma por mensagem", async () => {
    // É a diferença que dá nome ao bloco: o gasto de uma conversa é a soma dos
    // passos, e um teto conferido uma vez pagaria os outros quatro sem olhar.
    const usuario = await comChat("teto-linhas");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "get_dashboard", argumentos: "{}", custoMicros: 7 },
      { tipo: "texto", texto: "nada vencido.", custoMicros: 11 },
    ];

    await enviar(usuario, conversa, { content: "o que vence?" });

    const usos = await prisma.aiUsage.findMany({
      where: { userId: usuario.id, task: "chat" },
      orderBy: { createdAt: "asc" },
    });
    expect(usos).toHaveLength(2);
    expect(usos.map((u) => u.costMicros)).toEqual([7, 11]);
    // Toda linha aponta para a conversa: é o que torna o gasto dela somável.
    expect(usos.every((u) => u.conversationId === conversa)).toBe(true);
    expect(usos.every((u) => u.costSource === "provedor")).toBe(true);
  });

  test("o teto corta no meio do laço e o que já foi gerado fica", async () => {
    // A decisão do operador: os passos anteriores custaram dinheiro e renderam
    // alguma coisa. Um erro que apagasse tudo faria pagar por nada.
    const usuario = await comChat("teto-no-meio");
    await prisma.aiPreference.create({
      data: {
        userId: usuario.id,
        dailyCapMicros: 10,
        timezone: "America/Sao_Paulo",
        allowTraining: true,
      },
    });
    const conversa = await novaConversa(usuario);
    /// Modelo gratuito: a estimativa é zero, então quem corta é o **gasto já
    /// registrado**, que é o que se quer afirmar aqui.
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "get_dashboard", argumentos: "{}", custoMicros: 6 },
      { tipo: "ferramenta", nome: "get_dashboard", argumentos: "{}", custoMicros: 6 },
    ];

    const r = await enviar(usuario, conversa, { content: "e agora?" });

    expect(tipos(r)).toContain("teto");
    // O parcial fica: veio `fim` depois do corte, com a última fala gravada.
    expect(tipos(r).at(-1)).toBe("fim");

    const teto = r.eventos.find((e) => e.tipo === "teto");
    expect(teto?.tipo === "teto" && teto.mensagem).toMatch(/Teto diário/);

    // Dois passos rodaram e estão registrados; o terceiro nem abriu conexão.
    expect(dublê.recebidas.filter((u) => u.endsWith("/chat/completions"))).toHaveLength(2);
    expect(await prisma.aiUsage.count({ where: { userId: usuario.id, task: "chat" } })).toBe(2);
    // E o que foi gerado continua na conversa.
    expect(await prisma.aiMessage.count({ where: { conversationId: conversa } })).toBeGreaterThan(1);
  });

  test("um par assistant/tool quebrado não envenena a conversa para sempre", async () => {
    // A fala que pede ferramenta é gravada antes de a ferramenta rodar. Se o
    // fluxo parar no meio — cliente desconecta, processo cai —, sobra um
    // `assistant` com `tool_calls` sem o `tool` que responde. O provedor recusa
    // um histórico assim, e a conversa ficaria inutilizável **para sempre**,
    // com um erro que não aponta para a causa.
    const usuario = await comChat("par-quebrado");
    const conversa = await novaConversa(usuario);

    await prisma.aiMessage.create({
      data: { conversationId: conversa, role: "user", content: "primeira" },
    });
    // Duas formas da mesma corrupção, e as duas acontecem: a fala que só pedia
    // ferramenta (some inteira) e a que já tinha escrito texto antes de pedir
    // (fica, mas sem o pedido).
    await prisma.aiMessage.create({
      data: {
        conversationId: conversa,
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_orfao", type: "function", function: { name: "get_note", arguments: "{}" } },
        ],
      },
    });
    await prisma.aiMessage.create({
      data: {
        conversationId: conversa,
        role: "assistant",
        content: "Vou conferir isso.",
        toolCalls: [
          {
            id: "call_orfao_2",
            type: "function",
            function: { name: "search_notes", arguments: '{"q":"x"}' },
          },
        ],
      },
    });

    dublê.roteiro = [{ tipo: "texto", texto: "consegui responder" }];
    const r = await enviar(usuario, conversa, { content: "segunda" });

    expect(tipos(r).at(-1)).toBe("fim");

    // O que foi mandado ao provedor não tem o pedido órfão: nem como
    // `tool_calls` de uma fala, nem como fala vazia.
    const corpo = dublê.corpos.at(-1) as {
      messages: { role: string; content: string; tool_calls?: unknown[] }[];
    };
    const pedidos = corpo.messages.flatMap((m) => m.tool_calls ?? []);
    expect(pedidos).toEqual([]);
    expect(corpo.messages.some((m) => m.role === "assistant" && !m.content.trim())).toBe(false);
    // A fala que tinha texto **fica** — perder o que o assistente já disse
    // seria apagar histórico para consertar um pedido pendurado.
    expect(corpo.messages.some((m) => m.content === "Vou conferir isso.")).toBe(true);
  });

  test("quem já estourou o teto antes de perguntar recebe 402, sem nada transmitido", async () => {
    const usuario = await comChat("teto-antes");
    await prisma.aiPreference.create({
      data: {
        userId: usuario.id,
        dailyCapMicros: 1,
        timezone: "America/Sao_Paulo",
        allowTraining: true,
      },
    });
    await prisma.aiUsage.create({
      data: {
        userId: usuario.id,
        task: "chat",
        modelId: "estudio/conversa",
        costMicros: 50,
        costSource: "provedor",
        durationMs: 1,
        ok: true,
        localDay: new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      },
    });
    const conversa = await novaConversa(usuario);

    const r = await enviar(usuario, conversa, { content: "oi" });

    expect(r.status).toBe(402);
    // A recusa acontece antes de qualquer conexão sair (INV-47).
    expect(dublê.recebidas.filter((u) => u.endsWith("/chat/completions"))).toEqual([]);
    // E **nada foi gravado**: uma pergunta persistida sem resposta reapareceria
    // no histórico ao recarregar, e voltaria ao provedor no turno seguinte como
    // se tivesse sido feita.
    expect(await prisma.aiMessage.count({ where: { conversationId: conversa } })).toBe(0);
  });
});

describe("o que o modelo pode pedir", () => {
  test("o catálogo oferecido ao provedor não tem nenhuma ação de escrita", async () => {
    // A Etapa B nasce só com leitura. Uma ferramenta de escrita a mais neste
    // corpo é a diferença entre um chat que lê e um que apaga nota.
    const usuario = await comChat("catalogo");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "oi" }];

    await enviar(usuario, conversa, { content: "oi" });

    const corpo = dublê.corpos.at(-1) as { tools?: { function: { name: string } }[] };
    const nomes = (corpo.tools ?? []).map((f) => f.function.name).sort();
    expect(nomes).toEqual([...FERRAMENTAS_DE_LEITURA].sort());
    expect(nomes).not.toContain("trash_note");
    expect(nomes).not.toContain("create_card");
  });

  test("pedir uma ação de escrita responde 'não existe', e nada é executado", async () => {
    const usuario = await comChat("escrita-negada");
    const nota = await criarNota(usuario, "Intocada", "corpo");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "trash_note", argumentos: `{"noteId":"${nota}"}` },
      { tipo: "texto", texto: "não consigo." },
    ];

    await enviar(usuario, conversa, { content: "apague a nota Intocada" });

    const resultado = await prisma.aiMessage.findFirst({
      where: { conversationId: conversa, role: "tool" },
    });
    expect(resultado?.content).toMatch(/desconhecida/i);
    // A nota continua fora da lixeira.
    const depois = await prisma.note.findUnique({ where: { id: nota } });
    expect(depois?.deletedAt).toBeNull();
  });

  test("argumento inválido do modelo é recusado pelo schema antes de tocar no service", async () => {
    // O modelo é um terceiro que devolve JSON conforme um schema que ele pode
    // ignorar. Sem revalidar, um `limit` inventado atravessa até o SQL.
    const usuario = await comChat("argumento-torto");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"ok","limit":5000}' },
      { tipo: "texto", texto: "corrigido." },
    ];

    await enviar(usuario, conversa, { content: "busque" });

    const resultado = await prisma.aiMessage.findFirst({
      where: { conversationId: conversa, role: "tool" },
    });
    // A falha volta **ao modelo**, campo a campo — é o que ele consegue
    // consertar na volta seguinte.
    expect(resultado?.content).toMatch(/limit/);
  });

  test("argumento que não é JSON não derruba a conversa", async () => {
    const usuario = await comChat("json-torto");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "get_note", argumentos: "{isso nao e json" },
      { tipo: "texto", texto: "desculpe." },
    ];

    const r = await enviar(usuario, conversa, { content: "leia" });

    expect(tipos(r).at(-1)).toBe("fim");
    const resultado = await prisma.aiMessage.findFirst({
      where: { conversationId: conversa, role: "tool" },
    });
    expect(resultado?.content).toMatch(/JSON/);
  });

  test("cada tarefa guarda o seu modelo, e a tela precisa ver as duas", async () => {
    // O contrato que a tela de ajustes desenha: uma coluna por tarefa. Ele
    // esteve certo o tempo todo e mesmo assim o chat ficou inutilizável, porque
    // `/ajustes` só oferecia `formatar` — a escolha de `chat` não tinha por
    // onde ser feita. O teste guarda o lado que a tela consome.
    const usuario = await comChat("duas-tarefas");
    await prisma.aiModelFavorite.create({
      data: {
        userId: usuario.id,
        modelId: "estudio/mudo",
        name: "estudio/mudo",
        contextLength: 128_000,
        promptMicros: 0,
        completionMicros: 0,
        supportsTools: false,
      },
    });

    const definir = await app.inject({
      method: "PATCH",
      url: "/ai/tasks/formatar",
      headers: { authorization: `Bearer ${usuario.token}` },
      payload: { modelId: "estudio/mudo" },
    });
    expect(definir.statusCode).toBe(200);

    const ajustes = await app.inject({
      method: "GET",
      url: "/ai/settings",
      headers: { authorization: `Bearer ${usuario.token}` },
    });
    const corpo = JSON.parse(ajustes.body) as { taskModels: Record<string, string> };

    // As duas escolhas convivem e são independentes: uma tarefa não sobrescreve
    // a outra, e `chat` continua no modelo com ferramenta.
    expect(corpo.taskModels).toEqual({
      formatar: "estudio/mudo",
      chat: "estudio/conversa",
    });
  });

  test("modelo sem suporte a ferramenta é recusado antes de abrir conexão", async () => {
    const usuario = await comChat("modelo-mudo", "estudio/mudo");
    const conversa = await novaConversa(usuario);

    const r = await enviar(usuario, conversa, { content: "oi" });

    expect(r.status).toBe(422);
    expect(dublê.recebidas.filter((u) => u.endsWith("/chat/completions"))).toEqual([]);
  });
});

describe("o contexto anexado", () => {
  test("o anexo pende da mensagem, e o texto da nota é o mesmo do servidor MCP", async () => {
    // CA-11: o contexto montado pelo chat e o texto de `yubook://nota/{id}`
    // saem da mesma função de `packages/shared`. É o que impede o mesmo dado
    // de ter duas caras conforme a porta de entrada.
    const usuario = await comChat("anexo");
    const nota = await criarNota(usuario, "Anexada", "corpo da nota anexada");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "li." }];

    const r = await enviar(usuario, conversa, {
      content: "resuma isto",
      attachments: [{ noteId: nota }],
    });

    const inicio = r.eventos[0];
    expect(inicio?.tipo).toBe("inicio");
    expect(inicio?.tipo === "inicio" && inicio.mensagem.attachments[0]?.noteId).toBe(nota);
    expect(inicio?.tipo === "inicio" && inicio.mensagem.attachments[0]?.title).toBe("Anexada");

    // O anexo está preso à **mensagem**, não à conversa.
    const linha = await prisma.aiAttachment.findFirst({ where: { noteId: nota } });
    expect(linha?.messageId).toBe(inicio?.tipo === "inicio" ? inicio.mensagem.id : null);

    // A origem de uma resposta é o que ela usou. Com a nota no contexto o
    // modelo responde sem chamar ferramenta, e sem semear as fontes com os
    // anexos a resposta certa ficaria sem origem clicável — justamente no caso
    // em que o usuário sabe qual ela é.
    const fim = r.eventos.find((e) => e.tipo === "fim");
    expect(fim?.tipo === "fim" && fim.mensagem.sources).toEqual([
      { kind: "note", id: nota, title: "Anexada" },
    ]);

    const detalhe = await app.inject({
      method: "GET",
      url: `/notes/${nota}`,
      headers: { authorization: `Bearer ${usuario.token}` },
    });
    const esperado = formatarNota(JSON.parse(detalhe.body) as NoteDetail);
    const corpo = dublê.corpos.at(-1) as { messages: { role: string; content: string }[] };
    const turno = corpo.messages.at(-1)?.content ?? "";
    expect(turno).toContain(esperado);
  });

  test("um anexo por mensagem: a mensagem seguinte não herda o da anterior", async () => {
    const usuario = await comChat("anexo-por-mensagem");
    const nota = await criarNota(usuario, "Só na primeira", "corpo");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    await enviar(usuario, conversa, { content: "primeira", attachments: [{ noteId: nota }] });
    await enviar(usuario, conversa, { content: "segunda" });

    const mensagens = await prisma.aiMessage.findMany({
      where: { conversationId: conversa, role: "user" },
      orderBy: { createdAt: "asc" },
      include: { attachments: true },
    });
    expect(mensagens[0]?.attachments).toHaveLength(1);
    expect(mensagens[1]?.attachments).toHaveLength(0);
  });

  test("anexo de outra conta é indistinguível de inexistente", async () => {
    const dono = await comChat("anexo-dono");
    const outro = await comChat("anexo-outro");
    const nota = await criarNota(dono, "Alheia", "corpo");
    const conversa = await novaConversa(outro);

    const r = await enviar(outro, conversa, { content: "leia", attachments: [{ noteId: nota }] });

    expect(r.status).toBe(404);
  });
});

describe("escopo da conversa", () => {
  test("conversa de outra conta responde 404, não 403", async () => {
    // CA-16, RNF-06: dizer "existe, mas não é sua" já é contar que existe.
    const dono = await comChat("conversa-dono");
    const intruso = await comChat("conversa-intruso");
    const conversa = await novaConversa(dono);

    const leitura = await app.inject({
      method: "GET",
      url: `/ai/conversations/${conversa}`,
      headers: { authorization: `Bearer ${intruso.token}` },
    });
    expect(leitura.statusCode).toBe(404);

    const envio = await enviar(intruso, conversa, { content: "oi" });
    expect(envio.status).toBe(404);

    // Renomear e excluir levam o `userId` no `where` da própria mutação
    // (INV-04): a conversa do dono tem de sair intacta das duas tentativas.
    for (const [method, payload] of [
      ["PATCH", { title: "sequestrada" }],
      ["DELETE", undefined],
    ] as const) {
      const r = await app.inject({
        method,
        url: `/ai/conversations/${conversa}`,
        headers: { authorization: `Bearer ${intruso.token}` },
        ...(payload && { payload }),
      });
      expect(r.statusCode).toBe(404);
    }
    const intacta = await prisma.aiConversation.findUnique({ where: { id: conversa } });
    expect(intacta?.title).toBe("Conversa");
  });

  test("apagar a conversa não toca em nota nem em card", async () => {
    const usuario = await comChat("apagar-conversa");
    const nota = await criarNota(usuario, "Sobrevivente", "corpo");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];
    await enviar(usuario, conversa, { content: "oi", attachments: [{ noteId: nota }] });

    const resposta = await app.inject({
      method: "DELETE",
      url: `/ai/conversations/${conversa}`,
      headers: { authorization: `Bearer ${usuario.token}` },
    });
    expect(resposta.statusCode).toBe(204);

    expect(await prisma.aiMessage.count({ where: { conversationId: conversa } })).toBe(0);
    expect(await prisma.note.findUnique({ where: { id: nota } })).not.toBeNull();
    // O gasto sobrevive à conversa: o teto não é resetável por exclusão.
    expect(await prisma.aiUsage.count({ where: { userId: usuario.id, task: "chat" } })).toBe(1);
  });

  test("as fontes consultadas sobrevivem ao recarregar, sem repetição", async () => {
    // RF-20 com CA-10: a citação clicável não pode existir só enquanto o fluxo
    // corre. Buscar e depois ler a mesma nota é o caminho normal do laço, e a
    // tela não pode mostrar a mesma nota duas vezes por causa disso.
    const usuario = await comChat("fontes-persistidas");
    const nota = await criarNota(usuario, "Citada", "corpo");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"Citada"}' },
      { tipo: "ferramenta", nome: "get_note", argumentos: `{"id":"${nota}"}` },
      { tipo: "texto", texto: "Está na nota Citada." },
    ];

    await enviar(usuario, conversa, { content: "onde está?" });

    const resposta = await app.inject({
      method: "GET",
      url: `/ai/conversations/${conversa}`,
      headers: { authorization: `Bearer ${usuario.token}` },
    });
    const corpo = JSON.parse(resposta.body) as {
      messages: { role: string; sources: { id: string; title: string }[] }[];
    };

    const fechamento = corpo.messages.at(-1);
    expect(fechamento?.role).toBe("assistant");
    expect(fechamento?.sources).toEqual([{ kind: "note", id: nota, title: "Citada" }]);

    // As falas intermediárias não repetem a lista.
    const intermediarias = corpo.messages.slice(0, -1);
    expect(intermediarias.every((m) => m.sources.length === 0)).toBe(true);
  });

  test("a conversa volta íntegra depois de recarregar", async () => {
    // CA-10.
    const usuario = await comChat("recarregar");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [
      { tipo: "ferramenta", nome: "list_boards", argumentos: "{}" },
      { tipo: "texto", texto: "nenhum quadro." },
    ];
    await enviar(usuario, conversa, { content: "quais quadros eu tenho?" });

    const resposta = await app.inject({
      method: "GET",
      url: `/ai/conversations/${conversa}`,
      headers: { authorization: `Bearer ${usuario.token}` },
    });
    const corpo = JSON.parse(resposta.body) as { messages: { role: string; content: string }[] };

    expect(corpo.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(corpo.messages.at(-1)?.content).toBe("nenhum quadro.");
  });
});

describe("o pedido que sai daqui", () => {
  test("pede o uso junto do fluxo — sem isso o custo seria sempre desconhecido", async () => {
    // Medido em 2026-09-23: sem `stream_options.include_usage` o provedor não
    // manda `usage` no fluxo, todo passo gravaria custo zero pelo terceiro
    // degrau do INV-48, e o teto diário viraria decorativo em silêncio.
    const usuario = await comChat("include-usage");
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "oi" }];

    await enviar(usuario, conversa, { content: "oi" });

    const corpo = dublê.corpos.at(-1) as {
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
    };
    expect(corpo.stream).toBe(true);
    expect(corpo.stream_options?.include_usage).toBe(true);
  });

  test("com o treino permitido, o pedido não carrega bloco de provedor", async () => {
    const usuario = await comChat("politica");
    await prisma.aiPreference.create({
      data: {
        userId: usuario.id,
        dailyCapMicros: 200_000,
        timezone: "America/Sao_Paulo",
        allowTraining: true,
      },
    });
    const conversa = await novaConversa(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "oi" }];

    await enviar(usuario, conversa, { content: "oi" });

    // Teste de **ausência**: é o que a Etapa A não tinha, e foi por isso que a
    // política fixa atravessou uma etapa inteira sem nada podendo contradizê-la.
    expect(dublê.corpos.at(-1)).not.toHaveProperty("provider");
  });
});
