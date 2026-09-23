import type { AiFavorite, AiSettings, AiSettingsPatch, AiTask } from "@yu-book/shared";
import {
  FUSO_PADRAO,
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
} from "@yu-book/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { resumoDoDia, type TetoDoUsuario } from "./custo.service.js";
import { acharModelo, ehVarianteDeLote } from "./modelos.service.js";

/** Erro de entrada, no molde dos outros módulos. */
const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);

type FavoritoNoBanco = Prisma.AiModelFavoriteGetPayload<object>;

/**
 * "Gratuito" é derivado do preço, nunca guardado: uma coluna seria um terceiro
 * lugar decidindo a mesma coisa.
 */
function toFavorite(f: FavoritoNoBanco): AiFavorite {
  return {
    id: f.modelId,
    name: f.name,
    contextLength: f.contextLength,
    promptMicros: f.promptMicros,
    completionMicros: f.completionMicros,
    supportsTools: f.supportsTools,
    free: f.promptMicros === 0 && f.completionMicros === 0,
    favoriteId: f.id,
    snapshotAt: f.snapshotAt.toISOString(),
  };
}

/**
 * O teto e o fuso do usuário — a linha, ou os padrões de `packages/shared`.
 *
 * **Não grava.** Um `GET` que escreve é surpresa, e criaria linha para quem
 * nunca configurou nada. Quem cria é o `PATCH`. A propriedade que importa —
 * nunca 404 por falta de configuração — continua valendo, e o padrão segue com
 * uma fonte só.
 */
export interface PreferenciaDeIa extends TetoDoUsuario {
  allowTraining: boolean;
}

export async function preferenciaDe(userId: string): Promise<PreferenciaDeIa> {
  const linha = await prisma.aiPreference.findUnique({ where: { userId } });
  return {
    dailyCapMicros: linha?.dailyCapMicros ?? TETO_DIARIO_PADRAO_MICROS,
    timezone: linha?.timezone ?? FUSO_PADRAO,
    allowTraining: linha?.allowTraining ?? TREINO_PERMITIDO_PADRAO,
  };
}

export async function atualizarPreferencia(
  userId: string,
  patch: AiSettingsPatch,
): Promise<AiSettings> {
  const atual = await preferenciaDe(userId);
  const dailyCapMicros = patch.dailyCapMicros ?? atual.dailyCapMicros;
  const timezone = patch.timezone ?? atual.timezone;
  const allowTraining = patch.allowTraining ?? atual.allowTraining;

  await prisma.aiPreference.upsert({
    where: { userId },
    create: { userId, dailyCapMicros, timezone, allowTraining },
    update: { dailyCapMicros, timezone, allowTraining },
  });

  return montarSettings(userId);
}

export async function listarFavoritos(userId: string): Promise<AiFavorite[]> {
  const favoritos = await prisma.aiModelFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return favoritos.map(toFavorite);
}

/**
 * Favoritar é idempotente, no molde de `criar` de `links.service.ts`: procura,
 * cria, e trata o empate do índice único devolvendo o que já existe. Dois
 * cliques não viram erro na cara do usuário.
 *
 * A cópia do catálogo é gravada junto de propósito — a estimativa de custo não
 * pode buscar as centenas de modelos do provedor dentro de uma requisição, e a
 * tela precisa listar favoritos com o provedor fora do ar.
 */
export async function favoritar(
  userId: string,
  modelId: string,
): Promise<{ favorito: AiFavorite; criado: boolean }> {
  const existente = await prisma.aiModelFavorite.findUnique({
    where: { userId_modelId: { userId, modelId } },
  });
  if (existente) return { favorito: toFavorite(existente), criado: false };

  const modelo = await acharModelo(modelId);
  if (!modelo) throw invalido(`O modelo "${modelId}" não está no catálogo do provedor.`);

  try {
    const criado = await prisma.aiModelFavorite.create({
      data: {
        userId,
        modelId: modelo.id,
        name: modelo.name,
        contextLength: modelo.contextLength,
        promptMicros: modelo.promptMicros,
        completionMicros: modelo.completionMicros,
        supportsTools: modelo.supportsTools,
      },
    });
    return { favorito: toFavorite(criado), criado: true };
  } catch (erro) {
    // Dois cliques simultâneos: o índice único decide, e quem perdeu devolve o
    // que já existe.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      const salvo = await prisma.aiModelFavorite.findUnique({
        where: { userId_modelId: { userId, modelId } },
      });
      if (salvo) return { favorito: toFavorite(salvo), criado: false };
    }
    throw erro;
  }
}

