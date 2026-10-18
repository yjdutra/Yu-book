import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatarEvento, formatarTarefa } from "@yu-book/shared";
import type { EventItem, TaskItem } from "@yu-book/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { abrirCliente, identidade } from "./arnes.js";
import type { ToolAnunciada } from "./arnes.js";

/**
 * O controle da agenda pelo MCP: editar, excluir e converter.
 *
 * O que a API faz com cada pedido ela prova nos testes dela (`conversao`,
 * `eventos-recorrentes`). Aqui se prova o que só este pacote pode errar: o
 * caminho, a query de alcance e o corpo que saem no `fetch`, as siglas
 * convertidas em número, e a trava de série — sem `scope`, uma série não é
 * tocada, e nenhum PATCH ou DELETE sai.
 */

interface Chamada {
  metodo: string;
  caminho: string;
  busca: string;
  corpo: Record<string, unknown> | undefined;
}

const chamadas: Chamada[] = [];

const AGORA = "2026-10-18T15:00:00.000Z";
const SIMPLES_ID = "11111111-1111-4111-8111-111111111111";
const SERIE_ID = "22222222-2222-4222-8222-222222222222";
const TAREFA_ID = "33333333-3333-4333-8333-333333333333";
const SUMIDO_ID = "44444444-4444-4444-8444-444444444444";

const COMPLETO = identidade(["yubook:read", "yubook:write"]);

function evento(id: string, serie: boolean): EventItem {
  return {
    id,
    title: serie ? "Academia" : "Dentista",
    description: "",
    allDay: false,
    date: "2026-10-21",
    endDate: "2026-10-21",
    startTime: "07:00",
    endTime: "08:00",
    startsAt: "2026-10-21T10:00:00.000Z",
    endsAt: "2026-10-21T11:00:00.000Z",
    occurrenceDate: "2026-10-21",
    recurrence: serie ? { days: [1, 3], until: null } : null,
    location: null,
    url: null,
    board: null,
    ai: null,
    createdAt: AGORA,
    updatedAt: AGORA,
  };
}

const TAREFA: TaskItem = {
  id: TAREFA_ID,
  title: "Pagar boleto",
  descriptionMd: "",
  date: "2026-10-21",
  time: "09:00",
  overdue: false,
  completedAt: null,
  completion: null,
  board: null,
  ai: null,
  createdAt: AGORA,
  updatedAt: AGORA,
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const naoEncontrado = () =>
  json({ error: { code: "NOT_FOUND", message: "Não encontrado" } }, 404);

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const corpo =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const alvo = new URL(String(url));
    chamadas.push({ metodo, caminho: alvo.pathname, busca: alvo.search, corpo });

    const caminho = alvo.pathname;
    if (caminho.includes(SUMIDO_ID)) return naoEncontrado();
    if (caminho === `/events/${SIMPLES_ID}`) {
      if (metodo === "DELETE") return new Response(null, { status: 204 });
      return json(evento(SIMPLES_ID, false));
    }
    if (caminho === `/events/${SERIE_ID}`) {
      if (metodo === "DELETE") return new Response(null, { status: 204 });
      return json(evento(SERIE_ID, true));
    }
    if (caminho === `/tasks/${TAREFA_ID}`) {
      if (metodo === "DELETE") return new Response(null, { status: 204 });
      return json(TAREFA);
    }
    if (metodo === "POST" && caminho.endsWith("/to-task")) return json(TAREFA, 201);
    if (metodo === "POST" && caminho.endsWith("/to-event")) {
      return json(evento(SIMPLES_ID, false), 201);
    }
    return naoEncontrado();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const texto = (r: CallToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

async function chamar(nome: string, argumentos: Record<string, unknown>) {
  const cliente = await abrirCliente({ escrita: true }, COMPLETO);
  try {
    return await cliente.chamarTool(nome, argumentos);
  } finally {
    await cliente.encerrar();
  }
}

const NOVAS = [
  "update_event",
  "delete_event",
  "update_task",
  "delete_task",
  "convert_event_to_task",
  "convert_task_to_event",
];

describe("o registro do controle da agenda", () => {
  it("as seis só existem com a escrita ligada, e só as exclusões são destrutivas", async () => {
    const sem = await abrirCliente({ escrita: false }, COMPLETO);
    const com = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const semEscrita = (await sem.listarTools()).map((t) => t.name);
      const comEscrita = await com.listarTools();
      const nomes = comEscrita.map((t) => t.name);
      for (const nome of NOVAS) {
        expect(semEscrita, `${nome} vazou para a leitura`).not.toContain(nome);
        expect(nomes, `${nome} não foi registrada`).toContain(nome);
      }
      const destrutivas = comEscrita
        .filter((t) => NOVAS.includes(t.name))
        .filter(
          (t) =>
            (t as ToolAnunciada & { annotations?: { destructiveHint?: boolean } }).annotations
              ?.destructiveHint,
        )
        .map((t) => t.name);
      expect(destrutivas).toEqual(["delete_event", "delete_task"]);
    } finally {
      await sem.encerrar();
      await com.encerrar();
    }
  });
});

describe("update_event", () => {
  it("evento simples sem scope: lê, e o PATCH vai sem alcance e só com o que muda", async () => {
    const r = await chamar("update_event", { eventId: SIMPLES_ID, startTime: "15:00" });

    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET", "PATCH"]);
    expect(chamadas[1]).toMatchObject({
      caminho: `/events/${SIMPLES_ID}`,
      busca: "",
      corpo: { startTime: "15:00" },
    });
    expect(texto(r)).toBe(`Evento alterado.\n\n${formatarEvento(evento(SIMPLES_ID, false))}`);
  });

  it("série sem scope é recusada sem PATCH nenhum", async () => {
    const r = await chamar("update_event", { eventId: SERIE_ID, title: "Musculação" });

    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Nada foi alterado");
    expect(texto(r)).toContain("`scope`");
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET"]);
  });

  it("com scope, não lê antes, e o alcance vai na query; repeat sai em números", async () => {
    const r = await chamar("update_event", {
      eventId: SERIE_ID,
      scope: "seguintes",
      occurrenceDate: "2026-10-21",
      repeat: { days: ["ter", "qui"], until: "2026-12-18" },
    });

    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      metodo: "PATCH",
      busca: "?scope=seguintes&occurrenceDate=2026-10-21",
      corpo: { repeat: { days: [2, 4], until: "2026-12-18" } },
    });
  });

  it("sem campo para mudar, recusa sem chamar a API", async () => {
    const r = await chamar("update_event", { eventId: SIMPLES_ID, scope: "todas" });
    expect(r.isError).toBe(true);
    expect(chamadas).toHaveLength(0);
  });

  it("nada manda origin: editar não gera conteúdo", async () => {
    await chamar("update_event", { eventId: SIMPLES_ID, scope: "todas", title: "Outro" });
    expect(chamadas[0]?.corpo).toEqual({ title: "Outro" });
  });
});

