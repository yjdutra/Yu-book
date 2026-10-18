import { describe, expect, it } from "vitest";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * O texto de `revisao_semanal` depende de a sessão ter escrita, e é isso que
 * se prova aqui, pela superfície do protocolo.
 *
 * O resto do texto não tem portão, de propósito: é instrução, e o que a valida
 * é o modelo seguindo-a. O que tem é a parte que pode **mentir** — oferecer
 * numa sessão só de leitura uma tool que ela não tem.
 */

const COMPLETO = identidade(["yubook:read", "yubook:write"]);

const texto = (r: GetPromptResult) =>
  r.messages.map((m) => (m.content.type === "text" ? m.content.text : "")).join("");

async function revisao(escrita: boolean, argumentos: Record<string, string> = {}) {
  const cliente = await abrirCliente({ escrita }, COMPLETO);
  try {
    return texto(await cliente.pegarPrompt("revisao_semanal", argumentos));
  } finally {
    await cliente.encerrar();
  }
}

describe("revisao_semanal", () => {
  it("lê a agenda da semana junto do painel, nas duas sessões", async () => {
    for (const escrita of [true, false]) {
      const t = await revisao(escrita);
      expect(t).toContain("`get_dashboard`");
      expect(t).toContain("`list_agenda` de hoje até hoje + 6 dias");
      expect(t).toContain("tarefa atrasada");
    }
  });

  it("com escrita, oferece as ações da agenda — só quando eu pedir", async () => {
    const t = await revisao(true);
    expect(t).toContain("criar, alterar, converter e excluir eventos");
    expect(t).toContain("concluir tarefas");
    expect(t).toContain("só quando eu pedir");
    expect(t).not.toContain("Esta sessão só lê");
  });

  it("sem escrita, não oferece ação de escrita nenhuma", async () => {
    const t = await revisao(false);
    expect(t).toContain("Esta sessão só lê");
    expect(t).not.toContain("criar eventos");
    expect(t).not.toContain("concluir cards");
  });

  it("com workspace, avisa que a agenda não filtra por ele", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const t = await revisao(true, { workspace: id });
    expect(t).toContain(`com workspaceId "${id}"`);
    expect(t).toContain("(ela não filtra por workspace)");
    expect(await revisao(true)).not.toContain("não filtra por workspace");
  });
});
