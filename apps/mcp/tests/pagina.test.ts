import { describe, expect, it } from "vitest";
import { cabecalhosDaPagina } from "../src/auth/pagina.js";

/**
 * O `form-action` da página de login, que quebrou o fluxo em produção.
 *
 * O defeito não aparecia em prova nenhuma porque **CSP é coisa de navegador**:
 * todo `fetch` deste repositório passa por cima dela. O sintoma no navegador era
 * mudo — clicar em "Entrar e autorizar" não fazia nada visível, porque o POST
 * saía, o servidor respondia o `302` para o `redirect_uri` do cliente, e o
 * Chrome bloqueava o salto por ele ser outra origem.
 */
describe("os cabeçalhos da página de autorização", () => {
  const csp = (redirectUri?: string) =>
    cabecalhosDaPagina(redirectUri)["Content-Security-Policy"] ?? "";

  it("permite o form chegar à origem do redirect_uri", () => {
    // Sem isto o navegador bloqueia o 302 que fecha a autorização, e o fluxo
    // OAuth morre em silêncio.
    expect(csp("http://localhost:3118/callback")).toContain("form-action 'self' http://localhost:3118");
  });

  it("permite só a origem, não o caminho", () => {
    const valor = csp("https://cliente.invalid/oauth/callback?x=1");
    expect(valor).toContain("https://cliente.invalid");
    expect(valor).not.toContain("/oauth/callback");
  });

  it("sem redirect_uri, fica só em 'self'", () => {
    // É o caso do pedido expirado: não há para onde redirecionar, então não há
    // origem a liberar.
    expect(csp()).toContain("form-action 'self'");
    expect(csp().split("form-action ")[1]).toBe("'self'");
  });

  it("redirect_uri que não é URL não vira permissão", () => {
    expect(csp("nao-e-uma-url").split("form-action ")[1]).toBe("'self'");
  });

  it("o resto da política continua fechado", () => {
    // A folga é no `form-action` e em lugar nenhum mais: a página não carrega
    // script, imagem nem fonte, e o estilo é inline por ser o único jeito sem
    // um segundo pedido.
    const cabecalhos = cabecalhosDaPagina("http://localhost:3118/callback");
    expect(cabecalhos["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(cabecalhos["X-Frame-Options"]).toBe("DENY");
    expect(cabecalhos["Referrer-Policy"]).toBe("no-referrer");
    expect(cabecalhos["Cache-Control"]).toBe("no-store");
  });
});
