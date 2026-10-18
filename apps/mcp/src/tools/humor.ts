import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FERRAMENTAS_DO_ACERVO, formatarHumor } from "@yu-book/shared";
import type { MoodDayItem } from "@yu-book/shared";
import { origemDoCliente } from "../autor.js";
import { api, ErroDaApi } from "../cliente.js";
import { comErro, comErroDeEscrita } from "../erros.js";
import { relatar } from "../notificacoes.js";

/**
 * O humor (frente Ritmo, Ritmo 4 — RF-46): `get_mood` sempre, `log_mood` só
 * com a escrita liberada (`criarServidor`). O dia é do usuário e a API o
 * resolve (RN-27): nada de fuso deste lado. `log_mood` manda `origin`, como
 * `log_habit` — o humor guarda quem gravou.
 */

const SEM_HUMOR =
  "A API do Yu-book no ar ainda não tem humor (/moods não existe nela). " +
  "Tentar de novo não resolve.";

const recusa = (texto: string): CallToolResult => ({
  content: [{ type: "text", text: texto }],
  isError: true,
});

export function registrarToolsDeHumor(server: McpServer): void {
  const ler = FERRAMENTAS_DO_ACERVO.get_mood;
  server.registerTool(
    "get_mood",
    {
      title: ler.titulo,
      description: ler.descricao,
      annotations: ler.anotacoes,
      inputSchema: ler.entrada,
    },
    comErro(async ({ from, to }) => {
      const busca = new URLSearchParams();
      if (from) busca.set("from", from);
      if (to) busca.set("to", to);
      let dias: MoodDayItem[];
      try {
        dias = await api.get<MoodDayItem[]>("/moods", busca);
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") return recusa(SEM_HUMOR);
        throw erro;
      }
      return { content: [{ type: "text", text: formatarHumor(dias) }] };
    }),
  );
}

export function registrarEscritaDeHumor(server: McpServer): void {
  const gravar = FERRAMENTAS_DO_ACERVO.log_mood;
  server.registerTool(
    "log_mood",
    {
      title: gravar.titulo,
      description: gravar.descricao,
      annotations: gravar.anotacoes,
      inputSchema: gravar.entrada,
    },
    comErroDeEscrita(async (entrada, extra) => {
      const campos = Object.fromEntries(
        Object.entries(entrada).filter(([, valor]) => valor !== undefined),
      );
      const { day: _dia, ...momentos } = campos;
      if (Object.keys(momentos).length === 0) {
        return recusa("**Nada foi gravado.** Mande pelo menos um momento ou a descrição.");
      }
      const relato = relatar(server, extra, "log_mood", 1);
      const origin = await origemDoCliente(server, extra);
      let dia: MoodDayItem | null;
      try {
        dia = await api.put<MoodDayItem | null>("/moods", { ...campos, origin });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(`**Nada foi gravado.** ${SEM_HUMOR}`);
        }
        throw erro;
      }
      await relato.passo("humor gravado");
      await relato.registrar("info", {
        acao: "humor gravado",
        day: dia?.day,
        author: origin.author,
      });
      return {
        content: [
          {
            type: "text",
            text: dia
              ? `Humor gravado.\n\n${formatarHumor([dia])}`
              : "O dia ficou sem momento nem descrição, e o registro dele foi apagado.",
          },
        ],
      };
    }),
  );
}
