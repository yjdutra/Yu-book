import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { useAlternarTarefa } from "@yu-book/cliente/concluirTarefa";
import { IconeBoard, IconeCalendario, IconeChevron, IconeMais } from "@yu-book/cliente/icones";
import { useId } from "react";
import { Link, useParams } from "react-router-dom";
import { TOM_DO_TIPO } from "../components/agenda/Calendario";
import { EstadoVazio, ItemAgenda } from "../components/agenda/ItemAgenda";
import { chaveDoEvento, itemDeEvento, quandoDoEvento } from "../components/agenda/itens";
import type { ItemDoDia } from "../components/agenda/itens";
import { useFolhaItem } from "../components/folha/FolhaItem";
import { DIAS_DE_PROJETO, useProjetos } from "../components/projetos/dados";
import { ListaAgrupada } from "../components/tarefas/ListaAgrupada";
import { useReconferirQuadro } from "../lib/quadros";

/**
 * Um projeto (quadro) no móvel: as tarefas abertas dele, agrupadas como em
 * Tarefas, e os eventos dos próximos 30 dias. O "+" cria já ligado a ele.
 *
 * Quadro que não está na lista da conta — apagado, ou de outra conta — é
 * "não encontrado", como o 404 da API (RNF-15): o móvel não pede
 * `GET /boards/:id`, que traria colunas e cards que ele não mostra. A lista
 * em cache pode ser mais velha que o quadro, e é pedida de novo antes do
 * veredito (`useReconferirQuadro`).
 */
export function ProjetoPage() {
  const { id = "" } = useParams();
  const { hoje, projetos, carregando, erro, tentar } = useProjetos();
  const { abrir } = useFolhaItem();
  const { alternar, aviso, limparAviso } = useAlternarTarefa();
  const idTarefas = useId();
  const idEventos = useId();
  const reconferindo = useReconferirQuadro(id);
  const projeto = projetos?.find((p) => p.quadro.id === id) ?? null;

  function abrirItem(item: ItemDoDia) {
    if (item.tipo === "evento") abrir({ modo: "editar", evento: item.evento });
    else if (item.tipo === "tarefa") abrir({ modo: "editar", tarefa: item.tarefa });
  }

  const criar = (tipo: "evento" | "tarefa") =>
    abrir({ modo: "criar", tipo, dia: null, projeto: id });

  const voltar = (
    <Link
      to="/projetos"
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-controle px-2 text-sm
                 font-medium text-accent-400"
    >
      <IconeChevron direcao="esquerda" className="size-4" />
      Projetos
    </Link>
  );

  if (erro) {
    return (
      <div className="mx-auto max-w-2xl">
        {voltar}
        <Aviso tom="erro" className="mt-3">
          Não deu para carregar o projeto.{" "}
          <button type="button" onClick={tentar} className="underline">
            Tentar de novo
          </button>
        </Aviso>
      </div>
    );
  }
  if (carregando || !projetos || !hoje || reconferindo) {
    return (
      <div aria-hidden="true" className="mx-auto max-w-2xl space-y-3">
        <div className="h-8 w-56 animate-pulse rounded-etiqueta bg-ink-800" />
        <div className="h-[4.5rem] animate-pulse rounded-cartao bg-ink-900" />
        <div className="h-[4.5rem] animate-pulse rounded-cartao bg-ink-900" />
      </div>
    );
  }
  if (!projeto) {
    return (
      <div className="mx-auto max-w-2xl">
        {voltar}
        <div className="mt-3">
          <EstadoVazio
            Icone={IconeBoard}
            tom={TOM_DO_TIPO.prazo}
            titulo="Projeto não encontrado"
            texto="Este quadro não existe mais, ou não é desta conta."
            acao={
              <Link
                to="/projetos"
                className="inline-flex h-12 items-center rounded-controle border border-ink-700
                           bg-superficie px-5 text-base font-medium text-ink-200 shadow-e1"
              >
                Ver os projetos
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const { quadro, abertas, eventos } = projeto;
  const vazio = abertas.length === 0 && eventos.length === 0;

  return (
    <div className="mx-auto max-w-2xl">
      {voltar}
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight text-titulo">
            {quadro.name}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-ink-400">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: quadro.workspaceColor }}
            />
            {quadro.workspaceName}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Botao
          variante="primario"
          tamanho="g"
          icone={<IconeMais className="size-4" />}
          onClick={() => criar("tarefa")}
        >
          Tarefa
        </Botao>
        <Botao
          variante="secundario"
          tamanho="g"
          icone={<IconeMais className="size-4" />}
          onClick={() => criar("evento")}
        >
          Evento
        </Botao>
      </div>

      {aviso && (
        <Aviso tom="erro" onFechar={limparAviso} className="mt-4">
          {aviso}
        </Aviso>
      )}

      {vazio ? (
        <div className="mt-6">
          <EstadoVazio
            Icone={IconeBoard}
            tom={TOM_DO_TIPO.prazo}
            titulo="Nada em andamento"
            texto={
              `Nenhuma tarefa aberta e nenhum evento nos próximos ${DIAS_DE_PROJETO} dias. ` +
              "Use os botões acima para começar."
            }
          />
        </div>
      ) : (
        <>
          <section
            aria-labelledby={idTarefas}
            data-foco-retorno={idTarefas}
            className="mt-8"
          >
            <h2 id={idTarefas} tabIndex={-1} className="text-lg font-semibold tracking-tight text-titulo">
              Tarefas abertas
            </h2>
            <div className="mt-3">
              {abertas.length === 0 ? (
                <p className="text-sm text-ink-400">Nenhuma tarefa aberta neste projeto.</p>
              ) : (
                <ListaAgrupada
                  tarefas={abertas}
                  hoje={hoje}
                  nivel={3}
                  onAbrir={abrirItem}
                  onConcluir={alternar}
                />
              )}
            </div>
          </section>

          <section
            aria-labelledby={idEventos}
            data-foco-retorno={idEventos}
            className="mt-8"
          >
            <h2 id={idEventos} tabIndex={-1} className="text-lg font-semibold tracking-tight text-titulo">
              Próximos eventos
            </h2>
            {eventos.length === 0 ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-400">
                <IconeCalendario className="size-4" />
                Nenhum evento nos próximos {DIAS_DE_PROJETO} dias.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {eventos.map((evento) => (
                  <ItemAgenda
                    key={chaveDoEvento(evento)}
                    item={itemDeEvento(evento, quandoDoEvento(evento))}
                    onAbrir={abrirItem}
                    onConcluir={alternar}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
