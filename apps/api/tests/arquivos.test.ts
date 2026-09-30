import {
  FUSO_PADRAO,
  MAX_ARQUIVOS_CARD,
  MAX_BYTES_ARQUIVO,
  formatarBytes,
  formatarCard,
  formatarCardDetalhe,
} from "@yu-book/shared";
import type {
  BoardDetail,
  CardDetail,
  CardFilesResponse,
  CardFileWithUrl,
  CardSummary,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { env } from "../src/env.js";
import { configDoArmazem, urlDoObjeto } from "../src/lib/armazem.js";
import {
  detectarTipo,
  nomeCoerente,
  nomeDoArquivo,
} from "../src/modules/arquivos/arquivos.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";
import {
  BUCKET_DE_TESTE,
  caminhoDaChave,
  fecharArmazem,
  pedidosDesde,
  PORTA_DO_ARMAZEM,
  subirArmazem,
} from "./armazem.js";
import type { DubleDoArmazem } from "./armazem.js";

/**
 * Anexos de card (frente de cards, Parte 2). O binário vai ao dublê do bucket
 * (`tests/armazem.ts`) e a linha ao banco; o que se confere é o que chegou a
 * cada um, e não o que a resposta diz.
 */

let app: FastifyInstance;
let armazem: DubleDoArmazem;
let dono: Usuario;
let intruso: Usuario;
let workspaceId: string;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  armazem = await subirArmazem();
  dono = await criarUsuario("anexos-dono");
  intruso = await criarUsuario("anexos-intruso");
  const workspace = await prisma.workspace.create({ data: { userId: dono.id, name: "Anexos" } });
  workspaceId = workspace.id;
});

afterAll(async () => {
  await app.close();
  await fecharArmazem(armazem);
  await limpar();
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ apoio */

const codigo = (body: unknown) => (body as { error?: { code?: string } }).error?.code;
const INEXISTENTE = "00000000-0000-4000-8000-000000000000";

/// A subida tem limite próprio de 20/min por IP; um IP por subida é o que
/// aconteceria com sessões diferentes (ver `apoio.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.8.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

const ascii = (texto: string) => Array.from(texto, (c) => c.charCodeAt(0));
const bytes = (...partes: (number[] | string)[]) =>
  Uint8Array.from(partes.flatMap((p) => (typeof p === "string" ? ascii(p) : p)));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "\u0000\u0000\u0000\rIHDR-resto");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF");
const PDF = bytes("%PDF-1.7\n%resto do documento\n%%EOF\n");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], "[Content_Types].xml");
const EXE = bytes("MZ", [0x90, 0x00, 0x03, 0x00]);
const HTML = bytes("<!doctype html><script>alert(1)</script>");
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const texto = (t: string) => new TextEncoder().encode(t);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FRONTEIRA = "----fronteira-yubook-teste";

interface ParteDeArquivo {
  nome: string;
  conteudo: Uint8Array;
  /// O que o navegador declararia. A API ignora — o teste manda, às vezes, mentira.
  tipo?: string;
}

/** O corpo multipart montado à mão: `chamar` só fala JSON. */
function corpoMultipart(partes: ParteDeArquivo[]): Buffer {
  const pedacos: Buffer[] = [];
  for (const p of partes) {
    pedacos.push(
      Buffer.from(
        `--${FRONTEIRA}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${p.nome}"\r\n` +
          `Content-Type: ${p.tipo ?? "application/octet-stream"}\r\n\r\n`,
      ),
      Buffer.from(p.conteudo),
      Buffer.from("\r\n"),
    );
  }
  pedacos.push(Buffer.from(`--${FRONTEIRA}--\r\n`));
  return Buffer.concat(pedacos);
}

async function subir(
  quem: Usuario,
  cardId: string,
  partes: ParteDeArquivo | ParteDeArquivo[],
): Promise<{ status: number; body: unknown }> {
  const resposta = await app.inject({
    method: "POST",
    url: `/cards/${cardId}/files`,
    headers: {
      authorization: `Bearer ${quem.token}`,
      "content-type": `multipart/form-data; boundary=${FRONTEIRA}`,
    },
    payload: corpoMultipart(Array.isArray(partes) ? partes : [partes]),
    remoteAddress: proximoIp(),
  });
  return {
    status: resposta.statusCode,
    body: resposta.body ? (JSON.parse(resposta.body) as unknown) : null,
  };
}

async function novoBoard(nome: string, ws = workspaceId): Promise<BoardDetail> {
  const { status, body } = await chamar(app, {
    method: "POST",
    url: "/boards",
    token: dono.token,
    body: { name: nome, workspaceId: ws },
  });
  expect(status).toBe(201);
  return body as BoardDetail;
}

async function novoCard(columnId: string, title: string): Promise<CardDetail> {
  const { status, body } = await chamar(app, {
    method: "POST",
    url: "/cards",
    token: dono.token,
    body: { columnId, title },
  });
  expect(status).toBe(201);
  return body as CardDetail;
}

/** Um card num board novo, na primeira coluna. */
async function cardAvulso(title: string): Promise<CardDetail> {
  // O nome do board é único por workspace: o sufixo deixa o mesmo título repetir.
  const board = await novoBoard(`Board de ${title} ${crypto.randomUUID().slice(0, 8)}`);
  return novoCard(board.columns[0]?.id as string, title);
}

