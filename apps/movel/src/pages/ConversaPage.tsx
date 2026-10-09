import type { AgentSummary, ChatMessage, ConversationAgent } from "@yu-book/shared";
import { useAuth } from "@yu-book/cliente/auth";
import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { semOTurnoEmCurso, useConversa } from "@yu-book/cliente/chat";
import { AvatarAgente } from "@yu-book/cliente/chat/AvatarAgente";
import { AvatarIA } from "@yu-book/cliente/chat/AvatarIA";
import { BalaoUsuario } from "@yu-book/cliente/chat/BalaoUsuario";
import { BoasVindas } from "@yu-book/cliente/chat/BoasVindas";
import { CampoMensagem } from "@yu-book/cliente/chat/CampoMensagem";
import { FalaAssistente } from "@yu-book/cliente/chat/FalaAssistente";
import { StatusDaResposta } from "@yu-book/cliente/chat/StatusDaResposta";
import { SUGESTOES_INICIAIS, Sugestoes } from "@yu-book/cliente/chat/Sugestoes";
import { IconeCheck, IconeChevron, IconeCopiar } from "@yu-book/cliente/icones";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Criados } from "../components/chat/Criados";
import { FolhaAgente } from "../components/chat/FolhaAgente";
import { NO_COMPUTADOR, useAgentes, useMotivoSemChat } from "../lib/ia";
import { useEnvioChat } from "../lib/sessaoChat";
import type { ErroChat } from "../lib/sessaoChat";
import { primeiroNome } from "../lib/saudacao";
import { useAreaVisivel } from "../lib/viewport";

/**
 * A conversa no móvel (Fase 5 da frente de agenda), em tela cheia: a barra
 * inferior some — a casca não a monta aqui —, o cabeçalho tem o voltar, e o
 * compositor fica preso ao pé **acima do teclado** (`useAreaVisivel`).
 *
 * `/assistente/nova` é a conversa ainda vazia: a escolha do agente existe só
 * nela, e a conversa nasce no primeiro envio, como no web. Ao nascer, a rota
 * troca para `/assistente/:id` com `replace` — a mesma rota da casca, então
 * esta tela **não remonta** e o fluxo segue; o Voltar não volta à vazia.
 *
 * O desenho é o dos átomos de `@yu-book/cliente/chat/`, os mesmos do web.
 * Sair da tela solta a conexão (`useEnvioChat`).
 */

/** Códigos cujo conserto mora em `/ajustes` do web — o aviso diz onde. */
const RESOLVE_NO_COMPUTADOR = new Set([
  "MODELO_NAO_ESCOLHIDO",
  "MODELO_SEM_FERRAMENTA",
  "PROVEDOR_INDISPONIVEL",
  "COTA_EXCEDIDA",
  "TETO_DIARIO_ATINGIDO",
]);

/** No toque não há "Enter envia": o Enter do teclado virtual quebra a linha. */
const TOQUE =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

function avatarDe(agente: ConversationAgent | null) {
  if (!agente) return undefined;
  return (
    <AvatarAgente nome={agente.name} cor={agente.color} rotulado excluido={agente.id === null} />
  );
}

function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Copiar a resposta"
        title="Copiar a resposta"
        onClick={() => {
          void navigator.clipboard.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          });
        }}
        className="flex size-8 items-center justify-center rounded-full text-ink-400
                   transition-colors hover:bg-ink-800 hover:text-ink-200 active:bg-ink-800
                   pointer-coarse:size-11"
      >
        {copiado ? (
          <IconeCheck className="size-4 text-emerald-300" />
        ) : (
          <IconeCopiar className="size-4" />
        )}
      </button>
      {/* RNF-09: o resultado é anunciado, não só colorido. */}
      <span aria-live="polite" className="text-miudo text-emerald-300">
        {copiado ? "copiado" : ""}
      </span>
    </>
  );
}

