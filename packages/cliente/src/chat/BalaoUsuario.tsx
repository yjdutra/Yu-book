import { Etiqueta } from "../base/Etiqueta";

/**
 * A pergunta de quem usa: à direita, num balão tingido do acento — o único
 * balão da conversa; a resposta não tem caixa. O canto de baixo, do lado de
 * quem fala, é o menor: aponta para a origem.
 *
 * Os anexos (o que foi junto como contexto) vão em pílulas acima, na ordem em
 * que foram anexados.
 */
export function BalaoUsuario({
  texto,
  anexos = [],
}: {
  texto: string;
  anexos?: { chave: string; titulo: string }[];
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {anexos.length > 0 && (
        <ul
          aria-label="Anexado ao contexto"
          className="flex max-w-[85%] flex-wrap justify-end gap-1"
        >
          {anexos.map((a) => (
            <li key={a.chave} className="max-w-full">
              <Etiqueta tom="destaque">{a.titulo}</Etiqueta>
            </li>
          ))}
        </ul>
      )}
      <p
        className="max-w-[85%] whitespace-pre-wrap break-words rounded-dialogo
                   rounded-br-etiqueta border border-accent-500/20 bg-accent-500/12 px-4 py-2.5
                   text-[0.9375rem] leading-relaxed text-ink-200"
      >
        {texto}
      </p>
    </div>
  );
}
