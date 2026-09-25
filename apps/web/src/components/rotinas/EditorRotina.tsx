import { arrayMove } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import {
  MAX_DESCRICAO_ROTINA,
  MAX_NOME_ROTINA,
  MAX_PASSOS_DA_ROTINA,
  MODELOS_DE_AGENTE,
  MODELOS_DE_ROTINA,
  normalizarTitulo,
  resumoDoPedido,
} from "@yu-book/shared";
import type {
  AgentSummary,
  BoardDetail,
  BoardSummary,
  ModeloDeRotina,
} from "@yu-book/shared";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAgentes } from "../../lib/agentes";
import { useAiAjustes } from "../../lib/ia";
import { ApiError, api } from "../../lib/api";
import { useGuardaDeSaida } from "../../lib/guardaDeSaida";
import { useBoard, useBoards } from "../../lib/kanban";
import { useWorkspaces } from "../../lib/notas";
import {
  useAlternarAgenda,
  useAtualizarRotina,
  useCriarRotina,
  useExcluirRotina,
  useRotina,
  useRotinas,
} from "../../lib/rotinas";
import { CLASSE_CAMPO } from "../agentes/CamposDoAgente";
import { Aviso } from "../base/Aviso";
import { Botao, BotaoIcone } from "../base/Botao";
import { Dialogo } from "../base/Dialogo";
import { Menu } from "../base/Menu";
import { Tecla } from "../base/Tecla";
import {
  IconeAlerta,
  IconeBoard,
  IconeChevron,
  IconeFala,
  IconeLixeira,
  IconeNotas,
  IconeOpcoes,
  IconeParar,
  IconeRelogio,
  IconeRodar,
  IconeRotina,
} from "../Icones";
import { ID_AGENDA, SecaoAgenda, SeloAgenda, temAgenda } from "./Agenda";
import { NUMERO, ROTULO_CONSUMO } from "./comum";
import { Estimativa } from "./Estimativa";
import { FluxoEditavel, focarDepois, idDoBloco } from "./FluxoEditavel";
import type { InfoDoBloco } from "./FluxoEditavel";
import { HistoricoRotina } from "./HistoricoRotina";
import { PainelDoBloco } from "./PainelDoBloco";
import {
  assinatura,
  doDetalhe,
  paraEntrada,
  passoVazio,
  problemasDoRascunho,
  problemasDoServidor,
  rascunhoVazio,
} from "./rascunho";
import type { BlocoEscolhido, PassoRascunho, Problema, Rascunho } from "./rascunho";
import { AvisoAoRodar, rotaDaExecucao, useRodar } from "./rodar";

/** O rascunho do modelo pronto, antes de casar agentes e colunas. */
function doModelo(m: ModeloDeRotina): Rascunho {
  return {
    ...rascunhoVazio(),
    name: m.name,
    description: m.description,
    inputKind: m.inputKind,
    inputPrompt: m.inputPrompt ?? "",
    outputKind: m.outputKind,
    outputTitle: m.outputTitle,
    outputTitleText: m.outputTitleText ?? "",
    includeNotes: m.includeNotes,
    consumeAction: m.consumeAction,
    runCapMicros: m.runCapMicros,
    passos: m.steps.map((s) => {
      const modeloAgente = MODELOS_DE_AGENTE.find((a) => a.chave === s.agente);
      return {
        ...passoVazio(s.mode),
        instruction: s.instruction,
        sugestao: { chave: s.agente, nome: modeloAgente?.name ?? s.agente },
      };
    }),
  };
}

const casa = (a: string, b: string) => normalizarTitulo(a) === normalizarTitulo(b);

interface Resolucao {
  agentes: { nome: string; chave: string; achado: boolean }[];
  colunas: { nome: string; achada: boolean }[];
}

/**
 * Casa o modelo pronto com o acervo: cada agente pelo nome do modelo de agente
 * de onde ele sai, e as colunas pelo nome sugerido — sem acento e sem caixa,
 * a mesma chave do título de nota. A entrada e a das ideias usadas precisam
 * ser do mesmo quadro, então vence o quadro que tem as duas; a saída procura
 * primeiro nele, depois em qualquer um. O que não casa fica para escolher.
 *
 * Modelo por pedido não tem coluna de entrada, e o que sai em nota não tem
 * coluna de saída: os nomes nulos do modelo não casam nada nem entram na lista
 * do que falta.
 */
