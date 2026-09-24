import type { Link, LinkKind, NoteDetail } from "@yu-book/shared";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAtalhosGlobais } from "../lib/atalhosGlobais";
import { lerFiltros, temFiltroAtivo } from "../lib/filtrosUrl";
import { useCriarLink, useExcluirLink, useLinks } from "../lib/links";
import { useCriarNota } from "../lib/notas";
import { naTelaDoChat, useAcoesChat } from "../lib/sessaoChat";
import { useTema } from "../lib/tema";
import { useWorkspaceAtivo } from "../lib/workspace";
import { DashboardPage } from "../pages/DashboardPage";
import { NotasPage } from "../pages/NotasPage";
import { Atalhos } from "./Atalhos";
import { Aviso } from "./base/Aviso";
import { Botao } from "./base/Botao";
import { PilhaFlutuante, Toast } from "./base/Toast";
import { PainelContexto } from "./casca/PainelContexto";
import { ID_MOSTRAR_CONTEXTO, Trilho } from "./casca/Trilho";
import {
  IconeAgente,
  IconeAjustes,
  IconeAssistente,
  IconeBoard,
  IconeInicio,
  IconeLink,
  IconeMais,
  IconeNotas,
  IconePainelDireito,
  IconeTeclado,
} from "./Icones";
import { Paleta } from "./Paleta";
import type { ComandoPaleta } from "./Paleta";
import { ZonasDeSoltura } from "./ZonasDeSoltura";

/** Título provisório de uma nota criada por atalho — o usuário sobrescreve. */
function tituloProvisorio(): string {
  const agora = new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `Sem título ${agora}`;
}

export interface RecemCriada {
  id: string;
  comTitulo: boolean;
}

/**
 * O kanban carrega sob demanda: a biblioteca de arrasto não precisa estar no
 * bundle que abre a tela de notas, que é onde a aplicação começa.
 */
const BoardPage = lazy(() =>
  import("../pages/BoardPage").then((m) => ({ default: m.BoardPage })),
);
const BoardsPage = lazy(() =>
  import("../pages/BoardsPage").then((m) => ({ default: m.BoardsPage })),
);

/**
 * Os ajustes também são sob demanda: o catálogo de modelos do provedor não
 * precisa estar no bundle que abre a tela de notas.
 */
const AjustesPage = lazy(() =>
  import("../pages/AjustesPage").then((m) => ({ default: m.AjustesPage })),
);

/**
 * A gaveta também é sob demanda: ela usa o `dnd-kit` para reordenar favoritos,
 * e essa biblioteca não precisa estar no bundle que abre a tela de notas.
 */
const GavetaLinks = lazy(() =>
  import("./GavetaLinks").then((m) => ({ default: m.GavetaLinks })),
);

/**
 * As superfícies do assistente também: elas arrastam o renderizador de
 * Markdown para dentro do bundle, e quem só quer escrever uma nota não paga
 * por isso. A sessão (`lib/sessaoChat.tsx`) é leve e fica sempre montada.
 */
const PainelAssistente = lazy(() =>
  import("./assistente/PainelAssistente").then((m) => ({ default: m.PainelAssistente })),
);
const AssistentePage = lazy(() =>
  import("../pages/AssistentePage").then((m) => ({ default: m.AssistentePage })),
);

/**
 * A galeria e o editor de agentes (Etapa D da IA) têm chunk próprio: trazem o
 * metadado das ferramentas e os modelos prontos, que o chat não usa.
 */
const AgentesPage = lazy(() =>
  import("../pages/AgentesPage").then((m) => ({ default: m.AgentesPage })),
);

function CarregandoTela() {
  return (
    <main className="flex flex-1 items-center justify-center text-sm text-ink-400">
      <span className="animate-pulse">Carregando…</span>
    </main>
  );
}

const CHAVE_RECOLHIDO = "yb:contexto-recolhido";

/**
 * Casca da aplicação (redesenho de UI, Etapa 2): trilho de áreas, painel
 * contextual e a rota. O trilho e os atalhos globais valem em qualquer tela
 * (RNF-01, RNF-05).
 */
