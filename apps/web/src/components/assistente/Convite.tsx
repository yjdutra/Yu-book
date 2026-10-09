import { useAuth } from "@yu-book/cliente/auth";
import { BoasVindas } from "@yu-book/cliente/chat/BoasVindas";
import { SUGESTOES_INICIAIS, Sugestoes } from "@yu-book/cliente/chat/Sugestoes";
import { useAcoesChat } from "../../lib/sessaoChat";

/**
 * O convite da conversa vazia sem agente, igual no painel e na tela cheia — só
 * o tamanho muda. A sugestão **preenche e foca, nunca envia** (§5 do design
 * system): uma mensagem são até cinco chamadas pagas.
 */
export function ConviteDoAssistente({ compacto = false }: { compacto?: boolean }) {
  const { user } = useAuth();
  const { setTexto, focarCampo } = useAcoesChat();
  const nome = user?.name.trim().split(/\s+/)[0] ?? "";
  return (
    <BoasVindas
      nome={nome}
      compacto={compacto}
      descricao={
        <>
          Procuro nas suas notas e quadros, e anoto na agenda o que você pedir. Use{" "}
          <kbd className="rounded-etiqueta bg-ink-800 px-1 font-mono text-xs">@</kbd> para
          anexar uma nota, um card ou um quadro.
        </>
      }
    >
      <Sugestoes
        itens={SUGESTOES_INICIAIS}
        centralizar={!compacto}
        rotulo="Sugestões para começar"
        onEscolher={(texto) => {
          setTexto(texto);
          focarCampo();
        }}
      />
    </BoasVindas>
  );
}
