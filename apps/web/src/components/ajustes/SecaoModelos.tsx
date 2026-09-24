import { CatalogoModelos } from "./CatalogoModelos";
import { QuadroDeModelos } from "./QuadroDeModelos";

/** Modelos: primeiro o catálogo de onde se favorita, depois a escolha por tarefa. */
export function SecaoModelos({ onErro }: { onErro: (mensagem: string | null) => void }) {
  return (
    <>
      {/* Fora de um `Bloco` de propósito: a barra de filtros é `sticky`, e o
          `overflow-hidden` do cartão a prenderia. */}
      <section aria-labelledby="titulo-catalogo">
        <h3 id="titulo-catalogo" className="mb-3 text-sm font-semibold text-titulo">
          Catálogo do provedor
        </h3>
        <CatalogoModelos onErro={onErro} />
      </section>

      <section aria-labelledby="titulo-tarefas" className="mt-8">
        <h3 id="titulo-tarefas" className="mb-3 text-sm font-semibold text-titulo">
          Modelo de cada tarefa
        </h3>
        <QuadroDeModelos onErro={onErro} />
      </section>
    </>
  );
}
