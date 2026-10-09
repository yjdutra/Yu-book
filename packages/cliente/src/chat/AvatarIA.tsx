import { IconeAssistente } from "../Icones";

/*
 * Em arquivo próprio, e não em `FalaAssistente.tsx`: quem só mostra o avatar —
 * a lista de conversas do móvel, a folha de agente — não pode arrastar o
 * renderizador de Markdown, que registra as linguagens do highlight.js ao
 * carregar e por isso não sai na poda do bundler.
 */

const TAMANHO_AVATAR = {
  p: "size-7 rounded-full [&>svg]:size-3.5",
  g: "size-14 rounded-dialogo shadow-brilho-ia [&>svg]:size-7",
} as const;

/**
 * Quem responde quando não há agente: a faísca no gradiente da IA. Decorativo —
 * o nome de quem fala vem do contexto (o agente, quando há, se anuncia pelo
 * `AvatarAgente rotulado`).
 */
export function AvatarIA({ tamanho = "p" }: { tamanho?: keyof typeof TAMANHO_AVATAR }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-linear-to-br from-accent-500
                  to-ia-500 text-white shadow-e1 ${TAMANHO_AVATAR[tamanho]}`}
    >
      <IconeAssistente />
    </span>
  );
}
