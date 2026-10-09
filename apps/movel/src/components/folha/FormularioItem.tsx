import {
  useAtualizarEvento,
  useAtualizarTarefa,
  useConcluirTarefa,
  useCriarEvento,
  useCriarTarefa,
  useExcluirEvento,
  useExcluirTarefa,
} from "@yu-book/cliente/agenda";
import type { NovaTarefa, NovoEvento } from "@yu-book/cliente/agenda";
import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { IconeCalendario, IconeChevron, IconeTarefa } from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import { minutosEntre, resolverHorario, somarDias, somarMinutos } from "@yu-book/shared";
import type { EventItem, EventUpdateInput, TaskItem, TaskUpdateInput } from "@yu-book/shared";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactElement, ReactNode, RefObject } from "react";
import {
  diaCurto,
  diaLongo,
  duracaoCurta,
  proximaHoraCheia,
  proximoSabado,
} from "../../lib/datas";
import { useHoje } from "../../lib/hoje";
import { useQuadros } from "../../lib/quadros";
import { Alca } from "../Alca";
import { ErroDoCampo, GrupoPilulas, Pilula, PilulaEscolher } from "./Pilulas";

export type TipoItem = "evento" | "tarefa";

/** O que abre a folha: criar (com o tipo e o dia de partida) ou editar um item. */
export type AberturaFolha =
  | { modo: "criar"; tipo: TipoItem; dia: string | null; projeto?: string | null }
  | { modo: "editar"; evento: EventItem }
  | { modo: "editar"; tarefa: TaskItem };

type Fim = { tipo: "duracao"; minutos: number } | { tipo: "hora"; hora: string };

interface Estado {
  tipo: TipoItem;
  titulo: string;
  dia: string | null;
  diaInteiro: boolean;
  inicio: string | null;
  fim: Fim;
  local: string;
  /// A hora da tarefa, opcional (só com dia).
  hora: string | null;
  projeto: string | null;
  descricao: string;
}

/** Os campos do formulário que um erro pode apontar. */
type Campo = "titulo" | "dia" | "hora" | "duracao" | "projeto" | "local" | "descricao";

/// O `path` dos `issues` do 422 (inglês, a fronteira) para o campo na tela.
const CAMPO_DO_PATH: Record<string, Campo> = {
  title: "titulo",
  date: "dia",
  endDate: "dia",
  allDay: "hora",
  startTime: "hora",
  time: "hora",
  endTime: "duracao",
  boardId: "projeto",
  location: "local",
  description: "descricao",
  descriptionMd: "descricao",
};

const DURACOES = [30, 60, 120] as const;
const HORAS_SUGERIDAS = ["09:00", "14:00", "19:00"] as const;

function estadoInicial(abertura: AberturaFolha, hoje: string | null, fuso: string | null): Estado {
  const vazio = {
    titulo: "",
    diaInteiro: false,
    fim: { tipo: "duracao", minutos: 60 } as Fim,
    local: "",
    hora: null,
    projeto: null,
    descricao: "",
  };
  if (abertura.modo === "criar") {
    // O evento pede dia: sem um de partida, hoje. A tarefa aceita "Sem data",
    // e é o que ela recebe do "+" da barra — um to-do anotado às pressas não
    // deveria ganhar prazo que ninguém deu.
    const dia = abertura.dia ?? (abertura.tipo === "evento" ? hoje : null);
    const sugerida = dia !== null && dia === hoje && fuso ? proximaHoraCheia(fuso) : null;
    return {
      ...vazio,
      tipo: abertura.tipo,
      dia,
      inicio: sugerida ?? "09:00",
      // O "+" de dentro de um projeto (ou de Tarefas filtrada por um) já o traz.
      projeto: abertura.projeto ?? null,
    };
  }
  if ("evento" in abertura) {
    const e = abertura.evento;
    const minutos =
      e.startTime && e.endTime ? minutosEntre(e.date, e.startTime, e.endDate, e.endTime) : 60;
    return {
      ...vazio,
      tipo: "evento",
      titulo: e.title,
      dia: e.date,
      diaInteiro: e.allDay,
      inicio: e.startTime ?? "09:00",
      // A duração gravada, qualquer que seja: mudar só o início a preserva,
      // e um evento de três dias não encolhe para uma pílula de 2 h.
      fim: { tipo: "duracao", minutos },
      local: e.location ?? "",
      projeto: e.board?.id ?? null,
      descricao: e.description,
    };
  }
  const t = abertura.tarefa;
  return {
    ...vazio,
    tipo: "tarefa",
    titulo: t.title,
    dia: t.date,
    inicio: null,
    hora: t.time,
    projeto: t.board?.id ?? null,
    descricao: t.descriptionMd,
  };
}

