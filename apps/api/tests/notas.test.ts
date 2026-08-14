import type { NoteCounts, NoteDetail, NoteListResponse } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

let app: FastifyInstance;
let dono: Usuario;
let workspaceId: string;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("notas");
  const workspace = await prisma.workspace.create({ data: { userId: dono.id, name: "Estudos" } });
  workspaceId = workspace.id;
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

async function criarNota(corpo: Record<string, unknown>): Promise<NoteDetail> {
  const { body } = await chamar(app, {
    method: "POST",
    url: "/notes",
    token: dono.token,
    body: corpo,
  });
  return body as NoteDetail;
}

const buscar = async (id: string) =>
  (await chamar(app, { method: "GET", url: `/notes/${id}`, token: dono.token })).body as NoteDetail;

const salvar = async (id: string, input: Record<string, unknown>) =>
  (await chamar(app, { method: "PATCH", url: `/notes/${id}`, token: dono.token, body: input }))
    .body as NoteDetail;

/**
 * O autosave deixou de recalcular `note_link` quando o conjunto de `[[…]]` não
 * muda. Estes testes existem para provar que a economia não custou link.
 */
describe("links entre notas", () => {
  test("nota criada depois resolve os links que já apontavam para ela", async () => {
    const origem = await criarNota({
      title: "Fase 0 — fundação",
      contentMd: "Ver [[Deploy na Railway]] para o resto.",
    });
    expect((await buscar(origem.id)).backlinks).toHaveLength(0);

    const alvo = await criarNota({ title: "Deploy na Railway" });

    // O link nasce resolvido sem precisar salvar a nota de origem de novo.
    expect((await buscar(alvo.id)).backlinks.map((b) => b.id)).toEqual([origem.id]);
  });

  test("salvar só o corpo, sem mexer nos links, preserva os que existem", async () => {
    const alvo = await criarNota({ title: "Índices do Postgres" });
    const origem = await criarNota({
      title: "Consulta lenta",
      contentMd: "Investigar. Ver [[Índices do Postgres]].",
    });
    expect((await buscar(alvo.id)).backlinks).toHaveLength(1);

    // Cinco pausas de digitação seguidas: nenhuma toca em `[[…]]`.
    for (let i = 1; i <= 5; i++) {
      await salvar(origem.id, {
        contentMd: `Investigar. Ver [[Índices do Postgres]].\n\nParágrafo ${i}.`,
      });
    }

    expect((await buscar(alvo.id)).backlinks.map((b) => b.id)).toEqual([origem.id]);
  });

  test("remover o [[…]] do corpo desfaz o link", async () => {
    const alvo = await criarNota({ title: "Trigrama" });
    const origem = await criarNota({
      title: "Busca aproximada",
      contentMd: "Depende de [[Trigrama]].",
    });
    expect((await buscar(alvo.id)).backlinks).toHaveLength(1);

    await salvar(origem.id, { contentMd: "Depende de índice." });
    expect((await buscar(alvo.id)).backlinks).toHaveLength(0);
  });

  test("renomear reescreve os [[…]] de quem aponta para a nota", async () => {
    const alvo = await criarNota({ title: "Nome antigo" });
    const origem = await criarNota({
      title: "Aponta para o alvo",
      contentMd: "Detalhes em [[Nome antigo]].",
    });

    await salvar(alvo.id, { title: "Nome novo" });

    const depois = await buscar(origem.id);
    expect(depois.contentMd).toContain("[[Nome novo]]");
    expect((await buscar(alvo.id)).backlinks.map((b) => b.id)).toEqual([origem.id]);
  });
});

describe("listagem", () => {
  test("o resumo vem limpo e o corpo não trafega na lista", async () => {
    const corpo = `# Título\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n**Texto** que aparece no resumo.\n${"padding ".repeat(500)}`;
    await criarNota({ title: "Nota comprida", contentMd: corpo, workspaceId });

    const { body } = await chamar(app, {
      method: "GET",
      url: `/notes?workspaceId=${workspaceId}`,
      token: dono.token,
    });
    const lista = body as NoteListResponse;
    const item = lista.items.find((i) => i.title === "Nota comprida");

    expect(item).toBeDefined();
    expect(item?.excerpt.length).toBeLessThanOrEqual(160);
    expect(item?.excerpt).not.toContain("```");
    expect(item?.excerpt).toContain("Texto");
    // NoteSummary não tem corpo: o payload da lista não pode carregar 1 MB por nota.
    expect(item).not.toHaveProperty("contentMd");
  });
});

describe("contadores", () => {
  test("total, lixeira, favoritas e por tipo em uma consulta só", async () => {
    const ws = await prisma.workspace.create({ data: { userId: dono.id, name: "Contagem notas" } });

    const aula = await criarNota({ title: "Aula contada", kind: "aula", workspaceId: ws.id });
    await criarNota({ title: "Projeto contado", kind: "projeto", workspaceId: ws.id });
    const lixo = await criarNota({ title: "Nota descartada", kind: "livre", workspaceId: ws.id });

    await salvar(aula.id, { isFavorite: true });
    await chamar(app, { method: "DELETE", url: `/notes/${lixo.id}`, token: dono.token });

    const { body } = await chamar(app, {
      method: "GET",
      url: `/notes/counts?workspaceId=${ws.id}`,
      token: dono.token,
    });
    const contagem = body as NoteCounts;

    expect(contagem.total).toBe(2);
    expect(contagem.trash).toBe(1);
    expect(contagem.favorites).toBe(1);
    expect(contagem.byKind.aula).toBe(1);
    expect(contagem.byKind.projeto).toBe(1);
    expect(contagem.byKind.livre).toBe(0);
  });
});
