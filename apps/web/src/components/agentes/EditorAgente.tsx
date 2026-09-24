import { useQueryClient } from "@tanstack/react-query";
import {
  MAX_DESCRICAO_AGENTE,
  MAX_FONTES_VIVAS,
  MAX_INSTRUCOES_AGENTE,
  MAX_NOME_AGENTE,
  MAX_NOTAS_BASE,
  MAX_PREMISSAS_DO_AGENTE,
  MODELOS_DE_AGENTE,
  normalizarTitulo,
} from "@yu-book/shared";
import type {
  AgentColor,
  AgentDetail,
  AgentInput,
  AgentPreviewInput,
  ModeloDeAgente,
  NomeDeFerramenta,
} from "@yu-book/shared";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  useAgente,
  useAtualizarAgente,
  useComEspera,
  useCriarAgente,
  usePreviaDoAgente,
} from "../../lib/agentes";
import { ApiError, api } from "../../lib/api";
import { useGuardaDeSaida } from "../../lib/guardaDeSaida";
import { useCriarNota, useTitulos } from "../../lib/notas";
import type { TituloSugerido } from "../../lib/notas";
import { useWorkspaceAtivo } from "../../lib/workspace";
import { Aviso } from "../base/Aviso";
import { Botao, BotaoIcone } from "../base/Botao";
import { Dialogo } from "../base/Dialogo";
import { Etiqueta } from "../base/Etiqueta";
import { Interruptor } from "../base/Interruptor";
import { Menu } from "../base/Menu";
import { Tecla } from "../base/Tecla";
import { CampoMarkdown } from "../CampoMarkdown";
import {
  IconeAlerta,
  IconeChevron,
  IconeFechar,
  IconeLapis,
  IconeMais,
  IconeNotas,
  IconeOpcoes,
} from "../Icones";
import { SeletorDeNota } from "../SeletorDeNota";
import { useAcoesDoAgente } from "./acoesDoAgente";
import { AvatarAgente } from "./AvatarAgente";
import {
  CLASSE_CAMPO,
  EscolhaDeCor,
  EscolhaDeModelo,
  LinhaFonte,
} from "./CamposDoAgente";
import type { FonteRascunho } from "./CamposDoAgente";
import { FERRAMENTAS_DO_AGENTE, FERRAMENTAS_PADRAO } from "./ferramentas";
import { PreviaAgente } from "./PreviaAgente";

const NUMERO = new Intl.NumberFormat("pt-BR");

interface NotaBase {
  id: string;
  title: string;
  /// `null` enquanto a prévia não disse: a nota acabou de ser escolhida.
  chars: number | null;
  trashed: boolean;
}

interface Rascunho {
  name: string;
  description: string;
  color: AgentColor;
  instructionsMd: string;
  modelId: string | null;
  tools: NomeDeFerramenta[];
  notas: NotaBase[];
  fontes: FonteRascunho[];
}

let proximaChave = 0;
const novaChave = () => `f${++proximaChave}`;

const VAZIO: Rascunho = {
  name: "",
  description: "",
  color: "violeta",
  instructionsMd: "",
  modelId: null,
  tools: FERRAMENTAS_PADRAO,
  notas: [],
  fontes: [],
};

function doDetalhe(a: AgentDetail): Rascunho {
  return {
    name: a.name,
    description: a.description,
    color: a.color,
    instructionsMd: a.instructionsMd,
    modelId: a.modelId,
    tools: a.tools,
    notas: a.baseNotes.map((n) => ({ ...n })),
    fontes: a.liveSources.map((f) => ({
      chave: novaChave(),
      boardId: f.boardId,
      columnId: f.columnId,
      limite: f.limite,
      detalhe: f.detalhe,
      sumiu: f.columnName === null,
    })),
  };
}

function doModelo(m: ModeloDeAgente): Rascunho {
  return {
    ...VAZIO,
    name: m.name,
    description: m.description,
    color: m.color,
    instructionsMd: m.instructionsMd,
    tools: [...m.tools],
  };
}

const completa = (f: FonteRascunho) => Boolean(f.boardId && f.columnId);

/** A ordem de `FERRAMENTAS_DO_AGENTE`: marcar e desmarcar não pode "sujar" o rascunho. */
function emOrdem(tools: NomeDeFerramenta[]): NomeDeFerramenta[] {
  return FERRAMENTAS_DO_AGENTE.map((f) => f.nome).filter((n) => tools.includes(n));
}

