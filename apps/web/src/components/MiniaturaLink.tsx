import type { Link } from "@yu-book/shared";
import { formatarDuracao, idDoYoutube, thumbnailDoYoutube } from "@yu-book/shared";
import { BlocoDominio } from "./BlocoDominio";

/**
 * A cara de um link numa lista.
 *
 * Vídeo do YouTube mostra a miniatura, porque numa fila de "ver depois" o que
 * você reconhece é a imagem, não o domínio. Qualquer outro link continua com o
 * bloco da inicial do domínio (RF-12 da Fase 3).
 *
 * A imagem vem de `i.ytimg.com` — é uma requisição a um terceiro, e por isso
 * vale dizer o que ela revela: o Google fica sabendo que **aquele vídeo
 * específico** foi exibido, e só quando a lista está aberta. É bem menos do que
 * o serviço de favicon entregaria (a lista inteira de domínios que você salva),
 * que foi justamente o motivo de ele ter sido recusado na Fase 3.
 */
type LinkExibivel = Pick<Link, "url" | "domain" | "durationSeconds">;

export function MiniaturaLink({
  link,
  tamanho = "sm",
}: {
  link: LinkExibivel;
  tamanho?: "sm" | "md";
}) {
  const id = idDoYoutube(link.url);
  if (!id) return <BlocoDominio domain={link.domain} tamanho={tamanho} />;

  return (
    <span
      className={`relative shrink-0 overflow-hidden rounded border border-ink-700 bg-ink-900 ${
        tamanho === "md" ? "w-28" : "w-20"
      }`}
    >
      <img
        src={thumbnailDoYoutube(id)}
        alt=""
        loading="lazy"
        // A miniatura do YouTube é 16:9 com barras; o recorte tira as barras.
        className="aspect-video w-full object-cover"
        // Vídeo removido ou id estranho: some a imagem em vez de mostrar
        // o ícone de imagem quebrada.
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      {link.durationSeconds !== null && (
        <span
          className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-miudo
                     font-medium tabular-nums text-white"
        >
          {formatarDuracao(link.durationSeconds)}
        </span>
      )}
    </span>
  );
}
