import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@yu-book/cliente` é fonte com React como peer: se a versão daqui e a
    // resolvida por ele divergissem, o bundle levaria dois Reacts — "Invalid
    // hook call" em tempo de execução, sem erro de build. O TanStack Query
    // também é peer dele (frente de agenda, Fase 4): duas cópias seriam dois
    // contextos, e o hook do pacote não acharia o `QueryClient` do app.
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  server: {
    // 5173 é do web: os dois sobem juntos no `pnpm dev` da raiz.
    port: 5174,
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: true,
    // A Railway serve o preview atrás do domínio dela.
    allowedHosts: true,
  },
});
