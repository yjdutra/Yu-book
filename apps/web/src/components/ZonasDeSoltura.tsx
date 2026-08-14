import type { LinkKind } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";

/** O tipo que o navegador usa quando o que se arrasta é um link de verdade. */
const TIPO_URL = "text/uri-list";

/**
 * `text/uri-list` pode trazer várias linhas e comentários; a primeira linha
 * útil é o link. Se só houver `text/plain`, ele costuma ser a própria URL.
 */
function urlDoArrasto(dados: DataTransfer): string | null {
  const lista = dados.getData(TIPO_URL);
  const bruto = lista || dados.getData("text/plain");
  const linha = bruto
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return linha ?? null;
}

interface ZonasDeSolturaProps {
  onSoltar: (url: string, kind: LinkKind) => void;
}

/**
 * RF-01: arrastar um link para **qualquer ponto** da janela revela as duas
 * zonas. Exigir que a gaveta estivesse aberta antes mataria a funcionalidade
 * — guardar um link é sempre interrupção de outra coisa.
 */
export function ZonasDeSoltura({ onSoltar }: ZonasDeSolturaProps) {
  const [visivel, setVisivel] = useState(false);
  // dragenter/dragleave disparam de novo a cada elemento filho: sem contar as
  // entradas, a sobreposição piscaria ao atravessar a página.
  const profundidade = useRef(0);

  useEffect(() => {
    // RF-02: só link. Arrastar texto de uma nota (só `text/plain`) ou um card
    // do kanban (que usa eventos de ponteiro, não de arrasto) não invoca nada.
    const ehLink = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(TIPO_URL);

    function entrou(e: DragEvent) {
      if (!ehLink(e)) return;
      profundidade.current += 1;
      setVisivel(true);
    }
    function saiu() {
      profundidade.current = Math.max(0, profundidade.current - 1);
      if (profundidade.current === 0) setVisivel(false);
    }
    function sobre(e: DragEvent) {
      if (ehLink(e)) e.preventDefault(); // sem isto o navegador recusa a soltura
    }
    function encerrou() {
      profundidade.current = 0;
      setVisivel(false);
    }
    function escapou(e: KeyboardEvent) {
      if (e.key === "Escape") encerrou();
    }

    window.addEventListener("dragenter", entrou);
    window.addEventListener("dragleave", saiu);
    window.addEventListener("dragover", sobre);
    window.addEventListener("drop", encerrou);
    window.addEventListener("dragend", encerrou);
    window.addEventListener("keydown", escapou);

    return () => {
      window.removeEventListener("dragenter", entrou);
      window.removeEventListener("dragleave", saiu);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("drop", encerrou);
      window.removeEventListener("dragend", encerrou);
      window.removeEventListener("keydown", escapou);
    };
  }, []);

  if (!visivel) return null;

  function soltar(e: React.DragEvent, kind: LinkKind) {
    e.preventDefault();
    e.stopPropagation();
    profundidade.current = 0;
    setVisivel(false);

    const url = e.dataTransfer && urlDoArrasto(e.dataTransfer);
    if (url) onSoltar(url, kind);
  }

  const zona = (kind: LinkKind, titulo: string, sub: string, icone: string) => (
    <button
      type="button"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => soltar(e, kind)}
      className="group flex w-full items-center gap-4 rounded-xl border-2 border-dashed
                 border-ink-700 bg-ink-900/90 px-6 py-8 text-left transition
                 hover:border-accent-400 hover:bg-ink-800"
    >
      <span aria-hidden="true" className="text-2xl text-ink-400 group-hover:text-accent-400">
        {icone}
      </span>
      <span>
        <span className="block text-base font-medium text-white">{titulo}</span>
        <span className="block text-xs text-ink-400">{sub}</span>
      </span>
    </button>
  );

  return (
    <div
      // Cobre a janela inteira: durante o arrasto, nada mais é alvo.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-12"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // RF-04: soltar fora das zonas cancela, sem salvar.
        e.preventDefault();
        profundidade.current = 0;
        setVisivel(false);
      }}
    >
      <div className="w-full max-w-lg space-y-3">
        {zona("favorito", "Favoritos", "sites que você abre sempre", "★")}
        {zona("depois", "Ver depois", "para consumir e apagar", "◷")}
        <p className="pt-1 text-center text-xs text-ink-400">solte para salvar · esc cancela</p>
      </div>
    </div>
  );
}
