import type { ChatMessage, ConversationAgent } from "@yu-book/shared";
import { useAuth } from "@yu-book/cliente/auth";
import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { semOTurnoEmCurso, useConversa } from "@yu-book/cliente/chat";
import { AvatarAgente } from "@yu-book/cliente/chat/AvatarAgente";
import { AvatarIA } from "@yu-book/cliente/chat/AvatarIA";
import { BalaoUsuario } from "@yu-book/cliente/chat/BalaoUsuario";
import { CampoMensagem } from "@yu-book/cliente/chat/CampoMensagem";
import { FalaAssistente } from "@yu-book/cliente/chat/FalaAssistente";
import { StatusDaResposta } from "@yu-book/cliente/chat/StatusDaResposta";
import { Sugestoes } from "@yu-book/cliente/chat/Sugestoes";
import type { Sugestao } from "@yu-book/cliente/chat/Sugestoes";
import {
  IconeCalendario,
  IconeChevron,
  IconeConversas,
  IconeHoje,
  IconeRecomecar,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { Criados } from "../components/chat/Criados";
import { FolhaAgente } from "../components/chat/FolhaAgente";
import { GatoPixel } from "../components/chat/GatoPixel";
import type { EstadoDoGato } from "../components/chat/GatoPixel";
import { NO_COMPUTADOR, useAgentes, useMotivoSemChat } from "../lib/ia";
import { primeiroNome } from "../lib/saudacao";
import { useEnvioChat } from "../lib/sessaoChat";
import { useAreaVisivel } from "../lib/viewport";

/**
 * O assistente rápido do celular: pedir, ver feito, sair. Uma ou duas
 * interações — "marca dentista sexta às 15h", "na verdade às 16h" —, e por
 * isso a conversa é **descartável**: nasce com `ephemeral`, fica fora da lista
 * e o servidor a apaga 24 h depois. Ela existe só para a segunda interação ler
 * a primeira.
 *
 * O agente fica fixo no aparelho (o de agenda, se é o que se usa): trocar
 * recomeça, porque o agente é fixo por conversa (Etapa D). A conversa em curso
 * sobrevive a sair e voltar por meia hora; depois, a tela abre limpa.
 *
 * O envio, o redutor e a regra de soltar a conexão ao sair são os da conversa
 * comum (`useEnvioChat`, INV-56). As conversas guardadas ficam a um toque, em
 * `/assistente/conversas`.
 */

const CHAVE_AGENTE = "yb-rapido-agente";
const CHAVE_CONVERSA = "yb-rapido-conversa";
/** Por quanto tempo voltar à tela retoma a conversa rápida em vez de abrir limpa. */
const RETOMA_MS = 30 * 60_000;

/// O aparelho guarda o agente e a conversa em curso. Falhar ao ler ou gravar
/// (janela privada, armazenamento cheio) só faz a tela abrir com o padrão.
function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    // Sem armazenamento: vale enquanto a tela está aberta.
  }
}

function conversaRecente(): string | null {
  const bruto = ler(CHAVE_CONVERSA);
  if (!bruto) return null;
  try {
    const { id, em } = JSON.parse(bruto) as { id?: string; em?: number };
    return id && em && Date.now() - em < RETOMA_MS ? id : null;
  } catch {
    return null;
  }
}

function lembrarConversa(id: string | null): void {
  gravar(CHAVE_CONVERSA, id ? JSON.stringify({ id, em: Date.now() }) : null);
}

/** Preenchem o campo, nunca enviam: o pedido se revê antes. */
const SUGESTOES: Sugestao[] = [
  { texto: "O que tenho hoje?", icone: <IconeHoje className="size-3.5" /> },
  {
    texto: "Marca dentista na sexta às 15h",
    icone: <IconeCalendario className="size-3.5" />,
  },
  {
    texto: "Anota: pagar a conta de luz amanhã",
    icone: <IconeTarefa className="size-3.5" />,
  },
];

/** No toque não há "Enter envia": o Enter do teclado virtual quebra a linha. */
const TOQUE =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const RESOLVE_NO_COMPUTADOR = new Set([
  "MODELO_NAO_ESCOLHIDO",
  "MODELO_SEM_FERRAMENTA",
  "PROVEDOR_INDISPONIVEL",
  "COTA_EXCEDIDA",
  "TETO_DIARIO_ATINGIDO",
]);

function avatarDe(agente: ConversationAgent | null) {
  if (!agente) return undefined;
  return <AvatarAgente nome={agente.name} cor={agente.color} excluido={agente.id === null} />;
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
  if (mensagem.role === "user") return <BalaoUsuario texto={mensagem.content} />;
  const criados =
    mensagem.created.length > 0 ? (
      <Criados criados={mensagem.created} desfeitos={desfeitos} onDesfeito={onDesfeito} />
    ) : null;
  if (!mensagem.content.trim()) {
    return criados ? <FalaAssistente avatar={avatarDe(agente)}>{criados}</FalaAssistente> : null;
  }
  return (
    <FalaAssistente avatar={avatarDe(agente)} markdown={mensagem.content}>
      {criados}
    </FalaAssistente>
  );
}