/** Sobe um PNG e devolve a chave gravada — a ponte entre a linha e o objeto. */
async function anexarPng(cardId: string, nome = "foto.png"): Promise<string> {
  const { status, body } = await subir(dono, cardId, { nome, conteudo: PNG });
  expect(status).toBe(201);
  const linha = await prisma.cardFile.findUniqueOrThrow({
    where: { id: (body as CardFileWithUrl).id },
    select: { key: true },
  });
  return linha.key;
}

const noBucket = (key: string) => armazem.objetos.has(caminhoDaChave(key));

/** Linhas de anexo sem objeto, para testar teto e texto sem pagar a subida. */
async function linhasDeAnexo(cardId: string, quantas: number, tamanho = 1024): Promise<void> {
  const base = Date.UTC(2026, 8, 30, 12, 0, 0);
  await prisma.cardFile.createMany({
    data: Array.from({ length: quantas }, (_, i) => ({
      cardId,
      key: `cards/${cardId}/semeado-${i}-${crypto.randomUUID()}`,
      name: `semeado-${String(i).padStart(2, "0")}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: tamanho,
      // Espaçados: a ordem da leitura é `createdAt`, e empate deixaria o
      // "os dez primeiros" do texto ao acaso.
      createdAt: new Date(base + i * 1000),
    })),
  });
}

/* ----------------------------------------------------- o que se aceita */

describe("subida de anexo", () => {
  test("imagem vai ao bucket para abrir na tela, com o tipo decidido pelos bytes", async () => {
    const card = await cardAvulso("Com foto");
    const marco = armazem.recebidas.length;

    // O navegador declara PDF; os bytes são PNG, e são eles que valem.
    const { status, body } = await subir(dono, card.id, {
      nome: "foto.png",
      conteudo: PNG,
      tipo: "application/pdf",
    });

    expect(status).toBe(201);
    const arquivo = body as CardFileWithUrl;
    expect(arquivo).toMatchObject({
      name: "foto.png",
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
      isImage: true,
    });

    const linha = await prisma.cardFile.findUniqueOrThrow({ where: { id: arquivo.id } });
    expect(linha).toMatchObject({ cardId: card.id, mimeType: "image/png", sizeBytes: PNG.byteLength });
    // A chave é do servidor: nada do nome do usuário entra nela.
    expect(linha.key).toMatch(new RegExp(`^cards/${card.id}/[0-9a-f-]{36}$`));

    const puts = pedidosDesde(armazem, marco, "PUT");
    expect(puts.map((p) => p.caminho)).toEqual([caminhoDaChave(linha.key)]);
    expect(String(puts[0]?.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=chave-de-teste\//);

    const objeto = armazem.objetos.get(caminhoDaChave(linha.key));
    // Byte a byte: o multipart não pode deixar o CRLF da fronteira no arquivo.
    expect(objeto?.corpo.equals(Buffer.from(PNG))).toBe(true);
    expect(objeto?.headers["content-type"]).toBe("image/png");
    expect(objeto?.headers["content-disposition"]).toBe(
      `inline; filename="foto.png"; filename*=UTF-8''foto.png`,
    );
  });

  test("PDF é gravado para baixar, com o nome acentuado nas duas formas do cabeçalho", async () => {
    const card = await cardAvulso("Com PDF");
    const { status, body } = await subir(dono, card.id, { nome: "relatório final.pdf", conteudo: PDF });

    expect(status).toBe(201);
    const arquivo = body as CardFileWithUrl;
    expect(arquivo).toMatchObject({
      name: "relatório final.pdf",
      mimeType: "application/pdf",
      isImage: false,
    });

    const linha = await prisma.cardFile.findUniqueOrThrow({ where: { id: arquivo.id } });
    expect(linha.name).toBe("relatório final.pdf");
    const objeto = armazem.objetos.get(caminhoDaChave(linha.key));
    expect(objeto?.headers["content-type"]).toBe("application/pdf");
    expect(objeto?.headers["content-disposition"]).toBe(
      `attachment; filename="relatorio final.pdf"; filename*=UTF-8''relat%C3%B3rio%20final.pdf`,
    );
  });

  test("documento do Office é zip por dentro, e a extensão decide qual", async () => {
    const card = await cardAvulso("Com docx");
    const { status, body } = await subir(dono, card.id, { nome: "proposta.docx", conteudo: ZIP });

    expect(status).toBe(201);
    expect((body as CardFileWithUrl).mimeType).toBe(DOCX);
    const linha = await prisma.cardFile.findUniqueOrThrow({
      where: { id: (body as CardFileWithUrl).id },
    });
    expect(armazem.objetos.get(caminhoDaChave(linha.key))?.headers["content-type"]).toBe(DOCX);
  });

  test("texto UTF-8 é aceito, e o charset vai só no objeto, não na linha", async () => {
    const card = await cardAvulso("Com texto");
    const conteudo = texto("anotações de reunião: ação, decisão\n");
    const { status, body } = await subir(dono, card.id, { nome: "ata.txt", conteudo });

    expect(status).toBe(201);
    const linha = await prisma.cardFile.findUniqueOrThrow({
      where: { id: (body as CardFileWithUrl).id },
    });
    expect(linha.mimeType).toBe("text/plain");
    const objeto = armazem.objetos.get(caminhoDaChave(linha.key));
    expect(objeto?.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(objeto?.headers["content-disposition"]).toMatch(/^attachment; /);
    expect(objeto?.corpo.equals(Buffer.from(conteudo))).toBe(true);
  });

  test("o nome com caminho chega só como nome, e o caminho não entra na chave", async () => {
    const card = await cardAvulso("Com caminho");
    const { status, body } = await subir(dono, card.id, { nome: "../../etc/foto.png", conteudo: PNG });

    expect(status).toBe(201);
    const linha = await prisma.cardFile.findUniqueOrThrow({
      where: { id: (body as CardFileWithUrl).id },
    });
    expect(linha.name).toBe("foto.png");
    expect(linha.key).not.toContain("..");
  });

  test("arquivo maior que o teto do corpo JSON (1 MiB) passa pela rota de anexo", async () => {
    const card = await cardAvulso("Com arquivo médio");
    const conteudo = new Uint8Array(2 * 1024 * 1024);
    conteudo.set(PNG);

    const { status, body } = await subir(dono, card.id, { nome: "grande.png", conteudo });

    expect(status).toBe(201);
    expect((body as CardFileWithUrl).sizeBytes).toBe(conteudo.byteLength);
  });

  test("arquivo com exatamente o teto de 25 MB é aceito", async () => {
    const card = await cardAvulso("No teto");
    const conteudo = new Uint8Array(MAX_BYTES_ARQUIVO);
    conteudo.set(PDF);

    const { status, body } = await subir(dono, card.id, { nome: "no-teto.pdf", conteudo });

    expect(status).toBe(201);
    const linha = await prisma.cardFile.findUniqueOrThrow({
      where: { id: (body as CardFileWithUrl).id },
    });
    expect(linha.sizeBytes).toBe(MAX_BYTES_ARQUIVO);
    expect(armazem.objetos.get(caminhoDaChave(linha.key))?.corpo.byteLength).toBe(MAX_BYTES_ARQUIVO);
    // Não precisa ficar na memória do dublê o resto da suíte.
    armazem.objetos.delete(caminhoDaChave(linha.key));
  });
});

/* ------------------------------------------------------ o que se recusa */

describe("recusa de anexo, sempre antes de gastar a subida", () => {
  async function recusaSemGravar(
    partes: ParteDeArquivo | ParteDeArquivo[],
    status: number,
    code: string,
  ): Promise<void> {
    const card = await cardAvulso(`Recusa ${code}`);
    const marco = armazem.recebidas.length;

    const resposta = await subir(dono, card.id, partes);

    expect(resposta.status).toBe(status);
    expect(codigo(resposta.body)).toBe(code);
    expect(pedidosDesde(armazem, marco)).toEqual([]);
    expect(await prisma.cardFile.count({ where: { cardId: card.id } })).toBe(0);
  }

  test("executável é recusado pelos bytes", async () => {
    await recusaSemGravar({ nome: "setup.exe", conteudo: EXE }, 415, "TIPO_NAO_PERMITIDO");
  });

  test("HTML é recusado — rodaria script aberto pela URL do bucket", async () => {
    await recusaSemGravar(
      { nome: "pagina.html", conteudo: HTML, tipo: "text/html" },
      415,
      "TIPO_NAO_PERMITIDO",
    );
  });

  test("SVG é recusado mesmo declarado como imagem", async () => {
    await recusaSemGravar(
      { nome: "icone.svg", conteudo: SVG, tipo: "image/svg+xml" },
      415,
      "TIPO_NAO_PERMITIDO",
    );
  });

  test("texto com extensão de imagem é recusado: a extensão não fala pelos bytes", async () => {
    await recusaSemGravar(
      { nome: "foto.png", conteudo: texto("isto não é um png"), tipo: "image/png" },
      415,
      "TIPO_NAO_PERMITIDO",
    );
  });

  test("arquivo acima de 25 MB é recusado com código próprio", async () => {
    const conteudo = new Uint8Array(MAX_BYTES_ARQUIVO + 1);
    conteudo.set(PNG);
    await recusaSemGravar({ nome: "enorme.png", conteudo }, 413, "ARQUIVO_GRANDE");
  });

  test("requisição sem arquivo é recusada", async () => {
    await recusaSemGravar([], 422, "VALIDATION_ERROR");
  });

  test("o card aceita 20 anexos, e o 21º é recusado antes de subir", async () => {
    const card = await cardAvulso("Cheio");
    await linhasDeAnexo(card.id, MAX_ARQUIVOS_CARD - 1);

    const vigesimo = await subir(dono, card.id, { nome: "vigesimo.png", conteudo: PNG });
    expect(vigesimo.status).toBe(201);

    const marco = armazem.recebidas.length;
    const excedente = await subir(dono, card.id, { nome: "excedente.png", conteudo: PNG });

    expect(excedente.status).toBe(422);
    expect(codigo(excedente.body)).toBe("VALIDATION_ERROR");
    expect(pedidosDesde(armazem, marco)).toEqual([]);
    expect(await prisma.cardFile.count({ where: { cardId: card.id } })).toBe(MAX_ARQUIVOS_CARD);
  });

  test("bucket que recusa o objeto não deixa linha no banco", async () => {
    const card = await cardAvulso("Bucket recusa");
    armazem.falhar.PUT = 500;
    try {
      const { status, body } = await subir(dono, card.id, { nome: "foto.png", conteudo: PNG });
      expect(status).toBe(503);
      expect(codigo(body)).toBe("ARMAZENAMENTO_INDISPONIVEL");
      // O XML de erro do bucket é de terceiro: não chega à tela.
      expect(JSON.stringify(body)).not.toContain("InternalError");
    } finally {
      delete armazem.falhar.PUT;
    }
    expect(await prisma.cardFile.count({ where: { cardId: card.id } })).toBe(0);
  });

  test("sem token, a rota de anexo não atende", async () => {
    const card = await cardAvulso("Sem token");
    const resposta = await app.inject({
      method: "POST",
      url: `/cards/${card.id}/files`,
      headers: { "content-type": `multipart/form-data; boundary=${FRONTEIRA}` },
      payload: corpoMultipart([{ nome: "foto.png", conteudo: PNG }]),
      remoteAddress: proximoIp(),
    });
    expect(resposta.statusCode).toBe(401);
    expect(await prisma.cardFile.count({ where: { cardId: card.id } })).toBe(0);
  });
});

/* ------------------------------------------------------------------ posse */

describe("posse pela cadeia do card", () => {
  // INV-02 / INV-03
  test("card de outra conta responde 404 igual ao inexistente, nas três rotas, sem gravar", async () => {
    const card = await cardAvulso("Do dono");
    await anexarPng(card.id);
    const arquivo = await prisma.cardFile.findFirstOrThrow({ where: { cardId: card.id } });
    const marco = armazem.recebidas.length;

    const listaAlheia = await chamar(app, {
      method: "GET",
      url: `/cards/${card.id}/files`,
      token: intruso.token,
    });
    const listaInexistente = await chamar(app, {
      method: "GET",
      url: `/cards/${INEXISTENTE}/files`,
      token: intruso.token,
    });
    const subidaAlheia = await subir(intruso, card.id, { nome: "intruso.png", conteudo: PNG });
    const subidaInexistente = await subir(intruso, INEXISTENTE, { nome: "x.png", conteudo: PNG });
    const exclusaoAlheia = await chamar(app, {
      method: "DELETE",
      url: `/cards/${card.id}/files/${arquivo.id}`,
      token: intruso.token,
    });

    for (const r of [listaAlheia, listaInexistente, subidaAlheia, subidaInexistente, exclusaoAlheia]) {
      expect(r.status).toBe(404);
      expect(codigo(r.body)).toBe("NOT_FOUND");
    }
    // Mesma resposta: nada distingue "existe, mas não é seu" de "não existe".
    expect(listaAlheia.body).toEqual(listaInexistente.body);
    expect(subidaAlheia.body).toEqual(subidaInexistente.body);

    expect(pedidosDesde(armazem, marco)).toEqual([]);
    expect(await prisma.cardFile.count({ where: { cardId: card.id } })).toBe(1);
    expect(noBucket(arquivo.key)).toBe(true);
  });

  // INV-03: o anexo é conferido contra o card da URL, não só contra o dono.
  test("o anexo de um card não se apaga pelo endereço de outro card", async () => {
    const [cardA, cardB] = [await cardAvulso("Card A"), await cardAvulso("Card B")];
    const key = await anexarPng(cardA.id);
    const arquivo = await prisma.cardFile.findUniqueOrThrow({ where: { key } });

    const doDono = await chamar(app, {
      method: "DELETE",
      url: `/cards/${cardB.id}/files/${arquivo.id}`,
      token: dono.token,
    });
    expect(doDono.status).toBe(404);

    // O intruso, pelo próprio card, apontando o anexo do dono.
    const board = await chamar(app, {
      method: "POST",
      url: "/boards",
      token: intruso.token,
      body: {
        name: "Do intruso",
        workspaceId: (
          await prisma.workspace.create({ data: { userId: intruso.id, name: "Intruso" } })
        ).id,
      },
    });
    const colunaDoIntruso = (board.body as BoardDetail).columns[0]?.id as string;
    const cardDoIntruso = await chamar(app, {
      method: "POST",
      url: "/cards",
      token: intruso.token,
      body: { columnId: colunaDoIntruso, title: "Isca" },
    });
    const peloProprio = await chamar(app, {
      method: "DELETE",
      url: `/cards/${(cardDoIntruso.body as CardDetail).id}/files/${arquivo.id}`,
      token: intruso.token,
    });
    expect(peloProprio.status).toBe(404);

    expect(await prisma.cardFile.count({ where: { id: arquivo.id } })).toBe(1);
    expect(noBucket(key)).toBe(true);
  });
});

/* ---------------------------------------------------------------- leitura */

describe("leitura dos anexos", () => {
  test("a lista traz URL assinada de uma hora, e assinar não fala com o bucket", async () => {
    const card = await cardAvulso("Lista");
    const keyPng = await anexarPng(card.id, "primeiro.png");
    const { body: pdf } = await subir(dono, card.id, { nome: "segundo.pdf", conteudo: PDF });
    expect((pdf as CardFileWithUrl).name).toBe("segundo.pdf");
    const marco = armazem.recebidas.length;

    const { status, body } = await chamar(app, {
      method: "GET",
      url: `/cards/${card.id}/files`,
      token: dono.token,
    });

    expect(status).toBe(200);
    const lista = body as CardFilesResponse;
    expect(lista.available).toBe(true);
    expect(lista.files.map((f) => f.name)).toEqual(["primeiro.png", "segundo.pdf"]);
    expect(lista.files.map((f) => f.isImage)).toEqual([true, false]);
    expect(pedidosDesde(armazem, marco)).toEqual([]);

    for (const f of lista.files) {
      const url = new URL(f.url);
      expect(url.origin).toBe(`http://127.0.0.1:${PORTA_DO_ARMAZEM}`);
      expect(url.pathname.startsWith(`/${BUCKET_DE_TESTE}/cards/${card.id}/`)).toBe(true);
      expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    }

    // A URL aponta o objeto que a subida gravou.
    const lido = await fetch(lista.files[0]?.url as string);
    expect(lido.status).toBe(200);
    expect(Buffer.from(await lido.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);
    expect(new URL(lista.files[0]?.url as string).pathname).toBe(caminhoDaChave(keyPng));
  });

  test("a face do card no quadro conta os anexos, e o detalhe os lista sem URL", async () => {
    const board = await novoBoard("Face e detalhe");
    const coluna = board.columns[0]?.id as string;
    const comAnexo = await novoCard(coluna, "Com anexos");
    const semAnexo = await novoCard(coluna, "Sem anexos");
    await anexarPng(comAnexo.id, "a.png");
    await subir(dono, comAnexo.id, { nome: "b.pdf", conteudo: PDF });

    const quadro = await chamar(app, { method: "GET", url: `/boards/${board.id}`, token: dono.token });
    const cards = (quadro.body as BoardDetail).columns.flatMap((c) => c.cards);
    const face = (id: string) => cards.find((c) => c.id === id) as CardSummary;
    expect(face(comAnexo.id).fileCount).toBe(2);
    expect(face(semAnexo.id).fileCount).toBe(0);

    const detalhe = await chamar(app, { method: "GET", url: `/cards/${comAnexo.id}`, token: dono.token });
    const card = detalhe.body as CardDetail;
    expect(card.fileCount).toBe(2);
    expect(card.files.map((f) => [f.name, f.mimeType, f.isImage])).toEqual([
      ["a.png", "image/png", true],
      ["b.pdf", "application/pdf", false],
    ]);
    for (const f of card.files) {
      expect(Object.keys(f).sort()).toEqual(
        ["createdAt", "id", "isImage", "mimeType", "name", "sizeBytes"].sort(),
      );
    }
  });
});

/* ---------------------------------------------------------------- exclusão */

describe("exclusão apaga o objeto do bucket junto com a linha", () => {
  test("excluir o anexo apaga a linha e o objeto", async () => {
    const card = await cardAvulso("Excluir anexo");
    const key = await anexarPng(card.id);
    const arquivo = await prisma.cardFile.findUniqueOrThrow({ where: { key } });
    const marco = armazem.recebidas.length;

    const { status } = await chamar(app, {
      method: "DELETE",
      url: `/cards/${card.id}/files/${arquivo.id}`,
      token: dono.token,
    });

    expect(status).toBe(204);
    expect(await prisma.cardFile.count({ where: { id: arquivo.id } })).toBe(0);
    expect(noBucket(key)).toBe(false);
    expect(pedidosDesde(armazem, marco, "DELETE").map((p) => p.caminho)).toEqual([caminhoDaChave(key)]);

    const deNovo = await chamar(app, {
      method: "DELETE",
      url: `/cards/${card.id}/files/${arquivo.id}`,
      token: dono.token,
    });
    expect(deNovo.status).toBe(404);
  });

  test("INV-04: dois pedidos simultâneos de excluir o mesmo anexo — um 204, um 404, nenhum 500", async () => {
    const card = await cardAvulso("Excluir em paralelo");
    const key = await anexarPng(card.id);
    const arquivo = await prisma.cardFile.findUniqueOrThrow({ where: { key } });
    const pedido = () =>
      chamar(app, {
        method: "DELETE",
        url: `/cards/${card.id}/files/${arquivo.id}`,
        token: dono.token,
      });

    const status = (await Promise.all([pedido(), pedido()])).map((r) => r.status).sort();
    expect(status).toEqual([204, 404]);
    expect(await prisma.cardFile.count({ where: { id: arquivo.id } })).toBe(0);
  });

  test("excluir o card apaga os objetos dos anexos dele", async () => {
    const card = await cardAvulso("Excluir card");
    const chaves = [await anexarPng(card.id, "1.png"), await anexarPng(card.id, "2.png")];

    const { status } = await chamar(app, { method: "DELETE", url: `/cards/${card.id}`, token: dono.token });

    expect(status).toBe(204);
    expect(chaves.map(noBucket)).toEqual([false, false]);
    expect(await prisma.cardFile.count({ where: { key: { in: chaves } } })).toBe(0);
  });

  test("excluir coluna levando os cards apaga os objetos só dela", async () => {
    const board = await novoBoard("Coluna com anexos");
    const [alvo, vizinha] = board.columns;
    const chavesDoAlvo = [
      await anexarPng((await novoCard(alvo?.id as string, "Vai 1")).id),
      await anexarPng((await novoCard(alvo?.id as string, "Vai 2")).id),
    ];
    const chaveDaVizinha = await anexarPng((await novoCard(vizinha?.id as string, "Fica")).id);

    const { status } = await chamar(app, {
      method: "DELETE",
      url: `/columns/${alvo?.id}?deleteCards=true`,
      token: dono.token,
    });

    expect(status).toBe(200);
    expect(chavesDoAlvo.map(noBucket)).toEqual([false, false]);
    expect(noBucket(chaveDaVizinha)).toBe(true);
  });

  test("excluir coluna movendo os cards mantém os anexos com eles", async () => {
    const board = await novoBoard("Coluna movida");
    const [origem, destino] = board.columns;
    const card = await novoCard(origem?.id as string, "Muda de coluna");
    const key = await anexarPng(card.id);
    const marco = armazem.recebidas.length;

    const { status, body } = await chamar(app, {
      method: "DELETE",
      url: `/columns/${origem?.id}?moveCardsTo=${destino?.id}`,
      token: dono.token,
    });

    expect(status).toBe(200);
    expect(pedidosDesde(armazem, marco)).toEqual([]);
    expect(noBucket(key)).toBe(true);
    const movido = (body as BoardDetail).columns
      .find((c) => c.id === destino?.id)
      ?.cards.find((c) => c.id === card.id);
    expect(movido?.fileCount).toBe(1);
  });

  test("arquivar o card não apaga os anexos", async () => {
    const card = await cardAvulso("Arquivado");
    const key = await anexarPng(card.id);
    const marco = armazem.recebidas.length;

    const { status } = await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { archived: true },
    });

    expect(status).toBe(200);
    // Pelo efeito gravado, não pelo código de resposta.
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).archived).toBe(true);
    expect(pedidosDesde(armazem, marco)).toEqual([]);
    expect(noBucket(key)).toBe(true);
    expect(await prisma.cardFile.count({ where: { key } })).toBe(1);
  });

  test("excluir o board apaga os objetos dos cards dele, e só deles", async () => {
    const board = await novoBoard("Board que some");
    const outro = await novoBoard("Board que fica");
    const [c1, c2] = board.columns;
    const chaves = [
      await anexarPng((await novoCard(c1?.id as string, "Um")).id),
      await anexarPng((await novoCard(c2?.id as string, "Dois")).id),
    ];
    const chaveDoOutro = await anexarPng((await novoCard(outro.columns[0]?.id as string, "Outro")).id);

    const { status } = await chamar(app, { method: "DELETE", url: `/boards/${board.id}`, token: dono.token });

    expect(status).toBe(204);
    expect(chaves.map(noBucket)).toEqual([false, false]);
    expect(noBucket(chaveDoOutro)).toBe(true);
  });

  // INV-21: o workspace leva boards e cards — e agora os objetos dos anexos.
  test("excluir o workspace apaga os objetos dos cards de todos os boards dele", async () => {
    const ws = await prisma.workspace.create({ data: { userId: dono.id, name: "Some com tudo" } });
    const b1 = await novoBoard("WS board 1", ws.id);
    const b2 = await novoBoard("WS board 2", ws.id);
    const chaves = [
      await anexarPng((await novoCard(b1.columns[0]?.id as string, "Em b1")).id),
      await anexarPng((await novoCard(b2.columns[1]?.id as string, "Em b2")).id),
    ];
    const chaveDeFora = await anexarPng((await cardAvulso("Fora do workspace")).id);

    const { status } = await chamar(app, { method: "DELETE", url: `/workspaces/${ws.id}`, token: dono.token });

    expect(status).toBe(204);
    expect(chaves.map(noBucket)).toEqual([false, false]);
    expect(noBucket(chaveDeFora)).toBe(true);
  });

  // INV-02: a exclusão alheia não empresta chave nenhuma à colheita.
  test("exclusão tentada por outra conta não apaga objeto nenhum", async () => {
    const ws = await prisma.workspace.create({ data: { userId: dono.id, name: "Alvo do intruso" } });
    const board = await novoBoard("Alvo", ws.id);
    const card = await novoCard(board.columns[0]?.id as string, "Alvo");
    const key = await anexarPng(card.id);
    const marco = armazem.recebidas.length;

    const tentativas = [
      await chamar(app, { method: "DELETE", url: `/cards/${card.id}`, token: intruso.token }),
      await chamar(app, {
        method: "DELETE",
        url: `/columns/${board.columns[0]?.id}?deleteCards=true`,
        token: intruso.token,
      }),
      await chamar(app, { method: "DELETE", url: `/boards/${board.id}`, token: intruso.token }),
      await chamar(app, { method: "DELETE", url: `/workspaces/${ws.id}`, token: intruso.token }),
    ];

    expect(tentativas.map((t) => t.status)).toEqual([404, 404, 404, 404]);
    expect(pedidosDesde(armazem, marco)).toEqual([]);
    expect(noBucket(key)).toBe(true);
  });

  test("bucket que falha ao apagar não falha a exclusão do card", async () => {
    const card = await cardAvulso("Bucket falha no delete");
    const key = await anexarPng(card.id);

    armazem.falhar.DELETE = 500;
    try {
      const { status } = await chamar(app, { method: "DELETE", url: `/cards/${card.id}`, token: dono.token });
      expect(status).toBe(204);
    } finally {
      delete armazem.falhar.DELETE;
    }
    expect(await prisma.card.count({ where: { id: card.id } })).toBe(0);
    // O objeto ficou órfão — é a dívida declarada, não um erro na tela.
    expect(noBucket(key)).toBe(true);
  });
});

