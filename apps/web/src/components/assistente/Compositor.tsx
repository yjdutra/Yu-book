import type { AgentSummary, ChatAttachmentInput } from "@yu-book/shared";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useMatch } from "react-router-dom";
import { useAgentes } from "../../lib/agentes";
import { useAiAjustes, useAiSaude } from "../../lib/ia";
import { useBoards, useCard } from "../../lib/kanban";
import { useBusca, useNota } from "../../lib/notas";
import { alvoDe, useSessaoChat } from "../../lib/sessaoChat";
import type { Anexo } from "../../lib/sessaoChat";
import { useWorkspaceAtivo } from "../../lib/workspace";
import { Aviso } from "../base/Aviso";
import { Botao } from "../base/Botao";
import { IconeFechar, IconeMais } from "../Icones";
import { useAgenteDaConversa } from "./agenteDaConversa";
import { SeletorAgente } from "./SeletorAgente";

/**
 * Uma linha do menu do `@`.
 *
 * Os três tipos vêm de fontes diferentes — nota e card da busca do servidor,
 * quadro da lista que a navegação já carregou —, e o menu precisa oferecer os
 * três porque o servidor resolve os três. Oferecer só dois faria a tela
 * prometer o que ela não entrega.
 */
interface Sugestao {
  anexo: ChatAttachmentInput;
  titulo: string;
  rotulo: string;
}

/**
 * O que está aberto na tela, oferecido como contexto — **oferecido, não
 * anexado**: anexar sozinho mandaria o conteúdo ao provedor e gastaria tokens
 * sem ninguém pedir.
 */
function useContextoDaTela(): Anexo | null {
  const naNota = useMatch("/n/:id");
  const noCard = useMatch("/b/:boardId/c/:cardId");
  const notaId = naNota?.params.id ?? null;
  const cardId = noCard?.params.cardId ?? null;
  const { data: nota } = useNota(notaId);
  const { data: card } = useCard(cardId);

  if (nota && notaId) return { noteId: notaId, titulo: nota.title };
  if (card && cardId) return { cardId, titulo: card.title };
  return null;
}

/**
 * RNF-03 da IA: sem provedor, ou sem modelo escolhido para o chat, o campo
 * fica desabilitado e diz por quê — e onde resolver.
 *
 * Agente com modelo próprio (Etapa D) não passa pelo modelo do chat: exigir a
 * escolha da tarefa `chat` dele bloquearia uma conversa que o servidor aceita.
 */
function useMotivoSemChat(agente: AgentSummary | null): string | null {
  const { data: saude } = useAiSaude();
  const { data: ajustes } = useAiAjustes();
  if (saude && !saude.configured) return "Nenhum provedor de IA configurado no servidor.";
  if (agente?.modelId) return null;
  if (ajustes && !ajustes.taskModels.chat) return "Nenhum modelo escolhido para o chat.";
  return null;
}

