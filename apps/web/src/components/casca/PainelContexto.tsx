import { useLocation } from "react-router-dom";
import { BotaoIcone } from "../base/Botao";
import { Tecla } from "../base/Tecla";
import { PainelRedimensionavel } from "../Colunas";
import { IconeBusca, IconeRecolher } from "../Icones";
import { SeletorWorkspace } from "../SeletorWorkspace";
import { ContextoAjustes } from "./contexto/ContextoAjustes";
import { ContextoAssistente } from "./contexto/ContextoAssistente";
import { ContextoBoards } from "./contexto/ContextoBoards";
import { ContextoInicio } from "./contexto/ContextoInicio";
import { ContextoNotas } from "./contexto/ContextoNotas";

export type Area = "inicio" | "notas" | "boards" | "assistente" | "ajustes";

export function areaDe(pathname: string): Area {
  if (pathname.startsWith("/n")) return "notas";
  if (pathname.startsWith("/b")) return "boards";
  if (pathname.startsWith("/assistente")) return "assistente";
  if (pathname.startsWith("/ajustes")) return "ajustes";
  return "inicio";
}

const TITULO: Record<Area, string> = {
  inicio: "Início",
  notas: "Notas",
  boards: "Boards",
  assistente: "Assistente",
  ajustes: "Ajustes",
};

/**
 * Painel contextual (redesenho de UI, Etapa 2): o que muda com a área escolhida
 * no trilho. O topo é o mesmo em todas — o workspace, que é o contexto da
 * aplicação inteira (RF-01 da Fase 2), e a busca.
 *
 * Mora na coluna `yb:col-nav`, a mesma da antiga barra lateral: quem já tinha
 * ajustado a largura continua com ela (RNF-03 da Fase 1).
 */
export function PainelContexto({
  onRecolher,
  onBuscar,
  onNovaNota,
}: {
  onRecolher: () => void;
  onBuscar: () => void;
  onNovaNota: () => void;
}) {
  const area = areaDe(useLocation().pathname);

  return (
    <PainelRedimensionavel
      chave="yb:col-nav"
      inicial={240}
      rotulo="Largura do painel lateral"
      className="flex flex-col overflow-hidden bg-ink-900"
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3.5">
        <h2 className="text-sm font-semibold text-titulo">{TITULO[area]}</h2>
        <BotaoIcone
          rotulo="Recolher painel (Ctrl+\)"
          icone={<IconeRecolher />}
          onClick={onRecolher}
          className="ml-auto"
        />
      </div>

      <div className="shrink-0 space-y-2 px-3 pb-3">
        <SeletorWorkspace />
        <button
          type="button"
          onClick={onBuscar}
          className="flex h-8 w-full items-center gap-2 rounded-controle border border-ink-800
                     bg-ink-950/60 px-2.5 text-xs text-ink-400 transition-colors
                     hover:border-ink-700 hover:text-ink-200"
        >
          <IconeBusca className="size-3.5" />
          <span className="flex-1 text-left">Buscar…</span>
          <Tecla combo="Ctrl+K" />
        </button>
      </div>

      <nav
        aria-label={`Navegação de ${TITULO[area]}`}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        {area === "inicio" && <ContextoInicio />}
        {area === "notas" && <ContextoNotas onNovaNota={onNovaNota} />}
        {area === "boards" && <ContextoBoards />}
        {area === "assistente" && <ContextoAssistente />}
        {area === "ajustes" && <ContextoAjustes />}
      </nav>
    </PainelRedimensionavel>
  );
}
