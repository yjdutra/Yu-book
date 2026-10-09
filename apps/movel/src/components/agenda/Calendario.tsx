import { IconeChevron } from "@yu-book/cliente/icones";
import { contar } from "@yu-book/cliente/texto";
import { somarDias } from "@yu-book/shared";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, TouchEvent } from "react";
import {
  DIAS_LONGOS,
  diaDaSemana,
  diaPorExtenso,
  gradeDoMes,
  mesDoDia,
  mesmoDiaEm,
  numeroDoDia,
  primeiroDoMes,
  tituloDoMes,
} from "../../lib/datas";
import type { ResumoDoDia } from "./itens";

/// Os três tons das marcas, tokens que já dizem o tipo no resto do app: o azul
/// da Agenda, o verde das Tarefas e o âmbar dos Projetos (de onde vem o prazo).
export const TOM_DO_TIPO = {
  evento: "[--tom:var(--color-agente-azul)]",
  tarefa: "[--tom:var(--color-agente-verde)]",
  prazo: "[--tom:var(--color-agente-ambar)]",
} as const;

/** "10 de outubro, hoje, 2 eventos, 1 tarefa" — o que o ponto diz sem cor. */
function rotuloDoDia(dia: string, hoje: string | null, resumo: ResumoDoDia | undefined): string {
  const partes = [diaPorExtenso(dia)];
  if (dia === hoje) partes.push("hoje");
  if (!resumo) {
    partes.push("nada marcado");
    return partes.join(", ");
  }
  if (resumo.eventos) partes.push(contar(resumo.eventos, "evento", "eventos"));
  if (resumo.tarefas) {
    const tarefas = contar(resumo.tarefas, "tarefa", "tarefas");
    const feitas = contar(resumo.concluidas, "concluída", "concluídas");
    partes.push(resumo.concluidas ? `${tarefas} (${feitas})` : tarefas);
  }
  if (resumo.prazos) partes.push(contar(resumo.prazos, "prazo de card", "prazos de card"));
  return partes.join(", ");
}

const BOTAO_NAV = `flex size-11 items-center justify-center rounded-full text-ink-400
  transition-colors duration-150 hover:bg-ink-800 hover:text-titulo active:bg-ink-800`;

/**
 * O calendário do mês (frente de agenda, Fase 4): seis semanas, domingo
 * primeiro, hoje com anel e o dia escolhido preenchido — forma, não só cor.
 * Cada dia mostra até três marcas, uma por tipo presente, e o tipo é dito
 * pela **forma** além do tom — evento é ponto cheio, tarefa é anel, prazo é
 * losango —, cada um no seu lugar fixo, para uma marca sozinha não trocar de
 * posição entre dias. A legenda fica sob a grade, e o nome do dia diz as
 * contagens por extenso (RNF-09).
 *
 * É um `grid` do ARIA com foco itinerante: só o dia escolhido entra no Tab, e
 * as setas andam de dia em dia (←/→), de semana em semana (↑/↓), até as pontas
 * da semana (Home/End) e de mês em mês (PageUp/PageDown). Mover é escolher —
 * como no seletor de data do sistema —, e a lista embaixo acompanha. No toque,
 * deslizar para o lado troca o mês.
 */
