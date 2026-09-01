import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../env.js";

/**
 * Cifra e assinatura, com `node:crypto` e nada mais.
 *
 * **O `apps/mcp` não ganha banco nesta fase.** Ele é cliente da API e não do
 * Postgres — é a decisão fundadora do pacote, e é o que faz ele herdar o escopo
 * por `userId` em vez de reimplementá-lo. Mas o fluxo OAuth tem estado:
 * cliente registrado, código de autorização, refresh token.
 *
 * A saída é trocar **armazenamento por criptografia**: o estado viaja dentro do
 * próprio identificador, cifrado com uma chave que só este servidor tem. Um
 * `client_id` é o envelope do cliente; um `code` é o envelope do código. Nada
 * para guardar, nada para perder num redeploy, e o mapa não cresce.
 *
 * O custo está declarado: quem tiver o `MCP_SEGREDO` lê e forja tudo. É a mesma
 * postura do `JWT_SECRET` da API — e o mesmo motivo de o boot recusar segredo
 * curto.
 */

/**
 * Duas chaves derivadas da mesma raiz, com rótulos diferentes. Usar a mesma
 * chave para cifrar e para assinar é o erro clássico: quem quebra um uso ganha
 * o outro de graça.
 */
function derivar(rotulo: string): Buffer {
  const segredo = env.MCP_SEGREDO ?? "";
  return Buffer.from(hkdfSync("sha256", segredo, "yu-book-mcp", rotulo, 32));
}

const CHAVE_CIFRA = derivar("envelope");
const CHAVE_ASSINATURA = derivar("jwt");

const b64u = (b: Buffer): string => b.toString("base64url");

/**
 * PARA QUE SERVE CADA ENVELOPE. Não é etiqueta decorativa — é o que impede um
 * envelope de ser aceito no lugar de outro.
 *
 * Todos são cifrados com a mesma chave, então todos se abrem. O que os separava
 * era só a **forma** do que havia dentro, e forma não separa nada: `Codigo` tem
 * todos os campos de `Refresh`, então um código de autorização se abria como
 * refresh token perfeitamente válido. Apresentá-lo em `grant_type=refresh_token`
 * contornava as três defesas do código de uma vez — o uso único, o `exp` de 60 s
 * e o PKCE — e devolvia um token com escopo de escrita. Confirmado contra o
 * servidor de pé antes de existir esta linha.
 *
 * O rótulo é **obrigatório** nas duas pontas de propósito: assim o compilador
 * cobra a decisão em cada sítio novo, em vez de deixar o padrão ser o inseguro.
 */
export type TipoDeEnvelope = "cliente" | "pedido" | "codigo" | "refresh" | "credencial";

/** O que de fato é cifrado: o rótulo do envelope e a carga. */
interface Conteudo {
  t: TipoDeEnvelope;
  d: unknown;
}

/** Cifra um objeto num texto opaco que serve como identificador. */
export function selar(dados: unknown, tipo: TipoDeEnvelope): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", CHAVE_CIFRA, iv);
  const conteudo: Conteudo = { t: tipo, d: dados };
  const corpo = Buffer.concat([
    cifra.update(JSON.stringify(conteudo), "utf8"),
    cifra.final(),
  ]);
  // O `authTag` do GCM é o que faz o envelope ser detectavelmente adulterado —
  // sem ele isto seria cifra sem autenticação, e um envelope forjado passaria.
  return `${b64u(iv)}.${b64u(cifra.getAuthTag())}.${b64u(corpo)}`;
}

/**
 * Abre o envelope, **se ele for do tipo pedido**. Devolve `null` para qualquer
 * coisa que não seja nossa — e para o que é nosso mas veio de outra gaveta.
 */
export function abrir<T>(envelope: string, tipo: TipoDeEnvelope): T | null {
  const partes = envelope.split(".");
  if (partes.length !== 3) return null;
  const [iv, tag, corpo] = partes as [string, string, string];

  try {
    const decifra = createDecipheriv("aes-256-gcm", CHAVE_CIFRA, Buffer.from(iv, "base64url"));
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    const texto = Buffer.concat([
      decifra.update(Buffer.from(corpo, "base64url")),
      decifra.final(),
    ]).toString("utf8");
    const conteudo = JSON.parse(texto) as Conteudo;
    // Envelope de outro tipo cai aqui, e sai igual a lixo — quem apresenta um
    // código no lugar de um refresh token não merece saber que quase deu certo.
    if (conteudo?.t !== tipo) return null;
    return conteudo.d as T;
  } catch {
    // Adulterado, cifrado com outra chave, ou lixo. Todos levam ao mesmo
    // lugar, e de propósito: distinguir os casos vazaria informação.
    return null;
  }
}

