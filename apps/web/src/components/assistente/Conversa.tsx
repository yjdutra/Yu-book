import type { ChatMessage, ChatSource } from "@yu-book/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useConversa } from "../../lib/chat";
import { renderMarkdown } from "../../lib/markdown";
import { alvoDe, useSessaoChat } from "../../lib/sessaoChat";
import { Aviso } from "../base/Aviso";
import { Etiqueta } from "../base/Etiqueta";
import { IconeAssistente, IconeCopiar } from "../Icones";

/**
 * As falas de uma conversa (RF-17 a RF-26 da IA) — a mesma nas duas
 * superfícies do chat, o painel lateral e a rota `/assistente`.
 *
 * O que é próprio daqui é a espera. Uma mensagem vira até cinco chamadas ao
 * provedor, e entre elas há segundos de silêncio enquanto o Yu-book executa
 * uma ferramenta — por isso o estado de cada passo é anunciado (RNF-07), e não
 * só o "gerando" genérico. Silêncio sem explicação é o que faz alguém clicar de
 * novo.
 */

/** O rótulo humano de cada ação — a tela não diz `search_notes` a ninguém. */
const ROTULO_DA_ACAO: Record<string, string> = {
  search_notes: "procurando nas suas notas",
  get_note: "lendo uma nota",
  list_boards: "vendo seus quadros",
  get_board: "abrindo um quadro",
  get_dashboard: "conferindo o que vence",
};

/**
 * Nota e quadro têm rota própria. **Card não tem rota sem o quadro**
 * (`/b/:boardId/c/:cardId`), e a fonte carrega só o id do card — então o chip
 * de um card não navega, e por isso ele não é um botão: um controle que não
 * faz nada é pior do que um rótulo honesto.
 */
function Fontes({ fontes, onAbrir }: { fontes: ChatSource[]; onAbrir: (f: ChatSource) => void }) {
  if (fontes.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-miudo text-ink-400">consultou</span>
      {fontes.map((f) =>
        f.kind === "card" ? (
          <Etiqueta key={`${f.kind}-${f.id}`}>{f.title}</Etiqueta>
        ) : (
          <Etiqueta
            key={`${f.kind}-${f.id}`}
            tom="destaque"
            como="button"
            onClick={() => onAbrir(f)}
            titulo={f.kind === "note" ? "Abrir a nota" : "Abrir o quadro"}
          >
            {f.title}
          </Etiqueta>
        ),
      )}
    </div>
  );
}

/** Avatar do assistente: a mesma faísca do trilho, no gradiente de IA. */
function Avatar() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full
                 bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-e1"
    >
      <IconeAssistente className="size-3.5" />
    </span>
  );
}

function BalaoUsuario({
  texto,
  anexos,
}: {
  texto: string;
  anexos: { chave: string; titulo: string }[];
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      {anexos.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {anexos.map((a) => (
            <Etiqueta key={a.chave}>{a.titulo}</Etiqueta>
          ))}
        </div>
      )}
      <p
        className="max-w-[85%] whitespace-pre-wrap rounded-cartao rounded-br-etiqueta bg-ink-800
                   px-3.5 py-2 text-sm text-ink-200 shadow-e1"
      >
        {texto}
      </p>
    </div>
  );
}

/**
 * Copiar a resposta. É também a barra onde a Etapa C da frente de IA encaixa
 * "virar nota" — a ação mora ao lado da fala, não num menu à parte.
 */
function Acoes({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          });
        }}
        aria-label="Copiar a resposta"
        title="Copiar a resposta"
        className={`rounded-etiqueta p-1 transition-colors ${
          copiado ? "text-emerald-300" : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
        }`}
      >
        <IconeCopiar className="size-3.5" />
      </button>
      {/* RNF-09: o resultado é anunciado, não só colorido. */}
      <span aria-live="polite" className="text-miudo text-emerald-300">
        {copiado ? "copiado" : ""}
      </span>
    </div>
  );
}

