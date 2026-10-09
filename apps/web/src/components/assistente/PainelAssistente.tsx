import type { ChatSource, NoteDetail } from "@yu-book/shared";
import { useNavigate } from "react-router-dom";
import { useConversa, useConversas } from "@yu-book/cliente/chat";
import { useSessaoChat } from "../../lib/sessaoChat";
import { BotaoIcone } from "@yu-book/cliente/base/Botao";
import { Menu } from "@yu-book/cliente/base/Menu";
import { PainelRedimensionavel } from "../Colunas";
import { IconeExpandir, IconeFechar, IconeMais, IconeConversas } from "@yu-book/cliente/icones";
import { AvatarAgente } from "@yu-book/cliente/chat/AvatarAgente";
import { useAgenteDaConversa } from "./agenteDaConversa";
import { Compositor } from "./Compositor";
import { Conversa } from "./Conversa";
import { ConviteDoAssistente } from "./Convite";

const RECENTES = 8;

/**
 * O assistente como painel lateral (redesenho de UI, Etapa 3).
 *
 * Empurra o conteúdo em vez de cobri-lo, e fica aberto enquanto se navega:
 * a conversa acompanha a nota ou o card que está na tela. Não é modal
 * (RNF-05 da Fase 1) — sem véu e sem foco preso. O Esc só o fecha quando o
 * foco está dentro dele; fora, o Esc é de quem tem o foco.
 *
 * Montado dentro de `{painelAberto && …}`, sem prop `aberto`: o estado mora
 * na sessão, e fechar no meio de uma resposta é `fecharPainel`, que para o
 * fluxo antes de desmontar.
 */
export function PainelAssistente({
  onAbrirNota,
  onNotaCriada,
}: {
  onAbrirNota: (id: string) => void;
  onNotaCriada: (nota: NoteDetail) => void;
}) {
  const navigate = useNavigate();
  const { conversaId, selecionar, novaConversa, fecharPainel, focarCampo } = useSessaoChat();
  const { data: conversas } = useConversas();
  const { data: conversa } = useConversa(conversaId);
  const agente = useAgenteDaConversa();

  /** RF-20: a fonte abre o alvo — e o painel continua aberto ao lado dele. */
  function abrirFonte(fonte: ChatSource) {
    if (fonte.kind === "note") onAbrirNota(fonte.id);
    else if (fonte.kind === "board") navigate(`/b/${fonte.id}`);
  }

  return (
    <PainelRedimensionavel
      chave="yb:col-chat"
      inicial={400}
      min={320}
      max={640}
      divisor="esquerda"
      rotulo="Largura do painel do assistente"
      className="relative flex flex-col overflow-hidden border-l border-ink-800 bg-ink-900
                 animate-deslizar-esquerda"
    >
      <aside
        aria-label="Assistente"
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || e.defaultPrevented) return;
          e.stopPropagation();
          fecharPainel();
        }}
      >
        {/* O fio de IA no topo: a marca da área, sem depender dela para dizer
            nada. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-accent-500 via-ia-500
                     to-accent-500/0"
        />

        <header className="flex shrink-0 items-center gap-2 px-3 pt-3.5 pb-2">
          {/* Com a conversa começada, o agente é a identidade dela, fixa no
              cabeçalho (Etapa D); antes disso, quem escolhe é o seletor do
              compositor. */}
          {agente.fixo && agente.identidade && (
            <AvatarAgente
              nome={agente.identidade.name}
              cor={agente.identidade.color}
              excluido={agente.excluido}
            />
          )}
          <div className="min-w-0 flex-1 pl-1">
            <h2 className="truncate text-sm font-semibold text-titulo">
              {conversaId ? (conversa?.title ?? "…") : "Nova conversa"}
            </h2>
            {agente.fixo && agente.identidade && (
              <p className="truncate text-miudo text-ink-400">
                com {agente.identidade.name}
                {agente.excluido && " · agente excluído"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Menu
              rotulo="Conversas recentes"
              lado="baixo-fim"
              gatilho={(p) => (
                <button
                  {...p}
                  type="button"
                  aria-label="Conversas recentes"
                  title="Conversas recentes"
                  className="inline-flex size-7 items-center justify-center rounded-controle
                             text-ink-400 transition hover:bg-ink-800 hover:text-ink-200"
                >
                  <IconeConversas />
                </button>
              )}
              itens={[
                ...(conversas ?? []).slice(0, RECENTES).map((c) => ({
                  rotulo: c.title,
                  icone: c.agent ? (
                    <AvatarAgente
                      nome={c.agent.name}
                      cor={c.agent.color}
                      tamanho="p"
                      excluido={c.agent.id === null}
                    />
                  ) : undefined,
                  aoEscolher: () => {
                    selecionar(c.id);
                    focarCampo();
                  },
                })),
                { rotulo: "Ver todas", aoEscolher: () => navigate("/assistente") },
              ]}
            />
            <BotaoIcone
              rotulo="Nova conversa"
              icone={<IconeMais />}
              onClick={() => {
                novaConversa();
                focarCampo();
              }}
            />
            <BotaoIcone
              rotulo="Abrir em tela cheia"
              icone={<IconeExpandir />}
              onClick={() => navigate("/assistente")}
            />
            <BotaoIcone
              rotulo="Fechar o assistente"
              icone={<IconeFechar />}
              onClick={fecharPainel}
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
          <Conversa
            compacto
            onAbrirFonte={abrirFonte}
            onNotaCriada={onNotaCriada}
            vazio={<ConviteDoAssistente compacto />}
          />
        </div>

        {/* O compositor flutua sobre o fim da conversa: o degradê acima dele
            some com o texto em vez de cortá-lo numa linha. */}
        <div className="relative shrink-0 px-3 pb-3">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t
                       from-ink-900 to-ink-900/0"
          />
          <Compositor />
        </div>
      </aside>
    </PainelRedimensionavel>
  );
}
