import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Link } from "@yu-book/shared";
import { normalizarUrl } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { buscarTitulo, ehEnderecoPublico } from "../src/modules/links/titulo.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

/** Servidor local que conta o que recebeu — é o detector de SSRF. */
interface Alvo {
  server: Server;
  porta: number;
  recebidas: string[];
  responder: (url: string) => { status?: number; headers?: Record<string, string>; corpo?: string };
}

async function subirAlvo(): Promise<Alvo> {
  const alvo: Partial<Alvo> & { recebidas: string[] } = {
    recebidas: [],
    responder: () => ({ corpo: "<html><head><title>padrão</title></head></html>" }),
  };

  const server = createServer((req, res) => {
    alvo.recebidas.push(req.url ?? "");
    const { status = 200, headers, corpo = "" } = alvo.responder?.(req.url ?? "") ?? {};
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(corpo);
  });

  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const endereco = server.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;

  return Object.assign(alvo, { server, porta }) as Alvo;
}

let alvo: Alvo;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("links");
  intruso = await criarUsuario("links-intruso");
  alvo = await subirAlvo();
});

afterAll(async () => {
  await new Promise<void>((ok) => alvo.server.close(() => ok()));
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

const salvar = async (body: Record<string, unknown>) =>
  await chamar(app, { method: "POST", url: "/links", token: dono.token, body });

const listar = async (kind?: string) =>
  (
    await chamar(app, {
      method: "GET",
      url: `/links${kind ? `?kind=${kind}` : ""}`,
      token: dono.token,
    })
  ).body as Link[];

/** Deixa passar só `localhost`, para provar que cada salto é validado. */
const soLocalhost = async (host: string) => host === "localhost";

describe("guarda de endereço (RNF-01)", () => {
  test("recusa laço, rede privada, link-local e multicast", () => {
    const bloqueados = [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.0.0.1",
      "169.254.169.254", // metadados de nuvem
      "169.254.0.1",
      "100.64.0.1", // CGNAT
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "::ffff:127.0.0.1", // IPv4 embutido
      "::ffff:10.0.0.1",
      "fc00::1", // ULA
      "fd12:3456::1",
      "fe80::1", // link-local
      "ff02::1", // multicast
      "não-é-ip",
      "",
    ];

    for (const ip of bloqueados) {
      expect(ehEnderecoPublico(ip), ip).toBe(false);
    }
  });

  test("aceita endereço público", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(ehEnderecoPublico(ip), ip).toBe(true);
    }
  });
});

describe("leitura de título", () => {
  test("lê o <title> e o og:title", async () => {
    alvo.responder = () => ({
      corpo: "<html><head><title>Documentação do Prisma</title></head></html>",
    });
    await expect(buscarTitulo(`http://localhost:${alvo.porta}/`, soLocalhost)).resolves.toBe(
      "Documentação do Prisma",
    );

    alvo.responder = () => ({
      corpo: `<html><head><meta property="og:title" content="Rick Astley - Never Gonna Give You Up">
              <title>YouTube</title></head></html>`,
    });
    await expect(buscarTitulo(`http://localhost:${alvo.porta}/`, soLocalhost)).resolves.toBe(
      "Rick Astley - Never Gonna Give You Up",
    );
  });

  test("decodifica entidades e recusa conteúdo que não é HTML", async () => {
    alvo.responder = () => ({ corpo: "<title>Fulano &amp; Cia &#39;96</title>" });
    await expect(buscarTitulo(`http://localhost:${alvo.porta}/`, soLocalhost)).resolves.toBe(
      "Fulano & Cia '96",
    );

    alvo.responder = () => ({
      headers: { "content-type": "application/pdf" },
      corpo: "%PDF-1.4",
    });
    await expect(
      buscarTitulo(`http://localhost:${alvo.porta}/`, soLocalhost),
    ).resolves.toBeNull();
  });

  // CA-16
  test("para de ler em 512 KB", async () => {
    alvo.responder = () => ({
      // O título só aparece depois do limite: se ele voltar, não paramos.
      corpo: `<html><head>${"<!-- ".repeat(200_000)}<title>tarde demais</title></head>`,
    });
    await expect(
      buscarTitulo(`http://localhost:${alvo.porta}/`, soLocalhost),
    ).resolves.toBeNull();
  });

  test("segue redirecionamento até o limite", async () => {
    alvo.responder = (url) =>
      url === "/inicio"
        ? { status: 302, headers: { location: "/fim" } }
        : { corpo: "<title>Chegou</title>" };

    await expect(
      buscarTitulo(`http://localhost:${alvo.porta}/inicio`, soLocalhost),
    ).resolves.toBe("Chegou");
  });

  // CA-15 — o teste que justifica validar hop a hop.
  test("redirecionamento para endereço recusado não é seguido", async () => {
    alvo.recebidas = [];
    alvo.responder = (url) =>
      url === "/vaza"
        ? { status: 302, headers: { location: `http://127.0.0.1:${alvo.porta}/interno` } }
        : { corpo: "<title>não deveria chegar aqui</title>" };

    await expect(
      buscarTitulo(`http://localhost:${alvo.porta}/vaza`, soLocalhost),
    ).resolves.toBeNull();

    // O primeiro salto aconteceu; o segundo, não.
    expect(alvo.recebidas).toEqual(["/vaza"]);
  });
});

