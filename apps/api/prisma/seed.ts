/**
 * Seed do ambiente local de escrita do MCP.
 *
 * Existe porque as tools de escrita do servidor MCP precisam de um alvo que não
 * seja produção nem o banco de desenvolvimento: um acervo pequeno, conhecido e
 * recriável, onde um pedido mal interpretado do modelo não custa nada.
 *
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/yubook_mcp?schema=public" \
 *     pnpm --filter @yu-book/api db:seed
 *
 * Duas decisões que não são conveniência:
 *
 * 1. **O usuário nasce por `register()`, não por `prisma.user.create`.** O MCP
 *    entra pela rota `POST /auth/login`, então o `passwordHash` precisa ser o
 *    argon2 de verdade, com os mesmos parâmetros do serviço. Gravar o hash aqui
 *    à mão seria espelhar `ARGON_OPTIONS` — e um espelho divergente quebraria o
 *    login com um erro que não parece ter relação com o seed. É o atalho que
 *    `tests/apoio.ts` pode tomar (ele assina o JWT direto) e este não pode.
 *
 * 2. **Tudo o mais nasce pelos services, não pelo Prisma.** Board criado pelo
 *    service já vem com as três colunas padrão; nota criada pelo service já
 *    recalcula `note_link` a partir dos `[[…]]` e cria as tags. Inserir direto
 *    produziria um banco que parece certo e mente sobre o grafo.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { register } from "../src/modules/auth/auth.service.js";
import * as kanban from "../src/modules/kanban/kanban.service.js";
import * as notas from "../src/modules/notes/notes.service.js";
import * as organizacao from "../src/modules/organizacao/organizacao.service.js";

const EMAIL = "mcp@yu-book.test";
const SENHA = "mcp-local-2026";
const NOME = "Operador de teste";

/** Prazos são relativos ao dia da execução — o dashboard só é útil assim. */
function emDias(dias: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function principal(): Promise<void> {
  console.log(`Banco: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":***@")}`);

  // Idempotência: apagar o usuário leva junto workspaces, boards, cards, notas
  // e links pelo `onDelete: Cascade` do schema. Mesmo mecanismo do `limpar()`
  // dos testes, com outra marca.
  const removidos = await prisma.user.deleteMany({ where: { email: EMAIL } });
  if (removidos.count > 0) console.log("Usuário anterior removido.");

  const sessao = await register({ email: EMAIL, password: SENHA, name: NOME }, "seed");
  const userId = sessao.user.id;
  console.log(`Usuário: ${EMAIL}`);

  const estudos = await organizacao.criarWorkspace(userId, { name: "Estudos", color: "#6366f1" });
  const produto = await organizacao.criarWorkspace(userId, { name: "Yu-book", color: "#10b981" });

  /* ------------------------------------------------------------- notas ---- */

  // A ordem importa: um `[[wikilink]]` só vira aresta em `note_link` se a nota
  // de destino já existir quando a de origem é salva (INV-17).
  const criarNota = (
    title: string,
    kind: "aula" | "projeto" | "trilha" | "trabalho" | "livre",
    workspaceId: string | null,
    tags: string[],
    contentMd: string,
  ) => notas.criar(userId, { title, kind, workspaceId, tags, contentMd });

  await criarNota(
    "Notificações de progresso",
    "aula",
    estudos.id,
    ["mcp", "curso"],
    "O servidor emite, o cliente decide como mostrar.\n\n" +
      "- `ctx.info()` manda log\n- `ctx.report_progress()` manda progresso\n",
  );

  await criarNota(
    "Raízes e permissão de arquivos",
    "aula",
    estudos.id,
    ["mcp", "curso"],
    "O SDK **não** impõe a restrição — a checagem é de quem escreve a tool.\n",
  );

  await criarNota(
    "Amostragem no MCP",
    "aula",
    estudos.id,
    ["mcp", "curso"],
    "O servidor pede ao cliente que chame o modelo por ele.\n\n" +
      "Ver também [[Notificações de progresso]] e [[Raízes e permissão de arquivos]].\n",
  );

  await criarNota(
    "Transporte stdio",
    "aula",
    estudos.id,
    ["mcp"],
    "Um processo por usuário. O stdout **é** o canal do protocolo.\n\n" +
      "Contexto em [[Amostragem no MCP]].\n",
  );

  await criarNota(
    "Servidor MCP do Yu-book",
    "projeto",
    produto.id,
    ["mcp", "api"],
    "Cliente da própria API, nunca do banco.\n\nTransporte descrito em [[Transporte stdio]].\n",
  );

  await criarNota(
    "Tools de escrita",
    "projeto",
    produto.id,
    ["mcp", "kanban"],
    "Estreitas de propósito: uma escrita por chamada.\n\nBase em [[Servidor MCP do Yu-book]].\n",
  );

  await criarNota(
    "Invariantes do kanban",
    "projeto",
    produto.id,
    ["kanban"],
    "Posições contíguas, posse por cadeia, card não atravessa board, WIP avisa e não bloqueia.\n",
  );

  await criarNota(
    "Rascunho sem vínculo",
    "livre",
    null,
    [],
    "Nota solta, sem workspace e sem wikilink. Serve para provar que o escopo aguenta o nulo.\n",
  );

  await criarNota(
    "Reunião de quinta",
    "trabalho",
    produto.id,
    [],
    "Pauta: transporte HTTP, identidade, e o que fazer com a credencial no `.env`.\n",
  );

  // Esta é o alvo do par `trash_note` / `restore_note`: tem card apontando para
  // ela, então excluir prova que o vínculo se desfaz — e restaurar prova que
  // ele **não** volta (INV-19).
  const notaDaLixeira = await criarNota(
    "Nota que vai para a lixeira",
    "livre",
    estudos.id,
    ["mcp"],
    "Existe para ser excluída e restaurada. Tem um card apontando para ela.\n",
  );

  // Duas notas na lixeira, com propósitos diferentes.
  //
  // A primeira é o caminho feliz de `restore_note`. A segunda é a armadilha do
  // 409: ela vai para a lixeira e **depois** nasce uma nota ativa com o mesmo
  // título ignorando acento e caixa. O índice único é parcial — só cobre notas
  // ativas (INV-16) —, então as duas coexistem, e restaurar a da lixeira falha.
  // Sem este par, a mensagem de TITULO_DUPLICADO de `apps/mcp/src/erros.ts` não
  // tem como ser exercitada neste ambiente.
  const naLixeira = await criarNota(
    "Anotação descartada",
    "livre",
    estudos.id,
    [],
    "Já nasce na lixeira. Serve para o caminho feliz de restore_note.\n",
  );
  await notas.excluir(userId, naLixeira.id);

  const armadilha = await criarNota(
    "Programação assíncrona",
    "aula",
    estudos.id,
    [],
    "Esta vai para a lixeira e perde o título para a de baixo.\n",
  );
  await notas.excluir(userId, armadilha.id);
  await criarNota(
    "programacao assincrona",
    "aula",
    estudos.id,
    [],
    "Ativa, e ocupa o título da que está na lixeira — sem acento e em minúsculas.\n",
  );

  /* ------------------------------------------------------------ quadros --- */

  const trilha = await kanban.criarBoard(userId, { name: "Trilha de MCP", workspaceId: estudos.id });
  const backlog = await kanban.criarBoard(userId, {
    name: "Backlog do Yu-book",
    workspaceId: produto.id,
  });

  // `criarBoard` já devolve as três colunas padrão, na ordem.
  const [aFazer, fazendo, feito] = trilha.columns;
  if (!aFazer || !fazendo || !feito) throw new Error("Board sem as colunas padrão");

  // Um limite de WIP numa coluna: INV-15 diz que ele avisa e não bloqueia, e
  // sem isto o `[n/limite]` de `formatarQuadro` nunca aparece para ser lido.
  await kanban.atualizarColuna(userId, fazendo.id, { name: "Fazendo", wipLimit: 3 });

  const card = (
    columnId: string,
    title: string,
    extras: Partial<{
      tags: string[];
      priority: "baixa" | "media" | "alta";
      dueDate: Date | null;
      noteId: string | null;
      descriptionMd: string;
    }> = {},
  ) => kanban.criarCard(userId, { columnId, title, ...extras });

  await card(aFazer.id, "Ler sobre StreamableHTTP", { tags: ["curso"], priority: "alta" });
  await card(aFazer.id, "Anotar tipos de mensagem JSON", { tags: ["curso"] });
  await card(aFazer.id, "Decidir a identidade fora do .env", {
    tags: ["mcp", "auth"],
    priority: "alta",
    dueDate: emDias(3),
  });
  await card(aFazer.id, "Rever o orçamento de contexto das tools", { tags: ["mcp"] });
  await card(aFazer.id, "Card sem nada", {});

  await card(fazendo.id, "Escrever as tools de escrita", {
    tags: ["mcp", "kanban"],
    priority: "alta",
    dueDate: emDias(1),
    descriptionMd: "create_card, move_card, trash_note e restore_note.",
  });
  await card(fazendo.id, "Subir o ambiente local", { tags: ["infra"], dueDate: emDias(-2) });
  await card(fazendo.id, "Card ligado à nota da lixeira", { noteId: notaDaLixeira.id });

  // Checklist: sem ele, o ramo `checklistDone/Total` de `formatarCard` e de
  // `formatarCardDetalhe` nunca renderiza neste ambiente.
  await kanban.criarCard(userId, {
    columnId: fazendo.id,
    title: "Card com checklist",
    checklist: [
      { id: "a", text: "ler a lição", done: true },
      { id: "b", text: "anotar", done: true },
      { id: "c", text: "aplicar no projeto", done: false },
    ],
  });

  await card(feito.id, "Lição de amostragem", { tags: ["curso"], priority: "baixa" });
  await card(feito.id, "Lição de notificações", { tags: ["curso"], priority: "baixa" });
  await card(feito.id, "Lição de raízes", { tags: ["curso"], priority: "baixa" });
  await card(feito.id, "Resources e prompts", { tags: ["mcp"] });

  // Um card arquivado, porque três caminhos do servidor MCP só existem com ele:
  // o `archivedCount` do quadro, o ramo `archived` da confirmação de escrita, e
  // a recusa de `move_card` ("card arquivado não se move", INV-13).
  const paraArquivar = await card(feito.id, "Lição de introdução (arquivada)", { tags: ["curso"] });
  await kanban.atualizarCard(userId, paraArquivar.id, { archived: true });

  // O segundo quadro existe para uma prova só: mover um card para uma coluna
  // daqui precisa falhar com 422 (INV-12, card não atravessa board).
  const [backlogAFazer] = backlog.columns;
  if (!backlogAFazer) throw new Error("Board de backlog sem colunas");
  await card(backlogAFazer.id, "Agenda no Google Calendar", { tags: ["produto"] });
  await card(backlogAFazer.id, "Busca semântica com pgvector", { tags: ["produto", "ia"] });

  /* -------------------------------------------------------------- links --- */

  // Prisma cru aqui, e é a única exceção deliberada da regra deste arquivo: o
  // service de links faz `fetch` da página para descobrir o título, com as
  // defesas de SSRF de INV-08, e um seed não pode depender de rede. `link` não
  // tem nada derivado — ao contrário de `note`, cujo `note_link` só existe
  // porque o service o calcula. Sem estes três, a seção de links do dashboard
  // nasce sempre vazia e a regra "a fila de links não é urgência" do prompt
  // `revisao_semanal` nunca chega a ser exercida.
  await prisma.link.createMany({
    data: [
      {
        userId,
        url: "https://modelcontextprotocol.io/docs",
        title: "Model Context Protocol — documentação",
        domain: "modelcontextprotocol.io",
        kind: "favorito",
        position: 0,
      },
      {
        userId,
        url: "https://www.postgresql.org/docs/16/textsearch.html",
        title: "PostgreSQL — Full Text Search",
        domain: "postgresql.org",
        kind: "favorito",
        position: 1,
      },
      {
        userId,
        url: "https://react.dev/reference/react/useSyncExternalStore",
        title: "useSyncExternalStore",
        domain: "react.dev",
        kind: "depois",
      },
    ] satisfies Prisma.LinkCreateManyInput[],
  });

  /* ------------------------------------------------------------ resumo ---- */

  const contagem = await notas.contar(userId);
  const quadros = await kanban.listarBoards(userId);
  console.log("");
  console.log(`  workspaces  2`);
  console.log(`  notas       ${contagem.total} ativas · ${contagem.trash} na lixeira`);
  console.log(`  quadros     ${quadros.length}`);
  console.log(`  cards       ${quadros.reduce((n, q) => n + q.cardCount, 0)}`);
  console.log("");
  console.log(`Pronto. Aponte YUBOOK_EMAIL=${EMAIL} e YUBOOK_PASSWORD=${SENHA} no apps/mcp/.env.`);
}

principal()
  .catch((erro) => {
    console.error("Seed falhou:", erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
