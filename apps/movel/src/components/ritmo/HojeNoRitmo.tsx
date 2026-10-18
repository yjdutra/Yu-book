import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { useHabitos } from "@yu-book/cliente/habitos";
import { IconeCronometro, IconeMais } from "@yu-book/cliente/icones";
import { TOM_DO_HABITO } from "@yu-book/cliente/ritmo/Emblema";
import { LinhaAtividade } from "@yu-book/cliente/ritmo/LinhaAtividade";
import type { HabitActivityRef } from "@yu-book/shared";
import { useId } from "react";
import { Link } from "react-router-dom";
import { tituloDe } from "../agenda/itens";
import type { ItemDoDia } from "../agenda/itens";
import { useMarcarAtividade } from "./marcar";

interface AtividadeDoDia {
  item: ItemDoDia;
  vinculo: HabitActivityRef;
  feita: boolean;
}
import { useRitmo } from "./Ritmo";

/**
 * "Hoje no ritmo" (frente Ritmo, RF-26): as tarefas e ocorrências de evento de
 * hoje ligadas a uma atividade de hábito, com o check — o mesmo gesto da
 * agenda (RN-18) — e o toast de pontos. Lê os itens do dia que o Início já
 * agrupou (`indexarPorDia`), sem consulta própria de agenda.
 *
 * Sem hábito ativo, a seção não aparece (RN-19): no Início de quem não usa o
 * Ritmo, ela só ocuparia lugar.
 */
export function HojeNoRitmo({ hoje, itens }: { hoje: string; itens: ItemDoDia[] }) {
  const habitos = useHabitos();
  const { abrirRegistro } = useRitmo();
  const { marcarTarefa, marcarEvento, aviso, limparAviso } = useMarcarAtividade();
  const idTitulo = useId();

  if (!habitos.data || habitos.data.length === 0) return null;
  const cores = new Map(habitos.data.map((h) => [h.id, h.color]));

  const doRitmo = itens.flatMap((item): AtividadeDoDia[] => {
    if (item.tipo === "tarefa" && item.tarefa.habitActivity) {
      return [{ item, vinculo: item.tarefa.habitActivity, feita: item.tarefa.completedAt !== null }];
    }
    if (item.tipo === "evento" && item.evento.habitActivity) {
      return [{ item, vinculo: item.evento.habitActivity, feita: item.evento.checkedIn === true }];
    }
    return [];
  });
  const feitas = doRitmo.filter((a) => a.feita).length;

  return (
    <section
      aria-labelledby={idTitulo}
      className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={idTitulo} className="text-base font-bold text-titulo">
          Hoje no ritmo
        </h2>
        {doRitmo.length > 0 && (
          <span
            className="rounded-full bg-sucesso-500/14 px-2.5 py-0.5 text-xs font-semibold
                       tabular-nums text-sucesso-300"
          >
            {feitas} de {doRitmo.length}
          </span>
        )}
      </div>
      {doRitmo.length > 0 && (
        <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-sucesso-500 transition-[width] duration-300"
            style={{ width: `${Math.round((feitas / doRitmo.length) * 100)}%` }}
          />
        </div>
      )}
      {aviso && (
        <Aviso tom="erro" onFechar={limparAviso} className="mt-3">
          {aviso}
        </Aviso>
      )}
      {doRitmo.length === 0 ? (
        <p className="mt-2 text-sm text-ink-400">
          Nada do ritmo agendado para hoje. O que fizer por fora, registre aqui.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {doRitmo.map(({ item, vinculo, feita }) => {
            const cor = cores.get(vinculo.habitId);
            const nome = item.tipo === "evento" ? item.evento.title : tituloDe(item);
            const quando = item.tipo === "evento" ? `${item.hora} · evento` : item.hora;
            return (
              <LinhaAtividade
                key={item.id}
                className={cor ? TOM_DO_HABITO[cor] : "[--tom:var(--color-ink-400)]"}
                nome={nome}
                meta={`${vinculo.habitName} · ${quando}`}
                pontos={vinculo.points}
                feita={feita}
                rotuloAcao={item.tipo === "evento" ? `Check-in em “${nome}”` : `Concluir “${nome}”`}
                onAlternar={() => {
                  if (item.tipo === "tarefa") marcarTarefa(item.tarefa, hoje);
                  else if (item.tipo === "evento") marcarEvento(item.evento);
                }}
                acao={
                  // O foco abre a partir de uma atividade (Ritmo 6, P1).
                  <Link
                    to={`/foco?atividade=${vinculo.id}`}
                    aria-label={`Focar em “${nome}”`}
                    className="grid size-11 shrink-0 place-items-center rounded-full"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 place-items-center rounded-full bg-accent-500/15
                                 text-accent-400"
                    >
                      <IconeCronometro className="size-4.5" />
                    </span>
                  </Link>
                }
              />
            );
          })}
        </ul>
      )}
      <Botao
        variante="secundario"
        tamanho="g"
        icone={<IconeMais className="size-4" />}
        onClick={() => abrirRegistro()}
        aria-haspopup="dialog"
        className="mt-3 w-full"
      >
        Registrar fora do plano
      </Botao>
    </section>
  );
}
