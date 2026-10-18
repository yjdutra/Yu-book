import { Prisma } from "@prisma/client";
import type {
  EmblemaDaSkill,
  HabitColor,
  SkillInput,
  SkillItem,
  SkillUpdateInput,
  SkillUseResult,
} from "@yu-book/shared";
import { nivelDaSkill } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import type { OrigemIA } from "../../lib/marca.js";
import { camposDoRegistro, hojeDoUsuario, paraColunaDia } from "../habitos/vinculo.service.js";

/**
 * Skills — frente Ritmo, Ritmo 5 (docs/prd-ritmo.md, §8).
 *
 * Posse direta por `user_id` em skill e uso (INV-01). Os usos não se agregam
 * em coluna: a contagem sai da leitura (P3), numa consulta agrupada para a
 * lista inteira.
 */

const arquivada = (mensagem: string) => new AppError(409, "VALIDATION_ERROR", mensagem);
const paraDia = (data: Date) => data.toISOString().slice(0, 10);

/** RN-32: o nome repetido chega do banco como `P2002` na unique. */
function nomeRepetido(erro: unknown): never {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
    throw new AppError(409, "NOME_DUPLICADO", "Já existe uma skill com esse nome");
  }
  throw erro;
}

const CAMPOS = {
  id: true,
  name: true,
  description: true,
  whenToUse: true,
  emblem: true,
  color: true,
  position: true,
  archivedAt: true,
  createdAt: true,
} satisfies Prisma.SkillSelect;

type Linha = Prisma.SkillGetPayload<{ select: typeof CAMPOS }>;

/** As skills com os usos: total, de hoje e o último. Duas consultas agrupadas. */
async function comUsos(userId: string, linhas: Linha[]): Promise<SkillItem[]> {
  if (linhas.length === 0) return [];
  const hoje = await hojeDoUsuario(userId);
  const ids = linhas.map((l) => l.id);
  const [total, deHoje] = await Promise.all([
    prisma.skillUse.groupBy({
      by: ["skillId"],
      where: { userId, skillId: { in: ids } },
      _count: { _all: true },
      _max: { usedAt: true },
    }),
    prisma.skillUse.groupBy({
      by: ["skillId"],
      where: { userId, skillId: { in: ids }, day: paraColunaDia(hoje) },
      _count: { _all: true },
    }),
  ]);
  const porSkill = new Map(total.map((t) => [t.skillId, t]));
  const hojePorSkill = new Map(deHoje.map((t) => [t.skillId, t._count._all]));
  return linhas.map((l) => {
    const usos = porSkill.get(l.id)?._count._all ?? 0;
    return {
      id: l.id,
      name: l.name,
      description: l.description,
      whenToUse: l.whenToUse,
      // O schema só deixa entrar o catálogo; a coluna é texto para ele crescer.
      emblem: l.emblem as EmblemaDaSkill,
      color: l.color as HabitColor,
      position: l.position,
      archived: l.archivedAt !== null,
      uses: usos,
      usesToday: hojePorSkill.get(l.id) ?? 0,
      lastUsedAt: porSkill.get(l.id)?._max.usedAt?.toISOString() ?? null,
      level: nivelDaSkill(usos),
      createdAt: l.createdAt.toISOString(),
    };
  });
}

const ORDEM = [{ position: "asc" }, { createdAt: "asc" }] as const;

/** RF-47. */
export async function listarSkills(userId: string, includeArchived: boolean) {
  const linhas = await prisma.skill.findMany({
    where: { userId, ...(!includeArchived && { archivedAt: null }) },
    select: CAMPOS,
    orderBy: [...ORDEM],
  });
  return comUsos(userId, linhas);
}

async function buscarSkill(userId: string, id: string): Promise<SkillItem> {
  const linha = await prisma.skill.findFirst({ where: { id, userId }, select: CAMPOS });
  if (!linha) throw notFound("Skill não encontrada");
  const [item] = await comUsos(userId, [linha]);
  return item as SkillItem;
}

/** RF-48. */
export async function criarSkill(userId: string, input: SkillInput): Promise<SkillItem> {
  const posicao = await prisma.skill.count({ where: { userId } });
  const { id } = await prisma.skill
    .create({
      data: {
        userId,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        whenToUse: input.whenToUse?.trim() ?? "",
        emblem: input.emblem ?? "raio",
        color: input.color ?? "violeta",
        position: posicao,
      },
      select: { id: true },
    })
    .catch(nomeRepetido);
  return buscarSkill(userId, id);
}

/** RF-48: editar e arquivar (RN-33). */
export async function atualizarSkill(
  userId: string,
  id: string,
  input: SkillUpdateInput,
): Promise<SkillItem> {
  const { count } = await prisma.skill
    .updateMany({
      where: { id, userId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.description !== undefined && { description: input.description.trim() }),
        ...(input.whenToUse !== undefined && { whenToUse: input.whenToUse.trim() }),
        ...(input.emblem !== undefined && { emblem: input.emblem }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.archived !== undefined && { archivedAt: input.archived ? new Date() : null }),
      },
    })
    .catch(nomeRepetido);
  if (count === 0) throw notFound("Skill não encontrada");
  return buscarSkill(userId, id);
}

/** RF-48: leva os usos junto (cascata). */
export async function excluirSkill(userId: string, id: string): Promise<void> {
  const { count } = await prisma.skill.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Skill não encontrada");
}

/**
 * RF-49: grava um uso agora, no dia de hoje do usuário. Arquivada não recebe
 * uso (RN-33). `levelUp` compara o nível antes e depois deste uso.
 */
export async function usarSkill(
  userId: string,
  id: string,
  origem?: OrigemIA,
): Promise<SkillUseResult> {
  const skill = await prisma.skill.findFirst({
    where: { id, userId },
    select: { id: true, archivedAt: true },
  });
  if (!skill) throw notFound("Skill não encontrada");
  if (skill.archivedAt) throw arquivada("Skill arquivada não recebe uso");
  const hoje = await hojeDoUsuario(userId);
  const uso = await prisma.skillUse.create({
    data: { userId, skillId: id, day: paraColunaDia(hoje), ...camposDoRegistro(origem) },
  });
  const depois = await buscarSkill(userId, id);
  const antes = nivelDaSkill(depois.uses - 1);
  return {
    use: {
      id: uso.id,
      skillId: id,
      usedAt: uso.usedAt.toISOString(),
      day: paraDia(uso.day),
      ai: uso.aiVia ? { via: uso.aiVia, author: uso.aiAuthor, agentName: uso.aiAgentName } : null,
    },
    skill: depois,
    levelUp: depois.level.key !== antes.key ? depois.level : null,
  };
}

/** RF-49: desfaz um uso. */
export async function desfazerUso(userId: string, id: string): Promise<void> {
  const { count } = await prisma.skillUse.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Uso não encontrado");
}
