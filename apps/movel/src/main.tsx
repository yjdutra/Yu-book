import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configurarApi } from "@yu-book/cliente/api";
import { AuthProvider } from "@yu-book/cliente/auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";

// Antes de montar: o pacote não lê `import.meta.env`, cada app passa a sua.
configurarApi({ baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:3333" });

// A mesma configuração do web: as duas telas falam com a mesma API.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("elemento #root não encontrado");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
