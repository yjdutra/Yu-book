import { useTarefas } from "@yu-book/cliente/agenda";
import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { useAlternarTarefa } from "@yu-book/cliente/concluirTarefa";
import { IconeAssistente, IconeMais, IconeTarefa } from "@yu-book/cliente/icones";
import { diaLocal } from "@yu-book/shared";
import type { AiCompletion, TaskItem } from "@yu-book/shared";
import { useId, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { TOM_DO_TIPO } from "../components/agenda/Calendario";
import { EstadoVazio, ItemAgenda } from "../components/agenda/ItemAgenda";
import { itemDeTarefa } from "../components/agenda/itens";
import type { ItemDoDia } from "../components/agenda/itens";
import { useFolhaItem } from "../components/folha/FolhaItem";
import { Pilula } from "../components/folha/Pilulas";
import { SeletorPlano } from "../components/plano/SeletorPlano";
import { ListaAgrupada } from "../components/tarefas/ListaAgrupada";
import { diaCurto, diaRelativo } from "../lib/datas";
import { useHoje } from "../lib/hoje";
import { useQuadros, useReconferirQuadro } from "../lib/quadros";

type Aba = "abertas" | "concluidas";
const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: "abertas", rotulo: "Abertas" },
  { valor: "concluidas", rotulo: "Concluídas" },
];

/** "pelo assistente", "por uma rotina", "pelo Claude (MCP)" — quem concluiu. */
function quemConcluiu(conclusao: AiCompletion): string {
  if (conclusao.agentName) return `por ${conclusao.agentName}`;
  if (conclusao.via === "rotina") return "por uma rotina";
  if (conclusao.via === "mcp") {
    return conclusao.author ? `por ${conclusao.author} (MCP)` : "via MCP";
  }
  return "pelo assistente";
}

/**
 * Tarefas do móvel (frente de agenda, Fase 4): abertas agrupadas por urgência
 * e concluídas em aba própria, com o filtro de projeto em pílulas.
 *
 * **O recorte mora na URL** (`?aba=concluidas&projeto=<id>`), como os filtros
 * de notas do web: recarregar volta ao mesmo recorte, e o Voltar desfaz a troca
 * de projeto. Trocar de aba substitui a entrada — senão as setas da lista de
 * abas encheriam o histórico.
 *
 * Nas abertas o filtro é feito aqui, sobre a lista inteira (a mesma que o
 * Início conta): as pílulas precisam saber quais quadros têm tarefa, e trocar
 * de projeto fica instantâneo, sem requisição. Nas concluídas, não — ver
 * `concluidasDoRecorte`.
 */
