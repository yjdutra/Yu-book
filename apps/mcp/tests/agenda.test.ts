import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatarAgenda, formatarEvento, formatarTarefa } from "@yu-book/shared";
import type { AgendaRange, AiMark, EventItem, TaskItem } from "@yu-book/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * A agenda do lado do MCP (frente de agenda, Fase 2).
 *
 * O que a API grava e converte ela prova nos testes dela. O que só este pacote
 * pode errar é o **corpo** que ele manda e o **caminho** que ele não toma:
 * converter dia ou hora deste lado gravaria o horário deslocado pelo fuso duas
 * vezes, e nada falharia. Por isso as asserções são sobre o JSON que sai no
 * `fetch` — inclusive a ausência de `GET /ai/settings` —, e o texto de volta é
 * comparado com o formatador de `shared`, não com uma frase escrita aqui.
 */

interface Chamada {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | undefined;
}

const chamadas: Chamada[] = [];

const AGORA = "2026-10-09T15:00:00.000Z";
const EVENTO_ID = "88888888-8888-4888-8888-888888888888";
const TAREFA_ID = "99999999-9999-4999-8999-999999999999";

const COMPLETO = identidade(["yubook:read", "yubook:write"]);

/**
 * Tipado pelo contrato: campo novo em `EventItem` quebra o typecheck aqui. Com
 * `repeat` no corpo, devolve a regra como a API da série (R1) devolveria.
 */
function evento(corpo: Record<string, unknown>): EventItem {
  const origem = corpo["origin"] as { via: "mcp"; author: string } | undefined;
  const repeat = corpo["repeat"] as { days: number[]; until?: string } | undefined;
  const ai: AiMark | null = origem
    ? {
        generatedAt: AGORA,
        via: origem.via,
        author: origem.author,
        conversationId: null,
        agentName: null,
        routineName: null,
        runId: null,
        revisedAt: null,
      }
    : null;
  return {
    id: EVENTO_ID,
    title: String(corpo["title"]),
    description: "",
    allDay: false,
    // O que a API devolveria: dia e hora locais, os mesmos que recebeu.
    date: String(corpo["date"]),
    endDate: String(corpo["date"]),
    startTime: (corpo["startTime"] as string | undefined) ?? null,
    endTime: (corpo["endTime"] as string | undefined) ?? null,
    startsAt: "2026-10-15T17:00:00.000Z",
    endsAt: "2026-10-15T18:00:00.000Z",
    occurrenceDate: String(corpo["date"]),
    recurrence: repeat ? { days: repeat.days, until: repeat.until ?? null } : null,
    location: null,
    url: null,
    board: null,
    ai,
    createdAt: AGORA,
    updatedAt: AGORA,
  };
}

function tarefa(completedAt: string | null, autor: string | null): TaskItem {
  return {
    id: TAREFA_ID,
    title: "Pagar boleto",
    descriptionMd: "",
    date: null,
    time: null,
    overdue: false,
    completedAt,
    completion: completedAt && autor ? { via: "mcp", author: autor, agentName: null } : null,
    board: null,
    ai: null,
    series: null,
    createdAt: AGORA,
    updatedAt: AGORA,
  };
}

/**
 * A agenda de uma API **mais velha** que este pacote: sem `undatedTasks`, que
 * entrou na Fase 2. O formatador lê com `?? []`; a tool não pode falhar por
 * isso (§13 da skill do MCP).
 */
