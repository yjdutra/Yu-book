import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatarHabitos, semanaPonderada } from "@yu-book/shared";
import type { HabitActivityItem, HabitEntryItem, HabitItem } from "@yu-book/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * Os hábitos do lado do MCP (frente Ritmo, Ritmo 1 — RF-12, RF-13, RF-14).
 *
 * O que a API grava e pondera ela prova nos testes dela. Aqui se prova o que só
 * este pacote pode errar: o registro nas duas superfícies, o **corpo** que sai
 * no `fetch` (só `log_habit` manda `origin`), a conferência de `update_habit`
 * antes da primeira escrita e o relato honesto da alteração parcial.
 */

interface Chamada {
  metodo: string;
  caminho: string;
  corpo: Record<string, unknown> | undefined;
}

const chamadas: Chamada[] = [];

const AGORA = "2026-10-18T15:00:00.000Z";
const HOJE = "2026-10-18";
const HABITO_ID = "11111111-1111-4111-8111-111111111111";
const ATIVIDADE_ID = "22222222-2222-4222-8222-222222222222";
const ATIVIDADE_QUE_FALHA = "33333333-3333-4333-8333-333333333333";

const COMPLETO = identidade(["yubook:read", "yubook:write"]);

function atividade(nome: string, pontos: number, id = ATIVIDADE_ID): HabitActivityItem {
  return { id, habitId: HABITO_ID, name: nome, points: pontos, position: 0, archived: false };
}

/** Tipado pelo contrato: campo novo em `HabitItem` quebra o typecheck aqui. */
function habito(corpo: Record<string, unknown> = {}): HabitItem {
  const weeklyGoal = (corpo["weeklyGoal"] as number | undefined) ?? 120;
  const targetDays = (corpo["targetDays"] as number | undefined) ?? 4;
  const ativs = (corpo["activities"] as { name: string; points: number }[] | undefined) ?? [
    { name: "App", points: 10 },
  ];
  return {
    id: HABITO_ID,
    name: (corpo["name"] as string | undefined) ?? "Inglês",
    color: "violeta",
    emblem: "idioma",
    weeklyGoal,
    targetDays,
    position: 0,
    archived: false,
    activities: ativs.map((a) => atividade(a.name, a.points)),
    week: semanaPonderada({ weeklyGoal, targetDays }, [{ day: HOJE, points: 40 }], HOJE),
    createdAt: AGORA,
    updatedAt: AGORA,
  };
}

