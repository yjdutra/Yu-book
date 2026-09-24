import { NOTE_KINDS } from "@yu-book/shared";
import type { NoteKind } from "@yu-book/shared";
import { useFiltrosDaUrl } from "../../../lib/filtrosUrl";
import type { FiltrosDaUrl } from "../../../lib/filtrosUrl";
import { useContadores, useTags } from "../../../lib/notas";
import { useWorkspaceAtivo } from "../../../lib/workspace";
import { Botao } from "../../base/Botao";
import { ICONE_TIPO, IconeEstrela, IconeLixeira, IconeMais, IconeNotas } from "../../Icones";
import { CartaoTags, Item, Secao } from "../partes";

/** Área Notas: os filtros da lista, que agora moram na URL. */
export function ContextoNotas({ onNovaNota }: { onNovaNota: () => void }) {
  const { ativoId } = useWorkspaceAtivo();
  const { data: contadores } = useContadores(ativoId);
  const { data: tags } = useTags();
  const [filtros, definir] = useFiltrosDaUrl();

  /** Um recorte por vez, como antes: escolher um apaga os outros. A ordem e a busca ficam. */
  const aplicar = (extra: Partial<FiltrosDaUrl>) =>
    definir({ kind: null, favorite: false, trash: false, tags: [], ...extra });

  const nenhumFiltro =
    !filtros.kind && !filtros.favorite && !filtros.trash && filtros.tags.length === 0;
  const IconeTipoAtivo = filtros.kind ? ICONE_TIPO[filtros.kind] : null;

  return (
    <div className="flex min-h-full flex-col">
      <Botao variante="primario" tamanho="m" icone={<IconeMais />} onClick={onNovaNota}>
        Nova nota
      </Botao>

      <div className="mt-3 space-y-0.5">
        <Item ativo={nenhumFiltro} onClick={() => aplicar({})} contagem={contadores?.total}>
          <IconeNotas />
          Todas as notas
        </Item>
        <Item
          ativo={filtros.favorite}
          onClick={() => aplicar({ favorite: true })}
          contagem={contadores?.favorites}
        >
          <IconeEstrela />
          Favoritas
        </Item>
      </div>

      <Secao
        titulo="Tipos"
        chave="tipos"
        resumo={
          IconeTipoAtivo && (
            <span
              className="flex items-center gap-1 text-accent-400"
              title={`Filtrando: ${filtros.kind}`}
            >
              <IconeTipoAtivo className="size-3" />
              <span className="normal-case tracking-normal">{filtros.kind}</span>
            </span>
          )
        }
      >
        {NOTE_KINDS.map((tipo: NoteKind) => {
          const IconeDoTipo = ICONE_TIPO[tipo];
          return (
            <Item
              key={tipo}
              ativo={filtros.kind === tipo}
              onClick={() => aplicar({ kind: tipo })}
              contagem={contadores?.byKind[tipo]}
            >
              <IconeDoTipo />
              <span className="capitalize">{tipo}</span>
            </Item>
          );
        })}
      </Secao>

      {tags && tags.length > 0 && (
        /* As tags são muitas e sem ordem fixa: viram um cartão à parte, que se
           fecha inteiro quando o que importa na tela é outra coisa. */
        <div className="mt-4 rounded-cartao border border-ink-800 bg-ink-800/30">
          <CartaoTags
            tags={tags}
            ativas={filtros.tags}
            quantidadeAtiva={filtros.tags.length}
            onAlternarTag={(nome) =>
              definir({
                trash: false,
                tags: filtros.tags.includes(nome)
                  ? filtros.tags.filter((n) => n !== nome)
                  : [...filtros.tags, nome],
              })
            }
          />
        </div>
      )}

      <div className="mt-auto pt-4">
        <Item
          ativo={filtros.trash}
          onClick={() => aplicar({ trash: true })}
          contagem={contadores?.trash}
        >
          <IconeLixeira />
          Lixeira
        </Item>
      </div>
    </div>
  );
}