const mesmoFim = (a: Fim, b: Fim) =>
  a.tipo === "duracao"
    ? b.tipo === "duracao" && a.minutos === b.minutos
    : b.tipo === "hora" && a.hora === b.hora;

/** O fim do evento com hora, como a API o pede. */
function fimDoEvento(dia: string, inicio: string, fim: Fim) {
  if (fim.tipo === "duracao") {
    const f = somarMinutos(dia, inicio, fim.minutos);
    return { endDate: f.dia, endTime: f.hora };
  }
  // Hora escolhida: o servidor decide o dia (antes do início, atravessa a
  // meia-noite — "das 22h à 1h").
  return { endDate: null, endTime: fim.hora };
}

function paraNovoEvento(e: Estado, dia: string, inicio: string | null): NovoEvento {
  const base = {
    title: e.titulo.trim(),
    description: e.descricao,
    location: e.local.trim() || null,
    boardId: e.projeto,
  };
  if (e.diaInteiro || !inicio) return { ...base, allDay: true, date: dia };
  const fim = fimDoEvento(dia, inicio, e.fim);
  return { ...base, allDay: false, date: dia, startTime: inicio, ...fim };
}

/**
 * Só o que mudou. O horário segue "o que se vê é o que se grava": mudou
 * qualquer parte dele num evento com hora, vão início e fim por extenso — o
 * fim que a tela mostra, e não o que `mesclarHorario` deduziria. No dia
 * inteiro vai só a parte mexida, e o servidor anda com o vão (um evento de
 * três dias movido continua de três dias).
 */
function mudancaDoEvento(e: Estado, ini: Estado): EventUpdateInput {
  const m: EventUpdateInput = {};
  if (e.titulo.trim() !== ini.titulo) m.title = e.titulo.trim();
  if (e.descricao !== ini.descricao) m.description = e.descricao;
  if (e.local.trim() !== ini.local) m.location = e.local.trim() || null;
  if (e.projeto !== ini.projeto) m.boardId = e.projeto;

  const horarioMudou =
    e.dia !== ini.dia ||
    e.diaInteiro !== ini.diaInteiro ||
    e.inicio !== ini.inicio ||
    !mesmoFim(e.fim, ini.fim);
  if (!horarioMudou || !e.dia) return m;

  if (e.diaInteiro !== ini.diaInteiro) m.allDay = e.diaInteiro;
  if (e.diaInteiro) {
    if (e.dia !== ini.dia) m.date = e.dia;
    return m;
  }
  if (!e.inicio) return m;
  return { ...m, date: e.dia, startTime: e.inicio, ...fimDoEvento(e.dia, e.inicio, e.fim) };
}

function paraNovaTarefa(e: Estado): NovaTarefa {
  return {
    title: e.titulo.trim(),
    descriptionMd: e.descricao,
    date: e.dia,
    time: e.dia ? e.hora : null,
    boardId: e.projeto,
  };
}

function mudancaDaTarefa(e: Estado, ini: Estado): TaskUpdateInput {
  const m: TaskUpdateInput = {};
  if (e.titulo.trim() !== ini.titulo) m.title = e.titulo.trim();
  if (e.descricao !== ini.descricao) m.descriptionMd = e.descricao;
  if (e.projeto !== ini.projeto) m.boardId = e.projeto;
  if (e.dia !== ini.dia) m.date = e.dia;
  // "Hora só com data" roda no servidor sobre o mesclado: tirar o dia leva a
  // hora junto, ou a API recusa.
  const hora = e.dia ? e.hora : null;
  if (hora !== ini.hora) m.time = hora;
  return m;
}

