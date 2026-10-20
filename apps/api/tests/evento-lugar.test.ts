import type { EventItem, EventPlace, TaskItem } from "@yu-book/shared";
import { formatarEvento } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/*
 * O lugar do Google por trás do local do evento: anda com o texto, e o texto
 * mudado à mão sem escolher de novo o desfaz.
 */

let app: FastifyInstance;
let dono: Usuario;

const DIA = "2030-11-12";
const PADARIA: EventPlace = {
  placeId: "ChIJpadaria",
  address: "Rua das Flores, 10 - Curitiba, PR",
  lat: -25.43,
  lng: -49.27,
};

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("evento-lugar");
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

const api = (method: "GET" | "POST" | "PATCH", url: string, body?: unknown) =>
  chamar(app, { method, url, token: dono.token, ...(body !== undefined && { body }) });

async function novo(corpo: Record<string, unknown>): Promise<EventItem> {
  const r = await api("POST", "/events", { title: "Café", date: DIA, allDay: true, ...corpo });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as EventItem;
}

describe("lugar do evento", () => {
  test("nasce com o lugar escolhido; sem nome, o lugar não vale", async () => {
    const com = await novo({ location: "Padaria", place: PADARIA });
    expect(com.place).toEqual(PADARIA);
    expect((await api("GET", `/events/${com.id}`)).body).toMatchObject({ place: PADARIA });

    const semNome = await novo({ location: null, place: PADARIA });
    expect(semNome.place).toBeNull();

    const soTexto = await novo({ location: "Casa da vó" });
    expect(soTexto.place).toBeNull();
  });

  test("mudar o texto à mão desfaz o vínculo; mudar outra coisa o mantém", async () => {
    const e = await novo({ location: "Padaria", place: PADARIA });

    const titulo = (await api("PATCH", `/events/${e.id}`, { title: "Café da manhã" }))
      .body as EventItem;
    expect(titulo.place).toEqual(PADARIA);

    const mesmo = (await api("PATCH", `/events/${e.id}`, { location: "Padaria" })).body as EventItem;
    expect(mesmo.place).toEqual(PADARIA);

    const outro = (await api("PATCH", `/events/${e.id}`, { location: "Outra padaria" }))
      .body as EventItem;
    expect(outro.place).toBeNull();

    const escolhido = (
      await api("PATCH", `/events/${e.id}`, { location: "Padaria", place: PADARIA })
    ).body as EventItem;
    expect(escolhido.place).toEqual(PADARIA);

    const apagado = (await api("PATCH", `/events/${e.id}`, { location: null })).body as EventItem;
    expect(apagado).toMatchObject({ location: null, place: null });
  });

  test("coordenada fora do mundo é 422", async () => {
    const r = await api("POST", "/events", {
      title: "X",
      date: DIA,
      allDay: true,
      location: "Lá",
      place: { ...PADARIA, lat: 120 },
    });
    expect(r.status).toBe(422);
  });

  test("a ocorrência separada da série herda o lugar", async () => {
    const serie = await novo({
      date: "2030-11-11",
      allDay: false,
      startTime: "08:00",
      location: "Padaria",
      place: PADARIA,
      repeat: { days: [1, 3] },
    });
    const r = await api(
      "PATCH",
      `/events/${serie.id}?scope=esta&occurrenceDate=2030-11-13`,
      { title: "Café diferente" },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body as EventItem).place).toEqual(PADARIA);
  });

  test("virar tarefa leva o endereço na descrição; o formatador mostra o endereço", async () => {
    const e = await novo({ location: "Padaria", place: PADARIA });
    expect(formatarEvento(e)).toContain("local: Padaria (Rua das Flores, 10 - Curitiba, PR)");
    // A API da janela do deploy não manda `place`: o formatador segue.
    expect(formatarEvento({ ...e, place: undefined } as unknown as EventItem)).toContain(
      "local: Padaria",
    );

    const r = await api("POST", `/events/${e.id}/to-task`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((r.body as TaskItem).descriptionMd).toContain(
      "Local: Padaria — Rua das Flores, 10 - Curitiba, PR",
    );
  });
});
