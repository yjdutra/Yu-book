import { IconeBoard } from "@yu-book/cliente/icones";
import { EmBreve } from "../components/EmBreve";

export function ProjetosPage() {
  return (
    <EmBreve
      Icone={IconeBoard}
      tom="[--tom:var(--color-agente-ambar)]"
      titulo="Os seus projetos"
      texto="Os quadros do Yu-book, com o que está em andamento em cada um."
    />
  );
}