/* ------------------------------------------------------------------ JWT --- */

export interface CorpoDoToken {
  /** O `userId` do Yu-book. */
  sub: string;
  /** O cliente OAuth que recebeu o token. */
  cid: string;
  /** Escopos concedidos, separados por espaço, como manda o OAuth. */
  scope: string;
  /** Para quem este token foi emitido — a URL pública deste servidor. */
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  /**
   * O `accessToken` da `apps/api` que este token carrega, **selado**.
   *
   * O corpo de um JWT é base64url, não cifra: quem tem o token lê tudo o que
   * há dentro. Se o token da API viajasse legível, o cliente MCP ganharia uma
   * credencial que fala **direto** com a `apps/api`, contornando todo escopo
   * que este servidor confere — o `yubook:write` viraria decorativo. Por isso
   * passa por `selar()`: só quem tem o `MCP_SEGREDO` abre.
   */
  atk: string;
  /**
   * Quando o token da API lá dentro expira, em epoch/segundos. Vai em claro
   * porque não é segredo, e é o que permite conferir o compasso sem decifrar.
   */
  axp: number;
}

const CABECALHO = b64u(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));

function assinar(conteudo: string): string {
  return b64u(createHmac("sha256", CHAVE_ASSINATURA).update(conteudo).digest());
}

/**
 * O token de acesso é **sem estado**: tudo o que a verificação precisa está
 * dentro dele. É o que permite verificar sem banco e sobreviver a um redeploy.
 */
export function assinarToken(corpo: Omit<CorpoDoToken, "iss" | "iat" | "exp">, segundos: number): string {
  const agora = Math.floor(Date.now() / 1000);
  const completo: CorpoDoToken = {
    ...corpo,
    iss: env.urlPublica ?? "",
    iat: agora,
    exp: agora + segundos,
  };
  const conteudo = `${CABECALHO}.${b64u(Buffer.from(JSON.stringify(completo)))}`;
  return `${conteudo}.${assinar(conteudo)}`;
}

export function verificarToken(token: string): CorpoDoToken | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [cabecalho, corpo, assinatura] = partes as [string, string, string];

  const esperada = Buffer.from(assinar(`${cabecalho}.${corpo}`));
  const recebida = Buffer.from(assinatura);
  // Comparação de tempo constante: `===` em assinatura vaza, por diferença de
  // tempo, quantos bytes iniciais bateram.
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  try {
    const dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as CorpoDoToken;

    // Token emitido por uma versão anterior deste servidor, que ainda não
    // carregava a credencial da API. Ele **passa** pela assinatura, porque o
    // `MCP_SEGREDO` é o mesmo — é justamente isso que faz um redeploy não
    // expulsar ninguém. Sem esta linha, o `abrir(corpo.atk)` lá adiante
    // estouraria em `undefined.split` e o cliente receberia 500 em vez de 401,
    // que é o único código que o faz renovar.
    if (typeof dados.atk !== "string" || typeof dados.axp !== "number") return null;

    const agora = Math.floor(Date.now() / 1000);
    if (dados.exp <= agora) return null;
    // O token da API embutido venceu antes deste — por construção isto **nunca**
    // acontece: `emitirTokens` deriva `exp` de `axp` menos uma margem, então
    // `exp < axp` sempre. É justamente por isso que a linha vale: se um dia
    // alguém trocar a derivação por um número fixo, o desalinhamento aparece
    // aqui, como 401 na fronteira, e não como 401 dentro de uma tool.
    if (dados.axp <= agora) return null;
    // `aud` é o que impede um token emitido para outro servidor de valer aqui.
    // É a diferença entre emitir token e aceitar token repassado — o
    // anti-padrão que a especificação do MCP chama de "token passthrough".
    if (dados.aud !== env.urlPublica) return null;
    return dados;
  } catch {
    return null;
  }
}
