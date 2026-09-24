/**
 * Combinação de teclas como `<kbd>` separados — "Ctrl+Shift+Y" vira três
 * teclas. O `+` sozinho (a tecla, não o separador) sobrevive: só se parte
 * onde há texto dos dois lados.
 */
export function Tecla({ combo }: { combo: string }) {
  const partes = combo.split(/(?<=.)\+(?=.)/);
  return (
    <span className="inline-flex items-center gap-0.5">
      {partes.map((p, i) => (
        <kbd
          key={i}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-etiqueta border
                     border-ink-700 bg-ink-900 px-1 font-mono text-miudo text-ink-200 shadow-e1"
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}
