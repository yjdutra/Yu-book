import { useTema } from "../lib/tema";

const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Sol() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" {...TRACO}>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
    </svg>
  );
}

function Lua() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" {...TRACO}>
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
    </svg>
  );
}

/** RF-22: a troca de tema mora no rodapé da navegação, junto do usuário. */
export function SeletorTema() {
  const [tema, setTema] = useTema();
  const claro = tema === "claro";

  return (
    <button
      type="button"
      onClick={() => setTema(claro ? "escuro" : "claro")}
      aria-pressed={claro}
      title={claro ? "Mudar para o tema escuro" : "Mudar para o tema claro"}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-400
                 transition hover:bg-ink-800 hover:text-ink-200"
    >
      {claro ? <Lua /> : <Sol />}
      <span className="sr-only">
        {claro ? "Mudar para o tema escuro" : "Mudar para o tema claro"}
      </span>
    </button>
  );
}
