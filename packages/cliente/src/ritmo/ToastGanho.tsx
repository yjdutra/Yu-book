import { useEffect } from "react";

/** O que o toast diz (RF-27). */
export interface AvisoDeGanho {
  /** Muda a cada ganho: o mesmo texto duas vezes seguidas ainda reinicia o tempo. */
  id: number;
  /** "+30", ou "✓" no gesto que não dá pontos. */
  ganho: string;
  /** "Inglês · 110 de 120". */
  titulo: string;
  /** O próximo passo: "Falta 1 dia para a meta". */
  detalhe: string;
}

/// RF-27: some sozinho em 2,6 s.
const DURACAO_MS = 2600;

/**
 * O toast de pontos (frente Ritmo, RF-27): sobe do pé da tela, acima da barra
 * do móvel (`--altura-barra`, que o web não tem — vale 0 lá), e some em 2,6 s.
 * `role="status"`: o leitor de tela lê o ganho e o próximo passo sem tirar o
 * foco de onde está. O número do ganho é `chama-300`, texto que passa 4,5:1
 * sobre `superficie` nos dois temas.
 */
export function ToastGanho({
  aviso,
  onSumir,
}: {
  aviso: AvisoDeGanho | null;
  onSumir: () => void;
}) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onSumir, DURACAO_MS);
    return () => clearTimeout(t);
  }, [aviso, onSumir]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-(--z-toast) mx-auto flex max-w-md px-4
                 bottom-[calc(var(--altura-barra,0px)+env(safe-area-inset-bottom)+0.75rem)]
                 lg:bottom-6"
    >
      <div role="status" className="w-full">
        {aviso && (
          <div
            key={aviso.id}
            className="flex items-center gap-3 rounded-cartao border border-ink-700/70
                       bg-superficie px-4 py-3 shadow-e3 animate-subir"
          >
            <span className="text-xl font-extrabold tabular-nums text-chama-300">
              {aviso.ganho}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-titulo">{aviso.titulo}</span>
              <span className="block truncate text-xs text-ink-400">{aviso.detalhe}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
