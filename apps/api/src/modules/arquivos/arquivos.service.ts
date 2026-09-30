import { randomUUID } from "node:crypto";
import {
  ehImagem,
  MAX_ARQUIVOS_CARD,
  MAX_NOME_ARQUIVO,
  TIPOS_DE_ARQUIVO,
} from "@yu-book/shared";
import type { CardFile, CardFilesResponse, CardFileWithUrl } from "@yu-book/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import {
  apagarObjetos,
  armazemDisponivel,
  guardarObjeto,
  urlAssinada,
} from "../../lib/armazem.js";
import { AppError, notFound } from "../../lib/errors.js";

/**
 * Anexos de card (frente de cards, Parte 2).
 *
 * O binário vai ao bucket (`lib/armazem.ts`) e a linha ao banco. **A cascata
 * do banco não alcança o bucket**: excluir card, coluna, board ou workspace
 * apaga as linhas por FK, e os objetos só somem porque quem exclui colhe as
 * chaves antes (`chavesDosCards`) e as apaga depois do commit.
 *
 * Posse pela cadeia card → coluna → board → usuário, dentro da mesma consulta
 * (INV-03), e card de outra conta responde 404 como o inexistente.
 */

type LinhaDoArquivo = Prisma.CardFileGetPayload<{
  select: { id: true; name: true; mimeType: true; sizeBytes: true; createdAt: true; key: true };
}>;

const CAMPOS_DO_ARQUIVO = {
  id: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  key: true,
} satisfies Prisma.CardFileSelect;

export function paraArquivo(linha: Omit<LinhaDoArquivo, "key">): CardFile {
  return {
    id: linha.id,
    name: linha.name,
    mimeType: linha.mimeType,
    sizeBytes: linha.sizeBytes,
    isImage: ehImagem(linha.mimeType),
    createdAt: linha.createdAt.toISOString(),
  };
}

async function exigirCard(userId: string, cardId: string): Promise<void> {
  const card = await prisma.card.findFirst({
    where: { id: cardId, column: { board: { userId } } },
    select: { id: true },
  });
  if (!card) throw notFound("Card não encontrado");
}

/* ------------------------------------------------------------ o conteúdo */

const comeca = (bytes: Uint8Array, assinatura: readonly number[], deslocamento = 0) =>
  assinatura.every((b, i) => bytes[deslocamento + i] === b);

const ascii = (texto: string) => Array.from(texto, (c) => c.charCodeAt(0));

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto < 0 ? "" : nome.slice(ponto + 1).toLowerCase();
}

function mimeDaExtensao(ext: string): string | null {
  const tipo = TIPOS_DE_ARQUIVO.find((t) => (t.extensoes as readonly string[]).includes(ext));
  return tipo?.mime ?? null;
}

/**
 * O tipo do anexo, decidido **pelos bytes**. O `Content-Type` do navegador é
 * ignorado, e a extensão só desempata o que os bytes não distinguem: docx,
 * xlsx e pptx são zip por dentro, e texto não tem assinatura — é aceito só com
 * extensão de texto, sem byte NUL e em UTF-8 válido. Qualquer outra coisa —
 * executável, HTML, SVG — volta `null`.
 */
