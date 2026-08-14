const ATALHOS: { tecla: string; descricao: string }[] = [
  { tecla: "Ctrl+K", descricao: "Buscar em todas as notas" },
  { tecla: "Ctrl+N", descricao: "Nova nota" },
  { tecla: "Ctrl+S", descricao: "Salvar agora (sem esperar o autosave)" },
  { tecla: "Ctrl+B", descricao: "Negrito" },
  { tecla: "Ctrl+I", descricao: "Itálico" },
  { tecla: "Ctrl+K", descricao: "Link (dentro do editor)" },
  { tecla: "Ctrl+`", descricao: "Código" },
  { tecla: "[[", descricao: "Vincular a outra nota" },
  { tecla: "Enter", descricao: "Do título, pular para o corpo" },
  { tecla: "Ctrl+/", descricao: "Mostrar/esconder esta lista" },
  { tecla: "Esc", descricao: "Fechar o que estiver aberto" },
];

export function Atalhos({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Atalhos de teclado"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 p-5 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-white">Atalhos</h2>
        <dl className="mt-4 space-y-2">
          {ATALHOS.map((a) => (
            <div key={`${a.tecla}-${a.descricao}`} className="flex items-baseline gap-3">
              <dt className="w-20 shrink-0">
                <kbd
                  className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono
                             text-[11px] text-ink-200"
                >
                  {a.tecla}
                </kbd>
              </dt>
              <dd className="text-sm text-ink-400">{a.descricao}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onFechar}
          className="mt-5 w-full rounded border border-ink-700 py-1.5 text-xs text-ink-400
                     hover:border-ink-400 hover:text-ink-200"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