function registro(corpo: Record<string, unknown>): HabitEntryItem {
  const origem = corpo["origin"] as { via: "mcp"; author: string } | undefined;
  return {
    id: "44444444-4444-4444-8444-444444444444",
    habitId: HABITO_ID,
    activity: corpo["activityId"] ? { id: ATIVIDADE_ID, name: "App" } : null,
    points: (corpo["points"] as number | undefined) ?? 10,
    day: (corpo["day"] as string | undefined) ?? HOJE,
    origin: "manual",
    note: (corpo["note"] as string | undefined) ?? null,
    taskId: null,
    eventId: null,
    ai: origem ? { via: "mcp", author: origem.author, agentName: null } : null,
    createdAt: AGORA,
  };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const corpo =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const caminho = new URL(String(url)).pathname;
    chamadas.push({ metodo, caminho, corpo });

    if (metodo === "GET" && caminho === "/habits") return json([habito()]);
    if (metodo === "GET" && caminho === `/habits/${HABITO_ID}`) return json(habito());
    if (metodo === "POST" && caminho === "/habits") return json(habito(corpo), 201);
    if (metodo === "PATCH" && caminho === `/habits/${HABITO_ID}`) return json(habito(corpo));
    if (metodo === "POST" && caminho === `/habits/${HABITO_ID}/activities`) {
      if (corpo?.["name"] === "Repetida") {
        return json({ error: { code: "NOME_DUPLICADO", message: "Já existe" } }, 409);
      }
      return json(atividade(String(corpo?.["name"]), Number(corpo?.["points"])), 201);
    }
    if (metodo === "PATCH" && caminho === `/habit-activities/${ATIVIDADE_ID}`) {
      return json(atividade("App", Number(corpo?.["points"] ?? 10)));
    }
    if (metodo === "POST" && caminho === `/habits/${HABITO_ID}/entries`) {
      return json(registro(corpo ?? {}), 201);
    }
    return json({ error: { code: "NOT_FOUND", message: "Não encontrado" } }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const texto = (r: CallToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe("o registro dos hábitos", () => {
  it("list_habits está sempre; as três de escrita só com a escrita liberada", async () => {
    const sem = await abrirCliente({ escrita: false }, COMPLETO);
    const com = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const semEscrita = (await sem.listarTools()).map((t) => t.name);
      const comEscrita = (await com.listarTools()).map((t) => t.name);
      expect(semEscrita).toContain("list_habits");
      for (const nome of ["create_habit", "update_habit", "log_habit"]) {
        expect(semEscrita, `${nome} vazou para a leitura`).not.toContain(nome);
        expect(comEscrita, `${nome} não foi registrada`).toContain(nome);
      }
    } finally {
      await sem.encerrar();
      await com.encerrar();
    }
  });

  it("create_task e create_event publicam habitActivityId", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const tools = await cliente.listarTools();
      for (const nome of ["create_task", "create_event", "update_task", "update_event"]) {
        const tool = tools.find((t) => t.name === nome);
        expect(tool?.inputSchema.properties, nome).toHaveProperty("habitActivityId");
      }
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("list_habits", () => {
  it("devolve o texto do formatador de shared, com a semana ponderada", async () => {
    const cliente = await abrirCliente({ escrita: false }, COMPLETO);
    try {
      const r = await cliente.chamarTool("list_habits", {});
      expect(r.isError).toBeFalsy();
      expect(texto(r)).toBe(formatarHabitos([habito()]));
      expect(texto(r)).toContain("30/120 pts");
      expect(texto(r)).toContain("acima do teto (só XP): 10 pts");
      expect(texto(r)).toContain(`id: ${ATIVIDADE_ID}`);
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("create_habit", () => {
  it("manda o hábito com as atividades, sem origin", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("create_habit", {
        name: "Leitura",
        weeklyGoal: 60,
        targetDays: 5,
        activities: [{ name: "20 min", points: 10 }],
      });
      expect(r.isError).toBeFalsy();
      const post = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/habits");
      expect(post?.corpo).toEqual({
        name: "Leitura",
        weeklyGoal: 60,
        targetDays: 5,
        activities: [{ name: "20 min", points: 10 }],
      });
      expect(texto(r)).toContain("Hábito criado.");
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("update_habit", () => {
  it("atividade nova sem pontos é recusada antes de qualquer escrita", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("update_habit", {
        habitId: HABITO_ID,
        weeklyGoal: 150,
        activities: [{ name: "Podcast" }],
      });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("Nada foi alterado");
      expect(chamadas.filter((c) => c.metodo !== "GET")).toHaveLength(0);
    } finally {
      await cliente.encerrar();
    }
  });

  it("altera o hábito, edita uma atividade e cria outra, nessa ordem", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("update_habit", {
        habitId: HABITO_ID,
        weeklyGoal: 150,
        activities: [
          { id: ATIVIDADE_ID, points: 15 },
          { name: "Podcast", points: 5 },
        ],
      });
      expect(r.isError).toBeFalsy();
      const escritas = chamadas.filter((c) => c.metodo !== "GET");
      expect(escritas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
        `PATCH /habits/${HABITO_ID}`,
        `PATCH /habit-activities/${ATIVIDADE_ID}`,
        `POST /habits/${HABITO_ID}/activities`,
      ]);
      expect(escritas[0]?.corpo).toEqual({ weeklyGoal: 150 });
      expect(texto(r)).toContain("atividade «Podcast» criada");
    } finally {
      await cliente.encerrar();
    }
  });

  it("falha no meio relata o que já foi aplicado, para o modelo não repetir", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("update_habit", {
        habitId: HABITO_ID,
        activities: [
          { name: "Podcast", points: 5 },
          { name: "Repetida", points: 1 },
        ],
      });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("Alteração parcial");
      expect(texto(r)).toContain("atividade «Podcast» criada");
      expect(texto(r)).toContain("Não repita");
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("update_habit e atividade de outro hábito", () => {
  it("recusa antes de escrever um id que não é das atividades deste hábito", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("update_habit", {
        habitId: HABITO_ID,
        activities: [{ id: ATIVIDADE_QUE_FALHA, points: 1 }],
      });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("não é deste hábito");
      expect(chamadas.filter((c) => c.metodo !== "GET")).toHaveLength(0);
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("log_habit", () => {
  it("manda origin e devolve o registro com a semana", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("log_habit", {
        habitId: HABITO_ID,
        activityId: ATIVIDADE_ID,
        note: "série sem legenda",
      });
      expect(r.isError).toBeFalsy();
      const post = chamadas.find((c) => c.caminho === `/habits/${HABITO_ID}/entries`);
      expect(post?.corpo).toMatchObject({
        activityId: ATIVIDADE_ID,
        note: "série sem legenda",
        origin: { via: "mcp" },
      });
      expect(texto(r)).toContain("+10 pts em **Inglês**");
      expect(texto(r)).toContain("semana: 30/120 pts · 10 acima do teto");
    } finally {
      await cliente.encerrar();
    }
  });

  it("sem atividade nem pontos recusa sem chamar a API", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("log_habit", { habitId: HABITO_ID });
      expect(r.isError).toBe(true);
      expect(chamadas).toHaveLength(0);
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("create_task com hábito", () => {
  it("leva habitActivityId no corpo", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      await cliente.chamarTool("create_task", { title: "App", habitActivityId: ATIVIDADE_ID });
      const post = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/tasks");
      expect(post?.corpo).toMatchObject({ title: "App", habitActivityId: ATIVIDADE_ID });
    } finally {
      await cliente.encerrar();
    }
  });
});
