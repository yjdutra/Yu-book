import type { Link, LinkFolder } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/*
 * Pastas de favoritos: um nível só. A posição do favorito conta dentro do
 * recipiente (raiz ou pasta), e excluir a pasta devolve os links à raiz.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("pastas");
  intruso = await criarUsuario("pastas-intruso");
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

const pedir = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, quem = dono) =>
  chamar(app, { method, url, token: quem.token, ...(body !== undefined && { body }) });

/** O `title` pula a busca do título: o teste não sai para a rede. */
const favorito = async (n: number) =>
  (await pedir("POST", "/links", { url: `https://ex${n}.com`, kind: "favorito", title: `L${n}` }))
    .body as Link;

const favoritos = async () => (await pedir("GET", "/links?kind=favorito")).body as Link[];

/** As posições de cada recipiente são contíguas a partir de 0. */
function contiguas(links: Link[]) {
  const porPasta = new Map<string | null, number[]>();
  for (const l of links) porPasta.set(l.folderId, [...(porPasta.get(l.folderId) ?? []), l.position]);
  for (const posicoes of porPasta.values()) {
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes.map((_, i) => i));
  }
}

describe("pastas de favoritos", () => {
  let leitura: LinkFolder;
  let ferramentas: LinkFolder;
  const ids: string[] = [];

  test("cria no fim, recusa nome repetido e lista na ordem", async () => {
    for (let n = 1; n <= 4; n++) ids.push((await favorito(n)).id);

    const a = await pedir("POST", "/link-folders", { name: "Leitura" });
    expect(a.status).toBe(201);
    leitura = a.body as LinkFolder;
    ferramentas = (await pedir("POST", "/link-folders", { name: "Ferramentas" })).body as LinkFolder;
    expect([leitura.position, ferramentas.position]).toEqual([0, 1]);

    expect((await pedir("POST", "/link-folders", { name: "Leitura" })).status).toBe(409);
    expect((await pedir("POST", "/link-folders", { name: "  " })).status).toBe(422);

    const lista = (await pedir("GET", "/link-folders")).body as LinkFolder[];
    expect(lista.map((p) => p.name)).toEqual(["Leitura", "Ferramentas"]);
  });

  test("arrastar para a pasta tira da raiz e renumera os dois lados", async () => {
    await pedir("PATCH", `/links/${ids[1]}/move`, { position: 0, folderId: leitura.id });
    const r = await pedir("PATCH", `/links/${ids[2]}/move`, { position: 0, folderId: leitura.id });
    const depois = r.body as Link[];

    const naPasta = depois.filter((l) => l.folderId === leitura.id).sort((a, b) => a.position - b.position);
    expect(naPasta.map((l) => l.id)).toEqual([ids[2], ids[1]]);
    expect(depois.filter((l) => l.folderId === null).map((l) => l.id)).toEqual([ids[0], ids[3]]);
    contiguas(depois);
  });

  test("reordenar sem folderId fica na pasta; null volta à raiz", async () => {
    const dentro = (await pedir("PATCH", `/links/${ids[1]}/move`, { position: 0 })).body as Link[];
    expect(dentro.find((l) => l.id === ids[1])).toMatchObject({ folderId: leitura.id, position: 0 });

    const fora = (await pedir("PATCH", `/links/${ids[1]}/move`, { position: 1, folderId: null }))
      .body as Link[];
    expect(fora.find((l) => l.id === ids[1])).toMatchObject({ folderId: null, position: 1 });
    contiguas(fora);
  });

  test("sair dos favoritos tira da pasta; voltar entra na raiz", async () => {
    await pedir("PATCH", `/links/${ids[1]}/move`, { position: 0, folderId: ferramentas.id });
    const depois = (await pedir("PATCH", `/links/${ids[1]}`, { kind: "depois" })).body as Link;
    expect(depois.folderId).toBeNull();

    const volta = (await pedir("PATCH", `/links/${ids[1]}`, { kind: "favorito" })).body as Link;
    expect(volta.folderId).toBeNull();
    contiguas(await favoritos());
  });

  test("excluir a pasta devolve os links ao fim da raiz, sem apagar nenhum", async () => {
    const antes = await favoritos();
    const daPasta = antes
      .filter((l) => l.folderId === leitura.id)
      .sort((a, b) => a.position - b.position)
      .map((l) => l.id);
    expect(daPasta.length).toBeGreaterThan(0);

    expect((await pedir("DELETE", `/link-folders/${leitura.id}`)).status).toBe(204);

    const depois = await favoritos();
    expect(depois).toHaveLength(antes.length);
    const raiz = depois.filter((l) => l.folderId === null).sort((a, b) => a.position - b.position);
    expect(raiz.slice(-daPasta.length).map((l) => l.id)).toEqual(daPasta);
    contiguas(depois);

    const restantes = (await pedir("GET", "/link-folders")).body as LinkFolder[];
    expect(restantes.map((p) => [p.name, p.position])).toEqual([["Ferramentas", 0]]);
  });

  test("renomear e reordenar pastas", async () => {
    const nova = (await pedir("POST", "/link-folders", { name: "Vídeos" })).body as LinkFolder;
    const r = await pedir("PATCH", `/link-folders/${nova.id}`, { name: "Vídeos bons" });
    expect(r.body).toMatchObject({ name: "Vídeos bons" });
    expect((await pedir("PATCH", `/link-folders/${nova.id}`, { name: "Ferramentas" })).status).toBe(409);

    const ordem = (await pedir("PATCH", `/link-folders/${nova.id}/move`, { position: 0 }))
      .body as LinkFolder[];
    expect(ordem.map((p) => [p.name, p.position])).toEqual([
      ["Vídeos bons", 0],
      ["Ferramentas", 1],
    ]);
  });

  test("posse: pasta de outra pessoa é 404 nos dois sentidos", async () => {
    expect((await pedir("PATCH", `/link-folders/${ferramentas.id}`, { name: "X" }, intruso)).status).toBe(404);
    expect((await pedir("DELETE", `/link-folders/${ferramentas.id}`, undefined, intruso)).status).toBe(404);
    expect(((await pedir("GET", "/link-folders", undefined, intruso)).body as LinkFolder[]).length).toBe(0);

    // O link do dono não entra na pasta do intruso.
    const deles = (await pedir("POST", "/link-folders", { name: "Minha" }, intruso)).body as LinkFolder;
    const r = await pedir("PATCH", `/links/${ids[0]}/move`, { position: 0, folderId: deles.id });
    expect(r.status).toBe(404);
  });
});
