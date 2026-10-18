import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  formatarSkills,
  nivelDaSkill,
  skillDoDia,
} from "@yu-book/shared";
import type { HabitsSummary, SkillItem, SkillUseResult } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Skills — frente Ritmo, Ritmo 5 (docs/prd-ritmo.md, §8).
 *
 * Criar, usar e subir de nível, a skill arquivada que não recebe uso, o
 * recorte por usuário, o rodízio do dia e que skill não vira XP de hábito.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.65.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("skills-dono");
  intruso = await criarUsuario("skills-intruso");
  for (const u of [dono, intruso]) {
    await prisma.aiPreference.create({
      data: {
        userId: u.id,
        dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
        timezone: "America/Sao_Paulo",
        allowTraining: TREINO_PERMITIDO_PADRAO,
      },
    });
  }
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("skills (RF-47 a RF-50)", () => {
  let pausa: SkillItem;

  test("cria a skill Nova, com 0 usos; nome repetido é 409 (CA-30, RN-32)", async () => {
    const r = await api(dono, "POST", "/skills", {
      name: " Pausa tática ",
      description: "Antes de agir, 3 a 5 segundos de silêncio.",
      whenToUse: "Antes de responder no impulso.",
      emblem: "ampulheta",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    pausa = r.body as SkillItem;
    expect(pausa).toMatchObject({
      name: "Pausa tática",
      emblem: "ampulheta",
      uses: 0,
      level: { key: "nova", next: 1 },
    });
    expect((await api(dono, "POST", "/skills", { name: "Pausa tática" })).status).toBe(409);
  });

  test("o 15º uso sobe para Prata, o 16º não (CA-31)", async () => {
    await prisma.skillUse.createMany({
      data: Array.from({ length: 14 }, () => ({
        userId: dono.id,
        skillId: pausa.id,
        day: new Date("2026-10-01T00:00:00Z"),
      })),
    });
    const decimoQuinto = (await api(dono, "POST", `/skills/${pausa.id}/uses`, {}))
      .body as SkillUseResult;
    expect(decimoQuinto.skill.uses).toBe(15);
    expect(decimoQuinto.levelUp).toMatchObject({ key: "prata", next: 50 });
    expect(decimoQuinto.skill.usesToday).toBe(1);
    const decimoSexto = (await api(dono, "POST", `/skills/${pausa.id}/uses`, {}))
      .body as SkillUseResult;
    expect(decimoSexto.levelUp).toBeNull();
    // Desfazer tira o uso.
    expect((await api(dono, "DELETE", `/skill-uses/${decimoSexto.use.id}`)).status).toBe(204);
    const lista = (await api(dono, "GET", "/skills")).body as SkillItem[];
    expect(lista[0]?.uses).toBe(15);
  });

  test("a marca de IA só vem do MCP, e skill não vira XP (RN-31)", async () => {
    const r = await api(dono, "POST", `/skills/${pausa.id}/uses`, {
      origin: { via: "mcp", author: "Claude Code" },
    });
    expect((r.body as SkillUseResult).use.ai).toMatchObject({ via: "mcp" });
    const resumo = (await api(dono, "GET", "/habits/summary")).body as HabitsSummary;
    expect(resumo.xp).toBe(0);
  });

  test("arquivada não recebe uso; de outro usuário é 404 (CA-32)", async () => {
    expect((await api(intruso, "POST", `/skills/${pausa.id}/uses`, {})).status).toBe(404);
    expect((await api(intruso, "PATCH", `/skills/${pausa.id}`, { name: "x" })).status).toBe(404);
    expect(((await api(intruso, "GET", "/skills")).body as SkillItem[]).length).toBe(0);
    await api(dono, "PATCH", `/skills/${pausa.id}`, { archived: true });
    expect((await api(dono, "POST", `/skills/${pausa.id}/uses`, {})).status).toBe(409);
    expect(((await api(dono, "GET", "/skills")).body as SkillItem[]).length).toBe(0);
    const todas = (await api(dono, "GET", "/skills?includeArchived=true")).body as SkillItem[];
    expect(formatarSkills(todas)).toContain("Pausa tática (arquivada)");
  });

  test("sem token, 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/skills" });
    expect(resposta.statusCode).toBe(401);
  });
});

describe("as contas puras", () => {
  test("os limiares: Nova, Bronze 1, Prata 15, Ouro 50, Mestre 150 (RF-50)", () => {
    expect([0, 1, 14, 15, 49, 50, 149, 150, 999].map((u) => nivelDaSkill(u).key)).toEqual([
      "nova",
      "bronze",
      "bronze",
      "prata",
      "prata",
      "ouro",
      "ouro",
      "mestre",
      "mestre",
    ]);
    expect(nivelDaSkill(150)).toMatchObject({ next: null, nextName: null });
  });

  test("o rodízio: o mesmo no mesmo dia, o seguinte no dia seguinte, sem arquivadas (CA-33)", () => {
    const skills = ["a", "b", "c"].map((id) => ({ id, archived: false }));
    const hoje = skillDoDia(skills, "2026-10-18");
    expect(skillDoDia(skills, "2026-10-18")).toBe(hoje);
    const i = skills.indexOf(hoje as (typeof skills)[number]);
    expect(skillDoDia(skills, "2026-10-19")).toBe(skills[(i + 1) % 3]);
    expect(skillDoDia([{ id: "x", archived: true }], "2026-10-18")).toBeNull();
  });
});
