import {
  FERRAMENTAS_DO_ACERVO,
  FERRAMENTAS_SEM_AGENTE,
  SIGLAS_DOS_DIAS,
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  descreverDias,
  diasDasSiglas,
  formatarAgenda,
  formatarEvento,
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
import {
  instrucoesPara,
  linhaDeHoje,
  sufixoDeAgora,
} from "../src/modules/assistente/agentes.service.js";
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
 * E, desde a R2 da frente de eventos recorrentes: **compromisso semanal é uma
 * série só** — o `repeat` em siglas vira uma linha com os dias em 0–6, a tela
 * recebe os dias descritos só quando há série, o `list_agenda` devolve cada
 * ocorrência com a regra e o `id` da série, e o Desfazer apaga a série inteira.
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

/* ------------------------------------------- create_event com repetição */

/// Segunda-feira, 4 de novembro de 2030. A semana de 4 a 10 é a do pedido do
/// operador: inglês seg/qua/sex de manhã e ter/qui à tarde.
const SEG = "2030-11-04";

/** Os trechos aparecem no texto nesta ordem, cada um depois do anterior. */
function emOrdem(texto: string, trechos: string[]): void {
  let desde = 0;
  for (const trecho of trechos) {
    const i = texto.indexOf(trecho, desde);
    expect(i, `«${trecho}» ausente, ou fora de ordem, em:\n${texto}`).toBeGreaterThanOrEqual(0);
    desde = i + trecho.length;
  }
}

/** Quantas vezes `trecho` aparece em `texto`. */
const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

describe("INV-58 / INV-66: o compromisso semanal marcado pelo chat é UMA série", () => {
  test("repeat em siglas grava uma linha só, com os dias em 0–6 e o fim, marcada pelo chat; o criado diz os dias, e o evento simples segue sem a chave repeat", async () => {
    const usuario = await comChat("serie-chat", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_event", {
        title: "Inglês",
        date: SEG,
        startTime: "08:00",
        endTime: "09:00",
        repeat: { days: ["seg", "qua", "sex"], until: "2030-12-20" },
      }),
      chamarFerramenta("create_event", { title: "Dentista", date: "2030-11-12", startTime: "15:00" }),
      { tipo: "texto", texto: "Marquei." },
    ];

    const r = await enviar(usuario, conversa, "inglês seg/qua/sex às 8h até 20/12; dentista dia 12");

    expect(r.status).toBe(200);

    // Uma linha pela série, não uma por semana; mais a do dentista.
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(2);
    const serie = await prisma.event.findFirstOrThrow({
      where: { userId: usuario.id, title: "Inglês" },
    });
    expect(serie.repeatDays).toEqual([1, 3, 5]);
    expect(serie.repeatUntil?.toISOString()).toBe("2030-12-20T00:00:00.000Z");
    expect(serie.exdates).toEqual([]);
    // A primeira ocorrência, 08:00 em Tóquio, é 23:00 UTC da véspera.
    expect(serie.startsAt.toISOString()).toBe("2030-11-03T23:00:00.000Z");
    expect(serie.endsAt.toISOString()).toBe("2030-11-04T00:00:00.000Z");
    expect(serie).toMatchObject({
      aiVia: "chat",
      aiAuthor: "estudio/conversa",
      aiConversationId: conversa,
    });
    const simples = await prisma.event.findFirstOrThrow({
      where: { userId: usuario.id, title: "Dentista" },
    });
    expect(simples.repeatDays).toEqual([]);
    expect(simples.repeatUntil).toBeNull();

    // A tela recebe os dias já descritos; o evento simples, sem a chave —
    // é dela que dependem os `toEqual` do criado sem repetição.
    const anunciados = criadosAnunciados(r);
    expect(anunciados).toEqual([
      {
        kind: "event",
        id: serie.id,
        title: "Inglês",
        date: SEG,
        time: "08:00",
        repeat: "seg, qua, sex",
      },
      { kind: "event", id: simples.id, title: "Dentista", date: "2030-11-12", time: "15:00" },
    ]);
    expect(anunciados[1]).not.toHaveProperty("repeat");
    // A fala gravada guarda o mesmo, para o Desfazer depois de recarregar.
    const ultima = await prisma.aiMessage.findFirstOrThrow({
      where: { conversationId: conversa, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    expect(ultima.created).toEqual(anunciados);
    expect((ultima.created as unknown as ChatCreated[])[1]).not.toHaveProperty("repeat");

    // O modelo confirma uma série, não um compromisso avulso.
    const [daSerie = "", doSimples = ""] = await respostasAoModelo(conversa);
    expect(daSerie).toContain("repete seg, qua, sex até 2030-12-20");
    expect(daSerie).toContain(`id: ${serie.id}`);
    expect(doSimples).not.toContain("repete");
  });

  test("manhã seg/qua/sex e tarde ter/qui no mesmo turno são duas séries, e list_agenda devolve as cinco ocorrências da semana com a regra e o id da série", async () => {
    const usuario = await comChat("serie-chat-duas", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_event", {
        title: "Inglês manhã",
        date: SEG,
        startTime: "08:00",
        endTime: "09:00",
        repeat: { days: ["seg", "qua", "sex"] },
      }),
      chamarFerramenta("create_event", {
        title: "Inglês tarde",
        date: SEG,
        startTime: "14:00",
        endTime: "15:00",
        repeat: { days: ["ter", "qui"] },
      }),
      chamarFerramenta("list_agenda", { from: SEG, to: "2030-11-10" }),
      { tipo: "texto", texto: "Pronto." },
    ];

    const r = await enviar(usuario, conversa, "inglês seg/qua/sex de manhã e ter/qui à tarde");

    expect(r.status).toBe(200);
    expect(r.eventos.at(-1)?.tipo).toBe("fim");
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(2);
    const manha = await prisma.event.findFirstOrThrow({
      where: { userId: usuario.id, title: "Inglês manhã" },
    });
    const tarde = await prisma.event.findFirstOrThrow({
      where: { userId: usuario.id, title: "Inglês tarde" },
    });
    expect(manha.repeatDays).toEqual([1, 3, 5]);
    expect(manha.repeatUntil).toBeNull();
    expect(tarde.repeatDays).toEqual([2, 4]);
    // Pedida a partir da segunda, a série de ter/qui começa na terça: 14:00
    // em Tóquio é 05:00 UTC.
    expect(tarde.startsAt.toISOString()).toBe("2030-11-05T05:00:00.000Z");

    expect(criadosAnunciados(r)).toEqual([
      {
        kind: "event",
        id: manha.id,
        title: "Inglês manhã",
        date: SEG,
        time: "08:00",
        repeat: "seg, qua, sex",
      },
      {
        kind: "event",
        id: tarde.id,
        title: "Inglês tarde",
        date: "2030-11-05",
        time: "14:00",
        repeat: "ter, qui",
      },
    ]);

    const [, , texto = ""] = await respostasAoModelo(conversa);
    const MANHA = "08:00–09:00 · **Inglês manhã** · repete seg, qua, sex";
    const TARDE = "14:00–15:00 · **Inglês tarde** · repete ter, qui";
    emOrdem(texto, [
      "## segunda-feira, 2030-11-04",
      MANHA,
      "## terça-feira, 2030-11-05",
      TARDE,
      "## quarta-feira, 2030-11-06",
      MANHA,
      "## quinta-feira, 2030-11-07",
      TARDE,
      "## sexta-feira, 2030-11-08",
      MANHA,
    ]);
    expect(vezes(texto, "**Inglês manhã**")).toBe(3);
    expect(vezes(texto, "**Inglês tarde**")).toBe(2);
    expect(vezes(texto, " · repete ")).toBe(5);
    // Fim de semana não tem cabeçalho de dia: nenhuma das duas séries cai
    // nele. (O "hoje é …" do cabeçalho segue o relógio real e pode ser sábado.)
    expect(texto).not.toContain("## sábado");
    expect(texto).not.toContain("## domingo");
    // Cada ocorrência leva, na linha de baixo, o id da sua série.
    const linhas = texto.split("\n");
    linhas.forEach((linha, i) => {
      if (linha.includes("**Inglês manhã**")) expect(linhas[i + 1]).toBe(`  id: ${manha.id}`);
      if (linha.includes("**Inglês tarde**")) expect(linhas[i + 1]).toBe(`  id: ${tarde.id}`);
    });
  });

  test("Desfazer o criado — DELETE sem scope — apaga a série inteira, e não só a primeira ocorrência", async () => {
    const usuario = await comChat("serie-chat-desfazer", TOQUIO);
    const conversa = await conversaCom(usuario);
    dublê.roteiro = [
      chamarFerramenta("create_event", {
        title: "Academia",
        date: SEG,
        startTime: "07:00",
        repeat: { days: ["seg", "qua", "sex"] },
      }),
      { tipo: "texto", texto: "Marquei." },
    ];
    const r = await enviar(usuario, conversa, "academia seg/qua/sex às 7h");
    const [criado] = criadosAnunciados(r);
    expect(criado?.repeat).toBe("seg, qua, sex");
    const ocorrencias = async () => {
      const { status, body } = await api(usuario, "GET", `/agenda?from=${SEG}&to=2030-11-30`);
      expect(status).toBe(200);
      return (body as AgendaRange).events.filter((e) => e.title === "Academia");
    };
    // De 4 a 30 de novembro, doze segundas, quartas e sextas.
    expect(await ocorrencias()).toHaveLength(12);

    // O que o cartão do chat chama: `/events/:id`, sem query.
    const { status } = await api(usuario, "DELETE", `/events/${criado?.id}`);

    expect(status).toBe(204);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(0);
    expect(await ocorrencias()).toEqual([]);
  });
});