export function detectarTipo(bytes: Uint8Array, nome: string): string | null {
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (comeca(bytes, ascii("GIF87a")) || comeca(bytes, ascii("GIF89a"))) return "image/gif";
  if (comeca(bytes, ascii("RIFF")) && comeca(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (comeca(bytes, ascii("%PDF-"))) return "application/pdf";

  const ext = extensao(nome);
  if (comeca(bytes, [0x50, 0x4b, 0x03, 0x04]) || comeca(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    const office = ext === "docx" || ext === "xlsx" || ext === "pptx";
    return (office && mimeDaExtensao(ext)) || "application/zip";
  }

  if (ext === "txt" || ext === "md" || ext === "csv") {
    if (bytes.includes(0)) return null;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
    return mimeDaExtensao(ext);
  }
  return null;
}

/** Só o nome — sem caminho, sem caractere de controle —, com teto. */
export function nomeDoArquivo(bruto: string): string {
  const semCaminho = bruto.split(/[\\/]/).pop() ?? "";
  // Os controles do ASCII, o DEL e os C1: quebra de linha num nome viraria
  // quebra de cabeçalho no `Content-Disposition`. E as marcas de direção:
  // "foto\u202Egpj.exe" se lê "fotoexe.jpg" no painel e no texto do modelo.
  const limpo = semCaminho
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  return limpo.slice(0, MAX_NOME_ARQUIVO) || "arquivo";
}

/**
 * O nome que se grava termina numa extensão do tipo detectado. Os bytes
 * decidem o tipo, mas é a extensão que o sistema operacional usa ao abrir o
 * que se baixou: um PDF chamado `x.html` sairia do bucket como `x.html`, e um
 * zip chamado `.jar` como executável. Com extensão errada, a certa é somada ao
 * fim — `x.html.pdf` —, e o nome original continua legível.
 */
export function nomeCoerente(nome: string, mime: string): string {
  const aceitas = TIPOS_DE_ARQUIVO.find((t) => t.mime === mime)?.extensoes ?? [];
  if ((aceitas as readonly string[]).includes(extensao(nome))) return nome;
  const certa = aceitas[0];
  return certa ? `${nome.slice(0, MAX_NOME_ARQUIVO - certa.length - 1)}.${certa}` : nome;
}

/**
 * `inline` para imagem, `attachment` para o resto — é o que faz a mesma URL
 * assinada abrir a foto na tela e baixar o PDF. O nome vai duas vezes: em
 * ASCII, para quem não entende RFC 5987, e em UTF-8 no `filename*`.
 */
function disposicao(nome: string, mime: string): string {
  const tipo = ehImagem(mime) ? "inline" : "attachment";
  const plano = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]|["\\]/g, "_");
  const codificado = encodeURIComponent(nome).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${tipo}; filename="${plano}"; filename*=UTF-8''${codificado}`;
}

/* ---------------------------------------------------------------- leitura */

export async function listar(userId: string, cardId: string): Promise<CardFilesResponse> {
  await exigirCard(userId, cardId);
  // Sem bucket não há URL a assinar; a tela diz por quê em vez de listar
  // arquivos que não abrem.
  if (!armazemDisponivel()) return { available: false, files: [] };

  const linhas = await prisma.cardFile.findMany({
    where: { cardId },
    orderBy: { createdAt: "asc" },
    select: CAMPOS_DO_ARQUIVO,
  });
  const files = await Promise.all(
    linhas.map(async (l) => ({ ...paraArquivo(l), url: await urlAssinada(l.key) })),
  );
  return { available: true, files };
}

/* ---------------------------------------------------------------- escrita */

/**
 * Posse e teto, antes de a rota ler o corpo: card alheio ou cheio não pode
 * custar 25 MB de memória e de banda. O teto é conferido aqui, e não numa
 * restrição do banco — o front sobe um arquivo por vez, e duas subidas
 * simultâneas passam de 20 por um, no máximo.
 */
export async function conferirEnvio(userId: string, cardId: string): Promise<void> {
  await exigirCard(userId, cardId);
  const total = await prisma.cardFile.count({ where: { cardId } });
  if (total >= MAX_ARQUIVOS_CARD) {
    throw new AppError(422, "VALIDATION_ERROR", `Um card aceita até ${MAX_ARQUIVOS_CARD} anexos`);
  }
}

export async function enviar(
  userId: string,
  cardId: string,
  arquivo: { nome: string; bytes: Uint8Array },
): Promise<CardFileWithUrl> {
  // De novo, e não só na rota: entre a leitura do corpo e aqui, o card pode ter
  // sido excluído ou enchido por outra aba.
  await conferirEnvio(userId, cardId);

  const bruto = nomeDoArquivo(arquivo.nome);
  const mime = detectarTipo(arquivo.bytes, bruto);
  if (!mime) {
    throw new AppError(
      415,
      "TIPO_NAO_PERMITIDO",
      "Tipo de arquivo não aceito. Anexe imagem, PDF, texto, documento do Office ou zip.",
    );
  }

  const nome = nomeCoerente(bruto, mime);
  const key = `cards/${cardId}/${randomUUID()}`;
  const tipoNoObjeto = mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime;
  await guardarObjeto(key, arquivo.bytes, tipoNoObjeto, disposicao(nome, mime));

  let linha: LinhaDoArquivo;
  try {
    linha = await prisma.cardFile.create({
      data: { cardId, key, name: nome, mimeType: mime, sizeBytes: arquivo.bytes.byteLength },
      select: CAMPOS_DO_ARQUIVO,
    });
  } catch (erro) {
    // O objeto já está no bucket e a linha não entrou: sem isto, ele fica
    // órfão. O caso comum é o card excluído no meio da subida (P2003).
    await apagarObjetos([key]);
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2003") {
      throw notFound("Card não encontrado");
    }
    throw erro;
  }

  return { ...paraArquivo(linha), url: await urlAssinada(key) };
}

export async function excluir(userId: string, cardId: string, fileId: string): Promise<void> {
  const arquivo = await prisma.cardFile.findFirst({
    where: { id: fileId, cardId, card: { column: { board: { userId } } } },
    select: { id: true, key: true },
  });
  if (!arquivo) throw notFound("Anexo não encontrado");

  // A linha primeiro: se o bucket falhar, o anexo já sumiu da tela e o objeto
  // fica no log como órfão — o inverso deixaria na tela um anexo que não abre.
  // Com o escopo no próprio `where` (INV-04): dois pedidos simultâneos leem o
  // mesmo anexo, e só o primeiro apaga — o segundo é 404, não 500.
  const { count } = await prisma.cardFile.deleteMany({
    where: { id: arquivo.id, cardId, card: { column: { board: { userId } } } },
  });
  if (count === 0) throw notFound("Anexo não encontrado");
  await apagarObjetos([arquivo.key]);
}

/* ---------------------------------------------------------- exclusão em massa */

/**
 * As chaves dos anexos dos cards que uma exclusão vai levar. Chamada **antes**
 * do delete — depois dele as linhas já sumiram pela cascata — com o mesmo
 * recorte de posse que a exclusão usa.
 */
export async function chavesDosCards(onde: Prisma.CardWhereInput): Promise<string[]> {
  const linhas = await prisma.cardFile.findMany({ where: { card: onde }, select: { key: true } });
  return linhas.map((l) => l.key);
}
