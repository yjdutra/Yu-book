import { useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { RecemCriada } from "../components/Aplicacao";
import { PainelRedimensionavel } from "../components/Colunas";
import { ListaNotas } from "../components/ListaNotas";
import type { FocoDoCorpo } from "../components/Editor";
import { PainelEditor } from "../components/PainelEditor";

interface NotasPageProps {
  onAbrirNota: (id: string) => void;
  onNovaNota: (titulo?: string) => void;
  /**
   * Nota recém-criada e como ela nasceu. Criada por `Ctrl+N` não tem nome, e o
   * foco vai para o título; criada por um link `[[…]]` já nasce com o título
   * certo, então o foco vai direto para o corpo.
   */
  recemCriada: RecemCriada | null;
}

export function NotasPage({
  onAbrirNota,
  onNovaNota,
  recemCriada,
}: NotasPageProps) {
  const { id: notaId = null } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { search } = useLocation();

  const refTitulo = useRef<HTMLInputElement>(null);
  const refCorpo = useRef<FocoDoCorpo | null>(null);

  return (
    <>
      <PainelRedimensionavel
        chave="yb:col-lista"
        inicial={320}
        rotulo="Largura da lista"
        className="flex flex-col overflow-hidden bg-ink-900/50"
      >
        <ListaNotas
          notaAtiva={notaId}
          onAbrirNota={onAbrirNota}
          onNovaNota={() => onNovaNota()}
        />
      </PainelRedimensionavel>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {notaId ? (
          <PainelEditor
            key={notaId}
            notaId={notaId}
            onAbrirNota={onAbrirNota}
            onCriarPorTitulo={(titulo) => onNovaNota(titulo)}
            // Fechar a nota volta à lista com o mesmo recorte (RF-03 da Fase 4).
            onFechar={() => navigate(`/n${search}`)}
            onAbrirCard={(boardId, cardId) => navigate(`/b/${boardId}/c/${cardId}`)}
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
              onClick={() => onNovaNota()}
              className="rounded bg-accent-500 px-3 py-1.5 text-xs font-medium text-white
                         hover:bg-accent-400"
            >
              Nova nota — Ctrl+N
            </button>
            <p className="text-xs text-ink-400/70">
              Ctrl+K busca · Ctrl+Shift+B boards · Ctrl+/ atalhos
            </p>
          </div>
        )}
      </main>
    </>
  );
}