const AGENDA_DA_FASE_1 = {
  timezone: "America/Sao_Paulo",
  today: "2026-10-09",
  from: "2026-10-15",
  to: "2026-10-15",
  events: [evento({ title: "Dentista", date: "2026-10-15", startTime: "14:00", endTime: "15:00" })],
  tasks: [],
  overdueTasks: [],
  cards: [],
} satisfies Omit<AgendaRange, "undatedTasks">;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const corpo =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    chamadas.push({ metodo, url: String(url), corpo });

    const caminho = new URL(String(url)).pathname;
    if (metodo === "GET" && caminho === "/agenda") return json(AGENDA_DA_FASE_1);
    if (metodo === "POST" && caminho === "/events") return json(evento(corpo ?? {}), 201);
    if (metodo === "PATCH" && caminho === `/tasks/${TAREFA_ID}/complete`) {
      const concluir = corpo?.["completed"] === true;
      const origem = corpo?.["origin"] as { author: string } | undefined;
      return json(tarefa(concluir ? AGORA : null, origem?.author ?? null));
    }
    return json({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const texto = (r: CallToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe("o registro da agenda", () => {
  it("list_agenda está sempre; as três de escrita só com a escrita liberada", async () => {
    const sem = await abrirCliente({ escrita: false }, COMPLETO);
    const com = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const semEscrita = (await sem.listarTools()).map((t) => t.name);
      const comEscrita = (await com.listarTools()).map((t) => t.name);

      expect(semEscrita).toContain("list_agenda");
      expect(comEscrita).toContain("list_agenda");
      for (const nome of ["create_event", "create_task", "complete_task"]) {
        expect(semEscrita, `${nome} vazou para a superfície de leitura`).not.toContain(nome);
        expect(comEscrita, `${nome} não foi registrada com a escrita ligada`).toContain(nome);
      }
    } finally {
      await sem.encerrar();
      await com.encerrar();
    }
  });

  it("nenhuma tool publica $ref no inputSchema", async () => {
    // Dois campos sobre a **mesma instância** de schema viram `$ref` no JSON
    // Schema (`endTime` apontando para `#/properties/startTime`), que
    // provedor e cliente MCP leem mal — e um `refine` reusado nem com
    // `.describe()` se separa (`novoDiaCivilSchema`, em `shared`). Nada
    // falha ao reusar: o sinal é só este.
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const tools = await cliente.listarTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(JSON.stringify(tool.inputSchema), `${tool.name} publica $ref`).not.toContain(
          '"$ref"',
        );
      }
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("list_agenda", () => {
  it("acima de 31 dias recusa sem chamar a API", async () => {
    const cliente = await abrirCliente({ escrita: false }, COMPLETO);
    try {
      const r = await cliente.chamarTool("list_agenda", { from: "2026-10-01", to: "2026-11-01" });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("No máximo 31 dias");
      expect(chamadas).toHaveLength(0);
    } finally {
      await cliente.encerrar();
    }
  });

  it("to antes de from recusa sem chamar a API", async () => {
    const cliente = await abrirCliente({ escrita: false }, COMPLETO);
    try {
      const r = await cliente.chamarTool("list_agenda", { from: "2026-10-15", to: "2026-10-14" });
      expect(r.isError).toBe(true);
      expect(chamadas).toHaveLength(0);
    } finally {
      await cliente.encerrar();
    }
  });

  it("sem to pede um dia só, e devolve o texto de formatarAgenda — mesmo sem undatedTasks", async () => {
    const cliente = await abrirCliente({ escrita: false }, COMPLETO);
    try {
      const r = await cliente.chamarTool("list_agenda", { from: "2026-10-15" });

      expect(r.isError).toBeFalsy();
      // Uma chamada só, nenhuma a `/ai/settings`: a agenda chega em dia e hora
      // locais, e este lado não converte nada.
      expect(chamadas).toHaveLength(1);
      const url = new URL(chamadas[0]?.url ?? "");
      expect(url.pathname).toBe("/agenda");
      expect(url.searchParams.get("from")).toBe("2026-10-15");
      expect(url.searchParams.get("to")).toBe("2026-10-15");
      // Ausente lê como vazia: o mesmo texto da agenda com a lista vazia.
      expect(texto(r)).toBe(formatarAgenda({ ...AGENDA_DA_FASE_1, undatedTasks: [] }));
      expect(texto(r)).toContain("14:00–15:00");
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("create_event", () => {
  it("manda origin e dia e hora crus, sem pedir o fuso, e devolve o texto formatado", async () => {
    const cliente = await abrirCliente({ escrita: true, nomeDoCliente: "Claude Code" }, COMPLETO);
    try {
      const r = await cliente.chamarTool("create_event", {
        title: "Dentista",
        date: "2026-10-15",
        startTime: "14:00",
        endTime: "15:00",
      });

      expect(r.isError).toBeFalsy();
      // Uma chamada só: nem `/ai/settings` antes. Quem converte é a API.
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.metodo).toBe("POST");
      expect(new URL(chamadas[0]?.url ?? "").pathname).toBe("/events");
      // `toEqual` sobre o corpo inteiro: campo opcional não enviado não pode
      // virar `undefined` nem `null`, e `14:00` não pode virar instante.
      expect(chamadas[0]?.corpo).toEqual({
        title: "Dentista",
        date: "2026-10-15",
        startTime: "14:00",
        endTime: "15:00",
        origin: { via: "mcp", author: "Claude Code" },
      });

      const criado = evento(chamadas[0]?.corpo ?? {});
      expect(texto(r)).toBe(`Evento criado.\n\n${formatarEvento(criado)}`);
      expect(texto(r)).toContain("gerado por IA");
    } finally {
      await cliente.encerrar();
    }
  });

  it("repeat vai em dias numéricos, e o texto de volta diz a regra", async () => {
    const cliente = await abrirCliente({ escrita: true, nomeDoCliente: "Claude Code" }, COMPLETO);
    try {
      // Fora de ordem e repetido: a API grava em ordem e sem repetir.
      const r = await cliente.chamarTool("create_event", {
        title: "Inglês",
        date: "2026-10-12",
        startTime: "19:00",
        repeat: { days: ["qua", "seg", "seg"], until: "2026-12-16" },
      });
      // Sem `until`, a chave não vai — nem `undefined`, nem `null`.
      const semFim = await cliente.chamarTool("create_event", {
        title: "Academia",
        date: "2026-10-12",
        startTime: "07:00",
        repeat: { days: ["dom", "sab"] },
      });

      expect(r.isError).toBeFalsy();
      expect(semFim.isError).toBeFalsy();
      expect(chamadas).toHaveLength(2);
      expect(chamadas[0]?.corpo?.["repeat"]).toEqual({ days: [1, 3], until: "2026-12-16" });
      expect(chamadas[1]?.corpo?.["repeat"]).toEqual({ days: [0, 6] });

      const criado = evento(chamadas[0]?.corpo ?? {});
      expect(texto(r)).toBe(`Evento criado.\n\n${formatarEvento(criado)}`);
      expect(texto(r)).toContain("repete seg, qua até 2026-12-16");
      expect(texto(semFim)).toContain("repete dom, sáb");
      expect(texto(r)).not.toContain("não se repete");
    } finally {
      await cliente.encerrar();
    }
  });

  it("API sem a série: resposta sem recurrence vira aviso, sem erro e sem reenvio", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    // A API anterior à R1: o schema não é estrito, descarta `repeat` e devolve
    // 201 com um evento avulso — sem `occurrenceDate` nem `recurrence`.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const corpo =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      chamadas.push({ metodo: init?.method ?? "GET", url: String(url), corpo });
      const { recurrence: _r, occurrenceDate: _o, ...velho } = evento({
        ...corpo,
        repeat: undefined,
      });
      return json(velho, 201);
    });
    try {
      const r = await cliente.chamarTool("create_event", {
        title: "Inglês",
        date: "2026-10-12",
        startTime: "19:00",
        repeat: { days: ["seg", "qua"] },
      });

      // O evento existe: erro faria o modelo criar outro.
      expect(r.isError).toBeFalsy();
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.corpo?.["repeat"]).toEqual({ days: [1, 3] });
      expect(texto(r)).toContain("Evento criado.");
      // A linha da regra, que só o formatador escreve, não aparece.
      expect(texto(r)).not.toContain("repete seg");
      expect(texto(r)).toContain("o evento não se repete");
      expect(texto(r)).toContain("só esta ocorrência foi criada");
      expect(texto(r)).toContain("Não chame `create_event` de novo");
    } finally {
      await cliente.encerrar();
    }
  });

  it("NOT_FOUND com boardId fala do quadro, não de search_notes", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    // A rota `POST /events` responde 404 aqui como a de uma API sem a agenda,
    // ou como o service a um quadro de outra conta.
    vi.stubGlobal("fetch", async () =>
      json({ error: { code: "NOT_FOUND", message: "Quadro não encontrado" } }, 404),
    );
    try {
      const r = await cliente.chamarTool("create_event", {
        title: "Reunião",
        date: "2026-10-15",
        startTime: "10:00",
        boardId: "11111111-1111-4111-8111-111111111111",
      });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("Nada foi criado");
      expect(texto(r)).toContain("list_boards");
      expect(texto(r)).not.toContain("search_notes");
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("complete_task", () => {
  it("chama a rota própria com origin, e omitir completed é concluir", async () => {
    const cliente = await abrirCliente({ escrita: true, nomeDoCliente: "Cursor" }, COMPLETO);
    try {
      const r = await cliente.chamarTool("complete_task", { taskId: TAREFA_ID });

      expect(r.isError).toBeFalsy();
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.metodo).toBe("PATCH");
      expect(chamadas[0]?.corpo).toEqual({
        completed: true,
        origin: { via: "mcp", author: "Cursor" },
      });
      expect(texto(r)).toBe(`Tarefa concluída.\n\n${formatarTarefa(tarefa(AGORA, "Cursor"))}`);
    } finally {
      await cliente.encerrar();
    }
  });
});
