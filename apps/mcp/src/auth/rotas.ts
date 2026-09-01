import { rateLimit } from "express-rate-limit";
import express from "express";
import type { Router } from "express";
import { ErroDaApi } from "../cliente.js";
import { CABECALHOS_DA_PAGINA, paginaDeLogin } from "./pagina.js";
import { abrirPedido, emitirCodigo, registroDeClientes } from "./provedor.js";
import { entrarNaApi } from "./sessao-api.js";

/**
 * A recusa, dita para uma pessoa.
 *
 * **Não usa `mensagemDeErro`**, e a distinção não é preciosismo: aquele texto é
 * escrito para o modelo, e traduz código de erro em instrução de como contornar
 * — "confirme o id com search_notes", "renove o token". Quem lê esta tela é uma
 * pessoa que acabou de digitar uma senha, e o que ela precisa saber é se errou
 * a senha ou se o servidor está fora do ar.
 *
 * Só a mensagem do 401 vem da API; qualquer outro estado vira texto genérico,
 * porque esta página é pública e detalhe interno não desce para ela.
 */
function motivoParaGente(erro: unknown): string {
  if (erro instanceof ErroDaApi && erro.status === 401) return erro.message;
  if (erro instanceof ErroDaApi && erro.status === 429) {
    return "Tentativas demais. Espere alguns minutos e tente de novo.";
  }
  return "Não foi possível entrar agora. Tente de novo em instantes.";
}

/**
 * `POST /login` — a rota que o SDK não previu.
 *
 * O `mcpAuthRouter` monta `/authorize`, mas o provedor recebe só
 * `(client, params, res)`: **o `req` não chega**, então o formulário de login
 * não tem como postar de volta para lá. Esta rota é a outra metade do
 * `authorize`, e é o único lugar do servidor que toca numa senha.
 *
 * Ela não guarda a senha: usa uma vez para chamar `POST /auth/login` da API e
 * descarta. O que sobrevive é a sessão resultante.
 */
export function rotasDeLogin(): Router {
  const router = express.Router();

  router.use(express.urlencoded({ extended: false }));

  // Cada acerto aqui vira um login de verdade na API, que tem limite de 10 por
  // 5 minutos por IP — e todo o tráfego deste servidor sai do mesmo IP. Limitar
  // antes é o que faz a mensagem de erro ser nossa, e não um 429 da API.
  router.use(
    rateLimit({
      windowMs: 5 * 60_000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { erro: "Tentativas demais. Espere alguns minutos." },
    }),
  );

  router.post("/login", async (req, res) => {
    const { pedido: envelope, email, senha, escrita } = req.body as Record<string, unknown>;

    const pedido = typeof envelope === "string" ? abrirPedido(envelope) : null;
    if (!pedido) {
      // Sem pedido válido não há para onde redirecionar — responder na página
      // é o único caminho honesto.
      res.status(400).set(CABECALHOS_DA_PAGINA).send(
        paginaDeLogin({
          pedido: "",
          nomeDoCliente: "Cliente desconhecido",
          erro: "Este pedido de autorização expirou. Volte ao cliente e tente de novo.",
        }),
      );
      return;
    }

    const cliente = await registroDeClientes.getClient(pedido.clientId);
    const nomeDoCliente = cliente?.client_name ?? "Um cliente MCP";

    if (typeof email !== "string" || typeof senha !== "string") {
      res.status(400).set(CABECALHOS_DA_PAGINA).send(
        paginaDeLogin({ pedido: envelope as string, nomeDoCliente, erro: "Informe email e senha." }),
      );
      return;
    }

    try {
      const sessao = await entrarNaApi(email, senha);
      const codigo = emitirCodigo(pedido, sessao, escrita === "1");

      const destino = new URL(pedido.redirectUri);
      destino.searchParams.set("code", codigo);
      if (pedido.state !== undefined) destino.searchParams.set("state", pedido.state);
      res.redirect(302, destino.href);
    } catch (erro) {
      // Senha errada é problema desta página, não do cliente OAuth: **nunca**
      // redirecionar com `error` para o `redirect_uri` por credencial inválida.
      // O cliente ficaria com um erro que ele não pode resolver, e o usuário
      // perderia a chance de digitar de novo.
      console.error("[yu-book-mcp] falha no login:", erro);
      res.status(401).set(CABECALHOS_DA_PAGINA).send(
        paginaDeLogin({ pedido: envelope as string, nomeDoCliente, erro: motivoParaGente(erro) }),
      );
    }
  });

  return router;
}
