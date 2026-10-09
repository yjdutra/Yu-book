import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AgendaPage } from "../pages/AgendaPage";
import { AssistentePage } from "../pages/AssistentePage";
import { InicioPage } from "../pages/InicioPage";
import { ProjetoPage } from "../pages/ProjetoPage";
import { ProjetosPage } from "../pages/ProjetosPage";
import { TarefasPage } from "../pages/TarefasPage";
import { Cabecalho } from "./Cabecalho";
import { ProvedorFolhaItem } from "./folha/FolhaItem";
import { Navegacao } from "./Navegacao";

/**
 * A conversa do chat em chunk próprio (Fase 5 da frente de agenda): traz o
 * renderizador de Markdown e o highlight.js, que o Início, a agenda e as
 * tarefas não usam. A lista de conversas é leve e fica no chunk inicial.
 */
const ConversaPage = lazy(() =>
  import("../pages/ConversaPage").then((m) => ({ default: m.ConversaPage })),
);

/** `/assistente/nova` e `/assistente/:id` — a conversa em tela cheia. */
export function naConversa(pathname: string): boolean {
  return /^\/assistente\/[^/]+\/?$/.test(pathname);
}

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
  // O detalhe do projeto (`/projetos/:id`) fica sob o nome da área.
  const titulo =
    TITULOS[pathname] ??
    (pathname.startsWith("/projetos/")
      ? "Projetos"
      : pathname.startsWith("/assistente/")
        ? "Assistente"
        : "Início");
  const conversa = naConversa(pathname);

  useEffect(() => {
    document.title = pathname === "/" ? "Yu-book" : `${titulo} · Yu-book`;
    // Trocar de área é página nova: começa do topo, não da rolagem da outra.
    window.scrollTo(0, 0);
  }, [pathname, titulo]);

  /// Dentro da conversa a barra inferior some (o trilho do desktop fica) e o
  /// cabeçalho é o dela. Uma rota só, `/assistente/:id`, e fora do `<main>`
  /// com `key`: a conversa nova troca `nova` pelo id ao nascer, e esta tela
  /// não pode remontar no meio da resposta.
  if (conversa) {
    return (
      <ProvedorFolhaItem>
        <Navegacao soTrilho />
        <Suspense
          fallback={
            <p role="status" className="p-6 text-sm text-ink-400 lg:pl-34">
              Abrindo a conversa…
            </p>
          }
        >
          <Routes>
            <Route path="/assistente/:id" element={<ConversaPage />} />
          </Routes>
        </Suspense>
      </ProvedorFolhaItem>
    );
  }

  return (
    <ProvedorFolhaItem>
      <div className="relative isolate min-h-dvh">
        <div aria-hidden="true" className="veu-topo absolute inset-x-0 top-0 -z-10 h-80" />

        <Navegacao />

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
                <Route path="/projetos/:id" element={<ProjetoPage />} />
                <Route path="/assistente" element={<AssistentePage />} />
                {/* Inclui o `/login` de onde se acabou de entrar. */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </div>
    </ProvedorFolhaItem>
  );
}
