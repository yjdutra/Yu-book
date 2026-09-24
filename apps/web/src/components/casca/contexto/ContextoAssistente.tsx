import { useAcoesChat } from "../../../lib/sessaoChat";
import { ListaConversas } from "../../assistente/ListaConversas";
import { Botao } from "../../base/Botao";
import { IconeMais } from "../../Icones";

/** Área Assistente: começar uma conversa, ou voltar a uma. */
export function ContextoAssistente() {
  const { novaConversa, focarCampo } = useAcoesChat();

  return (
    <>
      <Botao
        variante="ia"
        tamanho="m"
        icone={<IconeMais />}
        className="w-full"
        onClick={() => {
          novaConversa();
          focarCampo();
        }}
      >
        Nova conversa
      </Botao>
      <ListaConversas onEscolher={() => focarCampo()} />
    </>
  );
}
