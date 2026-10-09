import { useAgenda } from "@yu-book/cliente/agenda";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Calendario } from "../components/agenda/Calendario";
import { indexarPorDia } from "../components/agenda/itens";
import type { ItemDoDia } from "../components/agenda/itens";
import { ListaDoDia } from "../components/agenda/ListaDoDia";
import { useFolhaItem } from "../components/folha/FolhaItem";
import {
  diaDoAparelho,
  diaValido,
  gradeDoMes,
  mesDoDia,
  primeiroDoMes,
  somarMeses,
} from "../lib/datas";
import { useAlternarTarefa } from "../lib/concluir";
import { useHoje } from "../lib/hoje";

/**
 * A Agenda do móvel (frente de agenda, Fase 4): o calendário do mês e a lista
 * do dia escolhido — embaixo no celular, ao lado a partir de 1024px.
 *
 * **O dia escolhido mora na URL** (`/agenda?dia=2026-10-10`), e o mês sai
 * dele: recarregar volta ao mesmo dia, e o Voltar desfaz a troca de mês. Trocar
 * de mês empurra uma entrada no histórico; escolher outro dia do mesmo mês a
 * substitui — senão o Voltar teria de desfazer cada toque na grade. Sem `dia`,
 * vale o hoje **do usuário**, que vem da API; até ela responder, a data do
 * aparelho só escolhe que mês buscar (INV-66).
 */
export function AgendaPage() {
  const [params, setParams] = useSearchParams();
  const { abrir } = useFolhaItem();
  const { hoje: hojeConhecido, erro: erroDoHoje, tentar: tentarHoje } = useHoje();
  const [diaDePartida] = useState(diaDoAparelho);
  const { alternar, aviso, limparAviso } = useAlternarTarefa();

  const diaDaUrl = diaValido(params.get("dia"));
  const mes = mesDoDia(diaDaUrl ?? hojeConhecido ?? diaDePartida);
  const grade = useMemo(() => gradeDoMes(mes), [mes]);
  const agenda = useAgenda(grade[0] ?? null, grade[grade.length - 1] ?? null);
  const hoje = agenda.data?.today ?? hojeConhecido;
  // Sem `?dia=`, o hoje — de qualquer das duas consultas que responder: a do
  // mês também o traz, e uma falha na outra não deixa a lista esperando.
  const selecionado = diaDaUrl ?? hoje;
  const porDia = useMemo(() => (agenda.data ? indexarPorDia(agenda.data) : null), [agenda.data]);
  const itens = (selecionado && porDia?.get(selecionado)?.itens) || [];

  function selecionar(dia: string) {
    // O aviso de uma falha é do dia em que ela aconteceu.
    limparAviso();
    setParams(
      (atual) => {
        const novos = new URLSearchParams(atual);
        novos.set("dia", dia);
        return novos;
      },
      { replace: mesDoDia(dia) === mes },
    );
  }

  function mudarMes(n: number) {
    const alvo = somarMeses(mes, n);
    // No mês de hoje, o próprio hoje; nos outros, o dia 1.
    selecionar(hoje && mesDoDia(hoje) === alvo ? hoje : primeiroDoMes(alvo));
  }

  function abrirItem(item: ItemDoDia) {
    if (item.tipo === "evento") abrir({ modo: "editar", evento: item.evento });
    else if (item.tipo === "tarefa") abrir({ modo: "editar", tarefa: item.tarefa });
  }

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start
                 lg:gap-8"
    >
      <div className="rounded-dialogo border border-ink-800 bg-superficie p-3 shadow-e2 sm:p-4">
        <Calendario
          mes={mes}
          hoje={hoje}
          selecionado={selecionado}
          porDia={porDia}
          carregando={agenda.isPending}
          onSelecionar={selecionar}
          onMes={mudarMes}
          onHoje={() => hoje && selecionar(hoje)}
        />
      </div>
      <ListaDoDia
        dia={selecionado}
        hoje={hoje}
        itens={itens}
        carregando={agenda.isPending}
        erro={agenda.isError || (erroDoHoje && !selecionado)}
        aviso={aviso}
        onTentar={() => {
          if (agenda.isError) void agenda.refetch();
          if (erroDoHoje) tentarHoje();
        }}
        onFecharAviso={limparAviso}
        onCriar={() => selecionado && abrir({ modo: "criar", tipo: "evento", dia: selecionado })}
        onAbrir={abrirItem}
        onConcluir={alternar}
      />
    </div>
  );
}
