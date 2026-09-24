import type { BoardSummary, CardComPrazo, LinkResumo, NoteSummary } from "@yu-book/shared";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Bloco, Esqueleto, Vazio } from "../components/base/Bloco";
import { Botao } from "../components/base/Botao";
import { Etiqueta } from "../components/base/Etiqueta";
import { IconeAlerta, IconeAssistente, IconeRelogio } from "../components/Icones";
import { MarcaIA } from "../components/MarcaIA";
import { MiniaturaLink } from "../components/MiniaturaLink";
import { RotuloTipo } from "../components/RotuloTipo";
import { useAuth } from "../lib/auth";
import { useDashboard } from "../lib/dashboard";
import { useBoards } from "../lib/kanban";
import { useAcoesChat } from "../lib/sessaoChat";
import { idadeRelativa, prazoRelativo, saudacao } from "../lib/tempo";
import { useWorkspaceAtivo } from "../lib/workspace";

const PRIORIDADE: Record<CardComPrazo["priority"], { sigla: string; tom: "destaque" | "neutro" }> =
  {
    alta: { sigla: "⬆", tom: "destaque" },
    media: { sigla: "=", tom: "neutro" },
    baixa: { sigla: "⬇", tom: "neutro" },
  };

/** "quarta-feira, 24 de setembro" — o dia por extenso, sem o ano. */
function dataPorExtenso(agora = Date.now()): string {
  return new Date(agora).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Classe comum das linhas clicáveis dos blocos: o hover é uma pílula, não a faixa inteira. */
const LINHA =
  "flex w-full items-center gap-3 rounded-controle px-3 py-2 text-left transition " +
  "hover:bg-ink-800/60";

function LinhaPrazo({
  card,
  vencido,
  onAbrir,
}: {
  card: CardComPrazo;
  vencido: boolean;
  onAbrir: () => void;
}) {
  const prioridade = PRIORIDADE[card.priority];

  return (
    <li>
      <button type="button" onClick={onAbrir} className={LINHA}>
        {/* RNF-09: vencido tem símbolo, não só cor. O ícone é `aria-hidden`, e o
            texto do prazo não basta: um card que venceu hoje diz "vence hoje".
            O "vencido" vai por extenso para o leitor de tela. */}
        {vencido ? (
          <>
            <IconeAlerta className="size-3.5 text-red-300" />
            <span className="sr-only">Vencido:</span>
          </>
        ) : (
          <IconeRelogio className="size-3.5 text-ink-400" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-200">{card.title}</span>
          <span className="block truncate text-miudo text-ink-400">
            {card.boardName} · {card.columnName}
          </span>
        </span>

        {card.ai && (
          <span className="shrink-0">
            <MarcaIA marca={card.ai} curta />
          </span>
        )}

        {card.priority !== "media" && (
          <span className="shrink-0">
            <Etiqueta tom={prioridade.tom}>
              <span aria-hidden="true">{prioridade.sigla}</span> {card.priority}
            </Etiqueta>
          </span>
        )}

        <span
          className={`shrink-0 text-miudo tabular-nums ${
            vencido ? "text-red-300" : "text-ink-400"
          }`}
        >
          {prazoRelativo(card.dueDate)}
        </span>
      </button>
    </li>
  );
}

/** Uma linha de board: a cor do workspace é sinal, o nome e a contagem são o conteúdo. */
function LinhaBoard({ board, onAbrir }: { board: BoardSummary; onAbrir: () => void }) {
  return (
    <li>
      <button type="button" onClick={onAbrir} className={LINHA}>
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: board.workspaceColor }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-200">{board.name}</span>
          <span className="block truncate text-miudo text-ink-400">{board.workspaceName}</span>
        </span>
        <span className="shrink-0 text-miudo tabular-nums text-ink-400">
          {board.cardCount} card{board.cardCount === 1 ? "" : "s"}
        </span>
      </button>
    </li>
  );
}

/**
 * O atalho do Início para o assistente. Preenche o campo e abre o painel, mas
 * **não envia**: cada mensagem custa chamadas ao provedor (até cinco por turno),
 * e quem digitou aqui ainda não viu o painel, o modelo escolhido nem o teto de
 * gasto. O envio fica com o Enter lá, depois de a pessoa ter olhado.
 */
function PergunteAoAcervo() {
  const { setTexto, abrirPainel } = useAcoesChat();
  const [pergunta, setPergunta] = useState("");

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const texto = pergunta.trim();
    if (!texto) return;
    // Conversa nova: a pergunta do início não é continuação da última
    // conversa, e entrar nela levaria o histórico junto no envio.
    abrirPainel({ nova: true });
    setTexto(texto);
    setPergunta("");
  }

  return (
    <Bloco titulo="Pergunte ao seu acervo" variante="ia">
      <form onSubmit={aoEnviar} className="flex items-center gap-2 px-4 py-3">
        <input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="O que eu anotei sobre…"
          aria-label="Pergunta ao assistente"
          className="h-8 min-w-0 flex-1 rounded-controle border border-ink-700 bg-ink-900 px-3
                     text-sm text-ink-200 outline-none placeholder:text-ink-400/60
                     focus:border-accent-400"
        />
        <Botao
          type="submit"
          variante="ia"
          tamanho="m"
          icone={<IconeAssistente className="size-3.5" />}
          disabled={!pergunta.trim()}
        >
          Perguntar
        </Botao>
      </form>
    </Bloco>
  );
}

interface DashboardPageProps {
  onNovaNota: () => void;
  onAbrirGaveta: () => void;
}

/** RF-01: a tela inicial. Responde "o que precisa de mim agora?". */
export function DashboardPage({ onNovaNota, onAbrirGaveta }: DashboardPageProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { ativo, ativoId } = useWorkspaceAtivo();
  const { data, isLoading } = useDashboard(ativoId);
  const boards = useBoards(ativoId);

  const primeiroNome = user?.name.trim().split(/\s+/)[0] ?? "";

  // O cabeçalho e a pergunta não dependem dos dados: são os mesmos no esqueleto
  // e na tela pronta.
  const cabecalho = (
    <header>
      <h2 className="text-2xl font-semibold text-titulo">
        {saudacao()}
        {primeiroNome && `, ${primeiroNome}`}
      </h2>
      <p className="mt-1 text-xs text-ink-400">
        {dataPorExtenso()} · {ativo ? `Workspace ${ativo.name}` : "Todos os workspaces"}
      </p>
    </header>
  );

  if (isLoading || !data) {
    // RNF-11: o esqueleto tem a forma da tela pronta — mesma grade, mesmos
    // blocos —, para a chegada dos dados não empurrar nada.
    return (
      <main
        aria-busy="true"
        className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-8 py-6"
      >
        <span className="sr-only">Carregando…</span>
        {cabecalho}
        <PergunteAoAcervo />
        <div className="grid min-w-0 grid-cols-12 gap-4">
          <div className="col-span-7 min-w-0">
            <Bloco titulo="Prazos">
              <Esqueleto linhas={3} />
            </Bloco>
          </div>
          <div className="col-span-5 min-w-0">
            <Bloco titulo="Onde você parou">
              <Esqueleto linhas={4} />
            </Bloco>
          </div>
          <div className="col-span-6 min-w-0">
            <Bloco titulo="Ver depois">
              <Esqueleto linhas={4} />
            </Bloco>
          </div>
          <div className="col-span-6 min-w-0">
            <Bloco titulo="Boards">
              <Esqueleto linhas={4} />
            </Bloco>
          </div>
        </div>
      </main>
    );
  }

  const { prazos, notas, links } = data;
  const semPrazo = prazos.vencidos.length === 0 && prazos.proximos.length === 0;
  const sobrandoVencidos = prazos.totalVencidos - prazos.vencidos.length;
  const sobrandoProximos = prazos.totalProximos - prazos.proximos.length;

  const abrirCard = (card: CardComPrazo) => navigate(`/b/${card.boardId}/c/${card.id}`);
  const abrirNota = (nota: NoteSummary) => navigate(`/n/${nota.id}`);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-8 py-6">
      {cabecalho}
      <PergunteAoAcervo />

      <div className="grid min-w-0 grid-cols-12 gap-4">
        {/* RN-01: prazo vencido tem precedência sobre tudo — primeiro bloco,
            e dentro dele os vencidos antes dos próximos. */}
        <div className="col-span-7 min-w-0">
          <Bloco titulo="Prazos">
            {semPrazo ? (
              <Vazio
                texto="Nenhum prazo à vista."
                acao={<Botao onClick={() => navigate("/b")}>Ver os boards</Botao>}
              />
            ) : (
              <div className="p-1.5">
                {prazos.vencidos.length > 0 && (
                  <ul>
                    {prazos.vencidos.map((card) => (
                      <LinhaPrazo
                        key={card.id}
                        card={card}
                        vencido
                        onAbrir={() => abrirCard(card)}
                      />
                    ))}
                    {sobrandoVencidos > 0 && (
                      <li className="px-3 py-1.5 text-miudo text-red-300">
                        e mais {sobrandoVencidos} vencido{sobrandoVencidos > 1 ? "s" : ""}
                      </li>
                    )}
                  </ul>
                )}

                {prazos.proximos.length > 0 && (
                  <ul
                    className={
                      prazos.vencidos.length > 0 ? "mt-1.5 border-t border-ink-800 pt-1.5" : ""
                    }
                  >
                    {prazos.proximos.map((card) => (
                      <LinhaPrazo
                        key={card.id}
                        card={card}
                        vencido={false}
                        onAbrir={() => abrirCard(card)}
                      />
                    ))}
                    {sobrandoProximos > 0 && (
                      <li className="px-3 py-1.5 text-miudo text-ink-400">
                        e mais {sobrandoProximos} nos próximos dias
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </Bloco>
        </div>

        <div className="col-span-5 min-w-0">
          <Bloco titulo="Onde você parou">
            {notas.length === 0 ? (
              <Vazio
                texto="Nenhuma nota ainda."
                acao={
                  <Botao variante="primario" onClick={onNovaNota}>
                    Criar a primeira — Ctrl+N
                  </Botao>
                }
              />
            ) : (
              <ul className="p-1.5">
                {notas.map((nota) => (
                  <li key={nota.id}>
                    <button
                      type="button"
                      onClick={() => abrirNota(nota)}
                      className={LINHA}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-200">{nota.title}</span>
                        <span className="block truncate text-miudo text-ink-400">
                          {nota.excerpt || "sem conteúdo"}
                        </span>
                      </span>
                      {nota.ai && (
                        <span className="shrink-0">
                          <MarcaIA marca={nota.ai} curta />
                        </span>
                      )}
                      <RotuloTipo tipo={nota.kind} className="shrink-0" />
                      <span className="shrink-0 text-miudo text-ink-400">
                        {idadeRelativa(nota.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>

        <div className="col-span-6 min-w-0">
          <Bloco
            titulo={`Ver depois · ${links.total}`}
            acao={
              <Botao variante="fantasma" onClick={onAbrirGaveta} className="-my-1">
                abrir a gaveta
              </Botao>
            }
          >
            {links.antigos.length === 0 ? (
              <Vazio texto="A fila está vazia. Arraste um link para dentro da janela." />
            ) : (
              <ul className="p-1.5">
                {links.antigos.map((link: LinkResumo) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINHA}
                    >
                      <MiniaturaLink link={link} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink-200">{link.title}</span>
                        <span className="block truncate text-miudo text-ink-400">
                          {link.domain}
                        </span>
                      </span>
                      <span className="shrink-0 text-miudo text-ink-400">
                        {idadeRelativa(link.createdAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>

        <div className="col-span-6 min-w-0">
          <Bloco titulo={boards.data ? `Boards · ${boards.data.length}` : "Boards"}>
            {/* Consulta própria, fora do `/dashboard`: enquanto ela carrega, o
                bloco mantém a altura do esqueleto (RNF-11). */}
            {boards.isLoading ? (
              <Esqueleto linhas={4} />
            ) : !boards.data || boards.data.length === 0 ? (
              <Vazio
                texto={
                  boards.isError ? "Não foi possível carregar os boards." : "Nenhum board ainda."
                }
                acao={<Botao onClick={() => navigate("/b")}>Ver os boards</Botao>}
              />
            ) : (
              <ul className="p-1.5">
                {boards.data.map((board) => (
                  <LinhaBoard
                    key={board.id}
                    board={board}
                    onAbrir={() => navigate(`/b/${board.id}`)}
                  />
                ))}
              </ul>
            )}
          </Bloco>
        </div>
      </div>
    </main>
  );
}