describe("repetição que o modelo erra volta a ele como erro, e nada é gravado", () => {
  const CASOS: { rotulo: string; argumentos: Record<string, unknown>; resposta: RegExp }[] = [
    {
      rotulo: "dias por extenso em vez de sigla",
      argumentos: { date: SEG, startTime: "08:00", repeat: { days: ["segunda", "quarta"] } },
      resposta: /^Erro em create_event: repeat\.days\.0:/,
    },
    {
      rotulo: "dias em número em vez de sigla",
      argumentos: { date: SEG, startTime: "08:00", repeat: { days: [1, 3] } },
      resposta: /^Erro em create_event: repeat\.days\.0:/,
    },
    {
      rotulo: "nenhum dia",
      argumentos: { date: SEG, startTime: "08:00", repeat: { days: [] } },
      resposta: /^Erro em create_event: repeat\.days:/,
    },
    {
      rotulo: "série de dois dias inteiros",
      argumentos: {
        date: SEG,
        endDate: "2030-11-05",
        allDay: true,
        repeat: { days: ["seg"] },
      },
      resposta: /^Erro em create_event: Um evento que se repete dura um dia só$/,
    },
    {
      rotulo: "fim da repetição antes do início",
      argumentos: {
        date: SEG,
        startTime: "08:00",
        repeat: { days: ["seg"], until: "2030-11-01" },
      },
      resposta: /^Erro em create_event: A repetição não pode terminar antes do início$/,
    },
  ];

  for (const caso of CASOS) {
    test(`${caso.rotulo}: a conversa fecha, o erro diz o que corrigir, e a agenda segue vazia`, async () => {
      const usuario = await comChat("serie-chat-invalida", TOQUIO);
      const conversa = await conversaCom(usuario);
      dublê.roteiro = [
        chamarFerramenta("create_event", { title: "Aula", ...caso.argumentos }),
        { tipo: "texto", texto: "Não deu." },
      ];

      const r = await enviar(usuario, conversa, "aula toda semana");

      expect(r.status).toBe(200);
      expect(r.eventos.at(-1)?.tipo).toBe("fim");
      expect(r.eventos.some((e) => e.tipo === "criado")).toBe(false);
      const [resposta] = await respostasAoModelo(conversa);
      expect(resposta).toMatch(caso.resposta);
      expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(0);
    });
  }
});