function paraEntrada(r: Rascunho): AgentInput {
  return {
    name: r.name.trim(),
    description: r.description.trim(),
    color: r.color,
    instructionsMd: r.instructionsMd,
    modelId: r.modelId,
    tools: emOrdem(r.tools),
    baseNoteIds: r.notas.map((n) => n.id),
    liveSources: r.fontes.filter(completa).map((f) => ({
      tipo: "coluna" as const,
      boardId: f.boardId,
      columnId: f.columnId,
      limite: f.limite,
      detalhe: f.detalhe,
    })),
  };
}

/** O que decide "há alterações": a entrada, mais as linhas de fonte ainda sem coluna. */
function assinatura(r: Rascunho): string {
  return JSON.stringify({
    ...paraEntrada(r),
    incompletas: r.fontes.filter((f) => !completa(f)).length,
  });
}

/** O corpo com que uma nota-base sugerida nasce — curto, e dizendo para que serve. */
function corpoSugerido(titulo: string, agente: string): string {
  return (
    `# ${titulo}\n\n` +
    `Esta nota é premissa do agente «${agente}»: tudo o que estiver aqui entra no contexto ` +
    `dele a cada mensagem.\n\nEscreva aqui…\n`
  );
}

/** Um `Bloco` de formulário, com a descrição que ensina o campo. */
function Parte({
  titulo,
  descricao,
  acao,
  variante = "padrao",
  children,
}: {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
  variante?: "padrao" | "ia";
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      // Sem `overflow-hidden`, ao contrário do `Bloco`: a lista do seletor de
      // nota e os menus abrem para fora da seção, e seriam cortados.
      className="relative min-w-0 rounded-cartao border border-ink-800 bg-superficie shadow-e1"
    >
      {variante === "ia" && (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
        />
      )}
      <header className="flex items-start gap-2 border-b border-ink-800 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 id={id} className="rotulo">
            {titulo}
          </h3>
          {descricao && <p className="mt-0.5 text-xs text-ink-400">{descricao}</p>}
        </div>
        {acao && <span className="shrink-0">{acao}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Contador({ n, max }: { n: number; max: number }) {
  return (
    <span
      className={`text-miudo tabular-nums ${n > max * 0.9 ? "text-amber-300" : "text-ink-400"}`}
    >
      {NUMERO.format(n)}/{NUMERO.format(max)}
    </span>
  );
}

/**
 * O editor de agentes (Etapa D da IA): `/assistente/agentes/novo` e
 * `/assistente/agentes/:id`.
 *
 * **Salvar é explícito**, ao contrário de nota e card: um agente meio editado
 * já responderia com as premissas pela metade, e cada mudança de nota-base
 * muda o preço de toda mensagem. Por isso o botão, o Ctrl+S, o aviso de
 * "alterações não salvas" e a pergunta antes de sair.
 *
 * Ao lado, "O que o agente recebe": a prévia do contexto montada pelo
 * servidor sobre o rascunho, com 500 ms de espera — o preço à vista antes de
 * salvar.
 */
export function EditorAgente({ id }: { id: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busca] = useSearchParams();
  const qc = useQueryClient();
  const { ativoId } = useWorkspaceAtivo();
  const chaveModelo = id ? null : busca.get("modelo");
  const duplicarDe = id ? null : busca.get("duplicar");
  const modelo = chaveModelo ? MODELOS_DE_AGENTE.find((m) => m.chave === chaveModelo) : undefined;

  const existente = useAgente(id);
  const origemDuplicar = useAgente(duplicarDe);
  const fonteDoRascunho = id ? existente : duplicarDe ? origemDuplicar : null;

  const [rascunho, setRascunho] = useState<Rascunho>(() => (modelo ? doModelo(modelo) : VAZIO));
  const [base, setBase] = useState(() => assinatura(modelo ? doModelo(modelo) : VAZIO));
  const [criarSugeridas, setCriarSugeridas] = useState(Boolean(modelo));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; detalhes: string[] } | null>(null);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState(
    (location.state as { criado?: boolean } | null)?.criado ? "Agente criado." : "",
  );
  const campoNome = useRef<HTMLInputElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const seletorNota = useRef<HTMLDivElement>(null);
  const idErroNome = useId();

  /**
   * O rascunho nasce do servidor **uma vez**. Sem esta guarda, todo refetch do
   * detalhe (a janela volta ao foco, a lista é invalidada) sobrescreveria o que
   * está sendo digitado — o mesmo cuidado do `carregadaRef` da nota.
   */
  const carregadoRef = useRef(false);
  /// O mesmo fato em estado, para a tela: sem rascunho carregado não há o que
  /// comparar nem o que prever.
  const [carregado, setCarregado] = useState(!id && !duplicarDe);
  useEffect(() => {
    const dados = fonteDoRascunho?.data;
    if (!dados || carregadoRef.current) return;
    carregadoRef.current = true;
    setCarregado(true);
    const inicial = doDetalhe(dados);
    if (duplicarDe) inicial.name = `${dados.name} (cópia)`.slice(0, MAX_NOME_AGENTE);
    // A base é o que chegou — na cópia também: ela ainda não existe, e sair sem
    // mexer não perde nada que alguém tenha feito.
    setBase(assinatura(inicial));
    setRascunho(inicial);
  }, [fonteDoRascunho?.data, duplicarDe]);

  const carregando = Boolean(fonteDoRascunho?.isLoading);
  const naoAchou =
    fonteDoRascunho?.error instanceof ApiError && fonteDoRascunho.error.code === "NOT_FOUND";
  const pronto = carregado;

  const sujo = pronto && assinatura(rascunho) !== base;
  const guarda = useGuardaDeSaida(sujo && !salvando);

  const mudar = useCallback((parcial: Partial<Rascunho>) => {
    setRascunho((r) => ({ ...r, ...parcial }));
  }, []);

  // ---- Prévia -----------------------------------------------------------

  /// Só as fontes completas vão: a linha ainda sem coluna recusaria a prévia
  /// inteira no schema, e a prévia é para mostrar o resto enquanto se escolhe.
  const entradaDaPrevia = useMemo<AgentPreviewInput>(() => paraEntrada(rascunho), [rascunho]);
  const chavePrevia = useComEspera(JSON.stringify(entradaDaPrevia), 500);
  const previaPedida = useMemo(() => JSON.parse(chavePrevia) as AgentPreviewInput, [chavePrevia]);
  const esperando = chavePrevia !== JSON.stringify(entradaDaPrevia);
  /// `!esperando`: no render em que o rascunho chega do servidor, a chave com
  /// espera ainda é a do rascunho vazio — pedir a prévia dela seria uma
  /// requisição jogada fora e um número errado piscando na tela.
  const previa = usePreviaDoAgente(previaPedida, pronto && !naoAchou && !esperando);

  /// O tamanho de cada nota vem da prévia (a nota recém-escolhida não traz
  /// tamanho); os títulos são únicos entre as notas ativas, então casam.
  const tamanhoPorTitulo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const b of previa.data?.blocks ?? []) if (b.kind === "nota") mapa.set(b.title, b.chars);
    return mapa;
  }, [previa.data]);

  // ---- Notas-base --------------------------------------------------------

  const criarNota = useCriarNota();

  /**
   * As notas sugeridas do modelo pronto, criadas vazias ao salvar. A que já
   * existe com o mesmo título (sem acento e sem caixa, a chave do banco) é
   * reaproveitada em vez de duplicada; `TITULO_DUPLICADO` na corrida também
   * cai na existente.
   */
  async function notasSugeridas(nomeDoAgente: string): Promise<string[]> {
    if (!modelo || !criarSugeridas) return [];
    const buscarTitulos = () =>
      qc.fetchQuery({
        queryKey: ["titles"],
        queryFn: () => api.get<TituloSugerido[]>("/notes/titles"),
        staleTime: 0,
      });
    let titulos = await buscarTitulos();
    const ids: string[] = [];
    for (const t of modelo.notasSugeridas) {
      const achar = () => titulos.find((x) => normalizarTitulo(x.title) === normalizarTitulo(t));
      const existenteNota = achar();
      if (existenteNota) {
        ids.push(existenteNota.id);
        continue;
      }
      try {
        const nota = await criarNota.mutateAsync({
          title: t,
          contentMd: corpoSugerido(t, nomeDoAgente),
          kind: "livre",
          workspaceId: ativoId,
          tags: [],
          meta: {},
          sourceUrl: null,
          occurredAt: null,
        });
        ids.push(nota.id);
      } catch (e) {
        if (e instanceof ApiError && e.code === "TITULO_DUPLICADO") {
          titulos = await buscarTitulos();
          const achada = achar();
          if (achada) {
            ids.push(achada.id);
            continue;
          }
        }
        throw e;
      }
    }
    return ids;
  }

  const { data: titulosAtivos } = useTitulos();
  const sugeridasExistentes = useMemo(() => {
    const chaves = new Set((titulosAtivos ?? []).map((x) => normalizarTitulo(x.title)));
    return new Set(
      (modelo?.notasSugeridas ?? []).filter((t) => chaves.has(normalizarTitulo(t))),
    );
  }, [modelo, titulosAtivos]);

  function moverNota(i: number, passo: -1 | 1) {
    const alvo = i + passo;
    const notas = [...rascunho.notas];
    const a = notas[i];
    const b = notas[alvo];
    if (!a || !b) return;
    notas[i] = b;
    notas[alvo] = a;
    mudar({ notas });
    // O botão acompanha a nota que se moveu; na ponta, o da direção contrária.
    requestAnimationFrame(() => {
      const direcao = passo < 0 ? "subir" : "descer";
      const outro = passo < 0 ? "descer" : "subir";
      const seletor = (acao: string) => `[data-nota="${a.id}"][data-acao="${acao}"]`;
      const botao =
        document.querySelector<HTMLButtonElement>(`${seletor(direcao)}:not(:disabled)`) ??
        document.querySelector<HTMLButtonElement>(seletor(outro));
      botao?.focus();
    });
  }

  function removerNota(i: number) {
    const notas = rascunho.notas.filter((_, j) => j !== i);
    mudar({ notas });
    const vizinha = notas[i] ?? notas[i - 1];
    requestAnimationFrame(() => {
      const alvo = vizinha
        ? document.querySelector<HTMLButtonElement>(
            `[data-nota="${vizinha.id}"][data-acao="remover"]`,
          )
        : seletorNota.current?.querySelector<HTMLInputElement>("input");
      alvo?.focus();
    });
  }

  // ---- Salvar ------------------------------------------------------------

  const criar = useCriarAgente();
  const atualizar = useAtualizarAgente();

  async function salvar(): Promise<boolean> {
    if (salvando) return false;
    setErro(null);
    setErroNome(null);
    const nome = rascunho.name.trim();
    if (!nome) {
      setErroNome("Dê um nome ao agente.");
      campoNome.current?.focus();
      return false;
    }
    if (rascunho.fontes.some((f) => !completa(f))) {
      setErro({
        mensagem: "Escolha o quadro e a coluna de cada fonte viva, ou remova a que ficou vazia.",
        detalhes: [],
      });
      return false;
    }

    setSalvando(true);
    try {
      const entrada = paraEntrada(rascunho);
      const sugeridas = await notasSugeridas(nome);
      if (sugeridas.length > 0) {
        const escolhidas = entrada.baseNoteIds ?? [];
        const juntas = [...sugeridas, ...escolhidas.filter((x) => !sugeridas.includes(x))];
        entrada.baseNoteIds = juntas.slice(0, MAX_NOTAS_BASE);
      }
      const salvo = id
        ? await atualizar.mutateAsync({ id, patch: entrada })
        : await criar.mutateAsync(entrada);
      const agora = doDetalhe(salvo);
      setRascunho(agora);
      setBase(assinatura(agora));
      setCriarSugeridas(false);
      setAnuncio(id ? "Alterações salvas." : "Agente criado.");
      if (!id) {
        // O rascunho já está no servidor: a guarda não pergunta nada.
        guarda.semGuarda(() =>
          navigate(`/assistente/agentes/${salvo.id}`, { replace: true, state: { criado: true } }),
        );
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOME_DUPLICADO") {
        setErroNome("Já existe um agente com esse nome. Escolha outro.");
        requestAnimationFrame(() => campoNome.current?.select());
      } else {
        setErro({
          mensagem: e instanceof ApiError ? e.message : "Não foi possível salvar o agente.",
          detalhes: e instanceof ApiError ? e.issues.map((i) => `${i.path}: ${i.message}`) : [],
        });
      }
      return false;
    } finally {
      setSalvando(false);
    }
  }

  /// Ctrl+S salva de qualquer ponto **do editor** — e só dele. O ouvinte fica
  /// no `document` porque o foco pode estar num botão ou num seletor, mas
  /// confere onde o foco está: com o painel do assistente aberto ao lado, um
  /// Ctrl+S no compositor salvaria o agente sem a pessoa estar nele. Diálogo
  /// (a guarda, o excluir) vive num portal, fora da raiz, e fica de fora pelo
  /// mesmo teste. Foco no `<body>` — clique em área sem controle — conta pelo
  /// último clique: dentro do editor, salva. O ouvinte global não usa o S, e o
  /// `preventDefault` só acontece quando é para salvar.
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
    const dados = fonteDoRascunho?.data;
    const inicial = dados ? doDetalhe(dados) : modelo ? doModelo(modelo) : VAZIO;
    if (dados && duplicarDe) inicial.name = `${dados.name} (cópia)`.slice(0, MAX_NOME_AGENTE);
    setRascunho(inicial);
    setBase(assinatura(inicial));
    setErro(null);
    setErroNome(null);
    setAnuncio("Alterações descartadas.");
  }

  const acoes = useAcoesDoAgente({
    onExcluido: () => guarda.semGuarda(() => navigate("/assistente/agentes")),
    vizinho: () => titulo.current,
  });

  // ---- Tela --------------------------------------------------------------

  if (naoAchou) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tom="erro">Este agente não existe — ou foi excluído.</Aviso>
        <Link to="/assistente/agentes" className="text-sm text-accent-400 underline">
          Voltar aos agentes
        </Link>
      </div>
    );
  }

  const nomeVisivel = rascunho.name.trim() || (id ? "Sem nome" : "Novo agente");
  const escrita = FERRAMENTAS_DO_AGENTE.filter((f) => f.escrita);
  const leitura = FERRAMENTAS_DO_AGENTE.filter((f) => !f.escrita);

  return (
    <div ref={raiz} className="flex flex-col gap-5">
      {/* O cabeçalho acompanha a rolagem: salvar e o estado de "não salvo"
          ficam sempre à vista. */}
      <header
        className="sticky top-0 z-(--z-popover) -mx-8 -mt-6 flex items-center gap-3 border-b
                   border-ink-800 bg-ink-950/85 px-8 py-3 backdrop-blur"
      >
        <BotaoIcone
          rotulo="Voltar aos agentes"
          icone={<IconeChevron direcao="esquerda" />}
          onClick={() => navigate("/assistente/agentes")}
        />
        <AvatarAgente nome={nomeVisivel} cor={rascunho.color} tamanho="g" />
        <div className="min-w-0 flex-1">
          <h2 ref={titulo} tabIndex={-1} className="truncate text-base font-semibold text-titulo">
            {nomeVisivel}
          </h2>
          <p className="text-miudo text-ink-400">
            {id
              ? "Editar agente"
              : duplicarDe
                ? "Cópia de agente"
                : modelo
                  ? `A partir do modelo «${modelo.name}»`
                  : "Agente novo"}
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
              itens={acoes.itens(
                { id, name: existente.data?.name ?? rascunho.name, color: rascunho.color },
                { noEditor: true },
              )}
            />
          )}
          <Botao
            variante="primario"
            tamanho="m"
            carregando={salvando}
            disabled={!pronto || (!sujo && Boolean(id))}
            onClick={() => void salvar()}
            title="Salvar (Ctrl+S)"
          >
            {id ? "Salvar" : "Criar agente"}
          </Botao>
        </div>
      </header>

      {acoes.elementos}
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

      {carregando ? (
        <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_340px] gap-6">
          <div className="space-y-4">
            {[180, 320, 160].map((h) => (
              <div
                key={h}
                className="animate-pulse rounded-cartao border border-ink-800 bg-superficie"
                style={{ height: h }}
              />
            ))}
          </div>
          <div
            className="h-[420px] animate-pulse rounded-cartao border border-ink-800
                       bg-superficie"
          />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            {/* 1. Identidade */}
            <Parte
              titulo="Identidade"
              descricao="Como o agente aparece no chat e na marca do que ele criar."
            >
              <div className="grid gap-3">
                <label className="block">
                  <span className="flex items-baseline justify-between">
                    <span className="rotulo">Nome</span>
                    <Contador n={rascunho.name.length} max={MAX_NOME_AGENTE} />
                  </span>
                  <input
                    ref={campoNome}
                    value={rascunho.name}
                    onChange={(e) => {
                      mudar({ name: e.target.value });
                      if (erroNome) setErroNome(null);
                    }}
                    maxLength={MAX_NOME_AGENTE}
                    placeholder="Especialista em LinkedIn"
                    aria-invalid={erroNome ? true : undefined}
                    aria-describedby={erroNome ? idErroNome : undefined}
                    autoFocus={!id}
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
                    <Contador n={rascunho.description.length} max={MAX_DESCRICAO_AGENTE} />
                  </span>
                  <input
                    value={rascunho.description}
                    onChange={(e) => mudar({ description: e.target.value })}
                    maxLength={MAX_DESCRICAO_AGENTE}
                    placeholder="Uma linha: para que serve."
                    className={`mt-1 ${CLASSE_CAMPO}`}
                  />
                </label>
                <EscolhaDeCor
                  cor={rascunho.color}
                  onMudar={(color) => mudar({ color })}
                  nome={rascunho.name.trim()}
                />
              </div>
            </Parte>

            {/* 2. Instruções */}
            <Parte
              titulo="Instruções"
              descricao={
                <>
                  Entram depois das regras do Yu-book — citar a origem, não mexer em{" "}
                  <code className="font-mono">[[…]]</code>, criar só a pedido —, que valem por
                  cima delas. Texto aqui não concede ferramenta: só a lista de ferramentas
                  concede.
                </>
              }
            >
              <CampoMarkdown
                titulo="Markdown"
                rotuloCampo="Instruções do agente"
                valor={rascunho.instructionsMd}
                onMudar={(instructionsMd) => mudar({ instructionsMd })}
                linhas={14}
                maxLength={MAX_INSTRUCOES_AGENTE}
                placeholder={"Você escreve…\n\n## Como trabalhar\n- …"}
                extra={
                  <Contador n={rascunho.instructionsMd.length} max={MAX_INSTRUCOES_AGENTE} />
                }
              />
            </Parte>

            {/* 3. Notas-base */}
            <Parte
              titulo="Notas-base"
              descricao={
                <>
                  Entram inteiras no contexto, nesta ordem, a cada mensagem. Com as fontes vivas,
                  cabem {NUMERO.format(MAX_PREMISSAS_DO_AGENTE)} caracteres; o que passar fica de
                  fora — e é dito.
                </>
              }
              acao={<Contador n={rascunho.notas.length} max={MAX_NOTAS_BASE} />}
            >
              {modelo && !id && modelo.notasSugeridas.length > 0 && (
                <div
                  className="mb-3 rounded-controle border border-ia-500/25 bg-linear-to-r
                             from-accent-500/5 to-ia-500/5 p-3"
                >
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-200">
                    <input
                      type="checkbox"
                      checked={criarSugeridas}
                      onChange={(e) => setCriarSugeridas(e.target.checked)}
                      className="mt-0.5 size-3.5 accent-accent-500"
                    />
                    <span>
                      Criar as notas-base sugeridas, vazias
                      <span className="mt-0.5 block text-xs text-ink-400">
                        Nascem ao salvar, com uma linha dizendo para que servem — você as
                        preenche
                        depois. A que já existe com o mesmo título é usada como está.
                      </span>
                    </span>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1 pl-5">
                    {modelo.notasSugeridas.map((t) => (
                      <Etiqueta key={t} tom="ia" icone={<IconeNotas className="size-3" />}>
                        {t}
                        {sugeridasExistentes.has(t) ? " · já existe" : ""}
                      </Etiqueta>
                    ))}
                  </div>
                </div>
              )}

              {rascunho.notas.length === 0 ? (
                <p className="mb-3 text-xs text-ink-400">
                  Nenhuma nota-base. Escolha o guia, os exemplos, o posicionamento — o que o
                  agente precisa saber antes de você perguntar.
                </p>
              ) : (
                <ol className="mb-3 space-y-1">
                  {rascunho.notas.map((n, i) => {
                    const chars = tamanhoPorTitulo.get(n.title) ?? n.chars;
                    return (
                      <li
                        key={n.id}
                        className="flex items-center gap-2 rounded-controle border border-ink-800
                                   bg-ink-900/40 py-1 pl-2.5 pr-1"
                      >
                        <span className="w-4 text-right text-miudo tabular-nums text-ink-400">
                          {i + 1}
                        </span>
                        <IconeNotas className="size-3.5 text-ink-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink-200" title={n.title}>
                            {n.title}
                          </span>
                          <span className="block text-miudo text-ink-400">
                            {chars === null
                              ? "tamanho na prévia"
                              : `${NUMERO.format(chars)} caracteres`}
                            {n.trashed && (
                              <span className="text-amber-300">
                                {" "}
                                · <span aria-hidden="true">⌫</span> na lixeira — fica fora até
                                voltar
                              </span>
                            )}
                          </span>
                        </span>
                        <BotaoIcone
                          rotulo={`Subir ${n.title}`}
                          tamanho="p"
                          data-nota={n.id}
                          data-acao="subir"
                          icone={<IconeChevron direcao="cima" className="size-3.5" />}
                          disabled={i === 0}
                          onClick={() => moverNota(i, -1)}
                        />
                        <BotaoIcone
                          rotulo={`Descer ${n.title}`}
                          tamanho="p"
                          data-nota={n.id}
                          data-acao="descer"
                          icone={<IconeChevron direcao="baixo" className="size-3.5" />}
                          disabled={i === rascunho.notas.length - 1}
                          onClick={() => moverNota(i, 1)}
                        />
                        <BotaoIcone
                          rotulo={`Tirar ${n.title} das notas-base`}
                          tamanho="p"
                          data-nota={n.id}
                          data-acao="remover"
                          icone={<IconeFechar className="size-3.5" />}
                          onClick={() => removerNota(i)}
                        />
                      </li>
                    );
                  })}
                </ol>
              )}

              <div ref={seletorNota}>
                <SeletorDeNota
                  rotulo="Acrescentar nota-base"
                  excluidos={rascunho.notas.map((n) => n.id)}
                  desabilitado={rascunho.notas.length >= MAX_NOTAS_BASE}
                  placeholder={
                    rascunho.notas.length >= MAX_NOTAS_BASE
                      ? `Limite de ${MAX_NOTAS_BASE} notas-base`
                      : "Acrescentar nota-base pelo título…"
                  }
                  onEscolher={(t) =>
                    mudar({
                      notas: [
                        ...rascunho.notas,
                        { id: t.id, title: t.title, chars: null, trashed: false },
                      ],
                    })
                  }
                />
              </div>
            </Parte>

            {/* 4. Fontes vivas */}
            <Parte
              titulo="Fontes vivas"
              descricao={
                <>
                  Colunas de quadro lidas a cada mensagem — o que já saiu, o que está na fila —,
                  sem ninguém atualizar uma nota à mão.
                </>
              }
              acao={<Contador n={rascunho.fontes.length} max={MAX_FONTES_VIVAS} />}
            >
              {rascunho.fontes.length === 0 ? (
                <p className="mb-3 text-xs text-ink-400">
                  Nenhuma fonte viva. Uma coluna "Publicado" faz o agente saber o que já saiu e
                  não repetir tema.
                </p>
              ) : (
                <ul className="mb-3 space-y-2">
                  {rascunho.fontes.map((f, i) => (
                    <LinhaFonte
                      key={f.chave}
                      fonte={f}
                      indice={i}
                      onMudar={(nova) =>
                        mudar({
                          fontes: rascunho.fontes.map((x) => (x.chave === f.chave ? nova : x)),
                        })
                      }
                      onRemover={() => {
                        mudar({ fontes: rascunho.fontes.filter((x) => x.chave !== f.chave) });
                        requestAnimationFrame(() =>
                          document.getElementById("yb-adicionar-fonte")?.focus(),
                        );
                      }}
                    />
                  ))}
                </ul>
              )}
              <Botao
                id="yb-adicionar-fonte"
                variante="secundario"
                icone={<IconeMais className="size-3.5" />}
                disabled={rascunho.fontes.length >= MAX_FONTES_VIVAS}
                onClick={() =>
                  mudar({
                    fontes: [
                      ...rascunho.fontes,
                      {
                        chave: novaChave(),
                        boardId: "",
                        columnId: "",
                        limite: 10,
                        detalhe: "titulos",
                      },
                    ],
                  })
                }
              >
                {rascunho.fontes.length >= MAX_FONTES_VIVAS
                  ? `Limite de ${MAX_FONTES_VIVAS} fontes`
                  : "Adicionar coluna"}
              </Botao>
            </Parte>

            {/* 5. Modelo */}
            <Parte
              titulo="Modelo"
              variante="ia"
              descricao={
                <>
                  Quem responde. O do chat acompanha o que você escolher em Ajustes; um favorito
                  fica fixo neste agente.
                </>
              }
            >
              <EscolhaDeModelo
                modelId={rascunho.modelId}
                onMudar={(modelId) => mudar({ modelId })}
                usaFerramentas={rascunho.tools.length > 0}
              />
            </Parte>

            {/* 6. Ferramentas */}
            <Parte
              titulo="Ferramentas"
              descricao={
                <>
                  O que o agente pode fazer no acervo. Só esta lista concede — nada do que estiver
                  nas instruções liga uma ferramenta.
                </>
              }
              acao={<Contador n={rascunho.tools.length} max={FERRAMENTAS_DO_AGENTE.length} />}
            >
              <div className="grid gap-5">
                {[
                  { grupo: "Ler", lista: leitura },
                  { grupo: "Escrever", lista: escrita },
                ].map(({ grupo, lista }) => (
                  <div key={grupo} role="group" aria-label={grupo}>
                    <p className="rotulo mb-2">{grupo}</p>
                    <div className="grid gap-3">
                      {lista.map((f) => (
                        <Interruptor
                          key={f.nome}
                          ligado={rascunho.tools.includes(f.nome)}
                          onMudar={(ligar) =>
                            mudar({
                              tools: ligar
                                ? emOrdem([...rascunho.tools, f.nome])
                                : rascunho.tools.filter((t) => t !== f.nome),
                            })
                          }
                          rotulo={f.titulo}
                          descricao={
                            f.escrita
                              ? `${f.explicacao} O que criar fica marcado como gerado por IA, ` +
                                "com o nome do agente."
                              : f.explicacao
                          }
                          extra={
                            f.escrita ? (
                              <Etiqueta tom="ia" icone={<IconeLapis className="size-3" />}>
                                escreve no acervo
                              </Etiqueta>
                            ) : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Parte>
          </div>

          <aside aria-label="Prévia do contexto" className="sticky top-20">
            <PreviaAgente
              previa={previa.data}
              carregando={previa.isLoading || (esperando && !previa.data)}
              atualizando={esperando || previa.isFetching}
              erro={previa.error}
            />
          </aside>
        </div>
      )}

      {guarda.pedindoConfirmacao && (
        <DialogoSair
          salvando={salvando}
          onFicar={guarda.cancelar}
          onSair={guarda.confirmar}
          onSalvarESair={async () => {
            if (await salvar()) guarda.confirmar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Sair com alterações pendentes. O foco começa em "Continuar editando": o
 * Enter distraído não pode jogar fora o que se escreveu.
 */
function DialogoSair({
  salvando,
  onFicar,
  onSair,
  onSalvarESair,
}: {
  salvando: boolean;
  onFicar: () => void;
  onSair: () => void;
  onSalvarESair: () => void;
}) {
  return (
    <Dialogo aberto onFechar={onFicar} rotulo="Sair sem salvar?">
      <div className="p-5">
        <div className="flex items-center gap-2">
          <IconeAlerta className="size-4 text-amber-300" />
          <h2 className="text-sm font-semibold text-titulo">Sair sem salvar?</h2>
        </div>
        <p className="mt-2 text-xs text-ink-400">
          As alterações deste agente ainda não foram salvas. Saindo agora, elas se perdem.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Botao variante="secundario" onClick={onFicar}>
            Continuar editando
          </Botao>
          <Botao variante="perigo" onClick={onSair}>
            Sair sem salvar
          </Botao>
          <Botao variante="primario" carregando={salvando} onClick={onSalvarESair}>
            Salvar e sair
          </Botao>
        </div>
      </div>
    </Dialogo>
  );
}