function resolver(
  r: Rascunho,
  m: ModeloDeRotina,
  agentes: AgentSummary[],
  quadros: BoardDetail[],
): { rascunho: Rascunho; resolucao: Resolucao } {
  const passos = r.passos.map((p) => {
    if (p.agentId || !p.sugestao) return p;
    const achado = agentes.find((a) => casa(a.name, p.sugestao?.nome ?? ""));
    return achado
      ? {
          ...p,
          agentId: achado.id,
          agentName: achado.name,
          agentColor: achado.color,
          sugestao: undefined,
        }
      : p;
  });

  const coluna = (q: BoardDetail, nome: string | null) =>
    nome ? q.columns.find((c) => casa(c.name, nome)) : undefined;
  const pontos = (q: BoardDetail) =>
    (coluna(q, m.colunaDeEntrada) ? 4 : 0) +
    (coluna(q, m.colunaDeConsumidas) ? 2 : 0) +
    (coluna(q, m.colunaDeSaida) ? 1 : 0);
  const melhor = m.colunaDeEntrada
    ? [...quadros]
        .filter((q) => coluna(q, m.colunaDeEntrada))
        .sort((a, b) => pontos(b) - pontos(a))[0]
    : undefined;
  const entrada = melhor ? coluna(melhor, m.colunaDeEntrada) : undefined;
  const consumida = melhor ? coluna(melhor, m.colunaDeConsumidas) : undefined;
  const quadroDaSaida =
    (melhor && coluna(melhor, m.colunaDeSaida) ? melhor : undefined) ??
    quadros.find((q) => coluna(q, m.colunaDeSaida));
  const saida = quadroDaSaida ? coluna(quadroDaSaida, m.colunaDeSaida) : undefined;

  const rascunho: Rascunho = {
    ...r,
    passos,
    ...(!r.inputColumnId &&
      melhor &&
      entrada && { inputBoardId: melhor.id, inputColumnId: entrada.id }),
    ...(!r.consumeColumnId && consumida && { consumeColumnId: consumida.id }),
    ...(!r.outputColumnId &&
      quadroDaSaida &&
      saida && { outputBoardId: quadroDaSaida.id, outputColumnId: saida.id }),
  };

  return {
    rascunho,
    resolucao: {
      agentes: r.passos.flatMap((p, i) =>
        p.sugestao
          ? [
              {
                nome: p.sugestao.nome,
                chave: p.sugestao.chave,
                achado: Boolean(passos[i]?.agentId),
              },
            ]
          : [],
      ),
      colunas: [
        ...(m.colunaDeEntrada ? [{ nome: m.colunaDeEntrada, achada: Boolean(entrada) }] : []),
        ...(m.colunaDeConsumidas
          ? [{ nome: m.colunaDeConsumidas, achada: Boolean(consumida) }]
          : []),
        ...(m.colunaDeSaida ? [{ nome: m.colunaDeSaida, achada: Boolean(saida) }] : []),
      ],
    },
  };
}

/**
 * O editor de rotinas (Etapa E da IA): `/assistente/rotinas/novo` e
 * `/assistente/rotinas/:id`.
 *
 * No centro, o **fluxo** em blocos ligados; ao lado, o **painel** do bloco
 * escolhido. **Salvar é explícito**, como no editor de agentes: uma rotina meio
 * editada rodaria pela metade, e cada mudança de passo muda o preço de toda
 * execução. Por isso o botão, o Ctrl+S, o "alterações não salvas", a pergunta
 * antes de sair — e "Rodar agora" desabilitado, com o motivo escrito, enquanto
 * houver alteração pendente ou problema.
 */
