import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FERRAMENTAS_DO_ACERVO, formatarSkills } from "@yu-book/shared";
import type { SkillItem, SkillUseResult } from "@yu-book/shared";
import { origemDoCliente } from "../autor.js";
import { api, ErroDaApi } from "../cliente.js";
import { comErro, comErroDeEscrita } from "../erros.js";
import { relatar } from "../notificacoes.js";

/**
 * As skills (frente Ritmo, Ritmo 5 — RF-53): `list_skills` sempre;
 * `upsert_skill` e `log_skill_use` só com a escrita liberada. Só o uso manda
 * `origin` — a skill é configuração, como o hábito (RN-12 da Ritmo 1).
 */

const SEM_SKILLS =
  "A API do Yu-book no ar ainda não tem skills (/skills não existe nela). " +
  "Tentar de novo não resolve.";

const recusa = (texto: string): CallToolResult => ({
  content: [{ type: "text", text: texto }],
  isError: true,
});

export function registrarToolsDeSkills(server: McpServer): void {
  const lista = FERRAMENTAS_DO_ACERVO.list_skills;
  server.registerTool(
    "list_skills",
    {
      title: lista.titulo,
      description: lista.descricao,
      annotations: lista.anotacoes,
      inputSchema: lista.entrada,
    },
    comErro(async () => {
      let skills: SkillItem[];
      try {
        skills = await api.get<SkillItem[]>("/skills");
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") return recusa(SEM_SKILLS);
        throw erro;
      }
      return { content: [{ type: "text", text: formatarSkills(skills) }] };
    }),
  );
}

export function registrarEscritaDeSkills(server: McpServer): void {
  const upsert = FERRAMENTAS_DO_ACERVO.upsert_skill;
  server.registerTool(
    "upsert_skill",
    {
      title: upsert.titulo,
      description: upsert.descricao,
      annotations: upsert.anotacoes,
      inputSchema: upsert.entrada,
    },
    comErroDeEscrita(async ({ skillId, ...campos }, extra) => {
      const mudanca = Object.fromEntries(
        Object.entries(campos).filter(([, valor]) => valor !== undefined),
      );
      if (!skillId && mudanca["name"] === undefined) {
        return recusa("**Nada foi criado.** Skill nova precisa de `name`.");
      }
      if (skillId && Object.keys(mudanca).length === 0) {
        return recusa("**Nada foi alterado.** Mande pelo menos um campo para mudar.");
      }
      if (!skillId && mudanca["archived"] !== undefined) {
        return recusa("**Nada foi criado.** `archived` só vale com `skillId`.");
      }
      const relato = relatar(server, extra, "upsert_skill", 1);
      let skill: SkillItem;
      try {
        skill = skillId
          ? await api.patch<SkillItem>(`/skills/${skillId}`, mudanca)
          : await api.post<SkillItem>("/skills", mudanca);
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(
            skillId
              ? "**Nada foi alterado.** Não existe skill com esse id nesta conta — o id vem de " +
                  "`list_skills` —, ou a API no ar ainda não tem skills."
              : `**Nada foi criado.** ${SEM_SKILLS}`,
          );
        }
        throw erro;
      }
      await relato.passo(skillId ? "skill alterada" : "skill criada");
      await relato.registrar("info", {
        acao: skillId ? "skill alterada" : "skill criada",
        skillId: skill.id,
      });
      return {
        content: [
          {
            type: "text",
            text: `${skillId ? "Skill alterada" : "Skill criada"}.\n\n${formatarSkills([skill])}`,
          },
        ],
      };
    }),
  );

  const usar = FERRAMENTAS_DO_ACERVO.log_skill_use;
  server.registerTool(
    "log_skill_use",
    {
      title: usar.titulo,
      description: usar.descricao,
      annotations: usar.anotacoes,
      inputSchema: usar.entrada,
    },
    comErroDeEscrita(async ({ skillId }, extra) => {
      const relato = relatar(server, extra, "log_skill_use", 1);
      const origin = await origemDoCliente(server, extra);
      let resultado: SkillUseResult;
      try {
        resultado = await api.post<SkillUseResult>(`/skills/${skillId}/uses`, { origin });
      } catch (erro) {
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return recusa(
            "**Nada foi registrado.** Não existe skill com esse id nesta conta — o id vem de " +
              "`list_skills` —, ou a API no ar ainda não tem skills.",
          );
        }
        throw erro;
      }
      await relato.passo("uso registrado");
      await relato.registrar("info", {
        acao: "uso de skill registrado",
        skillId,
        useId: resultado.use.id,
        author: origin.author,
      });
      const subiu = resultado.levelUp ? ` Subiu para ${resultado.levelUp.name}!` : "";
      return {
        content: [
          {
            type: "text",
            text: `Uso registrado.${subiu}\n\n${formatarSkills([resultado.skill])}`,
          },
        ],
      };
    }),
  );
}
