import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { EditorRotina } from "../components/rotinas/EditorRotina";
import { ExecucaoRotina } from "../components/rotinas/ExecucaoRotina";
import { GaleriaRotinas } from "../components/rotinas/GaleriaRotinas";

/**
 * O editor pela rota. A chave remonta o editor ao trocar de rotina, ou de
 * modelo em `novo?modelo=…`: o rascunho nasce uma vez por rotina — a mesma
 * regra do editor de agentes.
 */
function EditorPelaRota({ novo }: { novo: boolean }) {
  const { id } = useParams();
  const { search } = useLocation();
  const alvo = novo ? null : (id ?? null);
  return <EditorRotina key={alvo ?? `novo${search}`} id={alvo} />;
}

/** A chave remonta a tela a cada execução: o fluxo assinado é de uma só. */
function ExecucaoPelaRota({ onAbrirNota }: { onAbrirNota: (id: string) => void }) {
  const { runId } = useParams();
  return runId ? (
    <ExecucaoRotina key={runId} runId={runId} onAbrirNota={onAbrirNota} />
  ) : null;
}

/** A moldura comum. O editor usa a tela mais larga: o fluxo corre na horizontal. */
function Moldura({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1400px] px-8 py-6">{children}</div>
    </main>
  );
}

/**
 * Rotinas (Etapa E da frente de IA): a galeria, o editor de fluxo e a execução
 * ao vivo, em `/assistente/rotinas`. Na área Assistente do trilho, como os
 * agentes: rotina é agente encadeado, não área nova.
 *
 * `onAbrirNota` é o da casca (INV-55), para o "Abrir nota" da execução.
 */
export function RotinasPage({ onAbrirNota }: { onAbrirNota: (id: string) => void }) {
  return (
    <Moldura>
      <Routes>
        <Route index element={<GaleriaRotinas />} />
        <Route path="novo" element={<EditorPelaRota novo />} />
        <Route path=":id" element={<EditorPelaRota novo={false} />} />
        <Route
          path=":id/execucoes/:runId"
          element={<ExecucaoPelaRota onAbrirNota={onAbrirNota} />}
        />
        <Route path="*" element={<Navigate to="/assistente/rotinas" replace />} />
      </Routes>
    </Moldura>
  );
}

/**
 * `/assistente/execucoes/:runId` — o "Ver execução" da marca de IA. A marca
 * guarda a execução e não a rotina, e a rotina pode ter sido excluída: a tela
 * da execução não precisa dela.
 */
export function ExecucaoAvulsaPage({ onAbrirNota }: { onAbrirNota: (id: string) => void }) {
  return (
    <Moldura>
      <ExecucaoPelaRota onAbrirNota={onAbrirNota} />
    </Moldura>
  );
}
