import type { Link, LinkKind } from "@yu-book/shared";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useCriarLink, useExcluirLink, useLinks } from "../lib/links";
import { FILTROS_VAZIOS, useCriarNota } from "../lib/notas";
import type { Filtros } from "../lib/notas";
import { useWorkspaceAtivo } from "../lib/workspace";
import { NotasPage } from "../pages/NotasPage";
import { Atalhos } from "./Atalhos";
import { PainelRedimensionavel } from "./Colunas";
import { Navegacao } from "./Navegacao";
import { Paleta } from "./Paleta";
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
 * A gaveta também é sob demanda: ela usa o `dnd-kit` para reordenar favoritos,
 * e essa biblioteca não precisa estar no bundle que abre a tela de notas.
 */
const GavetaLinks = lazy(() =>
  import("./GavetaLinks").then((m) => ({ default: m.GavetaLinks })),
);

function CarregandoTela() {
  return (
    <main className="flex flex-1 items-center justify-center text-sm text-ink-400">
      <span className="animate-pulse">Carregando…</span>
    </main>
  );
}

/**
 * Casca da aplicação: a coluna de navegação é a mesma em notas e em kanban, e
 * os atalhos globais valem nas duas (RNF-01, RNF-05).
 */
export function Aplicacao() {
  const navigate = useNavigate();
  const { ativoId } = useWorkspaceAtivo();
  const criar = useCriarNota();

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [atalhosAbertos, setAtalhosAbertos] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);
  const [recemCriada, setRecemCriada] = useState<RecemCriada | null>(null);

  const { data: links } = useLinks();
  const criarLink = useCriarLink();
  const excluirLink = useExcluirLink();
  const [gavetaAberta, setGavetaAberta] = useState(false);
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

  const desfazerRemocao = useCallback(() => {
    if (!desfazivel) return;
    // Recria com o nome que tinha: não paga a busca de título de novo (S-06).
    criarLink.mutate({ url: desfazivel.url, kind: desfazivel.kind, title: desfazivel.title });
    setDesfazivel(null);
  }, [criarLink, desfazivel]);

  // RF-02: o workspace ativo entra nos filtros; a barra lateral não mexe nele.
  const filtrosEfetivos = useMemo<Filtros>(
    () => ({ ...filtros, workspaceId: ativoId }),
    [filtros, ativoId],
  );

  const abrirNota = useCallback(
    (id: string) => {
      setRecemCriada(null);
      navigate(`/n/${id}`);
    },
    [navigate],
  );

  const novaNota = useCallback(
    (titulo?: string) => {
      setErroCriacao(null);
      criar.mutate(
        {
          title: titulo?.trim() || tituloProvisorio(),
          kind: filtros.kind ?? "livre",
          // RF-05: nasce no workspace ativo.
          workspaceId: ativoId,
        },
        {
          onSuccess: (nota) => {
            // RNF-06: o painel foca o campo certo quando os dados chegam.
            setRecemCriada({ id: nota.id, comTitulo: Boolean(titulo?.trim()) });
            navigate(`/n/${nota.id}`);
          },
          onError: (erro) => {
            setErroCriacao(
              erro instanceof ApiError ? erro.message : "Não foi possível criar a nota.",
            );
          },
        },
      );
    },
    [criar, filtros.kind, ativoId, navigate],
  );

  // RNF-01: atalhos globais, válidos em qualquer tela.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        navigate("/b");
        return;
      }
      // RF-15. Ctrl+L puro é a barra de endereço do navegador — daí o Shift.
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setGavetaAberta((v) => !v);
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletaAberta(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        novaNota();
        return;
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setAtalhosAbertos((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setPaletaAberta(false);
        setAtalhosAbertos(false);
        setGavetaAberta(false);
      }
    }

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [novaNota, navigate]);

  return (
    <div className="flex h-screen overflow-hidden">
      <PainelRedimensionavel
        chave="yb:col-nav"
        inicial={240}
        rotulo="Largura da navegação"
        className="overflow-y-auto bg-ink-900"
      >
        <Navegacao
          filtros={filtrosEfetivos}
          onFiltros={setFiltros}
          onNovaNota={() => novaNota()}
          onAbrirGaveta={() => setGavetaAberta(true)}
          linksParaVer={(links ?? []).filter((l) => l.kind === "depois").length}
        />
      </PainelRedimensionavel>

      <Routes>
        {["/", "/n/:id"].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <NotasPage
                filtros={filtrosEfetivos}
                onFiltros={setFiltros}
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {erroCriacao && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-500/15 px-4 py-2
                     text-sm text-red-200 ring-1 ring-red-500/30"
        >
          {erroCriacao}
          <button
            type="button"
            onClick={() => setErroCriacao(null)}
            aria-label="Fechar aviso"
            className="ml-3 text-red-300"
          >
            ×
          </button>
        </div>
      )}

      {/* RF-28: a rede de proteção de quem apaga sem confirmação. */}
      {desfazivel && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3
                     rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm text-ink-200
                     shadow-2xl"
        >
          <span className="max-w-xs truncate">“{desfazivel.title}” saiu da gaveta</span>
          <button
            type="button"
            onClick={desfazerRemocao}
            className="rounded px-2 py-0.5 text-xs font-medium text-accent-400 hover:bg-ink-700"
          >
            desfazer
          </button>
        </div>
      )}

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
          />
        </Suspense>
      )}

      <Paleta
        aberta={paletaAberta}
        onFechar={() => setPaletaAberta(false)}
        onAbrirNota={abrirNota}
        onAbrirCard={(boardId, cardId) => navigate(`/b/${boardId}/c/${cardId}`)}
      />
      <Atalhos aberto={atalhosAbertos} onFechar={() => setAtalhosAbertos(false)} />
    </div>
  );
}
