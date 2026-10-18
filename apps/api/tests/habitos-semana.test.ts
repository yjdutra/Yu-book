import {
  habitEntryInputSchema,
  habitInputSchema,
  habitUpdateSchema,
  inicioDaSemana,
  semanaPonderada,
  taskInputSchema,
  tetoDiario,
} from "@yu-book/shared";
import { describe, expect, it } from "vitest";

/**
 * Frente Ritmo, Ritmo 1 (docs/prd-ritmo.md): a semana ponderada é uma função
 * pura de `packages/shared`, calculada na leitura (P3). Estes testes não sobem
 * o Fastify nem tocam o banco — conferem só a conta e os contratos.
 */
describe("semana ponderada (RF-10)", () => {
  it("o teto diário arredonda para cima: meta 100 em 3 dias vira 34 por dia", () => {
    expect(tetoDiario(120, 4)).toBe(30);
    expect(tetoDiario(100, 3)).toBe(34);
    expect(tetoDiario(10, 7)).toBe(2);
  });

  it("a semana começa na segunda, pelo calendário e sem fuso", () => {
    expect(inicioDaSemana("2026-10-18")).toBe("2026-10-12"); // domingo
    expect(inicioDaSemana("2026-10-12")).toBe("2026-10-12"); // segunda
    expect(inicioDaSemana("2026-10-14")).toBe("2026-10-12");
    // Virada de ano no meio da semana.
    expect(inicioDaSemana("2027-01-01")).toBe("2026-12-28");
  });

  it("o que passa do teto num dia vira extra e não conta para a meta (CA-04)", () => {
    const semana = semanaPonderada(
      { weeklyGoal: 120, targetDays: 4 },
      [
        { day: "2026-10-12", points: 30 },
        { day: "2026-10-12", points: 10 },
        { day: "2026-10-13", points: 10 },
      ],
      "2026-10-14",
    );
    expect(semana.cap).toBe(30);
    expect(semana.days[0]).toEqual({ day: "2026-10-12", points: 40, counted: 30 });
    expect(semana.progress).toBe(40);
    expect(semana.extra).toBe(10);
    expect(semana.activeDays).toBe(2);
    expect(semana.goalMet).toBe(false);
  });

  it("um dia só não paga a semana inteira", () => {
    const semana = semanaPonderada(
      { weeklyGoal: 120, targetDays: 4 },
      [{ day: "2026-10-15", points: 500 }],
      "2026-10-15",
    );
    expect(semana.progress).toBe(30);
    expect(semana.extra).toBe(470);
    expect(semana.goalMet).toBe(false);
  });

  it("bater a meta pede pelo menos os dias-alvo no teto", () => {
    const dias = ["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-17"];
    const semana = semanaPonderada(
      { weeklyGoal: 120, targetDays: 4 },
      dias.map((day) => ({ day, points: 30 })),
      "2026-10-18",
    );
    expect(semana.progress).toBe(120);
    expect(semana.goalMet).toBe(true);
  });

  it("registro fora da semana é ignorado, e os sete dias vêm sempre", () => {
    const semana = semanaPonderada(
      { weeklyGoal: 50, targetDays: 5 },
      [
        { day: "2026-10-11", points: 10 }, // domingo anterior
        { day: "2026-10-19", points: 10 }, // segunda seguinte
        { day: "2026-10-18", points: 5 },
      ],
      "2026-10-18",
    );
    expect(semana.start).toBe("2026-10-12");
    expect(semana.end).toBe("2026-10-18");
    expect(semana.days).toHaveLength(7);
    expect(semana.progress).toBe(5);
  });
});

describe("contratos dos hábitos", () => {
  it("o hábito nasce com padrões de cor e emblema, e atividades vazias", () => {
    const h = habitInputSchema.parse({ name: "  Inglês ", weeklyGoal: 120, targetDays: 4 });
    expect(h).toMatchObject({ name: "Inglês", color: "violeta", emblem: "estrela", activities: [] });
  });

  it("recusa limites de RN-01 e nome de atividade repetido", () => {
    expect(habitInputSchema.safeParse({ name: "A", weeklyGoal: 0, targetDays: 4 }).success).toBe(false);
    expect(habitInputSchema.safeParse({ name: "A", weeklyGoal: 10, targetDays: 8 }).success).toBe(false);
    expect(
      habitInputSchema.safeParse({
        name: "A",
        weeklyGoal: 10,
        targetDays: 1,
        activities: [
          { name: "App", points: 10 },
          { name: "App", points: 20 },
        ],
      }).success,
    ).toBe(false);
    expect(
      habitInputSchema.safeParse({
        name: "A",
        weeklyGoal: 10,
        targetDays: 1,
        activities: [{ name: "App", points: 501 }],
      }).success,
    ).toBe(false);
  });

  it("cor e emblema fora do catálogo são recusados", () => {
    expect(
      habitInputSchema.safeParse({ name: "A", weeklyGoal: 10, targetDays: 1, color: "laranja" }).success,
    ).toBe(false);
    expect(
      habitInputSchema.safeParse({ name: "A", weeklyGoal: 10, targetDays: 1, emblem: "dragao" }).success,
    ).toBe(false);
  });

  it("o PATCH do hábito vazio é recusado", () => {
    expect(habitUpdateSchema.safeParse({}).success).toBe(false);
    expect(habitUpdateSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it("registro avulso pede a atividade ou os pontos (RF-09)", () => {
    expect(habitEntryInputSchema.safeParse({}).success).toBe(false);
    expect(habitEntryInputSchema.safeParse({ points: 15 }).success).toBe(true);
    expect(
      habitEntryInputSchema.safeParse({ activityId: "8d3b0c1e-5a52-4f4e-9c0e-2f6c1f0a9b11" }).success,
    ).toBe(true);
    expect(habitEntryInputSchema.safeParse({ points: 15, day: "2026-02-30" }).success).toBe(false);
  });

  it("a tarefa aceita o vínculo com a atividade, nulo por padrão (RF-06)", () => {
    expect(taskInputSchema.parse({ title: "App" }).habitActivityId).toBeNull();
    expect(taskInputSchema.safeParse({ title: "App", habitActivityId: "x" }).success).toBe(false);
  });
});
