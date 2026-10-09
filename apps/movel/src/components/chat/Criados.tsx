import type { ChatCreated, EventItem, TaskItem } from "@yu-book/shared";
import { quandoNaAgenda, useExcluirEvento, useExcluirTarefa } from "@yu-book/cliente/agenda";
import { ApiError, api } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { chaveCriado } from "@yu-book/cliente/chat";
import { CartaoCriado } from "@yu-book/cliente/chat/CartaoCriado";
import {
  IconeAssistente,
  IconeBoard,
  IconeCalendario,
  IconeNotas,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import { useId, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useFolhaItem } from "../folha/FolhaItem";

/**
 * Como cada tipo do que o chat cria se mostra no móvel. `Record` total sobre
 * `ChatCreated["kind"]`: tipo novo não compila sem entrada aqui (o par do
 * `COMO_MOSTRAR` do web). Nota e card não têm tela no móvel — mostram o
 * título, sem abrir nem desfazer; quem os quer desfazer tem o web.
 */
const COMO_MOSTRAR: Record<
  ChatCreated["kind"],
  { Icone: ComponentType<IconeProps>; tipo: string; desfeito: string; agenda: boolean }
> = {
  note: { Icone: IconeNotas, tipo: "nota", desfeito: "nota desfeita", agenda: false },
  card: { Icone: IconeBoard, tipo: "card", desfeito: "card desfeito", agenda: false },
  event: { Icone: IconeCalendario, tipo: "evento", desfeito: "evento desfeito", agenda: true },
  task: { Icone: IconeTarefa, tipo: "tarefa", desfeito: "tarefa desfeita", agenda: true },
};

/** "o evento", "a tarefa" — os dois tipos que o móvel abre e desfaz. */
const artigo = (tipo: string) => (tipo === "tarefa" ? "a tarefa" : `o ${tipo}`);

function quandoDe(c: ChatCreated): ReactNode {
  if (c.kind !== "event" && c.kind !== "task") return undefined;
  if (c.date === undefined) return undefined;
  const hora = c.time ?? null;
  const texto = quandoNaAgenda(c.kind, c.date, hora);
  return c.date ? <time dateTime={hora ? `${c.date}T${hora}` : c.date}>{texto}</time> : texto;
}

/**
 * O "Criado nesta resposta" do móvel. Evento e tarefa abrem a **folha de
 * edição** da casca — o item é lido da API na hora, porque o evento do chat
 * traz só id, título e quando — e se desfazem (excluídos; não há lixeira
 * deles). Desfeito, o cartão diz "desfeito" por extenso e o foco fica no bloco,
 * porque o botão que o tinha sumiu.
 */
export function Criados({
  criados,
  desfeitos,
  onDesfeito,
}: {
  criados: ChatCreated[];
  desfeitos: ReadonlySet<string>;
  onDesfeito: (chave: string) => void;
}) {
  const { abrir } = useFolhaItem();
  const excluirEvento = useExcluirEvento();
  const excluirTarefa = useExcluirTarefa();
  const bloco = useRef<HTMLElement>(null);
  const idTitulo = useId();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");

  async function abrirItem(c: ChatCreated) {
    setErro(null);
    setOcupado(chaveCriado(c));
    try {
      if (c.kind === "event") {
        abrir({ modo: "editar", evento: await api.get<EventItem>(`/events/${c.id}`) });
      } else if (c.kind === "task") {
        abrir({ modo: "editar", tarefa: await api.get<TaskItem>(`/tasks/${c.id}`) });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_FOUND") {
        onDesfeito(chaveCriado(c));
        setAnuncio(`“${c.title}” já tinha sido excluído.`);
      } else {
        setErro(e instanceof ApiError ? e.message : "Não foi possível abrir.");
      }
    } finally {
      setOcupado(null);
    }
  }

  async function desfazer(c: ChatCreated) {
    const chave = chaveCriado(c);
    setErro(null);
    setOcupado(chave);
    try {
      if (c.kind === "event") await excluirEvento.mutateAsync(c.id);
      else if (c.kind === "task") await excluirTarefa.mutateAsync(c.id);
      onDesfeito(chave);
      setAnuncio(`Desfeito: “${c.title}” foi excluído.`);
    } catch (e) {
      // Já excluído por outro caminho: o desfecho pedido é esse mesmo.
      if (e instanceof ApiError && e.code === "NOT_FOUND") {
        onDesfeito(chave);
        setAnuncio(`“${c.title}” já tinha sido excluído.`);
      } else {
        setErro(e instanceof ApiError ? e.message : "Não foi possível desfazer.");
      }
    } finally {
      setOcupado(null);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) bloco.current?.focus();
      });
    }
  }

  return (
    <section ref={bloco} tabIndex={-1} aria-labelledby={idTitulo} className="mt-3">
      <p id={idTitulo} className="rotulo flex items-center gap-1.5">
        <IconeAssistente className="size-3 text-accent-400" />
        Criado nesta resposta
      </p>
      <ul className="mt-1.5 grid grid-cols-1 gap-2">
        {criados.map((c) => {
          const chave = chaveCriado(c);
          const como = COMO_MOSTRAR[c.kind];
          return (
            <li key={chave} className="min-w-0">
              <CartaoCriado
                icone={<como.Icone className="size-4" />}
                tipo={como.tipo}
                titulo={c.title}
                quando={quandoDe(c)}
                desfeito={desfeitos.has(chave)}
                rotuloDesfeito={como.desfeito}
                onAbrir={como.agenda ? () => void abrirItem(c) : undefined}
                rotuloAbrir={`Abrir ${artigo(como.tipo)}`}
                acoes={
                  como.agenda ? (
                    <Botao
                      variante="fantasma"
                      tamanho="g"
                      className="-mr-1"
                      carregando={ocupado === chave}
                      disabled={ocupado !== null && ocupado !== chave}
                      onClick={() => void desfazer(c)}
                      aria-label={`Desfazer: excluir ${artigo(como.tipo)} “${c.title}”`}
                    >
                      Desfazer
                    </Botao>
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ul>
      {erro && (
        <Aviso tom="erro" onFechar={() => setErro(null)} className="mt-2">
          {erro}
        </Aviso>
      )}
      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>
    </section>
  );
}