/**
 * Desfavoritar também limpa a tarefa que apontava para o modelo — senão a
 * escolha ficaria apontando para um snapshot que não existe mais, e a
 * estimativa de custo não teria preço.
 */
export async function desfavoritar(userId: string, favoriteId: string): Promise<void> {
  /// Tudo numa transação, e o `deleteMany` leva o `userId` **dentro** do filtro:
  /// ler para conferir e apagar por `id` depois é a corrida que dois cliques
  /// rápidos ganham — o segundo bateria num `delete` sem alvo e viraria 500 em
  /// vez de 404. É a forma dos outros cinco deletes do projeto.
  const removido = await prisma.$transaction(async (tx) => {
    const favorito = await tx.aiModelFavorite.findFirst({ where: { id: favoriteId, userId } });
    if (!favorito) return false;

    await tx.aiTaskModel.deleteMany({ where: { userId, modelId: favorito.modelId } });
    const { count } = await tx.aiModelFavorite.deleteMany({ where: { id: favoriteId, userId } });
    return count > 0;
  });

  if (!removido) throw notFound("Favorito não encontrado");
}

async function taskModels(userId: string): Promise<AiSettings["taskModels"]> {
  const linhas = await prisma.aiTaskModel.findMany({ where: { userId } });
  const mapa: AiSettings["taskModels"] = {};
  for (const linha of linhas) mapa[linha.task] = linha.modelId;
  return mapa;
}

/**
 * O modelo padrão de uma tarefa **tem que ser um favorito**: é o que garante
 * que a estimativa de custo sempre encontra o snapshot de preço, sem ir ao
 * catálogo dentro da requisição.
 */
export async function definirModeloDaTarefa(
  userId: string,
  task: AiTask,
  modelId: string | null,
): Promise<AiSettings["taskModels"]> {
  if (modelId === null) {
    await prisma.aiTaskModel.deleteMany({ where: { userId, task } });
    return taskModels(userId);
  }

  const favorito = await prisma.aiModelFavorite.findUnique({
    where: { userId_modelId: { userId, modelId } },
  });
  if (!favorito) throw invalido("Escolha um modelo que esteja nos seus favoritos.");

  await prisma.aiTaskModel.upsert({
    where: { userId_task: { userId, task } },
    create: { userId, task, modelId },
    update: { modelId },
  });
  return taskModels(userId);
}

/**
 * **O ponto único da escolha de modelo.**
 *
 * Hoje só lê a preferência. É aqui que uma regra futura de conteúdo sensível
 * entra — "esta nota não pode ir para um modelo de rota aberta" —, sem que
 * nenhum chamador precise mudar.
 */
export async function modeloParaTarefa(userId: string, task: AiTask): Promise<AiFavorite> {
  const escolha = await prisma.aiTaskModel.findUnique({ where: { userId_task: { userId, task } } });
  if (!escolha) {
    throw new AppError(
      422,
      "MODELO_NAO_ESCOLHIDO",
      "Escolha um modelo para esta tarefa nos ajustes de IA.",
    );
  }

  const favorito = await prisma.aiModelFavorite.findUnique({
    where: { userId_modelId: { userId, modelId: escolha.modelId } },
  });
  if (!favorito) {
    throw new AppError(
      422,
      "MODELO_NAO_ESCOLHIDO",
      "O modelo escolhido para esta tarefa saiu dos favoritos. Escolha outro nos ajustes.",
    );
  }

  /// Favorito de lote gravado antes de o catálogo passar a filtrá-los. O
  /// provedor recusaria com 404 e uma frase em inglês sobre adaptadores; aqui a
  /// recusa diz o que fazer.
  if (ehVarianteDeLote(favorito.modelId)) {
    throw new AppError(
      422,
      "MODELO_NAO_ESCOLHIDO",
      `"${favorito.name}" é uma variante de lote e não serve para esta tarefa. ` +
        "Remova-a dos favoritos e escolha a versão normal do modelo.",
    );
  }

  return toFavorite(favorito);
}

/** A tela de ajustes inteira numa requisição — os três blocos aparecem juntos. */
export async function montarSettings(userId: string): Promise<AiSettings> {
  const preferencia = await preferenciaDe(userId);
  const [usage, favorites, tarefas] = await Promise.all([
    resumoDoDia(userId, preferencia.timezone),
    listarFavoritos(userId),
    taskModels(userId),
  ]);

  return {
    dailyCapMicros: preferencia.dailyCapMicros,
    timezone: preferencia.timezone,
    allowTraining: preferencia.allowTraining,
    usage,
    favorites,
    taskModels: tarefas,
  };
}
