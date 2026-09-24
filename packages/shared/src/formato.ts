import { parseSearchQuery, splitHighlight } from "./busca.js";
import type { SearchResponse, SearchResult } from "./busca.js";
import type { CardComPrazo, Dashboard } from "./dashboard.js";
import { diaLocal } from "./ia.js";
import type { BoardDetail, BoardSummary, CardDetail, CardSummary } from "./kanban.js";
import type { AiMark } from "./marca.js";
import type { NoteDetail } from "./notes.js";

/**
 * O acervo como texto, para um modelo ler.
 *
 * **Uma definição, dois consumidores.** Este módulo nasceu em
 * `apps/mcp/src/formato.ts` e servia só ao servidor MCP; com o chat interno
 * (Etapa B da frente de IA) ele passou a ter dois leitores — o MCP, que fala
 * HTTP com a API, e o chat, que chama os services direto. O CA-11 do
 * `docs/prd-ia-no-yu-book.md` exige que o texto de uma nota pelo chat seja
 * **idêntico** ao de `yubook://nota/{id}`: duas implementações apareceriam
 * como o mesmo dado com duas caras. Por isso mora aqui e não em nenhum app.
 *
 * O orçamento de contexto é o outro assunto da camada. Uma tool de leitura tem
 * o problema que `GET /notes` tinha: trazer o corpo inteiro de N notas custa
 * megabytes. Na API isso foi resolvido truncando no banco (4,2 MB → 24 KB por
 * página). Aqui a regra é a mesma, com um degrau a mais: `search_notes`
 * devolve só trecho, e quem quiser o corpo chama `get_note` de propósito.
 * Buscar é barato; ler é caro e explícito.
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

/**
 * O dia de um prazo, no fuso **do usuário**.
 *
 * Não é `.slice(0, 10)` sobre o ISO, e a diferença não é estética. O front
 * grava o prazo às 23:59:59 **do fuso local** (`apps/web/src/components/
 * PainelCard.tsx`, convenção da Fase 2, documentada em `lib/tempo.ts`). Em
 * UTC−3, isso vira 02:59 do dia seguinte — e fatiar o ISO relataria o dia
 * errado, um dia à frente, em todo card com prazo. O corte por string é
 * seguro para `createdAt`/`updatedAt`, que são instantes; para prazo, não.
 *
 * **O `fuso` não tem valor padrão, e é de propósito.** Esta função usava o
 * fuso do *processo* (`getMonth()`/`getDate()`), o que acertava por acaso na
 * máquina do operador e errava sempre no MCP hospedado, que roda em UTC — todo
 * prazo relatado um dia à frente, calado. Um valor padrão traria a mesma
 * armadilha de volta: é a lição do `temChave` em `openrouter.service.ts`, onde
 * um padrão fez um teste de "sem chave" passar a testar outra coisa. Quem
 * chama diz de qual fuso está falando.
 */
export function diaDoPrazo(iso: string, fuso: string): string {
  return diaLocal(new Date(iso), fuso);
}

/**
 * As partes de um instante vistas em `fuso`, reinterpretadas como se fossem
 * UTC. A diferença para o próprio instante é o deslocamento do fuso naquela
 * data — inclusive horário de verão, sem tabela nossa.
 */
function comoSeFosseUtc(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instante);

  const campo = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  /// `hour12: false` devolve 24 na meia-noite em algumas plataformas.
  const hora = campo("hour") % 24;
  return Date.UTC(
    campo("year"),
    campo("month") - 1,
    campo("day"),
    hora,
    campo("minute"),
    campo("second"),
  );
}

/**
 * `AAAA-MM-DD` vira o fim daquele dia **no fuso do usuário** — como o front
 * grava. É a volta de `diaDoPrazo`, e as duas juntas mantêm o MCP, o chat e a
 * interface concordando sobre o que é "o dia do prazo".
 *
 * Não é `new Date(`${dia}T23:59:59`)`: isso interpreta no fuso do *processo*,
 * e num servidor em UTC o prazo de quem vive em UTC+5 cairia no dia seguinte.
 * Duas passagens porque o deslocamento depende da própria data — a primeira
 * estimativa usa o alvo como se o fuso fosse UTC, a segunda corrige.
 *
 * O formato já é validado pelo schema da tool, mas formato válido não é data
 * válida: `2026-13-45` passa no regex e viraria `Invalid Date`.
 */
