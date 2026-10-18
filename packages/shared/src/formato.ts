import { instanteLocal } from "./agenda.js";
import { parseSearchQuery, splitHighlight } from "./busca.js";
import type { SearchResponse, SearchResult } from "./busca.js";
import { formatarBytes } from "./arquivos.js";
import type { CardFile } from "./arquivos.js";
import type { CardComPrazo, Dashboard } from "./dashboard.js";
import type { HabitActivityRef, HabitEntryItem, HabitItem } from "./habitos.js";
import { descreverDias, diasDoEvento } from "./eventos.js";
import type { AgendaCard, AgendaRange, EventItem } from "./eventos.js";
import { diaLocal } from "./ia.js";
import type { BoardDetail, BoardSummary, CardDetail, CardSummary } from "./kanban.js";
import type { AiCompletion, AiMark } from "./marca.js";
import type { NoteDetail } from "./notes.js";
import { LIMITE_TAREFAS_SEM_DATA } from "./tarefas.js";
import type { TaskItem } from "./tarefas.js";

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
 * `AAAA-MM-DD` vira o fim daquele dia **no fuso do usuário** — como o front
 * grava. É a volta de `diaDoPrazo`, e as duas juntas mantêm o MCP, o chat e a
 * interface concordando sobre o que é "o dia do prazo".
 *
 * Não é `new Date(`${dia}T23:59:59`)`: isso interpreta no fuso do *processo*,
 * e num servidor em UTC o prazo de quem vive em UTC+5 cairia no dia seguinte.
 * A conversão de relógio de parede para instante é `instanteLocal`
 * (`agenda.ts`), a mesma que a agenda de rotina usa — era uma cópia privada
 * aqui até a Etapa F.
 *
 * O formato já é validado pelo schema da tool, mas formato válido não é data
 * válida: `2026-13-45` passa no regex e viraria `Invalid Date`.
 */
export function diaParaPrazo(dia: string, fuso: string): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  if (!ano || !mes || !d) throw new Error(`dueDate não é uma data existente: ${dia}`);
  /// A data impossível é recusada aqui, com a frase de sempre; o fuso inválido
  /// segue lançando o `RangeError` do `Intl`, como antes.
  const conferido = new Date(Date.UTC(ano, mes - 1, d));
  /// O ano também: `Date.UTC` joga 0–99 para 1900–1999.
  if (
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== d
  ) {
    throw new Error(`dueDate não é uma data existente: ${dia}`);
  }

  const resultado = instanteLocal(dia, "23:59:59", fuso);
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
  // Etapa E: a rotina tem nome, e é ele que diz de qual fluxo o texto saiu.
  partes.push(
    ai.via === "rotina" && ai.routineName ? `via rotina «${ai.routineName}»` : `via ${ai.via}`,
    diaLocal(new Date(ai.generatedAt), fuso),
  );
  if (ai.revisedAt) partes.push(`revisad${genero} em ${diaLocal(new Date(ai.revisedAt), fuso)}`);
  return partes.join(" · ");
}

/**
 * A conclusão do card (frente de cards, Parte 1), na leitura de um item. Quem
 * concluiu só aparece quando foi o assistente — é a marca de conclusão, que
 * some se o card for reaberto ou concluído à mão.
 */
