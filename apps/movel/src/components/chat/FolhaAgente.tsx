import type { AgentSummary } from "@yu-book/shared";
import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { AvatarAgente } from "@yu-book/cliente/chat/AvatarAgente";
import { AvatarIA } from "@yu-book/cliente/chat/AvatarIA";
import { IconeCheck } from "@yu-book/cliente/icones";
import type { ReactNode } from "react";
import { useFolhaNoHistorico } from "../../lib/historico";
import { Alca } from "../Alca";

/**
 * "Conversar com…" no móvel: a escolha do agente da conversa nova, numa folha
 * — o menu do web tem item de 32px, abaixo do alvo de toque. Só existe na
 * conversa vazia: depois de criada, o agente é o dela e não se troca (Etapa D).
 *
 * O escolhido tem forma além da cor: o check e `aria-pressed`.
 */
export function FolhaAgente({
  aberta,
  agentes,
  escolhido,
  onEscolher,
  onFechar,
}: {
  aberta: boolean;
  agentes: AgentSummary[];
  escolhido: string | null;
  onEscolher: (id: string | null) => void;
  onFechar: () => void;
}) {
  useFolhaNoHistorico(aberta, onFechar);

  const opcoes: { id: string | null; nome: string; descricao: string; avatar: ReactNode }[] = [
    {
      id: null,
      nome: "Assistente",
      descricao: "O de sempre: procura no acervo e anota na agenda.",
      avatar: <AvatarIA />,
    },
    ...agentes.map((a) => ({
      id: a.id,
      nome: a.name,
      descricao: a.description,
      avatar: <AvatarAgente nome={a.name} cor={a.color} tamanho="g" />,
    })),
  ];

  return (
    <Dialogo aberto={aberta} onFechar={onFechar} rotulo="Conversar com" posicao="folha">
      <div className="px-5 pb-5 pt-3">
        <Alca />
        <h2 className="mt-4 text-base font-semibold text-titulo">Conversar com</h2>
        <p className="mt-1 text-sm text-ink-400">
          O agente fica fixo na conversa. Agentes se criam no computador.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-1">
          {opcoes.map((o) => {
            const ativo = o.id === escolhido;
            return (
              <li key={o.id ?? "assistente"} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => {
                    onEscolher(o.id);
                    onFechar();
                  }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-cartao px-3 py-2
                              text-left transition-colors ${
                                ativo ? "bg-accent-500/12" : "active:bg-ink-800"
                              }`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center">
                    {o.avatar}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-200">
                      {o.nome}
                    </span>
                    {o.descricao && (
                      <span className="block truncate text-xs text-ink-400">{o.descricao}</span>
                    )}
                  </span>
                  {ativo && <IconeCheck className="size-5 text-accent-400" />}
                </button>
              </li>
            );
          })}
        </ul>
        <Botao variante="secundario" tamanho="g" className="mt-5 w-full" onClick={onFechar}>
          Fechar
        </Botao>
      </div>
    </Dialogo>
  );
}
