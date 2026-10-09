import type { Conversation } from "@yu-book/shared";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Esqueleto } from "@yu-book/cliente/base/Bloco";
import { agruparConversas, useConversas } from "@yu-book/cliente/chat";
import { AvatarAgente } from "@yu-book/cliente/chat/AvatarAgente";
import { AvatarIA } from "@yu-book/cliente/chat/AvatarIA";
import { IconeMais, IconeOpcoes } from "@yu-book/cliente/icones";
import { useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FolhaConversa } from "../components/chat/FolhaConversa";

/**
 * A área Assistente do móvel (Fase 5 da frente de agenda): a lista de
 * conversas, agrupada como no web — Hoje, Últimos 7 dias, Antes —, e "Nova
 * conversa" no alto. Tocar numa conversa abre `/assistente/:id` em tela cheia;
 * renomear e excluir moram numa folha, pelo botão de opções de cada linha.
 */
export function AssistentePage() {
  const { data: conversas, isLoading, error } = useConversas();
  const [alvo, setAlvo] = useState<Conversation | null>(null);
  const nova = useRef<HTMLAnchorElement>(null);

  return (
    <div className="pb-4">
      <Link
        ref={nova}
        to="/assistente/nova"
        className="flex h-14 w-full items-center justify-center gap-2 rounded-full
                   bg-linear-to-r from-accent-500 to-ia-500 text-base font-semibold text-white
                   shadow-e2 transition duration-150 ease-(--ease-padrao) active:scale-[0.98]
                   hover:shadow-brilho-ia"
      >
        <IconeMais className="size-5" />
        Nova conversa
      </Link>

      {isLoading && (
        <div className="mt-8">
          <Esqueleto linhas={4} alturaLinha={56} />
        </div>
      )}
      {error && (
        <Aviso tom="erro" className="mt-6">
          Não foi possível carregar as conversas.
        </Aviso>
      )}
      {conversas?.length === 0 && (
        <p className="mt-10 text-center text-sm text-ink-400">
          Nenhuma conversa ainda. Pergunte sobre o seu acervo, ou peça para marcar um
          compromisso.
        </p>
      )}

      {agruparConversas(conversas ?? []).map(([titulo, lista]) => (
        <Grupo key={titulo} titulo={titulo} lista={lista} onOpcoes={setAlvo} />
      ))}

      <FolhaConversa
        conversa={alvo}
        onFechar={() => setAlvo(null)}
        // A linha com o botão que tinha o foco sumiu: ele vai a "Nova conversa".
        onExcluida={() => requestAnimationFrame(() => nova.current?.focus())}
      />
    </div>
  );
}

function Grupo({
  titulo,
  lista,
  onOpcoes,
}: {
  titulo: string;
  lista: Conversation[];
  onOpcoes: (c: Conversation) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-7">
      <h2 id={id} className="rotulo px-1">
        {titulo}
      </h2>
      <ul
        className="mt-2 divide-y divide-ink-800/70 overflow-hidden rounded-cartao border
                   border-ink-800/70 bg-superficie shadow-e1"
      >
        {lista.map((c) => (
          <li key={c.id} className="flex items-center">
            <Link
              to={`/assistente/${c.id}`}
              className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-2
                         transition-colors active:bg-ink-800"
            >
              {c.agent ? (
                <AvatarAgente
                  nome={c.agent.name}
                  cor={c.agent.color}
                  tamanho="g"
                  excluido={c.agent.id === null}
                />
              ) : (
                <span className="flex size-9 items-center justify-center">
                  <AvatarIA />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-medium text-ink-200">
                  {c.title}
                </span>
                <span className="block truncate text-xs text-ink-400">
                  {c.agent ? `com ${c.agent.name}` : "Assistente"}
                  {c.agent && c.agent.id === null && " · agente excluído"}
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => onOpcoes(c)}
              aria-haspopup="dialog"
              aria-label={`Opções de «${c.title}»`}
              title="Renomear ou excluir"
              className="mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full
                         text-ink-400 transition-colors active:bg-ink-800 hover:text-ink-200"
            >
              <IconeOpcoes className="size-5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
