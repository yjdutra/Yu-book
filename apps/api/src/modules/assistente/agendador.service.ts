import { Prisma } from "@prisma/client";
import {
  FUSO_PADRAO,
  horariosDevidos,
  JANELA_DO_AGENDADOR_MS,
  proximaTentativa,
} from "@yu-book/shared";
import type { ErrorCode, RoutineInputKind } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { iniciar } from "./execucao.service.js";
import type { Registro, RegistroDaVarredura } from "./execucao.service.js";

/**
 * O agendador de rotinas — Etapa F da frente de IA.
 *
 * **Um relógio dentro da API**, ao lado da varredura de execuções
 * (`vigiarExecucoes`), e não um cron da Railway nem um serviço à parte: a
 * decisão de ter trabalho de fundo já foi tomada na Etapa E, e a F só decide
 * quem dispara. Nada de autenticação de máquina: quem inicia é o próprio
 * `iniciar`, com o `userId` do dono da rotina.
 *
 * **O que decide é o banco, nunca a memória (INV-60).** No deploy duas
 * instâncias convivem, e as duas rodam este relógio. Cada horário tem **uma
 * linha só** em `ai_routine_run`, garantida pelo único
 * `(routine_id, scheduled_for)`; quem a cria primeiro atende o horário.
 *
 * **A regra de recusa** (decisão do operador): recusa no início de um horário
 * — outra execução em andamento, sem ideia, teto do dia, rotina inválida,
 * qualquer uma — tenta de novo a cada 5 minutos, no máximo 3 vezes; depois
 * fica `pulada` com o motivo. Recusa de início não chama o provedor e não
 * custa nada. Execução que **começou** e falhou nunca é repetida: é ela que
 * cobraria de novo a cada tentativa.
 *
 * O desenho, o mais simples dentro disso — **a linha do horário é a `pulada`
 * enquanto não roda**:
 *
 * 1. Primeira tentativa, sem linha: `iniciar` **cria** a execução com
 *    `trigger: agenda`, `scheduledFor` e `attempts: 1`. Recusada, este
 *    arquivo cria a linha `pulada` com `attempts: 1` e o motivo. Nos dois
 *    casos o único do horário deixa uma instância só criar; a outra vê
 *    `P2002` e larga (`tomada`).
 * 2. Tentativa seguinte, com a `pulada` e `endedAt + 5 min` vencido
 *    (`proximaTentativa`): `iniciar` **converte** a linha em execução, com
 *    escrita condicional a `status: pulada` **e** `attempts` de antes.
 *    Recusada de novo, a recusa soma `attempts` com a mesma condição. Quem
 *    escreve primeiro leva; a outra instância vê `count` zero.
 * 3. Com `attempts: 3` a linha `pulada` é definitiva. Com qualquer outro
 *    status ela já foi execução de verdade — em andamento ou terminada, bem ou
 *    mal —, e nada daqui volta a olhar para ela. **Nenhum caminho do motor
 *    grava `pulada`**, então uma execução que começou nunca volta a ser
 *    tentativa.
 *
 * A janela é `[agora − 15 min, agora]` (`JANELA_DO_AGENDADOR_MS`): cobre as
 * três tentativas e um reinício curto. Horário perdido com a API fora por mais
 * que isso não é recuperado, e isso é declarado — rodar às 14h o post das 8h
 * não é o que se pediu. E ela recupera horário perdido, não horário anterior
 * à agenda existir: ver `pendentesDaRotina`.
 */

/// De quanto em quanto o relógio olha a agenda. Horário é `HH:MM`: um minuto
/// é a resolução dele.
const INTERVALO_DO_RELOGIO_MS = 60_000;

interface RotinaAgendada {
  id: string;
  userId: string;
  name: string;
  inputKind: RoutineInputKind;
  runCapMicros: number;
}

/// O registro de uma volta: `error` para o horário que falhou, `warn` para a
/// rotina que nem deu para ler.
export type RegistroDaVolta = Registro & Pick<RegistroDaVarredura, "warn">;

/** O que uma volta fez — para o registro e para o teste. */
export interface ResumoDaVolta {
  iniciadas: number;
  recusadas: number;
}

/**
 * Grava a recusa de uma tentativa. Na primeira, cria a linha `pulada` do
 * horário; nas seguintes, soma `attempts` na linha que a anterior deixou,
 * condicional ao número que esta tentativa viu. `false` quando a outra
 * instância já escreveu — ela atendeu esta tentativa, e esta não conta.
 */