export function diaParaPrazo(dia: string, fuso: string): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  if (!ano || !mes || !d) throw new Error(`dueDate não é uma data existente: ${dia}`);

  const alvo = Date.UTC(ano, mes - 1, d, 23, 59, 59);
  let instante = alvo;
  for (let volta = 0; volta < 2; volta += 1) {
    instante = alvo - (comoSeFosseUtc(new Date(instante), fuso) - instante);
  }

  const resultado = new Date(instante);
  if (Number.isNaN(resultado.getTime()) || diaLocal(resultado, fuso) !== dia) {
    throw new Error(`dueDate não é uma data existente: ${dia}`);
  }
  return resultado.toISOString();
}

export function encurtar(texto: string, limite = LIMITE_TRECHO): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}

/**
 * A marca de conteúdo gerado (Etapa C da frente de IA), nas listas.
 *
 * Só o sufixo, sem autor nem data: numa lista de vinte itens o detalhe custa
 * tokens sem mudar o que o modelo faz. Quem precisar dele abre o item, e a
 * leitura de um item traz a linha inteira (`linhaDaMarca`).
 */
function sufixoIa(ai: AiMark | null): string {
  return ai ? " · IA" : "";
}

/**
 * A marca inteira, na leitura de um item. O modelo precisa saber que o texto
 * que está lendo foi escrito por um modelo — e por qual, e se alguém o revisou
 * depois — antes de tratá-lo como o que o usuário pensa.
 *
 * O dia sai no fuso do usuário pelo mesmo motivo de `diaDoPrazo`: um conteúdo
 * gerado às 22h em UTC−3 não foi gerado "amanhã".
 */
function linhaDaMarca(ai: AiMark, fuso: string, genero: "a" | "o"): string {
  const partes = [`gerad${genero} por IA`];
  // O agente (Etapa D) antes do modelo: é ele que diz com que premissas o
  // texto foi escrito, e o modelo só diz quem o escreveu.
  if (ai.agentName) partes.push(`«${ai.agentName}»`);
  if (ai.author) partes.push(ai.author);
  partes.push(`via ${ai.via}`, diaLocal(new Date(ai.generatedAt), fuso));
  if (ai.revisedAt) partes.push(`revisad${genero} em ${diaLocal(new Date(ai.revisedAt), fuso)}`);
  return partes.join(" · ");
}

export function formatarResultado(r: SearchResult): string {
  const onde =
    (r.type === "card"
      ? `card em ${r.boardName} / ${r.columnName}`
      : `nota ${r.kind}${r.workspaceName ? ` · ${r.workspaceName}` : ""}`) + sufixoIa(r.ai);
  const trecho = limparDestaque(r.snippet);
  return `- **${r.title}** — ${onde}\n  id: ${r.id}\n  ${encurtar(trecho)}`;
}

/**
 * A resposta inteira de uma busca, e não só cada linha.
 *
 * O cabeçalho e o caso vazio moram aqui pelo mesmo motivo que o resto: o
 * servidor MCP e o chat interno chamam a mesma busca, e um texto montado em
 * dois lugares diverge. O caso vazio devolve **o que foi entendido** da
 * sintaxe, senão o modelo repete a mesma busca achando que errou os filtros.
 */
