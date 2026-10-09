import type { AgentSummary, ChatAttachmentInput } from "@yu-book/shared";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useMatch } from "react-router-dom";
import { useAgentes } from "../../lib/agentes";
import { useAiAjustes, useAiSaude } from "../../lib/ia";
import { useBoards, useCard } from "../../lib/kanban";
import { useBusca, useNota } from "../../lib/notas";
import { useSessaoChat } from "../../lib/sessaoChat";
import { useWorkspaceAtivo } from "../../lib/workspace";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { alvoDe } from "@yu-book/cliente/chat";
import { motivoSemChat } from "@yu-book/cliente/motivoSemChat";
import type { Anexo } from "@yu-book/cliente/chat";
import { CampoMensagem } from "@yu-book/cliente/chat/CampoMensagem";
import { IconeFechar, IconeMais } from "@yu-book/cliente/icones";
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
 * RNF-03 da IA: o campo desabilitado e o porquê — e onde resolver. A regra é
 * `motivoSemChat`, a mesma do móvel; o modelo do agente que saiu dos favoritos
 * fica com o bloqueio do agente (abaixo), que leva ao editor dele, e não a
 * Ajustes.
 */
function useMotivoSemChat(agente: AgentSummary | null) {
  const { data: saude } = useAiSaude();
  const { data: ajustes } = useAiAjustes();
  return motivoSemChat(saude, ajustes, agente);
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

  const semChat = useMotivoSemChat(agente.resumo);
  const motivoGeral = semChat?.tipo === "modelo-do-agente" ? null : (semChat?.texto ?? null);
  /**
   * Os bloqueios do agente (Etapa D). Os dois viriam do servidor como 422 na
   * hora de enviar; aqui eles aparecem antes, com a saída ao lado. O servidor
   * continua sendo quem decide — o `erro` da sessão cobre o que esta leitura
   * do cache não viu.
   */
  const bloqueioDoAgente: "excluido" | "modelo" | null = agente.excluido
    ? "excluido"
    : semChat?.tipo === "modelo-do-agente"
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
    // O Enter que sobra — sem menu do `@` — é do `CampoMensagem`, que envia
    // por `mandar`.
  }

  /** Enviar encerra a menção: uma busca atrasada não pode abrir o menu sobre o campo vazio. */
  function mandar(visivel: string) {
    setMencao(null);
    void enviar(visivel);
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
      ) : bloqueioDoAgente === "modelo" && semChat && agente.resumo ? (
        <Aviso tom="alerta" className="mb-2">
          <span id={idMotivo}>{semChat.texto}</span>{" "}
          <Link
            to={`/assistente/agentes/${agente.resumo.id}`}
            className="font-medium underline underline-offset-2"
          >
            Editar o agente
          </Link>
        </Aviso>
      ) : null}

      <CampoMensagem
        valor={texto}
        onMudar={aoDigitar}
        onEnviar={mandar}
        onParar={parar}
        respondendo={Boolean(emCurso)}
        podeEnviar={!motivo && Boolean(texto.trim())}
        desabilitado={Boolean(motivo)}
        campoRef={campoRef}
        onKeyDown={teclas}
        descritoPor={motivo ? idMotivo : undefined}
        placeholder={
          placeholder ??
          (agente.identidade
            ? `Escreva para ${agente.identidade.name}…`
            : "Pergunte ou peça alguma coisa…")
        }
        esquerda={mostrarSeletor ? <SeletorAgente /> : undefined}
        acima={
          anexos.length > 0 || sugerirTela ? (
            <>
              {anexos.map((a) => (
                <span
                  key={alvoDe(a)}
                  className="inline-flex max-w-full items-center gap-1 rounded-full
                             bg-accent-500/15 py-0.5 pl-2 pr-0.5 text-miudo text-accent-400"
                >
                  <span className="truncate">{a.titulo}</span>
                  <button
                    type="button"
                    onClick={() => desanexar(alvoDe(a))}
                    aria-label={`Tirar ${a.titulo} do contexto`}
                    className="rounded-full p-0.5 hover:bg-accent-500/20"
                  >
                    <IconeFechar className="size-3" />
                  </button>
                </span>
              ))}
              {sugerirTela && daTela && (
                <span
                  className="inline-flex max-w-full items-center rounded-full border
                             border-dashed border-ink-700"
                >
                  <button
                    type="button"
                    onClick={() => anexar(daTela)}
                    className="inline-flex min-w-0 items-center gap-1 py-0.5 pl-2 pr-1
                               text-miudo text-ink-400 hover:text-ink-200"
                  >
                    <IconeMais className="size-3" />
                    <span className="truncate">Usar “{daTela.titulo}”</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispensados((d) => [...d, alvoDe(daTela)])}
                    aria-label={`Não sugerir ${daTela.titulo}`}
                    className="mr-0.5 rounded-full p-0.5 text-ink-400 hover:text-ink-200"
                  >
                    <IconeFechar className="size-3" />
                  </button>
                </span>
              )}
            </>
          ) : undefined
        }
        dica={
          <>
            <span className="font-medium">Enter</span> envia ·{" "}
            <span className="font-medium">Shift+Enter</span> quebra a linha ·{" "}
            <span className="font-medium">@</span> anexa
          </>
        }
      />
    </div>
  );
}