async function registrarRecusa(
  rotina: RotinaAgendada,
  slot: Date,
  tentativa: number,
  recusa: { code: ErrorCode; mensagem: string },
  agora: Date,
): Promise<boolean> {
  if (tentativa === 1) {
    try {
      await prisma.aiRoutineRun.create({
        data: {
          userId: rotina.userId,
          routineId: rotina.id,
          routineName: rotina.name,
          inputKind: rotina.inputKind,
          runCapMicros: rotina.runCapMicros,
          status: "pulada",
          trigger: "agenda",
          scheduledFor: slot,
          attempts: 1,
          errorCode: recusa.code,
          errorMessage: recusa.mensagem,
          startedAt: agora,
          endedAt: agora,
        },
        select: { id: true },
      });
      return true;
    } catch (erro) {
      /// `P2002`: a vizinha criou a linha do horário. `P2003`: a rotina foi
      /// excluída entre a leitura e a escrita — não há o que registrar.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        (erro.code === "P2002" || erro.code === "P2003")
      ) {
        return false;
      }
      throw erro;
    }
  }

  const { count } = await prisma.aiRoutineRun.updateMany({
    where: {
      routineId: rotina.id,
      scheduledFor: slot,
      status: "pulada",
      attempts: tentativa - 1,
    },
    data: {
      attempts: tentativa,
      errorCode: recusa.code,
      errorMessage: recusa.mensagem,
      endedAt: agora,
    },
  });
  return count > 0;
}

/**
 * Uma volta do relógio. **`agora` e `somenteDe` não têm valor padrão**:
 *
 * - `agora` é o que o teste injeta para andar 5 minutos sem esperar, e um
 *   padrão faria o teste que esquecesse de passá-lo testar o relógio da
 *   máquina (convenção da injeção, skill `convencoes-yu-book` §3);
 * - `somenteDe` restringe a volta a uma conta. O relógio passa `null`, todas.
 *   O teste passa o usuário dele — **a suíte roda no banco de desenvolvimento,
 *   que guarda a conta real**, e uma volta global com um `agora` inventado
 *   dispararia as rotinas agendadas do operador.
 *
 * As rotinas vão em sequência, de propósito: `iniciar` responde assim que a
 * execução começa, e a próxima rotina do mesmo dono no mesmo horário recebe
 * `ROTINA_EM_ANDAMENTO` (RN-19) — e tenta de novo daqui a 5 minutos.
 */
export async function voltaDaAgenda(
  agora: Date,
  registro: RegistroDaVolta,
  somenteDe: string | null,
): Promise<ResumoDaVolta> {
  const de = new Date(agora.getTime() - JANELA_DO_AGENDADOR_MS);
  const rotinas = await prisma.aiRoutine.findMany({
    where: { scheduleActive: true, ...(somenteDe !== null && { userId: somenteDe }) },
    orderBy: [{ userId: "asc" }, { name: "asc" }],
    select: {
      id: true,
      userId: true,
      name: true,
      inputKind: true,
      runCapMicros: true,
      scheduleDays: true,
      scheduleTimes: true,
      updatedAt: true,
      user: { select: { aiPreference: { select: { timezone: true } } } },
    },
  });

  const resumo: ResumoDaVolta = { iniciadas: 0, recusadas: 0 };
  for (const rotina of rotinas) {
    /// **Uma rotina com defeito não derruba a volta das outras.** O cálculo
    /// dos horários lança `RangeError` com fuso ou horário gravado fora do
    /// schema (SQL à mão, migration futura), e fora deste `try` o mesmo
    /// defeito pararia a agenda da conta inteira a cada minuto.
    let pendentes: Pendente[];
    try {
      pendentes = await pendentesDaRotina(rotina, de, agora);
    } catch (erro) {
      registro.warn(
        { err: erro, routineId: rotina.id },
        "agendador de rotinas pulou uma rotina que não pôde ler",
      );
      continue;
    }

    for (const { slot, tentativa } of pendentes) {
      try {
        const inicio = await iniciar(rotina.userId, rotina.id, registro, {
          tipo: "agenda",
          slot,
          tentativa,
        });
        if (inicio.tipo === "iniciada") {
          resumo.iniciadas += 1;
        } else if (inicio.tipo === "recusada") {
          if (await registrarRecusa(rotina, slot, tentativa, inicio, agora)) resumo.recusadas += 1;
        }
      } catch (erro) {
        /// Um horário que falhou não para os outros. Nada começou: a linha do
        /// horário não mudou, e a próxima volta tenta de novo dentro da janela.
        registro.error(
          { err: erro, routineId: rotina.id, slot: slot.toISOString() },
          "agendador de rotinas falhou num horário",
        );
      }
    }
  }
  return resumo;
}