/* ------------------------------------------------------------- o texto */

describe("anexos no texto que o MCP e o chat leem", () => {
  test("a face conta os anexos e o detalhe dá nome, tipo e tamanho, nunca a URL", async () => {
    const board = await novoBoard("Texto dos anexos");
    const card = await novoCard(board.columns[0]?.id as string, "Relatório");
    await linhasDeAnexo(card.id, 12, 340 * 1024);

    const quadro = await chamar(app, { method: "GET", url: `/boards/${board.id}`, token: dono.token });
    const face = (quadro.body as BoardDetail).columns[0]?.cards[0] as CardSummary;
    expect(formatarCard(face, FUSO_PADRAO).split("\n")[0]).toBe("- Relatório · 12 anexo(s)");

    const detalhe = await chamar(app, { method: "GET", url: `/cards/${card.id}`, token: dono.token });
    const textoDoCard = formatarCardDetalhe(detalhe.body as CardDetail, FUSO_PADRAO);
    const linha = textoDoCard.split("\n").find((l) => l.startsWith("anexos: "));
    const dez = Array.from(
      { length: 10 },
      (_, i) => `semeado-${String(i).padStart(2, "0")}.pdf (application/pdf, 340 KB)`,
    );
    expect(linha).toBe(`anexos: ${dez.join("; ")} e mais 2`);
    expect(textoDoCard).not.toContain("http");
    expect(textoDoCard).not.toContain("cards/");
  });

  test("card sem anexo não fala de anexo em nenhuma das duas leituras", async () => {
    const card = await cardAvulso("Sem nada");
    const quadro = await chamar(app, { method: "GET", url: `/boards/${card.boardId}`, token: dono.token });
    const face = (quadro.body as BoardDetail).columns[0]?.cards[0] as CardSummary;
    expect(formatarCard(face, FUSO_PADRAO)).not.toContain("anexo");
    expect(formatarCardDetalhe(card, FUSO_PADRAO)).not.toContain("anexo");
  });

  test("tamanho se escreve em base 1024, com vírgula decimal", () => {
    expect(formatarBytes(512)).toBe("512 B");
    expect(formatarBytes(340 * 1024)).toBe("340 KB");
    expect(formatarBytes(Math.round(2.4 * 1024 * 1024))).toBe("2,4 MB");
    expect(formatarBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});

/* ------------------------------------------------------------ unidades */

describe("decisões puras do anexo", () => {
  test("a guarda de destino do bucket está armada na suíte", () => {
    // Sem NODE_ENV=test, `garantirDestinoDeTeste` não confere o host.
    expect(env.NODE_ENV).toBe("test");
    expect(new URL(env.S3_ENDPOINT as string).hostname).toBe("127.0.0.1");
  });

  test("sem as quatro variáveis do bucket, os anexos ficam indisponíveis", () => {
    const completa = {
      S3_ENDPOINT: "http://127.0.0.1:1",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_REGION: "auto",
      S3_PATH_STYLE: false,
    };
    expect(configDoArmazem({ S3_REGION: "auto", S3_PATH_STYLE: false })).toBeNull();
    for (const falta of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      expect(configDoArmazem({ ...completa, [falta]: undefined })).toBeNull();
      expect(configDoArmazem({ ...completa, [falta]: "" })).toBeNull();
    }
    expect(configDoArmazem(completa)).toEqual({
      endpoint: "http://127.0.0.1:1",
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "auto",
      pathStyle: false,
    });
  });

  test("o endereço de produção põe o bucket no subdomínio; o do dublê, no caminho", () => {
    const cfg = {
      endpoint: "https://t3.storage.exemplo.dev",
      bucket: "anexos-yu",
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "auto",
      pathStyle: false,
    };
    const key = "cards/2b1c/9f0e";
    // A Railway só fala virtual-hosted: é o ramo que a suíte não alcança pela
    // rede, porque subdomínio de 127.0.0.1 não resolve.
    expect(urlDoObjeto(cfg, key)).toBe("https://anexos-yu.t3.storage.exemplo.dev/cards/2b1c/9f0e");
    expect(urlDoObjeto({ ...cfg, pathStyle: true }, key)).toBe(
      "https://t3.storage.exemplo.dev/anexos-yu/cards/2b1c/9f0e",
    );
    expect(urlDoObjeto({ ...cfg, endpoint: "https://t3.storage.exemplo.dev:8443/" }, key)).toBe(
      "https://anexos-yu.t3.storage.exemplo.dev:8443/cards/2b1c/9f0e",
    );
  });

  test("o nome gravado termina numa extensão do tipo detectado", () => {
    expect(nomeCoerente("foto.png", "image/png")).toBe("foto.png");
    expect(nomeCoerente("foto.JPEG", "image/jpeg")).toBe("foto.JPEG");
    expect(nomeCoerente("x.html", "application/pdf")).toBe("x.html.pdf");
    expect(nomeCoerente("app.jar", "application/zip")).toBe("app.jar.zip");
    expect(nomeCoerente("sem-extensao", "image/webp")).toBe("sem-extensao.webp");
    expect(nomeCoerente(`${"a".repeat(200)}`, "application/pdf")).toHaveLength(200);
  });

  test("o nome perde as marcas de direção e os controles C1", () => {
    expect(nomeDoArquivo("foto\u202Egpj.exe")).toBe("fotogpj.exe");
    expect(nomeDoArquivo("a\u200Eb\u2066c\u0085.pdf")).toBe("abc.pdf");
  });

  test("o tipo sai dos bytes; a extensão só desempata zip e texto", () => {
    expect(detectarTipo(PNG, "x.png")).toBe("image/png");
    expect(detectarTipo(PNG, "x.txt")).toBe("image/png");
    expect(detectarTipo(JPEG, "x.jpg")).toBe("image/jpeg");
    expect(detectarTipo(bytes("GIF87a", [0]), "x.gif")).toBe("image/gif");
    expect(detectarTipo(bytes("GIF89a", [0]), "x")).toBe("image/gif");
    expect(detectarTipo(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "x.webp")).toBe("image/webp");
    expect(detectarTipo(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "), "x.webp")).toBeNull();
    expect(detectarTipo(PDF, "x.pdf")).toBe("application/pdf");

    expect(detectarTipo(ZIP, "a.docx")).toBe(DOCX);
    expect(detectarTipo(ZIP, "a.XLSX")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(detectarTipo(ZIP, "a.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(detectarTipo(ZIP, "a.zip")).toBe("application/zip");
    expect(detectarTipo(ZIP, "a.png")).toBe("application/zip");
    expect(detectarTipo(bytes([0x50, 0x4b, 0x05, 0x06]), "vazio.zip")).toBe("application/zip");
    // Extensão de Office sem os bytes de zip não é Office.
    expect(detectarTipo(texto("não é zip"), "a.docx")).toBeNull();

    expect(detectarTipo(texto("olá, mundo"), "a.txt")).toBe("text/plain");
    expect(detectarTipo(texto("# título"), "a.md")).toBe("text/markdown");
    expect(detectarTipo(texto("a;b\n1;2"), "a.CSV")).toBe("text/csv");
    expect(detectarTipo(bytes("texto", [0], "binario"), "a.txt")).toBeNull();
    // "cçb" em Latin-1: sem NUL, mas não é UTF-8.
    expect(detectarTipo(bytes([0x63, 0xe7, 0x62]), "a.txt")).toBeNull();
    expect(detectarTipo(texto("olá"), "sem-extensao")).toBeNull();

    expect(detectarTipo(EXE, "setup.exe")).toBeNull();
    expect(detectarTipo(HTML, "a.html")).toBeNull();
    expect(detectarTipo(SVG, "a.svg")).toBeNull();
    expect(detectarTipo(texto("isto não é um png"), "foto.png")).toBeNull();
  });

  test("o nome do arquivo perde caminho e caractere de controle, e tem teto", () => {
    expect(nomeDoArquivo("../../etc/passwd")).toBe("passwd");
    expect(nomeDoArquivo("C:\\Users\\yuri\\foto.png")).toBe("foto.png");
    expect(nomeDoArquivo("a\u0000b\u001fc\u007f.txt")).toBe("abc.txt");
    // Quebra de linha no nome viraria quebra de cabeçalho no Content-Disposition.
    expect(nomeDoArquivo("x\r\nX-Injetado: 1.pdf")).toBe("xX-Injetado: 1.pdf");
    expect(nomeDoArquivo("  relatório.pdf  ")).toBe("relatório.pdf");
    expect(nomeDoArquivo("")).toBe("arquivo");
    expect(nomeDoArquivo("   ")).toBe("arquivo");
    expect(nomeDoArquivo("pasta/")).toBe("arquivo");
    expect(nomeDoArquivo("\u0001\u0002")).toBe("arquivo");
    expect(nomeDoArquivo(`${"a".repeat(300)}.pdf`)).toBe("a".repeat(200));
  });
});

/* ---------------------------------------------- bucket fora do ar, por último */

describe("bucket fora do ar", () => {
  test("excluir card com anexo não falha quando o bucket nem responde", async () => {
    const card = await cardAvulso("Bucket caiu");
    await anexarPng(card.id);
    await fecharArmazem(armazem);

    const { status } = await chamar(app, { method: "DELETE", url: `/cards/${card.id}`, token: dono.token });

    expect(status).toBe(204);
    expect(await prisma.card.count({ where: { id: card.id } })).toBe(0);
  });
});
