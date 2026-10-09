import { useAuth } from "@yu-book/cliente/auth";
import { Navigate, Route, Routes } from "react-router-dom";
import { Casca } from "./components/Casca";
import { Marca } from "./components/Marca";
import { LoginPage } from "./pages/LoginPage";

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
      <Marca className="size-14 animate-pulse" />
      <p role="status" className="text-sm text-ink-400">
        Carregando sessão…
      </p>
    </div>
  );
}

export function App() {
  const { status } = useAuth();

  if (status === "loading") return <Splash />;

  if (status !== "authenticated") {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <Casca />;
}