export function TarefasPage() {
  const [params, setParams] = useSearchParams();
  const aba: Aba = params.get("aba") === "concluidas" ? "concluidas" : "abertas";
  const projeto = params.get("projeto");
  const { hoje, fuso, erro: erroDoHoje, tentar: tentarHoje } = useHoje();
  const { abrir } = useFolhaItem();
  const { alternar, aviso, limparAviso } = useAlternarTarefa();
  const quadros = useQuadros();
  // O nome da pílula do projeto escolhido sem tarefa nesta aba vem da lista
  // de quadros; quadro novo, de depois do cache, também precisa dele.
  useReconferirQuadro(projeto);
  const abertas = useTarefas({ status: "abertas" });
  const concluidas = useTarefas({ status: "concluidas" }, aba === "concluidas");
  // As concluídas da conta são só as `LIMITE_TAREFAS_CONCLUIDAS` mais
  // recentes: filtrar essas no cliente mostraria vazio o projeto cujas
  // concluídas são mais antigas que as cem últimas da conta. Com projeto
  // escolhido, quem recorta é a API (`boardId`), com o mesmo limite dentro
  // dele. A lista da conta segue servindo às pílulas; sem projeto, as duas
  // são a mesma query e saem numa requisição só.
  const concluidasDoRecorte = useTarefas(
    projeto ? { status: "concluidas", boardId: projeto } : { status: "concluidas" },
    aba === "concluidas",
  );
  const consulta = aba === "abertas" ? abertas : concluidasDoRecorte;
  const idAba = useId();
  const abasRef = useRef<HTMLDivElement>(null);

  // Quadro que não existe (apagado, de outra conta) responde 404 ao recorte
  // da API; é o mesmo vazio que o filtro das abertas mostra, não uma falha.
  const quadroSumiu =
    aba === "concluidas" &&
    concluidasDoRecorte.error instanceof ApiError &&
    concluidasDoRecorte.error.code === "NOT_FOUND";
  const todas = (aba === "abertas" ? abertas.data : concluidas.data) ?? [];
  const lista =
    aba === "abertas"
      ? projeto
        ? todas.filter((t) => t.board?.id === projeto)
        : todas
      : quadroSumiu
        ? []
        : (concluidasDoRecorte.data ?? []);

  // As pílulas: os quadros com tarefa nesta aba, mais o escolhido, mesmo
  // vazio — o filtro que vale nunca some da tela (skill de design, §5).
  const pilulas = useMemo(() => {
    const nomes = new Map<string, string>();
    for (const t of todas) if (t.board) nomes.set(t.board.id, t.board.name);
    if (projeto && !nomes.has(projeto)) {
      const quadro = quadros.data?.find((q) => q.id === projeto);
      if (quadro) nomes.set(quadro.id, quadro.name);
    }
    return [...nomes].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [todas, projeto, quadros.data]);
  const nomeDoProjeto = pilulas.find(([id]) => id === projeto)?.[1] ?? null;

  function mudar(chave: "aba" | "projeto", valor: string | null, substituir: boolean) {
    limparAviso();
    setParams(
      (atual) => {
        const novos = new URLSearchParams(atual);
        if (valor) novos.set(chave, valor);
        else novos.delete(chave);
        return novos;
      },
      { replace: substituir },
    );
  }

  function escolherAba(nova: Aba) {
    mudar("aba", nova === "concluidas" ? "concluidas" : null, true);
  }

  // As setas trocam de aba e levam o foco junto (ativação automática).
  function teclasDasAbas(ev: KeyboardEvent) {
    const i = ABAS.findIndex((a) => a.valor === aba);
    const proxima =
      ev.key === "ArrowRight" || ev.key === "End"
        ? ABAS[ev.key === "End" ? ABAS.length - 1 : (i + 1) % ABAS.length]
        : ev.key === "ArrowLeft" || ev.key === "Home"
          ? ABAS[ev.key === "Home" ? 0 : (i - 1 + ABAS.length) % ABAS.length]
          : undefined;
    if (!proxima) return;
    ev.preventDefault();
    escolherAba(proxima.valor);
    abasRef.current?.querySelector<HTMLElement>(`[data-aba="${proxima.valor}"]`)?.focus();
  }

  function abrirItem(item: ItemDoDia) {
    if (item.tipo === "tarefa") abrir({ modo: "ver", tarefa: item.tarefa });
  }

  const contagemAbertas = abertas.data?.filter((t) => t.completedAt === null).length;

  return (
    <div className="mx-auto max-w-2xl">
      <SeletorPlano />
      <div className="flex items-center gap-3">
        <div
          ref={abasRef}
          role="tablist"
          aria-label="Situação das tarefas"
          onKeyDown={teclasDasAbas}
          className="grid flex-1 grid-cols-2 gap-1 rounded-cartao bg-ink-900 p-1"
        >
          {ABAS.map(({ valor, rotulo }) => {
            const ativa = aba === valor;
            return (
              <button
                key={valor}
                type="button"
                role="tab"
                id={`${idAba}-${valor}`}
                data-aba={valor}
                aria-selected={ativa}
                aria-controls={`${idAba}-painel`}
                tabIndex={ativa ? 0 : -1}
                onClick={() => escolherAba(valor)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-controle text-sm
                            transition-colors duration-150 ${
                              ativa
                                ? "bg-superficie font-semibold text-titulo shadow-e1"
                                : "font-medium text-ink-400 hover:text-ink-200"
                            }`}
              >
                {rotulo}
                {valor === "abertas" && contagemAbertas !== undefined && (
                  <span
                    className="rounded-full bg-ink-800 px-2 text-miudo font-semibold text-ink-200"
                  >
                    {contagemAbertas}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => abrir({ modo: "criar", tipo: "tarefa", dia: null, projeto })}
          aria-label={nomeDoProjeto ? `Nova tarefa em ${nomeDoProjeto}` : "Nova tarefa"}
          title="Nova tarefa"
          aria-haspopup="dialog"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-500
                     text-white shadow-e1 transition duration-150 hover:brightness-110
                     active:scale-95"
        >
          <IconeMais className="size-5" />
        </button>
      </div>

      {(pilulas.length > 0 || projeto) && (
        <div
          role="group"
          aria-label="Projeto"
          // Rola de lado, de borda a borda no celular: muitos quadros não
          // empurram a lista para baixo.
          className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0"
        >
          <Pilula ativa={!projeto} onClick={() => mudar("projeto", null, false)}>
            Todos
          </Pilula>
          {pilulas.map(([id, nome]) => (
            <Pilula key={id} ativa={projeto === id} onClick={() => mudar("projeto", id, false)}>
              <span className="max-w-48 truncate whitespace-nowrap">{nome}</span>
            </Pilula>
          ))}
        </div>
      )}

      <div
        role="tabpanel"
        id={`${idAba}-painel`}
        aria-labelledby={`${idAba}-${aba}`}
        // Sem item nem seção que reste, o foco volta à aba (`ItemAgenda`).
        data-foco-retorno={`${idAba}-${aba}`}
        className="mt-6"
      >
        {aviso && (
          <Aviso tom="erro" onFechar={limparAviso} className="mb-4">
            {aviso}
          </Aviso>
        )}
        {(consulta.isError && !quadroSumiu) || (erroDoHoje && !hoje) ? (
          <Aviso tom="erro">
            Não deu para carregar as tarefas.{" "}
            <button
              type="button"
              onClick={() => {
                if (consulta.isError) void consulta.refetch();
                if (erroDoHoje) tentarHoje();
              }}
              className="underline"
            >
              Tentar de novo
            </button>
          </Aviso>
        ) : consulta.isPending || !hoje ? (
          <ul aria-hidden="true" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-[4.5rem] animate-pulse rounded-cartao bg-ink-900" />
            ))}
          </ul>
        ) : lista.length === 0 ? (
          <Vazio
            aba={aba}
            projeto={nomeDoProjeto}
            onCriar={() => abrir({ modo: "criar", tipo: "tarefa", dia: null, projeto })}
          />
        ) : aba === "abertas" ? (
          <ListaAgrupada tarefas={lista} hoje={hoje} onAbrir={abrirItem} onConcluir={alternar} />
        ) : (
          <ul className="space-y-2">
            {lista.map((tarefa) => (
              <ItemAgenda
                key={tarefa.id}
                item={itemDeTarefa(tarefa, tarefa.date ? diaCurto(tarefa.date) : "sem data")}
                rodape={<Conclusao tarefa={tarefa} hoje={hoje} fuso={fuso} />}
                onAbrir={abrirItem}
                onConcluir={alternar}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * "Concluída hoje", "concluída sex, 2 de out · por Pesquisador". O
 * `completedAt` é instante: o dia sai pelo fuso do usuário (`diaLocal`), não
 * pelo do aparelho. A marca de IA é discreta — faísca e palavra, como a
 * `LinhaConclusao` do web.
 */
function Conclusao({
  tarefa,
  hoje,
  fuso,
}: {
  tarefa: TaskItem;
  hoje: string;
  fuso: string | null;
}) {
  if (!tarefa.completedAt) return null;
  const dia = fuso ? diaLocal(new Date(tarefa.completedAt), fuso) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span>concluída {dia ? diaRelativo(dia, hoje) : ""}</span>
      {tarefa.completion && (
        <span className="inline-flex items-center gap-1 text-accent-400">
          <IconeAssistente className="size-3" />
          <span className="text-ink-400">{quemConcluiu(tarefa.completion)}</span>
        </span>
      )}
    </span>
  );
}

function Vazio({
  aba,
  projeto,
  onCriar,
}: {
  aba: Aba;
  projeto: string | null;
  onCriar: () => void;
}) {
  if (aba === "concluidas") {
    return (
      <EstadoVazio
        Icone={IconeTarefa}
        tom={TOM_DO_TIPO.tarefa}
        titulo="Nenhuma concluída ainda"
        texto={
          projeto
            ? `O que você concluir em ${projeto} aparece aqui.`
            : "O que você concluir aparece aqui, as mais recentes primeiro."
        }
      />
    );
  }
  return (
    <EstadoVazio
      Icone={IconeTarefa}
      tom={TOM_DO_TIPO.tarefa}
      titulo={projeto ? `Nada em aberto em ${projeto}` : "Tudo em dia"}
      texto={
        projeto
          ? "As tarefas deste projeto estão feitas. Anote a próxima quando ela vier."
          : "Nenhuma tarefa em aberto. Anote a próxima quando ela vier."
      }
      acao={
        <Botao
          variante="secundario"
          tamanho="g"
          onClick={onCriar}
          icone={<IconeMais className="size-4" />}
        >
          Nova tarefa
        </Botao>
      }
    />
  );
}
