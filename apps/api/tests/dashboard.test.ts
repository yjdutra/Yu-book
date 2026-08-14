import type { BoardDetail, CardDetail, Dashboard, NoteDetail } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
let workspaceId: string;
let outroWorkspaceId: string;
let colunaId: string;
let colunaDeOutro: string;

const DIA = 24 * 60 * 60 * 1000;
const emDias = (dias: number) => new Date(Date.now() + dias * DIA);

async function novoCard(columnId: string, title: string, dueDate?: Date): Promise<CardDetail> {
  const { body } = await chamar(app, {
    method: "POST",
    url: "/cards",
    token: dono.token,
    body: { columnId, title, ...(dueDate && { dueDate: dueDate.toISOString() }) },
  });
  return body as CardDetail;
}

const dashboard = async (workspace?: string, token = dono.token) =>
  (
    await chamar(app, {
      method: "GET",
      url: `/dashboard${workspace ? `?workspaceId=${workspace}` : ""}`,
      token,
    })
  ).body as Dashboard;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("dash");
  intruso = await criarUsuario("dash-intruso");

  const [ws, outro] = await Promise.all([
    prisma.workspace.create({ data: { userId: dono.id, name: "Coders" } }),
    prisma.workspace.create({ data: { userId: dono.id, name: "Trabalho" } }),
  ]);
  workspaceId = ws.id;
  outroWorkspaceId = outro.id;

  const board = (
    await chamar(app, {
      method: "POST",
      url: "/boards",
      token: dono.token,
      body: { name: "Módulo 3", workspaceId },
    })
  ).body as BoardDetail;
  colunaId = board.columns[0]?.id as string;

  const boardDeOutro = (
    await chamar(app, {
      method: "POST",
      url: "/boards",
      token: dono.token,
      body: { name: "Board do trabalho", workspaceId: outroWorkspaceId },
    })
  ).body as BoardDetail;
  colunaDeOutro = boardDeOutro.columns[0]?.id as string;
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

// CA-03 / CA-04 / CA-05 / RN-01
test("prazos: vencidos primeiro, do mais antigo, sem arquivado e com o resto contado", async () => {
  await novoCard(colunaId, "Vencido há 3 dias", emDias(-3));
  await novoCard(colunaId, "Vencido ontem", emDias(-1));
  await novoCard(colunaId, "Vence amanhã", emDias(1));
  await novoCard(colunaId, "Vence em 4 dias", emDias(4));
  await novoCard(colunaId, "Vence em 30 dias", emDias(30)); // fora da janela
  await novoCard(colunaId, "Sem prazo");

  const arquivado = await novoCard(colunaId, "Vencido e arquivado", emDias(-5));
  await chamar(app, {
    method: "PATCH",
    url: `/cards/${arquivado.id}`,
    token: dono.token,
    body: { archived: true },
  });

  const { prazos } = await dashboard(workspaceId);

  expect(prazos.vencidos.map((c) => c.title)).toEqual(["Vencido há 3 dias", "Vencido ontem"]);
  expect(prazos.proximos.map((c) => c.title)).toEqual(["Vence amanhã", "Vence em 4 dias"]);
  expect(prazos.totalVencidos).toBe(2);
  expect(prazos.totalProximos).toBe(2);

  // O card traz de onde veio, para o clique saber para onde ir (RF-09, RF-10).
  expect(prazos.vencidos[0]).toMatchObject({ boardName: "Módulo 3", columnName: "A fazer" });
});

test("mais de 5 vencidos: mostra 5 e conta o resto", async () => {
  for (let i = 6; i <= 12; i++) await novoCard(colunaId, `Atrasado ${i}`, emDias(-i));

  const { prazos } = await dashboard(workspaceId);
  expect(prazos.vencidos).toHaveLength(5);
  expect(prazos.totalVencidos).toBe(9);
  // Os mais antigos vêm primeiro, mesmo com o corte.
  expect(prazos.vencidos[0]?.title).toBe("Atrasado 12");
});