export function formatarBusca(dados: SearchResponse, q: string): string {
  if (dados.results.length === 0) {
    const f = parseSearchQuery(q);
    const aplicados = [
      f.kind && `tipo:${f.kind}`,
      f.card && "tipo:card",
      f.tag && `tag:${f.tag}`,
      f.workspace && `#${f.workspace}`,
    ].filter(Boolean);
    return (
      `Nenhum resultado para "${f.text || q}".` +
      (aplicados.length ? ` Filtros aplicados: ${aplicados.join(", ")}.` : "") +
      /// A saída do caso vazio, e não só o relato dele.
      ///
      /// A busca é por palavra sobre título e corpo: quem procura "receita de
      /// bolo" não acha uma nota chamada "Bolo de fubá", porque "receita" não
      /// está lá. Sem esta frase o modelo lê "nenhum resultado" como "não
      /// existe" e desiste numa volta só — observado em 2026-09-23, com a nota
      /// visível na tela ao lado. Uma linha, e ela vale para as duas
      /// superfícies: esta função imprime o resultado do `search_notes` do
      /// servidor MCP e o do chat interno.
      " A busca é por palavra, sobre título e corpo — não por assunto. Tente o termo mais" +
      " específico sozinho (o substantivo, não a frase) antes de concluir que não existe."
    );
  }

  const cabecalho = dados.approximate
    ? `${dados.results.length} resultado(s) por semelhança de título — não houve ` +
      "correspondência exata:"
    : `${dados.results.length} resultado(s):`;

  return `${cabecalho}\n\n${dados.results.map(formatarResultado).join("\n\n")}`;
}

/** Os quadros como lista. O id é o que torna `get_board` alcançável. */
export function formatarListaDeQuadros(boards: BoardSummary[]): string {
  if (boards.length === 0) return "Nenhum quadro encontrado.";
  return boards
    .map(
      (b) =>
        `- **${b.name}** — workspace ${b.workspaceName} · ${b.columnCount} coluna(s) · ` +
        `${b.cardCount} card(s)\n  id: ${b.id}`,
    )
    .join("\n");
}

/**
 * A nota inteira. `fuso` entrou com a marca de IA (Etapa C) e, como em
 * `diaDoPrazo`, não tem valor padrão: quem chama diz de qual fuso fala.
 */