describe("§4.6: a regra da série mora na descrição de create_event, não no system", () => {
  test("a descrição a diz; o system não a repete, nem com create_event", () => {
    expect(FERRAMENTAS_DO_ACERVO.create_event.descricao).toContain("cria UMA série");
    expect(FERRAMENTAS_DO_ACERVO.create_event.descricao).toContain("`repeat`");
    // Os dois caminhos do system: o assistente sem agente e um agente que só
    // cria evento.
    for (const ferramentas of [FERRAMENTAS_SEM_AGENTE, ["create_event"] as const]) {
      const system = instrucoesPara(ferramentas, false);
      // O bloco de create_event está lá: sem ele, o "não diz" abaixo não prova nada.
      expect(system).toContain("`allDay`");
      // Nem a frase da descrição, nem outra que diga o mesmo: o system não
      // fala de série nem do argumento que a cria.
      expect(system.toLowerCase()).not.toContain("série");
      expect(system).not.toContain("repeat");
      expect(system.toLowerCase()).not.toContain("semanal");
    }
  });
});

describe("as siglas dos dias: a única conversão entre o modelo e a API", () => {
  test("diasDasSiglas devolve 0–6 em ordem e sem repetir, com domingo 0 e sábado 6", () => {
    expect(diasDasSiglas(["sex", "seg", "seg", "qua"])).toEqual([1, 3, 5]);
    expect(diasDasSiglas([...SIGLAS_DOS_DIAS].reverse())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(diasDasSiglas(["dom"])).toEqual([0]);
    expect(diasDasSiglas(["sab"])).toEqual([6]);
  });

  test("descreverDias escreve as siglas em ordem, e os sete dias como todo dia", () => {
    expect(descreverDias([5, 1, 3, 1])).toBe("seg, qua, sex");
    expect(descreverDias([0, 6])).toBe("dom, sáb");
    expect(descreverDias([0, 1, 2, 3, 4, 5, 6])).toBe("todo dia");
    expect(descreverDias([6, 5, 4, 3, 2, 1, 0, 0])).toBe("todo dia");
    // Ida e volta: o que o modelo pediu é o que a tela lê.
    expect(descreverDias(diasDasSiglas(["qui", "ter"]))).toBe("ter, qui");
  });
});

/* --------------------------------------------------- tolerância do MCP */

describe("formatarAgenda tolera a API mais velha que o pacote", () => {
  const CAMPOS_COMUNS = { ai: null, board: null, habitActivity: null, createdAt: "", updatedAt: "" };
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
    occurrenceDate: "2030-11-12",
    recurrence: null,
    location: null,
    url: null,
    checkedIn: false,
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
    series: null,
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

  test("sem recurrence — o evento de antes da série —, agenda e confirmação saem inteiras e não dizem que repete", () => {
    // Lançar aqui, depois da escrita, diria ao modelo que falhou um evento
    // que a API já criou.
    const { recurrence: _ausente, occurrenceDate: _tambem, ...antigo } = evento;
    const daApiVelha = antigo as EventItem;

    const naAgenda = formatarAgenda({ ...agenda, events: [daApiVelha] });
    const confirmacao = formatarEvento(daApiVelha);

    expect(naAgenda).toContain("10:00–11:00 · **Reunião**");
    expect(naAgenda).toContain("id: evento-1");
    expect(naAgenda).not.toContain("repete");
    expect(confirmacao).toContain("**Reunião**");
    expect(confirmacao).toContain("id: evento-1");
    expect(confirmacao).not.toContain("repete");
    // `recurrence: null` é o evento simples da API nova: também não repete.
    expect(formatarEvento(evento)).not.toContain("repete");
  });

  test("com a regra, a confirmação diz os dias e o fim; a série sem fim não diz até", () => {
    const comFim = formatarEvento({
      ...evento,
      recurrence: { days: [1, 3, 5], until: "2030-12-20" },
    });
    const semFim = formatarEvento({
      ...evento,
      recurrence: { days: [0, 1, 2, 3, 4, 5, 6], until: null },
    });

    expect(comFim).toContain("repete seg, qua, sex até 2030-12-20");
    expect(semFim).toContain("repete todo dia");
    expect(semFim).not.toContain(" até ");
  });
});