export function EditorRotina({ id }: { id: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busca] = useSearchParams();
  const qc = useQueryClient();
  const chaveDoModelo = busca.get("modelo");
  const modelo = id ? undefined : MODELOS_DE_ROTINA.find((m) => m.chave === chaveDoModelo);

  const existente = useRotina(id);
  const { data: agentes } = useAgentes();
  const { data: quadros } = useBoards(null);
  const { data: rotinas } = useRotinas();
  /// O fuso da agenda é o de `/ajustes`, não o do navegador (Etapa F).
  const fuso = useAiAjustes().data?.timezone ?? null;

  const inicial = useMemo(() => (modelo ? doModelo(modelo) : rascunhoVazio()), [modelo]);
  const [rascunho, setRascunho] = useState<Rascunho>(inicial);
  const [base, setBase] = useState(() => assinatura(inicial));
  const [escolhido, setEscolhido] = useState<BlocoEscolhido>({ tipo: "entrada" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; detalhes: string[] } | null>(null);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [resolucao, setResolucao] = useState<Resolucao | null>(null);
  const [anuncio, setAnuncio] = useState(
    (location.state as { criado?: boolean } | null)?.criado ? "Rotina criada." : "",
  );
  /// O que o fluxo diz em voz alta — inserir, mover, remover —, e a pausa da
  /// agenda com o rascunho sujo. Separado do estado de salvamento, que tem o
  /// seu próprio `aria-live`.
  const [falaDoFluxo, setFalaDoFluxo] = useState("");
  const campoNome = useRef<HTMLInputElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const idErroNome = useId();
  const idMotivo = useId();
  const idNotaAgenda = useId();

  /// O que "Descartar" devolve numa rotina nova: o modelo já casado com o
  /// acervo, e não o modelo cru.
  const origemRef = useRef(inicial);
  const rascunhoRef = useRef(rascunho);
  rascunhoRef.current = rascunho;
  const baseRef = useRef(base);
  baseRef.current = base;

  /**
   * O rascunho nasce do servidor **uma vez** — a mesma guarda do editor de
   * agentes e do `carregadaRef` da nota: sem ela, todo refetch do detalhe (a
   * janela volta ao foco, uma execução termina) sobrescreveria o que está
   * sendo editado.
   */
  const carregadoRef = useRef(false);
  const [carregado, setCarregado] = useState(!id);
  useEffect(() => {
    const dados = existente.data;
    if (!dados || carregadoRef.current) return;
    carregadoRef.current = true;
    setCarregado(true);
    const doServidor = doDetalhe(dados);
    setBase(assinatura(doServidor));
    setRascunho(doServidor);
  }, [existente.data]);

  /**
   * O modelo pronto casa com o acervo quando agentes e quadros chegam, uma vez.
   * Se ninguém mexeu no rascunho ainda, o casado vira a base: sair sem tocar
   * em nada não pergunta nada.
   */
  const resolvidoRef = useRef(false);
  useEffect(() => {
    if (!modelo || resolvidoRef.current || !agentes || !quadros) return;
    resolvidoRef.current = true;
    let vivo = true;
    void (async () => {
      const detalhes = await Promise.all(
        quadros.map((q: BoardSummary) =>
          qc
            .fetchQuery({
              queryKey: ["board", q.id],
              queryFn: () => api.get<BoardDetail>(`/boards/${q.id}`),
              staleTime: 30_000,
            })
            .catch(() => null),
        ),
      );
      if (!vivo) return;
      const antes = rascunhoRef.current;
      const intocado = assinatura(antes) === baseRef.current;
      const feito = resolver(
        antes,
        modelo,
        agentes,
        detalhes.filter((d): d is BoardDetail => d !== null),
      );
      setRascunho(feito.rascunho);
      origemRef.current = feito.rascunho;
      if (intocado) setBase(assinatura(feito.rascunho));
      setResolucao(feito.resolucao);
    })();
    return () => {
      vivo = false;
    };
  }, [modelo, agentes, quadros, qc]);

  const naoAchou = existente.error instanceof ApiError && existente.error.code === "NOT_FOUND";
  const sujo = carregado && assinatura(rascunho) !== base;
  const guarda = useGuardaDeSaida(sujo && !salvando);

  const mudar = useCallback((parcial: Partial<Rascunho>) => {
    setRascunho((r) => ({ ...r, ...parcial }));
  }, []);
  const mudarPasso = useCallback((chave: string, parcial: Partial<PassoRascunho>) => {
    setRascunho((r) => ({
      ...r,
      passos: r.passos.map((p) =>
        p.chave === chave
          ? {
              ...p,
              ...parcial,
              // Escolher um agente resolve a sugestão do modelo.
              ...(parcial.agentId && { sugestao: undefined }),
            }
          : p,
      ),
    }));
  }, []);

  // ---- Problemas --------------------------------------------------------

  const idsDeAgente = useMemo(
    () => (agentes ? new Set(agentes.map((a) => a.id)) : null),
    [agentes],
  );
  const problemas = useMemo(() => {
    const doCliente = problemasDoRascunho(rascunho, idsDeAgente);
    const doServidor =
      !sujo && existente.data ? problemasDoServidor(existente.data, rascunho) : [];
    const vistas = new Set(doCliente.map((p) => p.mensagem));
    return [...doCliente, ...doServidor.filter((p) => !vistas.has(p.mensagem))];
  }, [rascunho, idsDeAgente, sujo, existente.data]);

  /// A agenda tem os problemas dela à parte: impedem salvar, não rodar — e
  /// aparecem na própria seção, não na lista de cima, que fala do fluxo.
  const problemasDaAgenda = problemas.filter((p) => p.bloco === "agenda").map((p) => p.mensagem);
  const problemasDaRotina = problemas.filter((p) => p.bloco !== "agenda");

  const problemasDe = useCallback(
    (b: BlocoEscolhido) =>
      problemas
        .filter(
          // O problema dos passos em conjunto ("pelo menos um reescreve") não
          // vai em bloco nenhum: marcaria todos. Fica só na lista de cima.
          (p) => p.bloco === b.tipo && (b.tipo !== "passo" || p.chave === b.chave),
        )
        .map((p) => p.mensagem),
    [problemas],
  );

  // ---- Fluxo ------------------------------------------------------------

  function inserir(indice: number) {
    if (rascunho.passos.length >= MAX_PASSOS_DA_ROTINA) return;
    const novo = passoVazio();
    const passos = [...rascunho.passos];
    passos.splice(indice, 0, novo);
    mudar({ passos });
    setEscolhido({ tipo: "passo", chave: novo.chave });
    setFalaDoFluxo(
      `Passo inserido na posição ${indice + 1} de ${passos.length}. ` +
        "Escolha o agente no painel ao lado.",
    );
    focarDepois(idDoBloco({ tipo: "passo", chave: novo.chave }));
  }

  function mover(de: number, para: number) {
    setRascunho((r) => ({ ...r, passos: arrayMove(r.passos, de, para) }));
  }

  function remover(chave: string) {
    const i = rascunho.passos.findIndex((p) => p.chave === chave);
    const removido = rascunho.passos[i];
    if (!removido || rascunho.passos.length === 1) return;
    const passos = rascunho.passos.filter((p) => p.chave !== chave);
    mudar({ passos });
    // O foco e a escolha vão para o vizinho que ficou no lugar — ou, na ponta,
    // para o anterior. O bloco removido levava o foco consigo.
    const vizinho = passos[i] ?? passos[i - 1];
    const alvo: BlocoEscolhido = vizinho
      ? { tipo: "passo", chave: vizinho.chave }
      : { tipo: "saida" };
    if (escolhido.tipo === "passo" && escolhido.chave === chave) setEscolhido(alvo);
    setFalaDoFluxo(
      `Passo ${i + 1}${removido.agentName ? `, ${removido.agentName},` : ""} removido. ` +
        `${passos.length} ${passos.length === 1 ? "passo" : "passos"} no fluxo.`,
    );
    focarDepois(idDoBloco(alvo));
  }

  // ---- Salvar -----------------------------------------------------------

  const criar = useCriarRotina();
  const atualizar = useAtualizarRotina();

  async function salvar(): Promise<boolean> {
    if (salvando) return false;
    setErro(null);
    setErroNome(null);
    if (!rascunho.name.trim()) {
      setErroNome("Dê um nome à rotina.");
      campoNome.current?.focus();
      return false;
    }
    const doCliente = problemasDoRascunho(rascunho, idsDeAgente);
    if (doCliente.length > 0) {
      setErro({
        mensagem: "Resolva os problemas apontados nos blocos antes de salvar.",
        detalhes: [],
      });
      const primeiro = doCliente[0];
      if (primeiro) irAoProblema(primeiro);
      return false;
    }

    setSalvando(true);
    try {
      const entrada = paraEntrada(rascunho);
      const salva = id
        ? await atualizar.mutateAsync({ id, patch: entrada })
        : await criar.mutateAsync(entrada);
      const agora = doDetalhe(salva);
      // A escolha segue o mesmo bloco: as chaves dos passos nascem de novo.
      if (escolhido.tipo === "passo") {
        const pos = rascunho.passos.findIndex((p) => p.chave === escolhido.chave);
        const mesmo = agora.passos[pos];
        setEscolhido(mesmo ? { tipo: "passo", chave: mesmo.chave } : { tipo: "entrada" });
      }
      setRascunho(agora);
      setBase(assinatura(agora));
      setResolucao(null);
      setAnuncio(id ? "Alterações salvas." : "Rotina criada.");
      if (!id) {
        guarda.semGuarda(() =>
          navigate(`/assistente/rotinas/${salva.id}`, {
            replace: true,
            state: { criado: true },
          }),
        );
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOME_DUPLICADO") {
        setErroNome("Já existe uma rotina com esse nome. Escolha outro.");
        requestAnimationFrame(() => campoNome.current?.select());
      } else {
        setErro({
          mensagem: e instanceof ApiError ? e.message : "Não foi possível salvar a rotina.",
          detalhes: e instanceof ApiError ? e.issues.map((i) => `${i.path}: ${i.message}`) : [],
        });
      }
      return false;
    } finally {
      setSalvando(false);
    }
  }

  /// Ctrl+S salva de qualquer ponto **do editor** — e só dele. A mesma regra do
  /// editor de agentes: com o painel do assistente aberto ao lado, um Ctrl+S no
  /// compositor não salva a rotina, e o diálogo em portal fica de fora.
  const raiz = useRef<HTMLDivElement>(null);
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    let cliqueDentro = false;
    function aoApontar(e: PointerEvent) {
      cliqueDentro = e.target instanceof Node && Boolean(raiz.current?.contains(e.target));
    }
    function aoTeclar(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      const foco = document.activeElement;
      const noEditor =
        foco && foco !== document.body ? Boolean(raiz.current?.contains(foco)) : cliqueDentro;
      if (!noEditor) return;
      e.preventDefault();
      void salvarRef.current();
    }
    document.addEventListener("pointerdown", aoApontar, true);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("pointerdown", aoApontar, true);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, []);

  function descartar() {
    const volta = existente.data ? doDetalhe(existente.data) : origemRef.current;
    setRascunho(volta);
    setBase(assinatura(volta));
    setEscolhido({ tipo: "entrada" });
    setErro(null);
    setErroNome(null);
    setAnuncio("Alterações descartadas.");
  }

  function irAoProblema(p: Problema) {
    if (p.bloco === "agenda") {
      focarDepois(ID_AGENDA);
      return;
    }
    const alvo: BlocoEscolhido =
      p.bloco === "passo"
        ? { tipo: "passo", chave: p.chave ?? rascunho.passos[0]?.chave ?? "" }
        : { tipo: p.bloco };
    setEscolhido(alvo);
    focarDepois(idDoBloco(alvo));
  }

  // ---- Rodar e excluir --------------------------------------------------

  const rodar = useRodar();
  const viva = rotinas?.find((r) => r.lastRun?.status === "em_andamento");
  const estaRodando = Boolean(id && viva?.id === id);
  const motivo = !id
    ? "Salve a rotina para poder rodá-la."
    : sujo
      ? "Salve as alterações antes de rodar."
      : problemasDaRotina.length > 0
        ? "Resolva os problemas apontados antes de rodar."
        : // Só a entrada por coluna tem fila; no pedido a contagem vem nula.
          existente.data?.input.kind === "coluna" && existente.data.eligibleCount === 0
          ? "Nenhuma ideia na coluna de entrada."
          : viva && !estaRodando
            ? `«${viva.name}» está rodando — uma execução por vez.`
            : null;

  // ---- Pausar e retomar (Etapa F) ----------------------------------------

  /**
   * Um clique, na hora: manda só `active` ao servidor, **sem salvar o resto do
   * rascunho**. Pausar uma rotina que vai rodar em dois minutos não pode
   * esperar a pessoa decidir o que fazer com a edição pela metade.
   *
   * O rascunho acompanha só o `active`, e a base passa a ser o que o servidor
   * devolveu: com o resto intocado, nada fica sujo; com edição pendente, ela
   * continua pendente — e o anúncio diz isso.
   */
  const alternarAgenda = useAlternarAgenda();
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  const agendaSalva = existente.data?.schedule;
  async function pausarOuRetomar() {
    if (!id || !agendaSalva) return;
    const active = !agendaSalva.active;
    const sujoAntes = sujo;
    setErroAgenda(null);
    try {
      const salva = await alternarAgenda.mutateAsync({ id, active });
      setRascunho((r) => ({ ...r, agenda: { ...r.agenda, active: salva.schedule.active } }));
      setBase(assinatura(doDetalhe(salva)));
      const feito = active ? "Agenda retomada." : "Agenda pausada.";
      // Sujo, o estado de salvamento continua dizendo "alterações não salvas" e
      // não anuncia nada: a confirmação vai pela região do leitor de tela, e o
      // selo do cabeçalho muda à vista.
      if (sujoAntes) setFalaDoFluxo(`${feito} As outras alterações continuam por salvar.`);
      else setAnuncio(feito);
    } catch (e) {
      setErroAgenda(
        e instanceof ApiError
          ? e.message
          : active
            ? "Não foi possível retomar a agenda."
            : "Não foi possível pausar a agenda.",
      );
    }
  }

  const excluir = useExcluirRotina();
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);

  // ---- Blocos à vista ---------------------------------------------------

  const { data: quadroEntrada } = useBoard(rascunho.inputBoardId || null);
  const { data: quadroSaida } = useBoard(rascunho.outputBoardId || null);
  const colunaEntrada = quadroEntrada?.columns.find((c) => c.id === rascunho.inputColumnId);
  const colunaSaida = quadroSaida?.columns.find((c) => c.id === rascunho.outputColumnId);
  const colunaConsumida = quadroEntrada?.columns.find((c) => c.id === rascunho.consumeColumnId);
  const { data: workspaces } = useWorkspaces();
  const porColuna = rascunho.inputKind === "coluna";
  const salvaInput = existente.data?.input;
  const entradaSalva = Boolean(
    id &&
      porColuna &&
      salvaInput?.kind === "coluna" &&
      salvaInput.columnId === rascunho.inputColumnId,
  );
  const elegiveis = existente.data?.eligibleCount ?? 0;
  const resumo = resumoDoPedido(rascunho.inputPrompt);

  const infoEntrada: InfoDoBloco = porColuna
    ? {
        icone: <IconeBoard className="size-3.5 text-accent-400" />,
        titulo: colunaEntrada
          ? `Coluna · ${colunaEntrada.name} · ${quadroEntrada?.name ?? ""}`
          : "Escolha a coluna",
        detalhe: entradaSalva
          ? elegiveis === 1
            ? "1 ideia na fila"
            : `${NUMERO.format(elegiveis)} ideias na fila`
          : colunaEntrada
            ? `${NUMERO.format(colunaEntrada.cards.length)} ${
                colunaEntrada.cards.length === 1 ? "card" : "cards"
              } na coluna`
            : "de onde vem a ideia",
      }
    : {
        icone: <IconeFala className="size-3.5 text-accent-400" />,
        titulo: resumo ? `Pedido · ${resumo}` : "Escreva o pedido",
        detalhe: "o mesmo a cada execução",
      };

  const workspaceDaNota = workspaces?.find((w) => w.id === rascunho.outputWorkspaceId);
  const detalheDaIdeia = !porColuna
    ? null
    : rascunho.consumeAction === "mover"
      ? `ideia → ${colunaConsumida?.name ?? "escolha a coluna"}`
      : rascunho.consumeAction === "arquivar"
        ? "ideia → arquivo"
        : `ideia ${ROTULO_CONSUMO.manter.titulo.toLowerCase()}`;
  const infoSaida: InfoDoBloco =
    rascunho.outputKind === "card"
      ? {
          icone: <IconeBoard className="size-3.5 text-accent-400" />,
          titulo: colunaSaida
            ? `Card · ${colunaSaida.name} · ${quadroSaida?.name ?? ""}`
            : "Escolha a coluna",
          detalhe: detalheDaIdeia ?? "card novo a cada execução",
        }
      : {
          icone: <IconeNotas className="size-3.5 text-accent-400" />,
          titulo: !rascunho.outputWorkspaceId
            ? "Nota nova · sem workspace"
            : `Nota nova · ${
                workspaceDaNota?.name ?? (workspaces ? "(workspace excluído)" : "…")
              }`,
          detalhe: detalheDaIdeia ?? "nota nova a cada execução",
        };

  // ---- Tela -------------------------------------------------------------

  if (naoAchou) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tom="erro">Esta rotina não existe — ou foi excluída.</Aviso>
        <Link to="/assistente/rotinas" className="text-sm text-accent-400 underline">
          Voltar às rotinas
        </Link>
      </div>
    );
  }

  const nomeVisivel = rascunho.name.trim() || (id ? "Sem nome" : "Nova rotina");
  const faltando = resolucao
    ? [
        ...resolucao.agentes.filter((a) => !a.achado),
        ...resolucao.colunas.filter((c) => !c.achada),
      ]
    : [];

  return (
    <div ref={raiz} className="flex flex-col gap-5">
      <header
        className="sticky top-0 z-(--z-popover) -mx-8 -mt-6 flex items-center gap-3 border-b
                   border-ink-800 bg-ink-950/85 px-8 py-3 backdrop-blur"
      >
        <BotaoIcone
          rotulo="Voltar às rotinas"
          icone={<IconeChevron direcao="esquerda" />}
          onClick={() => navigate("/assistente/rotinas")}
        />
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-controle
                     bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-e1"
        >
          <IconeRotina />
        </span>
        <div className="min-w-0 flex-1">
          <h2 ref={titulo} tabIndex={-1} className="truncate text-base font-semibold text-titulo">
            {nomeVisivel}
          </h2>
          <p className="flex min-w-0 items-center gap-2 text-miudo text-ink-400">
            <span className="shrink-0">
              {id
                ? "Editar rotina"
                : modelo
                  ? `A partir do modelo «${modelo.name}»`
                  : "Rotina nova"}
            </span>
            {/* O estado da agenda **gravada**, não do rascunho: é o que o servidor vai fazer. */}
            {existente.data && <SeloAgenda rotina={existente.data} fuso={fuso} />}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* O estado com palavra e glifo, não só cor (RNF-09). */}
          <span aria-live="polite" className="text-miudo text-ink-400">
            {salvando ? (
              "salvando…"
            ) : sujo ? (
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <span aria-hidden="true">●</span> alterações não salvas
                <span className="text-ink-400">
                  <Tecla combo="Ctrl+S" />
                </span>
              </span>
            ) : (
              anuncio
            )}
          </span>
          {sujo && !salvando && (
            <Botao variante="fantasma" onClick={descartar}>
              Descartar
            </Botao>
          )}
          {id && agendaSalva && temAgenda(agendaSalva) && (
            <Botao
              variante="secundario"
              tamanho="m"
              icone={
                agendaSalva.active ? (
                  <IconeParar className="size-3.5" />
                ) : (
                  <IconeRelogio className="size-3.5" />
                )
              }
              carregando={alternarAgenda.isPending}
              aria-label={agendaSalva.active ? "Pausar a agenda" : "Retomar a agenda"}
              onClick={() => void pausarOuRetomar()}
              aria-describedby={sujo ? idNotaAgenda : undefined}
              title={
                agendaSalva.active
                  ? "Para de rodar sozinha, na hora — sem salvar o resto"
                  : "Volta a rodar sozinha, na hora — sem salvar o resto"
              }
            >
              {agendaSalva.active ? "Pausar" : "Retomar"}
            </Botao>
          )}
          {id && (
            <Menu
              rotulo={`Ações de ${rascunho.name}`}
              lado="baixo-fim"
              gatilho={(p) => (
                <button
                  {...p}
                  type="button"
                  aria-label="Mais ações"
                  title="Mais ações"
                  className="inline-flex size-7 items-center justify-center rounded-controle
                             text-ink-400 transition hover:bg-ink-800 hover:text-ink-200"
                >
                  <IconeOpcoes />
                </button>
              )}
              itens={[
                {
                  rotulo: "Excluir rotina",
                  icone: <IconeLixeira className="size-3.5" />,
                  aoEscolher: () => {
                    setErroExcluir(null);
                    setExcluindo(true);
                  },
                  desabilitado: estaRodando,
                  motivo: "Espere a execução em andamento terminar",
                },
              ]}
            />
          )}
          <Botao
            variante={id ? "secundario" : "primario"}
            tamanho="m"
            carregando={salvando}
            disabled={!carregado || (!sujo && Boolean(id))}
            onClick={() => void salvar()}
            title="Salvar (Ctrl+S)"
          >
            {id ? "Salvar" : "Criar rotina"}
          </Botao>
          {id &&
            (estaRodando && viva?.lastRun ? (
              <Botao
                variante="ia"
                tamanho="m"
                icone={<IconeRotina className="size-4" />}
                onClick={() => navigate(rotaDaExecucao(id, viva.lastRun?.id ?? ""))}
              >
                Acompanhar
              </Botao>
            ) : (
              <Botao
                variante="ia"
                tamanho="m"
                icone={<IconeRodar className="size-3.5" />}
                carregando={rodar.rodando === id}
                disabled={Boolean(motivo)}
                aria-describedby={motivo ? idMotivo : undefined}
                onClick={() => void rodar.iniciar(id)}
              >
                Rodar agora
              </Botao>
            ))}
        </div>
      </header>

      {/* O motivo de "Rodar agora" estar desligado fica escrito, não só na dica. E, com
          o rascunho sujo, o que "Pausar/Retomar" faz com ele: nada. */}
      {id && ((motivo && !estaRodando) || (sujo && agendaSalva && temAgenda(agendaSalva))) && (
        <div className="-mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {sujo && agendaSalva && temAgenda(agendaSalva) && (
            <p id={idNotaAgenda} className="text-miudo text-ink-400">
              {agendaSalva.active ? "Pausar" : "Retomar"} vale na hora e não salva as outras
              alterações.
            </p>
          )}
          {motivo && !estaRodando && (
            <p id={idMotivo} className="flex items-center gap-1 text-miudo text-ink-400">
              <IconeAlerta className="size-3" />
              {motivo}
            </p>
          )}
        </div>
      )}

      {erro && (
        <Aviso tom="erro" onFechar={() => setErro(null)}>
          {erro.mensagem}
          {erro.detalhes.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {erro.detalhes.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </Aviso>
      )}
      {rodar.erro && <AvisoAoRodar erro={rodar.erro} onFechar={rodar.limpar} />}
      {erroAgenda && (
        <Aviso tom="erro" onFechar={() => setErroAgenda(null)}>
          {erroAgenda}
        </Aviso>
      )}

      {faltando.length > 0 && (
        <Aviso tom="info" onFechar={() => setResolucao(null)}>
          Do modelo, ficou para você escolher:{" "}
          {faltando.map((f, i) => (
            <span key={f.nome}>
              {i > 0 && ", "}
              {"chave" in f ? `o agente «${f.nome}»` : `a coluna «${f.nome}»`}
            </span>
          ))}
          . Os blocos com o que falta estão marcados.
        </Aviso>
      )}

      {!carregado ? (
        <div aria-hidden="true" className="flex flex-col gap-5">
          <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5">
            <div
              className="h-[132px] animate-pulse rounded-cartao border border-ink-800
                         bg-superficie"
            />
            <div
              className="h-[132px] animate-pulse rounded-cartao border border-ink-800
                         bg-superficie"
            />
          </div>
          <div
            className="h-[300px] animate-pulse rounded-cartao border border-ink-800 bg-superficie"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5">
            <div
              className="h-[260px] animate-pulse rounded-cartao border border-ink-800
                         bg-ink-900/40"
            />
            <div
              className="h-[420px] animate-pulse rounded-cartao border border-ink-800
                         bg-superficie"
            />
          </div>
        </div>
      ) : (
        <>
          {/* A mesma grade da linha do fluxo: a estimativa fica sobre o painel de configuração,
              com as bordas batendo. */}
          <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5">
            <section
              aria-label="Identidade da rotina"
              className="grid grid-cols-2 gap-3 rounded-cartao border border-ink-800
                         bg-superficie p-4 shadow-e1"
            >
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="rotulo">Nome</span>
                  <span className="text-miudo tabular-nums text-ink-400">
                    {rascunho.name.length}/{MAX_NOME_ROTINA}
                  </span>
                </span>
                <input
                  ref={campoNome}
                  value={rascunho.name}
                  onChange={(e) => {
                    mudar({ name: e.target.value });
                    if (erroNome) setErroNome(null);
                  }}
                  maxLength={MAX_NOME_ROTINA}
                  placeholder="Post do LinkedIn"
                  aria-invalid={erroNome ? true : undefined}
                  aria-describedby={erroNome ? idErroNome : undefined}
                  autoFocus={!id && !modelo}
                  className={`mt-1 ${CLASSE_CAMPO}`}
                />
                {erroNome && (
                  <p
                    id={idErroNome}
                    role="alert"
                    className="mt-1 flex items-center gap-1 text-xs text-red-300"
                  >
                    <IconeAlerta className="size-3.5" />
                    {erroNome}
                  </p>
                )}
              </label>
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="rotulo">Descrição</span>
                  <span className="text-miudo tabular-nums text-ink-400">
                    {rascunho.description.length}/{MAX_DESCRICAO_ROTINA}
                  </span>
                </span>
                <input
                  value={rascunho.description}
                  onChange={(e) => mudar({ description: e.target.value })}
                  maxLength={MAX_DESCRICAO_ROTINA}
                  placeholder="Uma linha: o que ela entrega."
                  className={`mt-1 ${CLASSE_CAMPO}`}
                />
              </label>
            </section>
            <Estimativa passos={rascunho.passos} tetoMicros={rascunho.runCapMicros} />
          </div>

          {problemasDaRotina.length > 0 && (
            <div
              className="rounded-cartao border border-dashed border-amber-500/40 bg-amber-500/5
                         px-4 py-3"
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                <IconeAlerta className="size-3.5" />
                {problemasDaRotina.length === 1
                  ? "Um problema impede a rotina de rodar"
                  : `${problemasDaRotina.length} problemas impedem a rotina de rodar`}
              </p>
              <ul className="mt-1.5 grid gap-0.5">
                {problemasDaRotina.map((p, i) => {
                  const pos = p.chave
                    ? rascunho.passos.findIndex((x) => x.chave === p.chave)
                    : -1;
                  const onde =
                    p.bloco === "entrada"
                      ? "Entrada"
                      : p.bloco === "saida"
                        ? "Saída"
                        : pos >= 0
                          ? `Passo ${pos + 1}`
                          : "Passos";
                  return (
                    <li key={`${p.mensagem}-${i}`}>
                      <button
                        type="button"
                        onClick={() => irAoProblema(p)}
                        className="rounded-etiqueta text-left text-xs text-ink-200
                                   hover:text-titulo"
                      >
                        <span className="font-medium text-amber-300">{onde}:</span>{" "}
                        {p.mensagem}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <SecaoAgenda
            agenda={rascunho.agenda}
            onMudar={(agenda) => mudar({ agenda })}
            fuso={fuso}
            problemas={problemasDaAgenda}
            rotinaComProblema={problemasDaRotina.length > 0}
            salvaAtiva={agendaSalva ? agendaSalva.active : null}
          />

          <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-5">
            <section
              aria-labelledby="titulo-fluxo"
              className="min-w-0 overflow-hidden rounded-cartao border border-ink-800 bg-ink-900/40"
            >
              <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
                <h3 id="titulo-fluxo" className="rotulo">
                  Fluxo
                </h3>
                <span className="text-miudo text-ink-400">
                  {rascunho.passos.length} de {MAX_PASSOS_DA_ROTINA} passos · escolha um bloco
                  para configurar; <span aria-hidden="true">+</span> insere um passo; a alça
                  reordena
                </span>
              </header>
              <div
                // Pontilhado de prancheta, feito de token: troca com o tema.
                className="overflow-x-auto [background-size:16px_16px]
                           bg-[radial-gradient(var(--color-ink-800)_1px,transparent_1px)]"
              >
                <FluxoEditavel
                  passos={rascunho.passos}
                  escolhido={escolhido}
                  onEscolher={setEscolhido}
                  onInserir={inserir}
                  onMover={mover}
                  onRemover={remover}
                  entrada={infoEntrada}
                  saida={infoSaida}
                  problemasDe={problemasDe}
                  anunciar={setFalaDoFluxo}
                />
              </div>
            </section>

            <aside aria-label="Configuração" className="sticky top-20 min-w-0">
              <PainelDoBloco
                escolhido={escolhido}
                rascunho={rascunho}
                mudar={mudar}
                mudarPasso={mudarPasso}
                detalhe={existente.data}
                entradaSalva={entradaSalva}
              />
            </aside>
          </div>

          {id && <HistoricoRotina routineId={id} />}
        </>
      )}

      <p aria-live="polite" className="sr-only">
        {falaDoFluxo}
      </p>

      {excluindo && id && (
        <Dialogo aberto onFechar={() => setExcluindo(false)} rotulo="Excluir rotina?">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <IconeAlerta className="size-4 text-red-300" />
              <h2 className="text-sm font-semibold text-titulo">Excluir «{rascunho.name}»?</h2>
            </div>
            <p className="mt-2 text-xs text-ink-400">
              Os cards que ela criou ficam, com a marca de IA. O histórico de execuções continua
              contando no gasto do dia.
            </p>
            {erroExcluir && (
              <Aviso tom="erro" className="mt-3">
                {erroExcluir}
              </Aviso>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Botao variante="secundario" onClick={() => setExcluindo(false)}>
                Cancelar
              </Botao>
              <Botao
                variante="perigo"
                carregando={excluir.isPending}
                onClick={async () => {
                  try {
                    await excluir.mutateAsync(id);
                    guarda.semGuarda(() => navigate("/assistente/rotinas", { replace: true }));
                  } catch (e) {
                    setErroExcluir(
                      e instanceof ApiError ? e.message : "Não foi possível excluir a rotina.",
                    );
                  }
                }}
              >
                Excluir
              </Botao>
            </div>
          </div>
        </Dialogo>
      )}

      {guarda.pedindoConfirmacao && (
        <Dialogo aberto onFechar={guarda.cancelar} rotulo="Sair sem salvar?">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <IconeAlerta className="size-4 text-amber-300" />
              <h2 className="text-sm font-semibold text-titulo">Sair sem salvar?</h2>
            </div>
            <p className="mt-2 text-xs text-ink-400">
              As alterações desta rotina ainda não foram salvas. Saindo agora, elas se perdem.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Botao variante="secundario" onClick={guarda.cancelar}>
                Continuar editando
              </Botao>
              <Botao variante="perigo" onClick={guarda.confirmar}>
                Sair sem salvar
              </Botao>
              <Botao
                variante="primario"
                carregando={salvando}
                onClick={async () => {
                  if (await salvar()) guarda.confirmar();
                }}
              >
                Salvar e sair
              </Botao>
            </div>
          </div>
        </Dialogo>
      )}
    </div>
  );
}