export function formatarNota(nota: NoteDetail, fuso: string): string {
  const linhas = [
    `# ${nota.title}`,
    "",
    `tipo: ${nota.kind}${nota.workspaceName ? ` · workspace: ${nota.workspaceName}` : ""}`,
    `id: ${nota.id} · atualizada em ${nota.updatedAt}`,
  ];

  if (nota.ai) linhas.push(linhaDaMarca(nota.ai, fuso, "a"));

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

export function formatarCard(card: CardSummary, fuso: string): string {
  const partes = [`- ${card.title}`];
  if (card.dueDate) partes.push(`prazo ${diaDoPrazo(card.dueDate, fuso)}`);
  if (card.priority !== "media") partes.push(`prioridade ${card.priority}`);
  if (card.checklistTotal > 0) partes.push(`${card.checklistDone}/${card.checklistTotal}`);
  // As tags são o segundo eixo do quadro (RF-01): sem elas, o modelo só
  // enxerga estágio e não consegue responder "o que aqui é do assunto X".
  if (card.tags.length) partes.push(`tags: ${card.tags.join(", ")}`);
  if (card.note) partes.push(`nota: ${card.note.title}`);
  return `${partes.join(" · ")}${sufixoIa(card.ai)}\n  id: ${card.id}`;
}

/**
 * O quadro como texto. Vive aqui, e não na tool, porque `get_board`, o
 * resource `yubook://board/{id}` e o anexo do chat precisam produzir
 * exatamente o mesmo texto — duas implementações divergem, e a divergência
 * aparece como o mesmo recurso com duas caras (RN-03).
 */
export function formatarQuadro(board: BoardDetail, fuso: string): string {
  const linhas = [`# ${board.name}`, `workspace: ${board.workspaceName}`, ""];

  for (const coluna of board.columns) {
    // O limite de WIP avisa e não bloqueia (INV-15) — informamos como o quadro
    // informa, sem sugerir que estourar seja erro.
    const wip = coluna.wipLimit ? ` [${coluna.cards.length}/${coluna.wipLimit}]` : "";
    linhas.push(`## ${coluna.name}${wip}`);
    // O id da coluna é o que torna a escrita alcançável: `create_card` e
    // `move_card` endereçam por `columnId`, e este é o único lugar do servidor
    // onde ele aparece. Custa 36 caracteres por coluna, com teto de 20 colunas
    // por quadro — ~1 KB no pior caso, e sem ele as duas tools são inúteis.
    linhas.push(`  id: ${coluna.id}`);
    linhas.push(
      coluna.cards.length
        ? coluna.cards.map((card) => formatarCard(card, fuso)).join("\n")
        : "_(vazia)_",
    );
    linhas.push("");
  }

  if (board.archivedCount > 0) {
    linhas.push(`_${board.archivedCount} card(s) arquivado(s), fora do quadro._`);
  }

  return linhas.join("\n");
}

/**
 * A confirmação de uma escrita de card. Serve `create_card` e `move_card`, que
 * devolvem `CardDetail`.
 *
 * Não dá para reusar `formatarCard`: ela recebe `CardSummary` e produz a face
 * do card dentro de um quadro, sem `boardName`, `columnName` nem `archived` —
 * que é exatamente o que uma confirmação precisa provar. A pergunta que ela
 * responde é "foi parar onde?".
 *
 * A descrição vira **contagem, não trecho**. Devolver ao modelo o Markdown que
 * ele mesmo acabou de escrever gasta contexto sem dizer nada; cortá-lo seria
 * cap silencioso, que este servidor não faz.
 */
export function formatarCardDetalhe(card: CardDetail, fuso: string): string {
  const linhas = [
    `**${card.title}**`,
    `quadro: ${card.boardName} / coluna: ${card.columnName} · posição ${card.position}`,
    `id: ${card.id}`,
  ];

  if (card.ai) linhas.push(linhaDaMarca(card.ai, fuso, "o"));

  const face = [];
  if (card.dueDate) face.push(`prazo ${diaDoPrazo(card.dueDate, fuso)}`);
  face.push(`prioridade ${card.priority}`);
  if (card.checklistTotal > 0) face.push(`checklist ${card.checklistDone}/${card.checklistTotal}`);
  if (card.tags.length) face.push(`tags: ${card.tags.join(", ")}`);
  linhas.push(face.join(" · "));

  if (card.note) linhas.push(`nota: ${card.note.title} (${card.note.id})`);
  if (card.descriptionMd) linhas.push(`descrição: ${card.descriptionMd.length} caracteres`);
  if (card.archived) linhas.push("arquivado — fora do quadro");

  return linhas.join("\n");
}

/**
 * O cabeçalho de uma nota, sem o corpo. É o que as escritas de nota devolvem:
 * confirmação não é leitura, e `formatarNota` despeja o `contentMd` inteiro,
 * que pode ter 1 MB.
 */
export function formatarNotaBreve(nota: NoteDetail): string {
  const onde = nota.workspaceName ? ` · workspace: ${nota.workspaceName}` : "";
  return `**${nota.title}**\ntipo: ${nota.kind}${onde}\nid: ${nota.id}`;
}

/** O agregado da tela inicial como texto. Fonte única dos prompts. */
export function formatarDashboard(d: Dashboard, fuso: string): string {
  const linhas: string[] = [];

  const prazo = (c: CardComPrazo) =>
    `- ${c.title} — vence ${diaDoPrazo(c.dueDate, fuso)} · prioridade ${c.priority} · ` +
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
          /// `diaLocal`, e não `updatedAt.slice(0, 10)`.
          ///
          /// Era o último lugar deste arquivo em que o dia não era o do
          /// usuário, e sobreviveu ao conserto dos prazos **dentro da mesma
          /// função**, com o `fuso` já em escopo: uma nota editada às 22h em
          /// UTC−3 era relatada como editada no dia seguinte. Menos grave que o
          /// prazo — é rótulo de recência, não data que alguém combina — e
          /// exatamente a mesma classe de erro.
          .map(
            (n) =>
              `- ${n.title} (${n.kind}) — ${diaLocal(new Date(n.updatedAt), fuso)}` +
              sufixoIa(n.ai) +
              `\n  id: ${n.id}`,
          )
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