export function Compositor({ placeholder }: { placeholder?: string }) {
  const sessao = useSessaoChat();
  const { texto, setTexto, anexos, emCurso, enviar, parar, anexar, desanexar } = sessao;
  const { conversaId, agenteId, escolherAgente, novaConversa, focarCampo } = sessao;
  const agente = useAgenteDaConversa();
  const { data: agentes } = useAgentes();
  const { ativoId } = useWorkspaceAtivo();
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const idMotivo = useId();

  useEffect(() => sessao.registrarCampo(campoRef), [sessao.registrarCampo]);

  /// O agente escolhido para a conversa nova foi excluído entretanto (aqui ou
  /// em outra aba): a escolha volta ao Assistente, em vez de criar uma conversa
  /// que o servidor recusa com 404.
  useEffect(() => {
    if (!conversaId && agenteId && agentes && !agentes.some((a) => a.id === agenteId)) {
      escolherAgente(null);
    }
  }, [conversaId, agenteId, agentes, escolherAgente]);

  const motivoGeral = useMotivoSemChat(agente.resumo);
  /**
   * Os bloqueios do agente (Etapa D). Os dois viriam do servidor como 422 na
   * hora de enviar; aqui eles aparecem antes, com a saída ao lado. O servidor
   * continua sendo quem decide — o `erro` da sessão cobre o que esta leitura
   * do cache não viu.
   */
  const bloqueioDoAgente: "excluido" | "modelo" | null = agente.excluido
    ? "excluido"
    : agente.resumo?.modelMissing
      ? "modelo"
      : null;
  const motivo = motivoGeral ?? (bloqueioDoAgente ? "O agente não pode responder agora." : null);
  const mostrarSeletor = !conversaId && !emCurso;
  const daTela = useContextoDaTela();
  const [dispensados, setDispensados] = useState<string[]>([]);
  const sugerirTela =
    daTela &&
    !dispensados.includes(alvoDe(daTela)) &&
    !anexos.some((a) => alvoDe(a) === alvoDe(daTela));

  /// O menu do `@`: o termo depois do arroba, com o mesmo debounce de 200 ms
  /// da paleta (RF-29).
  const [mencao, setMencao] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const [indice, setIndice] = useState(0);
  const { data: busca } = useBusca(debounced, mencao !== null, ativoId);
  const { data: quadros } = useBoards(ativoId);

  /**
   * Os quadros entram do lado do cliente porque a busca do servidor cobre nota
   * e card, não quadro — e a lista de quadros já está em cache, carregada pela
   * navegação. São poucas dezenas, e uma rota nova só para isto seria
   * desproporcional.
   */
  const sugestoes = useMemo<Sugestao[]>(() => {
    const termo = debounced.trim().toLowerCase();
    const daBusca = (busca?.results ?? []).map((r) => ({
      anexo: r.type === "card" ? { cardId: r.id } : { noteId: r.id },
      titulo: r.title,
      rotulo: r.type === "card" ? "card" : (r.kind ?? "nota"),
    }));
    const dosQuadros = (quadros ?? [])
      .filter((b) => !termo || b.name.toLowerCase().includes(termo))
      .slice(0, 5)
      .map((b) => ({ anexo: { boardId: b.id }, titulo: b.name, rotulo: "quadro" }));
    return [...daBusca, ...dosQuadros];
  }, [busca, quadros, debounced]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(mencao ?? ""), 200);
    return () => clearTimeout(timer);
  }, [mencao]);

  useEffect(() => setIndice(0), [debounced]);

  const escolher = useCallback(
    (s: Sugestao) => {
      anexar({ ...s.anexo, titulo: s.titulo });
      /// Tira o `@termo` do texto: ele virou um chip, e deixá-lo escrito faria o
      /// modelo receber a menção duas vezes.
      setTexto(texto.replace(/@[^\s@]*$/, ""));
      setMencao(null);
      campoRef.current?.focus();
    },
    [anexar, setTexto, texto],
  );

  function aoDigitar(valor: string) {
    setTexto(valor);
    const arroba = /@([^\s@]*)$/.exec(valor);
    setMencao(arroba ? (arroba[1] ?? "") : null);
  }

  function teclas(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && mencao !== null) {
      // O Esc do painel o fecha. Com o menu do `@` aberto, o Esc é do menu —
      // parar aqui evita fechar o painel junto.
      e.preventDefault();
      e.stopPropagation();
      setMencao(null);
      return;
    }

    if (mencao !== null && sugestoes.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const passo = e.key === "ArrowDown" ? 1 : -1;
        setIndice((i) => (i + passo + sugestoes.length) % sugestoes.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const escolhido = sugestoes[indice];
        if (escolhido) escolher(escolhido);
        return;
      }
    }

    // Enter envia; Shift+Enter quebra linha. É a convenção que todo campo de
    // conversa usa, e contrariá-la surpreende antes de ensinar.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      mandar();
    }
  }

  /** Enviar encerra a menção: uma busca atrasada não pode abrir o menu sobre o campo vazio. */
  function mandar() {
    setMencao(null);
    void enviar();
  }

  return (
    <div className="relative">
      {mencao !== null && sugestoes.length > 0 && (
        <ul
          role="listbox"
          aria-label="Anexar ao contexto"
          className="absolute bottom-full left-0 right-0 z-(--z-popover) mb-2 max-h-56
                     overflow-y-auto rounded-cartao border border-ink-700/70 bg-superficie p-1
                     shadow-e3 animate-surgir"
        >
          {sugestoes.map((s, i) => (
            <li key={`${s.rotulo}-${s.anexo.noteId ?? s.anexo.cardId ?? s.anexo.boardId}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === indice}
                onMouseEnter={() => setIndice(i)}
                onClick={() => escolher(s)}
                className={`flex w-full items-baseline gap-2 rounded-controle px-2.5 py-1.5
                            text-left text-sm ${i === indice ? "bg-ink-800" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate">{s.titulo}</span>
                <span className="shrink-0 text-miudo text-ink-400">{s.rotulo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {motivoGeral ? (
        <Aviso tom="alerta" className="mb-2">
          <span id={idMotivo}>{motivoGeral}</span>{" "}
          <Link to="/ajustes/modelos" className="font-medium underline underline-offset-2">
            Escolher em Ajustes
          </Link>
        </Aviso>
      ) : bloqueioDoAgente === "excluido" ? (
        <Aviso tom="alerta" className="mb-2">
          <span id={idMotivo}>
            O agente desta conversa foi excluído — comece uma conversa nova.
          </span>
          <div className="mt-1.5">
            <Botao
              variante="secundario"
              icone={<IconeMais className="size-3.5" />}
              onClick={() => {
                novaConversa();
                focarCampo();
              }}
            >
              Nova conversa
            </Botao>
          </div>
        </Aviso>
      ) : bloqueioDoAgente === "modelo" && agente.resumo ? (
        <Aviso tom="alerta" className="mb-2">
          <span id={idMotivo}>
            O modelo de «{agente.resumo.name}» saiu dos favoritos.
          </span>{" "}
          <Link
            to={`/assistente/agentes/${agente.resumo.id}`}
            className="font-medium underline underline-offset-2"
          >
            Editar o agente
          </Link>
        </Aviso>
      ) : null}

      {mostrarSeletor && <SeletorAgente />}

      {(anexos.length > 0 || sugerirTela) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {anexos.map((a) => (
            <span
              key={alvoDe(a)}
              className="inline-flex items-center gap-1 rounded-etiqueta bg-accent-500/15 py-0.5
                         pl-1.5 pr-0.5 text-miudo text-accent-400"
            >
              {a.titulo}
              <button
                type="button"
                onClick={() => desanexar(alvoDe(a))}
                aria-label={`Tirar ${a.titulo} do contexto`}
                className="rounded-sm p-0.5 hover:bg-accent-500/20"
              >
                <IconeFechar className="size-3" />
              </button>
            </span>
          ))}
          {sugerirTela && daTela && (
            <span
              className="inline-flex items-center rounded-etiqueta border border-dashed
                         border-ink-700"
            >
              <button
                type="button"
                onClick={() => anexar(daTela)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-miudo text-ink-400
                           hover:text-ink-200"
              >
                <IconeMais className="size-3" />
                Usar “{daTela.titulo}”
              </button>
              <button
                type="button"
                onClick={() => setDispensados((d) => [...d, alvoDe(daTela)])}
                aria-label={`Não sugerir ${daTela.titulo}`}
                className="rounded-sm p-0.5 text-ink-400 hover:text-ink-200"
              >
                <IconeFechar className="size-3" />
              </button>
            </span>
          )}
        </div>
      )}

      <div
        className="flex items-end gap-2 rounded-cartao border border-ink-700 bg-ink-950/60 p-2
                   shadow-e1 transition-colors focus-within:border-accent-400"
      >
        <textarea
          ref={campoRef}
          value={texto}
          onChange={(e) => aoDigitar(e.target.value)}
          onKeyDown={teclas}
          rows={2}
          disabled={Boolean(motivo)}
          aria-label="Sua pergunta"
          aria-describedby={motivo ? idMotivo : undefined}
          placeholder={
            placeholder ??
            (agente.identidade
              ? `Escreva para ${agente.identidade.name}. @ anexa uma nota.`
              : "Pergunte alguma coisa. @ anexa uma nota.")
          }
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm
                     text-ink-200 outline-none placeholder:text-ink-400 disabled:opacity-50"
        />
        {emCurso ? (
          <Botao variante="secundario" onClick={parar}>
            Parar
          </Botao>
        ) : (
          <Botao
            variante="ia"
            onClick={mandar}
            disabled={Boolean(motivo) || !texto.trim()}
          >
            Enviar
          </Botao>
        )}
      </div>
    </div>
  );
}
