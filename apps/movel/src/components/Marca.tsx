/**
 * A marca do Yu-book — o mesmo desenho do favicon e dos ícones da PWA, com o
 * fundo no acento do tema em vez da cor fixa do arquivo. Enfeite: o nome vem
 * sempre escrito ao lado.
 */
export function Marca({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="32" height="32" rx="7" className="fill-accent-500" />
      <path d="M9 9h5l2 6 2-6h5L18 20v4h-4v-4z" fill="white" />
    </svg>
  );
}
