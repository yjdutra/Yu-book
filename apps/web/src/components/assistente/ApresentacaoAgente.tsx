import type { AgentSummary } from "@yu-book/shared";
import { Link } from "react-router-dom";
import { AvatarAgente } from "../agentes/AvatarAgente";
import { contar, rotuloDoModelo } from "../agentes/comum";
import { Etiqueta } from "../base/Etiqueta";
import { IconeBoard, IconeLapis, IconeNotas } from "../Icones";

/**
 * O convite da conversa vazia quando há agente escolhido (Etapa D da IA): quem
 * vai responder e com o quê. Mostra as premissas **antes** da primeira
 * mensagem — é nesta hora que alguém percebe que escolheu o agente errado, e
 * trocar ainda é de graça.
 */
export function ApresentacaoAgente({
  agente,
  compacto = false,
}: {
  agente: AgentSummary;
  compacto?: boolean;
}) {
  return (
    <div
      className={
        compacto
          ? "flex flex-col gap-2"
          : "flex flex-col items-center pt-[10vh] text-center"
      }
    >
      <div className={compacto ? "flex items-center gap-2.5" : "flex flex-col items-center"}>
        <AvatarAgente nome={agente.name} cor={agente.color} tamanho={compacto ? "g" : "xg"} />
        <div className={compacto ? "min-w-0" : "mt-4"}>
          <h2
            className={`font-semibold text-titulo ${compacto ? "truncate text-sm" : "text-xl"}`}
          >
            {agente.name}
          </h2>
          {agente.description && (
            <p className={`text-ink-400 ${compacto ? "text-xs" : "mt-1 max-w-md text-sm"}`}>
              {agente.description}
            </p>
          )}
        </div>
      </div>

      <div
        className={`flex flex-wrap gap-1.5 ${compacto ? "" : "mt-5 justify-center"}`}
        role="group"
        aria-label="O que o agente carrega"
      >
        <Etiqueta icone={<IconeNotas className="size-3" />}>
          {contar(agente.baseNoteTitles.length, "nota-base", "notas-base")}
        </Etiqueta>
        {agente.liveSourceCount > 0 && (
          <Etiqueta icone={<IconeBoard className="size-3" />}>
            {contar(agente.liveSourceCount, "fonte viva", "fontes vivas")}
          </Etiqueta>
        )}
        <Etiqueta tom={agente.writes ? "ia" : "neutro"}>
          {contar(agente.toolCount, "ferramenta", "ferramentas")}
          {agente.writes && (
            <>
              {" · "}
              <IconeLapis className="inline size-3" /> escreve
            </>
          )}
        </Etiqueta>
        <Etiqueta tom="ia">{rotuloDoModelo(agente)}</Etiqueta>
      </div>

      <p className={`text-xs text-ink-400 ${compacto ? "" : "mt-4"}`}>
        As premissas entram em toda mensagem.{" "}
        <Link
          to={`/assistente/agentes/${agente.id}`}
          className="text-accent-400 underline decoration-accent-400/40 underline-offset-2
                     hover:text-titulo"
        >
          Editar o agente
        </Link>
      </p>
    </div>
  );
}
