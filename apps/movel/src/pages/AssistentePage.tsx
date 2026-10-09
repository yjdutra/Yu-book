import { IconeAssistente } from "@yu-book/cliente/icones";
import { EmBreve } from "../components/EmBreve";

export function AssistentePage() {
  return (
    <EmBreve
      Icone={IconeAssistente}
      tom="[--tom:var(--color-ia-500)]"
      titulo="O assistente no bolso"
      texto="Converse com o seu acervo e com os agentes, por texto ou por voz."
    />
  );
}
