import type { Conversation } from "@yu-book/shared";
import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { useExcluirConversa, useRenomearConversa } from "@yu-book/cliente/chat";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useFolhaNoHistorico } from "../../lib/historico";
import { Alca } from "../Alca";

/**
 * Renomear e excluir uma conversa, numa folha: o lápis e o "×" da lista do web
 * têm 20px, e no toque viram alvos de 48px aqui. Excluir pergunta antes, na
 * própria folha — sem diálogo aninhado, como a guarda do formulário de item.
 *
 * Montada com a prop viva (`conversa` nula fecha), e o conteúdo nasce de novo
 * a cada abertura.
 */
export function FolhaConversa({
  conversa,
  onFechar,
  onExcluida,
}: {
  conversa: Conversation | null;
  onFechar: () => void;
  /** Depois de excluir: a linha sumiu, e quem chama decide onde o foco cai. */
  onExcluida: () => void;
}) {
  useFolhaNoHistorico(conversa !== null, onFechar);
  return (
    <Dialogo
      aberto={conversa !== null}
      onFechar={onFechar}
      rotulo="Conversa"
      posicao="folha"
      largura="max-w-lg"
    >
      {conversa && (
        <Conteudo
          key={conversa.id}
          conversa={conversa}
          onFechar={onFechar}
          onExcluida={onExcluida}
        />
      )}
    </Dialogo>
  );
}

function Conteudo({
  conversa,
  onFechar,
  onExcluida,
}: {
  conversa: Conversation;
  onFechar: () => void;
  onExcluida: () => void;
}) {
  const renomear = useRenomearConversa();
  const excluir = useExcluirConversa();
  const [titulo, setTitulo] = useState(conversa.title);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idCampo = useId();
  const idExcluir = useId();

  function salvar(e: FormEvent) {
    e.preventDefault();
    const title = titulo.trim();
    if (!title || title === conversa.title) {
      onFechar();
      return;
    }
    setErro(null);
    renomear.mutate(
      { id: conversa.id, title },
      {
        onSuccess: onFechar,
        onError: (falha) =>
          setErro(falha instanceof ApiError ? falha.message : "Não foi possível renomear."),
      },
    );
  }

  function confirmarExclusao() {
    setErro(null);
    excluir.mutate(conversa.id, {
      onSuccess: () => {
        onFechar();
        onExcluida();
      },
      onError: (falha) =>
        setErro(falha instanceof ApiError ? falha.message : "Não foi possível excluir."),
    });
  }

  return (
    <div className="px-5 pb-5 pt-3">
      <Alca />
      <form onSubmit={salvar} className="mt-4">
        <label htmlFor={idCampo} className="rotulo">
          Nome da conversa
        </label>
        <input
          id={idCampo}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          // Sem `maxLength`: o limite (`MAX_TITULO_CONVERSA`) é valor de
          // `shared/chat.ts`, que traria os schemas do chat ao bundle desta
          // tela. O servidor recusa com 422, e a mensagem aparece aqui.
          className="mt-1.5 h-12 w-full rounded-controle border border-ink-700 bg-ink-900 px-3
                     text-base text-ink-200 outline-none transition-colors
                     focus:border-accent-400"
        />
        <Botao
          type="submit"
          variante="primario"
          tamanho="g"
          className="mt-3 w-full"
          carregando={renomear.isPending}
        >
          Salvar o nome
        </Botao>
      </form>

      <div className="mt-6 border-t border-ink-800 pt-5">
        {confirmando ? (
          <div role="group" aria-label="Confirmar exclusão">
            <p className="text-sm text-ink-200">
              Excluir «{conversa.title}» de vez? As mensagens somem; o que o chat criou no
              acervo e na agenda fica.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Botao
                variante="secundario"
                tamanho="g"
                onClick={() => {
                  setConfirmando(false);
                  // O botão que tinha o foco sumiu: ele volta a "Excluir a conversa".
                  requestAnimationFrame(() => document.getElementById(idExcluir)?.focus());
                }}
              >
                Manter
              </Botao>
              <Botao
                variante="perigo"
                tamanho="g"
                carregando={excluir.isPending}
                onClick={confirmarExclusao}
              >
                Excluir
              </Botao>
            </div>
          </div>
        ) : (
          <Botao
            id={idExcluir}
            variante="perigo"
            tamanho="g"
            className="w-full"
            onClick={() => setConfirmando(true)}
          >
            Excluir a conversa
          </Botao>
        )}
      </div>

      {erro && (
        <Aviso tom="erro" onFechar={() => setErro(null)} className="mt-4">
          {erro}
        </Aviso>
      )}

      <Botao variante="secundario" tamanho="g" className="mt-5 w-full" onClick={onFechar}>
        Fechar
      </Botao>
    </div>
  );
}
