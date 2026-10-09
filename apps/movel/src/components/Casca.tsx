import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AgendaPage } from "../pages/AgendaPage";
import { AssistentePage } from "../pages/AssistentePage";
import { InicioPage } from "../pages/InicioPage";
import { ProjetosPage } from "../pages/ProjetosPage";
import { TarefasPage } from "../pages/TarefasPage";
import { Cabecalho } from "./Cabecalho";
import { FolhaCriar } from "./FolhaCriar";
import { Navegacao } from "./Navegacao";

// Projetos não está na barra (cinco posições é o teto do polegar): chega-se
// a ele pelo cartão do Início.
const TITULOS: Record<string, string> = {
  "/": "Início",
  "/agenda": "Agenda",
  "/tarefas": "Tarefas",
  "/projetos": "Projetos",
  "/assistente": "Assistente",
};

/**
 * A casca autenticada do móvel: véu de cor no topo, cabeçalho, a área atual e
 * a barra de navegação (trilho a partir de 1024px). O conteúdo reserva embaixo
 * a altura da barra mais a área segura, para o fim da página não morar atrás
 * dela.
 */
export function Casca() {
  const { pathname } = useLocation();
  const [criando, setCriando] = useState(false);
  const titulo = TITULOS[pathname] ?? "Início";

  useEffect(() => {
    document.title = pathname === "/" ? "Yu-book" : `${titulo} · Yu-book`;
    // Trocar de área é página nova: começa do topo, não da rolagem da outra.
    window.scrollTo(0, 0);
  }, [pathname, titulo]);

  return (
    <div className="relative isolate min-h-dvh">
      <div aria-hidden="true" className="veu-topo absolute inset-x-0 top-0 -z-10 h-80" />

      <Navegacao criando={criando} aoCriar={() => setCriando(true)} />

      <div className="lg:pl-28">
        <div
          className="mx-auto max-w-5xl px-5
                     pb-[calc(var(--altura-barra)+env(safe-area-inset-bottom)+1rem)]
                     pt-[calc(env(safe-area-inset-top)+1.25rem)]
                     lg:px-8 lg:pb-10 lg:pt-8"
        >
          <Cabecalho titulo={titulo} inicio={pathname === "/"} />
          {/* `key`: cada área entra com a própria animação curta. */}
          <main key={pathname} className="animate-surgir">
            <Routes>
              <Route path="/" element={<InicioPage />} />
              <Route path="/agenda" element={<AgendaPage />} />
              <Route path="/tarefas" element={<TarefasPage />} />
              <Route path="/projetos" element={<ProjetosPage />} />
              <Route path="/assistente" element={<AssistentePage />} />
              {/* Inclui o `/login` de onde se acabou de entrar. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>

      <FolhaCriar aberta={criando} onFechar={() => setCriando(false)} />
    </div>
  );
}
