import { CARD_PRIORITIES, MAX_CHECKLIST_ITENS } from "@yu-book/shared";
import type { CardPriority, CardUpdateInput, ChecklistItem } from "@yu-book/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { useAtualizarCard, useBoard, useCard, useExcluirCard } from "../lib/kanban";
import { useCriarNota, useTitulos } from "../lib/notas";
import { catalogoDeTags } from "../lib/tags";
import { useAcoesChat } from "../lib/sessaoChat";
import { useAutosave } from "../lib/useAutosave";
import { Aviso } from "./base/Aviso";
import { Esqueleto } from "./base/Bloco";
import { Botao, BotaoIcone } from "./base/Botao";
import { AnexosDoCard } from "./AnexosDoCard";
import { CampoMarkdown } from "./CampoMarkdown";
import { IndicadorSalvamento } from "./base/IndicadorSalvamento";
import { IconeAssistente, IconeCheck, IconeChevron, IconeClipe, IconeFechar } from "./Icones";
import { RotuloTipo } from "./RotuloTipo";
import { SeletorDeTags } from "./SeletorDeTags";
import { FaixaIA, LinhaConclusao } from "./MarcaIA";

/** O `input type="date"` fala yyyy-mm-dd local; o banco fala ISO. */
function paraCampoData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Prazo é o fim do dia escolhido: antes disso, o card não está vencido. */
function paraData(valor: string): Date | null {
  if (!valor) return null;
  const d = new Date(`${valor}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ROTULO_PRIORIDADE: Record<CardPriority, string> = {
  baixa: "⬇ baixa",
  media: "= média",
  alta: "⬆ alta",
};

interface PainelCardProps {
  cardId: string;
  onFechar: () => void;
  onAbrirNota: (id: string) => void;
}

interface Rascunho {
  title: string;
  descriptionMd: string;
}

/** RF-27: painel à direita do board, sem modal e sem cobrir as colunas. */
export function PainelCard({ cardId, onFechar, onAbrirNota }: PainelCardProps) {
  const { data: card, isLoading } = useCard(cardId);
  const { abrirPainel } = useAcoesChat();
  // RNF-03: o board já está em cache (viemos dele) — as sugestões de tag saem
  // dos cards que ele trouxe, sem requisição nova.
  const { data: board } = useBoard(card?.boardId ?? null);
  const atualizar = useAtualizarCard();
  const excluir = useExcluirCard();
  const criarNota = useCriarNota();
  const { data: titulos } = useTitulos();

  const [rascunho, setRascunho] = useState<Rascunho>({ title: "", descriptionMd: "" });
  const [buscaNota, setBuscaNota] = useState("");
  const [novoItem, setNovoItem] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const carregadoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!card || carregadoRef.current === card.id) return;
    carregadoRef.current = card.id;
    setRascunho({ title: card.title, descriptionMd: card.descriptionMd });
    setBuscaNota("");
    setErro(null);
  }, [card]);

  const salvar = useCallback(
    async (valor: Rascunho) => {
      const title = valor.title.trim();
      await atualizar.mutateAsync({
        id: cardId,
        input: { ...(title && { title }), descriptionMd: valor.descriptionMd },
      });
    },
    [atualizar, cardId],
  );

  const iguais = useCallback(
    (a: Rascunho, b: Rascunho) => a.title === b.title && a.descriptionMd === b.descriptionMd,
    [],
  );

  // RF-29: mesmo comportamento da nota — 800 ms, Ctrl+S imediato, 3 tentativas.
  const { estado, salvarAgora } = useAutosave({ valor: rascunho, chave: cardId, salvar, iguais });


  const tagsDoBoard = useMemo(() => catalogoDeTags(board?.columns ?? []), [board]);

  const sugestoes = useMemo(() => {
    const termo = buscaNota.trim().toLowerCase();
    if (!termo) return [];
    return (titulos ?? []).filter((t) => t.title.toLowerCase().includes(termo)).slice(0, 6);
  }, [buscaNota, titulos]);

  if (isLoading || !card) {
    return (
      <div className="h-full pt-2" role="status" aria-label="Carregando card">
        <Esqueleto linhas={1} alturaLinha={28} />
        <Esqueleto linhas={4} alturaLinha={16} />
      </div>
    );
  }

  function aplicar(input: CardUpdateInput) {
    setErro(null);
    atualizar.mutate(
      { id: cardId, input },
      {
        onError: (e) =>
          setErro(e instanceof ApiError ? e.message : "Não foi possível salvar a alteração."),
      },
    );
  }

  const checklist = card.checklist;

  function mudarChecklist(itens: ChecklistItem[]) {
    aplicar({ checklist: itens });
  }

  function vincularNotaNova() {
    if (!card) return;
    setErro(null);
    criarNota.mutate(
      { title: rascunho.title.trim() || card.title },
      {
        onSuccess: (nota) => aplicar({ noteId: nota.id }),
        onError: (e) =>
          setErro(
            e instanceof ApiError && e.code === "TITULO_DUPLICADO"
              ? `${e.message} — vincule a existente pela busca acima.`
              : "Não foi possível criar a nota.",
          ),
      },
    );
  }

  const feitos = checklist.filter((i) => i.done).length;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      onKeyDown={(e) => {
        // `defaultPrevented`: o Esc já fechou um diálogo aberto daqui de dentro
        // (a imagem ampliada de um anexo) e não pode fechar o card junto.
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onFechar();
        }
      }}
    >
      <header className="shrink-0 border-b border-ink-800 px-4 pb-3 pt-4">
        <div className="flex items-start gap-2">
          <input
            value={rascunho.title}
            onChange={(e) => setRascunho((r) => ({ ...r, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key.toLowerCase() === "s") {
                e.preventDefault();
                salvarAgora();
              }
            }}
            aria-label="Título do card"
            // Sem anel: o título parece texto, e a linha de baixo é o foco visível.
            className="min-w-0 flex-1 border-b border-transparent bg-transparent text-base
                       font-semibold text-titulo outline-none focus:border-accent-400/60"
          />
          <BotaoIcone
            rotulo="Perguntar ao assistente sobre este card"
            // A cor vai no ícone: no botão, o `text-ink-400` da variante vence.
            icone={<IconeAssistente className="size-3.5 text-accent-400" />}
            onClick={() => abrirPainel({ anexo: { cardId, titulo: card.title } })}
          />
          <BotaoIcone
            rotulo="Fechar card"
            icone={<IconeFechar className="size-3.5" />}
            onClick={onFechar}
          />
        </div>

        <div className="mt-1 flex items-center gap-2">
          <span className="text-miudo text-ink-400">
            {card.boardName} · {card.columnName}
          </span>
          <span className="ml-auto">
            <IndicadorSalvamento estado={estado} />
          </span>
        </div>

        {/* Etapa C da frente de IA: o card que o assistente criou diz de onde veio. */}
        {card.ai && (
          <div className="mt-2">
            <FaixaIA marca={card.ai} />
          </div>
        )}

        {card.completedAt && (
          <div className="mt-2">
            <LinhaConclusao completedAt={card.completedAt} marca={card.aiCompletion} />
          </div>
        )}

        {erro && (
          <Aviso tom="erro" onFechar={() => setErro(null)} className="mt-2">
            {erro}
          </Aviso>
        )}
      </header>

      <div className="space-y-4 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-miudo text-ink-400">
            Prazo
            <input
              type="date"
              value={paraCampoData(card.dueDate)}
              onChange={(e) => aplicar({ dueDate: paraData(e.target.value) })}
              aria-label="Prazo do card"
              className="rounded-controle bg-ink-800 px-1.5 py-1 text-xs text-ink-200 outline-none
                         focus:ring-1 focus:ring-accent-400"
            />
          </label>

          <label className="flex items-center gap-1 text-miudo text-ink-400">
            Prioridade
            <select
              value={card.priority}
              onChange={(e) => aplicar({ priority: e.target.value as CardPriority })}
              aria-label="Prioridade do card"
              className="rounded-controle bg-ink-800 px-1.5 py-1 text-xs text-ink-200 outline-none
                         focus:ring-1 focus:ring-accent-400"
            >
              {CARD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PRIORIDADE[p]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* RF-01: o segundo eixo do card. A coluna diz em que ponto ele está;
            a tag diz de que assunto ele é. */}
        <section>
          <p className="mb-1 rotulo">
            Tags
          </p>
          <SeletorDeTags
            tags={card.tags}
            sugestoes={tagsDoBoard}
            // Escolha discreta, como prazo e prioridade: salva na hora, não
            // entra no autosave do título e da descrição.
            onMudar={(tags) => aplicar({ tags })}
          />
        </section>

        {/* RF-28: coluna única com preview alternável — não é o split da nota. */}
        {/* A chave volta a prévia para "editar" ao trocar de card, como fazia o
            estado que morava aqui. */}
        <CampoMarkdown
          key={card.id}
          titulo="Descrição"
          rotuloCampo="Descrição do card"
          valor={rascunho.descriptionMd}
          onMudar={(descriptionMd) => setRascunho((r) => ({ ...r, descriptionMd }))}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key.toLowerCase() === "s") {
              e.preventDefault();
              salvarAgora();
            }
          }}
          placeholder="Detalhes em Markdown…"
        />

        {/* RF-30 */}
        <section>
          <p className="mb-1 rotulo">
            Checklist {checklist.length > 0 && `${feitos}/${checklist.length}`}
          </p>

          <ul className="space-y-1">
            {checklist.map((item, i) => (
              <li key={item.id} className="group flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    mudarChecklist(
                      checklist.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)),
                    )
                  }
                  aria-label={item.text}
                  className="size-3.5 shrink-0 accent-accent-500"
                />
                <input
                  defaultValue={item.text}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (!text || text === item.text) return;
                    mudarChecklist(checklist.map((x) => (x.id === item.id ? { ...x, text } : x)));
                  }}
                  aria-label={`Texto do item ${i + 1}`}
                  className={`min-w-0 flex-1 rounded-controle bg-transparent px-1 py-0.5 text-xs
                              outline-none focus:bg-ink-800 focus:ring-1 focus:ring-accent-400 ${
                                item.done ? "text-ink-400 line-through" : "text-ink-200"
                              }`}
                />
                <span className="hidden shrink-0 gap-0.5 group-hover:flex group-focus-within:flex">
                  <BotaoIcone
                    rotulo={`Subir item ${i + 1}`}
                    icone={<IconeChevron direcao="cima" className="size-3.5" />}
                    tamanho="p"
                    onClick={() => {
                      if (i === 0) return;
                      const copia = [...checklist];
                      const [movido] = copia.splice(i, 1);
                      if (movido) copia.splice(i - 1, 0, movido);
                      mudarChecklist(copia);
                    }}
                  />
                  <BotaoIcone
                    rotulo={`Descer item ${i + 1}`}
                    icone={<IconeChevron direcao="baixo" className="size-3.5" />}
                    tamanho="p"
                    onClick={() => {
                      if (i === checklist.length - 1) return;
                      const copia = [...checklist];
                      const [movido] = copia.splice(i, 1);
                      if (movido) copia.splice(i + 1, 0, movido);
                      mudarChecklist(copia);
                    }}
                  />
                  <BotaoIcone
                    rotulo={`Remover item ${i + 1}`}
                    icone={<IconeFechar className="size-3.5" />}
                    tamanho="p"
                    onClick={() => mudarChecklist(checklist.filter((x) => x.id !== item.id))}
                  />
                </span>
              </li>
            ))}
          </ul>

          {checklist.length < MAX_CHECKLIST_ITENS && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = novoItem.trim();
                if (!text) return;
                setNovoItem("");
                mudarChecklist([...checklist, { id: crypto.randomUUID(), text, done: false }]);
              }}
            >
              <input
                value={novoItem}
                onChange={(e) => setNovoItem(e.target.value)}
                placeholder="+ item"
                aria-label="Novo item do checklist"
                className="mt-1 w-full rounded-controle bg-transparent px-1 py-1 text-xs
                           text-ink-200 outline-none placeholder:text-ink-400/60 hover:bg-ink-800
                           focus:bg-ink-800 focus:ring-1 focus:ring-accent-400"
              />
            </form>
          )}
        </section>

        {/* Frente de cards, Parte 2. */}
        <AnexosDoCard cardId={cardId} boardId={card.boardId} onErro={setErro} />

        {/* RF-35 / RF-36 / RF-37 */}
        <section>
          <p className="mb-1 rotulo">
            Nota vinculada
          </p>

          {card.note ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => card.note && onAbrirNota(card.note.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-controle border
                           border-ink-700 bg-superficie px-2 py-1 text-left text-xs text-ink-200
                           hover:border-accent-400"
              >
                <IconeClipe className="size-3 text-ink-400" />
                <span className="truncate">{card.note.title}</span>
                <RotuloTipo tipo={card.note.kind} className="ml-auto shrink-0" />
              </button>
              <BotaoIcone
                rotulo="Desvincular nota"
                icone={<IconeFechar className="size-3.5" />}
                onClick={() => aplicar({ noteId: null })}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <input
                value={buscaNota}
                onChange={(e) => setBuscaNota(e.target.value)}
                placeholder="Buscar nota por título…"
                aria-label="Buscar nota para vincular"
                className="w-full rounded-controle bg-ink-800 px-2 py-1 text-xs text-ink-200
                           outline-none placeholder:text-ink-400/60 focus:ring-1
                           focus:ring-accent-400"
              />
              {sugestoes.length > 0 && (
                <ul
                  className="overflow-hidden rounded-controle border border-ink-700 bg-superficie"
                >
                  {sugestoes.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBuscaNota("");
                          aplicar({ noteId: s.id });
                        }}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs
                                   text-ink-200 hover:bg-ink-700"
                      >
                        <span className="truncate">{s.title}</span>
                        <RotuloTipo tipo={s.kind} className="ml-auto shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={vincularNotaNova}
                className="w-full rounded-controle border border-ink-700 px-2 py-1 text-miudo
                           text-ink-400 hover:border-accent-400 hover:text-ink-200"
              >
                Criar nota com o título do card
              </button>
            </div>
          )}
        </section>
      </div>

      {/* RF-33 / RF-34 */}
      <footer className="mt-auto flex shrink-0 gap-2 border-t border-ink-800 px-4 py-3">
        {/* Frente de cards, Parte 1: concluir não move o card nem fecha o painel. */}
        <Botao
          variante="secundario"
          icone={<IconeCheck className="size-3.5" />}
          onClick={() => aplicar({ completed: card.completedAt === null })}
        >
          {card.completedAt ? "Reabrir" : "Concluir"}
        </Botao>
        <Botao variante="secundario" onClick={() => aplicar({ archived: !card.archived })}>
          {card.archived ? "Desarquivar" : "Arquivar"}
        </Botao>
        <Botao
          variante="perigo"
          className="ml-auto"
          onClick={() => {
            // INV-21: a confirmação diz o que se perde — e anexo sai do bucket.
            const anexos =
              card.fileCount > 0 ? ` Os ${card.fileCount} anexo(s) também são apagados.` : "";
            if (!confirm(`Excluir o card "${card.title}"? Não há lixeira de card.${anexos}`)) {
              return;
            }
            excluir.mutate({ id: cardId, boardId: card.boardId }, { onSuccess: onFechar });
          }}
        >
          Excluir
        </Botao>
      </footer>
    </div>
  );
}
