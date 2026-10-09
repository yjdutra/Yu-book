import { Aviso } from "@yu-book/cliente/base/Aviso";
import { IconeBoard, IconeChevron } from "@yu-book/cliente/icones";
import { contar } from "@yu-book/cliente/texto";
import { Link } from "react-router-dom";
import { TOM_DO_TIPO } from "../components/agenda/Calendario";
import { EstadoVazio } from "../components/agenda/ItemAgenda";
import { repeticaoDe } from "../components/agenda/itens";
import { DIAS_DE_PROJETO, useProjetos } from "../components/projetos/dados";
import type { Projeto } from "../components/projetos/dados";
import { diaRelativo } from "../lib/datas";

/**
 * Projetos (frente de agenda, Fase 4): os quadros do Yu-book vistos do
 * celular — quantas tarefas abertas e o próximo evento ligado a cada um. O
 * quadro em si (colunas e cards) é do web; aqui é o que tem data.
 */
export function ProjetosPage() {
  const { hoje, projetos, carregando, erro, tentar } = useProjetos({ fresca: true });

  return (
    <div className="mx-auto max-w-2xl">
      {erro ? (
        <Aviso tom="erro">
          Não deu para carregar os projetos.{" "}
          <button type="button" onClick={tentar} className="underline">
            Tentar de novo
          </button>
        </Aviso>
      ) : carregando || !projetos ? (
        <ul aria-hidden="true" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-24 animate-pulse rounded-dialogo bg-ink-900" />
          ))}
        </ul>
      ) : projetos.length === 0 ? (
        <EstadoVazio
          Icone={IconeBoard}
          tom={TOM_DO_TIPO.prazo}
          titulo="Nenhum projeto ainda"
          texto="Cada quadro do Yu-book é um projeto. Crie o primeiro no Yu-book do computador."
        />
      ) : (
        <ul className="space-y-3">
          {projetos.map((projeto, i) => (
            <CartaoProjeto key={projeto.quadro.id} projeto={projeto} hoje={hoje} ordem={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Voo para Lisboa · ter, 20 de out, 22:00" — o próximo evento do projeto; na
 * série, a próxima ocorrência e "· repete seg, qua", como no item da agenda.
 */
export function textoDoEvento(
  evento: Projeto["eventos"][number],
  hoje: string | null,
): string {
  const quando = diaRelativo(evento.date, hoje);
  const repete = repeticaoDe(evento);
  return (
    `${evento.title} · ${quando}${evento.startTime ? `, ${evento.startTime}` : ""}` +
    (repete ? ` · ${repete}` : "")
  );
}

function CartaoProjeto({
  projeto,
  hoje,
  ordem,
}: {
  projeto: Projeto;
  hoje: string | null;
  ordem: number;
}) {
  const { quadro, eventos } = projeto;
  const abertas = projeto.abertas.filter((t) => t.completedAt === null).length;
  const proximo = eventos[0];
  return (
    <li>
      <Link
        to={`/projetos/${quadro.id}`}
        style={{ animationDelay: `${Math.min(ordem, 6) * 40}ms` }}
        className={`${TOM_DO_TIPO.prazo} group flex items-center gap-3 rounded-dialogo border
                    border-ink-800 bg-superficie p-4 shadow-e1 transition duration-150
                    ease-(--ease-padrao) animate-surgir [animation-fill-mode:backwards]
                    hover:shadow-e2 active:scale-[0.99]`}
      >
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--tom)
                     text-white"
        >
          <IconeBoard className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-titulo">{quadro.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-400">
            {/* A cor é do workspace, escolhida pelo usuário: enfeite ao lado do nome. */}
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: quadro.workspaceColor }}
            />
            <span className="truncate">{quadro.workspaceName}</span>
          </span>
          <span className="mt-2 block text-sm text-ink-200">
            {abertas > 0
              ? contar(abertas, "tarefa aberta", "tarefas abertas")
              : "Nenhuma tarefa aberta"}
          </span>
          <span className="block truncate text-sm text-ink-400">
            {proximo
              ? `Próximo: ${textoDoEvento(proximo, hoje)}`
              : `Sem evento nos próximos ${DIAS_DE_PROJETO} dias`}
          </span>
        </span>
        <IconeChevron
          direcao="direita"
          className="size-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}
