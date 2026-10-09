import { IconeTarefa } from "@yu-book/cliente/icones";
import { EmBreve } from "../components/EmBreve";

export function TarefasPage() {
  return (
    <EmBreve
      Icone={IconeTarefa}
      tom="[--tom:var(--color-agente-verde)]"
      titulo="As suas tarefas"
      texto="As de hoje e as atrasadas, agrupadas por projeto, para concluir com um toque."
    />
  );
}
