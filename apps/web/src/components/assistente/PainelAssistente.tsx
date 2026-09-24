import type { ChatSource } from "@yu-book/shared";
import { useNavigate } from "react-router-dom";
import { useConversa, useConversas } from "../../lib/chat";
import { useSessaoChat } from "../../lib/sessaoChat";
import { BotaoIcone } from "../base/Botao";
import { Menu } from "../base/Menu";
import { PainelRedimensionavel } from "../Colunas";
import { IconeExpandir, IconeFechar, IconeMais, IconeConversas } from "../Icones";
import { Compositor } from "./Compositor";
import { Conversa } from "./Conversa";

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
export function PainelAssistente({ onAbrirNota }: { onAbrirNota: (id: string) => void }) {
  const navigate = useNavigate();
  const { conversaId, selecionar, novaConversa, fecharPainel, focarCampo } = useSessaoChat();
  const { data: conversas } = useConversas();
  const { data: conversa } = useConversa(conversaId);

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
      className="relative flex flex-col overflow-hidden bg-ink-900 animate-deslizar-esquerda"
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
        {/* O fio de IA na borda: a marca da área, sem depender dela para dizer nada. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-px bg-linear-to-b from-accent-500 to-ia-500"
        />

        <header className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-3 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-titulo">
            {conversaId ? (conversa?.title ?? "…") : "Nova conversa"}
          </h2>
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
          <BotaoIcone rotulo="Fechar o assistente" icone={<IconeFechar />} onClick={fecharPainel} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Conversa
            onAbrirFonte={abrirFonte}
            vazio={
              <p className="text-sm text-ink-400">
                Pergunte sobre o seu acervo — o assistente procura sozinho. Use{" "}
                <kbd className="rounded-etiqueta bg-ink-800 px-1">@</kbd> para anexar uma nota,
                um card ou um quadro ao contexto.
              </p>
            }
          />
        </div>

        <div className="shrink-0 border-t border-ink-800 p-3">
          <Compositor />
        </div>
      </aside>
    </PainelRedimensionavel>
  );
}
