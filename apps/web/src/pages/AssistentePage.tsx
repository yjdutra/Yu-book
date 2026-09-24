import type { ChatSource, NoteDetail } from "@yu-book/shared";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AvatarAgente } from "../components/agentes/AvatarAgente";
import { useAgenteDaConversa } from "../components/assistente/agenteDaConversa";
import { Compositor } from "../components/assistente/Compositor";
import { Conversa } from "../components/assistente/Conversa";
import { Aviso } from "../components/base/Aviso";
import { IconeAssistente } from "../components/Icones";
import { avisoDeEspera, useAcoesChat } from "../lib/sessaoChat";
import type { EstadoRotaChat } from "../lib/sessaoChat";

/** Perguntas de partida: mostram o que o assistente alcança, e um clique as escreve. */
const SUGESTOES = [
  "O que vence esta semana nos meus quadros?",
  "Resuma o que eu anotei sobre o último projeto.",
  "Quais notas falam de testes automatizados?",
];

/**
 * O assistente em tela cheia (redesenho de UI, Etapa 3). A mesma conversa do
 * painel lateral — a sessão é uma só, e expandir no meio de uma resposta não a
 * interrompe. A lista de conversas mora no painel contextual ao lado.
 */
export function AssistentePage({
  onAbrirNota,
  onNotaCriada,
}: {
  onAbrirNota: (id: string) => void;
  onNotaCriada: (nota: NoteDetail) => void;
}) {
  const navigate = useNavigate();
  const { setTexto, focarCampo, abrirPainel, novaConversa, temFluxo } = useAcoesChat();
  const agente = useAgenteDaConversa();
  const location = useLocation();
  const pedido = (location.state as EstadoRotaChat | null)?.conversaNova ?? null;
  /// `undefined` sem aviso; `null` é o aviso da conversa nova sem agente.
  const [esperando, setEsperando] = useState<string | null | undefined>(undefined);

  /**
   * A conversa nova pedida de fora da tela do chat — "Conversar" com um agente,
   * ou "Nova conversa" na galeria e no editor de agentes — chega aqui pelo
   * `state` (`EstadoRotaChat`). É ao chegar, e não antes de navegar, que a
   * conversa troca: a guarda do editor de agentes pode ter segurado a navegação. O `state` sai do histórico logo,
   * para o Voltar e o recarregar não pedirem a troca de novo.
   *
   * A resposta que começou entre o clique e a chegada (a pessoa enviou pelo
   * painel enquanto o diálogo da guarda estava aberto) está na tela: trocar a
   * conversa a tiraria dela com o laço pagando (INV-56).
   */
  useEffect(() => {
    if (!pedido) return;
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
    if (temFluxo()) {
      setEsperando(pedido.agente?.name ?? null);
    } else {
      setEsperando(undefined);
      novaConversa(pedido.agente?.id ?? null);
    }
    focarCampo();
  }, [pedido, location.pathname, location.search, navigate, novaConversa, temFluxo, focarCampo]);

  /**
   * RF-20: a fonte abre o alvo. Sair da tela cheia para ele leva a conversa
   * junto, no painel lateral — quem perguntou quer ver a resposta ao lado da
   * nota, não perdê-la.
   */
  function abrirFonte(fonte: ChatSource) {
    if (fonte.kind === "note") onAbrirNota(fonte.id);
    else if (fonte.kind === "board") navigate(`/b/${fonte.id}`);
    else return;
    abrirPainel();
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Etapa D: com a conversa começada, quem responde fica fixo no topo —
          o seletor do compositor só existe na conversa vazia. */}
      {agente.fixo && agente.identidade && (
        <div className="shrink-0 border-b border-ink-800 bg-ink-950/40">
          <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 px-8 py-2.5">
            <AvatarAgente
              nome={agente.identidade.name}
              cor={agente.identidade.color}
              tamanho="g"
              excluido={agente.excluido}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-titulo">
                {agente.identidade.name}
                {agente.excluido && (
                  <span className="ml-2 text-xs font-normal text-ink-400">agente excluído</span>
                )}
              </p>
              {agente.resumo?.description && (
                <p className="truncate text-xs text-ink-400">{agente.resumo.description}</p>
              )}
            </div>
            {agente.identidade.id && (
              <Link
                to={`/assistente/agentes/${agente.identidade.id}`}
                className="shrink-0 rounded-controle px-2 py-1 text-xs text-ink-400 transition
                           hover:bg-ink-800 hover:text-ink-200"
              >
                Editar o agente
              </Link>
            )}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-8 py-8">
          {esperando !== undefined && (
            <Aviso
              tom="alerta"
              urgente
              onFechar={() => setEsperando(undefined)}
              className="mb-4"
            >
              {avisoDeEspera(esperando)}
            </Aviso>
          )}
          <Conversa
            onAbrirFonte={abrirFonte}
            onNotaCriada={onNotaCriada}
            vazio={
              <div className="flex flex-col items-center pt-[10vh] text-center">
                <span
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-cartao
                             bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-brilho-ia"
                >
                  <IconeAssistente className="size-6" />
                </span>
                <h2 className="mt-4 text-xl font-semibold text-titulo">
                  Pergunte sobre o seu acervo
                </h2>
                <p className="mt-1 max-w-md text-sm text-ink-400">
                  O assistente procura nas suas notas e quadros sozinho. Use{" "}
                  <kbd className="rounded-etiqueta bg-ink-800 px-1">@</kbd> para anexar algo
                  específico ao contexto.
                </p>
                <div className="mt-6 flex w-full max-w-md flex-col gap-2">
                  {SUGESTOES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setTexto(s);
                        focarCampo();
                      }}
                      className="rounded-cartao border border-ink-800 bg-superficie px-4 py-2.5
                                 text-left text-sm text-ink-200 shadow-e1 transition
                                 hover:border-accent-400/60 hover:shadow-e2"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        </div>
      </div>
      <div className="shrink-0 border-t border-ink-800 bg-ink-950/40">
        <div className="mx-auto w-full max-w-[760px] px-8 py-4">
          <Compositor />
        </div>
      </div>
    </main>
  );
}