function linhaDaConclusao(completedAt: string, ia: AiCompletion | null, fuso: string): string {
  const partes = [`concluído em ${diaLocal(new Date(completedAt), fuso)}`];
  if (ia) {
    partes.push(`por IA via ${ia.via}`);
    if (ia.agentName) partes.push(`«${ia.agentName}»`);
    if (ia.author) partes.push(ia.author);
  }
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
  // Logo depois do título: um card concluído com prazo passado não está
  // atrasado, e o modelo lê o prazo como cobrança se não souber disto antes.
  if (card.completedAt) partes.push("concluído");
  if (card.dueDate) partes.push(`prazo ${diaDoPrazo(card.dueDate, fuso)}`);
  if (card.priority !== "media") partes.push(`prioridade ${card.priority}`);
  if (card.checklistTotal > 0) partes.push(`${card.checklistDone}/${card.checklistTotal}`);
  // As tags são o segundo eixo do quadro (RF-01): sem elas, o modelo só
  // enxerga estágio e não consegue responder "o que aqui é do assunto X".
  if (card.tags.length) partes.push(`tags: ${card.tags.join(", ")}`);
  if (card.note) partes.push(`nota: ${card.note.title}`);
  // Frente de cards, Parte 2: só a contagem na face — os nomes vêm no detalhe.
  if (card.fileCount > 0) partes.push(`${card.fileCount} anexo(s)`);
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
 * A confirmação de uma escrita de card. Serve `create_card`, `move_card` e
 * `complete_card`, que devolvem `CardDetail`.
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
  if (card.completedAt) linhas.push(linhaDaConclusao(card.completedAt, card.aiCompletion, fuso));

  const face = [];
  if (card.dueDate) face.push(`prazo ${diaDoPrazo(card.dueDate, fuso)}`);
  face.push(`prioridade ${card.priority}`);
  if (card.checklistTotal > 0) face.push(`checklist ${card.checklistDone}/${card.checklistTotal}`);
  if (card.tags.length) face.push(`tags: ${card.tags.join(", ")}`);
  linhas.push(face.join(" · "));

  if (card.note) linhas.push(`nota: ${card.note.title} (${card.note.id})`);
  // `?.` apesar do tipo: o MCP formata **depois** de a escrita dar certo, e
  // contra uma API mais velha que este pacote `files` chega ausente — lançar
  // aqui devolveria erro ao modelo sobre um card já criado, e ele criaria outro.
  if (card.files?.length) linhas.push(linhaDosAnexos(card.files));
  if (card.descriptionMd) linhas.push(`descrição: ${card.descriptionMd.length} caracteres`);
  if (card.archived) linhas.push("arquivado — fora do quadro");

  return linhas.join("\n");
}

/// Dez nomes bastam para o modelo saber o que há; o resto vira contagem.
const ANEXOS_NO_DETALHE = 10;

/**
 * Os anexos na leitura de um card (frente de cards, Parte 2): nome, tipo e
 * tamanho. **Nunca a URL** — ela é assinada, expira em uma hora e custa
 * contexto sem dar ao modelo nada que ele consiga abrir.
 */
function linhaDosAnexos(files: CardFile[]): string {
  const nomes = files
    .slice(0, ANEXOS_NO_DETALHE)
    .map((f) => `${f.name} (${f.mimeType}, ${formatarBytes(f.sizeBytes)})`);
  const resto = files.length - ANEXOS_NO_DETALHE;
  return `anexos: ${nomes.join("; ")}${resto > 0 ? ` e mais ${resto}` : ""}`;
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

/**
 * O agregado da tela inicial como texto. Fonte única dos prompts.
 *
 * `Dashboard.rotinas` fica **de fora de propósito** (RF-62 do PRD de IA): rotinas
 * não entram no MCP nem no chat. Quem "completar" esta função vaza execuções e
 * agendas para as duas superfícies.
 */
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

/* ------------------------------------------------------------------ agenda */

/*
 * Frente de agenda, Fase 2: evento, tarefa e o período, como texto.
 *
 * **Estes formatadores não recebem fuso, e é de propósito.** Evento e tarefa
 * já chegam da API em dia (`AAAA-MM-DD`) e hora (`HH:MM`) **locais do
 * usuário** — o servidor converteu pelo `ai_preference.timezone` —, então aqui
 * não há instante a converter. Converter de novo seria a única forma de errar.
 * Os instantes que vêm junto (`startsAt`, `completedAt`, a data da marca) não
 * são impressos, pelo mesmo motivo.
 *
 * O dia da semana sai do dia **civil**, por `Date.UTC`: é aritmética de
 * calendário, sem fuso nenhum.
 *
 * Campo lido com `?.` apesar do tipo: o MCP formata depois da escrita, contra
 * uma API que pode ser mais velha que este pacote (§13 da skill do MCP).
 */

const DIAS_DA_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/** `quinta-feira, 2026-10-08` — o dia da semana de um dia civil. */
function diaComSemana(dia: string): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  const semana = DIAS_DA_SEMANA[new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, d ?? 1)).getUTCDay()];
  return semana ? `${semana}, ${dia}` : dia;
}

/** A marca sem o dia: o dia dela é instante, e estes formatadores não têm fuso. */
function linhaDaMarcaSemDia(ai: AiMark, genero: "a" | "o"): string {
  const partes = [`gerad${genero} por IA`];
  if (ai.agentName) partes.push(`«${ai.agentName}»`);
  if (ai.author) partes.push(ai.author);
  partes.push(
    ai.via === "rotina" && ai.routineName ? `via rotina «${ai.routineName}»` : `via ${ai.via}`,
  );
  return partes.join(" · ");
}

/**
 * O horário do evento visto **de um dia** em que ele aparece. Sem `dia`, o
 * horário inteiro, para a confirmação.
 */
