import {
  IconeBoard,
  IconeCalendario,
  IconeChevron,
  IconeHoje,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

interface Resumo {
  para: string;
  titulo: string;
  detalhe: string;
  Icone: (p: IconeProps) => ReactElement;
  /** Classe que declara `--tom`: um token de cor existente, nunca cor nova. */
  tom: string;
}

const RESUMOS: Resumo[] = [
  {
    para: "/agenda",
    titulo: "Hoje",
    detalhe: "eventos e tarefas",
    Icone: IconeHoje,
    tom: "[--tom:var(--color-accent-500)]",
  },
  {
    para: "/agenda",
    titulo: "Agenda",
    detalhe: "próximos 7 dias",
    Icone: IconeCalendario,
    tom: "[--tom:var(--color-agente-azul)]",
  },
  {
    para: "/projetos",
    titulo: "Projetos",
    detalhe: "quadros ativos",
    Icone: IconeBoard,
    tom: "[--tom:var(--color-agente-ambar)]",
  },
  {
    para: "/tarefas",
    titulo: "Tarefas",
    detalhe: "em aberto",
    Icone: IconeTarefa,
    tom: "[--tom:var(--color-agente-verde)]",
  },
];

function CartaoResumo({ resumo, ordem }: { resumo: Resumo; ordem: number }) {
  const { para, titulo, detalhe, Icone, tom } = resumo;
  return (
    <Link
      to={para}
      // O número chega com a agenda; até lá, o traço — que o leitor de tela não
      // lê como "travessão": o nome diz que ainda não há contagem.
      aria-label={`${titulo}, ${detalhe}: sem contagem ainda`}
      // Entrada em cascata, curta; `backwards` segura o cartão invisível
      // durante o atraso, em vez de piscar inteiro antes de entrar.
      style={{ animationDelay: `${ordem * 50}ms` }}
      className={`cartao-pastel ${tom} group flex min-h-36 flex-col justify-between rounded-dialogo
                  p-4 shadow-e2 transition duration-150 ease-(--ease-padrao) animate-surgir
                  [animation-fill-mode:backwards] hover:shadow-e3 active:scale-[0.98]`}
    >
      <span className="flex items-start justify-between">
        <span className="flex size-10 items-center justify-center rounded-full bg-(--tom) text-white shadow-e1">
          <Icone className="size-5" />
        </span>
        <IconeChevron
          direcao="direita"
          className="size-4 text-ink-400 transition-transform group-hover:translate-x-0.5"
        />
      </span>
      <span className="mt-4 block">
        <span className="block text-3xl font-semibold leading-none text-titulo">—</span>
        <span className="mt-2 block text-sm font-semibold text-titulo">{titulo}</span>
        <span className="block text-xs text-ink-400">{detalhe}</span>
      </span>
    </Link>
  );
}

export function InicioPage() {
  return (
    <>
      <section aria-labelledby="resumo">
        <h2 id="resumo" className="sr-only">
          Resumo
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {RESUMOS.map((resumo, i) => (
            <li key={resumo.titulo}>
              <CartaoResumo resumo={resumo} ordem={i} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dia" className="mt-8">
        <h2 id="dia" className="rotulo">
          O seu dia
        </h2>
        <div className="mt-3 rounded-dialogo border border-ink-800 bg-superficie px-5 py-8 text-center shadow-e1">
          <p className="text-sm text-ink-400">
            Os eventos, as tarefas e os prazos de hoje vão aparecer aqui.
          </p>
        </div>
      </section>
    </>
  );
}
