const ATALHOS: { grupo: string; tecla: string; descricao: string }[] = [
  { grupo: "Geral", tecla: "Ctrl+K", descricao: "Buscar em notas e cards" },
  { grupo: "Geral", tecla: "Ctrl+N", descricao: "Nova nota" },
  { grupo: "Geral", tecla: "Ctrl+Shift+B", descricao: "Ir para os boards" },
  { grupo: "Geral", tecla: "Ctrl+Shift+L", descricao: "Abrir a gaveta de links" },
  { grupo: "Geral", tecla: "Ctrl+/", descricao: "Mostrar/esconder esta lista" },
  { grupo: "Geral", tecla: "Esc", descricao: "Fechar o que estiver aberto" },

  { grupo: "Nota", tecla: "Ctrl+S", descricao: "Salvar agora (sem esperar o autosave)" },
  { grupo: "Nota", tecla: "Ctrl+B", descricao: "Negrito" },
  { grupo: "Nota", tecla: "Ctrl+I", descricao: "Itálico" },
  { grupo: "Nota", tecla: "Ctrl+K", descricao: "Link (dentro do editor)" },
  { grupo: "Nota", tecla: "Ctrl+`", descricao: "Código" },
  { grupo: "Nota", tecla: "[[", descricao: "Vincular a outra nota" },
  { grupo: "Nota", tecla: "Enter", descricao: "Do título, pular para o corpo" },

  { grupo: "Board", tecla: "N", descricao: "Novo card na coluna com foco" },
  { grupo: "Board", tecla: "Espaço", descricao: "Pegar e soltar o card com foco" },
  { grupo: "Board", tecla: "↑ ↓ ← →", descricao: "Mover o card pego entre posições e colunas" },
  { grupo: "Board", tecla: "Esc", descricao: "Cancelar o movimento e devolver o card" },
  { grupo: "Board", tecla: "Enter", descricao: "Abrir o card" },

  { grupo: "Links", tecla: "arrastar", descricao: "Solte um link em qualquer lugar da janela" },
  { grupo: "Links", tecla: "← →", descricao: "Trocar entre favoritos e ver depois" },
  { grupo: "Links", tecla: "Enter", descricao: "Abrir o link em nova aba" },
  { grupo: "Links", tecla: "Del", descricao: "Remover o link com foco" },
  { grupo: "Links", tecla: "Ctrl+V", descricao: "Colar uma URL na aba visível" },
];

const GRUPOS = ["Geral", "Nota", "Board", "Links"] as const;

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
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-ink-700
                   bg-ink-800 p-5 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-white">Atalhos</h2>
        {GRUPOS.map((grupo) => (
          <section key={grupo}>
            <h3 className="mt-4 text-[10px] font-medium uppercase tracking-wider text-ink-400">
              {grupo}
            </h3>
            <dl className="mt-2 space-y-2">
              {ATALHOS.filter((a) => a.grupo === grupo).map((a) => (
                <div key={`${a.tecla}-${a.descricao}`} className="flex items-baseline gap-3">
                  <dt className="w-24 shrink-0">
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
          </section>
        ))}
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