function horarioDoEvento(evento: EventItem, dia?: string): string {
  const dias = diasDoEvento(evento);
  if (evento.allDay) {
    if (dias.length <= 1) return "dia inteiro";
    return `dia inteiro (${evento.date} a ${evento.endDate})`;
  }
  // Com hora, num dia só — inclusive o que acaba às 00:00 do seguinte.
  const inicio = evento.startTime ?? "?";
  if (dias.length <= 1) return `${inicio}–${evento.endTime ?? "?"}`;
  const ate = `${evento.endDate} ${evento.endTime ?? "?"}`;
  // No dia do meio ou do fim, o início leva o dia: "22:00" sozinho num dia
  // que não é o do início faria o modelo ler um evento que começa ali.
  const de = dia === undefined || dia === evento.date ? inicio : `${evento.date} ${inicio}`;
  return `${de} → ${ate}`;
}

/**
 * `repete seg, qua, sex até 2026-12-18`, ou `null` no evento simples (frente de
 * eventos recorrentes, R2). `?? null`: `recurrence` é posterior ao `EventItem`
 * da frente de agenda, e o MCP pode formatar a resposta de uma API que ainda
 * não o manda — lançar aqui, depois da escrita, diria ao modelo que falhou um
 * evento já criado.
 */
function repeticaoDoEvento(evento: EventItem): string | null {
  const regra = evento.recurrence ?? null;
  if (!regra?.days?.length) return null;
  return `repete ${descreverDias(regra.days)}${regra.until ? ` até ${regra.until}` : ""}`;
}

/**
 * Uma linha de evento numa lista por dia. A série já chega expandida da API,
 * uma ocorrência por dia, com o `id` da série — basta ao chat, que não edita
 * evento —; a repetição vai em cada linha para que "a aula de quarta" não seja
 * lida como compromisso avulso.
 */
function linhaDoEvento(evento: EventItem, dia: string): string {
  const partes = [`- ${horarioDoEvento(evento, dia)}`, `**${evento.title}**`];
  const repete = repeticaoDoEvento(evento);
  if (repete) partes.push(repete);
  if (evento.board?.name) partes.push(`projeto ${evento.board.name}`);
  if (evento.location) partes.push(`local: ${evento.location}`);
  return `${partes.join(" · ")}${sufixoIa(evento.ai ?? null)}\n  id: ${evento.id}`;
}

/** Uma linha de tarefa numa lista. `[ ]` aberta, `[x]` concluída. */
function linhaDaTarefa(tarefa: TaskItem, comDia: boolean): string {
  const caixa = tarefa.completedAt ? "[x]" : "[ ]";
  const partes = [`- ${caixa} ${tarefa.title}`];
  const quando = [comDia ? tarefa.date : null, tarefa.time, tarefa.overdue ? "(atrasada)" : null]
    .filter(Boolean)
    .join(" ");
  if (quando) partes.push(quando);
  if (tarefa.board?.name) partes.push(`projeto ${tarefa.board.name}`);
  // `?.`: a API mais velha que a tarefa recorrente nem manda a chave.
  if (tarefa.series?.days?.length) partes.push(`repete ${descreverDias(tarefa.series.days)}`);
  return `${partes.join(" · ")}${sufixoIa(tarefa.ai ?? null)}\n  id: ${tarefa.id}`;
}

/** Um card com prazo, na agenda. O id é o de `complete_card`. */
function linhaDoCardNaAgenda(card: AgendaCard): string {
  const prioridade =
    card.priority && card.priority !== "media" ? ` · prioridade ${card.priority}` : "";
  return (
    `- prazo do card **${card.title}** · ${card.boardName} / ${card.columnName}${prioridade}` +
    `\n  id: ${card.id}`
  );
}

/**
 * Um evento inteiro: é a confirmação de `create_event`. A descrição vira
 * contagem, como em `formatarCardDetalhe` — devolver ao modelo o texto que ele
 * acabou de escrever só gasta contexto. Numa série, o dia é o da primeira
 * ocorrência, e a linha seguinte diz a regra: é o que o modelo confirma ao
 * usuário — um compromisso, não um por semana.
 */