// CA-08
test("notas recentes: 6 mais recentes, sem lixeira e sem corpo", async () => {
  for (let i = 1; i <= 8; i++) {
    await chamar(app, {
      method: "POST",
      url: "/notes",
      token: dono.token,
      body: { title: `Nota ${i}`, kind: "aula", workspaceId, contentMd: `Conteúdo da nota ${i}` },
    });
  }

  const excluida = (
    await chamar(app, {
      method: "POST",
      url: "/notes",
      token: dono.token,
      body: { title: "Nota descartada", workspaceId },
    })
  ).body as NoteDetail;
  await chamar(app, { method: "DELETE", url: `/notes/${excluida.id}`, token: dono.token });

  const { notas } = await dashboard(workspaceId);

  expect(notas).toHaveLength(6);
  expect(notas.some((n) => n.title === "Nota descartada")).toBe(false);
  expect(notas[0]?.title).toBe("Nota 8"); // a mais recente primeiro
  expect(notas[0]).not.toHaveProperty("contentMd");
  expect(notas[0]?.excerpt).toContain("Conteúdo da nota 8");
});

// CA-09
test("fila de links: total e os mais antigos", async () => {
  for (const [i, url] of ["https://a.test", "https://b.test", "https://c.test", "https://d.test"].entries()) {
    await chamar(app, {
      method: "POST",
      url: "/links",
      token: dono.token,
      body: { url, kind: "depois", title: `Link ${i}` },
    });
  }
  await chamar(app, {
    method: "POST",
    url: "/links",
    token: dono.token,
    body: { url: "https://favorito.test", kind: "favorito", title: "Favorito" },
  });

  const { links } = await dashboard(workspaceId);

  expect(links.total).toBe(4); // favorito não conta na fila
  expect(links.antigos).toHaveLength(3);
  expect(links.antigos[0]?.title).toBe("Link 0"); // o mais antigo primeiro
});

// CA-07 / RN-04
test("workspace ativo filtra prazos e notas, mas não a gaveta de links", async () => {
  await novoCard(colunaDeOutro, "Prazo do trabalho", emDias(-2));
  await chamar(app, {
    method: "POST",
    url: "/notes",
    token: dono.token,
    body: { title: "Nota do trabalho", workspaceId: outroWorkspaceId },
  });

  const coders = await dashboard(workspaceId);
  expect(coders.prazos.vencidos.some((c) => c.title === "Prazo do trabalho")).toBe(false);
  expect(coders.notas.some((n) => n.title === "Nota do trabalho")).toBe(false);
  // A gaveta é uma só: o número não muda com o workspace.
  expect(coders.links.total).toBe(4);

  const trabalho = await dashboard(outroWorkspaceId);
  expect(trabalho.prazos.vencidos.some((c) => c.title === "Prazo do trabalho")).toBe(true);
  expect(trabalho.links.total).toBe(4);

  // Sem workspace, os dois entram na conta. O recorte de 5 mostra só os mais
  // atrasados, então quem prova a soma é o total, não a lista.
  const tudo = await dashboard();
  expect(tudo.prazos.totalVencidos).toBe(coders.prazos.totalVencidos + 1);
});

// CA-10
test("usuário sem nada recebe blocos vazios, não erro", async () => {
  const vazio = await dashboard(undefined, intruso.token);

  expect(vazio.prazos).toEqual({
    vencidos: [],
    proximos: [],
    totalVencidos: 0,
    totalProximos: 0,
  });
  expect(vazio.notas).toEqual([]);
  expect(vazio.links).toEqual({ total: 0, antigos: [] });
});

// CA-13
test("o dashboard de um usuário nunca mostra dado de outro", async () => {
  const doIntruso = await dashboard(undefined, intruso.token);

  expect(doIntruso.prazos.totalVencidos).toBe(0);
  expect(doIntruso.notas).toHaveLength(0);
  expect(doIntruso.links.total).toBe(0);

  // E o workspace do dono, pedido pelo intruso, não vaza nada.
  const chutando = await dashboard(workspaceId, intruso.token);
  expect(chutando.prazos.vencidos).toHaveLength(0);
  expect(chutando.notas).toHaveLength(0);
});
