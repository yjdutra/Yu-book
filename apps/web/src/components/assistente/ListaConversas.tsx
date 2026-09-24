import type { Conversation } from "@yu-book/shared";
import { useRef, useState } from "react";
import { useConversas, useExcluirConversa, useRenomearConversa } from "../../lib/chat";
import { useSessaoChat } from "../../lib/sessaoChat";
import { IconeFechar, IconeLapis } from "../Icones";

const DIA = 24 * 60 * 60 * 1000;

/** Hoje, últimos 7 dias, antes — a mesma divisão de qualquer histórico de conversa. */
function agrupar(conversas: Conversation[]): [string, Conversation[]][] {
  const inicioDeHoje = new Date();
  inicioDeHoje.setHours(0, 0, 0, 0);
  const hoje = inicioDeHoje.getTime();

  const grupos: [string, Conversation[]][] = [
    ["Hoje", []],
    ["Últimos 7 dias", []],
    ["Antes", []],
  ];
  for (const c of conversas) {
    const quando = new Date(c.updatedAt).getTime();
    const grupo = quando >= hoje ? grupos[0] : quando >= hoje - 7 * DIA ? grupos[1] : grupos[2];
    grupo?.[1].push(c);
  }
  return grupos.filter(([, lista]) => lista.length > 0);
}

function Linha({
  conversa,
  ativa,
  onEscolher,
}: {
  conversa: Conversation;
  ativa: boolean;
  onEscolher: (id: string) => void;
}) {
  const renomear = useRenomearConversa();
  const excluir = useExcluirConversa();
  const { novaConversa } = useSessaoChat();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(conversa.title);
  const botao = useRef<HTMLButtonElement>(null);

  /// Sair da edição desmonta o campo que tinha o foco: ele volta à linha, e não
  /// ao `<body>` (RNF-06 da Fase 1).
  /// Enter e o blur que vem junto com a saída do campo chamariam `salvar` duas
  /// vezes — e renomeariam duas vezes. Só a primeira passa.
  const encerrado = useRef(false);
  function encerrar() {
    encerrado.current = true;
    setEditando(false);
    requestAnimationFrame(() => botao.current?.focus());
  }

  function salvar() {
    if (encerrado.current) return;
    const title = rascunho.trim();
    encerrar();
    if (title && title !== conversa.title) renomear.mutate({ id: conversa.id, title });
  }

  if (editando) {
    return (
      <input
        autoFocus
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar();
          if (e.key === "Escape") {
            // Esc aqui cancela a edição, e só ela — não fecha o painel.
            e.stopPropagation();
            setRascunho(conversa.title);
            encerrar();
          }
        }}
        aria-label="Novo nome da conversa"
        className="w-full rounded-controle bg-ink-800 px-2.5 py-1.5 text-sm text-ink-200
                   outline-none ring-1 ring-accent-400"
      />
    );
  }

  return (
    // As ações aparecem no hover **e no foco**: só no hover, ninguém chega
    // nelas pelo teclado (RF-24 da IA).
    <div className="group relative flex items-center">
      {ativa && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-400"
        />
      )}
      <button
        ref={botao}
        type="button"
        onClick={() => onEscolher(conversa.id)}
        aria-current={ativa ? "true" : undefined}
        className={`min-w-0 flex-1 truncate rounded-controle px-2.5 py-1.5 text-left text-sm
                    transition-colors ${
                      ativa
                        ? "bg-ink-800 text-titulo"
                        : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-200"
                    }`}
      >
        {conversa.title}
      </button>
      <div
        className="absolute right-1 flex opacity-0 transition-opacity group-hover:opacity-100
                   group-focus-within:opacity-100"
      >
        <button
          type="button"
          onClick={() => {
            setRascunho(conversa.title);
            encerrado.current = false;
            setEditando(true);
          }}
          aria-label={`Renomear a conversa ${conversa.title}`}
          title="Renomear"
          className="rounded-etiqueta bg-ink-800 p-1 text-ink-400 hover:text-ink-200"
        >
          <IconeLapis className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            excluir.mutate(conversa.id);
            if (ativa) novaConversa();
          }}
          aria-label={`Excluir a conversa ${conversa.title}`}
          title="Excluir"
          className="rounded-etiqueta bg-ink-800 p-1 text-ink-400 hover:text-red-300"
        >
          <IconeFechar className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** A lista de conversas, agrupada por quando foram mexidas pela última vez. */
export function ListaConversas({ onEscolher }: { onEscolher?: (id: string) => void }) {
  const { data: conversas } = useConversas();
  const { conversaId, selecionar } = useSessaoChat();

  if (conversas && conversas.length === 0) {
    return <p className="px-2.5 py-1 text-xs text-ink-400/70">Nenhuma conversa ainda.</p>;
  }

  return (
    <>
      {agrupar(conversas ?? []).map(([titulo, lista]) => (
        <section key={titulo} className="mt-4">
          <h3 className="rotulo mb-1 px-2.5">{titulo}</h3>
          <div className="space-y-0.5">
            {lista.map((c) => (
              <Linha
                key={c.id}
                conversa={c}
                ativa={c.id === conversaId}
                onEscolher={(id) => {
                  selecionar(id);
                  onEscolher?.(id);
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