function FalaAssistente({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Avatar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Fala({ mensagem, onAbrir }: { mensagem: ChatMessage; onAbrir: (f: ChatSource) => void }) {
  // Já sanitizado por DOMPurify dentro de renderMarkdown (INV-09, RNF-05):
  // texto de modelo é entrada não confiável como qualquer outra.
  const html = useMemo(
    () => (mensagem.role === "assistant" ? renderMarkdown(mensagem.content) : ""),
    [mensagem.role, mensagem.content],
  );

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
  /// anunciado enquanto acontecia; repetir um balão vazio aqui é ruído.
  if (!mensagem.content.trim()) return null;

  return (
    <FalaAssistente>
      <div className="preview text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {mensagem.modelUsed && (
          // RF-25: qual modelo respondeu **esta** mensagem — a escolha pode mudar
          // entre uma e outra.
          <Etiqueta tom="ia" titulo="Modelo que respondeu">
            {mensagem.modelUsed}
          </Etiqueta>
        )}
      </div>
      <Fontes fontes={mensagem.sources} onAbrir={onAbrir} />
      <Acoes texto={mensagem.content} />
    </FalaAssistente>
  );
}

export function Conversa({
  onAbrirFonte,
  vazio,
}: {
  onAbrirFonte: (f: ChatSource) => void;
  /** O que mostrar numa conversa sem falas — cada superfície tem o seu convite. */
  vazio: ReactNode;
}) {
  const { conversaId, emCurso: fluxo, erro, limparErro } = useSessaoChat();
  const { data: conversa } = useConversa(conversaId);
  const fimRef = useRef<HTMLDivElement>(null);
  const mensagens = conversaId ? (conversa?.messages ?? []) : [];
  /// A fala em curso só aparece na conversa a que pertence: escolher outra no
  /// meio da resposta não pode pendurar o balão nas falas de outra conversa.
  const emCurso = fluxo && fluxo.conversaId === conversaId ? fluxo : null;

  /// Rolar para o fim a cada pedaço que chega: uma resposta que cresce fora da
  /// área visível é uma resposta que ninguém vê chegando.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [emCurso?.texto, mensagens.length]);

  return (
    <div className="space-y-5">
      {mensagens.length === 0 && !emCurso && vazio}

      {mensagens.map((m) => (
        <Fala key={m.id} mensagem={m} onAbrir={onAbrirFonte} />
      ))}

      {emCurso && (
        <>
          <BalaoUsuario
            texto={emCurso.pergunta}
            anexos={emCurso.anexos.map((a) => ({ chave: alvoDe(a), titulo: a.titulo }))}
          />
          <FalaAssistente>
            {/* RNF-07: o passo é anunciado, e o texto visível é a própria
                região — o leitor de tela não repete. */}
            <p role="status" className="flex items-center gap-2 text-xs text-ink-400">
              {!emCurso.texto && (
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-linear-to-r from-accent-400
                             to-ia-500"
                />
              )}
              {emCurso.ferramenta
                ? `${ROTULO_DA_ACAO[emCurso.ferramenta] ?? emCurso.ferramenta}…`
                : emCurso.texto
                  ? ""
                  : "pensando…"}
            </p>
            {emCurso.texto && (
              <div
                className="preview text-sm"
                // Sanitizado por DOMPurify em renderMarkdown, a cada pedaço.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(emCurso.texto) }}
              />
            )}
            <Fontes fontes={emCurso.fontes} onAbrir={onAbrirFonte} />
            {emCurso.cortados.length > 0 && (
              // RNF-04: o limite de contexto é **declarado** quando corta.
              <p role="status" className="mt-1 text-xs text-amber-300">
                Não coube no contexto e ficou de fora: {emCurso.cortados.join(", ")}.
              </p>
            )}
          </FalaAssistente>
        </>
      )}

      {erro && (
        <Aviso tom="erro" onFechar={limparErro}>
          {erro}
        </Aviso>
      )}
      <div ref={fimRef} />
    </div>
  );
}