export function AssistenteRapidoPage() {
  const { user } = useAuth();
  const { data: agentes } = useAgentes();
  const sessao = useEnvioChat();
  const area = useAreaVisivel();

  const [agenteId, setAgenteId] = useState<string | null>(() => ler(CHAVE_AGENTE));
  const [conversaId, setConversaId] = useState<string | null>(conversaRecente);
  const { data: conversa, error: erroConversa } = useConversa(conversaId);
  const [texto, setTexto] = useState("");
  const [escolhendo, setEscolhendo] = useState(false);
  const [desfeitos, setDesfeitos] = useState<ReadonlySet<string>>(() => new Set());
  const marcarDesfeito = useCallback(
    (chave: string) => setDesfeitos((atual) => new Set(atual).add(chave)),
    [],
  );
  const campo = useRef<HTMLTextAreaElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const idMotivo = useId();

  // A conversa guardada que não existe mais (apagada pelo servidor): abre limpa.
  useEffect(() => {
    if (erroConversa instanceof ApiError && erroConversa.code === "NOT_FOUND") {
      lembrarConversa(null);
      setConversaId(null);
    }
  }, [erroConversa]);

  /// O agente guardado que foi excluído volta ao Assistente. Só depois de a
  /// lista chegar: antes dela, o id ainda pode ser bom.
  const escolhido = agenteId ? (agentes?.find((a) => a.id === agenteId) ?? null) : null;
  useEffect(() => {
    if (agentes && agenteId && !escolhido) {
      gravar(CHAVE_AGENTE, null);
      setAgenteId(null);
    }
  }, [agentes, agenteId, escolhido]);

  const identidade: ConversationAgent | null = conversa
    ? conversa.agent
    : escolhido
      ? { id: escolhido.id, name: escolhido.name, color: escolhido.color }
      : null;
  const resumo = identidade?.id ? (agentes?.find((a) => a.id === identidade.id) ?? null) : null;
  const motivo = useMotivoSemChat(resumo);

  const emCurso = sessao.emCurso;
  const mensagens = useMemo(() => conversa?.messages ?? [], [conversa]);
  const visiveis = useMemo(() => semOTurnoEmCurso(mensagens, emCurso), [mensagens, emCurso]);
  const vazia = visiveis.length === 0 && !emCurso;

  /// O gato acompanha a resposta: pensa enquanto ela corre, comemora quando a
  /// última fala criou alguma coisa, estranha o erro e espera no resto.
  const ultima = visiveis.at(-1);
  const criouAgora = (emCurso?.criados.length ?? 0) > 0;
  const criouNaUltima = ultima?.role === "assistant" && ultima.created.length > 0;
  const estado: EstadoDoGato = sessao.erro
    ? "erro"
    : sessao.respondendo
      ? criouAgora
        ? "feito"
        : "pensando"
      : criouNaUltima
        ? "feito"
        : "parado";

  const quem = identidade?.name ?? "Assistente";
  const legenda =
    estado === "pensando"
      ? null
      : estado === "feito"
        ? "Feito. Confira abaixo, ou peça um ajuste."
        : estado === "erro"
          ? "Algo deu errado."
          : vazia
            ? `Oi${user?.name ? `, ${primeiroNome(user.name)}` : ""}! O que eu anoto?`
            : "Mais alguma coisa?";

  useLayoutEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [emCurso?.texto, emCurso?.criados.length, visiveis.length, area.altura]);

  function recomecar() {
    sessao.parar();
    sessao.limparErro();
    lembrarConversa(null);
    setConversaId(null);
    setDesfeitos(new Set());
    setTexto("");
    campo.current?.focus();
  }

  function escolherAgente(id: string | null) {
    setAgenteId(id);
    gravar(CHAVE_AGENTE, id);
    // O agente é fixo por conversa: trocar recomeça.
    if (id !== (conversa?.agent?.id ?? agenteId)) recomecar();
  }

  function enviar(visivel: string) {
    if (!visivel.trim() || sessao.respondendo || motivo) return;
    setTexto("");
    void sessao.enviar({
      conversaId,
      pergunta: visivel,
      agenteId: conversaId ? null : agenteId,
      efemera: true,
      aoCriar: (id) => {
        lembrarConversa(id);
        setConversaId(id);
      },
      aoRecusar: (p) => setTexto((t) => t || p),
    });
    if (conversaId) lembrarConversa(conversaId);
  }

  function aoTocar(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("a.wikilink")) e.preventDefault();
  }

  return (
    <div
      style={
        area.altura !== null
          ? { height: area.altura, transform: `translateY(${area.topo}px)` }
          : undefined
      }
      className="fixed inset-x-0 top-0 z-10 flex h-dvh flex-col bg-ink-950 lg:left-28"
    >
      <div aria-hidden="true" className="veu-topo pointer-events-none absolute inset-x-0 top-0 h-72" />
      <header
        className="relative flex shrink-0 items-center gap-1 px-2 pb-1
                   pt-[calc(env(safe-area-inset-top)+0.5rem)]"
      >
        <Link
          to="/"
          aria-label="Voltar ao Início"
          title="Voltar ao Início"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-200
                     transition-colors active:bg-ink-800 hover:bg-ink-800"
        >
          <IconeChevron direcao="esquerda" className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-titulo">Assistente</h1>
        {!vazia && (
          <button
            type="button"
            onClick={recomecar}
            aria-label="Começar de novo"
            title="Começar de novo"
            className="flex size-11 items-center justify-center rounded-full text-ink-200
                       transition-colors active:bg-ink-800 hover:bg-ink-800"
          >
            <IconeRecomecar className="size-5" />
          </button>
        )}
        <Link
          to="/assistente/conversas"
          aria-label="Conversas guardadas"
          title="Conversas guardadas"
          className="flex size-11 items-center justify-center rounded-full text-ink-200
                     transition-colors active:bg-ink-800 hover:bg-ink-800"
        >
          <IconeConversas className="size-5" />
        </Link>
      </header>

      <div
        ref={rolagem}
        onClick={aoTocar}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 pb-4">
          {/* O gato e a legenda: grande com a tela vazia, menor na conversa. */}
          <div
            className={`flex flex-col items-center text-center transition-all duration-300 ${
              vazia ? "flex-1 justify-center gap-4 pb-6" : "gap-2 pb-4 pt-1"
            }`}
          >
            <GatoPixel
              estado={estado}
              className={`transition-all duration-300 ${vazia ? "w-40" : "w-20"}`}
            />
            <div aria-live="polite" className="min-h-6">
              {estado === "pensando" && emCurso ? (
                <StatusDaResposta
                  ferramenta={emCurso.ferramenta}
                  buscando={emCurso.buscando}
                  temTexto={Boolean(emCurso.texto)}
                />
              ) : (
                legenda && (
                  <p
                    className={`font-semibold text-titulo ${vazia ? "text-xl tracking-tight" : "text-sm"}`}
                  >
                    {legenda}
                  </p>
                )
              )}
            </div>
            {vazia && (
              <Sugestoes
                itens={SUGESTOES}
                rotulo="Sugestões"
                centralizar
                onEscolher={(t) => {
                  setTexto(t);
                  campo.current?.focus();
                }}
              />
            )}
          </div>

          <div className="space-y-5">
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
                {(emCurso.texto || emCurso.criados.length > 0) && (
                  <FalaAssistente avatar={avatarDe(identidade)} markdown={emCurso.texto}>
                    {emCurso.criados.length > 0 && (
                      <Criados
                        criados={emCurso.criados}
                        desfeitos={desfeitos}
                        onDesfeito={marcarDesfeito}
                      />
                    )}
                  </FalaAssistente>
                )}
              </>
            )}
            {sessao.erro && (
              <Aviso tom="erro" onFechar={sessao.limparErro}>
                {sessao.erro.mensagem}
                {sessao.erro.code && RESOLVE_NO_COMPUTADOR.has(sessao.erro.code) && (
                  <> {NO_COMPUTADOR}</>
                )}
              </Aviso>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <div className="mx-auto w-full max-w-xl">
          {motivo && (
            <Aviso tom="alerta" className="mb-2">
              <span id={idMotivo}>{motivo}</span> {NO_COMPUTADOR}
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
            placeholder="Fale ou escreva o que anotar…"
            esquerda={
              <button
                type="button"
                onClick={() => setEscolhendo(true)}
                aria-haspopup="dialog"
                aria-expanded={escolhendo}
                disabled={sessao.respondendo}
                className="inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full pl-1.5
                           pr-2.5 text-sm font-medium text-ink-200 transition-colors
                           active:bg-ink-800 hover:bg-ink-800 disabled:opacity-50"
              >
                <span className="sr-only">Falando com: </span>
                {identidade ? (
                  <AvatarAgente nome={identidade.name} cor={identidade.color} tamanho="m" />
                ) : (
                  <span className="flex size-6 items-center justify-center [&>span]:size-6">
                    <AvatarIA />
                  </span>
                )}
                <span className="max-w-[14ch] truncate">{quem}</span>
                <IconeChevron className="size-3.5 text-ink-400" />
              </button>
            }
            enviarComEnter={!TOQUE}
            toque={TOQUE}
            teto={120}
          />
          <p className="mt-1.5 text-center text-miudo text-ink-400">
            Esta conversa não fica guardada.
          </p>
        </div>
      </div>

      <FolhaAgente
        aberta={escolhendo}
        agentes={agentes ?? []}
        escolhido={identidade?.id ?? agenteId}
        onEscolher={escolherAgente}
        onFechar={() => setEscolhendo(false)}
      />
    </div>
  );
}
