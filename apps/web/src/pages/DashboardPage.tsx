import type { CardComPrazo, LinkResumo, NoteSummary } from "@yu-book/shared";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { MiniaturaLink } from "../components/MiniaturaLink";
import { RotuloTipo } from "../components/RotuloTipo";
import { useDashboard } from "../lib/dashboard";
import { idadeRelativa, prazoRelativo } from "../lib/tempo";
import { useWorkspaceAtivo } from "../lib/workspace";

const PRIORIDADE: Record<CardComPrazo["priority"], { sigla: string; classe: string }> = {
  alta: { sigla: "⬆", classe: "text-rose-300" },
  media: { sigla: "=", classe: "text-ink-400" },
  baixa: { sigla: "⬇", classe: "text-sky-300" },
};

function Bloco({
  titulo,
  acao,
  children,
}: {
  titulo: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-ink-700 bg-ink-900/40">
      <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-ink-400">{titulo}</h3>
        {acao && <span className="ml-auto">{acao}</span>}
      </header>
      {children}
    </section>
  );
}

function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  // RF-06 / CA-10: nenhum bloco aparece em branco.
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm text-ink-400">{texto}</p>
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

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
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-ink-800/60"
      >
        {/* RNF-09: vencido tem símbolo, não só cor. */}
        <span
          aria-hidden="true"
          className={`w-4 shrink-0 text-center text-xs ${
            vencido ? "text-red-300" : "text-ink-400"
          }`}
        >
          {vencido ? "⚠" : "◷"}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-200">{card.title}</span>
          <span className="block truncate text-[11px] text-ink-400">
            {card.boardName} · {card.columnName}
          </span>
        </span>

        {card.priority !== "media" && (
          <span className={`shrink-0 text-[11px] ${prioridade.classe}`}>
            <span aria-hidden="true">{prioridade.sigla}</span> {card.priority}
          </span>
        )}

        <span
          className={`shrink-0 text-[11px] tabular-nums ${
            vencido ? "text-red-300" : "text-ink-400"
          }`}
        >
          {prazoRelativo(card.dueDate)}
        </span>
      </button>
    </li>
  );
}

interface DashboardPageProps {
  onNovaNota: () => void;
  onAbrirGaveta: () => void;
}

/** RF-01: a tela inicial. Responde "o que precisa de mim agora?". */
export function DashboardPage({ onNovaNota, onAbrirGaveta }: DashboardPageProps) {
  const navigate = useNavigate();
  const { ativo, ativoId } = useWorkspaceAtivo();
  const { data, isLoading } = useDashboard(ativoId);

  if (isLoading || !data) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-ink-400">
        <span className="animate-pulse">Carregando…</span>
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
      <header>
        <h2 className="text-lg font-semibold text-titulo">Início</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          {ativo ? `Workspace ${ativo.name}` : "Todos os workspaces"}
        </p>
      </header>

      {/* RN-01: prazo vencido tem precedência sobre tudo. */}
      <Bloco titulo="Prazos">
        {semPrazo ? (
          <Vazio
            texto="Nenhum prazo à vista."
            acao={
              <button
                type="button"
                onClick={() => navigate("/b")}
                className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200
                           hover:border-accent-400"
              >
                Ver os boards
              </button>
            }
          />
        ) : (
          <>
            {prazos.vencidos.length > 0 && (
              <ul className="divide-y divide-ink-800">
                {prazos.vencidos.map((card) => (
                  <LinhaPrazo key={card.id} card={card} vencido onAbrir={() => abrirCard(card)} />
                ))}
                {sobrandoVencidos > 0 && (
                  <li className="px-4 py-1.5 text-[11px] text-red-300">
                    e mais {sobrandoVencidos} vencido{sobrandoVencidos > 1 ? "s" : ""}
                  </li>
                )}
              </ul>
            )}

            {prazos.proximos.length > 0 && (
              <ul
                className={`divide-y divide-ink-800 ${
                  prazos.vencidos.length > 0 ? "border-t border-ink-700" : ""
                }`}
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
                  <li className="px-4 py-1.5 text-[11px] text-ink-400">
                    e mais {sobrandoProximos} nos próximos dias
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </Bloco>

      <div className="grid min-w-0 grid-cols-2 gap-4">
        <Bloco titulo="Onde você parou">
          {notas.length === 0 ? (
            <Vazio
              texto="Nenhuma nota ainda."
              acao={
                <button
                  type="button"
                  onClick={onNovaNota}
                  className="rounded bg-accent-500 px-3 py-1.5 text-xs font-medium text-white
                             hover:bg-accent-400"
                >
                  Criar a primeira — Ctrl+N
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {notas.map((nota) => (
                <li key={nota.id}>
                  <button
                    type="button"
                    onClick={() => abrirNota(nota)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left transition
                               hover:bg-ink-800/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-200">{nota.title}</span>
                      <span className="block truncate text-[11px] text-ink-400">
                        {nota.excerpt || "sem conteúdo"}
                      </span>
                    </span>
                    <RotuloTipo tipo={nota.kind} className="shrink-0" />
                    <span className="shrink-0 text-[11px] text-ink-400">
                      {idadeRelativa(nota.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Bloco>

        <Bloco
          titulo={`Ver depois · ${links.total}`}
          acao={
            <button
              type="button"
              onClick={onAbrirGaveta}
              className="rounded px-1.5 py-0.5 text-[11px] text-ink-400 hover:text-ink-200"
            >
              abrir a gaveta
            </button>
          }
        >
          {links.antigos.length === 0 ? (
            <Vazio texto="A fila está vazia. Arraste um link para dentro da janela." />
          ) : (
            <ul className="divide-y divide-ink-800">
              {links.antigos.map((link: LinkResumo) => (
                <li key={link.id}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-2 transition hover:bg-ink-800/60"
                  >
                    <MiniaturaLink link={link} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-200">{link.title}</span>
                      <span className="block truncate text-[11px] text-ink-400">{link.domain}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-400">
                      {idadeRelativa(link.createdAt)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Bloco>
      </div>
    </main>
  );
}
