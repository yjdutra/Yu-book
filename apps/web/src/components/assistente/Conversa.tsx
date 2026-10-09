import { MAX_TITULO, NOTE_KINDS } from "@yu-book/shared";
import type {
  ChatCreated,
  ChatMessage,
  ChatSource,
  Conversation,
  ConversationAgent,
  NoteDetail,
  NoteKind,
} from "@yu-book/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { quandoNaAgenda, useExcluirEvento, useExcluirTarefa } from "@yu-book/cliente/agenda";
import { ApiError } from "@yu-book/cliente/api";
import { useVirarNota } from "../../lib/chat";
import { carregarCard, useExcluirCard } from "../../lib/kanban";
import { useExcluirNota, useWorkspaces } from "../../lib/notas";
import { naTelaDoChat, useSessaoChat } from "../../lib/sessaoChat";
import { useWorkspaceAtivo } from "../../lib/workspace";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao, BotaoIcone } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { alvoDe, chaveCriado, semOTurnoEmCurso, useConversa } from "@yu-book/cliente/chat";
import { AvatarAgente } from "@yu-book/cliente/chat/AvatarAgente";
import { BalaoUsuario } from "@yu-book/cliente/chat/BalaoUsuario";
import { CartaoCriado } from "@yu-book/cliente/chat/CartaoCriado";
import { FalaAssistente } from "@yu-book/cliente/chat/FalaAssistente";
import { StatusDaResposta } from "@yu-book/cliente/chat/StatusDaResposta";
import {
  IconeAssistente,
  IconeBoard,
  IconeCalendario,
  IconeCheck,
  IconeCopiar,
  IconeNotas,
  IconeTarefa,
  IconeVirarNota,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import { useAgenteDaConversa } from "./agenteDaConversa";
import { ApresentacaoAgente } from "./ApresentacaoAgente";
import { Fontes } from "./Fontes";

/**
 * As falas de uma conversa (RF-17 a RF-26 da IA) — a mesma nas duas
 * superfícies do chat, o painel lateral e a rota `/assistente`.
 *
 * O desenho de cada peça — balão, fala, a linha do passo em curso, o cartão do
 * que foi criado — vem dos átomos de `@yu-book/cliente/chat/`, os mesmos do
 * móvel (Fase 5 da frente de agenda). O que fica aqui é o que é do web: abrir
 * a nota e o card, desfazer, virar nota, o link para o editor do agente.
 */

/**
 * Avatar de quem responde. Sem agente, nada: a fala usa a faísca no gradiente
 * de IA (`AvatarIA`); com agente (Etapa D), as iniciais na cor dele — e o nome
 * dele para o leitor de tela, que de outro modo não saberia quem está falando.
 */
function avatarDe(agente: ConversationAgent | null) {
  if (!agente) return undefined;
  return (
    <span title={agente.name} className="flex">
      <AvatarAgente nome={agente.name} cor={agente.color} rotulado excluido={agente.id === null} />
    </span>
  );
}

/**
 * Como cada tipo do que o chat cria se mostra e se desfaz. `Record` total
 * sobre `ChatCreated["kind"]`: tipo novo não compila sem entrada aqui. Antes
 * da frente de agenda o bloco supunha que o que não era nota era card — e um
 * evento teria oferecido "abrir o card" e um Desfazer contra `/cards/:id`.
 *
 * `abrir` nulo: evento e tarefa não têm tela no web — moram no app móvel —, e
 * o item fica só texto, com o dia e a hora ao lado.
 */
const COMO_MOSTRAR: Record<
  ChatCreated["kind"],
  {
    Icone: ComponentType<IconeProps>;
    tipo: string;
    desfeito: string;
    abrir: string | null;
    desfazer: (titulo: string) => string;
    desfez: (titulo: string) => string;
    jaDesfeito: (titulo: string) => string;
  }
> = {
  note: {
    Icone: IconeNotas,
    tipo: "nota",
    desfeito: "nota desfeita",
    abrir: "Abrir a nota",
    desfazer: (t) => `Desfazer: mandar a nota “${t}” para a lixeira`,
    desfez: (t) => `Desfeito: a nota “${t}” foi para a lixeira.`,
    jaDesfeito: (t) => `A nota “${t}” já estava na lixeira.`,
  },
  card: {
    Icone: IconeBoard,
    tipo: "card",
    desfeito: "card desfeito",
    abrir: "Abrir o card",
    desfazer: (t) => `Desfazer: excluir o card “${t}”`,
    desfez: (t) => `Desfeito: o card “${t}” foi excluído.`,
    jaDesfeito: (t) => `O card “${t}” já tinha sido excluído.`,
  },
  event: {
    Icone: IconeCalendario,
    tipo: "evento",
    desfeito: "evento desfeito",
    abrir: null,
    desfazer: (t) => `Desfazer: excluir o evento “${t}”`,
    desfez: (t) => `Desfeito: o evento “${t}” foi excluído.`,
    jaDesfeito: (t) => `O evento “${t}” já tinha sido excluído.`,
  },
  task: {
    Icone: IconeTarefa,
    tipo: "tarefa",
    desfeito: "tarefa desfeita",
    abrir: null,
    desfazer: (t) => `Desfazer: excluir a tarefa “${t}”`,
    desfez: (t) => `Desfeito: a tarefa “${t}” foi excluída.`,
    jaDesfeito: (t) => `A tarefa “${t}” já tinha sido excluída.`,
  },
};

/**
 * O dia e a hora do evento ou da tarefa, sob o título. `date` ausente é
 * mensagem gravada antes do campo existir, ou nota e card: nada a mostrar —
 * diferente de `null`, que na tarefa é "sem data".
 */
function quandoDe(criado: ChatCreated): ReactNode {
  if (criado.kind !== "event" && criado.kind !== "task") return undefined;
  if (criado.date === undefined) return undefined;
  const hora = criado.time ?? null;
  const texto = quandoNaAgenda(criado.kind, criado.date, hora);
  return criado.date ? (
    <time dateTime={hora ? `${criado.date}T${hora}` : criado.date}>{texto}</time>
  ) : (
    <>{texto}</>
  );
}

/**
 * O que o chat criou nesta resposta (Etapa C da frente de IA), abaixo das
 * fontes e no mesmo desenho delas. Cada item abre o que foi criado — quando há
 * onde abrir — e oferece desfazer: a escrita é iniciada pelo usuário e
 * reversível por ele (RN-03).
 *
 * Desfazer nota a manda para a lixeira, de onde ela volta; desfazer card o
 * exclui, pela mesma rota do painel do card; evento e tarefa são excluídos
 * (frente de agenda — não há lixeira deles). Depois, o item fica riscado com
 * "desfeito" por extenso (RNF-09: o estado não é só o risco), e o foco volta ao
 * bloco — o botão que o tinha desaparece.
 */
function Criados({
  criados,
  onAbrirFonte,
}: {
  criados: ChatCreated[];
  onAbrirFonte: (f: ChatSource) => void;
}) {
  const { desfeitos, marcarDesfeito, abrirPainel } = useSessaoChat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const excluirNota = useExcluirNota();
  const excluirCard = useExcluirCard();
  const excluirEvento = useExcluirEvento();
  const excluirTarefa = useExcluirTarefa();
  const bloco = useRef<HTMLElement>(null);
  const idTitulo = useId();
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");

  /**
   * Nota abre como fonte, com o desvio de cada superfície. Card não tem rota
   * sem o quadro, e o evento traz só o id: o detalhe vem antes, pela chave de
   * `useCard`, e o painel do card já o acha em cache. Da tela cheia, a conversa
   * vai junto no painel lateral, como faz a fonte.
   */
  async function abrir(c: ChatCreated) {
    setErro(null);
    if (c.kind === "note") {
      onAbrirFonte({ kind: "note", id: c.id, title: c.title });
      return;
    }
    // Evento e tarefa não chegam aqui (`abrir` nulo em `COMO_MOSTRAR`); a
    // guarda impede que um tipo futuro caia no caminho do card.
    if (c.kind !== "card") return;
    try {
      const card = await carregarCard(qc, c.id);
      navigate(`/b/${card.boardId}/c/${card.id}`);
      if (naTelaDoChat(pathname)) abrirPainel();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível abrir o card.");
    }
  }

  async function desfazer(c: ChatCreated) {
    const chave = chaveCriado(c);
    setErro(null);
    setDesfazendo(chave);
    try {
      switch (c.kind) {
        case "note":
          await excluirNota.mutateAsync(c.id);
          break;
        case "card": {
          // O quadro vem do detalhe: a invalidação da exclusão precisa dele.
          const card = await carregarCard(qc, c.id);
          await excluirCard.mutateAsync({ id: c.id, boardId: card.boardId });
          break;
        }
        case "event":
          await excluirEvento.mutateAsync(c.id);
          break;
        case "task":
          await excluirTarefa.mutateAsync(c.id);
          break;
      }
      marcarDesfeito(chave);
      setAnuncio(COMO_MOSTRAR[c.kind].desfez(c.title));
    } catch (e) {
      // Já desfeito — por outro caminho, ou por este antes de recarregar a
      // página: `desfeitos` só vive em memória. A API responde NOT_FOUND tanto
      // para o card apagado quanto para a nota que já está na lixeira (`excluir`
      // em notes.service.ts filtra `deletedAt: null`), e para evento e tarefa
      // já apagados. O desfecho que se pediu é esse mesmo, e oferecer desfazer
      // de novo seria mentir.
      if (e instanceof ApiError && e.code === "NOT_FOUND") {
        marcarDesfeito(chave);
        setAnuncio(COMO_MOSTRAR[c.kind].jaDesfeito(c.title));
      } else {
        setErro(e instanceof ApiError ? e.message : "Não foi possível desfazer.");
      }
    } finally {
      setDesfazendo(null);
      // RNF-06 da Fase 1: o botão que tinha o foco sumiu; ele fica no bloco.
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
      <ul className="mt-1.5 grid grid-cols-1 gap-1.5">
        {criados.map((c) => {
          const chave = chaveCriado(c);
          const como = COMO_MOSTRAR[c.kind];
          const Icone = como.Icone;
          return (
            <li key={chave} className="min-w-0">
              <CartaoCriado
                icone={<Icone className="size-4" />}
                tipo={como.tipo}
                titulo={c.title}
                quando={quandoDe(c)}
                desfeito={desfeitos.has(chave)}
                rotuloDesfeito={como.desfeito}
                onAbrir={como.abrir ? () => void abrir(c) : undefined}
                rotuloAbrir={como.abrir ?? undefined}
                acoes={
                  <Botao
                    variante="fantasma"
                    carregando={desfazendo === chave}
                    disabled={desfazendo !== null && desfazendo !== chave}
                    onClick={() => void desfazer(c)}
                    aria-label={como.desfazer(c.title)}
                  >
                    Desfazer
                  </Botao>
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

/**
 * O título que a nota nasce sugerindo: o primeiro heading da resposta, sem a
 * marcação de ênfase; sem heading, o da conversa. O usuário edita antes.
 */
function tituloSugerido(conteudo: string, daConversa: string | undefined): string {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(conteudo)?.[1];
  const limpo = heading?.replace(/[*_`]/g, "").trim();
  return (limpo || daConversa || "").slice(0, MAX_TITULO);
}

/**
 * "Virar nota" (Etapa C, Q-04 resolvida): a resposta vira nota marcada como
 * gerada. O corpo não sai daqui — o servidor lê a mensagem gravada —, então
 * o diálogo só pergunta onde ela mora.
 *
 * Montado dentro de `&&` (INV-53): cada abertura começa do zero, e quem
 * devolve o foco ao botão de origem é a limpeza do `Dialogo`.
 */
function DialogoVirarNota({
  conversationId,
  messageId,
  sugestao,
  onFechar,
  onCriada,
}: {
  conversationId: string;
  messageId: string;
  sugestao: string;
  onFechar: () => void;
  onCriada: (nota: NoteDetail) => void;
}) {
  const { ativoId } = useWorkspaceAtivo();
  const { data: workspaces } = useWorkspaces();
  const virar = useVirarNota();
  const campoTitulo = useRef<HTMLInputElement>(null);
  const idErro = useId();
  const [titulo, setTitulo] = useState(sugestao);
  const [tipo, setTipo] = useState<NoteKind>("livre");
  const [workspaceId, setWorkspaceId] = useState<string | null>(ativoId);
  const [erro, setErro] = useState<{ mensagem: string; doTitulo: boolean } | null>(null);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const title = titulo.trim();
    if (!title) {
      setErro({ mensagem: "Dê um título à nota.", doTitulo: true });
      campoTitulo.current?.focus();
      return;
    }
    setErro(null);
    virar.mutate(
      { conversationId, messageId, input: { title, kind: tipo, workspaceId } },
      {
        onSuccess: onCriada,
        onError: (falha) => {
          const doTitulo = falha instanceof ApiError && falha.code === "TITULO_DUPLICADO";
          setErro({
            mensagem: doTitulo
              ? "Já existe uma nota com esse título. Escolha outro."
              : falha instanceof ApiError
                ? falha.message
                : "Não foi possível criar a nota.",
            doTitulo,
          });
          // O erro de título devolve o usuário ao campo, já selecionado.
          if (doTitulo) requestAnimationFrame(() => campoTitulo.current?.select());
        },
      },
    );
  }

  const classeCampo = `w-full rounded-controle border border-ink-700 bg-ink-900 px-2.5 py-1.5
                       text-sm text-ink-200 outline-none transition-colors
                       focus:border-accent-400`;

  return (
    <Dialogo aberto onFechar={onFechar} rotulo="Virar nota" focoInicial={campoTitulo}>
      <form onSubmit={enviar} className="p-5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-controle
                       bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-e1"
          >
            <IconeVirarNota className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-titulo">Virar nota</h2>
            <p className="text-xs text-ink-400">
              A resposta vira uma nota nova, marcada como gerada por IA.
            </p>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="rotulo">Título</span>
          <input
            ref={campoTitulo}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={MAX_TITULO}
            aria-invalid={erro?.doTitulo ? "true" : undefined}
            aria-describedby={erro ? idErro : undefined}
            className={`mt-1 ${classeCampo} aria-invalid:border-red-300/60`}
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="rotulo">Tipo</span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as NoteKind)}
              className={`mt-1 ${classeCampo}`}
            >
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="rotulo">Workspace</span>
            <select
              value={workspaceId ?? ""}
              onChange={(e) => setWorkspaceId(e.target.value || null)}
              className={`mt-1 ${classeCampo}`}
            >
              <option value="">sem workspace</option>
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {erro && (
          <div id={idErro} className="mt-3">
            <Aviso tom="erro" onFechar={() => setErro(null)}>
              {erro.mensagem}
            </Aviso>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Botao variante="fantasma" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao
            type="submit"
            variante="ia"
            carregando={virar.isPending}
            icone={<IconeVirarNota className="size-3.5" />}
          >
            Criar nota
          </Botao>
        </div>
      </form>
    </Dialogo>
  );
}

/**
 * As ações da fala: copiar e virar nota, uma ao lado da outra — a ação mora
 * junto da fala, não num menu à parte. Vão na fileira `acoes` da
 * `FalaAssistente`, que as mostra com o ponteiro em cima ou o foco dentro.
 */
function Acoes({
  mensagem,
  conversa,
  onNotaCriada,
}: {
  mensagem: ChatMessage;
  conversa: Conversation | undefined;
  onNotaCriada: (nota: NoteDetail) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [virando, setVirando] = useState(false);
  return (
    <>
      <BotaoIcone
        rotulo="Copiar a resposta"
        tamanho="p"
        // A cor e o glifo vão no ícone: no botão, a cor da variante vence.
        icone={
          copiado ? (
            <IconeCheck className="size-3.5 text-emerald-300" />
          ) : (
            <IconeCopiar className="size-3.5" />
          )
        }
        onClick={() => {
          void navigator.clipboard.writeText(mensagem.content).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          });
        }}
      />
      {conversa && (
        <BotaoIcone
          rotulo="Virar nota"
          tamanho="p"
          icone={<IconeVirarNota className="size-3.5" />}
          onClick={() => setVirando(true)}
          aria-haspopup="dialog"
        />
      )}
      {/* RNF-09: o resultado é anunciado, não só colorido. */}
      <span aria-live="polite" className="ml-0.5 text-miudo text-emerald-300">
        {copiado ? "copiado" : ""}
      </span>
      {virando && conversa && (
        // O `Esc` do diálogo também sobe pela árvore do React, portal ou não,
        // até o `<aside>` do painel — que fecharia junto. O painel ignora o
        // `Esc` já tratado (`defaultPrevented`); `stopPropagation` aqui calaria
        // o ouvinte do próprio diálogo, que mora no `document`.
        <div
          className="contents"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <DialogoVirarNota
            conversationId={conversa.id}
            messageId={mensagem.id}
            sugestao={tituloSugerido(mensagem.content, conversa.title)}
            onFechar={() => setVirando(false)}
            onCriada={(nota) => {
              setVirando(false);
              onNotaCriada(nota);
            }}
          />
        </div>
      )}
    </>
  );
}

function Fala({
  mensagem,
  onAbrir,
  conversa,
  onNotaCriada,
  agente,
}: {
  mensagem: ChatMessage;
  onAbrir: (f: ChatSource) => void;
  conversa: Conversation | undefined;
  onNotaCriada: (nota: NoteDetail) => void;
  agente: ConversationAgent | null;
}) {
  if (mensagem.role === "tool") return null;

  if (mensagem.role === "user") {
    return (
      <BalaoUsuario
        texto={mensagem.content}
        anexos={mensagem.attachments.map((a) => ({ chave: a.id, titulo: a.title }))}
      />
    );
  }

  /// Fala de assistente sem texto é a que só pediu ferramenta. O passo já foi
  /// anunciado enquanto acontecia; repetir um balão vazio aqui é ruído. A
  /// exceção é a fala cortada pelo teto depois de criar algo: o desfazer
  /// precisa continuar à mão.
  if (!mensagem.content.trim()) {
    if (mensagem.created.length === 0) return null;
    return (
      <FalaAssistente avatar={avatarDe(agente)}>
        <Criados criados={mensagem.created} onAbrirFonte={onAbrir} />
      </FalaAssistente>
    );
  }

  return (
    <FalaAssistente
      avatar={avatarDe(agente)}
      // Sanitizado por DOMPurify dentro do átomo (INV-09, RNF-05): texto de
      // modelo é entrada não confiável como qualquer outra.
      markdown={mensagem.content}
      acoes={<Acoes mensagem={mensagem} conversa={conversa} onNotaCriada={onNotaCriada} />}
      marca={
        // RF-25: qual modelo respondeu **esta** mensagem — a escolha pode mudar
        // entre uma e outra. Discreto, mas sempre à vista: não some com as ações.
        mensagem.modelUsed ? (
          <span title="Modelo que respondeu">
            <span className="sr-only">Modelo que respondeu: </span>
            {mensagem.modelUsed}
          </span>
        ) : undefined
      }
    >
      <Fontes fontes={mensagem.sources} onAbrir={onAbrir} />
      {/* Só monta com conteúdo: o bloco assina o estado da sessão, que muda a
          cada pedaço da resposta, e toda fala antiga repintaria junto. */}
      {mensagem.created.length > 0 && (
        <Criados criados={mensagem.created} onAbrirFonte={onAbrir} />
      )}
    </FalaAssistente>
  );
}

export function Conversa({
  onAbrirFonte,
  onNotaCriada,
  vazio,
  compacto = false,
}: {
  onAbrirFonte: (f: ChatSource) => void;
  /** A casca mostra o `Toast` — a pilha do que flutua mora nela, não aqui. */
  onNotaCriada: (nota: NoteDetail) => void;
  /** O que mostrar numa conversa sem falas — cada superfície tem o seu convite. */
  vazio: ReactNode;
  /** O painel lateral: o convite do agente escolhido vai no tamanho dele. */
  compacto?: boolean;
}) {
  const { conversaId, emCurso: fluxo, erro, limparErro } = useSessaoChat();
  const agente = useAgenteDaConversa();
  const { data: conversa } = useConversa(conversaId);
  const fimRef = useRef<HTMLDivElement>(null);
  const mensagens = conversaId ? (conversa?.messages ?? []) : [];
  /// A fala em curso só aparece na conversa a que pertence: escolher outra no
  /// meio da resposta não pode pendurar o balão nas falas de outra conversa.
  const emCurso = fluxo && fluxo.conversaId === conversaId ? fluxo : null;
  const visiveis = useMemo(() => semOTurnoEmCurso(mensagens, emCurso), [mensagens, emCurso]);

  /// Rolar para o fim a cada pedaço que chega: uma resposta que cresce fora da
  /// área visível é uma resposta que ninguém vê chegando.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [emCurso?.texto, mensagens.length]);

  return (
    <div className="space-y-6">
      {mensagens.length === 0 &&
        !emCurso &&
        (agente.resumo ? (
          <ApresentacaoAgente agente={agente.resumo} compacto={compacto} />
        ) : (
          vazio
        ))}

      {visiveis.map((m) => (
        <Fala
          key={m.id}
          mensagem={m}
          onAbrir={onAbrirFonte}
          conversa={conversa}
          onNotaCriada={onNotaCriada}
          agente={agente.identidade}
        />
      ))}

      {emCurso && (
        <>
          <BalaoUsuario
            texto={emCurso.pergunta}
            anexos={emCurso.anexos.map((a) => ({ chave: alvoDe(a), titulo: a.titulo }))}
          />
          <FalaAssistente
            avatar={avatarDe(agente.identidade)}
            // Sanitizado por DOMPurify no átomo, a cada pedaço (INV-09).
            markdown={emCurso.texto}
            status={
              // RNF-07: o passo é anunciado, e o texto visível é a própria região.
              <StatusDaResposta
                ferramenta={emCurso.ferramenta}
                buscando={emCurso.buscando}
                temTexto={Boolean(emCurso.texto)}
              />
            }
          >
            <Fontes fontes={emCurso.fontes} onAbrir={onAbrirFonte} />
            {emCurso.criados.length > 0 && (
              <Criados criados={emCurso.criados} onAbrirFonte={onAbrirFonte} />
            )}
            {emCurso.cortados.length > 0 && (
              // RNF-04: o limite de contexto é **declarado** quando corta.
              <p role="status" className="mt-1 text-xs text-amber-300">
                Não coube no contexto e ficou de fora: {emCurso.cortados.join(", ")}.
              </p>
            )}
            {emCurso.premissasCortadas.length > 0 && (
              // O mesmo RNF-04 para as premissas do agente (Etapa D): a nota-base
              // que não coube é dita, não omitida.
              <p role="status" className="mt-1 text-xs text-amber-300">
                Premissas do agente que não couberam e ficaram de fora:{" "}
                {emCurso.premissasCortadas.join(", ")}.
              </p>
            )}
          </FalaAssistente>
        </>
      )}

      {erro && (
        <Aviso tom="erro" onFechar={limparErro}>
          {erro.mensagem}
          {/* O modelo do agente saiu dos favoritos: quem resolve é o editor
              dele, não Ajustes — o agente não usa o modelo do chat. */}
          {erro.code === "MODELO_NAO_ESCOLHIDO" && agente.identidade?.id && (
            <>
              {" "}
              <Link
                to={`/assistente/agentes/${agente.identidade.id}`}
                className="font-medium underline underline-offset-2"
              >
                Editar o agente
              </Link>
            </>
          )}
        </Aviso>
      )}
      <div ref={fimRef} />
    </div>
  );
}