export function formatarEvento(evento: EventItem): string {
  const linhas = [
    `**${evento.title}**`,
    `${diaComSemana(evento.date)} · ${horarioDoEvento(evento)}`,
  ];
  const repete = repeticaoDoEvento(evento);
  if (repete) linhas.push(repete);
  linhas.push(`id: ${evento.id}`);
  if (evento.board?.name) linhas.push(`projeto: ${evento.board.name}`);
  // Por verdade, e não `!== null`: campo da frente Ritmo, e a API no ar pode
  // ser mais velha e nem mandar a chave (§13 da skill do MCP).
  if (evento.habitActivity) {
    // `checkedIn` é da Ritmo 2: a API mais velha não o manda, e ausente lê
    // como sem check-in.
    const feito = evento.checkedIn ? ` · check-in feito em ${evento.occurrenceDate}` : "";
    linhas.push(linhaDoVinculo(evento.habitActivity, "check-in") + feito);
  }
  if (evento.location) linhas.push(`local: ${evento.location}`);
  if (evento.url) linhas.push(`link: ${evento.url}`);
  if (evento.ai) linhas.push(linhaDaMarcaSemDia(evento.ai, "o"));
  if (evento.description) linhas.push(`descrição: ${evento.description.length} caracteres`);
  return linhas.join("\n");
}

/**
 * Uma tarefa inteira: é a confirmação de `create_task` e de `complete_task`.
 * A conclusão aparece sem dia (o `completedAt` é instante); quem concluiu, só
 * quando foi o assistente — a marca segue o estado (INV-63).
 */
export function formatarTarefa(tarefa: TaskItem): string {
  const caixa = tarefa.completedAt ? "[x]" : "[ ]";
  const quando = tarefa.date
    ? `${diaComSemana(tarefa.date)}${tarefa.time ? ` · ${tarefa.time}` : ""}`
    : "sem data";
  const linhas = [
    `${caixa} **${tarefa.title}**`,
    `${quando}${tarefa.overdue ? " (atrasada)" : ""}`,
  ];
  const serie = tarefa.series ?? null;
  if (serie?.days?.length) {
    linhas.push(
      `repete ${descreverDias(serie.days)}${serie.until ? ` até ${serie.until}` : ""}` +
        ` · série ${serie.id}`,
    );
  }
  linhas.push(`id: ${tarefa.id}`);
  if (tarefa.board?.name) linhas.push(`projeto: ${tarefa.board.name}`);
  if (tarefa.habitActivity) linhas.push(linhaDoVinculo(tarefa.habitActivity, "concluir"));
  if (tarefa.ai) linhas.push(linhaDaMarcaSemDia(tarefa.ai, "a"));
  if (tarefa.completedAt) {
    const ia = tarefa.completion;
    const partes = ["concluída"];
    if (ia) {
      partes.push(`por IA via ${ia.via}`);
      if (ia.agentName) partes.push(`«${ia.agentName}»`);
      if (ia.author) partes.push(ia.author);
    }
    linhas.push(partes.join(" · "));
  }
  if (tarefa.descriptionMd) linhas.push(`descrição: ${tarefa.descriptionMd.length} caracteres`);
  return linhas.join("\n");
}

/**
 * O período, dia a dia: é o que `list_agenda` devolve.
 *
 * O evento aparece **em cada dia em que ocupa algum tempo** — por
 * `diasDoEvento`, a mesma regra da consulta da API (§4.8 do contrato) — e só
 * nos dias do período. Dia vazio não aparece, e o cabeçalho diz isso: para
 * "estou livre quinta?" a ausência do dia é a resposta, e trinta linhas de
 * "nada" custariam contexto sem dizer mais.
 *
 * As atrasadas **anteriores** ao período vêm à parte e primeiro; as de dentro
 * dele aparecem no seu dia, com "(atrasada)" — nenhuma sai duas vezes. As
 * abertas **sem data** vêm no fim, com id: sem elas, "conclua a tarefa X" de
 * uma tarefa sem dia não teria onde achar o id.
 */
