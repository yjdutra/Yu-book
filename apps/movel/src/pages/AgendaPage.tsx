import { IconeCalendario } from "@yu-book/cliente/icones";
import { EmBreve } from "../components/EmBreve";

export function AgendaPage() {
  return (
    <EmBreve
      Icone={IconeCalendario}
      tom="[--tom:var(--color-agente-azul)]"
      titulo="O calendário do mês"
      texto="Cada dia com os seus eventos, as tarefas marcadas e os prazos dos cards, num calendário com pontos."
    />
  );
}