/** Os erros por campo de uma recusa da API; o que não tem campo vai ao aviso. */
function errosDaApi(erro: unknown): { campos: Partial<Record<Campo, string>>; geral: string } {
  if (!(erro instanceof ApiError)) {
    return {
      campos: {},
      geral: "Não foi possível falar com o Yu-book. Confira a conexão e tente de novo.",
    };
  }
  if (erro.code === "NOT_FOUND") {
    return { campos: {}, geral: "Este item ou o projeto escolhido não existe mais." };
  }
  const campos: Partial<Record<Campo, string>> = {};
  const soltos: string[] = [];
  for (const issue of erro.issues) {
    const campo = CAMPO_DO_PATH[issue.path];
    if (campo && !campos[campo]) campos[campo] = issue.message;
    else if (!campo) soltos.push(issue.message);
  }
  // 422 sem `issues` é a regra que cruza campos, conferida no servidor sobre o
  // valor mesclado: ela diz a frase, não o campo.
  const geral = soltos[0] ?? (erro.issues.length === 0 ? erro.message : "");
  return { campos, geral };
}

const ROTULO: Record<TipoItem, { novo: string; editar: string; nome: string }> = {
  evento: { novo: "Novo evento", editar: "Editar evento", nome: "evento" },
  tarefa: { novo: "Nova tarefa", editar: "Editar tarefa", nome: "tarefa" },
};

export function tituloDaFolha(abertura: AberturaFolha, tipo: TipoItem): string {
  return abertura.modo === "criar" ? ROTULO[tipo].novo : ROTULO[tipo].editar;
}

/**
 * O formulário da folha de criar e editar (frente de agenda, Fase 4). Nasce a
 * cada abertura — o `Dialogo` o desmonta ao fechar —, e por isso o estado
 * inicial sai da abertura sem efeito de sincronia.
 *
 * Atalhos em pílulas para o que se escolhe quase sempre (hoje, amanhã, a hora
 * cheia, uma hora de duração) e o seletor nativo para o resto. Erro de campo
 * fica no campo; o que não tem campo, num `Aviso`.
 */