interface Pendente {
  slot: Date;
  tentativa: number;
}

/**
 * Os horários de uma rotina que esta volta tenta atender, e em qual tentativa.
 *
 * **Horário sem linha só conta se não for anterior à última gravação da
 * rotina** (`slot >= updatedAt`). A janela de 15 minutos existe para recuperar
 * o horário perdido com a API fora (RN-22), não o horário anterior à agenda
 * existir: sem esta guarda, ligar a agenda, "Retomar" ou pôr um horário que
 * venceu há pouco dispararia na hora uma execução que ninguém pediu — e que
 * custa. Ligar, retomar e editar gravam `updatedAt` (o PATCH o põe
 * explícito, `rotinas.service.ts`); a execução e a `pulada` escrevem em
 * `ai_routine_run` e não o movem.
 *
 * O efeito colateral aceito: editar a rotina — qualquer campo — no minuto
 * seguinte a um horário vencido e **ainda não atendido** pula esse horário.
 * Só acontece com a API fora ou atrasada naquele minuto; é raro, e errar para
 * o lado de não gastar é o que se pediu.
 *
 * Horário que **já tem linha** (`pulada` com tentativa pendente) segue as
 * tentativas: a primeira já foi feita, e a edição não a desfaz.
 */
async function pendentesDaRotina(
  rotina: {
    id: string;
    scheduleDays: number[];
    scheduleTimes: string[];
    updatedAt: Date;
    user: { aiPreference: { timezone: string } | null };
  },
  de: Date,
  agora: Date,
): Promise<Pendente[]> {
  const slots = horariosDevidos(
    { days: rotina.scheduleDays, times: rotina.scheduleTimes },
    /// O fuso do dono; sem linha de preferência, o padrão de sempre — o
    /// mesmo que o teto diário e a prévia da tela usam.
    rotina.user.aiPreference?.timezone ?? FUSO_PADRAO,
    de,
    agora,
  );
  if (slots.length === 0) return [];

  const linhas = await prisma.aiRoutineRun.findMany({
    where: { routineId: rotina.id, scheduledFor: { gte: de, lte: agora } },
    select: { scheduledFor: true, status: true, attempts: true, endedAt: true },
  });
  const existentes = new Map(
    linhas.flatMap((l) => (l.scheduledFor ? [[l.scheduledFor.getTime(), l] as const] : [])),
  );

  return slots.flatMap((slot): Pendente[] => {
    const linha = existentes.get(slot.getTime());
    if (!linha) {
      return slot.getTime() >= rotina.updatedAt.getTime() ? [{ slot, tentativa: 1 }] : [];
    }
    const quando = proximaTentativa({
      status: linha.status,
      attempts: linha.attempts,
      endedAt: linha.endedAt?.toISOString() ?? null,
      scheduledFor: slot.toISOString(),
    });
    /// Execução de verdade (qualquer status que não `pulada`), `pulada`
    /// definitiva, ou ainda dentro dos 5 minutos: nada a fazer agora.
    if (!quando || quando.getTime() > agora.getTime()) return [];
    return [{ slot, tentativa: (linha.attempts ?? 0) + 1 }];
  });
}

/**
 * O relógio. Devolve quem o desliga; `unref`, para não segurar o processo
 * vivo. Uma volta não começa enquanto a anterior roda — só poupa trabalho: a
 * garantia contra horário dobrado é do banco, também entre instâncias.
 *
 * Desligar espera a volta em curso: no SIGTERM, uma execução que ela
 * começasse depois de `encerrarExecucoes` listar as vivas escaparia do
 * `interrompida` e só seria fechada pela varredura, 45 s depois.
 */
export function vigiarAgenda(registro: Registro & RegistroDaVarredura): () => Promise<void> {
  let emCurso: Promise<void> | null = null;
  const relogio = setInterval(() => {
    if (emCurso) return;
    emCurso = voltaDaAgenda(new Date(), registro, null)
      .then(
        (resumo) => {
          if (resumo.iniciadas + resumo.recusadas > 0) {
            registro.info(resumo, "agendador de rotinas");
          }
        },
        (erro: unknown) => registro.warn({ err: erro }, "volta do agendador de rotinas falhou"),
      )
      .finally(() => {
        emCurso = null;
      });
  }, INTERVALO_DO_RELOGIO_MS);
  relogio.unref();
  return async () => {
    clearInterval(relogio);
    await emCurso;
  };
}