export function Aplicacao() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { ativoId } = useWorkspaceAtivo();
  const criar = useCriarNota();

  const emNotas = pathname.startsWith("/n");
  const [contextoRecolhido, setContextoRecolhido] = useState(
    () => localStorage.getItem(CHAVE_RECOLHIDO) === "1",
  );
  const alternarContexto = useCallback(() => {
    setContextoRecolhido((v) => {
      localStorage.setItem(CHAVE_RECOLHIDO, v ? "0" : "1");
      return !v;
    });
    // Recolher desmonta o que tinha o foco (o botão de recolher, um filtro) e
    // ele cairia no <body>. Nesse caso, vai para o botão que traz o painel de
    // volta — a mesma ação, no sentido contrário (RNF-06 da Fase 1).
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        document.getElementById(ID_MOSTRAR_CONTEXTO)?.focus();
      }
    });
  }, []);

  /**
   * A última lista de notas visitada, com os filtros. O item "Notas" do trilho
   * volta para ela: sair para os boards e voltar não pode perder o recorte —
   * era o que o `useState` de antes garantia, e a URL precisa continuar
   * garantindo.
   */
  const [ultimaListaNotas, setUltimaListaNotas] = useState("/n");
  useEffect(() => {
    if (emNotas) setUltimaListaNotas(`/n${search}`);
  }, [emNotas, search]);
  const buscaDasNotas = new URLSearchParams(ultimaListaNotas.split("?")[1] ?? "");

  const [paletaAberta, setPaletaAberta] = useState(false);
  const [atalhosAbertos, setAtalhosAbertos] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);
  const [recemCriada, setRecemCriada] = useState<RecemCriada | null>(null);

  const { data: links } = useLinks();
  const criarLink = useCriarLink();
  const excluirLink = useExcluirLink();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const sessao = useAcoesChat();
  /// A tela cheia do chat, e não a área inteira: na galeria e no editor de
  /// agentes o painel existe, e é para ele que a resposta em curso vai.
  const emAssistente = naTelaDoChat(pathname);

  /**
   * Sair da tela cheia do assistente com uma resposta chegando abre o painel
   * lateral: a resposta segue visível e nada se perde. É uma das regras que
   * garantem que o laço do servidor não rode sem ninguém vendo — as outras
   * moram em `sessaoChat.tsx`.
   */
  const estavaNoAssistente = useRef(emAssistente);
  const { abrirPainel, temFluxo } = sessao;
  useEffect(() => {
    if (estavaNoAssistente.current && !emAssistente && temFluxo()) abrirPainel();
    estavaNoAssistente.current = emAssistente;
  }, [emAssistente, abrirPainel, temFluxo]);
  const [destacado, setDestacado] = useState<string | null>(null);
  const [erroCaptura, setErroCaptura] = useState<string | null>(null);
  /** Link removido há pouco, à espera do desfazer (RN-05). */
  const [desfazivel, setDesfazivel] = useState<Link | null>(null);
  const timerDesfazer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const salvarLink = useCallback(
    (url: string, kind: LinkKind) => {
      setErroCaptura(null);
      const idsAntes = new Set((links ?? []).map((l) => l.id));

      criarLink.mutate(
        { url, kind },
        {
          onSuccess: (link) => {
            // RN-02: veio um id que já estava na lista — era repetido.
            if (idsAntes.has(link.id)) {
              setDestacado(link.id);
              setTimeout(() => setDestacado(null), 2000);
            }
          },
          // RF-10: o erro carrega a URL, para ela não se perder junto.
          onError: (erro) => {
            const motivo =
              erro instanceof ApiError ? erro.message : "Não foi possível salvar o link.";
            setErroCaptura(`${motivo} — ${url}`);
            setGavetaAberta(true);
          },
        },
      );
    },
    [criarLink, links],
  );

  /** RF-27/RF-28: sai da lista na hora, com 8 segundos para voltar atrás. */
  const removerLink = useCallback(
    (link: Link) => {
      excluirLink.mutate(link.id);
      setDesfazivel(link);
      if (timerDesfazer.current) clearTimeout(timerDesfazer.current);
      timerDesfazer.current = setTimeout(() => setDesfazivel(null), 8000);
    },
    [excluirLink],
  );

  /**
   * "Virar nota" no chat (Etapa C da IA) avisa aqui, e não na conversa: o que
   * flutua mora na pilha da casca, para não cobrir o desfazer do link. Some em
   * 8 s, como ele; a nota continua na lista, então perder o aviso não perde nada.
   */
  const [notaDoChat, setNotaDoChat] = useState<NoteDetail | null>(null);
  const timerNotaDoChat = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisarNotaDoChat = useCallback((nota: NoteDetail) => {
    setNotaDoChat(nota);
    if (timerNotaDoChat.current) clearTimeout(timerNotaDoChat.current);
    timerNotaDoChat.current = setTimeout(() => setNotaDoChat(null), 8000);
  }, []);

  const desfazerRemocao = useCallback(() => {
    if (!desfazivel) return;
    // Recria com o nome que tinha: não paga a busca de título de novo (S-06).
    criarLink.mutate({ url: desfazivel.url, kind: desfazivel.kind, title: desfazivel.title });
    setDesfazivel(null);
  }, [criarLink, desfazivel]);

  /** Abrir uma nota da lista mantém o recorte da lista na URL. */
  const abrirNota = useCallback(
    (id: string) => {
      setRecemCriada(null);
      navigate(`/n/${id}${emNotas ? search : ""}`);
    },
    [navigate, emNotas, search],
  );

  const novaNota = useCallback(
    (titulo?: string) => {
      setErroCriacao(null);
      criar.mutate(
        {
          title: titulo?.trim() || tituloProvisorio(),
          // Nasce no tipo que a lista está filtrando — só na lista: fora dela,
          // um filtro esquecido não deve decidir o tipo da nota nova.
          kind: (emNotas ? lerFiltros(new URLSearchParams(search)).kind : null) ?? "livre",
          // RF-05: nasce no workspace ativo.
          workspaceId: ativoId,
        },
        {
          onSuccess: (nota) => {
            // RNF-06: o painel foca o campo certo quando os dados chegam.
            setRecemCriada({ id: nota.id, comTitulo: Boolean(titulo?.trim()) });
            // Criada de dentro da lista, a lista continua com o mesmo recorte.
            navigate(`/n/${nota.id}${emNotas ? search : ""}`);
          },
          onError: (erro) => {
            setErroCriacao(
              erro instanceof ApiError ? erro.message : "Não foi possível criar a nota.",
            );
          },
        },
      );
    },
    [criar, emNotas, search, ativoId, navigate],
  );

  useAtalhosGlobais({
    irParaBoards: () => navigate("/b"),
    alternarGaveta: () => setGavetaAberta((v) => !v),
    // RF-17: na tela cheia o painel não existe, e o atalho vai direto ao campo.
    alternarChat: () => (emAssistente ? sessao.focarCampo() : sessao.alternarPainel()),
    abrirPaleta: () => setPaletaAberta(true),
    novaNota: () => novaNota(),
    alternarAtalhos: () => setAtalhosAbertos((v) => !v),
    alternarContexto,
    // O painel do assistente não entra aqui: ele não é sobreposto, convive
    // com o editor, e o Esc dele só vale com o foco dentro (PainelAssistente).
    fecharTudo: () => {
      setPaletaAberta(false);
      setAtalhosAbertos(false);
      setGavetaAberta(false);
    },
  });

  const [, setTema] = useTema();

  /**
   * Os comandos da paleta (redesenho de UI, Etapa 5): o que o trilho e os
   * atalhos já fazem, alcançável também pelo nome. O atalho mostrado é o de
   * `Atalhos.tsx` — a paleta só o exibe, não o registra.
   */
  const comandos = useMemo<ComandoPaleta[]>(
    () => [
      {
        id: "ir-inicio",
        rotulo: "Ir para Início",
        icone: <IconeInicio />,
        executar: () => navigate("/"),
      },
      {
        id: "ir-notas",
        rotulo: "Ir para Notas",
        icone: <IconeNotas />,
        // A última lista, com o recorte — o mesmo destino do item do trilho.
        executar: () => navigate(ultimaListaNotas),
      },
      {
        id: "ir-boards",
        rotulo: "Ir para Boards",
        icone: <IconeBoard />,
        atalho: "Ctrl+Shift+B",
        executar: () => navigate("/b"),
      },
      {
        id: "ir-assistente",
        rotulo: "Ir para Assistente",
        icone: <IconeAssistente />,
        executar: () => navigate("/assistente"),
      },
      {
        id: "agentes",
        rotulo: "Agentes",
        icone: <IconeAgente />,
        executar: () => navigate("/assistente/agentes"),
      },
      {
        id: "novo-agente",
        rotulo: "Novo agente",
        icone: <IconeAgente />,
        executar: () => navigate("/assistente/agentes/novo"),
      },
      {
        id: "ir-ajustes",
        rotulo: "Ir para Ajustes",
        icone: <IconeAjustes />,
        executar: () => navigate("/ajustes"),
      },
      {
        id: "nova-nota",
        rotulo: "Nova nota",
        icone: <IconeMais />,
        atalho: "Ctrl+N",
        executar: () => novaNota(),
      },
      {
        id: "salvar-link",
        rotulo: "Salvar link",
        icone: <IconeLink />,
        atalho: "Ctrl+Shift+L",
        executar: () => setGavetaAberta(true),
      },
      {
        id: "painel-assistente",
        rotulo: "Painel do assistente",
        icone: <IconePainelDireito />,
        atalho: "Ctrl+Shift+Y",
        // O mesmo desvio do atalho: em `/assistente` o painel não existe, e
        // alternar fecharia uma sessão que está na tela — abortando a resposta.
        executar: () => (emAssistente ? sessao.focarCampo() : sessao.alternarPainel()),
      },
      {
        id: "alternar-tema",
        rotulo: "Alternar tema",
        // Lido do `<html>` na hora: assim a lista de comandos não precisa ser
        // refeita a cada troca. `useTema` avisa todos que o usam, e o seletor
        // do trilho acompanha.
        executar: () =>
          setTema(document.documentElement.dataset.tema === "claro" ? "escuro" : "claro"),
      },
      {
        id: "atalhos",
        rotulo: "Atalhos de teclado",
        icone: <IconeTeclado />,
        atalho: "Ctrl+/",
        executar: () => setAtalhosAbertos(true),
      },
    ],
    [navigate, ultimaListaNotas, novaNota, sessao, emAssistente, setTema],
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <Trilho
        linksParaVer={(links ?? []).filter((l) => l.kind === "depois").length}
        chatAberto={sessao.painelAberto}
        notasComFiltroOculto={contextoRecolhido && temFiltroAtivo(lerFiltros(buscaDasNotas))}
        contextoRecolhido={contextoRecolhido}
        onMostrarContexto={alternarContexto}
        onIrParaNotas={() => navigate(ultimaListaNotas)}
        onBuscar={() => setPaletaAberta(true)}
        onNovaNota={() => novaNota()}
        onAbrirChat={() => sessao.abrirPainel({ nova: true })}
        onAbrirGaveta={() => setGavetaAberta(true)}
        onAlternarChat={sessao.alternarPainel}
        onAbrirAtalhos={() => setAtalhosAbertos(true)}
      />

      {!contextoRecolhido && (
        <PainelContexto
          onRecolher={alternarContexto}
          onBuscar={() => setPaletaAberta(true)}
          onNovaNota={() => novaNota()}
        />
      )}

      <Routes>
        {/* RF-01: a raiz é o dashboard; as notas passam a viver em /n. */}
        <Route
          path="/"
          element={
            <DashboardPage
              onNovaNota={() => novaNota()}
              onAbrirGaveta={() => setGavetaAberta(true)}
            />
          }
        />
        {["/n", "/n/:id"].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <NotasPage
                onAbrirNota={abrirNota}
                onNovaNota={novaNota}
                recemCriada={recemCriada}
              />
            }
          />
        ))}
        <Route
          path="/b"
          element={
            <Suspense fallback={<CarregandoTela />}>
              <BoardsPage />
            </Suspense>
          }
        />
        {["/b/:boardId", "/b/:boardId/c/:cardId"].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<CarregandoTela />}>
                <BoardPage />
              </Suspense>
            }
          />
        ))}
        <Route
          path="/assistente"
          element={
            <Suspense fallback={<CarregandoTela />}>
              <AssistentePage onAbrirNota={abrirNota} onNotaCriada={avisarNotaDoChat} />
            </Suspense>
          }
        />
        <Route
          path="/assistente/agentes/*"
          element={
            <Suspense fallback={<CarregandoTela />}>
              <AgentesPage />
            </Suspense>
          }
        />
        <Route path="/assistente/*" element={<Navigate to="/assistente" replace />} />
        <Route
          path="/ajustes/*"
          element={
            <Suspense fallback={<CarregandoTela />}>
              <AjustesPage />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Na mesma linha flex das colunas: o painel empurra o conteúdo, não o
          cobre. Sem prop `aberto` — o estado mora na sessão. */}
      {sessao.painelAberto && !emAssistente && (
        <Suspense fallback={null}>
          <PainelAssistente onAbrirNota={abrirNota} onNotaCriada={avisarNotaDoChat} />
        </Suspense>
      )}

      <PilhaFlutuante>
        {/* Erro não é toast: fica até ser fechado (RF-17 da Fase 1). */}
        {erroCriacao && (
          <div className="pointer-events-auto w-full">
            <Aviso tom="erro" onFechar={() => setErroCriacao(null)}>
              {erroCriacao}
            </Aviso>
          </div>
        )}

        {/* RF-28: a rede de proteção de quem apaga sem confirmação. */}
        {/* Com a gaveta aberta, o desfazer mora dentro dela: o diálogo prende o
            foco, e daqui ele ficaria fora do alcance do teclado. */}
        {desfazivel && !gavetaAberta && (
          <Toast
            acao={
              <Botao variante="fantasma" onClick={desfazerRemocao}>
                Desfazer
              </Botao>
            }
          >
            “{desfazivel.title}” saiu da gaveta
          </Toast>
        )}

        {notaDoChat && !gavetaAberta && (
          <Toast
            acao={
              <Botao
                variante="fantasma"
                onClick={() => {
                  abrirNota(notaDoChat.id);
                  setNotaDoChat(null);
                }}
              >
                Abrir
              </Botao>
            }
          >
            Nota criada: “{notaDoChat.title}”
          </Toast>
        )}
      </PilhaFlutuante>

      <ZonasDeSoltura onSoltar={salvarLink} />

      {gavetaAberta && (
        <Suspense fallback={null}>
          <GavetaLinks
            aberta
            onFechar={() => setGavetaAberta(false)}
            links={links ?? []}
            onSalvar={salvarLink}
            onRemover={removerLink}
            destacado={destacado}
            erroCaptura={erroCaptura}
            onLimparErro={() => setErroCaptura(null)}
            desfazivel={desfazivel}
            onDesfazer={desfazerRemocao}
          />
        </Suspense>
      )}

      <Paleta
        aberta={paletaAberta}
        onFechar={() => setPaletaAberta(false)}
        onAbrirNota={abrirNota}
        onAbrirCard={(boardId, cardId) => navigate(`/b/${boardId}/c/${cardId}`)}
        comandos={comandos}
        // Só preenche o campo e abre o painel — não envia. Uma mensagem são até
        // cinco chamadas pagas ao provedor (INV-47, INV-56); quem envia é o
        // usuário, com o texto à vista para revisar.
        onPerguntar={(t) => {
          // Pergunta nova, conversa nova: entrar na conversa aberta levaria o
          // histórico dela junto no envio. `novaConversa` limpa o campo antes,
          // e o texto entra depois.
          if (emAssistente) {
            sessao.novaConversa();
            sessao.focarCampo();
          } else {
            sessao.abrirPainel({ nova: true });
          }
          sessao.setTexto(t);
        }}
      />
      <Atalhos aberto={atalhosAbertos} onFechar={() => setAtalhosAbertos(false)} />
    </div>
  );
}
