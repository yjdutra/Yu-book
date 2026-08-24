import { splitHighlight } from "@yu-book/shared";
import type {
  BoardDetail,
  CardComPrazo,
  CardSummary,
  Dashboard,
  NoteDetail,
  SearchResult,
} from "@yu-book/shared";

/**
 * O orçamento de contexto é o assunto desta camada.
 *
 * Uma tool de leitura tem exatamente o problema que `GET /notes` tinha: trazer
 * o corpo inteiro de N notas custa megabytes. Na API isso foi resolvido
 * truncando no banco (4,2 MB → 24 KB por página). Aqui a regra é a mesma, com
 * um degrau a mais: `search_notes` devolve só trecho, e quem quiser o corpo
 * chama `get_note` de propósito. Buscar é barato; ler é caro e explícito.
 *
 * Devolvemos texto compacto, não JSON. JSON de 20 resultados gasta um terço
 * dos tokens em chaves e aspas repetidas, sem dizer nada ao modelo.
 */

/** Quanto de um trecho vai para o modelo. A API já corta em 600 no banco. */
const LIMITE_TRECHO = 280;

/**
 * O `snippet` da busca vem com `HL_START`/`HL_END` em volta dos termos — os
 * caracteres de controle U+0001 e U+0002 (INV-10). Eles existem para que
 * nenhuma nota consiga forjar destaque em HTML, mas para o modelo são lixo:
 * ou viram nada, ou viram tokens sem significado. Convertemos para `**`.
 */
export function limparDestaque(snippet: string): string {
  return splitHighlight(snippet)
    .map((parte) => (parte.hl ? `**${parte.text}**` : parte.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function encurtar(texto: string, limite = LIMITE_TRECHO): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}

export function formatarResultado(r: SearchResult): string {
  const onde =
    r.type === "card"
      ? `card em ${r.boardName} / ${r.columnName}`
      : `nota ${r.kind}${r.workspaceName ? ` · ${r.workspaceName}` : ""}`;
  const trecho = limparDestaque(r.snippet);
  return `- **${r.title}** — ${onde}\n  id: ${r.id}\n  ${encurtar(trecho)}`;
}

export function formatarNota(nota: NoteDetail): string {
  const linhas = [
    `# ${nota.title}`,
    "",
    `tipo: ${nota.kind}${nota.workspaceName ? ` · workspace: ${nota.workspaceName}` : ""}`,
    `id: ${nota.id} · atualizada em ${nota.updatedAt}`,
  ];

  if (nota.tags.length) linhas.push(`tags: ${nota.tags.map((t) => t.name).join(", ")}`);
  if (nota.sourceUrl) linhas.push(`origem: ${nota.sourceUrl}`);

  const meta = Object.entries(nota.meta);
  if (meta.length) linhas.push(`campos: ${meta.map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  linhas.push("", "---", "", nota.contentMd || "_(nota vazia)_");

  // Backlinks e cards são o grafo em volta da nota. Só id e título: quem quiser
  // o conteúdo de um vizinho pede `get_note` para ele.
  if (nota.backlinks.length) {
    linhas.push("", "## Referenciada por");
    for (const b of nota.backlinks) linhas.push(`- ${b.title} (${b.id})`);
  }
  if (nota.cards.length) {
    linhas.push("", "## Cards que apontam para esta nota");
    for (const c of nota.cards) linhas.push(`- ${c.title} (${c.id})`);
  }

  return linhas.join("\n");
}

export function formatarCard(card: CardSummary): string {
  const partes = [`- ${card.title}`];
  if (card.dueDate) partes.push(`prazo ${card.dueDate.slice(0, 10)}`);
  if (card.priority !== "media") partes.push(`prioridade ${card.priority}`);
  if (card.checklistTotal > 0) partes.push(`${card.checklistDone}/${card.checklistTotal}`);
  if (card.note) partes.push(`nota: ${card.note.title}`);
  return `${partes.join(" · ")}\n  id: ${card.id}`;
}

/**
 * O quadro como texto. Vive aqui, e não na tool, porque `get_board` e o
 * resource `yubook://board/{id}` precisam produzir exatamente o mesmo texto —
 * duas implementações divergem, e a divergência aparece como o mesmo recurso
 * com duas caras (RN-03).
 */
export function formatarQuadro(board: BoardDetail): string {
  const linhas = [`# ${board.name}`, `workspace: ${board.workspaceName}`, ""];

  for (const coluna of board.columns) {
    // O limite de WIP avisa e não bloqueia (INV-15) — informamos como o quadro
    // informa, sem sugerir que estourar seja erro.
    const wip = coluna.wipLimit ? ` [${coluna.cards.length}/${coluna.wipLimit}]` : "";
    linhas.push(`## ${coluna.name}${wip}`);
    linhas.push(coluna.cards.length ? coluna.cards.map(formatarCard).join("\n") : "_(vazia)_");
    linhas.push("");
  }

  if (board.archivedCount > 0) {
    linhas.push(`_${board.archivedCount} card(s) arquivado(s), fora do quadro._`);
  }

  return linhas.join("\n");
}

/** O agregado da tela inicial como texto. Fonte única dos prompts. */
export function formatarDashboard(d: Dashboard): string {
  const linhas: string[] = [];

  const prazo = (c: CardComPrazo) =>
    `- ${c.title} — vence ${c.dueDate.slice(0, 10)} · prioridade ${c.priority} · ` +
    `${c.boardName} / ${c.columnName}\n  id: ${c.id}`;

  linhas.push("## Prazos vencidos");
  if (d.prazos.vencidos.length === 0) linhas.push("_nenhum_");
  else {
    linhas.push(...d.prazos.vencidos.map(prazo));
    // O recorte mostra alguns; o total diz quantos ficaram de fora, para o
    // modelo não concluir que a lista é tudo o que existe.
    const resto = d.prazos.totalVencidos - d.prazos.vencidos.length;
    if (resto > 0) linhas.push(`_e mais ${resto} vencido(s) fora deste recorte._`);
  }

  linhas.push("", "## Vence nos próximos 7 dias");
  if (d.prazos.proximos.length === 0) linhas.push("_nenhum_");
  else {
    linhas.push(...d.prazos.proximos.map(prazo));
    const resto = d.prazos.totalProximos - d.prazos.proximos.length;
    if (resto > 0) linhas.push(`_e mais ${resto} fora deste recorte._`);
  }

  linhas.push("", "## Notas editadas recentemente");
  linhas.push(
    d.notas.length === 0
      ? "_nenhuma_"
      : d.notas
          .map((n) => `- ${n.title} (${n.kind}) — ${n.updatedAt.slice(0, 10)}\n  id: ${n.id}`)
          .join("\n"),
  );

  linhas.push("", "## Fila de links");
  linhas.push(
    d.links.total === 0
      ? "_vazia_"
      : `${d.links.total} item(ns) guardado(s) para ver depois. Nada aqui expira.`,
  );

  return linhas.join("\n");
}
