import { Navigate, Route, Routes } from "react-router-dom";
import { GuardaDesktop } from "./components/Colunas";
import { useAuth } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { NotasPage } from "./pages/NotasPage";

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
      <Routes>
        <Route path="/" element={<NotasPage />} />
        <Route path="/n/:id" element={<NotasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GuardaDesktop>
  );
}
