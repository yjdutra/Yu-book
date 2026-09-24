import type { ChatSource, NoteDetail } from "@yu-book/shared";
import { useNavigate } from "react-router-dom";
import { Compositor } from "../components/assistente/Compositor";
import { Conversa } from "../components/assistente/Conversa";
import { IconeAssistente } from "../components/Icones";
import { useAcoesChat } from "../lib/sessaoChat";

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
  const { setTexto, focarCampo, abrirPainel } = useAcoesChat();

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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-8 py-8">
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