export function FormularioItem({
  abertura,
  onFechar,
  onPedirFechar,
  registrarGuarda,
  onTipo,
  onCriado,
  focoTitulo,
  focoCabecalho,
}: {
  abertura: AberturaFolha;
  /** Fecha já, sem perguntar (salvou, excluiu, descartou). */
  onFechar: () => void;
  /** Fecha se nada se perde; senão a guarda pergunta antes (o "Fechar"). */
  onPedirFechar: () => void;
  /**
   * A guarda que a folha consulta antes de fechar por véu, `Esc`, Voltar ou
   * "Fechar": devolve `false` quando há alteração não salva — e mostra a
   * pergunta de descartar no lugar.
   */
  registrarGuarda: (guarda: (() => boolean) | null) => void;
  /** O tipo atual, para o nome do diálogo acompanhar a alternância. */
  onTipo: (tipo: TipoItem) => void;
  /** Criou com sucesso: a folha lembra o tipo para o próximo "+" da barra. */
  onCriado: (tipo: TipoItem) => void;
  focoTitulo: RefObject<HTMLInputElement | null>;
  focoCabecalho: RefObject<HTMLHeadingElement | null>;
}) {
  const { hoje, fuso } = useHoje();
  const quadros = useQuadros();
  // Muda só quando "Concluir" grava as alterações antes de concluir: dali em
  // diante, o gravado é o novo ponto de partida da comparação.
  const [inicial, setInicial] = useState(() => estadoInicial(abertura, hoje, fuso));
  const [e, setE] = useState(inicial);
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});
  const [geral, setGeral] = useState("");
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  // "Salvar e concluir" usa a mutação do salvar: o estado de espera é dele.
  const [concluindo, setConcluindo] = useState(false);
  // Qual "Escolher" está aberto por toque — só esse abre o seletor ao nascer.
  const [escolhendo, setEscolhendo] = useState<"dia" | "hora" | "fim" | "horaTarefa" | null>(
    null,
  );
  const editando = abertura.modo === "editar";
  const [detalhes, setDetalhes] = useState(
    editando && (inicial.local !== "" || inicial.descricao !== ""),
  );
  const idTitulo = useId();
  const idDetalhes = useId();
  // O `Botao` não repassa ref: o foco volta ao "Excluir" pelo id.
  const idExcluir = useId();
  const focarExcluir = () => document.getElementById(idExcluir)?.focus();

  const criarEvento = useCriarEvento();
  const atualizarEvento = useAtualizarEvento();
  const excluirEvento = useExcluirEvento();
  const criarTarefa = useCriarTarefa();
  const atualizarTarefa = useAtualizarTarefa();
  const excluirTarefa = useExcluirTarefa();
  const concluir = useConcluirTarefa();

  const salvando =
    criarEvento.isPending ||
    atualizarEvento.isPending ||
    criarTarefa.isPending ||
    atualizarTarefa.isPending;
  const excluindo = excluirEvento.isPending || excluirTarefa.isPending;
  const evento = e.tipo === "evento";
  const tarefa = "tarefa" in abertura ? abertura.tarefa : null;
  const id = "evento" in abertura ? abertura.evento.id : tarefa?.id ?? null;

  function mudar(parcial: Partial<Estado>, limpar?: Campo) {
    setE((atual) => ({ ...atual, ...parcial }));
    if (limpar && erros[limpar]) setErros((atual) => ({ ...atual, [limpar]: undefined }));
  }

  function trocarTipo(tipo: TipoItem) {
    mudar({ tipo });
    onTipo(tipo);
    setErros({});
    setGeral("");
  }

  function conferir(): boolean {
    const locais: Partial<Record<Campo, string>> = {};
    if (!e.titulo.trim()) locais.titulo = "Informe um título";
    if (evento && !e.dia) locais.dia = "Escolha o dia do evento";
    if (evento && !e.diaInteiro && !e.inicio) locais.hora = "Escolha a hora, ou Dia inteiro";
    // As regras que cruzam campos, pela mesma função que o servidor aplica
    // (`resolverHorario`, de `shared`): o erro chega ao campo antes da ida.
    // Só com hora — no dia inteiro editado o último dia é o gravado, que a
    // folha não mostra, e quem confere é o servidor.
    if (evento && e.dia && !e.diaInteiro && e.inicio) {
      const fim = fimDoEvento(e.dia, e.inicio, e.fim);
      const pedido = { allDay: false, date: e.dia, startTime: e.inicio, ...fim };
      const { problemas } = resolverHorario(pedido);
      for (const problema of problemas) {
        const campo = CAMPO_DO_PATH[problema.path] ?? "duracao";
        locais[campo] ??= problema.message;
      }
    }
    setErros(locais);
    setGeral("");
    if (locais.titulo) focoTitulo.current?.focus();
    return Object.keys(locais).length === 0;
  }

  function falhou(erro: unknown) {
    const { campos, geral: texto } = errosDaApi(erro);
    setErros(campos);
    setGeral(texto);
    if (campos.local || campos.descricao) setDetalhes(true);
    if (campos.titulo) focoTitulo.current?.focus();
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    if (salvando || !conferir()) return;
    try {
      if (abertura.modo === "criar") {
        if (evento && e.dia) await criarEvento.mutateAsync(paraNovoEvento(e, e.dia, e.inicio));
        else await criarTarefa.mutateAsync(paraNovaTarefa(e));
        onCriado(e.tipo);
      } else if ("evento" in abertura) {
        const mudanca = mudancaDoEvento(e, inicial);
        if (Object.keys(mudanca).length > 0) {
          await atualizarEvento.mutateAsync({ id: abertura.evento.id, mudanca });
        }
      } else {
        const mudanca = mudancaDaTarefa(e, inicial);
        if (Object.keys(mudanca).length > 0) {
          await atualizarTarefa.mutateAsync({ id: abertura.tarefa.id, mudanca });
        }
      }
      onFechar();
    } catch (erro) {
      falhou(erro);
    }
  }

  async function excluir() {
    if (!id) return;
    try {
      if (evento) await excluirEvento.mutateAsync(id);
      else await excluirTarefa.mutateAsync(id);
      onFechar();
    } catch (erro) {
      setConfirmarExclusao(false);
      falhou(erro);
      requestAnimationFrame(focarExcluir);
    }
  }

  /**
   * Concluir (ou reabrir) com campos alterados **grava as alterações antes**,
   * numa sequência só: quem mudou a hora e tocou em "Concluir" quer as duas
   * coisas, e desabilitar o botão pediria um toque a mais e uma explicação.
   * Se a gravação falhar, nada é concluído e o erro fica no campo; se falhar a
   * conclusão, o gravado já vale e vira o novo ponto de partida.
   */
  async function alternarConclusao() {
    if (!tarefa) return;
    const mudanca = mudancaDaTarefa(e, inicial);
    const gravar = Object.keys(mudanca).length > 0;
    if (gravar && !conferir()) return;
    setConcluindo(true);
    try {
      if (gravar) {
        await atualizarTarefa.mutateAsync({ id: tarefa.id, mudanca });
        setInicial(e);
      }
      await concluir.mutateAsync({ id: tarefa.id, concluir: tarefa.completedAt === null });
      onFechar();
    } catch (erro) {
      falhou(erro);
    } finally {
      setConcluindo(false);
    }
  }

  // Alteração que fechar perderia: na criação, o que se escreveu (as pílulas
  // já vêm escolhidas, e não são trabalho); na edição, o que o PATCH mandaria.
  const sujo = !editando
    ? e.titulo.trim() !== "" || e.descricao.trim() !== "" || e.local.trim() !== ""
    : Object.keys(evento ? mudancaDoEvento(e, inicial) : mudancaDaTarefa(e, inicial)).length > 0;
  const sujoRef = useRef(sujo);
  sujoRef.current = sujo;

  useEffect(() => {
    registrarGuarda(() => {
      if (!sujoRef.current) return true;
      setConfirmarExclusao(false);
      setConfirmarDescarte(true);
      return false;
    });
    return () => registrarGuarda(null);
  }, [registrarGuarda]);

  const amanha = hoje ? somarDias(hoje, 1) : null;
  const sabado = hoje ? proximoSabado(hoje) : null;
  const diaEhAtalho = e.dia !== null && (e.dia === hoje || e.dia === amanha || e.dia === sabado);
  const sugerida = e.dia !== null && e.dia === hoje && fuso ? proximaHoraCheia(fuso) : null;
  const horas = [...new Set([...(sugerida ? [sugerida] : []), ...HORAS_SUGERIDAS])];
  const horaEhAtalho = e.inicio !== null && horas.includes(e.inicio);
  const duracoes: number[] = [...DURACOES];
  // A duração gravada que não é atalho vira pílula própria, para estar à vista.
  if (inicial.fim.tipo === "duracao" && !duracoes.includes(inicial.fim.minutos)) {
    duracoes.push(inicial.fim.minutos);
  }

  const resumoDetalhes = [
    evento && e.local.trim() ? `Local: ${e.local.trim()}` : null,
    e.descricao.trim() ? "com descrição" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <form onSubmit={salvar} noValidate className="flex min-h-0 flex-col">
      <div className="px-5 pb-4 pt-3">
        <Alca />
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 ref={focoCabecalho} tabIndex={-1} className="text-lg font-semibold text-titulo">
            {tituloDaFolha(abertura, e.tipo)}
          </h2>
          {tarefa?.completedAt && (
            <span className="text-sm text-ink-400">
              <span aria-hidden="true">✓ </span>Concluída
            </span>
          )}
        </div>

        {!editando && (
          <div
            role="group"
            aria-label="Tipo"
            className="mt-4 grid grid-cols-2 gap-1 rounded-cartao bg-ink-900 p-1"
          >
            <BotaoTipo ativo={evento} onClick={() => trocarTipo("evento")} Icone={IconeCalendario}>
              Evento
            </BotaoTipo>
            <BotaoTipo ativo={!evento} onClick={() => trocarTipo("tarefa")} Icone={IconeTarefa}>
              Tarefa
            </BotaoTipo>
          </div>
        )}

        <div className="mt-5">
          <label htmlFor={idTitulo} className="rotulo">
            Título
          </label>
          <input
            id={idTitulo}
            ref={focoTitulo}
            value={e.titulo}
            onChange={(ev) => mudar({ titulo: ev.target.value }, "titulo")}
            placeholder={evento ? "Reunião, consulta, aniversário…" : "O que precisa ser feito?"}
            autoComplete="off"
            enterKeyHint="done"
            maxLength={200}
            aria-invalid={erros.titulo ? true : undefined}
            aria-describedby={erros.titulo ? `${idTitulo}-e` : undefined}
            className="mt-2 h-12 w-full rounded-controle border border-ink-700 bg-ink-900 px-4
                       text-base text-titulo placeholder:text-ink-400 focus:border-accent-500"
          />
          {erros.titulo && <ErroDoCampo id={`${idTitulo}-e`}>{erros.titulo}</ErroDoCampo>}
        </div>

        <div className="mt-6 space-y-6">
          <GrupoPilulas
            rotulo="Dia"
            erro={erros.dia}
            rodape={e.dia ? diaLongo(e.dia) : evento ? null : "Sem data: fica na lista de tarefas"}
          >
            {!evento && (
              <Pilula
                ativa={e.dia === null}
                onClick={() => {
                  setEscolhendo(null);
                  mudar({ dia: null }, "dia");
                }}
              >
                Sem data
              </Pilula>
            )}
            {(
              [
                [hoje, "Hoje"],
                [amanha, "Amanhã"],
                [sabado, "Sábado"],
              ] as const
            ).map(([dia, texto]) =>
              // "Amanhã" e "Sábado" na sexta são o mesmo dia: uma pílula só.
              texto === "Sábado" && dia === amanha ? null : (
                <Pilula
                  key={texto}
                  ativa={dia !== null && e.dia === dia && escolhendo !== "dia"}
                  disabled={dia === null}
                  rotuloAcessivel={dia ? `${texto}, ${diaLongo(dia)}` : texto}
                  onClick={() => {
                    setEscolhendo(null);
                    mudar({ dia }, "dia");
                  }}
                >
                  {texto}
                </Pilula>
              ),
            )}
            {escolhendo === "dia" || (e.dia !== null && !diaEhAtalho) ? (
              <PilulaEscolher
                tipo="date"
                valor={e.dia ?? ""}
                rotulo="Dia escolhido"
                abrirAoNascer={escolhendo === "dia"}
                onEscolher={(dia) => mudar({ dia }, "dia")}
              />
            ) : (
              <Pilula ativa={false} onClick={() => setEscolhendo("dia")}>
                Escolher…
              </Pilula>
            )}
          </GrupoPilulas>

          {evento ? (
            <>
              <GrupoPilulas rotulo="Hora" erro={erros.hora}>
                <Pilula
                  ativa={e.diaInteiro}
                  onClick={() => {
                    setEscolhendo(null);
                    mudar({ diaInteiro: true }, "hora");
                  }}
                >
                  Dia inteiro
                </Pilula>
                {horas.map((hora) => (
                  <Pilula
                    key={hora}
                    ativa={!e.diaInteiro && e.inicio === hora && escolhendo !== "hora"}
                    onClick={() => {
                      setEscolhendo(null);
                      mudar({ diaInteiro: false, inicio: hora }, "hora");
                    }}
                  >
                    {hora}
                  </Pilula>
                ))}
                {!e.diaInteiro && (escolhendo === "hora" || (e.inicio !== null && !horaEhAtalho)) ? (
                  <PilulaEscolher
                    tipo="time"
                    valor={e.inicio ?? ""}
                    rotulo="Hora de início escolhida"
                    abrirAoNascer={escolhendo === "hora"}
                    onEscolher={(inicio) => mudar({ inicio }, "hora")}
                  />
                ) : (
                  <Pilula
                    ativa={false}
                    onClick={() => {
                      setEscolhendo("hora");
                      mudar({ diaInteiro: false }, "hora");
                    }}
                  >
                    Escolher…
                  </Pilula>
                )}
              </GrupoPilulas>

              {!e.diaInteiro && (
                <GrupoPilulas
                  rotulo="Duração"
                  erro={erros.duracao}
                  rodape={e.dia && e.inicio ? rodapeDoFim(e.dia, e.inicio, e.fim) : null}
                >
                  {duracoes.map((minutos) => (
                    <Pilula
                      key={minutos}
                      ativa={e.fim.tipo === "duracao" && e.fim.minutos === minutos}
                      onClick={() => {
                        setEscolhendo(null);
                        mudar({ fim: { tipo: "duracao", minutos } }, "duracao");
                      }}
                    >
                      {duracaoCurta(minutos)}
                    </Pilula>
                  ))}
                  {e.fim.tipo === "hora" ? (
                    <PilulaEscolher
                      tipo="time"
                      valor={e.fim.hora}
                      rotulo="Hora de término escolhida"
                      abrirAoNascer={escolhendo === "fim"}
                      onEscolher={(hora) => mudar({ fim: { tipo: "hora", hora } }, "duracao")}
                    />
                  ) : (
                    <Pilula
                      ativa={false}
                      onClick={() => {
                        setEscolhendo("fim");
                        mudar({ fim: { tipo: "hora", hora: horaFinal(e) } }, "duracao");
                      }}
                    >
                      Até…
                    </Pilula>
                  )}
                </GrupoPilulas>
              )}
            </>
          ) : (
            e.dia !== null && (
              <GrupoPilulas rotulo="Hora" erro={erros.hora}>
                <Pilula
                  ativa={e.hora === null && escolhendo !== "horaTarefa"}
                  onClick={() => {
                    setEscolhendo(null);
                    mudar({ hora: null }, "hora");
                  }}
                >
                  Sem hora
                </Pilula>
                {escolhendo === "horaTarefa" || e.hora !== null ? (
                  <PilulaEscolher
                    tipo="time"
                    valor={e.hora ?? ""}
                    rotulo="Hora da tarefa"
                    abrirAoNascer={escolhendo === "horaTarefa"}
                    onEscolher={(hora) => mudar({ hora }, "hora")}
                  />
                ) : (
                  <Pilula ativa={false} onClick={() => setEscolhendo("horaTarefa")}>
                    Escolher…
                  </Pilula>
                )}
              </GrupoPilulas>
            )
          )}

          <GrupoPilulas rotulo="Projeto" erro={erros.projeto}>
            <Pilula ativa={e.projeto === null} onClick={() => mudar({ projeto: null }, "projeto")}>
              Nenhum
            </Pilula>
            {quadros.isPending &&
              [0, 1].map((i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="h-11 w-24 animate-pulse rounded-full bg-ink-800"
                />
              ))}
            {quadros.data?.map((q) => (
              <Pilula
                key={q.id}
                ativa={e.projeto === q.id}
                onClick={() => mudar({ projeto: q.id }, "projeto")}
              >
                <span className="max-w-48 truncate">{q.name}</span>
              </Pilula>
            ))}
          </GrupoPilulas>
          {quadros.isError && (
            <Aviso tom="alerta">
              Não deu para carregar os projetos.{" "}
              <button type="button" className="underline" onClick={() => void quadros.refetch()}>
                Tentar de novo
              </button>
            </Aviso>
          )}

          <div>
            {/* Recolhido, o botão diz o que guarda (skill de design, §5). */}
            <button
              type="button"
              aria-expanded={detalhes}
              aria-controls={idDetalhes}
              onClick={() => setDetalhes((d) => !d)}
              className="flex min-h-11 w-full items-center gap-2 rounded-controle text-left"
            >
              <IconeChevron
                direcao={detalhes ? "baixo" : "direita"}
                className="size-4 text-ink-400"
              />
              <span className="text-sm font-medium text-ink-200">Mais detalhes</span>
              {!detalhes && resumoDetalhes && (
                <span className="min-w-0 truncate text-sm text-ink-400">{resumoDetalhes}</span>
              )}
            </button>
            {detalhes && (
              <div id={idDetalhes} className="mt-3 space-y-4">
                {evento && (
                  <CampoTexto
                    rotulo="Local"
                    valor={e.local}
                    erro={erros.local}
                    onMudar={(local) => mudar({ local }, "local")}
                    maxLength={200}
                  />
                )}
                <CampoTexto
                  rotulo="Descrição"
                  valor={e.descricao}
                  erro={erros.descricao}
                  onMudar={(descricao) => mudar({ descricao }, "descricao")}
                  maxLength={5000}
                  multilinha
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* O pé fica preso no fim da folha: salvar está sempre ao alcance, por
          maior que o formulário fique. */}
      <div className="sticky bottom-0 border-t border-ink-800 bg-superficie px-5 pb-5 pt-3">
        {geral && (
          <Aviso tom="erro" onFechar={() => setGeral("")} className="mb-3">
            {geral}
          </Aviso>
        )}
        {confirmarDescarte ? (
          <div role="group" aria-labelledby={`${idTitulo}-d`}>
            <p id={`${idTitulo}-d`} className="mb-3 text-sm text-ink-200">
              Descartar alterações? O que você mudou não foi salvo.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {/* O foco cai no caminho seguro: um Enter distraído não apaga nada. */}
              <Botao
                variante="secundario"
                tamanho="g"
                autoFocus
                onClick={() => {
                  setConfirmarDescarte(false);
                  requestAnimationFrame(() => focoTitulo.current?.focus());
                }}
              >
                Continuar editando
              </Botao>
              <Botao variante="perigo" tamanho="g" onClick={onFechar}>
                Descartar
              </Botao>
            </div>
          </div>
        ) : confirmarExclusao ? (
          <div role="group" aria-labelledby={`${idTitulo}-x`}>
            <p id={`${idTitulo}-x`} className="mb-3 text-sm text-ink-200">
              Excluir {evento ? "este evento" : "esta tarefa"}? Não dá para desfazer.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Botao
                variante="secundario"
                tamanho="g"
                onClick={() => {
                  setConfirmarExclusao(false);
                  requestAnimationFrame(focarExcluir);
                }}
              >
                Cancelar
              </Botao>
              {/* Nasce no lugar do "Excluir" e recebe o foco: o Enter seguinte é a
                  confirmação que se acabou de pedir, não o "Salvar". */}
              <Botao
                variante="perigo"
                tamanho="g"
                autoFocus
                carregando={excluindo}
                onClick={excluir}
              >
                Excluir
              </Botao>
            </div>
          </div>
        ) : (
          <>
            {editando && (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Botao
                  id={idExcluir}
                  variante="perigo"
                  tamanho="g"
                  onClick={() => setConfirmarExclusao(true)}
                  className={tarefa ? "" : "col-span-2"}
                >
                  Excluir
                </Botao>
                {tarefa && (
                  <Botao
                    variante="secundario"
                    tamanho="g"
                    carregando={concluindo}
                    onClick={alternarConclusao}
                  >
                    {/* Com alteração, o nome diz que ela vai junto. */}
                    {sujo
                      ? tarefa.completedAt
                        ? "Salvar e reabrir"
                        : "Salvar e concluir"
                      : tarefa.completedAt
                        ? "Reabrir"
                        : "Concluir"}
                  </Botao>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Botao variante="secundario" tamanho="g" onClick={onPedirFechar}>
                Fechar
              </Botao>
              <Botao
                type="submit"
                variante="primario"
                tamanho="g"
                carregando={salvando && !concluindo}
                disabled={concluindo}
              >
                {editando ? "Salvar" : `Criar ${ROTULO[e.tipo].nome}`}
              </Botao>
            </div>
          </>
        )}
      </div>
    </form>
  );
}

/** Ao trocar para "Até…", parte do fim que a duração dava — não de 00:00. */
function horaFinal(e: Estado): string {
  if (!e.dia || !e.inicio || e.fim.tipo === "hora") return e.inicio ?? "10:00";
  return somarMinutos(e.dia, e.inicio, e.fim.minutos).hora;
}

/** "De 14:00 às 15:00", ou com o dia do fim quando ele não é o do início. */
function rodapeDoFim(dia: string, inicio: string, fim: Fim): string {
  if (fim.tipo === "hora") {
    // A mesma inferência do servidor: fim antes do início atravessa a meia-noite.
    return fim.hora < inicio
      ? `De ${inicio} até ${fim.hora} do dia seguinte`
      : `De ${inicio} às ${fim.hora}`;
  }
  const f = somarMinutos(dia, inicio, fim.minutos);
  return f.dia === dia
    ? `De ${inicio} às ${f.hora}`
    : `De ${inicio} até ${diaCurto(f.dia)}, ${f.hora}`;
}

function BotaoTipo({
  ativo,
  onClick,
  Icone,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  Icone: (p: IconeProps) => ReactElement;
  children: ReactNode;
}) {
  // O ativo se ergue como cartão: forma além da cor (o `SeletorModo` do web).
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-controle text-sm
                  transition-colors duration-150 ${
                    ativo
                      ? "bg-superficie font-semibold text-titulo shadow-e1"
                      : "font-medium text-ink-400 hover:text-ink-200"
                  }`}
    >
      <Icone className="size-4" />
      {children}
    </button>
  );
}

function CampoTexto({
  rotulo,
  valor,
  erro,
  onMudar,
  maxLength,
  multilinha = false,
}: {
  rotulo: string;
  valor: string;
  erro?: string;
  onMudar: (valor: string) => void;
  maxLength: number;
  multilinha?: boolean;
}) {
  const id = useId();
  const comum = {
    id,
    value: valor,
    maxLength,
    "aria-invalid": erro ? true : undefined,
    "aria-describedby": erro ? `${id}-e` : undefined,
    className: `mt-2 w-full rounded-controle border border-ink-700 bg-ink-900 px-4 text-base
                text-titulo placeholder:text-ink-400 focus:border-accent-500 ${
                  multilinha ? "min-h-28 py-3" : "h-12"
                }`,
  };
  return (
    <div>
      <label htmlFor={id} className="rotulo">
        {rotulo}
      </label>
      {multilinha ? (
        <textarea {...comum} onChange={(ev) => onMudar(ev.target.value)} />
      ) : (
        <input {...comum} autoComplete="off" onChange={(ev) => onMudar(ev.target.value)} />
      )}
      {erro && <ErroDoCampo id={`${id}-e`}>{erro}</ErroDoCampo>}
    </div>
  );
}
