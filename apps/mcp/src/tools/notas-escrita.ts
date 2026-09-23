import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FERRAMENTAS_DO_ACERVO, formatarNotaBreve } from "@yu-book/shared";
import type { NoteDetail } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErroDeEscrita } from "../erros.js";
import { relatar } from "../notificacoes.js";

/**
 * As tools que mudam o estado de uma nota — e são exatamente **duas**, uma o
 * desfazer da outra.
 *
 * **Nota não tem "arquivar".** O domínio tem duas remoções com nomes diferentes
 * de propósito: card se **arquiva** (`archived`, sai do quadro), nota vai para
 * a **lixeira** (`deletedAt`, some da busca e dos backlinks). Chamar isto de
 * `archive_note` seria inventar um estado que a tabela não tem. E `delete_note`
 * seria pior: o modelo lê "delete" como irreversível, e ou recusa por medo ou
 * executa sem oferecer a volta — além de queimar o nome que a exclusão
 * definitiva precisaria ter, se um dia for exposta.
 *
 * A exclusão definitiva (`DELETE /notes/:id/permanent`) **não vira tool**, por
 * decisão: um mal-entendido apagaria trabalho sem volta, e o aplicativo já faz
 * isso com um humano confirmando.
 */
export function registrarEscritaDeNotas(server: McpServer): void {
  const lixeira = FERRAMENTAS_DO_ACERVO.trash_note;
  server.registerTool(
    "trash_note",
    {
      title: lixeira.titulo,
      description: lixeira.descricao,
      annotations: lixeira.anotacoes,
      inputSchema: lixeira.entrada,
    },
    comErroDeEscrita(async ({ noteId }, extra) => {
      const relato = relatar(server, extra, "trash_note", 2);

      // A leitura prévia paga por si: depois do DELETE o dado não existe mais
      // para ser contado, e a diferença entre "nota apagada" e "3 links e 2
      // cards perderam o vínculo" é o que o usuário precisa para decidir se
      // quer desfazer. É também o único passo de progresso real da etapa.
      const nota = await api.get<NoteDetail>(`/notes/${noteId}`);

      // `buscarPorId` não filtra `deletedAt`, então ler uma nota que já está na
      // lixeira dá certo — e o DELETE seguinte é que falharia, com um 404 que
      // manda o modelo procurar o id onde a busca não enxerga. Melhor dizer a
      // verdade aqui e não registrar um passo de algo que não aconteceu.
      if (nota.deletedAt) {
        return {
          content: [
            {
              type: "text",
              text:
                `A nota "${nota.title}" já está na lixeira desde ${nota.deletedAt}. ` +
                `Nada foi alterado. Para trazê-la de volta: restore_note com id ${nota.id}.`,
            },
          ],
        };
      }

      await relato.passo(`nota "${nota.title}" lida`);

      await api.remover(`/notes/${noteId}`);
      await relato.passo("nota movida para a lixeira");

      await relato.registrar("warning", {
        acao: "nota para a lixeira",
        noteId: nota.id,
        title: nota.title,
        backlinksApagados: nota.backlinks.length,
        cardsDesvinculados: nota.cards.length,
      });

      const linhas = ["Nota na lixeira.", "", formatarNotaBreve(nota), ""];

      // Os dois efeitos entram separados porque têm naturezas opostas, e
      // juntá-los numa linha só foi o que produziu a afirmação errada antes:
      // o link volta ao restaurar, o vínculo do card não.
      if (nota.cards.length > 0) {
        linhas.push(
          `NÃO se desfaz: ${nota.cards.length} card(s) perderam o vínculo com esta nota. ` +
            "Card arquivado que apontava para ela também perdeu, e não entra nesta conta.",
        );
      }
      if (nota.backlinks.length > 0) {
        linhas.push(
          `${nota.backlinks.length} link(s) [[…]] apontavam para ela e foram apagados — esses ` +
            "voltam ao restaurar.",
        );
      }
      if (nota.cards.length === 0 && nota.backlinks.length === 0) {
        linhas.push("Nenhum link ou card ativo apontava para ela.");
      }

      linhas.push(`Para desfazer: restore_note com id ${nota.id}.`);

      return { content: [{ type: "text", text: linhas.join("\n") }] };
    }),
  );

  const restaurar = FERRAMENTAS_DO_ACERVO.restore_note;
  server.registerTool(
    "restore_note",
    {
      title: restaurar.titulo,
      description: restaurar.descricao,
      annotations: restaurar.anotacoes,
      inputSchema: restaurar.entrada,
    },
    comErroDeEscrita(async ({ noteId }, extra) => {
      const relato = relatar(server, extra, "restore_note", 1);

      const nota = await api.post<NoteDetail>(`/notes/${noteId}/restore`);

      await relato.passo("nota restaurada");
      await relato.registrar("info", {
        acao: "nota restaurada",
        noteId: nota.id,
        title: nota.title,
      });

      const linhas = [
        "Nota restaurada.",
        "",
        formatarNotaBreve(nota),
        "",
        "Os cards que apontavam para ela continuam sem o vínculo.",
        `Para ler o corpo: get_note com id ${nota.id}.`,
      ];

      return { content: [{ type: "text", text: linhas.join("\n") }] };
    }),
  );
}
