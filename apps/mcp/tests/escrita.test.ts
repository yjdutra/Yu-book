import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escritaPermitida } from "../src/autorizacao.js";
import { abrirCliente, identidade, type ToolAnunciada } from "./arnes.js";

/**
 * A segunda camada da trava de escrita, provada pela superfície do protocolo.
 *
 * **A lista de tools de escrita não está escrita aqui, e é esse o ponto.** O
 * furo que esta etapa fecha é *alguém esquecer*: uma quinta tool registrada no
 * módulo errado, ou sem o invólucro. Um teste com os quatro nomes à mão herdaria
 * o mesmo furo — a quinta precisaria que alguém lembrasse de duas coisas.
 *
 * Então a lista é derivada: sobe o servidor com e sem escrita, e subtrai os
 * `tools/list`. O que só aparece na primeira **é** o conjunto de escrita, hoje e
 * no dia em que a quinta entrar.
 */

const SO_LEITURA = identidade(["yubook:read"]);
const COMPLETO = identidade(["yubook:read", "yubook:write"]);

/** Toda chamada de API que escapasse do guarda apareceria aqui. */
const chamadas: string[] = [];

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    chamadas.push(String(url));
    // Lista vazia, e não `{}`: as tools de leitura formatam o que recebem, e um
    // objeto no lugar de um array as faz falhar por motivo errado — o teste
    // acusaria a trava quando o defeito era do arnês.
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** As tools que só existem quando a escrita está ligada — derivadas, não listadas. */
async function toolsDeEscrita(): Promise<ToolAnunciada[]> {
  const com = await abrirCliente({ escrita: true }, COMPLETO);
  const sem = await abrirCliente({ escrita: false }, COMPLETO);
  try {
    const todas = await com.listarTools();
    const soLeitura = new Set((await sem.listarTools()).map((t) => t.name));
    return todas.filter((t) => !soLeitura.has(t.name));
  } finally {
    await com.encerrar();
    await sem.encerrar();
  }
}

/**
 * Argumentos mínimos que passam pelo schema de uma tool, montados a partir do
 * que ela mesma anuncia.
 *
 * Existem porque **o SDK valida os argumentos antes de chamar o handler** — e
 * portanto antes do guarda. Chamar com `{}` devolveria erro de validação, não a
 * recusa de autorização, e o teste estaria provando a coisa errada.
 *
 * Derivado do `inputSchema`, e não escrito à mão, pelo mesmo motivo da lista: um
 * campo obrigatório novo entra sozinho.
 */
function argumentosMinimos(tool: ToolAnunciada): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const nome of tool.inputSchema.required ?? []) {
    const campo = tool.inputSchema.properties?.[nome];
    if (campo?.enum?.length) args[nome] = campo.enum[0];
    else if (campo?.type === "integer" || campo?.type === "number") args[nome] = 0;
    else if (campo?.type === "boolean") args[nome] = false;
    else if (campo?.type === "array") args[nome] = [];
    else args[nome] = campo?.format === "uuid" ? randomUUID() : "x";
  }
  return args;
}

describe("a trava de escrita, no ponto da chamada", () => {
  it("o conjunto derivado não é vazio", async () => {
    // A asserção que impede este arquivo de virar decorativo. Sem ela, o teste
    // de baixo passaria alegremente num servidor que não registra escrita
    // nenhuma — iterar sobre lista vazia não falha.
    const escrita = await toolsDeEscrita();
    expect(escrita.length).toBeGreaterThan(0);
    // E o registro continua sendo por módulo: a leitura não pode ter vazado
    // para dentro do conjunto de escrita.
    expect(escrita.map((t) => t.name)).not.toContain("search_notes");
  });

  it("toda tool de escrita recusa um token sem yubook:write, sem tocar na API", async () => {
    const escrita = await toolsDeEscrita();
    const cliente = await abrirCliente({ escrita: true }, SO_LEITURA);

    try {
      for (const tool of escrita) {
        const resultado = await cliente.chamarTool(tool.name, argumentosMinimos(tool));
        expect(resultado.isError, `${tool.name} não recusou`).toBe(true);
        const texto = JSON.stringify(resultado.content);
        expect(texto, `${tool.name} não disse que nada mudou`).toContain("Nada foi alterado");
      }
    } finally {
      await cliente.encerrar();
    }

    // A prova que importa: nenhuma escrita escapou para a API.
    expect(chamadas).toHaveLength(0);
  });

  it("nenhuma tool da superfície de leitura exige escrita", async () => {
    // A OUTRA METADE, e ela existe porque a de cima tem uma cegueira: o conjunto
    // de escrita é definido pela **diferença** entre as duas superfícies. Uma
    // tool de escrita registrada sem condição aparece nas duas, é subtraída, e
    // sai do conjunto — o teste acima passaria sem notar.
    //
    // Aqui a pergunta é a inversa: montado sem escrita, o servidor não pode
    // anunciar nenhuma tool que recuse por falta de autorização. Se
    // `create_card` vazar para o módulo de leitura, ele aparece nesta lista e
    // recusa — e o portão pega.
    //
    // A asserção é sobre o **motivo** da recusa, não sobre sucesso: o `fetch`
    // substituído devolve `[]` para tudo, então uma tool de leitura pode falhar
    // ao formatar. Isso é ruído do arnês; falta de autorização não é.
    const cliente = await abrirCliente({ escrita: false }, SO_LEITURA);
    try {
      for (const tool of await cliente.listarTools()) {
        const resultado = await cliente.chamarTool(tool.name, argumentosMinimos(tool));
        expect(
          JSON.stringify(resultado.content),
          `${tool.name} está na superfície de leitura e recusou por autorização`,
        ).not.toContain("Nada foi alterado");
      }
    } finally {
      await cliente.encerrar();
    }
  });

  it("uma tool de leitura funciona com o mesmo token de leitura", async () => {
    // Sem isto, um guarda que recusasse **tudo** passaria no teste acima. É a
    // outra metade da asserção: a trava tem que estar no lugar certo, não em
    // todo lugar.
    const cliente = await abrirCliente({ escrita: true }, SO_LEITURA);
    try {
      const resultado = await cliente.chamarTool("list_boards");
      expect(resultado.isError).toBeFalsy();
      expect(chamadas.some((u) => u.includes("/boards"))).toBe(true);
    } finally {
      await cliente.encerrar();
    }
  });
});

describe("escritaPermitida", () => {
  it("exige o escopo", () => {
    expect(escritaPermitida(["yubook:read"])).toBe(false);
    expect(escritaPermitida(["yubook:read", "yubook:write"])).toBe(true);
  });

  it("o desligamento global vence o escopo concedido", () => {
    vi.stubEnv("MCP_ESCRITA_HABILITADA", "0");
    // `env.ts` valida na importação, então o valor já foi lido: reimportar o
    // módulo é o que faz a mudança valer.
    vi.resetModules();
    return import("../src/autorizacao.js").then((mod) => {
      expect(mod.escritaPermitida(["yubook:read", "yubook:write"])).toBe(false);
      vi.unstubAllEnvs();
    });
  });
});
