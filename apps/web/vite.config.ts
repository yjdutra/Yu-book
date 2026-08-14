import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  preview: {
    port: Number(process.env.PORT) || 4173,
    host: true,
    // A Railway serve o preview atrás do domínio dela.
    allowedHosts: true,
  },
});
