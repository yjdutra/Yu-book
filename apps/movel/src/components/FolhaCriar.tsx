import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { Etiqueta } from "@yu-book/cliente/base/Etiqueta";
import { IconeCalendario, IconeTarefa } from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import type { ReactElement } from "react";
import { Alca } from "./Alca";

function Opcao({
  Icone,
  tom,
  titulo,
  detalhe,
}: {
  Icone: (p: IconeProps) => ReactElement;
  /** Classe que declara `--tom`, o token de cor do ícone e do fundo. */
  tom: string;
  titulo: string;
  detalhe: string;
}) {
  // Desabilitado e dito por extenso: o "Em breve" está no nome do botão, não
  // só no esmaecido (RNF-09).
  return (
    <li>
      <button
        type="button"
        disabled
        className={`cartao-pastel ${tom} flex min-h-16 w-full items-center gap-3 rounded-cartao
                    px-4 py-3 text-left disabled:cursor-not-allowed`}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-(--tom) text-white">
          <Icone className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium text-titulo">{titulo}</span>
          <span className="block text-sm text-ink-400">{detalhe}</span>
        </span>
        <Etiqueta>Em breve</Etiqueta>
      </button>
    </li>
  );
}

/**
 * A folha do "+". Nesta etapa só anuncia o que vem — criar evento e tarefa é
 * da etapa da agenda, que a preenche.
 */
export function FolhaCriar({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  return (
    <Dialogo aberto={aberta} onFechar={onFechar} rotulo="Criar" posicao="folha">
      <div className="px-5 pb-5 pt-3">
        <Alca />
        <h2 className="mt-3 text-lg font-semibold text-titulo">Criar</h2>
        <ul className="mt-4 space-y-2">
          <Opcao
            Icone={IconeCalendario}
            tom="[--tom:var(--color-agente-azul)]"
            titulo="Novo evento"
            detalhe="Um compromisso com dia e hora"
          />
          <Opcao
            Icone={IconeTarefa}
            tom="[--tom:var(--color-agente-verde)]"
            titulo="Nova tarefa"
            detalhe="Algo a fazer, com ou sem data"
          />
        </ul>
        <Botao variante="secundario" tamanho="g" onClick={onFechar} className="mt-5 w-full">
          Fechar
        </Botao>
      </div>
    </Dialogo>
  );
}
