import {
  MAX_OCORRENCIAS_POR_CONSULTA,
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaDaSemana,
  diasDoEvento,
  instanteLocal,
  ocorrenciaDoDia,
  ocorrenciasNoPeriodo,
  primeiroDiaDaSerie,
  resolverSerie,
  restaOcorrencia,
  somarDias,
} from "@yu-book/shared";
import type {
  AgendaRange,
  ApiErrorBody,
  EventItem,
  PedidoDeHorario,
  PedidoDeRepeticao,
  SerieDoEvento,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Eventos recorrentes — frente de eventos recorrentes, R1 (domínio).
 *
 * A série é **um** evento com a regra junto (`repeat_days`, `repeat_until`,
 * `exdates`), e as ocorrências se calculam na leitura, no fuso atual do
 * usuário. O que esta suíte protege:
 *
 * - a expansão: cada ocorrência no seu dia, na hora de parede da série, com o
 *   `id` da série e o `occurrenceDate` que a identifica — inclusive do outro
 *   lado de uma virada de horário de verão;
 * - os escopos de PATCH e DELETE (`esta`, `seguintes`, `todas`), que partem ou
 *   encerram a série sem perder cancelamento nem marca de IA (INV-58);
 * - a posse (INV-01, INV-02): o escopo não abre porta para o intruso.
 *
 * Os dias são de 2030, longe de "hoje": nenhum caso depende do relógio. São
 * Paulo é UTC−3 e Tóquio UTC+9 o ano inteiro; Nova York sai do horário de
 * verão em 03/11/2030. Cada caso que lê a agenda usa conta própria, porque a
 * agenda traz tudo da conta.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

const SP = "America/Sao_Paulo";
const TOQUIO = "Asia/Tokyo";
const NOVA_YORK = "America/New_York";

/// Segunda-feira. As semanas da suíte se contam a partir dela.
const SEG = "2030-11-04";
const dia = (n: number) => somarDias(SEG, n);

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await contaNoFuso("recorrentes-dono", SP);
  intruso = await contaNoFuso("recorrentes-intruso", SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ apoio */

/// 300 requisições por minuto por IP, e esta suíte passa disso: um IP por
/// chamada, como sessões diferentes (ver `apoio.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.32.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

const codigo = (body: unknown) => (body as ApiErrorBody).error?.code;
const mensagem = (body: unknown) => (body as ApiErrorBody).error?.message;
const caminhos = (body: unknown) =>
  ((body as ApiErrorBody).error?.issues ?? []).map((issue) => issue.path);

async function preferirFuso(userId: string, timezone: string): Promise<void> {
  await prisma.aiPreference.upsert({
    where: { userId },
    create: {
      userId,
      dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
      timezone,
      allowTraining: TREINO_PERMITIDO_PADRAO,
    },
    update: { timezone },
  });
}

async function contaNoFuso(apelido: string, fuso: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await preferirFuso(usuario.id, fuso);
  return usuario;
}

async function novoEvento(usuario: Usuario, corpo: Record<string, unknown>): Promise<EventItem> {
  const { status, body } = await api(usuario, "POST", "/events", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as EventItem;
}

async function agenda(usuario: Usuario, de: string, ate: string): Promise<EventItem[]> {
  const { status, body } = await api(usuario, "GET", `/agenda?from=${de}&to=${ate}`);
  expect(status, JSON.stringify(body)).toBe(200);
  return (body as AgendaRange).events;
}

async function eventos(usuario: Usuario, de: string, ate: string): Promise<EventItem[]> {
  const { status, body } = await api(usuario, "GET", `/events?from=${de}&to=${ate}`);
  expect(status, JSON.stringify(body)).toBe(200);
  return body as EventItem[];
}

/** PATCH ou DELETE com o escopo na query, como a rota o recebe. */
function comEscopo(
  usuario: Usuario,
  method: "PATCH" | "DELETE",
  id: string,
  query: string,
  corpo?: unknown,
) {
  return api(usuario, method, `/events/${id}${query ? `?${query}` : ""}`, corpo);
}

const escopoEsta = (ocorrencia: string) => `scope=esta&occurrenceDate=${ocorrencia}`;
const escopoSeguintes = (ocorrencia: string) => `scope=seguintes&occurrenceDate=${ocorrencia}`;

/** Cancela uma ocorrência (DELETE com `esta`), como preparo do caso. */
async function cancelar(usuario: Usuario, id: string, ocorrencia: string): Promise<void> {
  const { status, body } = await comEscopo(usuario, "DELETE", id, escopoEsta(ocorrencia));
  expect(status, JSON.stringify(body)).toBe(204);
}

/** Toda segunda, quarta e sexta das 08:00 às 09:00, a partir de `SEG`. */
const AULA_DA_MANHA = {
  title: "Inglês (manhã)",
  date: SEG,
  startTime: "08:00",
  endTime: "09:00",
  repeat: { days: [1, 3, 5] },
};

const ocorrencias = (itens: EventItem[]) => itens.map((item) => item.occurrenceDate);

const diaCivil = (data: Date | null) => (data ? data.toISOString().slice(0, 10) : null);

async function linhaGravada(id: string) {
  const linha = await prisma.event.findUniqueOrThrow({ where: { id } });
  return {
    ...linha,
    repeatUntil: diaCivil(linha.repeatUntil),
    exdates: linha.exdates.map((d) => diaCivil(d)).sort(),
  };
}

/* ---------------------------------------------------------- caso do operador */

describe("o pedido do operador: inglês seg/qua/sex de manhã e ter/qui à tarde", () => {
  test("duas semanas trazem exatamente as dez aulas, em ordem, cada uma no seu dia e hora local", async () => {
    const usuario = await contaNoFuso("recorrentes-operador", SP);
    const manha = await novoEvento(usuario, AULA_DA_MANHA);
    // Os dias fora de ordem e a partir de uma segunda: a série começa na terça.
    const tarde = await novoEvento(usuario, {
      title: "Inglês (tarde)",
      date: SEG,
      startTime: "17:00",
      endTime: "18:00",
      repeat: { days: [4, 2] },
    });
    expect(tarde).toMatchObject({
      date: dia(1),
      occurrenceDate: dia(1),
      recurrence: { days: [2, 4], until: null },
    });

    const esperadas = [
      [manha, 0],
      [tarde, 1],
      [manha, 2],
      [tarde, 3],
      [manha, 4],
      [manha, 7],
      [tarde, 8],
      [manha, 9],
      [tarde, 10],
      [manha, 11],
    ] as const;

    const daAgenda = await agenda(usuario, SEG, dia(13));
    expect(daAgenda).toHaveLength(10);
    daAgenda.forEach((item, i) => {
      const esperada = esperadas[i];
      if (!esperada) throw new Error(`Ocorrência ${i} a mais`);
      const [serie, n] = esperada;
      const deManha = serie === manha;
      expect(item).toMatchObject({
        id: serie.id,
        title: serie.title,
        allDay: false,
        date: dia(n),
        endDate: dia(n),
        occurrenceDate: dia(n),
        startTime: deManha ? "08:00" : "17:00",
        endTime: deManha ? "09:00" : "18:00",
        // São Paulo, UTC−3.
        startsAt: `${dia(n)}T${deManha ? "11" : "20"}:00:00.000Z`,
        endsAt: `${dia(n)}T${deManha ? "12" : "21"}:00:00.000Z`,
        recurrence: { days: deManha ? [1, 3, 5] : [2, 4], until: null },
      });
    });

    // A mesma expansão nas duas rotas de leitura.
    expect(await eventos(usuario, SEG, dia(13))).toEqual(daAgenda);
  });

  test("a série lida pelo id vem pela primeira ocorrência, com a regra", async () => {
    const serie = await novoEvento(dono, { ...AULA_DA_MANHA, date: dia(1) });
    const { status, body } = await api(dono, "GET", `/events/${serie.id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: serie.id,
      date: dia(2),
      occurrenceDate: dia(2),
      startTime: "08:00",
      recurrence: { days: [1, 3, 5], until: null },
    });
  });
});

/* ------------------------------------------------------------- a regra */

describe("a regra da série", () => {
  test("a série começa no primeiro dia escolhido a partir da data, e é ele o início gravado", async () => {
    // Quinta, com a série às segundas e quartas: a primeira é a segunda seguinte.
    const serie = await novoEvento(dono, {
      ...AULA_DA_MANHA,
      date: dia(3),
      repeat: { days: [1, 3] },
    });
    expect(serie).toMatchObject({ date: dia(7), endDate: dia(7), occurrenceDate: dia(7) });
    const gravado = await prisma.event.findUniqueOrThrow({ where: { id: serie.id } });
    expect(gravado.startsAt.toISOString()).toBe(`${dia(7)}T11:00:00.000Z`);
  });

  test("o fim da repetição é inclusivo: a ocorrência do último dia aparece, e nada depois dele", async () => {
    const usuario = await contaNoFuso("recorrentes-until", SP);
    const serie = await novoEvento(usuario, {
      ...AULA_DA_MANHA,
      repeat: { days: [1, 3], until: dia(9) },
    });
    expect(serie.recurrence).toEqual({ days: [1, 3], until: dia(9) });
    expect(ocorrencias(await agenda(usuario, SEG, dia(20)))).toEqual([
      dia(0),
      dia(2),
      dia(7),
      dia(9),
    ]);
  });

  test("fim antes do início, ou sem nenhum dia escolhido até ele, é recusado em repeat.until", async () => {
    const titulo = `Série impossível ${crypto.randomUUID()}`;
    for (const repeat of [
      { days: [1, 3, 5], until: dia(-1) },
      // Começa na segunda e acaba na quinta, mas só repete na sexta.
      { days: [5], until: dia(3) },
    ]) {
      const { status, body } = await api(dono, "POST", "/events", {
        ...AULA_DA_MANHA,
        title: titulo,
        repeat,
      });
      expect(status, JSON.stringify(repeat)).toBe(422);
      expect(codigo(body)).toBe("VALIDATION_ERROR");
      expect(caminhos(body)).toEqual(["repeat.until"]);
    }
    expect(await prisma.event.count({ where: { title: titulo } })).toBe(0);
  });

  test("dia da semana repetido, fora de 0 a 6, fracionário ou lista vazia são recusados em repeat.days", async () => {
    const titulo = `Dias ruins ${crypto.randomUUID()}`;
    for (const [days, caminho] of [
      [[1, 1], "repeat.days"],
      [[7], "repeat.days.0"],
      [[-1], "repeat.days.0"],
      [[1, 2.5], "repeat.days.1"],
      [[], "repeat.days"],
    ] as const) {
      const { status, body } = await api(dono, "POST", "/events", {
        ...AULA_DA_MANHA,
        title: titulo,
        repeat: { days },
      });
      expect(status, JSON.stringify(days)).toBe(422);
      expect(caminhos(body)).toContain(caminho);
    }
    expect(await prisma.event.count({ where: { title: titulo } })).toBe(0);
  });

  test("série dura um dia só: dois dias inteiros ou mais de 24 horas são recusados em repeat", async () => {
    const titulo = `Série longa ${crypto.randomUUID()}`;
    for (const horario of [
      { allDay: true, date: SEG, endDate: dia(1) },
      { date: SEG, startTime: "08:00", endDate: dia(1), endTime: "08:01" },
    ]) {
      const { status, body } = await api(dono, "POST", "/events", {
        title: titulo,
        ...horario,
        repeat: { days: [1] },
      });
      expect(status, JSON.stringify(horario)).toBe(422);
      expect(caminhos(body)).toEqual(["repeat"]);
    }
    expect(await prisma.event.count({ where: { title: titulo } })).toBe(0);

    // Exatamente 24 horas ainda é "um dia".
    const limite = await novoEvento(dono, {
      title: titulo,
      date: SEG,
      startTime: "08:00",
      endDate: dia(1),
      endTime: "08:00",
      repeat: { days: [1] },
    });
    expect(limite.recurrence).toEqual({ days: [1], until: null });
  });

  test("série de dia inteiro aparece em cada dia escolhido, da meia-noite local à seguinte", async () => {
    const usuario = await contaNoFuso("recorrentes-dia-inteiro", SP);
    const serie = await novoEvento(usuario, {
      title: "Fim de semana livre",
      date: SEG,
      allDay: true,
      repeat: { days: [6, 0] },
    });
    expect(serie).toMatchObject({ date: dia(5), recurrence: { days: [0, 6], until: null } });

    const itens = await agenda(usuario, SEG, dia(13));
    expect(ocorrencias(itens)).toEqual([dia(5), dia(6), dia(12), dia(13)]);
    for (const item of itens) {
      expect(item).toMatchObject({
        id: serie.id,
        allDay: true,
        date: item.occurrenceDate,
        endDate: item.occurrenceDate,
        startTime: null,
        endTime: null,
        startsAt: `${item.occurrenceDate}T03:00:00.000Z`,
        endsAt: `${somarDias(item.occurrenceDate, 1)}T03:00:00.000Z`,
      });
    }
  });
});

/* -------------------------------------------------------------- fuso */

describe("fuso do usuário na série", () => {
  test("a série de São Paulo lida em Tóquio é o mesmo instante em outra hora de parede", async () => {
    const usuario = await contaNoFuso("recorrentes-toquio", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    const emSaoPaulo = await agenda(usuario, SEG, dia(6));

    await preferirFuso(usuario.id, TOQUIO);
    const emToquio = await agenda(usuario, SEG, dia(6));

    expect(emToquio.map((item) => [item.startsAt, item.endsAt])).toEqual(
      emSaoPaulo.map((item) => [item.startsAt, item.endsAt]),
    );
    // 11:00Z é 20:00 em Tóquio, no mesmo dia.
    for (const item of emToquio) {
      expect(item).toMatchObject({
        id: serie.id,
        date: item.occurrenceDate,
        startTime: "20:00",
        endTime: "21:00",
      });
    }
  });

  test("limitação declarada: se o fuso novo leva a hora para o outro dia, a série anda um dia", async () => {
    const usuario = await contaNoFuso("recorrentes-toquio-virada", SP);
    // Segunda às 13:00 em São Paulo é 16:00Z — terça à 01:00 em Tóquio.
    const serie = await novoEvento(usuario, {
      title: "Reunião de segunda",
      date: SEG,
      startTime: "13:00",
      endTime: "14:00",
      repeat: { days: [1] },
    });
    const emSaoPaulo = await agenda(usuario, SEG, dia(13));
    expect(emSaoPaulo.map((item) => item.startsAt)).toEqual([
      `${dia(0)}T16:00:00.000Z`,
      `${dia(7)}T16:00:00.000Z`,
    ]);

    await preferirFuso(usuario.id, TOQUIO);
    const emToquio = await agenda(usuario, SEG, dia(13));
    // Os dias da regra são do calendário em que ela foi gravada (segunda): em
    // Tóquio a série fica na segunda à 01:00 local, um dia antes no instante.
    // A primeira ocorrência gravada cai numa terça local e deixa de aparecer.
    expect(emToquio.map((item) => [item.id, item.occurrenceDate, item.startTime])).toEqual([
      [serie.id, dia(7), "01:00"],
    ]);
    expect(diaDaSemana(emToquio[0]?.date ?? "")).toBe(1);
    expect(emToquio[0]?.startsAt).toBe(`${dia(6)}T16:00:00.000Z`);
  });

  test("em Nova York a aula continua às 08:00 local depois do fim do horário de verão, e o instante UTC anda", async () => {
    const usuario = await contaNoFuso("recorrentes-nova-york", NOVA_YORK);
    // Segunda, 28/10/2030; o horário de verão acaba no domingo, 03/11.
    const inicio = "2030-10-28";
    const serie = await novoEvento(usuario, {
      title: "Daily",
      date: inicio,
      startTime: "08:00",
      endTime: "08:30",
      repeat: { days: [1, 2, 3, 4, 5] },
    });

    const itens = await agenda(usuario, inicio, somarDias(inicio, 11));
    expect(itens).toHaveLength(10);
    for (const item of itens) {
      expect(item).toMatchObject({ id: serie.id, startTime: "08:00", endTime: "08:30" });
      // Antes da virada, EDT (UTC−4); depois, EST (UTC−5).
      const horaUtc = item.occurrenceDate < "2030-11-03" ? "12" : "13";
      expect(item.startsAt, item.occurrenceDate).toBe(
        `${item.occurrenceDate}T${horaUtc}:00:00.000Z`,
      );
      expect(item.endsAt).toBe(`${item.occurrenceDate}T${horaUtc}:30:00.000Z`);
    }
  });
});

/* -------------------------------------------------------- meia-noite */

describe("série que atravessa a meia-noite", () => {
  test("a ocorrência das 23:00 à 01:00 aparece na consulta de cada um dos seus dois dias", async () => {
    const usuario = await contaNoFuso("recorrentes-meia-noite", SP);
    const serie = await novoEvento(usuario, {
      title: "Plantão",
      date: SEG,
      startTime: "23:00",
      endTime: "01:00",
      repeat: { days: [1] },
    });
    expect(serie).toMatchObject({ date: dia(0), endDate: dia(1), endTime: "01:00" });

    // Segunda e terça da segunda semana, cada uma sozinha: a mesma ocorrência,
    // que não é a primeira gravada.
    for (const consultado of [dia(7), dia(8)]) {
      const itens = await agenda(usuario, consultado, consultado);
      expect(itens.map((item) => [item.id, item.occurrenceDate]), consultado).toEqual([
        [serie.id, dia(7)],
      ]);
      expect(itens[0]).toMatchObject({
        date: dia(7),
        endDate: dia(8),
        startTime: "23:00",
        endTime: "01:00",
      });
      expect(diasDoEvento(itens[0] as EventItem)).toEqual([dia(7), dia(8)]);
    }

    // Os dois dias juntos: um item só, não um por dia.
    expect(ocorrencias(await agenda(usuario, dia(7), dia(8)))).toEqual([dia(7)]);
    // O domingo antes e a quarta depois não a veem.
    expect(await agenda(usuario, dia(6), dia(6))).toEqual([]);
    expect(await agenda(usuario, dia(9), dia(9))).toEqual([]);
  });
});

/* ---------------------------------------------------------- escopo: esta */

describe("escopo esta", () => {
  test("editar uma ocorrência cria um evento avulso com os dados novos, e a data some da série", async () => {
    const usuario = await contaNoFuso("recorrentes-esta-patch", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);

    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoEsta(dia(2)),
      { title: "Inglês (remarcada)", startTime: "10:00" },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const avulso = body as EventItem;
    expect(avulso.id).not.toBe(serie.id);
    expect(avulso).toMatchObject({
      title: "Inglês (remarcada)",
      date: dia(2),
      occurrenceDate: dia(2),
      // A duração da ocorrência anda com o início.
      startTime: "10:00",
      endTime: "11:00",
      recurrence: null,
    });

    const gravada = await linhaGravada(serie.id);
    expect(gravada.exdates).toEqual([dia(2)]);
    expect(gravada.title).toBe(AULA_DA_MANHA.title);

    const itens = await agenda(usuario, SEG, dia(6));
    expect(itens.map((item) => [item.id, item.occurrenceDate, item.startTime])).toEqual([
      [serie.id, dia(0), "08:00"],
      [avulso.id, dia(2), "10:00"],
      [serie.id, dia(4), "08:00"],
    ]);

    // A ocorrência já saiu da série: editá-la de novo é 404.
    const outra = await comEscopo(usuario, "PATCH", serie.id, escopoEsta(dia(2)), {
      title: "De novo",
    });
    expect(outra.status).toBe(404);
  });

  test("excluir uma ocorrência a cancela, e excluí-la de novo é 404", async () => {
    const usuario = await contaNoFuso("recorrentes-esta-delete", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);

    const excluida = await comEscopo(usuario, "DELETE", serie.id, escopoEsta(dia(4)));
    expect(excluida.status).toBe(204);
    expect(ocorrencias(await agenda(usuario, SEG, dia(6)))).toEqual([dia(0), dia(2)]);
    expect((await linhaGravada(serie.id)).exdates).toEqual([dia(4)]);

    const repetida = await comEscopo(usuario, "DELETE", serie.id, escopoEsta(dia(4)));
    expect(repetida.status).toBe(404);
    expect(mensagem(repetida.body)).toBe("Ocorrência não encontrada");
    // O resto da série segue lá.
    expect(ocorrencias(await agenda(usuario, dia(7), dia(13)))).toEqual([dia(7), dia(9), dia(11)]);
  });

  test("dia que a regra não gera é 404 em PATCH e DELETE, e nada muda", async () => {
    const serie = await novoEvento(dono, {
      ...AULA_DA_MANHA,
      repeat: { days: [1, 3, 5], until: dia(11) },
    });
    const antes = await linhaGravada(serie.id);

    for (const fora of [
      dia(1), // terça, fora dos dias
      dia(-7), // segunda antes do início
      dia(14), // segunda depois do fim
    ]) {
      for (const scope of ["esta", "seguintes"]) {
        for (const method of ["PATCH", "DELETE"] as const) {
          const { status, body } = await comEscopo(
            dono,
            method,
            serie.id,
            `scope=${scope}&occurrenceDate=${fora}`,
            method === "PATCH" ? { title: "Nunca" } : undefined,
          );
          expect(status, `${method} ${scope} ${fora}`).toBe(404);
          expect(mensagem(body)).toBe("Ocorrência não encontrada");
        }
      }
    }
    expect(await linhaGravada(serie.id)).toEqual(antes);
    expect(await prisma.event.count({ where: { userId: dono.id, title: "Nunca" } })).toBe(0);
  });

  test("esta e seguintes numa série exigem occurrenceDate, em PATCH e DELETE", async () => {
    const serie = await novoEvento(dono, AULA_DA_MANHA);
    const antes = await linhaGravada(serie.id);
    for (const scope of ["esta", "seguintes"]) {
      for (const method of ["PATCH", "DELETE"] as const) {
        const { status, body } = await comEscopo(
          dono,
          method,
          serie.id,
          `scope=${scope}`,
          method === "PATCH" ? { title: "Sem dia" } : undefined,
        );
        expect(status, `${method} ${scope}`).toBe(422);
        expect(codigo(body)).toBe("VALIDATION_ERROR");
      }
    }
    expect(await linhaGravada(serie.id)).toEqual(antes);
  });

  test("duas edições simultâneas da mesma ocorrência criam um avulso só, e a outra é 404 (INV-04)", async () => {
    const usuario = await contaNoFuso("recorrentes-esta-corrida", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    const query = escopoEsta(dia(2));

    const respostas = await Promise.all([
      comEscopo(usuario, "PATCH", serie.id, query, { title: "Primeira" }),
      comEscopo(usuario, "PATCH", serie.id, query, { title: "Segunda" }),
      comEscopo(usuario, "DELETE", serie.id, query),
    ]);
    // Seja qual for a ordem, uma ganha e as outras acham a ocorrência já fora.
    const vencedoras = respostas.filter((r) => r.status !== 404);
    expect(vencedoras).toHaveLength(1);
    expect(respostas.filter((r) => r.status === 404)).toHaveLength(2);
    const editou = vencedoras[0]?.status === 200;
    if (!editou) expect(vencedoras[0]?.status).toBe(204);

    // O cancelamento entra uma vez, e no máximo um avulso nasce.
    expect((await linhaGravada(serie.id)).exdates).toEqual([dia(2)]);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(editou ? 2 : 1);
    expect(await agenda(usuario, dia(2), dia(2))).toHaveLength(editou ? 1 : 0);
  });

  test("a repetição não se muda numa ocorrência só: repeat com esta é recusado sem gravar nada", async () => {
    const serie = await novoEvento(dono, AULA_DA_MANHA);
    const antes = await linhaGravada(serie.id);
    const total = await prisma.event.count({ where: { userId: dono.id } });

    const { status, body } = await comEscopo(
      dono,
      "PATCH",
      serie.id,
      escopoEsta(dia(2)),
      { repeat: { days: [2] } },
    );
    expect(status).toBe(422);
    expect(codigo(body)).toBe("VALIDATION_ERROR");
    expect(await linhaGravada(serie.id)).toEqual(antes);
    expect(await prisma.event.count({ where: { userId: dono.id } })).toBe(total);
  });
});

/* ------------------------------------------------------ escopo: seguintes */

describe("escopo seguintes", () => {
  test("editar dali em diante encerra a original na véspera e cria a série nova, que leva os cancelamentos posteriores", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-patch", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    // Um cancelamento antes do corte e um depois.
    for (const cancelado of [dia(2), dia(9)]) await cancelar(usuario, serie.id, cancelado);

    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(7)),
      { title: "Inglês (novo horário)", startTime: "07:00" },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const nova = body as EventItem;
    expect(nova.id).not.toBe(serie.id);
    expect(nova).toMatchObject({
      title: "Inglês (novo horário)",
      date: dia(7),
      startTime: "07:00",
      endTime: "08:00",
      recurrence: { days: [1, 3, 5], until: null },
    });

    const original = await linhaGravada(serie.id);
    expect(original.repeatUntil).toBe(dia(6));
    expect(original.exdates).toEqual([dia(2)]);
    expect(original.title).toBe(AULA_DA_MANHA.title);
    expect((await linhaGravada(nova.id)).exdates).toEqual([dia(9)]);

    const itens = await agenda(usuario, SEG, dia(13));
    expect(itens.map((item) => [item.id, item.occurrenceDate, item.startTime])).toEqual([
      [serie.id, dia(0), "08:00"],
      [serie.id, dia(4), "08:00"],
      [nova.id, dia(7), "07:00"],
      [nova.id, dia(11), "07:00"],
    ]);
    expect(itens[0]?.recurrence).toEqual({ days: [1, 3, 5], until: dia(6) });
  });

  test("seguintes pode trocar a regra: a série nova repete nos dias pedidos", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-regra", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(7)),
      { repeat: { days: [2, 4] } },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const nova = body as EventItem;
    // A ocorrência de segunda não cai na regra nova: a série nova começa na terça.
    expect(nova).toMatchObject({ date: dia(8), recurrence: { days: [2, 4], until: null } });
    expect(ocorrencias(await agenda(usuario, dia(7), dia(13)))).toEqual([dia(8), dia(10)]);
  });

  test("seguintes a partir da primeira ocorrência é a série inteira: mesmo id, nenhuma linha nova", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-primeira", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);

    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(SEG),
      { startTime: "09:30" },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body as EventItem).id).toBe(serie.id);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);
    const itens = await agenda(usuario, SEG, dia(6));
    expect(itens.map((item) => [item.id, item.startTime, item.endTime])).toEqual([
      [serie.id, "09:30", "10:30"],
      [serie.id, "09:30", "10:30"],
      [serie.id, "09:30", "10:30"],
    ]);
    expect((await linhaGravada(serie.id)).repeatUntil).toBeNull();
  });

  test("excluir dali em diante só encerra a original na véspera, e os cancelamentos posteriores somem", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-delete", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    await cancelar(usuario, serie.id, dia(9));

    const r = await comEscopo(usuario, "DELETE", serie.id, escopoSeguintes(dia(7)));
    expect(r.status).toBe(204);
    const gravada = await linhaGravada(serie.id);
    expect(gravada.repeatUntil).toBe(dia(6));
    expect(gravada.exdates).toEqual([]);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);
    expect(ocorrencias(await agenda(usuario, SEG, dia(20)))).toEqual([dia(0), dia(2), dia(4)]);
  });

  test("excluir seguintes a partir da primeira ocorrência apaga a série", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-delete-primeira", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    const r = await comEscopo(usuario, "DELETE", serie.id, escopoSeguintes(SEG));
    expect(r.status).toBe(204);
    expect(await prisma.event.count({ where: { id: serie.id } })).toBe(0);
    expect((await api(usuario, "GET", `/events/${serie.id}`)).status).toBe(404);
  });
});

/* --------------------------------------------------------- escopo: todas */

describe("escopo todas", () => {
  test("mudar a hora da série move todas as ocorrências, sem escopo explícito também", async () => {
    const usuario = await contaNoFuso("recorrentes-todas-patch", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);

    for (const [query, startTime, endTime] of [
      ["scope=todas", "10:00", "11:00"],
      // Sem `scope`, vale `todas`.
      ["", "06:15", "07:15"],
    ] as const) {
      const { status, body } = await comEscopo(usuario, "PATCH", serie.id, query, { startTime });
      expect(status, JSON.stringify(body)).toBe(200);
      expect((body as EventItem).id).toBe(serie.id);
      const itens = await agenda(usuario, SEG, dia(13));
      expect(itens).toHaveLength(6);
      for (const item of itens) {
        expect(item).toMatchObject({ id: serie.id, startTime, endTime });
      }
    }
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);
  });

  test("excluir a série apaga todas as ocorrências de uma vez", async () => {
    const usuario = await contaNoFuso("recorrentes-todas-delete", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    const r = await comEscopo(usuario, "DELETE", serie.id, "scope=todas");
    expect(r.status).toBe(204);
    expect(await agenda(usuario, SEG, dia(20))).toEqual([]);
    expect((await api(usuario, "GET", `/events/${serie.id}`)).status).toBe(404);
  });

  test("repeat nulo faz da série um evento simples na primeira ocorrência, sem cancelamentos", async () => {
    const usuario = await contaNoFuso("recorrentes-repeat-nulo", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    await cancelar(usuario, serie.id, dia(2));

    const { status, body } = await api(usuario, "PATCH", `/events/${serie.id}`, { repeat: null });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ id: serie.id, date: SEG, recurrence: null });

    const gravada = await linhaGravada(serie.id);
    expect(gravada.repeatDays).toEqual([]);
    expect(gravada.exdates).toEqual([]);
    expect(gravada.repeatUntil).toBeNull();
    expect(ocorrencias(await agenda(usuario, SEG, dia(13)))).toEqual([SEG]);
  });
});

/* ------------------------------------------------ série sem ocorrência viva */

describe("série que fica sem ocorrência", () => {
  test("cancelar a última ocorrência que restava apaga a série", async () => {
    const usuario = await contaNoFuso("recorrentes-ultima-esta", SP);
    const serie = await novoEvento(usuario, {
      ...AULA_DA_MANHA,
      repeat: { days: [1], until: dia(7) },
    });
    await cancelar(usuario, serie.id, SEG);
    expect(await prisma.event.count({ where: { id: serie.id } })).toBe(1);

    await cancelar(usuario, serie.id, dia(7));
    expect(await prisma.event.count({ where: { id: serie.id } })).toBe(0);
  });

  test("editar a última ocorrência que restava deixa só o avulso", async () => {
    const usuario = await contaNoFuso("recorrentes-ultima-patch", SP);
    const serie = await novoEvento(usuario, {
      ...AULA_DA_MANHA,
      repeat: { days: [1], until: SEG },
    });
    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoEsta(SEG),
      { startTime: "15:00" },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(await prisma.event.count({ where: { id: serie.id } })).toBe(0);
    const itens = await agenda(usuario, SEG, dia(13));
    expect(itens.map((item) => [item.id, item.startTime, item.recurrence])).toEqual([
      [(body as EventItem).id, "15:00", null],
    ]);
  });

  test("seguintes a partir da primeira ocorrência viva apaga a original, que só teria canceladas", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-viva", SP);
    const serie = await novoEvento(usuario, { ...AULA_DA_MANHA, repeat: { days: [1, 3] } });
    await cancelar(usuario, serie.id, SEG);

    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(2)),
      { title: "Só às quartas e segundas, de novo" },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(await prisma.event.count({ where: { id: serie.id } })).toBe(0);
    const nova = body as EventItem;
    expect(ocorrencias(await agenda(usuario, SEG, dia(9)))).toEqual([dia(2), dia(7), dia(9)]);
    expect((await linhaGravada(nova.id)).exdates).toEqual([]);
  });
});

/* -------------------------------------------------- evento simples e escopo */

describe("evento simples com escopo", () => {
  test("o escopo não conta num evento simples: PATCH edita ele mesmo e DELETE o apaga", async () => {
    const usuario = await contaNoFuso("recorrentes-simples", SP);
    const simples = await novoEvento(usuario, {
      title: "Consulta",
      date: dia(1),
      startTime: "14:00",
    });

    // Nem o dia da ocorrência é cobrado.
    for (const query of ["scope=esta", escopoSeguintes(dia(5))]) {
      const { status, body } = await comEscopo(usuario, "PATCH", simples.id, query, {
        title: `Consulta (${query})`,
      });
      expect(status, query).toBe(200);
      expect(body).toMatchObject({ id: simples.id, title: `Consulta (${query})`, date: dia(1) });
    }
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);

    const r = await comEscopo(usuario, "DELETE", simples.id, escopoEsta(dia(1)));
    expect(r.status).toBe(204);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(0);
  });
});

/* ------------------------------------------------------------- marca de IA */

describe("marca de IA na série", () => {
  const MCP = { via: "mcp", author: "Claude Desktop" };

  test("a série criada pelo MCP leva a marca em cada ocorrência listada", async () => {
    const usuario = await contaNoFuso("recorrentes-marca", SP);
    const serie = await novoEvento(usuario, { ...AULA_DA_MANHA, origin: MCP });
    expect(serie.ai).toMatchObject({ via: "mcp", author: "Claude Desktop", revisedAt: null });
    const itens = await agenda(usuario, SEG, dia(6));
    expect(itens).toHaveLength(3);
    for (const item of itens) expect(item.ai).toEqual(serie.ai);
  });

  test("o avulso e a série nova herdam a marca; só ganham revisão se o texto mudou (INV-58)", async () => {
    const usuario = await contaNoFuso("recorrentes-marca-escopos", SP);
    const serie = await novoEvento(usuario, { ...AULA_DA_MANHA, origin: MCP });

    // Mover uma ocorrência, ou "trocar" o título pelo mesmo, não é revisão.
    for (const [ocorrencia, corpo] of [
      [dia(2), { startTime: "10:00" }],
      [dia(4), { title: AULA_DA_MANHA.title }],
    ] as const) {
      const { status, body } = await comEscopo(
        usuario,
        "PATCH",
        serie.id,
        escopoEsta(ocorrencia),
        corpo,
      );
      expect(status, JSON.stringify(body)).toBe(200);
      expect((body as EventItem).ai).toEqual(serie.ai);
    }

    // Mudar o texto dali em diante revisa a série nova, sem apagar a marca.
    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(7)),
      { description: "Com o livro novo" },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect((body as EventItem).ai).toEqual({ ...serie.ai, revisedAt: expect.any(String) });

    // A original não foi revisada por isso.
    const original = await prisma.event.findUniqueOrThrow({ where: { id: serie.id } });
    expect(original.aiRevisedAt).toBeNull();
    expect(original.aiVia).toBe("mcp");

    // E mudar o texto de uma ocorrência só revisa o avulso.
    const revisado = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoEsta(SEG),
      { title: "Inglês (com convidado)" },
    );
    expect(revisado.status).toBe(200);
    expect((revisado.body as EventItem).ai).toEqual({ ...serie.ai, revisedAt: expect.any(String) });
  });

  test("série humana partida por escopo não fabrica marca de IA", async () => {
    const usuario = await contaNoFuso("recorrentes-humana", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    const esta = await comEscopo(usuario, "PATCH", serie.id, escopoEsta(dia(2)), {
      title: "Outra",
    });
    const seguintes = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(7)),
      { title: "Outra fase" },
    );
    expect((esta.body as EventItem).ai).toBeNull();
    expect((seguintes.body as EventItem).ai).toBeNull();
  });
});

/* -------------------------------------------------------------------- posse */

describe("posse da série", () => {
  test("o intruso recebe 404 em PATCH e DELETE com qualquer escopo, e nada muda", async () => {
    const serie = await novoEvento(dono, { ...AULA_DA_MANHA, title: "Só do dono" });
    // O valor antigo fixado no passado: uma regravação no mesmo milissegundo
    // não passaria por "não mudou".
    await prisma.event.update({
      where: { id: serie.id },
      data: { updatedAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    const antes = await linhaGravada(serie.id);
    const doIntruso = await prisma.event.count({ where: { userId: intruso.id } });
    const doDono = await prisma.event.count({ where: { userId: dono.id } });

    for (const query of [
      "",
      "scope=todas",
      escopoEsta(dia(2)),
      escopoSeguintes(dia(7)),
      escopoSeguintes(SEG),
    ]) {
      for (const method of ["PATCH", "DELETE"] as const) {
        const { status, body } = await comEscopo(
          intruso,
          method,
          serie.id,
          query,
          method === "PATCH" ? { title: "Invadido", startTime: "03:00" } : undefined,
        );
        expect(status, `${method} ${query}`).toBe(404);
        expect(codigo(body)).toBe("NOT_FOUND");
      }
    }

    expect(await linhaGravada(serie.id)).toEqual(antes);
    expect(await prisma.event.count({ where: { userId: intruso.id } })).toBe(doIntruso);
    expect(await prisma.event.count({ where: { userId: dono.id } })).toBe(doDono);
    expect((await agenda(intruso, SEG, dia(13))).map((item) => item.id)).not.toContain(serie.id);
  });
});

/* -------------------------------------------- PATCH todas sob concorrência */

/// O valor antigo fixado no passado: uma escrita no meio, no mesmo milissegundo
/// da leitura, regravaria o mesmo `updatedAt` e passaria por "não mudou".
async function envelhecer(id: string): Promise<void> {
  await prisma.event.update({
    where: { id },
    data: { updatedAt: new Date("2020-01-01T00:00:00.000Z") },
  });
}

const deDia = (d: string) => new Date(`${d}T00:00:00.000Z`);

/**
 * A corrida sem depender de tempo: cada uma das próximas chamadas a
 * `prisma.event.updateMany` é precedida de uma das `escritas` — o que outra
 * requisição gravaria entre a leitura e a escrita condicional desta.
 */
function escritaNoMeio(escritas: Array<() => Promise<unknown>>) {
  const original = prisma.event.updateMany.bind(prisma.event);
  const espiao = vi.spyOn(prisma.event, "updateMany");
  for (const escrita of escritas) {
    espiao.mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      await escrita();
      return original(args);
    }) as never);
  }
  return espiao;
}

/**
 * Segura as próximas `n` leituras de `prisma.event.findFirst` até que todas
 * tenham lido: as `n` requisições leem o mesmo estado antes que qualquer uma
 * escreva — a intercalação que a corrida precisa, sem depender de tempo. A
 * ordem das escritas, depois, fica com o banco.
 */
function leiturasJuntas(n: number) {
  const original = prisma.event.findFirst.bind(prisma.event);
  let chegadas = 0;
  let soltar = () => {};
  const todasLeram = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  const espiao = vi.spyOn(prisma.event, "findFirst");
  for (let i = 0; i < n; i += 1) {
    espiao.mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const lida = await original(args);
      chegadas += 1;
      if (chegadas === n) soltar();
      await todasLeram;
      return lida;
    }) as never);
  }
  return espiao;
}

/// O que um "seguintes" na quarta semana grava na original: o fim na véspera.
const cortarNaSerie = (id: string, ate: string, updatedAt?: string) => () =>
  prisma.event.update({
    where: { id },
    data: {
      repeatUntil: deDia(ate),
      ...(updatedAt !== undefined && { updatedAt: new Date(updatedAt) }),
    },
  });

describe("PATCH todas que muda a hora, com outra escrita na série no meio (INV-04)", () => {
  test("o fim gravado por um seguintes no meio sobrevive: todas relê e repete uma vez sobre ele", async () => {
    const usuario = await contaNoFuso("recorrentes-todas-guarda", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    await envelhecer(serie.id);

    const espiao = escritaNoMeio([cortarNaSerie(serie.id, dia(6))]);
    try {
      const { status, body } = await comEscopo(usuario, "PATCH", serie.id, "scope=todas", {
        startTime: "10:00",
      });
      expect(status, JSON.stringify(body)).toBe(200);
      // A primeira tentativa perdeu a guarda; a segunda, sobre a releitura, gravou.
      expect(espiao).toHaveBeenCalledTimes(2);
    } finally {
      espiao.mockRestore();
    }

    expect((await linhaGravada(serie.id)).repeatUntil).toBe(dia(6));
    const itens = await agenda(usuario, SEG, dia(20));
    expect(itens.map((item) => [item.id, item.occurrenceDate, item.startTime])).toEqual([
      [serie.id, dia(0), "10:00"],
      [serie.id, dia(2), "10:00"],
      [serie.id, dia(4), "10:00"],
    ]);
  });

  test("uma escrita no meio de cada tentativa vira 409, e nem a hora nem o que os outros gravaram some", async () => {
    const usuario = await contaNoFuso("recorrentes-todas-409", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    await envelhecer(serie.id);
    const antes = await linhaGravada(serie.id);

    const espiao = escritaNoMeio([
      cortarNaSerie(serie.id, dia(13), "2021-01-01T00:00:00.000Z"),
      () =>
        prisma.event.update({
          where: { id: serie.id },
          data: {
            exdates: { push: deDia(dia(2)) },
            updatedAt: new Date("2022-01-01T00:00:00.000Z"),
          },
        }),
    ]);
    try {
      const { status, body } = await comEscopo(usuario, "PATCH", serie.id, "scope=todas", {
        startTime: "10:00",
      });
      expect(status, JSON.stringify(body)).toBe(409);
      expect(codigo(body)).toBe("VALIDATION_ERROR");
      expect(mensagem(body)).toBe("O evento mudou enquanto era editado. Tente de novo.");
    } finally {
      espiao.mockRestore();
    }

    const depois = await linhaGravada(serie.id);
    expect(depois.startsAt).toEqual(antes.startsAt);
    expect(depois.endsAt).toEqual(antes.endsAt);
    expect(depois.repeatUntil).toBe(dia(13));
    expect(depois.exdates).toEqual([dia(2)]);
    expect(
      (await agenda(usuario, SEG, dia(20))).map((item) => [item.occurrenceDate, item.startTime]),
    ).toEqual([
      [dia(0), "08:00"],
      [dia(4), "08:00"],
      [dia(7), "08:00"],
      [dia(9), "08:00"],
      [dia(11), "08:00"],
    ]);
  });

  test("PATCH só de texto segue sem guarda: grava por cima de escritas no meio e não regrava a regra", async () => {
    const usuario = await contaNoFuso("recorrentes-todas-texto", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    await envelhecer(serie.id);

    // Duas escritas armadas: com guarda, o título acabaria em 409 como acima.
    const espiao = escritaNoMeio([
      cortarNaSerie(serie.id, dia(6), "2021-01-01T00:00:00.000Z"),
      cortarNaSerie(serie.id, dia(13), "2022-01-01T00:00:00.000Z"),
    ]);
    try {
      const { status, body } = await api(usuario, "PATCH", `/events/${serie.id}`, {
        title: "Inglês (turma B)",
      });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(espiao).toHaveBeenCalledTimes(1);
    } finally {
      espiao.mockRestore();
    }

    const gravada = await linhaGravada(serie.id);
    expect(gravada.title).toBe("Inglês (turma B)");
    // O fim que a escrita do meio gravou ficou: o texto não o regravou da leitura.
    expect(gravada.repeatUntil).toBe(dia(6));
  });

  test("seguintes grava enquanto todas, que leu antes dele, espera para escrever: todas repete sobre o corte e as duas edições valem", async () => {
    const usuario = await contaNoFuso("recorrentes-corrida-ordenada", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    await envelhecer(serie.id);

    // As duas leem a série intacta; a escrita do todas espera o seguintes
    // terminar. É a ordem em que, sem a guarda, o todas devolveria à original
    // o fim nulo que leu, e as duas séries teriam ocorrência de dia(7) em diante.
    const espiaLeitura = leiturasJuntas(2);
    let seguintesTerminou = () => {};
    const fimDoSeguintes = new Promise<void>((resolver) => {
      seguintesTerminou = resolver;
    });
    const original = prisma.event.updateMany.bind(prisma.event);
    let segurou = false;
    const espiaEscrita = vi.spyOn(prisma.event, "updateMany").mockImplementation((async (
      args: Parameters<typeof original>[0],
    ) => {
      // Só a escrita do todas: a do seguintes confere a ocorrência no `where`.
      if (!segurou && args.where?.repeatDays === undefined) {
        segurou = true;
        await fimDoSeguintes;
      }
      return original(args);
    }) as never);

    try {
      const pedidoTodas = comEscopo(usuario, "PATCH", serie.id, "scope=todas", {
        startTime: "10:00",
      });
      const seguintes = await comEscopo(usuario, "PATCH", serie.id, escopoSeguintes(dia(7)), {
        title: "Inglês (fase 2)",
      });
      seguintesTerminou();
      const todas = await pedidoTodas;

      expect(seguintes.status, JSON.stringify(seguintes.body)).toBe(200);
      expect(todas.status, JSON.stringify(todas.body)).toBe(200);
      expect(segurou).toBe(true);
      const nova = seguintes.body as EventItem;

      expect((await linhaGravada(serie.id)).repeatUntil).toBe(dia(6));
      const itens = await agenda(usuario, SEG, dia(20));
      expect(itens.map((item) => [item.id, item.occurrenceDate, item.startTime])).toEqual([
        [serie.id, dia(0), "10:00"],
        [serie.id, dia(2), "10:00"],
        [serie.id, dia(4), "10:00"],
        [nova.id, dia(7), "08:00"],
        [nova.id, dia(9), "08:00"],
        [nova.id, dia(11), "08:00"],
        [nova.id, dia(14), "08:00"],
        [nova.id, dia(16), "08:00"],
        [nova.id, dia(18), "08:00"],
      ]);
    } finally {
      seguintesTerminou();
      espiaEscrita.mockRestore();
      espiaLeitura.mockRestore();
    }
  });

  test("todas e seguintes disparados juntos, rodada após rodada: o fim da original fica, e nenhuma ocorrência se duplica", async () => {
    for (let rodada = 0; rodada < 8; rodada += 1) {
      const usuario = await contaNoFuso(`recorrentes-corrida-${rodada}`, SP);
      const serie = await novoEvento(usuario, AULA_DA_MANHA);
      await envelhecer(serie.id);

      // As duas leem a série intacta; quem escreve primeiro varia de rodada a rodada.
      const espiao = leiturasJuntas(2);
      const [todas, seguintes] = await Promise.all([
        comEscopo(usuario, "PATCH", serie.id, "scope=todas", { startTime: "10:00" }),
        comEscopo(usuario, "PATCH", serie.id, escopoSeguintes(dia(7)), {
          title: "Inglês (fase 2)",
        }),
      ]).finally(() => espiao.mockRestore());
      const contexto = `rodada ${rodada}: ${JSON.stringify([todas.body, seguintes.body])}`;
      // Um concorrente só: no máximo uma tentativa perdida, e a repetição basta.
      expect(todas.status, contexto).toBe(200);
      // O seguintes perde se o todas gravou entre a leitura e a escrita dele.
      expect([200, 404], contexto).toContain(seguintes.status);

      const original = await linhaGravada(serie.id);
      if (seguintes.status === 200) {
        expect(original.repeatUntil, contexto).toBe(dia(6));
        expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(2);
      } else {
        expect(original.repeatUntil, contexto).toBeNull();
        expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);
      }

      const itens = await agenda(usuario, SEG, dia(20));
      expect(ocorrencias(itens), contexto).toEqual(
        [0, 2, 4, 7, 9, 11, 14, 16, 18].map((n) => dia(n)),
      );
      // A hora nova vale em toda ocorrência que ficou na original.
      for (const item of itens.filter((i) => i.id === serie.id)) {
        expect(item.startTime, contexto).toBe("10:00");
      }
    }
  });
});

/* ------------------------------------ as duas últimas ocorrências de uma vez */

describe("série com fim que perde as duas últimas ocorrências ao mesmo tempo", () => {
  test("dois excluir-só-esta simultâneos nas duas últimas vivas apagam a linha, rodada após rodada", async () => {
    const usuario = await contaNoFuso("recorrentes-duas-ultimas", SP);
    for (let rodada = 0; rodada < 3; rodada += 1) {
      // Segundas de SEG a dia(14): três ocorrências, e a primeira já cancelada.
      const serie = await novoEvento(usuario, {
        ...AULA_DA_MANHA,
        title: `Inglês (rodada ${rodada})`,
        repeat: { days: [1], until: dia(14) },
      });
      await cancelar(usuario, serie.id, SEG);

      // As duas leem a série com as duas ainda vivas antes que qualquer uma
      // escreva: decidindo por essa leitura, nenhuma apagaria a linha.
      const espiao = leiturasJuntas(2);
      const respostas = await Promise.all([
        comEscopo(usuario, "DELETE", serie.id, escopoEsta(dia(7))),
        comEscopo(usuario, "DELETE", serie.id, escopoEsta(dia(14))),
      ]).finally(() => espiao.mockRestore());
      expect(
        respostas.map((r) => r.status),
        `rodada ${rodada}`,
      ).toEqual([204, 204]);
      expect(await prisma.event.count({ where: { id: serie.id } }), `rodada ${rodada}`).toBe(0);
    }
    expect(await agenda(usuario, SEG, dia(20))).toEqual([]);
  });
});

/* -------------------------------------------- seguintes que puxa o dia para trás */

describe("seguintes que leva a ocorrência para antes dela", () => {
  test("a quarta levada para a segunda anterior encerra a original na véspera da segunda, sem duplicar nada", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-atras", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);

    // A quarta dia(9), dali em diante, passa a começar na segunda dia(7).
    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(9)),
      { date: dia(7) },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const nova = body as EventItem;
    expect(nova.id).not.toBe(serie.id);
    expect(nova).toMatchObject({ date: dia(7), startTime: "08:00" });

    // A original termina no domingo, véspera da segunda, não na terça.
    expect((await linhaGravada(serie.id)).repeatUntil).toBe(dia(6));

    const itens = await agenda(usuario, SEG, dia(13));
    expect(itens.map((item) => [item.id, item.occurrenceDate])).toEqual([
      [serie.id, dia(0)],
      [serie.id, dia(2)],
      [serie.id, dia(4)],
      [nova.id, dia(7)],
      [nova.id, dia(9)],
      [nova.id, dia(11)],
    ]);
  });

  test("levada para um dia cancelado na original, a ocorrência aparece nele; os cancelamentos depois dele seguem para a nova", async () => {
    const usuario = await contaNoFuso("recorrentes-seguintes-dia-cancelado", SP);
    const serie = await novoEvento(usuario, AULA_DA_MANHA);
    // A segunda dia(7) é o destino; a sexta dia(11), um cancelamento depois dele.
    for (const cancelado of [dia(7), dia(11)]) await cancelar(usuario, serie.id, cancelado);

    const { status, body } = await comEscopo(
      usuario,
      "PATCH",
      serie.id,
      escopoSeguintes(dia(9)),
      { date: dia(7) },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    const nova = body as EventItem;
    // O dia pedido é o da resposta: a série nova não nasce sem a primeira.
    expect(nova).toMatchObject({ date: dia(7), occurrenceDate: dia(7), startTime: "08:00" });
    expect((await linhaGravada(nova.id)).exdates).toEqual([dia(11)]);
    expect((await linhaGravada(serie.id)).repeatUntil).toBe(dia(6));

    expect(
      (await agenda(usuario, dia(7), dia(11))).map((item) => [item.id, item.occurrenceDate]),
    ).toEqual([
      [nova.id, dia(7)],
      [nova.id, dia(9)],
    ]);
  });

  for (const [rotulo, destino] of [
    ["para o início da série", SEG],
    ["para antes do início da série", dia(-3)],
  ] as const) {
    test(`levar a ocorrência ${rotulo} é todas: o mesmo id, nenhuma linha nova`, async () => {
      const usuario = await contaNoFuso("recorrentes-seguintes-inicio", SP);
      const serie = await novoEvento(usuario, AULA_DA_MANHA);

      const { status, body } = await comEscopo(
        usuario,
        "PATCH",
        serie.id,
        escopoSeguintes(dia(9)),
        { date: destino },
      );
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ id: serie.id, date: destino, recurrence: { until: null } });
      expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);

      const itens = await agenda(usuario, dia(-7), dia(13));
      expect(new Set(itens.map((item) => item.id))).toEqual(new Set([serie.id]));
      expect(ocorrencias(itens)).toEqual(
        [...(destino < SEG ? [-3] : []), 0, 2, 4, 7, 9, 11].map((n) => dia(n)),
      );
    });
  }
});

/* --------------------------------------------------- a série lida pelo id */

describe("GET /events/:id de série com a primeira ocorrência cancelada", () => {
  test("vem a primeira viva, com o dia e a hora dela — e esse dia é o que PATCH e DELETE aceitam", async () => {
    const usuario = await contaNoFuso("recorrentes-primeira-viva", NOVA_YORK);
    // Sexta, 01/11/2030, ainda em horário de verão; a próxima viva é a segunda
    // 04/11, já depois da virada: 08:00 local é outro instante UTC.
    const serie = await novoEvento(usuario, {
      title: "Daily de sexta e segunda",
      date: "2030-11-01",
      startTime: "08:00",
      endTime: "08:30",
      repeat: { days: [1, 5] },
    });
    expect(serie.startsAt).toBe("2030-11-01T12:00:00.000Z");
    await cancelar(usuario, serie.id, "2030-11-01");

    const { status, body } = await api(usuario, "GET", `/events/${serie.id}`);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      id: serie.id,
      date: "2030-11-04",
      occurrenceDate: "2030-11-04",
      startTime: "08:00",
      endTime: "08:30",
      startsAt: "2030-11-04T13:00:00.000Z",
      endsAt: "2030-11-04T13:30:00.000Z",
    });

    const lida = body as EventItem;
    const r = await comEscopo(usuario, "DELETE", serie.id, escopoEsta(lida.occurrenceDate));
    expect(r.status).toBe(204);
  });

  test("série sem nenhuma ocorrência viva é 404, igual a um id que não existe", async () => {
    const usuario = await contaNoFuso("recorrentes-sem-viva", SP);
    const serie = await novoEvento(usuario, {
      ...AULA_DA_MANHA,
      repeat: { days: [1], until: dia(7) },
    });
    // Pelo banco: a API apaga a série que esvazia, e o que se prova é a leitura.
    await prisma.event.update({
      where: { id: serie.id },
      data: { exdates: [deDia(SEG), deDia(dia(7))] },
    });

    const vazia = await api(usuario, "GET", `/events/${serie.id}`);
    const inexistente = await api(usuario, "GET", `/events/${crypto.randomUUID()}`);
    expect(vazia.status).toBe(404);
    expect(codigo(vazia.body)).toBe("NOT_FOUND");
    expect(vazia.body).toEqual(inexistente.body);
  });
});

/* ------------------------------------------ PATCH todas só com a hora */

/// A duração gravada da série, em minutos — a da primeira ocorrência.
async function duracaoGravada(id: string): Promise<number> {
  const { startsAt, endsAt } = await prisma.event.findUniqueOrThrow({ where: { id } });
  return (endsAt.getTime() - startsAt.getTime()) / 60_000;
}

/** Toda segunda, das 08:00 às 08:00 do dia seguinte: o teto de 24 h da série. */
const PLANTAO_DE_24H = {
  title: "Plantão de 24 h",
  date: SEG,
  startTime: "08:00",
  endDate: dia(1),
  endTime: "08:00",
  repeat: { days: [1] },
};

describe("PATCH todas só com a hora: o dia do fim se infere como na criação", () => {
  test("a série das 22:00 às 23:00 levada a terminar à 01:00 atravessa a meia-noite", async () => {
    const usuario = await contaNoFuso("recorrentes-hora-meia-noite", SP);
    const serie = await novoEvento(usuario, {
      title: "Plantão noturno",
      date: SEG,
      startTime: "22:00",
      endTime: "23:00",
      repeat: { days: [1] },
    });

    const { status, body } = await api(usuario, "PATCH", `/events/${serie.id}`, {
      startTime: "22:00",
      endTime: "01:00",
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ date: SEG, endDate: dia(1), startTime: "22:00", endTime: "01:00" });
    expect(await duracaoGravada(serie.id)).toBe(180);
    // A ocorrência da segunda semana aparece na terça, só ela.
    expect(
      (await agenda(usuario, dia(8), dia(8))).map((item) => [item.occurrenceDate, item.endDate]),
    ).toEqual([[dia(7), dia(8)]]);
  });

  for (const [rotulo, corpo, esperado] of [
    [
      "só o início mantém as 24 h",
      { startTime: "09:00" },
      { endDate: dia(1), endTime: "09:00", minutos: 1440 },
    ],
    [
      "início e fim de manhã viram uma hora no mesmo dia",
      { startTime: "09:00", endTime: "10:00" },
      { endDate: SEG, endTime: "10:00", minutos: 60 },
    ],
    [
      "fim igual ao início, sem endDate, segue de 24 h",
      { startTime: "09:00", endTime: "09:00" },
      { endDate: dia(1), endTime: "09:00", minutos: 1440 },
    ],
  ] as const) {
    test(`série de exatas 24 h: ${rotulo}`, async () => {
      const usuario = await contaNoFuso("recorrentes-hora-24h", SP);
      const serie = await novoEvento(usuario, PLANTAO_DE_24H);
      expect(await duracaoGravada(serie.id)).toBe(1440);

      const { status, body } = await api(usuario, "PATCH", `/events/${serie.id}`, corpo);
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({
        id: serie.id,
        date: SEG,
        startTime: "09:00",
        endDate: esperado.endDate,
        endTime: esperado.endTime,
        recurrence: { days: [1], until: null },
      });
      expect(await duracaoGravada(serie.id)).toBe(esperado.minutos);
    });
  }

  test("fim igual ao início com endDate nulo é recusado, com a mesma frase da criação", async () => {
    const usuario = await contaNoFuso("recorrentes-hora-nula", SP);
    const serie = await novoEvento(usuario, PLANTAO_DE_24H);
    await envelhecer(serie.id);
    const antes = await linhaGravada(serie.id);

    const editado = await api(usuario, "PATCH", `/events/${serie.id}`, {
      startTime: "09:00",
      endTime: "09:00",
      endDate: null,
    });
    const criado = await api(usuario, "POST", "/events", {
      title: "Plantão de zero hora",
      date: SEG,
      startTime: "09:00",
      endTime: "09:00",
      repeat: { days: [1] },
    });

    expect(editado.status, JSON.stringify(editado.body)).toBe(422);
    expect(criado.status, JSON.stringify(criado.body)).toBe(422);
    expect(codigo(editado.body)).toBe("VALIDATION_ERROR");
    // A criação recusa pelo schema, com a queixa no campo; o PATCH, pelo
    // service, com a mesma frase como mensagem (o 422 tem uma só).
    expect(mensagem(editado.body)).toBe("O fim precisa ser depois do início");
    expect((criado.body as ApiErrorBody).error?.issues).toContainEqual({
      path: "endTime",
      message: "O fim precisa ser depois do início",
    });
    expect(await linhaGravada(serie.id)).toEqual(antes);
    expect(await prisma.event.count({ where: { userId: usuario.id } })).toBe(1);
  });

  test("regra nova que só cairia em dias cancelados é recusada, e a série fica como estava", async () => {
    const usuario = await contaNoFuso("recorrentes-regra-cancelada", SP);
    const serie = await novoEvento(usuario, {
      ...AULA_DA_MANHA,
      repeat: { days: [1, 3], until: dia(9) },
    });
    // As duas segundas da série canceladas; as quartas seguem vivas.
    for (const cancelado of [SEG, dia(7)]) await cancelar(usuario, serie.id, cancelado);
    await envelhecer(serie.id);
    const antes = await linhaGravada(serie.id);

    const { status, body } = await api(usuario, "PATCH", `/events/${serie.id}`, {
      repeat: { days: [1], until: dia(9) },
    });
    expect(status, JSON.stringify(body)).toBe(422);
    expect(codigo(body)).toBe("VALIDATION_ERROR");
    expect(mensagem(body)).toBe("Todas as ocorrências dessa repetição estão canceladas");
    expect(await linhaGravada(serie.id)).toEqual(antes);
    expect(ocorrencias(await agenda(usuario, SEG, dia(13)))).toEqual([dia(2), dia(9)]);
  });
});

/* ------------------------------------------------------- funções puras */

describe("expansão pura da série (sem banco)", () => {
  const inicio = instanteLocal(SEG, "08:00", SP);
  const todoDia: SerieDoEvento = {
    allDay: false,
    startsAt: inicio,
    endsAt: instanteLocal(SEG, "09:00", SP),
    recurrence: { days: [0, 1, 2, 3, 4, 5, 6], until: null },
    exdates: [],
  };

  test("o período sem limite corta no teto de ocorrências, a partir da primeira", () => {
    const achadas = ocorrenciasNoPeriodo(todoDia, SEG, somarDias(SEG, 1000), SP);
    expect(achadas).toHaveLength(MAX_OCORRENCIAS_POR_CONSULTA);
    expect(achadas[0]?.occurrenceDate).toBe(SEG);
    expect(achadas.at(-1)?.occurrenceDate).toBe(somarDias(SEG, MAX_OCORRENCIAS_POR_CONSULTA - 1));
  });

  test("dia cancelado não aparece no período nem como ocorrência do dia", () => {
    const comCancelados = { ...todoDia, exdates: [dia(1), dia(3)] };
    const achadas = ocorrenciasNoPeriodo(comCancelados, SEG, dia(4), SP);
    expect(achadas.map((o) => o.occurrenceDate)).toEqual([dia(0), dia(2), dia(4)]);
    expect(ocorrenciaDoDia(comCancelados, dia(1), SP)).toBeNull();
    expect(ocorrenciaDoDia(comCancelados, dia(2), SP)?.occurrenceDate).toBe(dia(2));
  });

  test("período de um dia traz a ocorrência daquele dia, e só ela", () => {
    const achadas = ocorrenciasNoPeriodo(todoDia, dia(2), dia(2), SP);
    expect(achadas).toHaveLength(1);
    expect(achadas[0]).toMatchObject({
      occurrenceDate: dia(2),
      date: dia(2),
      startTime: "08:00",
      endTime: "09:00",
      startsAt: instanteLocal(dia(2), "08:00", SP),
    });
    // Num dia fora da regra, nada.
    const segundas = { ...todoDia, recurrence: { days: [1], until: null } };
    expect(ocorrenciasNoPeriodo(segundas, dia(2), dia(2), SP)).toEqual([]);
  });

  test("a primeira ocorrência é a gravada ao milissegundo", () => {
    const primeira = ocorrenciaDoDia(todoDia, SEG, SP);
    expect(primeira?.startsAt).toBe(todoDia.startsAt);
    expect(primeira?.endsAt).toBe(todoDia.endsAt);
  });

  test("antes do início, depois do fim e fora dos dias não há ocorrência; o último dia é inclusivo", () => {
    const serie = { ...todoDia, recurrence: { days: [1, 3], until: dia(9) } };
    expect(ocorrenciaDoDia(serie, dia(-7), SP)).toBeNull();
    expect(ocorrenciaDoDia(serie, dia(1), SP)).toBeNull();
    expect(ocorrenciaDoDia(serie, dia(14), SP)).toBeNull();
    expect(ocorrenciaDoDia(serie, dia(9), SP)?.occurrenceDate).toBe(dia(9));
    expect(ocorrenciasNoPeriodo(serie, dia(-14), dia(-1), SP)).toEqual([]);
    expect(ocorrenciasNoPeriodo(serie, dia(10), dia(30), SP)).toEqual([]);
  });

  test("a ocorrência que atravessa a meia-noite entra no período do dia seguinte; a que só encosta nele, não", () => {
    const plantao: SerieDoEvento = {
      allDay: false,
      startsAt: instanteLocal(SEG, "23:00", SP),
      endsAt: instanteLocal(dia(1), "01:00", SP),
      recurrence: { days: [1], until: null },
      exdates: [],
    };
    expect(ocorrenciasNoPeriodo(plantao, dia(8), dia(8), SP).map((o) => o.occurrenceDate)).toEqual([
      dia(7),
    ]);
    expect(ocorrenciasNoPeriodo(plantao, dia(6), dia(6), SP)).toEqual([]);

    // Termina às 00:00 em ponto: a sobreposição é semiaberta.
    const ateMeiaNoite = { ...plantao, endsAt: instanteLocal(dia(1), "00:00", SP) };
    expect(ocorrenciasNoPeriodo(ateMeiaNoite, dia(8), dia(8), SP)).toEqual([]);
  });

  test("restaOcorrencia: sem fim sempre resta; com fim e tudo cancelado, não", () => {
    const comFim = { ...todoDia, recurrence: { days: [1, 3], until: dia(2) } };
    expect(restaOcorrencia(comFim, SP)).toBe(true);
    expect(restaOcorrencia({ ...comFim, exdates: [dia(0)] }, SP)).toBe(true);
    expect(restaOcorrencia({ ...comFim, exdates: [dia(0), dia(2)] }, SP)).toBe(false);
    expect(restaOcorrencia({ ...todoDia, exdates: [dia(0), dia(1)] }, SP)).toBe(true);
  });
});

describe("resolverSerie (sem banco)", () => {
  const MANHA: PedidoDeHorario = { allDay: false, date: SEG, startTime: "08:00", endTime: "09:00" };

  test("sem repetição devolve o horário e regra nula", () => {
    expect(resolverSerie(MANHA, null)).toEqual({
      horario: { ...MANHA, endDate: SEG },
      recurrence: null,
      problemas: [],
    });
  });

  test("leva o horário para o primeiro dia escolhido, com o fim junto, e ordena os dias", () => {
    const { horario, recurrence, problemas } = resolverSerie(
      { allDay: false, date: dia(3), startTime: "23:00", endTime: "01:00" },
      { days: [3, 1] },
    );
    expect(problemas).toEqual([]);
    expect(horario).toEqual({
      allDay: false,
      date: dia(7),
      endDate: dia(8),
      startTime: "23:00",
      endTime: "01:00",
    });
    expect(recurrence).toEqual({ days: [1, 3], until: null });
    expect(primeiroDiaDaSerie(dia(3), [3, 1])).toBe(dia(7));
    expect(primeiroDiaDaSerie(SEG, [])).toBeNull();
  });

  test("cada recusa aponta o campo certo", () => {
    const caminho = (repeticao: PedidoDeRepeticao, pedido: PedidoDeHorario = MANHA) =>
      resolverSerie(pedido, repeticao).problemas.map((p) => p.path);
    expect(caminho({ days: [1], until: dia(-1) })).toEqual(["repeat.until"]);
    expect(caminho({ days: [5], until: dia(3) })).toEqual(["repeat.until"]);
    expect(caminho({ days: [1] }, { ...MANHA, allDay: true, endDate: dia(1) })).toEqual(["repeat"]);
    expect(caminho({ days: [1] }, { ...MANHA, endDate: dia(1), endTime: "08:01" })).toEqual([
      "repeat",
    ]);
    // Até o próprio dia de início é um fim válido, se for dia da regra.
    expect(caminho({ days: [1], until: SEG })).toEqual([]);
  });

  test("dias malformados não geram queixa própria: quem acusa é o schema do campo", () => {
    for (const days of [[], [1, 1], [7], [-1], [1.5]]) {
      expect(resolverSerie(MANHA, { days })).toEqual({
        horario: null,
        recurrence: null,
        problemas: [],
      });
    }
  });
});