describe("salvar link", () => {
  // CA-13 / CA-14
  test("endereço interno é salvo sem nenhuma conexão sair", async () => {
    alvo.recebidas = [];

    const local = await salvar({ url: `http://127.0.0.1:${alvo.porta}/health`, kind: "depois" });
    expect(local.status).toBe(201);
    expect((local.body as Link).title).toBe("127.0.0.1");

    const metadados = await salvar({
      url: "http://169.254.169.254/latest/meta-data/",
      kind: "depois",
    });
    expect(metadados.status).toBe(201);
    expect((metadados.body as Link).title).toBe("169.254.169.254");

    // A prova: o servidor local não recebeu nada.
    expect(alvo.recebidas).toEqual([]);
  });

  // CA-06
  test("esquema que não é http/https é recusado", async () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "ftp://exemplo.com/x"]) {
      const { status } = await salvar({ url, kind: "depois" });
      expect(status, url).toBe(422);
    }
  });

  // CA-07 / CA-08 / RN-02
  test("normaliza a URL e não duplica na mesma lista", () => {
    expect(normalizarUrl("https://www.github.com/")?.url).toBe("https://github.com");
    expect(normalizarUrl("HTTPS://GitHub.com/yjdutra/#leia")?.url).toBe(
      "https://github.com/yjdutra",
    );
    expect(normalizarUrl("github.com")?.url).toBe("https://github.com");
    expect(normalizarUrl("https://x.com/watch?v=A")?.url).not.toBe(
      normalizarUrl("https://x.com/watch?v=B")?.url,
    );
    expect(normalizarUrl("file:///etc/passwd")).toBeNull();
  });

  test("a mesma URL solta duas vezes devolve o mesmo item", async () => {
    const primeiro = await salvar({ url: "https://www.exemplo-unico.test/", kind: "favorito" });
    const segundo = await salvar({ url: "https://exemplo-unico.test", kind: "favorito" });

    expect(primeiro.status).toBe(201);
    expect((segundo.body as Link).id).toBe((primeiro.body as Link).id);

    const favoritos = await listar("favorito");
    expect(favoritos.filter((l) => l.domain === "exemplo-unico.test")).toHaveLength(1);
  });

  test("desfazer recria com o título que o link tinha, sem rebuscar", async () => {
    alvo.recebidas = [];
    const { body } = await salvar({
      url: "https://desfazer.test/artigo",
      kind: "depois",
      title: "Artigo que eu tinha salvo",
    });
    expect((body as Link).title).toBe("Artigo que eu tinha salvo");
    expect((body as Link).semTitulo).toBe(false);
  });
});

describe("listas", () => {
  test("mover para favoritos coloca no fim e renumera ao sair", async () => {
    const a = (await salvar({ url: "https://ordem-a.test", kind: "favorito" })).body as Link;
    const b = (await salvar({ url: "https://ordem-b.test", kind: "favorito" })).body as Link;
    const c = (await salvar({ url: "https://ordem-c.test", kind: "depois" })).body as Link;

    const promovido = (
      await chamar(app, {
        method: "PATCH",
        url: `/links/${c.id}`,
        token: dono.token,
        body: { kind: "favorito" },
      })
    ).body as Link;

    const favoritos = await listar("favorito");
    const posicoes = favoritos.map((l) => l.position);
    expect(posicoes).toEqual(posicoes.map((_, i) => i));
    expect(favoritos.at(-1)?.id).toBe(promovido.id);
    expect(favoritos.map((l) => l.id)).toContain(a.id);
    expect(favoritos.map((l) => l.id)).toContain(b.id);
  });

  // CA-21 / RN-03
  test("reordenar favoritos mantém posições contíguas", async () => {
    const favoritos = await listar("favorito");
    const ultimo = favoritos.at(-1);
    expect(ultimo).toBeDefined();

    const { body } = await chamar(app, {
      method: "PATCH",
      url: `/links/${ultimo?.id}/move`,
      token: dono.token,
      body: { position: 0 },
    });

    const depois = body as Link[];
    expect(depois[0]?.id).toBe(ultimo?.id);
    expect(depois.map((l) => l.position)).toEqual(depois.map((_, i) => i));
  });

  test("excluir favorito fecha a fila", async () => {
    const antes = await listar("favorito");
    const alvoId = antes[0]?.id;

    const { status } = await chamar(app, {
      method: "DELETE",
      url: `/links/${alvoId}`,
      token: dono.token,
    });
    expect(status).toBe(204);

    const depois = await listar("favorito");
    expect(depois.map((l) => l.position)).toEqual(depois.map((_, i) => i));
    expect(depois.some((l) => l.id === alvoId)).toBe(false);
  });
});

// CA-17
describe("posse", () => {
  test("link de outro usuário responde 404", async () => {
    const meu = (await salvar({ url: "https://so-do-dono.test", kind: "depois" })).body as Link;

    const tentativas = [
      { method: "PATCH", url: `/links/${meu.id}`, body: { title: "invadido" } },
      { method: "PATCH", url: `/links/${meu.id}/move`, body: { position: 0 } },
      { method: "POST", url: `/links/${meu.id}/title` },
      { method: "DELETE", url: `/links/${meu.id}` },
    ] as const;

    for (const tentativa of tentativas) {
      const { status } = await chamar(app, { ...tentativa, token: intruso.token });
      expect(status, `${tentativa.method} ${tentativa.url}`).toBe(404);
    }

    expect((await listar()).some((l) => l.id === meu.id)).toBe(true);
    expect(
      ((await chamar(app, { method: "GET", url: "/links", token: intruso.token })).body as Link[])
        .length,
    ).toBe(0);
  });
});