function Fala({
  mensagem,
  agente,
  desfeitos,
  onDesfeito,
}: {
  mensagem: ChatMessage;
  agente: ConversationAgent | null;
  desfeitos: ReadonlySet<string>;
  onDesfeito: (chave: string) => void;
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
  const criados =
    mensagem.created.length > 0 ? (
      <Criados criados={mensagem.created} desfeitos={desfeitos} onDesfeito={onDesfeito} />
    ) : null;
  /// Fala só de ferramenta: o passo já foi anunciado; fica só o que ela criou.
  if (!mensagem.content.trim()) {
    return criados ? <FalaAssistente avatar={avatarDe(agente)}>{criados}</FalaAssistente> : null;
  }
  return (
    <FalaAssistente
      avatar={avatarDe(agente)}
      markdown={mensagem.content}
      acoes={<Copiar texto={mensagem.content} />}
      marca={
        // RF-25: qual modelo respondeu esta mensagem.
        mensagem.modelUsed ? (
          <span title="Modelo que respondeu">
            <span className="sr-only">Modelo que respondeu: </span>
            {mensagem.modelUsed}
          </span>
        ) : undefined
      }
    >
      {criados}
    </FalaAssistente>
  );
}

/** A conversa vazia com agente escolhido: quem vai responder, antes da primeira mensagem. */
function Apresentacao({ agente }: { agente: AgentSummary }) {
  return (
    <div className="flex flex-col items-start pt-2">
      <AvatarAgente nome={agente.name} cor={agente.color} tamanho="xg" />
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-titulo">{agente.name}</h2>
      {agente.description && (
        <p className="mt-1.5 text-sm text-ink-400">{agente.description}</p>
      )}
      <p className="mt-3 text-xs text-ink-400">
        As premissas do agente entram em toda mensagem. Ele se edita no computador.
      </p>
    </div>
  );
}

function AvisoDeErro({ erro, onFechar }: { erro: ErroChat; onFechar: () => void }) {
  return (
    <Aviso tom="erro" onFechar={onFechar}>
      {erro.mensagem}
      {erro.code && RESOLVE_NO_COMPUTADOR.has(erro.code) && <> {NO_COMPUTADOR}</>}
    </Aviso>
  );
}

export function ConversaPage() {
  const { id = "nova" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const nova = id === "nova";
  const conversaId = nova ? null : id;
  const { data: conversa, error: erroConversa } = useConversa(conversaId);
  const { data: agentes } = useAgentes();
  const sessao = useEnvioChat();
  const area = useAreaVisivel();

  const [texto, setTexto] = useState("");
  /// O agente da próxima conversa, enquanto ela não existe (Etapa D). Fica
  /// guardado depois de criada: até o detalhe chegar, é ele quem responde.
  const [agenteId, setAgenteId] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  /// O que foi desfeito do que o chat criou — sobrevive à passagem da fala em
  /// curso para a gravada, e um "Desfazer" não reaparece.
  const [desfeitos, setDesfeitos] = useState<ReadonlySet<string>>(() => new Set());
  const marcarDesfeito = useCallback(
    (chave: string) => setDesfeitos((atual) => new Set(atual).add(chave)),
    [],
  );

  const campo = useRef<HTMLTextAreaElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const idMotivo = useId();

  const escolhido = agenteId ? (agentes?.find((a) => a.id === agenteId) ?? null) : null;
  const identidade: ConversationAgent | null = conversa
    ? conversa.agent
    : escolhido
      ? { id: escolhido.id, name: escolhido.name, color: escolhido.color }
      : null;
  const resumo = identidade?.id ? (agentes?.find((a) => a.id === identidade.id) ?? null) : null;
  const excluido = Boolean(identidade && identidade.id === null);
  const motivoGeral = useMotivoSemChat(resumo);
  const motivo = excluido
    ? "O agente desta conversa foi excluído — comece uma conversa nova."
    : motivoGeral;

  const emCurso = sessao.emCurso;
  const mensagens = useMemo(() => conversa?.messages ?? [], [conversa]);
  const visiveis = useMemo(() => semOTurnoEmCurso(mensagens, emCurso), [mensagens, emCurso]);
  const vazia = visiveis.length === 0 && !emCurso;
  const naoExiste = erroConversa instanceof ApiError && erroConversa.code === "NOT_FOUND";

  /// Rolar ao fim a cada pedaço, e quando o teclado sobe e encolhe a área:
  /// só o contêiner, nunca `scrollIntoView`, que rolaria a página junto.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [emCurso?.texto, emCurso?.criados.length, visiveis.length, area.altura]);

  /// `visivel` é o que o compositor mostra: com o ditado ouvindo, `texto` mais
  /// o parcial, que ainda não chegou a `setTexto`.
  function enviar(visivel: string) {
    if (!visivel.trim() || sessao.respondendo || motivo) return;
    const pergunta = visivel;
    setTexto("");
    void sessao.enviar({
      conversaId,
      pergunta,
      agenteId: nova ? agenteId : null,
      aoCriar: (novoId) => navigate(`/assistente/${novoId}`, { replace: true }),
      aoRecusar: (p) => setTexto((t) => t || p),
    });
  }

  /// O wikilink da resposta é `href="#"`: no móvel não há tela de nota, e o
  /// toque não pode levar a página ao topo.
  function aoTocar(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("a.wikilink")) e.preventDefault();
  }

  const titulo = nova ? "Nova conversa" : (conversa?.title ?? "…");
  const quem = identidade?.name ?? "Assistente";

  let seletor: ReactNode;
  if (nova && !emCurso) {
    seletor = (
      <button
        type="button"
        onClick={() => setEscolhendo(true)}
        aria-haspopup="dialog"
        aria-expanded={escolhendo}
        className="inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full pl-1.5 pr-2.5
                   text-sm font-medium text-ink-200 transition-colors active:bg-ink-800
                   hover:bg-ink-800 lg:h-8 lg:text-xs"
      >
        <span className="sr-only">Conversar com: </span>
        {escolhido ? (
          <AvatarAgente nome={escolhido.name} cor={escolhido.color} tamanho="m" />
        ) : (
          <span className="flex size-6 items-center justify-center [&>span]:size-6">
            <AvatarIA />
          </span>
        )}
        <span className="max-w-[14ch] truncate">{escolhido?.name ?? "Assistente"}</span>
        <IconeChevron className="size-3.5 text-ink-400" />
      </button>
    );
  }

  return (
    <div
      // O teclado encolhe só a área visível: a tela segue a altura dela, e o
      // compositor, no pé, fica sempre à vista. Sem a API, `100dvh`.
      style={
        area.altura !== null
          ? { height: area.altura, transform: `translateY(${area.topo}px)` }
          : undefined
      }
      className="fixed inset-x-0 top-0 z-10 flex h-dvh flex-col bg-ink-950 lg:left-28"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-accent-500 via-ia-500
                   to-accent-500/0"
      />
      <header
        className="flex shrink-0 items-center gap-2 border-b border-ink-800/70 px-2 pb-2
                   pt-[calc(env(safe-area-inset-top)+0.5rem)]"
      >
        <Link
          to="/assistente"
          aria-label="Voltar para as conversas"
          title="Voltar para as conversas"
          className="flex size-11 shrink-0 items-center justify-center rounded-full
                     text-ink-200 transition-colors active:bg-ink-800 hover:bg-ink-800"
        >
          <IconeChevron direcao="esquerda" className="size-5" />
        </Link>
        <span className="flex size-9 shrink-0 items-center justify-center">
          {identidade ? (
            <AvatarAgente
              nome={identidade.name}
              cor={identidade.color}
              tamanho="g"
              excluido={excluido}
            />
          ) : (
            <AvatarIA />
          )}
        </span>
        <div className="min-w-0 flex-1 pr-2">
          <h1 className="truncate text-base font-semibold text-titulo">{titulo}</h1>
          <p className="truncate text-xs text-ink-400">
            {identidade ? `com ${quem}` : "Assistente"}
            {excluido && " · agente excluído"}
          </p>
        </div>
      </header>

      <div
        ref={rolagem}
        onClick={aoTocar}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-6 pt-5">
          {naoExiste ? (
            <Aviso tom="alerta">
              Esta conversa não existe mais.{" "}
              <Link to="/assistente" className="font-medium underline underline-offset-2">
                Ver as conversas
              </Link>
            </Aviso>
          ) : (
            vazia &&
            nova &&
            (escolhido ? (
              <Apresentacao agente={escolhido} />
            ) : (
              <BoasVindas
                compacto
                nome={primeiroNome(user?.name ?? "")}
                descricao={
                  "Procuro nas suas notas e quadros, e anoto na agenda o que você pedir. " +
                  "Fale ou escreva."
                }
              >
                <Sugestoes
                  itens={SUGESTOES_INICIAIS}
                  rotulo="Sugestões para começar"
                  // Preenche e foca, nunca envia: o usuário revê antes.
                  onEscolher={(t) => {
                    setTexto(t);
                    campo.current?.focus();
                  }}
                />
              </BoasVindas>
            ))
          )}

          {visiveis.map((m) => (
            <Fala
              key={m.id}
              mensagem={m}
              agente={identidade}
              desfeitos={desfeitos}
              onDesfeito={marcarDesfeito}
            />
          ))}

          {emCurso && (
            <>
              <BalaoUsuario texto={emCurso.pergunta} />
              <FalaAssistente
                avatar={avatarDe(identidade)}
                markdown={emCurso.texto}
                status={
                  <StatusDaResposta
                    ferramenta={emCurso.ferramenta}
                    buscando={emCurso.buscando}
                    temTexto={Boolean(emCurso.texto)}
                  />
                }
              >
                {emCurso.criados.length > 0 && (
                  <Criados
                    criados={emCurso.criados}
                    desfeitos={desfeitos}
                    onDesfeito={marcarDesfeito}
                  />
                )}
                {emCurso.cortados.length > 0 && (
                  // RNF-04: o limite de contexto é declarado quando corta.
                  <p role="status" className="mt-2 text-xs text-amber-300">
                    Não coube no contexto e ficou de fora: {emCurso.cortados.join(", ")}.
                  </p>
                )}
                {emCurso.premissasCortadas.length > 0 && (
                  <p role="status" className="mt-2 text-xs text-amber-300">
                    Premissas do agente que não couberam:{" "}
                    {emCurso.premissasCortadas.join(", ")}.
                  </p>
                )}
              </FalaAssistente>
            </>
          )}

          {sessao.erro && <AvisoDeErro erro={sessao.erro} onFechar={sessao.limparErro} />}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <div className="mx-auto w-full max-w-3xl">
          {motivo && (
            <Aviso tom="alerta" className="mb-2">
              <span id={idMotivo}>{motivo}</span>{" "}
              {excluido ? (
                <Link to="/assistente/nova" className="font-medium underline underline-offset-2">
                  Nova conversa
                </Link>
              ) : (
                NO_COMPUTADOR
              )}
            </Aviso>
          )}
          <CampoMensagem
            valor={texto}
            onMudar={setTexto}
            onEnviar={enviar}
            onParar={sessao.parar}
            respondendo={sessao.respondendo}
            podeEnviar={!motivo && Boolean(texto.trim())}
            desabilitado={Boolean(motivo)}
            campoRef={campo}
            descritoPor={motivo ? idMotivo : undefined}
            placeholder={
              identidade ? `Escreva para ${quem}…` : "Pergunte ou peça alguma coisa…"
            }
            esquerda={seletor}
            enviarComEnter={!TOQUE}
            toque={TOQUE}
            teto={160}
            dica={TOQUE ? undefined : "Enter envia · Shift+Enter quebra a linha"}
          />
        </div>
      </div>

      <FolhaAgente
        aberta={escolhendo}
        agentes={agentes ?? []}
        escolhido={agenteId}
        onEscolher={setAgenteId}
        onFechar={() => setEscolhendo(false)}
      />
    </div>
  );
}
