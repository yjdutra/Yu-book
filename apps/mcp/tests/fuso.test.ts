import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diaDoPrazo, diaParaPrazo, FUSO_PADRAO } from "@yu-book/shared";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * O dia de um prazo, e de quem é o fuso que decide.
 *
 * **Esta suíte existe por causa de um defeito que viveu semanas sem sintoma na
 * máquina de quem o escreveu.** Os formatadores usavam o fuso do *processo*:
 * em UTC−3 isso acertava por acaso, e no serviço hospedado, que roda em UTC,
 * relatava **todo prazo um dia à frente**, calado. O front grava o prazo às
 * 23:59:59 locais, o que em UTC−3 é 02:59 do dia seguinte.
 *
 * Por isso o fuso de teste é **Asia/Tokyo**, e não o do operador: um teste
 * escrito em `America/Sao_Paulo` passaria na máquina dele com o código velho e
 * com o novo, provando nada. Tóquio é UTC+9 — a data escolhida cai num dia em
 * Tóquio e no dia anterior tanto em UTC quanto em São Paulo, então só a leitura
 * correta do fuso **do usuário** produz a resposta esperada, em qualquer
 * máquina que rode a suíte.
 */

const TOKYO = "Asia/Tokyo";
/// 2026-03-09 20:00 UTC = 2026-03-10 05:00 em Tóquio, e 2026-03-09 17:00 em
/// São Paulo. Os três nomes de dia são diferentes de propósito.
const INSTANTE = "2026-03-09T20:00:00.000Z";

const BOARD = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Quadro com prazo",
  workspaceName: "Estudos",
  archivedCount: 0,
  columns: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Fazendo",
      wipLimit: null,
      cards: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Entregar",
          dueDate: INSTANTE,
          priority: "media",
          checklistDone: 0,
          checklistTotal: 0,
          tags: [],
          note: null,
        },
      ],
    },
  ],
};

describe("as primitivas de dia, em packages/shared", () => {
  it("o dia do prazo sai do fuso informado, não do fuso do processo", () => {
    expect(diaDoPrazo(INSTANTE, TOKYO)).toBe("2026-03-10");
    expect(diaDoPrazo(INSTANTE, "America/Sao_Paulo")).toBe("2026-03-09");
    expect(diaDoPrazo(INSTANTE, "UTC")).toBe("2026-03-09");
  });

  it("ida e volta fecham: o dia gravado é o dia lido, no mesmo fuso", () => {
    // `diaParaPrazo` grava o fim do dia **local**, como o front faz. Sem o
    // fuso, quem vive em UTC+5 teria o prazo caindo no dia seguinte.
    for (const fuso of [TOKYO, "America/Sao_Paulo", "UTC", "Pacific/Kiritimati"]) {
      const iso = diaParaPrazo("2026-03-10", fuso);
      expect(diaDoPrazo(iso, fuso)).toBe("2026-03-10");
    }
  });

  it("data que não existe é recusada, mesmo passando pelo formato", () => {
    expect(() => diaParaPrazo("2026-13-45", TOKYO)).toThrow(/não é uma data existente/);
    expect(() => diaParaPrazo("2026-02-30", TOKYO)).toThrow(/não é uma data existente/);
  });
});

describe("o servidor MCP e o fuso de quem chamou", () => {
  const chamadas: string[] = [];

  beforeEach(() => {
    chamadas.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      chamadas.push(String(url));
      const corpo = String(url).includes("/ai/settings")
        ? { timezone: TOKYO, dailyCapMicros: 0, allowTraining: false, favorites: [], taskModels: {} }
        : BOARD;
      return new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get_board relata o prazo no dia do usuário", async () => {
    const cliente = await abrirCliente({ escrita: false }, identidade(["yubook:read"]));
    try {
      const resultado = await cliente.chamarTool("get_board", { id: BOARD.id });
      const texto = (resultado.content as { text: string }[])[0]?.text ?? "";

      // A asserção que morde: com o fuso do processo isto seria 2026-03-09
      // numa máquina em UTC−3 e no serviço hospedado em UTC.
      expect(texto).toContain("prazo 2026-03-10");
      // E o fuso foi de fato perguntado à API, não adivinhado.
      expect(chamadas.some((u) => u.includes("/ai/settings"))).toBe(true);

      // INV-40, de carona e de propósito: o id da coluna é o único lugar do
      // servidor onde ele aparece, e sem ele `create_card` e `move_card` ficam
      // inalcançáveis. A invariante apontava para um arquivo que esta entrega
      // apagou, e até aqui nenhum teste executava esta formatação de verdade.
      expect(texto).toContain(`  id: ${BOARD.columns[0]?.id}`);
    } finally {
      await cliente.encerrar();
    }
  });

  it("na escrita, o fuso não recua em silêncio: create_card com prazo falha alto", async () => {
    // A assimetria é decidida, não acidental. Numa leitura, recuar produz no
    // máximo um rótulo com o dia de outro fuso. Em `create_card` o fuso vira o
    // **instante gravado no banco** — recuar ali deixaria uma data errada num
    // lugar que não morre junto com a conversa.
    vi.stubGlobal("fetch", async (url: string) => {
      chamadas.push(String(url));
      if (String(url).includes("/ai/settings")) {
        return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const cliente = await abrirCliente({ escrita: true }, identidade(["yubook:read", "yubook:write"]));
    try {
      const comPrazo = await cliente.chamarTool("create_card", {
        columnId: BOARD.columns[0]?.id ?? "",
        title: "Com prazo",
        dueDate: "2026-03-10",
      });
      expect(comPrazo.isError).toBe(true);
      // E nenhum card foi criado: a recusa aconteceu antes do POST.
      expect(chamadas.some((u) => u.includes("/cards"))).toBe(false);
    } finally {
      await cliente.encerrar();
    }
  });

  it("API fora do ar para os ajustes recua para o padrão, nunca para o fuso do processo", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      chamadas.push(String(url));
      if (String(url).includes("/ai/settings")) {
        return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(BOARD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const cliente = await abrirCliente({ escrita: false }, identidade(["yubook:read"]));
    try {
      const resultado = await cliente.chamarTool("get_board", { id: BOARD.id });
      const texto = (resultado.content as { text: string }[])[0]?.text ?? "";

      // O quadro continua saindo — falhar ao ler a preferência não pode
      // derrubar a leitura do quadro.
      expect(texto).toContain("Quadro com prazo");
      expect(texto).toContain(`prazo ${diaDoPrazo(INSTANTE, FUSO_PADRAO)}`);
    } finally {
      await cliente.encerrar();
    }
  });
});