export function Calendario({
  mes,
  hoje,
  selecionado,
  porDia,
  carregando,
  onSelecionar,
  onMes,
  onHoje,
}: {
  /** `AAAA-MM`. */
  mes: string;
  hoje: string | null;
  selecionado: string | null;
  porDia: Map<string, ResumoDoDia> | null;
  carregando: boolean;
  onSelecionar: (dia: string) => void;
  onMes: (n: number) => void;
  onHoje: () => void;
}) {
  const idTitulo = useId();
  const grade = gradeDoMes(mes);
  const semanas = Array.from({ length: 6 }, (_, i) => grade.slice(i * 7, i * 7 + 7));
  const raiz = useRef<HTMLDivElement>(null);
  const focarDepois = useRef(false);
  const toque = useRef<{ x: number; y: number } | null>(null);
  // O dia que entra no Tab: o escolhido, se está na grade; senão o dia 1.
  const itinerante =
    selecionado && grade.includes(selecionado) ? selecionado : primeiroDoMes(mes);

  // A seta escolhe o dia, a URL muda e a grade redesenha (às vezes de outro
  // mês): só depois disso o botão novo existe para receber o foco.
  useEffect(() => {
    if (!focarDepois.current) return;
    focarDepois.current = false;
    raiz.current?.querySelector<HTMLElement>(`[data-dia="${itinerante}"]`)?.focus();
  }, [itinerante]);

  function teclas(ev: KeyboardEvent<HTMLDivElement>) {
    const atual = (ev.target as HTMLElement).dataset.dia;
    if (!atual) return;
    const semana = diaDaSemana(atual);
    const alvo: Record<string, () => string> = {
      ArrowLeft: () => somarDias(atual, -1),
      ArrowRight: () => somarDias(atual, 1),
      ArrowUp: () => somarDias(atual, -7),
      ArrowDown: () => somarDias(atual, 7),
      Home: () => somarDias(atual, -semana),
      End: () => somarDias(atual, 6 - semana),
      PageUp: () => mesmoDiaEm(atual, -1),
      PageDown: () => mesmoDiaEm(atual, 1),
    };
    const destino = alvo[ev.key]?.();
    if (!destino) return;
    ev.preventDefault();
    if (destino === atual) return;
    focarDepois.current = true;
    onSelecionar(destino);
  }

  function inicioDoToque(ev: TouchEvent) {
    const t = ev.touches[0];
    toque.current = t ? { x: t.clientX, y: t.clientY } : null;
  }

  function fimDoToque(ev: TouchEvent) {
    const inicio = toque.current;
    const t = ev.changedTouches[0];
    toque.current = null;
    if (!inicio || !t) return;
    const dx = t.clientX - inicio.x;
    const dy = t.clientY - inicio.y;
    // Bem mais lateral que vertical: a rolagem da página não troca o mês.
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) onMes(dx < 0 ? 1 : -1);
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        {/* `aria-live`: trocar de mês por seta ou deslize é anunciado. */}
        <h2
          id={idTitulo}
          aria-live="polite"
          className="mr-auto pl-1 text-lg font-semibold tracking-tight text-titulo"
        >
          {tituloDoMes(mes)}
        </h2>
        <button
          type="button"
          onClick={onHoje}
          disabled={!hoje}
          className="min-h-11 rounded-full px-4 text-sm font-medium text-accent-400
                     transition-colors duration-150 hover:bg-accent-500/10 disabled:opacity-50"
        >
          Hoje
        </button>
        <button
          type="button"
          onClick={() => onMes(-1)}
          aria-label="Mês anterior"
          title="Mês anterior"
          className={BOTAO_NAV}
        >
          <IconeChevron direcao="esquerda" className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => onMes(1)}
          aria-label="Próximo mês"
          title="Próximo mês"
          className={BOTAO_NAV}
        >
          <IconeChevron direcao="direita" className="size-5" />
        </button>
      </div>

      <div
        ref={raiz}
        role="grid"
        aria-labelledby={idTitulo}
        aria-busy={carregando || undefined}
        onKeyDown={teclas}
        onTouchStart={inicioDoToque}
        onTouchEnd={fimDoToque}
        className="mt-3"
      >
        <div role="row" className="grid grid-cols-7">
          {DIAS_LONGOS.map((nome) => (
            <div
              key={nome}
              role="columnheader"
              aria-label={nome}
              className="pb-2 text-center text-miudo font-semibold uppercase text-ink-400"
            >
              <span aria-hidden="true">{nome.charAt(0)}</span>
            </div>
          ))}
        </div>
        {/* `key`: o mês novo entra com a animação curta; o velho não pisca. */}
        <div role="rowgroup" key={mes} className="animate-surgir">
          {semanas.map((semana) => (
            <div key={semana[0]} role="row" className="grid grid-cols-7">
              {semana.map((dia) => (
                <Dia
                  key={dia}
                  dia={dia}
                  hoje={hoje}
                  foraDoMes={mesDoDia(dia) !== mes}
                  escolhido={dia === selecionado}
                  itinerante={dia === itinerante}
                  resumo={porDia?.get(dia)}
                  onEscolher={() => {
                    // Dia de fora do mês troca a grade e desmonta o botão
                    // tocado: o foco segue para o dia no mês novo.
                    if (mesDoDia(dia) !== mes) focarDepois.current = true;
                    onSelecionar(dia);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <Legenda />
    </div>
  );
}

function Dia({
  dia,
  hoje,
  foraDoMes,
  escolhido,
  itinerante,
  resumo,
  onEscolher,
}: {
  dia: string;
  hoje: string | null;
  foraDoMes: boolean;
  escolhido: boolean;
  itinerante: boolean;
  resumo: ResumoDoDia | undefined;
  onEscolher: () => void;
}) {
  const ehHoje = dia === hoje;
  const numero = escolhido
    ? `bg-accent-500 font-semibold text-white shadow-e1 ${
        ehHoje ? "ring-2 ring-accent-400 ring-offset-2 ring-offset-superficie" : ""
      }`
    : ehHoje
      ? "font-semibold text-accent-400 ring-2 ring-accent-500"
      : foraDoMes
        ? "text-ink-400/60"
        : "text-ink-200 group-hover:bg-ink-800";

  return (
    <div role="gridcell" aria-selected={escolhido} className="flex justify-center py-0.5">
      <button
        type="button"
        data-dia={dia}
        tabIndex={itinerante ? 0 : -1}
        aria-label={rotuloDoDia(dia, hoje, resumo)}
        aria-current={ehHoje ? "date" : undefined}
        onClick={onEscolher}
        className="group flex h-13 w-full max-w-13 flex-col items-center justify-center gap-1
                   rounded-cartao"
      >
        <span
          aria-hidden="true"
          className={`flex size-9 items-center justify-center rounded-full text-sm tabular-nums
                      transition-colors duration-150 ${numero}`}
        >
          {numeroDoDia(dia)}
        </span>
        {/* Três vagas sempre, na ordem evento, tarefa, prazo: a vazia ocupa o
            lugar sem desenhar nada. */}
        <span aria-hidden="true" className={`flex h-2 gap-0.5 ${foraDoMes ? "opacity-50" : ""}`}>
          <Marca tipo="evento" visivel={Boolean(resumo?.eventos)} />
          <Marca tipo="tarefa" visivel={Boolean(resumo?.tarefas)} />
          <Marca tipo="prazo" visivel={Boolean(resumo?.prazos)} />
        </span>
      </button>
    </div>
  );
}

const FORMA = {
  evento: "size-1.5 rounded-full bg-(--tom)",
  tarefa: "size-1.5 rounded-full border-[1.5px] border-(--tom)",
  prazo: "size-[5px] rotate-45 bg-(--tom)",
} as const;

/** A marca de um tipo, numa vaga de 8px: ponto, anel ou losango. */
export function Marca({
  tipo,
  visivel = true,
}: {
  tipo: keyof typeof FORMA;
  visivel?: boolean;
}) {
  return (
    <span className={`${TOM_DO_TIPO[tipo]} flex size-2 items-center justify-center`}>
      {visivel && <span className={FORMA[tipo]} />}
    </span>
  );
}

function Legenda() {
  // O texto diz o tipo; a marca ao lado ensina a forma que a grade usa.
  const itens = [
    ["evento", "Evento"],
    ["tarefa", "Tarefa"],
    ["prazo", "Prazo de card"],
  ] as const;
  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-miudo text-ink-400">
      {itens.map(([tipo, texto]) => (
        <li key={tipo} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="scale-125">
            <Marca tipo={tipo} />
          </span>
          {texto}
        </li>
      ))}
    </ul>
  );
}