export function formatarAgenda(agenda: AgendaRange): string {
  const eventos = agenda.events ?? [];
  const tarefas = agenda.tasks ?? [];
  const atrasadas = agenda.overdueTasks ?? [];
  const cards = agenda.cards ?? [];
  /// `?? []`: campo posterior ao `AgendaRange` da Fase 1, e o MCP pode falar
  /// com uma API que ainda não o manda.
  const semData = agenda.undatedTasks ?? [];

  const periodo =
    agenda.from === agenda.to ? diaComSemana(agenda.from) : `${agenda.from} a ${agenda.to}`;
  const cabecalho = [`Agenda de ${periodo}`];
  if (agenda.today) cabecalho.push(`hoje é ${diaComSemana(agenda.today)}`);
  if (agenda.timezone) cabecalho.push(`fuso ${agenda.timezone}`);
  const linhas = [`${cabecalho.join(" · ")}.`];

  if (atrasadas.length) {
    linhas.push("", "## Tarefas atrasadas, de antes do período");
    linhas.push(...atrasadas.map((t) => linhaDaTarefa(t, true)));
  }

  /// Por dia, na ordem do calendário: os dias vêm das próprias datas, então
  /// ordenar as chaves `AAAA-MM-DD` como texto é ordenar por data.
  const porDia = new Map<string, string[]>();
  const noDia = (dia: string) => {
    let lista = porDia.get(dia);
    if (!lista) porDia.set(dia, (lista = []));
    return lista;
  };
  for (const evento of eventos) {
    for (const dia of diasDoEvento(evento)) {
      if (dia >= agenda.from && dia <= agenda.to) noDia(dia).push(linhaDoEvento(evento, dia));
    }
  }
  for (const tarefa of tarefas) {
    if (tarefa.date) noDia(tarefa.date).push(linhaDaTarefa(tarefa, false));
  }
  for (const card of cards) noDia(card.date).push(linhaDoCardNaAgenda(card));

  if (porDia.size === 0) {
    linhas.push("", atrasadas.length ? "Nada marcado no período." : "Nada na agenda no período.");
  } else {
    for (const dia of [...porDia.keys()].sort()) {
      const hoje = dia === agenda.today ? " (hoje)" : "";
      linhas.push("", `## ${diaComSemana(dia)}${hoje}`, ...(porDia.get(dia) ?? []));
    }
    linhas.push("", "_Dias sem nada não aparecem._");
  }

  if (semData.length) {
    linhas.push("", "## Tarefas abertas sem data");
    linhas.push(...semData.map((t) => linhaDaTarefa(t, true)));
    // A API corta no limite e não manda o total: dizer que pode haver mais é
    // o que impede o modelo de ler a lista como tudo o que existe.
    if (semData.length >= LIMITE_TAREFAS_SEM_DATA) {
      linhas.push(`_As ${semData.length} mais recentes; pode haver mais._`);
    }
  }
  return linhas.join("\n");
}

/* ---------------------------------------------------------------
   Hábitos (frente Ritmo, Ritmo 1 — RF-12, RNF-04)
   --------------------------------------------------------------- */

/** O vínculo de tarefa ou evento, numa linha: o que pontua e em que hábito. */
function linhaDoVinculo(vinculo: HabitActivityRef, gesto: "concluir" | "check-in"): string {
  return `hábito: ${vinculo.habitName} › ${vinculo.name} · +${vinculo.points} ao ${gesto}`;
}

/**
 * Os hábitos com a semana: é o que `list_habits` devolve. Cada hábito diz o
 * que conta para a meta, o teto e os dias; cada atividade ativa, o id e os
 * pontos — é daqui que o modelo tira `habitId` e `activityId`. Arquivadas
 * ficam de fora: não recebem registro (RN-07), e listá-las só convidaria ao erro.
 */
export function formatarHabitos(habitos: HabitItem[]): string {
  if (habitos.length === 0) return "Nenhum hábito ativo.";
  const semana = habitos[0]?.week;
  const linhas = [
    semana ? `Hábitos · semana de ${semana.start} a ${semana.end}.` : "Hábitos.",
  ];
  for (const h of habitos) {
    const w = h.week;
    const pct = Math.min(100, Math.round((w.progress / Math.max(1, h.weeklyGoal)) * 100));
    const cabeca = [
      `## ${h.name}`,
      `${w.progress}/${h.weeklyGoal} pts (${pct}%)`,
      `teto ${w.cap}/dia`,
      `${w.activeDays} de ${h.targetDays} dias`,
    ];
    if (w.goalMet) cabeca.push("meta batida");
    linhas.push("", cabeca.join(" · "), `id: ${h.id}`);
    if (w.extra > 0) linhas.push(`acima do teto (só XP): ${w.extra} pts`);
    const ativas = (h.activities ?? []).filter((a) => !a.archived);
    for (const a of ativas) linhas.push(`- ${a.name} · ${a.points} pts · id: ${a.id}`);
    if (ativas.length === 0) linhas.push("- sem atividades: registre com `points`");
  }
  return linhas.join("\n");
}

/** Um registro: é a confirmação de `log_habit`. */
export function formatarRegistroDeHabito(registro: HabitEntryItem, habito: string): string {
  const partes = [`+${registro.points} pts em **${habito}**`];
  if (registro.activity) partes.push(registro.activity.name);
  partes.push(diaComSemana(registro.day));
  const linhas = [partes.join(" · "), `id: ${registro.id}`];
  if (registro.note) linhas.push(`nota: ${registro.note}`);
  return linhas.join("\n");
}
