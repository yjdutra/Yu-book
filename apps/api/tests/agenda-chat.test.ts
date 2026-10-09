import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  formatarAgenda,
} from "@yu-book/shared";
import type {
  AgendaRange,
  AgentDetail,
  BoardDetail,
  CardDetail,
  ChatCreated,
  ChatEvent,
  Conversation,
  EventItem,
  TaskItem,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { linhaDeHoje, sufixoDeAgora } from "../src/modules/assistente/agentes.service.js";
import { esquecerCatalogo } from "../src/modules/assistente/modelos.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";
import { subirProvedor } from "./provedor.js";
import type { Dublê } from "./provedor.js";

/**
 * A agenda no chat — frente de agenda, Fase 2: `list_agenda`, `create_event`,
 * `create_task` e `complete_task`, e o relógio que o modelo passou a receber.
 *
 * O que esta suíte protege, em uma frase: **o modelo fala em dia e hora do
 * usuário, e quem converte é o servidor, pelo fuso do usuário** — o evento vira
 * instante, a tarefa fica dia civil (INV-66), o que se cria nasce marcado pelo
 * servidor (INV-58), a conclusão assina e a reabertura desassina (INV-63), e o
 * "hoje" que resolve "amanhã" chega ao provedor sem ser gravado.
 *
 * O provedor é o dublê de `tests/provedor.ts`. Os dias ficam em 2030, longe do
 * relógio real: nenhuma tarefa daqui fica atrasada por o tempo passar.
 */

let app: FastifyInstance;
let dublê: Dublê;

beforeAll(async () => {
  await limpar();
  dublê = await subirProvedor();
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

/* ------------------------------------------------------------------ apoio */

/// Tóquio: UTC+9 o ano inteiro, sem horário de verão — longe do UTC do
/// processo e do fuso padrão, então uma conversão pelo fuso errado aparece.
const TOQUIO = "Asia/Tokyo";

/// Um IP por chamada: a rota de mensagem tem limite de 10/min por IP, e o
/// global é de 300/min (ver `apoio.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.6.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

const api = (
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) =>
  chamar(app, {
    method,
    url,
    token: usuario.token,
    ip: proximoIp(),
    ...(body !== undefined && { body }),
  });

/** Um usuário pronto para conversar, com o fuso dado gravado nas preferências. */
async function comChat(apelido: string, fuso: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await prisma.aiModelFavorite.create({
    data: {
      userId: usuario.id,
      modelId: "estudio/conversa",
      name: "Estúdio: Conversa",
      contextLength: 128_000,
      promptMicros: 0,
      completionMicros: 0,
      supportsTools: true,
    },
  });
  await prisma.aiTaskModel.create({
    data: { userId: usuario.id, task: "chat", modelId: "estudio/conversa" },
  });
  await prisma.aiPreference.create({
    data: {
      userId: usuario.id,
      dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
      timezone: fuso,
      allowTraining: TREINO_PERMITIDO_PADRAO,
    },
  });
  return usuario;
}

async function agentePronto(usuario: Usuario, corpo: Record<string, unknown>): Promise<AgentDetail> {
  const { status, body } = await api(usuario, "POST", "/ai/agents", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as AgentDetail;
}

async function conversaCom(usuario: Usuario, agentId?: string): Promise<string> {
  const { status, body } = await api(usuario, "POST", "/ai/conversations", {
    title: "Conversa",
    ...(agentId !== undefined && { agentId }),
  });
  expect(status).toBe(201);
  return (body as Conversation).id;
}

interface Resultado {
  status: number;
  eventos: ChatEvent[];
}

async function enviar(usuario: Usuario, conversationId: string, content: string): Promise<Resultado> {
  const resposta = await app.inject({
    method: "POST",
    url: `/ai/conversations/${conversationId}/messages`,
    headers: { authorization: `Bearer ${usuario.token}` },
    remoteAddress: proximoIp(),
    payload: { content },
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

/** Tudo o que os eventos `criado` do turno anunciaram à tela. */
const criadosAnunciados = (r: Resultado): ChatCreated[] =>
  r.eventos.flatMap((e) => (e.tipo === "criado" ? e.criados : []));

/** As respostas das ferramentas, na ordem — é o que voltou ao modelo. */
async function respostasAoModelo(conversationId: string): Promise<string[]> {
  const linhas = await prisma.aiMessage.findMany({
    where: { conversationId, role: "tool" },
    orderBy: { createdAt: "asc" },
  });
  return linhas.map((l) => l.content);
}

interface CorpoDoPedido {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
}

const pedidos = () => dublê.corpos as unknown as CorpoDoPedido[];

const chamarFerramenta = (nome: string, argumentos: Record<string, unknown>) => ({
  tipo: "ferramenta" as const,
  nome,
  argumentos: JSON.stringify(argumentos),
});

/* --------------------------------------------------------- create_event */

describe("INV-66 / INV-58: o compromisso marcado pelo chat", () => {
  test("dia e hora do usuário viram o instante no fuso dele, com a marca do chat, e a tela recebe o criado com quando", async () => {
    // 15:00 em Tóquio é 06:00 UTC. Um executor que convertesse pelo fuso do
    // processo, ou que passasse a hora como UTC, gravaria outro instante.
    const usuario = await comChat("agenda-evento", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_event", { title: "Dentista", date: "2030-11-12", startTime: "15:00" }),
      { tipo: "texto", texto: "Marquei o dentista." },
    ];

    const r = await enviar(usuario, conversa, "marque dentista dia 12/11/2030 às 15h");

    expect(r.status).toBe(200);
    const evento = await prisma.event.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(evento.startsAt.toISOString()).toBe("2030-11-12T06:00:00.000Z");
    // Sem fim pedido, uma hora.
    expect(evento.endsAt.toISOString()).toBe("2030-11-12T07:00:00.000Z");
    expect(evento.allDay).toBe(false);
    expect(evento).toMatchObject({
      aiVia: "chat",
      aiAuthor: "estudio/conversa",
      aiConversationId: conversa,
      aiAgentName: null,
    });
    expect(evento.aiGeneratedAt).toBeInstanceOf(Date);

    // A tela recebe o quando já no fuso do usuário — o resumo sem consulta.
    const esperado = { kind: "event", id: evento.id, title: "Dentista", date: "2030-11-12", time: "15:00" };
    expect(criadosAnunciados(r)).toEqual([esperado]);
    // E a fala que fecha guarda o mesmo, para o "desfazer" depois de recarregar.
    const ultima = await prisma.aiMessage.findFirstOrThrow({
      where: { conversationId: conversa, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    expect(ultima.created).toEqual([esperado]);
  });

  test("evento de dia inteiro anuncia o dia sem hora", async () => {
    const usuario = await comChat("agenda-evento-dia", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_event", { title: "Feriado", date: "2030-11-15", allDay: true }),
      { tipo: "texto", texto: "ok" },
    ];

    const r = await enviar(usuario, conversa, "feriado dia 15");

    const evento = await prisma.event.findFirstOrThrow({ where: { userId: usuario.id } });
    // Meia-noite local de Tóquio é 15:00 UTC do dia anterior.
    expect(evento.startsAt.toISOString()).toBe("2030-11-14T15:00:00.000Z");
    expect(criadosAnunciados(r)).toEqual([
      { kind: "event", id: evento.id, title: "Feriado", date: "2030-11-15", time: null },
    ]);
  });

  test("RF-50: o evento criado por agente leva o nome dele na marca", async () => {
    const usuario = await comChat("agenda-evento-agente", TOQUIO);
    const agente = await agentePronto(usuario, {
      name: "Secretária",
      tools: ["list_agenda", "create_event", "create_task", "complete_task"],
    });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [
      chamarFerramenta("create_event", { title: "Reunião", date: "2030-11-13", startTime: "09:00" }),
      { tipo: "texto", texto: "ok" },
    ];

    await enviar(usuario, conversa, "reunião dia 13 às 9h");

    const evento = await prisma.event.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(evento).toMatchObject({
      aiVia: "chat",
      aiConversationId: conversa,
      aiAgentName: "Secretária",
    });
  });
});

/* ---------------------------------------------------------- create_task */

describe("INV-66 / INV-58: a tarefa anotada pelo chat", () => {
  test("com dia e hora: o dia é civil e não passa por fuso, e a tela recebe dia e hora", async () => {
    // A tarefa "para 12/11" é do dia 12 onde quer que se olhe: a coluna DATE
    // guarda o dia, não um instante convertido de Tóquio.
    const usuario = await comChat("agenda-tarefa-dia", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_task", { title: "Pagar boleto", date: "2030-11-12", time: "09:30" }),
      { tipo: "texto", texto: "Anotei." },
    ];

    const r = await enviar(usuario, conversa, "lembrar de pagar o boleto dia 12 às 9h30");

    const tarefa = await prisma.task.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(tarefa.date?.toISOString()).toBe("2030-11-12T00:00:00.000Z");
    expect(tarefa.time).toBe("09:30");
    expect(tarefa).toMatchObject({
      aiVia: "chat",
      aiAuthor: "estudio/conversa",
      aiConversationId: conversa,
      aiAgentName: null,
      completedAt: null,
    });
    expect(criadosAnunciados(r)).toEqual([
      { kind: "task", id: tarefa.id, title: "Pagar boleto", date: "2030-11-12", time: "09:30" },
    ]);
  });

  test("sem dia: a tarefa nasce sem data, e o criado diz isso com date e time nulos", async () => {
    const usuario = await comChat("agenda-tarefa-sem-dia", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_task", { title: "Ler o livro" }),
      { tipo: "texto", texto: "Anotei." },
    ];

    const r = await enviar(usuario, conversa, "anote: ler o livro");

    const tarefa = await prisma.task.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(tarefa.date).toBeNull();
    expect(tarefa.time).toBeNull();
    expect(tarefa.aiVia).toBe("chat");
    // `date: null` e não ausente: ausente é nota e card, e a tela distingue.
    expect(criadosAnunciados(r)).toEqual([
      { kind: "task", id: tarefa.id, title: "Ler o livro", date: null, time: null },
    ]);
  });
});

/* -------------------------------------------------------- complete_task */

describe("INV-63: concluir pelo chat assina, reabrir desassina", () => {
  test("a tarefa escrita à mão é concluída com a marca do chat, nada é anunciado como criado, e reabrir limpa a marca", async () => {
    const usuario = await comChat("agenda-concluir", TOQUIO);
    const agente = await agentePronto(usuario, { name: "Fecha-tarefa", tools: ["complete_task"] });
    const { body } = await api(usuario, "POST", "/tasks", { title: "Feita à mão", date: "2030-11-12" });
    const tarefaId = (body as TaskItem).id;
    const conversa = await conversaCom(usuario, agente.id);

    dublê.roteiro = [
      chamarFerramenta("complete_task", { taskId: tarefaId }),
      { tipo: "texto", texto: "Concluída." },
    ];
    const concluir = await enviar(usuario, conversa, "conclua a tarefa Feita à mão");

    expect(concluir.status).toBe(200);
    // Concluir não cria: nem evento `criado`, nem `created` na fala gravada.
    expect(concluir.eventos.some((e) => e.tipo === "criado")).toBe(false);
    const fala = await prisma.aiMessage.findFirstOrThrow({
      where: { conversationId: conversa, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    expect(fala.created ?? []).toEqual([]);

    const concluida = await prisma.task.findUniqueOrThrow({ where: { id: tarefaId } });
    expect(concluida.completedAt).toBeInstanceOf(Date);
    expect(concluida).toMatchObject({
      aiCompletedVia: "chat",
      aiCompletedAuthor: "estudio/conversa",
      aiCompletedAgentName: "Fecha-tarefa",
      // A marca de geração é outra coisa: a tarefa foi escrita à mão.
      aiVia: null,
      aiGeneratedAt: null,
    });

    dublê.roteiro = [
      chamarFerramenta("complete_task", { taskId: tarefaId, completed: false }),
      { tipo: "texto", texto: "Reaberta." },
    ];
    await enviar(usuario, conversa, "reabra");

    const reaberta = await prisma.task.findUniqueOrThrow({ where: { id: tarefaId } });
    expect(reaberta).toMatchObject({
      completedAt: null,
      aiCompletedVia: null,
      aiCompletedAuthor: null,
      aiCompletedAgentName: null,
    });
  });

  test("INV-02: tarefa de outra conta volta ao modelo como não encontrada, e não é concluída", async () => {
    const usuario = await comChat("agenda-concluir-dono", TOQUIO);
    const outro = await criarUsuario("agenda-concluir-outro");
    const alheia = await prisma.task.create({ data: { userId: outro.id, title: "Alheia" } });
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("complete_task", { taskId: alheia.id }),
      { tipo: "texto", texto: "Não achei." },
    ];

    const r = await enviar(usuario, conversa, "conclua");

    expect(r.status).toBe(200);
    const [resposta] = await respostasAoModelo(conversa);
    expect(resposta).toMatch(/^Erro em complete_task:/);
    expect(resposta).not.toContain("Alheia");
    const depois = await prisma.task.findUniqueOrThrow({ where: { id: alheia.id } });
    expect(depois.completedAt).toBeNull();
    expect(depois.aiCompletedVia).toBeNull();
  });
});

/* ---------------------------------------------------------- list_agenda */

describe("list_agenda: o que o modelo lê antes de agendar", () => {
  test("o texto traz o evento no seu dia, a tarefa com id, o prazo do card e as tarefas abertas sem data", async () => {
    const usuario = await comChat("agenda-listar", TOQUIO);
    await api(usuario, "POST", "/events", {
      title: "Reunião de pauta",
      date: "2030-11-12",
      startTime: "10:00",
    });
    await api(usuario, "POST", "/events", {
      title: "Fora do período",
      date: "2030-12-20",
      startTime: "10:00",
    });
    const comDia = (await api(usuario, "POST", "/tasks", { title: "Pagar boleto", date: "2030-11-13" }))
      .body as TaskItem;
    const semDia = (await api(usuario, "POST", "/tasks", { title: "Ler o livro" })).body as TaskItem;
    const jaFeita = (await api(usuario, "POST", "/tasks", { title: "Já lido" })).body as TaskItem;
    await api(usuario, "PATCH", `/tasks/${jaFeita.id}/complete`, { completed: true });

    const workspace = await prisma.workspace.create({
      data: { userId: usuario.id, name: "Espaço da agenda" },
    });
    const quadro = (
      await api(usuario, "POST", "/boards", { name: "Trabalho", workspaceId: workspace.id })
    ).body as BoardDetail;
    // 03:00 UTC é meio-dia em Tóquio: o dia do prazo é 14, sem ambiguidade.
    const card = (
      await api(usuario, "POST", "/cards", {
        columnId: quadro.columns[0]?.id,
        title: "Entregar relatório",
        dueDate: "2030-11-14T03:00:00.000Z",
      })
    ).body as CardDetail;

    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("list_agenda", { from: "2030-11-12", to: "2030-11-18" }),
      { tipo: "texto", texto: "Você tem a reunião." },
    ];

    const r = await enviar(usuario, conversa, "o que tenho na semana de 12/11?");

    expect(r.status).toBe(200);
    const [texto = ""] = await respostasAoModelo(conversa);
    expect(texto).toContain("fuso Asia/Tokyo");
    // Cada coisa no seu dia, na ordem do calendário, e as sem data no fim.
    const posicao = (trecho: string) => {
      const i = texto.indexOf(trecho);
      expect(i, `«${trecho}» ausente de:\n${texto}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const dia12 = posicao("## terça-feira, 2030-11-12");
    const reuniao = posicao("10:00–11:00 · **Reunião de pauta**");
    const dia13 = posicao("## quarta-feira, 2030-11-13");
    const boleto = posicao("[ ] Pagar boleto");
    const dia14 = posicao("## quinta-feira, 2030-11-14");
    const prazo = posicao("prazo do card **Entregar relatório**");
    const semData = posicao("## Tarefas abertas sem data");
    const livro = posicao("[ ] Ler o livro");
    expect([dia12, reuniao, dia13, boleto, dia14, prazo, semData, livro]).toEqual(
      [dia12, reuniao, dia13, boleto, dia14, prazo, semData, livro].sort((a, b) => a - b),
    );
    // Os ids que `complete_task` e `complete_card` pedem.
    expect(texto).toContain(`id: ${comDia.id}`);
    expect(texto).toContain(`id: ${semDia.id}`);
    expect(texto).toContain(`id: ${card.id}`);
    // Concluída sem data não é "aberta sem data"; evento fora do período não entra.
    expect(texto).not.toContain(jaFeita.id);
    expect(texto).not.toContain("Fora do período");

    // O card do período é fonte citável; evento e tarefa não abrem como fonte.
    const fontes = r.eventos.flatMap((e) => (e.tipo === "fontes" ? e.fontes : []));
    expect(fontes).toEqual([{ kind: "card", id: card.id, title: "Entregar relatório" }]);
  });

  test("período maior que 31 dias, ou invertido, volta ao modelo como erro que ele corrige, e a conversa fecha", async () => {
    const usuario = await comChat("agenda-listar-longo", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("list_agenda", { from: "2030-11-01", to: "2030-12-15" }),
      chamarFerramenta("list_agenda", { from: "2030-11-10", to: "2030-11-01" }),
      { tipo: "texto", texto: "Vou dividir o período." },
    ];

    const r = await enviar(usuario, conversa, "o que tenho até meados de dezembro?");

    expect(r.status).toBe(200);
    expect(r.eventos.at(-1)?.tipo).toBe("fim");
    const [longo, invertido] = await respostasAoModelo(conversa);
    expect(longo).toBe("Erro em list_agenda: No máximo 31 dias por consulta: divida o período.");
    expect(invertido).toMatch(/^Erro em list_agenda: `to` vem antes de `from`/);
  });
});

/* ------------------------------------------------- argumentos inválidos */

describe("argumento do modelo que o calendário não aceita volta a ele, e nada é gravado", () => {
  const CASOS: { rotulo: string; nome: string; argumentos: Record<string, unknown>; campo: string }[] = [
    {
      rotulo: "evento em 30 de fevereiro",
      nome: "create_event",
      argumentos: { title: "Impossível", date: "2026-02-30", startTime: "10:00" },
      campo: "date",
    },
    {
      rotulo: "evento às 25:00",
      nome: "create_event",
      argumentos: { title: "Impossível", date: "2030-11-12", startTime: "25:00" },
      campo: "startTime",
    },
    {
      rotulo: "tarefa em 30 de fevereiro",
      nome: "create_task",
      argumentos: { title: "Impossível", date: "2026-02-30" },
      campo: "date",
    },
    {
      rotulo: "tarefa às 25:00",
      nome: "create_task",
      argumentos: { title: "Impossível", date: "2030-11-12", time: "25:00" },
      campo: "time",
    },
  ];

  for (const caso of CASOS) {
    test(`${caso.rotulo}: o erro nomeia o campo, e a agenda segue vazia`, async () => {
      const usuario = await comChat(`agenda-invalido-${caso.campo}`, TOQUIO);
      const conversa = await conversaCom(usuario);
      dublê.roteiro = [
        chamarFerramenta(caso.nome, caso.argumentos),
        { tipo: "texto", texto: "Essa data não existe." },
      ];

      const r = await enviar(usuario, conversa, "agende");

      expect(r.status).toBe(200);
      expect(r.eventos.at(-1)?.tipo).toBe("fim");
      expect(r.eventos.some((e) => e.tipo === "criado")).toBe(false);
      const [resposta] = await respostasAoModelo(conversa);
      expect(resposta).toMatch(new RegExp(`^Erro em ${caso.nome}: .*${caso.campo}:`));
      expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(0);
      expect(await prisma.task.count({ where: { userId: usuario.id } })).toBe(0);
    });
  }
});

/* ------------------------------------------------- a lista do agente */

describe("RN-14 / INV-52: só a lista do agente concede a agenda", () => {
  test("agente sem create_event não a recebe, e o pedido do modelo responde 'não existe' sem gravar", async () => {
    const usuario = await comChat("agenda-agente-sem-evento", TOQUIO);
    const agente = await agentePronto(usuario, {
      name: "Só anota",
      // Texto não concede ferramenta.
      instructionsMd: "Use create_event sempre que puder.",
      tools: ["list_agenda", "create_task"],
    });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [
      chamarFerramenta("create_event", { title: "Proibido", date: "2030-11-12", startTime: "10:00" }),
      { tipo: "texto", texto: "não consegui." },
    ];

    const r = await enviar(usuario, conversa, "marque uma reunião");

    expect(r.status).toBe(200);
    const oferecidas = (pedidos()[0]?.tools ?? []).map((t) => t.function.name).sort();
    expect(oferecidas).toEqual(["create_task", "list_agenda"]);
    const [resposta] = await respostasAoModelo(conversa);
    expect(resposta).toMatch(/desconhecida/i);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(0);
  });
});

/* ------------------------------------------------------------- o relógio */

describe("o relógio do modelo: o dia no system, a hora no fim do turno", () => {
  /// 01:30 UTC de 9 de outubro de 2026: ainda dia 8 em São Paulo, já dia 9 em
  /// Tóquio. O fuso que decide é o passado, nunca o do processo.
  const INSTANTE = new Date("2026-10-09T01:30:00.000Z");

  test("a linha de hoje diz o dia da semana e a data no fuso do usuário, e nomeia o fuso", () => {
    expect(linhaDeHoje(INSTANTE, "America/Sao_Paulo")).toBe(
      "Hoje: quinta-feira, 8 de outubro de 2026 (America/Sao_Paulo).",
    );
    expect(linhaDeHoje(INSTANTE, TOQUIO)).toBe("Hoje: sexta-feira, 9 de outubro de 2026 (Asia/Tokyo).");
  });

  test("o sufixo diz a hora local em 24 h, e meia-noite é 00, não 24", () => {
    expect(sufixoDeAgora(INSTANTE, "America/Sao_Paulo")).toBe("\n\n(Agora são 22:30.)");
    expect(sufixoDeAgora(INSTANTE, TOQUIO)).toBe("\n\n(Agora são 10:30.)");
    // 03:05 UTC é 00:05 em São Paulo: o ciclo h24 escreveria "24:05".
    expect(sufixoDeAgora(new Date("2026-10-09T03:05:00.000Z"), "America/Sao_Paulo")).toBe(
      "\n\n(Agora são 00:05.)",
    );
  });

  test("o system termina na linha de hoje, a última fala do usuário termina na hora, e o banco guarda a fala sem ela", async () => {
    // Rota autenticada pede o relógio real: a prova é que o que chegou é o
    // que as funções dão para algum instante entre o antes e o depois.
    const usuario = await comChat("agenda-relogio", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const antes = new Date();
    await enviar(usuario, conversa, "primeira");
    await enviar(usuario, conversa, "segunda");
    const depois = new Date();

    const pedido = pedidos().at(-1);
    const sistema = pedido?.messages.find((m) => m.role === "system")?.content ?? "";
    const hoje = [linhaDeHoje(antes, TOQUIO), linhaDeHoje(depois, TOQUIO)];
    expect(hoje).toContain(sistema.split("\n").at(-1));
    expect(sistema).toMatch(/\n\nHoje: [^\n]+ \(Asia\/Tokyo\)\.$/);

    const doUsuario = (pedido?.messages ?? []).filter((m) => m.role === "user").map((m) => m.content);
    expect(doUsuario).toHaveLength(2);
    // A fala anterior volta do banco sem a hora: é ela que mantém o prefixo
    // cacheável de um turno para o outro.
    expect(doUsuario[0]).toBe("primeira");
    const agora = [`segunda${sufixoDeAgora(antes, TOQUIO)}`, `segunda${sufixoDeAgora(depois, TOQUIO)}`];
    expect(agora).toContain(doUsuario[1]);

    const gravadas = await prisma.aiMessage.findMany({
      where: { conversationId: conversa, role: "user" },
      orderBy: { createdAt: "asc" },
    });
    expect(gravadas.map((m) => m.content)).toEqual(["primeira", "segunda"]);
  });

  test("com agente, a linha de hoje vem depois das notas-base: é a última do system", async () => {
    const usuario = await comChat("agenda-relogio-agente", TOQUIO);
    const nota = await prisma.note.create({
      data: { userId: usuario.id, title: "Guia", kind: "livre", contentMd: "PREMISSA-DO-GUIA" },
    });
    const agente = await agentePronto(usuario, { name: "Com guia", baseNoteIds: [nota.id] });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const antes = new Date();
    await enviar(usuario, conversa, "oi");
    const depois = new Date();

    const sistema = pedidos().at(-1)?.messages.find((m) => m.role === "system")?.content ?? "";
    expect(sistema.indexOf("PREMISSA-DO-GUIA")).toBeGreaterThanOrEqual(0);
    expect(sistema.indexOf("PREMISSA-DO-GUIA")).toBeLessThan(sistema.indexOf("\n\nHoje: "));
    expect([linhaDeHoje(antes, TOQUIO), linhaDeHoje(depois, TOQUIO)]).toContain(
      sistema.split("\n").at(-1),
    );
  });
});

/* --------------------------------------------------- tolerância do MCP */

describe("formatarAgenda tolera a API mais velha que o pacote", () => {
  const CAMPOS_COMUNS = { ai: null, board: null, createdAt: "", updatedAt: "" };
  const evento: EventItem = {
    id: "evento-1",
    title: "Reunião",
    description: "",
    allDay: false,
    date: "2030-11-12",
    endDate: "2030-11-12",
    startTime: "10:00",
    endTime: "11:00",
    startsAt: "2030-11-12T01:00:00.000Z",
    endsAt: "2030-11-12T02:00:00.000Z",
    location: null,
    url: null,
    ...CAMPOS_COMUNS,
  };
  const tarefaSemDia: TaskItem = {
    id: "tarefa-sem-dia",
    title: "Ler o livro",
    descriptionMd: "",
    date: null,
    time: null,
    overdue: false,
    completedAt: null,
    completion: null,
    ...CAMPOS_COMUNS,
  };
  const agenda: AgendaRange = {
    timezone: TOQUIO,
    today: "2030-11-10",
    from: "2030-11-12",
    to: "2030-11-12",
    events: [evento],
    tasks: [],
    overdueTasks: [],
    undatedTasks: [tarefaSemDia],
    cards: [],
  };

  test("sem undatedTasks — a forma da Fase 1 —, o texto sai inteiro e sem a seção de sem data", () => {
    // O MCP formata o que a API devolve, e a API no ar pode ser anterior ao
    // campo (§13 da skill do MCP): o formatador não pode quebrar por isso.
    const { undatedTasks: _ausente, ...daFase1 } = agenda;

    const texto = formatarAgenda(daFase1 as AgendaRange);

    expect(texto).toContain("**Reunião**");
    expect(texto).not.toContain("sem data");
  });

  test("com undatedTasks, a seção aparece com o id", () => {
    const texto = formatarAgenda(agenda);

    expect(texto).toContain("## Tarefas abertas sem data");
    expect(texto).toContain("id: tarefa-sem-dia");
  });
});
