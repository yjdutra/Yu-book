import { env } from "../env.js";

/**
 * A tela de login e consentimento.
 *
 * Ela é servida pelo próprio `apps/mcp` — e não delegada a uma tela do
 * `apps/web` — porque delegar exigiria uma rota de consentimento no front e uma
 * de retorno na API, mais superfície para o mesmo resultado. Se um dia a
 * `apps/api` virar o servidor de autorização, esta página morre e o provedor
 * passa a ser um proxy.
 *
 * **Nada de JavaScript.** É HTML e CSS embutido, com `default-src 'none'` no
 * cabeçalho de política de conteúdo: é a página onde uma senha é digitada, e o
 * jeito mais barato de garantir que nenhum script a leia é não ter script.
 */

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ESTILO = `
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0d10; color:#e6e8eb;
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif }
  main { width:min(400px,92vw); padding:32px }
  h1 { font-size:19px; margin:0 0 4px }
  p.sub { margin:0 0 24px; color:#9aa3ad; font-size:13px }
  label { display:block; font-size:13px; color:#9aa3ad; margin:14px 0 5px }
  input[type=email], input[type=password] {
    width:100%; padding:9px 11px; border-radius:7px; border:1px solid #2a2f36;
    background:#14171b; color:#e6e8eb; font:inherit }
  input:focus { outline:2px solid #6366f1; outline-offset:1px; border-color:transparent }
  .permissao { margin:22px 0 4px; padding:13px; border:1px solid #2a2f36;
               border-radius:8px; background:#101317 }
  .permissao p { margin:0 0 9px; font-size:13px; color:#9aa3ad }
  .permissao strong { color:#e6e8eb }
  .caixa { display:flex; gap:9px; align-items:flex-start; font-size:13px; cursor:pointer }
  .caixa input { margin-top:3px; accent-color:#6366f1 }
  button { width:100%; margin-top:22px; padding:10px; border:0; border-radius:7px;
           background:#6366f1; color:#fff; font:inherit; font-weight:600; cursor:pointer }
  button:hover { background:#4f46e5 }
  .erro { margin:0 0 18px; padding:11px; border-radius:7px; font-size:13px;
          background:#2a1416; border:1px solid #5b2028; color:#f3b7bd }
  footer { margin-top:20px; font-size:12px; color:#6b737d }
  .desligado { margin:10px 0 0; font-size:13px; color:#9aa2ad }
  .desligado code { color:#c8ced6 }
`;

export interface DadosDaPagina {
  /** O envelope do pedido de autorização, devolvido intacto no formulário. */
  pedido: string;
  nomeDoCliente: string;
  erro?: string;
}

export function paginaDeLogin({ pedido, nomeDoCliente, erro }: DadosDaPagina): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar no Yu-book</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
  <h1>Conectar ao Yu-book</h1>
  <p class="sub"><strong>${escapar(nomeDoCliente)}</strong> quer acessar seu segundo cérebro.</p>
  ${erro ? `<p class="erro">${escapar(erro)}</p>` : ""}
  <form method="post" action="/login">
    <input type="hidden" name="pedido" value="${escapar(pedido)}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autocomplete="username" autofocus>
    <label for="senha">Senha</label>
    <input id="senha" name="senha" type="password" required autocomplete="current-password">
    <div class="permissao">
      <p>Este cliente vai poder <strong>ler</strong> suas notas, quadros e links.</p>
      ${
        env.escritaHabilitada
          ? `<label class="caixa">
        <input type="checkbox" name="escrita" value="1">
        <span>Permitir também <strong>criar e mover cards</strong> e <strong>mandar notas
        para a lixeira</strong>.</span>
      </label>`
          : `<p class="desligado">A escrita está desligada neste servidor
        (<code>MCP_ESCRITA_HABILITADA=0</code>), então não há o que consentir: nenhuma sessão
        registra as tools que mudam dado.</p>`
      }
    </div>
    <button type="submit">Entrar e autorizar</button>
  </form>
  <footer>Conectando a ${escapar(env.YUBOOK_API_URL)}</footer>
</main>
</body>
</html>`;
}

/** Cabeçalhos da página de senha. Sem script, sem cache, sem embutir em iframe. */
/**
 * Os cabeçalhos da página de login e consentimento.
 *
 * `form-action` PRECISA INCLUIR A ORIGEM DO `redirect_uri`, e isto custou um
 * deploy para descobrir.
 *
 * O submit deste formulário termina, quando dá certo, num `302` para o
 * `redirect_uri` do cliente — que é outra origem por definição, normalmente um
 * `http://localhost:<porta>` que o cliente MCP abriu. **O navegador aplica
 * `form-action` também ao destino do redirecionamento que resulta de um
 * submit**, não só ao alvo do `action`. Com `'self'` sozinho, o POST sai, o
 * servidor responde o `302`, e o Chrome bloqueia o salto: a página parece não
 * fazer nada, sem erro visível fora do console.
 *
 * Nenhuma prova programática pega isto — `fetch` não passa por CSP. Só apareceu
 * num navegador de verdade, tentando conectar um cliente MCP real.
 *
 * A origem entra sozinha, e não é ampliação frouxa: é exatamente para onde este
 * pedido de autorização já vai redirecionar, e o `redirect_uri` foi validado
 * contra os registrados pelo handler do SDK antes de chegar aqui.
 */
export function cabecalhosDaPagina(redirectUri?: string): Record<string, string> {
  let destino = "";
  try {
    if (redirectUri) destino = ` ${new URL(redirectUri).origin}`;
  } catch {
    // `redirect_uri` que não é URL não vira permissão. Sem pedido válido não há
    // para onde redirecionar de qualquer forma.
  }

  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${destino}`,
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}