describe("delete_event", () => {
  it("evento simples: lê e exclui", async () => {
    const r = await chamar("delete_event", { eventId: SIMPLES_ID });
    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}${c.busca}`)).toEqual([
      `GET /events/${SIMPLES_ID}`,
      `DELETE /events/${SIMPLES_ID}`,
    ]);
  });

  it("série sem scope não exclui nada", async () => {
    const r = await chamar("delete_event", { eventId: SERIE_ID });
    expect(r.isError).toBe(true);
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
  });

  it("uma ocorrência: DELETE com esta e o dia, e o texto diz que as outras ficam", async () => {
    const r = await chamar("delete_event", {
      eventId: SERIE_ID,
      scope: "esta",
      occurrenceDate: "2026-10-21",
    });
    expect(chamadas).toEqual([
      expect.objectContaining({
        metodo: "DELETE",
        busca: "?scope=esta&occurrenceDate=2026-10-21",
      }),
    ]);
    expect(texto(r)).toContain("as outras continuam");
  });

  it("id inexistente é recusa com a frase do evento", async () => {
    const r = await chamar("delete_event", { eventId: SUMIDO_ID });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Não existe evento com esse id");
  });
});

describe("update_task e delete_task", () => {
  it("update_task manda só o que muda, null inclusive", async () => {
    const r = await chamar("update_task", { taskId: TAREFA_ID, date: null });
    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas).toEqual([
      expect.objectContaining({ metodo: "PATCH", caminho: `/tasks/${TAREFA_ID}`, corpo: { date: null } }),
    ]);
    expect(texto(r)).toBe(`Tarefa alterada.\n\n${formatarTarefa(TAREFA)}`);
  });

  it("delete_task exclui pela rota da tarefa", async () => {
    const r = await chamar("delete_task", { taskId: TAREFA_ID });
    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas).toEqual([
      expect.objectContaining({ metodo: "DELETE", caminho: `/tasks/${TAREFA_ID}` }),
    ]);
  });

  it("tarefa inexistente é recusa com a frase da tarefa", async () => {
    const r = await chamar("delete_task", { taskId: SUMIDO_ID });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Não existe tarefa com esse id");
  });
});

describe("conversões", () => {
  it("convert_event_to_task com o dia da ocorrência usa scope=esta", async () => {
    const r = await chamar("convert_event_to_task", {
      eventId: SERIE_ID,
      occurrenceDate: "2026-10-21",
      time: null,
    });
    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas).toEqual([
      expect.objectContaining({
        metodo: "POST",
        caminho: `/events/${SERIE_ID}/to-task`,
        busca: "?scope=esta&occurrenceDate=2026-10-21",
        corpo: { time: null },
      }),
    ]);
    expect(texto(r)).toBe(`Evento convertido em tarefa.\n\n${formatarTarefa(TAREFA)}`);
  });

  it("convert_task_to_event manda o horário e a repetição em números", async () => {
    const r = await chamar("convert_task_to_event", {
      taskId: TAREFA_ID,
      startTime: "10:00",
      repeat: { days: ["seg"] },
    });
    expect(r.isError, texto(r)).toBeFalsy();
    expect(chamadas).toEqual([
      expect.objectContaining({
        metodo: "POST",
        caminho: `/tasks/${TAREFA_ID}/to-event`,
        corpo: { startTime: "10:00", repeat: { days: [1] } },
      }),
    ]);
  });

  it("tarefa inexistente na conversão é recusa, sem isError genérico", async () => {
    const r = await chamar("convert_task_to_event", { taskId: SUMIDO_ID });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Não existe tarefa com esse id");
  });
});
