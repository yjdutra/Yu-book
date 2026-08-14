import { Navigate, Route, Routes } from "react-router-dom";
import { Aplicacao } from "./components/Aplicacao";
import { GuardaDesktop } from "./components/Colunas";
import { useAuth } from "./lib/auth";
import { WorkspaceProvider } from "./lib/workspace";
import { LoginPage } from "./pages/LoginPage";

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-ink-400">
      <p className="animate-pulse text-sm">{label}</p>
    </div>
  );
}

export function App() {
  const { status } = useAuth();

  if (status === "loading") return <Splash label="Carregando sessão…" />;

  if (status !== "authenticated") {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <GuardaDesktop>
      {/* O workspace ativo envolve a aplicação inteira: notas, busca e boards
          leem daqui (RF-01, RF-02). */}
      <WorkspaceProvider>
        <Aplicacao />
      </WorkspaceProvider>
    </GuardaDesktop>
  );
}
