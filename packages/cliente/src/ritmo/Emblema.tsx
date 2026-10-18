import type { EmblemaDoHabito, HabitColor } from "@yu-book/shared";
import { ICONE_EMBLEMA } from "../Icones";

/**
 * A cor de um hábito como classe que declara `--tom` (frente Ritmo, RNF-09): a
 * paleta é a dos agentes, com as mesmas chaves (`HABIT_COLORS`), então o tom é
 * o token `agente-*` da mesma chave — passa 3:1 contra o painel nos dois temas.
 * Classes escritas por extenso, para o Tailwind enxergá-las.
 */
export const TOM_DO_HABITO: Record<HabitColor, string> = {
  violeta: "[--tom:var(--color-agente-violeta)]",
  azul: "[--tom:var(--color-agente-azul)]",
  verde: "[--tom:var(--color-agente-verde)]",
  ambar: "[--tom:var(--color-agente-ambar)]",
  rosa: "[--tom:var(--color-agente-rosa)]",
  cinza: "[--tom:var(--color-agente-cinza)]",
};

/**
 * O emblema do hábito num quadrado arredondado, no tom dele, sobre o mesmo tom
 * diluído. Decorativo: o nome do hábito vai sempre ao lado (RNF-08). Quem usa
 * põe a classe de `TOM_DO_HABITO` num ancestral, ou aqui em `className`.
 */
export function EmblemaHabito({
  emblema,
  tamanho = "m",
  className = "",
}: {
  emblema: EmblemaDoHabito;
  tamanho?: "p" | "m";
  className?: string;
}) {
  const Icone = ICONE_EMBLEMA[emblema] ?? ICONE_EMBLEMA.estrela;
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center text-(--tom)
                  bg-[color-mix(in_srgb,var(--tom)_18%,transparent)] ${
                    tamanho === "p" ? "size-9 rounded-controle" : "size-10 rounded-cartao"
                  } ${className}`}
    >
      <Icone className={tamanho === "p" ? "size-4.5" : "size-5"} />
    </span>
  );
}
