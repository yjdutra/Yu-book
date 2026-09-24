import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { EditorAgente } from "../components/agentes/EditorAgente";
import { GaleriaAgentes } from "../components/agentes/GaleriaAgentes";

/**
 * O editor pela rota. A chave remonta o editor ao trocar de agente, ou de
 * modelo pronto em `novo?modelo=…`: o rascunho nasce uma vez por agente, e
 * reaproveitar o estado de outro misturaria os dois.
 */
function EditorPelaRota({ novo }: { novo: boolean }) {
  const { id } = useParams();
  const { search } = useLocation();
  const alvo = novo ? null : (id ?? null);
  return <EditorAgente key={alvo ?? `novo${search}`} id={alvo} />;
}

/**
 * Agentes especialistas (Etapa D da frente de IA): a galeria e o editor, em
 * `/assistente/agentes`. Continuam na área Assistente do trilho — agente é o
 * assistente com premissas, não uma área nova.
 */
export function AgentesPage() {
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-8 py-6">
        <Routes>
          <Route index element={<GaleriaAgentes />} />
          <Route path="novo" element={<EditorPelaRota novo />} />
          <Route path=":id" element={<EditorPelaRota novo={false} />} />
          <Route path="*" element={<Navigate to="/assistente/agentes" replace />} />
        </Routes>
      </div>
    </main>
  );
}
