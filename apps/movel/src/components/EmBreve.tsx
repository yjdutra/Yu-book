import { Etiqueta } from "@yu-book/cliente/base/Etiqueta";
import type { IconeProps } from "@yu-book/cliente/icones";
import { useId } from "react";
import type { ReactElement } from "react";

/**
 * O estado vazio das áreas que ainda não têm conteúdo no móvel (agenda e
 * tarefas chegam na etapa seguinte; o chat, na outra). Diz o que vai morar
 * ali, em vez de uma tela em branco.
 */
export function EmBreve({
  Icone,
  tom,
  titulo,
  texto,
}: {
  Icone: (p: IconeProps) => ReactElement;
  /** Classe que declara `--tom`, o token de cor do ícone e do halo. */
  tom: string;
  titulo: string;
  texto: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col items-center px-4 pt-8 text-center">
      <span
        aria-hidden="true"
        className={`cartao-pastel ${tom} flex size-28 items-center justify-center rounded-full
                    shadow-e2`}
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-(--tom) text-white shadow-e2">
          <Icone className="size-7" />
        </span>
      </span>
      <h2 id={id} className="mt-7 text-xl font-semibold tracking-tight text-titulo">
        {titulo}
      </h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-400">{texto}</p>
      <p className="mt-5">
        <Etiqueta tom="destaque">Em breve</Etiqueta>
      </p>
    </section>
  );
}
