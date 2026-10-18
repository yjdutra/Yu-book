import {
  invalidarAgenda,
  useAtualizarEvento,
  useAtualizarTarefa,
  useConverterEvento,
  useConverterTarefa,
  useCriarEvento,
  useCriarTarefa,
  useExcluirEvento,
  useExcluirTarefa,
} from "@yu-book/cliente/agenda";
import type { NovaTarefa, NovoEvento } from "@yu-book/cliente/agenda";
import { ApiError } from "@yu-book/cliente/api";
import { useConcluirTarefa } from "@yu-book/cliente/concluirTarefa";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import {
  IconeCalendario,
  IconeChevron,
  IconeRepetir,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import {
  DURACAO_PADRAO_DO_EVENTO_MIN,
  NOMES_CURTOS_DOS_DIAS,
  descreverDias,
  minutosEntre,
  primeiroDiaDaSerie,
  resolverHorario,
  resolverSerie,
  somarDias,
  somarMinutos,
} from "@yu-book/shared";
import type {
  EscopoDoEvento,
  EventItem,
  EventScope,
  EventUpdateInput,
  PedidoDeHorario,
  TaskItem,
  TaskUpdateInput,
} from "@yu-book/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactElement, ReactNode, RefObject } from "react";
import {
  DIAS_LONGOS,
  diaCurto,
  diaDaSemana,
  diaLongo,
  diaMesCurto,
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
  /// Repetição semanal, só do evento (frente de eventos recorrentes, R3):
  /// ligada ou não, os dias (0 = domingo) e o último dia, inclusive.
  repetir: boolean;
  dias: number[];
  ate: string | null;
}

/** Os campos do formulário que um erro pode apontar. */
type Campo =
  | "titulo"
  | "dia"
  | "hora"
  | "duracao"
  | "repetir"
  | "projeto"
  | "local"
  | "descricao";

/// O `path` dos `issues` do 422 (inglês, a fronteira) para o campo na tela.
const CAMPO_DO_PATH: Record<string, Campo> = {
  title: "titulo",
  date: "dia",
  endDate: "dia",
  allDay: "hora",
  startTime: "hora",
  time: "hora",
  endTime: "duracao",
  repeat: "repetir",
  "repeat.days": "repetir",
  "repeat.until": "repetir",
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
    // A duração que o servidor dá ao evento sem fim (`resolverHorario`): a
    // folha começa no mesmo padrão, e não numa cópia dele.
    fim: { tipo: "duracao", minutos: DURACAO_PADRAO_DO_EVENTO_MIN } as Fim,
    local: "",
    hora: null,
    projeto: null,
    descricao: "",
    repetir: false,
    dias: [] as number[],
    ate: null,
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
    // Numa série, `e` é a **ocorrência** tocada: dia e hora dela, e a regra da
    // série (`recurrence`), que é a mesma em toda ocorrência.
    const e = abertura.evento;
    const minutos =
      e.startTime && e.endTime
        ? minutosEntre(e.date, e.startTime, e.endDate, e.endTime)
        : DURACAO_PADRAO_DO_EVENTO_MIN;
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
      // `!= null`, não `!== null`: na janela do deploy a API velha não manda o
      // campo, e `undefined !== null` ligaria "Repetir" sem dia nenhum — a
      // folha recusaria salvar o evento simples.
      repetir: e.recurrence != null,
      dias: e.recurrence?.days ?? [],
      ate: e.recurrence?.until ?? null,
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
  // Hora escolhida: o servidor decide o dia (antes do início, atravessa a meia-noite — "das 22h à
  // 1h"). Igual ao início não atravessa: 24 h por aqui dá 422 — limite aceito (plantão é raro).
  return { endDate: null, endTime: fim.hora };
}

/**
 * A série cabe na regra que o servidor aplica (`resolverSerie`): evento de um
 * dia só, ou com hora e até 24 h. O dia inteiro que a folha cria é de um dia;
 * o de vários dias, gravado por outro caminho, não repete enquanto seguir dia
 * inteiro. Fora da regra, a seção "Repetir" some e a repetição não vai.
 */
function cabeRepetir(e: Estado, longoGravado: boolean): boolean {
  if (e.tipo !== "evento") return false;
  if (e.diaInteiro) return !longoGravado;
  return e.fim.tipo === "hora" || e.fim.minutos <= 1440;
}

type Regra = { days: number[]; until: string | null };

/** A regra que o formulário pede, ou `null` (não repete). */
function regraDo(e: Estado, cabe: boolean): Regra | null {
  return e.repetir && cabe ? { days: [...e.dias].sort((a, b) => a - b), until: e.ate } : null;
}

function mesmaRegra(a: Regra | null, b: Regra | null): boolean {
  if (!a || !b) return a === b;
  return a.until === b.until && a.days.join() === b.days.join();
}

/** O horário que o formulário pede, como `resolverHorario` o recebe. */
function pedidoDeHorario(e: Estado, dia: string, inicio: string | null): PedidoDeHorario {
  if (e.diaInteiro || !inicio) return { allDay: true, date: dia };
  return { allDay: false, date: dia, startTime: inicio, ...fimDoEvento(dia, inicio, e.fim) };
}

function paraNovoEvento(e: Estado, dia: string, inicio: string | null, cabe: boolean): NovoEvento {
  const regra = regraDo(e, cabe);
  return {
    title: e.titulo.trim(),
    description: e.descricao,
    location: e.local.trim() || null,
    boardId: e.projeto,
    ...pedidoDeHorario(e, dia, inicio),
    ...(regra && { repeat: regra }),
  };
}

/**
 * Sobre o que o PATCH se mescla no servidor: o próprio evento (ou a
 * ocorrência, nos escopos `esta` e `seguintes`), ou o **início da série**, no
 * escopo `todas` — e então o dia da ocorrência aberta não pode ir no `date`.
 */
type BaseDaMudanca = "ocorrencia" | "serie";

/**
 * Só o que mudou. O horário segue "o que se vê é o que se grava": mudou
 * qualquer parte dele num evento com hora, vão início e fim por extenso — o
 * fim que a tela mostra, e não o que `mesclarHorario` deduziria. No dia
 * inteiro vai só a parte mexida, e o servidor anda com o vão (um evento de
 * três dias movido continua de três dias).
 *
 * **Na série inteira (`base: "serie"`)** o `date` é o início dela, e não o da
 * ocorrência aberta: só vai se o usuário mudou o dia de propósito — e aí a
 * série recomeça dali, o que a pergunta de alcance avisa. Com o dia intocado
 * vão só as horas, e o dia do fim fica com o servidor, que o mede a partir do
 * início da série — este lado só conhece o dia da ocorrência:
 *
 * - **Duração intocada:** só `startTime`, e `mesclarHorario` preserva a duração
 *   gravada — inclusive a de 24 h (08:00 → 08:00 do dia seguinte).
 * - **Duração nova abaixo de 24 h:** `endTime` com `endDate: null`, a
 *   inferência da criação (fim antes do início atravessa a meia-noite). Sem o
 *   `null`, a série de 24 h gravada guardaria o vão de um dia, e "2 h" viraria
 *   26 h, recusada.
 * - **Duração nova de 24 h:** `endTime` **sem** `endDate`. A inferência daria
 *   fim igual ao início (422 "O fim precisa ser depois do início"); sem o
 *   campo, a série de 24 h gravada guarda o vão. Vinda de uma série mais curta,
 *   o servidor ainda infere — limite dele, não deste lado.
 *
 * `comRegra: false` (escopo `esta`) deixa a repetição de fora: ela não muda
 * numa ocorrência só.
 */
function mudancaDoEvento(
  e: Estado,
  ini: Estado,
  { cabe, base = "ocorrencia", comRegra = true }: {
    cabe: boolean;
    base?: BaseDaMudanca;
    comRegra?: boolean;
  },
): EventUpdateInput {
  const m: EventUpdateInput = {};
  if (e.titulo.trim() !== ini.titulo) m.title = e.titulo.trim();
  if (e.descricao !== ini.descricao) m.description = e.descricao;
  if (e.local.trim() !== ini.local) m.location = e.local.trim() || null;
  if (e.projeto !== ini.projeto) m.boardId = e.projeto;
  const regra = regraDo(e, cabe);
  if (comRegra && !mesmaRegra(regra, regraDo(ini, true))) m.repeat = regra;

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
  const fim = fimDoEvento(e.dia, e.inicio, e.fim);
  if (base === "serie" && e.dia === ini.dia) {
    if (mesmoFim(e.fim, ini.fim)) return { ...m, startTime: e.inicio };
    // Fim por hora escolhida chega sem dia: a mesma hora do início é 24 h.
    const noDia = minutosEntre(e.dia, e.inicio, fim.endDate ?? e.dia, fim.endTime);
    const minutos = noDia > 0 ? noDia : noDia + 1440;
    return minutos < 1440
      ? { ...m, startTime: e.inicio, endDate: null, endTime: fim.endTime }
      : { ...m, startTime: e.inicio, endTime: fim.endTime };
  }
  return { ...m, date: e.dia, startTime: e.inicio, ...fim };
}

/**
 * "Toda seg, qua e sex, até 18 de dez" — o resumo da regra, sob a seção. As
 * siglas são as de `NOMES_CURTOS_DOS_DIAS`, as mesmas do "repete …" dos itens e do
 * chat (`descreverDias`). Na criação, diz também quando cai a primeira, se não
 * é o dia escolhido: o servidor leva o início ao primeiro dia da regra.
 */
function resumoDaRepeticao(e: Estado, mostrarPrimeira: boolean): string {
  if (e.dias.length === 0) return "Escolha pelo menos um dia da semana.";
  const dias = [...e.dias].sort((a, b) => a - b);
  const siglas = dias.map((d) => NOMES_CURTOS_DOS_DIAS[d] ?? "");
  const ultima = siglas.pop();
  const lista =
    dias.length === 7
      ? "Todo dia"
      : `${dias[0] === 0 || dias[0] === 6 ? "Todo" : "Toda"} ${
          siglas.length > 0 ? `${siglas.join(", ")} e ${ultima}` : ultima
        }`;
  const fim = e.ate ? `até ${diaMesCurto(e.ate, e.dia)}` : "sem data de fim";
  const primeira = mostrarPrimeira && e.dia ? primeiroDiaDaSerie(e.dia, dias) : null;
  const aviso = primeira && primeira !== e.dia ? `. A primeira cai em ${diaCurto(primeira)}` : "";
  return `${lista}, ${fim}${aviso}.`;
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

/**
 * Os erros por campo de uma recusa da API; o que não tem campo vai ao aviso.
 * `ocorrencia`: a escrita tocava uma ocorrência de série, e o 404 pode ser
 * dela — cancelada, ou a série encurtada noutro aparelho.
 */
function errosDaApi(
  erro: unknown,
  ocorrencia = false,
): { campos: Partial<Record<Campo, string>>; geral: string } {
  if (!(erro instanceof ApiError)) {
    return {
      campos: {},
      geral: "Não foi possível falar com o Yu-book. Confira a conexão e tente de novo.",
    };
  }
  if (erro.code === "NOT_FOUND") {
    return {
      campos: {},
      geral: ocorrencia
        ? "Esta ocorrência ou o projeto escolhido não existe mais — a série pode ter mudado " +
          "noutro lugar. A agenda foi atualizada."
        : "Este item ou o projeto escolhido não existe mais.",
    };
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

/** O tipo do item aberto para editar; `null` na criação. */
function tipoAberto(abertura: AberturaFolha): TipoItem | null {
  if (abertura.modo === "criar") return null;
  return "evento" in abertura ? "evento" : "tarefa";
}

export function tituloDaFolha(abertura: AberturaFolha, tipo: TipoItem): string {
  if (abertura.modo === "criar") return ROTULO[tipo].novo;
  // A alternância na edição converte: o nome do diálogo diz o que vai acontecer.
  return tipo === tipoAberto(abertura) ? ROTULO[tipo].editar : `Converter em ${ROTULO[tipo].nome}`;
}

/**
 * A descrição que a tarefa leva quando a pessoa a mexeu antes de converter: o
 * local do evento não tem campo na tarefa e vai junto no texto, como faz o
 * servidor quando a descrição não vem.
 */
function descricaoConvertida(e: Estado): string {
  const local = e.local.trim();
  if (!local) return e.descricao;
  return `${e.descricao ? `${e.descricao}\n\n` : ""}Local: ${local}`;
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
  // A pergunta de alcance ao salvar uma ocorrência de série — inline no pé,
  // como a de excluir, sem diálogo aninhado.
  const [confirmarAlcance, setConfirmarAlcance] = useState(false);
  // Qual alcance está gravando ou excluindo: o botão dele mostra a espera.
  const [alcanceEmCurso, setAlcanceEmCurso] = useState<EscopoDoEvento | null>(null);
  // "Salvar e concluir" usa a mutação do salvar: o estado de espera é dele.
  const [concluindo, setConcluindo] = useState(false);
  // Qual "Escolher" está aberto por toque — só esse abre o seletor ao nascer.
  const [escolhendo, setEscolhendo] = useState<
    "dia" | "hora" | "fim" | "horaTarefa" | "ate" | null
  >(null);
  const editando = abertura.modo === "editar";
  const [detalhes, setDetalhes] = useState(
    editando && (inicial.local !== "" || inicial.descricao !== ""),
  );
  const idTitulo = useId();
  const idDetalhes = useId();
  // O `Botao` não repassa ref: o foco volta ao "Excluir" pelo id.
  const idExcluir = useId();
  const focarExcluir = () => document.getElementById(idExcluir)?.focus();
  const idSalvar = useId();
  const focarSalvar = () => document.getElementById(idSalvar)?.focus();
  const qc = useQueryClient();

  const criarEvento = useCriarEvento();
  const atualizarEvento = useAtualizarEvento();
  const excluirEvento = useExcluirEvento();
  const criarTarefa = useCriarTarefa();
  const atualizarTarefa = useAtualizarTarefa();
  const excluirTarefa = useExcluirTarefa();
  const concluir = useConcluirTarefa();
  const converterEvento = useConverterEvento();
  const converterTarefa = useConverterTarefa();

  const salvando =
    criarEvento.isPending ||
    atualizarEvento.isPending ||
    criarTarefa.isPending ||
    atualizarTarefa.isPending ||
    converterEvento.isPending ||
    converterTarefa.isPending;
  const excluindo = excluirEvento.isPending || excluirTarefa.isPending;
  const evento = e.tipo === "evento";
  const tarefa = "tarefa" in abertura ? abertura.tarefa : null;
  const id = "evento" in abertura ? abertura.evento.id : tarefa?.id ?? null;
  // A ocorrência aberta, quando ela é de uma série: salvar e excluir
  // perguntam o alcance (frente de eventos recorrentes, R3).
  const eventoAberto = "evento" in abertura ? abertura.evento : null;
  const serie = eventoAberto?.recurrence ? eventoAberto : null;
  // O dia inteiro de vários dias, gravado por outro caminho, não cabe numa série.
  const longoGravado =
    eventoAberto !== null && eventoAberto.allDay && eventoAberto.endDate !== eventoAberto.date;
  const cabe = cabeRepetir(e, longoGravado && inicial.diaInteiro);
  const repete = e.repetir && cabe;
  const regraMudou = !mesmaRegra(regraDo(e, cabe), regraDo(inicial, true));
  // Na edição, trocar o tipo converte o item: evento vira tarefa e vice-versa.
  // Tarefa concluída não converte (o evento não guarda conclusão), e a
  // alternância nem aparece para ela.
  const convertendo = editando && e.tipo !== tipoAberto(abertura);
  const podeConverter = editando && !tarefa?.completedAt;

  function mudar(parcial: Partial<Estado>, limpar?: Campo) {
    setE((atual) => ({ ...atual, ...parcial }));
    if (limpar && erros[limpar]) setErros((atual) => ({ ...atual, [limpar]: undefined }));
  }

  function trocarTipo(tipo: TipoItem) {
    if (tipo === e.tipo) return;
    // Na edição o item muda de forma, e o horário passa de uma para a outra:
    // o início do evento vira a hora da tarefa (nenhuma no dia inteiro), e a
    // hora da tarefa vira o início — sem ela, dia inteiro. Na criação as duas
    // formas guardam o que cada uma tinha, como sempre.
    if (editando && tipo === "tarefa") {
      mudar({ tipo, hora: e.diaInteiro ? null : e.inicio });
    } else if (editando) {
      mudar({ tipo, dia: e.dia ?? hoje, diaInteiro: e.hora === null, inicio: e.hora ?? e.inicio });
    } else {
      mudar({ tipo });
    }
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
    if (repete && e.dias.length === 0) locais.repetir = "Escolha pelo menos um dia da semana";
    // A regra da série (um dia só, `until` depois do início, algum dia
    // escolhido até o fim) pela função do servidor, `resolverSerie` — só na
    // criação: ao editar uma ocorrência, o início da série não é o dia que a
    // folha mostra, e quem confere é o servidor, sobre o gravado.
    if (evento && e.dia && repete && !editando && !locais.repetir) {
      const { problemas } = resolverSerie(pedidoDeHorario(e, e.dia, e.inicio), {
        days: e.dias,
        until: e.ate,
      });
      for (const problema of problemas) {
        const campo = CAMPO_DO_PATH[problema.path] ?? "repetir";
        locais[campo] ??= problema.message;
      }
    }
    setErros(locais);
    setGeral("");
    if (locais.titulo) focoTitulo.current?.focus();
    return Object.keys(locais).length === 0;
  }

  function falhou(erro: unknown, ocorrencia = false) {
    const { campos, geral: texto } = errosDaApi(erro, ocorrencia);
    // A série mudou noutro lugar: a agenda por trás da folha está velha.
    if (ocorrencia && erro instanceof ApiError && erro.code === "NOT_FOUND") invalidarAgenda(qc);
    setErros(campos);
    setGeral(texto);
    if (campos.local || campos.descricao) setDetalhes(true);
    if (campos.titulo) focoTitulo.current?.focus();
  }

  /**
   * Converte o item aberto no outro tipo, com o que está na tela. O servidor
   * faz a troca numa transação; numa série, só a ocorrência aberta vira
   * tarefa. A descrição só vai se a pessoa a mexeu — intocada, o servidor
   * anexa local e link do evento sozinho.
   */
  async function converter() {
    try {
      if (eventoAberto) {
        const { descriptionMd: _descricao, ...corpo } = paraNovaTarefa(e);
        const mexeu = e.descricao !== inicial.descricao;
        await converterEvento.mutateAsync({
          id: eventoAberto.id,
          corpo: mexeu ? { ...corpo, descriptionMd: descricaoConvertida(e) } : corpo,
          escopo: serie
            ? { scope: "esta", occurrenceDate: serie.occurrenceDate ?? serie.date }
            : undefined,
        });
      } else if (tarefa && e.dia) {
        await converterTarefa.mutateAsync({
          id: tarefa.id,
          corpo: paraNovoEvento(e, e.dia, e.inicio, cabe),
        });
      }
      onFechar();
    } catch (erro) {
      falhou(erro, serie !== null);
    }
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    if (salvando || !conferir()) return;
    if (convertendo) {
      await converter();
      return;
    }
    try {
      if (abertura.modo === "criar") {
        if (evento && e.dia) {
          await criarEvento.mutateAsync(paraNovoEvento(e, e.dia, e.inicio, cabe));
        } else {
          await criarTarefa.mutateAsync(paraNovaTarefa(e));
        }
        onCriado(e.tipo);
      } else if ("evento" in abertura) {
        const mudanca = mudancaDoEvento(e, inicial, { cabe });
        if (Object.keys(mudanca).length > 0) {
          // Numa série, o alcance vem antes da ida: a pergunta toma o pé.
          if (serie) {
            setConfirmarAlcance(true);
            return;
          }
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

  /// O alcance como a API o pede: `todas` não diz ocorrência.
  const escopoDe = (scope: EscopoDoEvento): EventScope | undefined => {
    if (!serie) return undefined;
    return scope === "todas" ? { scope } : { scope, occurrenceDate: serie.occurrenceDate ?? serie.date };
  };

  /**
   * Salvar uma ocorrência de série, com o alcance escolhido. Em `todas` a
   * mudança se mede contra o início da série (`base: "serie"`); em `esta` a
   * repetição fica de fora — a pergunta nem oferece `esta` quando ela mudou.
   */
  async function salvarNaSerie(scope: EscopoDoEvento) {
    if (!serie) return;
    const mudanca = mudancaDoEvento(e, inicial, {
      cabe,
      base: scope === "todas" ? "serie" : "ocorrencia",
      comRegra: scope !== "esta",
    });
    setAlcanceEmCurso(scope);
    try {
      if (Object.keys(mudanca).length > 0) {
        await atualizarEvento.mutateAsync({ id: serie.id, mudanca, escopo: escopoDe(scope) });
      }
      onFechar();
    } catch (erro) {
      setConfirmarAlcance(false);
      falhou(erro, scope !== "todas");
      requestAnimationFrame(focarSalvar);
    } finally {
      setAlcanceEmCurso(null);
    }
  }

  async function excluir(scope: EscopoDoEvento = "todas") {
    if (!id) return;
    setAlcanceEmCurso(scope);
    try {
      if (evento) await excluirEvento.mutateAsync({ id, escopo: escopoDe(scope) });
      else await excluirTarefa.mutateAsync(id);
      onFechar();
    } catch (erro) {
      setConfirmarExclusao(false);
      falhou(erro, serie !== null && scope !== "todas");
      requestAnimationFrame(focarExcluir);
    } finally {
      setAlcanceEmCurso(null);
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
    : convertendo ||
      Object.keys(evento ? mudancaDoEvento(e, inicial, { cabe }) : mudancaDaTarefa(e, inicial))
        .length > 0;
  const sujoRef = useRef(sujo);
  sujoRef.current = sujo;

  useEffect(() => {
    registrarGuarda(() => {
      if (!sujoRef.current) return true;
      setConfirmarExclusao(false);
      setConfirmarAlcance(false);
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
        {serie?.recurrence && (
          // Quem abre uma ocorrência sabe, antes de mexer, que é de uma série —
          // e qual: salvar e excluir vão perguntar o alcance.
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-400">
            <IconeRepetir className="size-3.5" />
            <span>
              Repete {descreverDias(serie.recurrence.days)} · esta é a de{" "}
              {diaCurto(serie.occurrenceDate ?? serie.date)}
            </span>
          </p>
        )}

        {(!editando || podeConverter) && (
          <div
            role="group"
            aria-label={editando ? "Converter em" : "Tipo"}
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
        {convertendo && (
          <p className="mt-2 text-sm text-ink-400">
            {evento
              ? "Ao salvar, a tarefa vira evento e sai da lista de tarefas."
              : serie
                ? `Ao salvar, só a ocorrência de ${diaCurto(
                    serie.occurrenceDate ?? serie.date,
                  )} vira tarefa; as outras continuam na série.`
                : "Ao salvar, o evento vira tarefa. Local e link vão para os detalhes, e a " +
                  "duração não fica."}
          </p>
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

          {evento && cabe && (
            <SecaoRepetir
              e={e}
              erro={erros.repetir}
              escolhendoAte={escolhendo === "ate"}
              mostrarPrimeira={serie === null}
              onEscolherAte={() => setEscolhendo("ate")}
              onMudar={(parcial) => {
                if (parcial.ate === null) setEscolhendo(null);
                mudar(parcial, "repetir");
              }}
            />
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
        ) : confirmarAlcance && serie ? (
          <div role="group" aria-labelledby={`${idTitulo}-a`}>
            <p id={`${idTitulo}-a`} className="mb-3 text-sm text-ink-200">
              Este evento se repete. Aplicar a alteração a quais ocorrências?
            </p>
            {regraMudou && (
              <p className="mb-3 text-xs text-ink-400">
                A repetição muda nesta e nas seguintes, ou em todas — não numa só.
              </p>
            )}
            {e.dia && e.dia !== inicial.dia && (
              <p className="mb-3 text-xs text-ink-400">
                <span aria-hidden="true">! </span>Em “Todas”, a série recomeça em{" "}
                {diaCurto(e.dia)}, e as ocorrências antes dele somem.
              </p>
            )}
            {regraMudou && !repete && (
              <p className="mb-3 text-xs text-ink-400">
                Sem repetição, “Todas” deixa só a primeira ocorrência da série, e “Esta e
                as seguintes”, só esta.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {!regraMudou && (
                // O foco cai no alcance menor: um Enter distraído mexe numa só.
                <Botao
                  variante="primario"
                  tamanho="g"
                  autoFocus
                  carregando={alcanceEmCurso === "esta"}
                  disabled={alcanceEmCurso !== null}
                  onClick={() => void salvarNaSerie("esta")}
                >
                  Alterar só esta
                </Botao>
              )}
              <Botao
                variante={regraMudou ? "primario" : "secundario"}
                tamanho="g"
                autoFocus={regraMudou}
                carregando={alcanceEmCurso === "seguintes"}
                disabled={alcanceEmCurso !== null}
                onClick={() => void salvarNaSerie("seguintes")}
              >
                Esta e as seguintes
              </Botao>
              <Botao
                variante="secundario"
                tamanho="g"
                carregando={alcanceEmCurso === "todas"}
                disabled={alcanceEmCurso !== null}
                onClick={() => void salvarNaSerie("todas")}
              >
                Todas
              </Botao>
              <Botao
                variante="fantasma"
                tamanho="g"
                disabled={alcanceEmCurso !== null}
                className={regraMudou ? "" : "col-span-2"}
                onClick={() => {
                  setConfirmarAlcance(false);
                  requestAnimationFrame(focarSalvar);
                }}
              >
                Cancelar
              </Botao>
            </div>
          </div>
        ) : confirmarExclusao && serie ? (
          <div role="group" aria-labelledby={`${idTitulo}-x`}>
            <p id={`${idTitulo}-x`} className="mb-3 text-sm text-ink-200">
              Este evento se repete. Excluir quais ocorrências? Não dá para desfazer.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {/* Nasce no lugar do "Excluir" com o foco no alcance menor. */}
              <Botao
                variante="perigo"
                tamanho="g"
                autoFocus
                carregando={alcanceEmCurso === "esta"}
                disabled={alcanceEmCurso !== null}
                onClick={() => void excluir("esta")}
              >
                Excluir só esta
              </Botao>
              <Botao
                variante="perigo"
                tamanho="g"
                carregando={alcanceEmCurso === "seguintes"}
                disabled={alcanceEmCurso !== null}
                onClick={() => void excluir("seguintes")}
              >
                Esta e as seguintes
              </Botao>
              <Botao
                variante="perigo"
                tamanho="g"
                carregando={alcanceEmCurso === "todas"}
                disabled={alcanceEmCurso !== null}
                onClick={() => void excluir("todas")}
              >
                Toda a série
              </Botao>
              <Botao
                variante="secundario"
                tamanho="g"
                disabled={alcanceEmCurso !== null}
                onClick={() => {
                  setConfirmarExclusao(false);
                  requestAnimationFrame(focarExcluir);
                }}
              >
                Cancelar
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
                onClick={() => void excluir()}
              >
                Excluir
              </Botao>
            </div>
          </div>
        ) : (
          <>
            {editando && !convertendo && (
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
                id={idSalvar}
                type="submit"
                variante="primario"
                tamanho="g"
                carregando={salvando && !concluindo}
                disabled={concluindo}
              >
                {convertendo
                  ? `Converter em ${ROTULO[e.tipo].nome}`
                  : editando
                    ? "Salvar"
                    : `Criar ${ROTULO[e.tipo].nome}`}
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

/// As letras dos dias na grade, domingo primeiro — a ordem do calendário
/// (`gradeDoMes`). A letra só é o desenho: o nome acessível é o dia por extenso.
const LETRAS_DOS_DIAS = ["D", "S", "T", "Q", "Q", "S", "S"] as const;
const DIA_MARCADO = "border-accent-500 bg-accent-500 font-bold text-white shadow-e1";
const DIA_LIVRE = "border-ink-700 bg-ink-900 font-medium text-ink-200 hover:border-ink-400";

/**
 * "Repetir" (frente de eventos recorrentes, R3): não repete ou toda semana; ligada,
 * os dias da semana em pílulas e o último dia — sem fim, ou uma data no seletor
 * nativo —, com o resumo da regra por extenso embaixo. Só aparece no evento
 * que cabe numa série (`cabeRepetir`).
 */
function SecaoRepetir({
  e,
  erro,
  escolhendoAte,
  mostrarPrimeira,
  onEscolherAte,
  onMudar,
}: {
  e: Estado;
  erro?: string;
  escolhendoAte: boolean;
  /** Dizer quando cai a primeira: na criação, e no evento simples que vira série. */
  mostrarPrimeira: boolean;
  onEscolherAte: () => void;
  onMudar: (parcial: Partial<Estado>) => void;
}) {
  const idDias = useId();

  function alternarDia(dia: number) {
    onMudar({
      dias: e.dias.includes(dia) ? e.dias.filter((d) => d !== dia) : [...e.dias, dia],
    });
  }

  return (
    <>
      <GrupoPilulas rotulo="Repetir" erro={e.repetir ? null : erro}>
        <Pilula ativa={!e.repetir} onClick={() => onMudar({ repetir: false })}>
          Não repete
        </Pilula>
        <Pilula
          ativa={e.repetir}
          onClick={() =>
            onMudar({
              repetir: true,
              // Ao ligar, o dia da data já vem marcado: "toda semana" sem dia
              // nenhum não diz nada, e é quase sempre o dia escolhido acima.
              dias: e.dias.length > 0 ? e.dias : e.dia ? [diaDaSemana(e.dia)] : [],
            })
          }
        >
          Toda semana
        </Pilula>
      </GrupoPilulas>

      {e.repetir && (
        <>
          <div className="min-w-0">
            <h3 id={idDias} className="rotulo">
              Nos dias
            </h3>
            {/* Sete alvos de 44 px numa linha: cabem na folha de 390 px. O
                marcado muda de forma — cheio, em negrito e com o traço embaixo —,
                não só de cor. */}
            <div role="group" aria-labelledby={idDias} className="mt-2 grid grid-cols-7 gap-1.5">
              {LETRAS_DOS_DIAS.map((letra, dia) => {
                const marcado = e.dias.includes(dia);
                return (
                  <button
                    key={dia}
                    type="button"
                    aria-pressed={marcado}
                    aria-label={DIAS_LONGOS[dia]}
                    onClick={() => alternarDia(dia)}
                    className={`flex h-11 min-w-11 flex-col items-center justify-center
                                rounded-full border text-sm transition duration-150
                                ease-(--ease-padrao) active:scale-[0.97] ${
                                  marcado ? DIA_MARCADO : DIA_LIVRE
                                }`}
                  >
                    <span aria-hidden="true">{letra}</span>
                    <span
                      aria-hidden="true"
                      className={`h-0.5 w-3 rounded-full ${
                        marcado ? "bg-white" : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <GrupoPilulas
            rotulo="Até"
            erro={erro}
            rodape={<span aria-live="polite">{resumoDaRepeticao(e, mostrarPrimeira)}</span>}
          >
            <Pilula ativa={e.ate === null && !escolhendoAte} onClick={() => onMudar({ ate: null })}>
              Sem fim
            </Pilula>
            {escolhendoAte || e.ate !== null ? (
              <PilulaEscolher
                tipo="date"
                valor={e.ate ?? ""}
                rotulo="Último dia da repetição"
                abrirAoNascer={escolhendoAte && e.ate === null}
                onEscolher={(ate) => onMudar({ ate })}
              />
            ) : (
              <Pilula ativa={false} onClick={onEscolherAte}>
                Escolher data…
              </Pilula>
            )}
          </GrupoPilulas>
        </>
      )}
    </>
  );
}
