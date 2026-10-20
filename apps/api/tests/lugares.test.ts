import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { PlaceDetail, PlaceSuggestion } from "@yu-book/shared";
import { linkComoChegar, linkDoMapa } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { env } from "../src/env.js";
import { criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/*
 * Lugares do Google para o local do evento. O Google é um dublê local na
 * porta de `tests/setup.ts`: a suíte confere o que a API manda para ele (a
 * chave no header, a máscara, a sessão) e que a chave nunca volta ao app.
 */

interface Recebida {
  metodo: string;
  url: string;
  headers: IncomingMessage["headers"];
  corpo: string;
}

let app: FastifyInstance;
let dono: Usuario;
let dublê: Server;
let recebidas: Recebida[] = [];
let falhar = false;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("lugares");
  dublê = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      recebidas.push({ metodo: req.method ?? "", url: req.url ?? "", headers: req.headers, corpo });
      if (falhar) {
        res.writeHead(500).end();
        return;
      }
      if (req.url?.startsWith("/v1/places:autocomplete")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            suggestions: [
              {
                placePrediction: {
                  placeId: "ChIJpadaria",
                  text: { text: "Padaria Flor, Rua das Flores" },
                  structuredFormat: {
                    mainText: { text: "Padaria Flor" },
                    secondaryText: { text: "Rua das Flores, Curitiba" },
                  },
                },
              },
              { queryPrediction: { text: { text: "padaria perto" } } },
            ],
          }),
        );
        return;
      }
      if (req.url?.startsWith("/v1/places/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "ChIJpadaria",
            displayName: { text: "Padaria Flor" },
            formattedAddress: "Rua das Flores, 10 - Curitiba, PR",
            location: { latitude: -25.43, longitude: -49.27 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/staticmap")) {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((ok) => dublê.listen(39335, "127.0.0.1", ok));
});

afterAll(async () => {
  await new Promise<void>((ok) => dublê.close(() => ok()));
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

beforeEach(() => {
  recebidas = [];
  falhar = false;
});

const pedir = (url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${dono.token}` } });

describe("lugares do Google", () => {
  test("sugestões: a chave vai no header, a sessão no corpo, e só predições de lugar voltam", async () => {
    const sessao = randomUUID();
    const r = await pedir(`/places/autocomplete?q=${encodeURIComponent("padaria")}&session=${sessao}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<PlaceSuggestion[]>()).toEqual([
      { placeId: "ChIJpadaria", name: "Padaria Flor", secondary: "Rua das Flores, Curitiba" },
    ]);
    expect(r.body).not.toContain("chave-de-teste");

    const [ida] = recebidas;
    expect(ida?.metodo).toBe("POST");
    expect(ida?.headers["x-goog-api-key"]).toBe("chave-de-teste");
    expect(JSON.parse(ida?.corpo ?? "{}")).toMatchObject({
      input: "padaria",
      sessionToken: sessao,
      languageCode: "pt-BR",
    });
  });

  test("busca curta é 422 sem sair da API", async () => {
    const r = await pedir(`/places/autocomplete?q=pa&session=${randomUUID()}`);
    expect(r.statusCode).toBe(422);
    expect(recebidas).toHaveLength(0);
  });

  test("detalhe: só os quatro campos da máscara, e a sessão fecha a cobrança", async () => {
    const sessao = randomUUID();
    const r = await pedir(`/places/ChIJpadaria?session=${sessao}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<PlaceDetail>()).toEqual({
      placeId: "ChIJpadaria",
      name: "Padaria Flor",
      address: "Rua das Flores, 10 - Curitiba, PR",
      lat: -25.43,
      lng: -49.27,
    });
    const [ida] = recebidas;
    expect(ida?.headers["x-goog-fieldmask"]).toBe("id,displayName,formattedAddress,location");
    expect(ida?.url).toContain(`sessionToken=${sessao}`);
  });

  test("o id do lugar não escolhe o host nem o caminho", async () => {
    const r = await pedir(`/places/${encodeURIComponent("../../outro?x=1")}`);
    expect(r.statusCode).toBe(200);
    expect(recebidas[0]?.url.startsWith("/v1/places/..%2F..%2Foutro%3Fx%3D1?")).toBe(true);
  });

  test("mapa: a imagem volta pela API, com a chave só na ida e o estilo do tema", async () => {
    const r = await pedir("/places/map?lat=-25.43&lng=-49.27&tema=escuro");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.rawPayload.equals(PNG)).toBe(true);
    const ida = new URL(recebidas[0]?.url ?? "", "http://x");
    expect(ida.searchParams.get("key")).toBe("chave-de-teste");
    expect(ida.searchParams.get("center")).toBe("-25.430000,-49.270000");
    expect(ida.searchParams.getAll("style").length).toBeGreaterThan(0);

    const claro = await pedir("/places/map?lat=-25.43&lng=-49.27&tema=claro");
    expect(claro.statusCode).toBe(200);
    expect(new URL(recebidas[1]?.url ?? "", "http://x").searchParams.getAll("style")).toEqual([]);
  });

  test("Google fora do ar é 502 MAPAS_FALHOU; sem chave é 503 sem sair da API", async () => {
    falhar = true;
    const r = await pedir(`/places/autocomplete?q=padaria&session=${randomUUID()}`);
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ error: { code: "MAPAS_FALHOU" } });

    const guardada = env.GOOGLE_MAPS_API_KEY;
    env.GOOGLE_MAPS_API_KEY = undefined;
    recebidas = [];
    try {
      const sem = await pedir("/places/map?lat=1&lng=1");
      expect(sem.statusCode).toBe(503);
      expect(sem.json()).toMatchObject({ error: { code: "MAPAS_INDISPONIVEL" } });
      expect(recebidas).toHaveLength(0);
    } finally {
      env.GOOGLE_MAPS_API_KEY = guardada;
    }
  });

  test("sem token, 401", async () => {
    const r = await app.inject({ method: "GET", url: "/places/map?lat=1&lng=1" });
    expect(r.statusCode).toBe(401);
  });

  test("os links públicos do Maps: pelo lugar quando há, senão pelo texto", () => {
    const place = { placeId: "ChIJpadaria", address: "Rua das Flores, 10", lat: -25.43, lng: -49.27 };
    expect(linkComoChegar("Padaria", place)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-25.43,-49.27&destination_place_id=ChIJpadaria",
    );
    expect(linkComoChegar("Casa da vó", null)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Casa%20da%20v%C3%B3",
    );
    expect(linkDoMapa("Padaria", place)).toContain("query_place_id=ChIJpadaria");
    expect(linkDoMapa("Casa da vó", null)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Casa%20da%20v%C3%B3",
    );
  });
});
