import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Colunas } from "../components/Colunas";
import { ListaNotas } from "../components/ListaNotas";
import { Navegacao } from "../components/Navegacao";
import { PainelEditor } from "../components/PainelEditor";
import { Paleta } from "../components/Paleta";
import { Atalhos } from "../components/Atalhos";
import { ApiError } from "../lib/api";
import { FILTROS_VAZIOS, useCriarNota } from "../lib/notas";
import type { Filtros } from "../lib/notas";

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

export function NotasPage() {
  const { id: notaId = null } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const criar = useCriarNota();

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [atalhosAbertos, setAtalhosAbertos] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);
  /**
   * Nota recém-criada e como ela nasceu. Criada por `Ctrl+N` não tem nome, e o
   * foco vai para o título; criada por um link `[[…]]` já nasce com o título
   * certo, então o foco vai direto para o corpo.
   */
  const [recemCriada, setRecemCriada] = useState<{ id: string; comTitulo: boolean } | null>(null);

  const refTitulo = useRef<HTMLInputElement>(null);
  const refCorpo = useRef<HTMLTextAreaElement>(null);

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
          workspaceId: filtros.workspaceId,
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
    [criar, filtros.kind, filtros.workspaceId, navigate],
  );

  // RNF-04: atalhos globais.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;

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
      }
    }

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [novaNota]);

  return (
    <>
      <Colunas
        navegacao={
          <Navegacao filtros={filtros} onFiltros={setFiltros} onNovaNota={() => novaNota()} />
        }
        lista={
          <ListaNotas
            filtros={filtros}
            onFiltros={setFiltros}
            notaAtiva={notaId}
            onAbrirNota={abrirNota}
            onNovaNota={() => novaNota()}
          />
        }
        editor={
          notaId ? (
            <PainelEditor
              key={notaId}
              notaId={notaId}
              onAbrirNota={abrirNota}
              onCriarPorTitulo={(titulo) => novaNota(titulo)}
              onFechar={() => navigate("/")}
              autoFocoTitulo={recemCriada?.id === notaId && !recemCriada.comTitulo}
              autoFocoCorpo={recemCriada?.id === notaId && recemCriada.comTitulo}
              refTitulo={refTitulo}
              refCorpo={refCorpo}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-ink-400">Selecione uma nota para começar.</p>
              <button
                type="button"
                onClick={() => novaNota()}
                className="rounded bg-accent-500 px-3 py-1.5 text-xs font-medium text-white
                           hover:bg-accent-400"
              >
                Nova nota — Ctrl+N
              </button>
              <p className="text-xs text-ink-400/70">
                Ctrl+K busca · Ctrl+/ atalhos
              </p>
            </div>
          )
        }
      />

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

      <Paleta
        aberta={paletaAberta}
        onFechar={() => setPaletaAberta(false)}
        onAbrirNota={abrirNota}
      />
      <Atalhos aberto={atalhosAbertos} onFechar={() => setAtalhosAbertos(false)} />
    </>
  );
}
