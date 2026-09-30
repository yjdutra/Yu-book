/**
 * Anexos de card (frente de cards, Parte 2).
 *
 * O binário mora num bucket S3 (Railway Storage Bucket) e o banco guarda só o
 * que se lista: nome, tipo e tamanho. O front, a API e o texto que o MCP e o
 * chat leem concordam sobre os limites e sobre como um tamanho se escreve —
 * por isso moram aqui.
 */

/// 25 MB: cobre foto de celular, PDF escaneado e planilha, e o upload ainda
/// passa pela API sem pesar. Decisão do usuário, 2026-09-30.
export const MAX_BYTES_ARQUIVO = 25 * 1024 * 1024;

/// Protege a grade do painel e a listagem com URLs assinadas.
export const MAX_ARQUIVOS_CARD = 20;

export const MAX_NOME_ARQUIVO = 200;

/**
 * O que se aceita. A API decide o tipo **pelos bytes** e usa a extensão só
 * onde os bytes não bastam — docx, xlsx e pptx são zip por dentro, e texto
 * não tem assinatura. Executável, HTML e SVG ficam de fora de propósito: os
 * dois últimos rodam script quando abertos no navegador.
 */
export const TIPOS_DE_ARQUIVO = [
  { mime: "image/png", extensoes: ["png"], imagem: true },
  { mime: "image/jpeg", extensoes: ["jpg", "jpeg"], imagem: true },
  { mime: "image/webp", extensoes: ["webp"], imagem: true },
  { mime: "image/gif", extensoes: ["gif"], imagem: true },
  { mime: "application/pdf", extensoes: ["pdf"], imagem: false },
  { mime: "text/plain", extensoes: ["txt"], imagem: false },
  { mime: "text/markdown", extensoes: ["md"], imagem: false },
  { mime: "text/csv", extensoes: ["csv"], imagem: false },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensoes: ["docx"],
    imagem: false,
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensoes: ["xlsx"],
    imagem: false,
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensoes: ["pptx"],
    imagem: false,
  },
  { mime: "application/zip", extensoes: ["zip"], imagem: false },
] as const;

/** O `accept` do `<input type="file">`: só filtra o seletor — quem decide é a API. */
export const ACEITA_ARQUIVO = TIPOS_DE_ARQUIVO.flatMap((t) => t.extensoes.map((e) => `.${e}`)).join(
  ",",
);

export function ehImagem(mime: string): boolean {
  return TIPOS_DE_ARQUIVO.some((t) => t.mime === mime && t.imagem);
}

/** Um anexo como o banco o guarda. Sem URL: ela expira, e o detalhe do card não. */
export interface CardFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  createdAt: string;
}

/// A URL é pré-assinada e vale uma hora — é por ela que o `<img>` lê direto do
/// bucket, sem passar pela API nem pelo token.
export interface CardFileWithUrl extends CardFile {
  url: string;
}

export interface CardFilesResponse {
  /// `false` quando o servidor não tem bucket configurado (RNF-03): o resto do
  /// card funciona, e a tela diz por que não há onde anexar.
  available: boolean;
  files: CardFileWithUrl[];
}

/** "340 KB", "2,4 MB" — base 1024, vírgula decimal, como o resto da interface. */
export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} MB`;
}
