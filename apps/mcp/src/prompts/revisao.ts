import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Prompts — fluxos de trabalho empacotados.
 *
 * Um prompt não busca dado: devolve mensagens. Quem busca é tool ou resource.
 * Prompt que embute dado congela o dado no instante em que foi montado (RN-04).
 *
 * E um prompt bom declara o que **não** fazer. É o que separa uma instrução
 * testada de uma frase: sem limites, o modelo preenche as lacunas sozinho e
 * devolve algo plausível e errado (RN-05).
 */
export function registrarPrompts(server: McpServer): void {
  server.registerPrompt(
    "revisao_semanal",
    {
      title: "Revisão semanal",
      description:
        "Mostra o que precisa de você agora: o que já venceu, o que vence nesta semana, o que " +
        "você andou escrevendo, e por onde começar.",
      argsSchema: {
        workspace: z
          .string()
          .optional()
          .describe("Id do workspace, para revisar só um contexto. Omita para revisar tudo."),
      },
    },
    ({ workspace }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `
Faça a revisão da minha semana no Yu-book.

Comece chamando a tool \`get_dashboard\`${workspace ? ` com workspaceId "${workspace}"` : ""}.
Ela traz tudo o que você precisa numa requisição só — não monte esse recorte com várias chamadas.

Organize a resposta exatamente nesta ordem:

1. **O que já venceu.** É a única coisa neste aplicativo com urgência de verdade. Se houver
   prazo vencido, ele abre a resposta. Se não houver, diga isso em uma linha e siga.
2. **O que vence nos próximos 7 dias.** Agrupe por dia quando ajudar a enxergar a carga.
3. **O que andei escrevendo.** As notas editadas recentemente, para eu retomar o fio.
4. **Por onde começar.** Uma recomendação só, justificada pelo que está acima.

Regras:

- Não invente prazo, card ou nota que não tenha vindo do \`get_dashboard\`. Se o recorte disser
  que há mais itens fora dele, mencione o número em vez de adivinhar quais são.
- **Não sugira criar, mover ou arquivar nada.** Este servidor é somente leitura — recomendar uma
  ação que não posso executar daqui só gera trabalho manual.
- **A fila de links não é urgência.** Nada nela expira, por decisão de projeto. Mencione o tamanho
  se for grande, sem tratar como pendência.
- Cite o \`id\` de cada card e nota que você mencionar, para eu conseguir abrir depois.
- Seja direto. Isto é um ritual de dois minutos, não um relatório.
`.trim(),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "retomar_contexto",
    {
      title: "Retomar um assunto",
      description:
        "Reconstrói tudo o que você já registrou sobre um assunto — a nota principal, as que " +
        "apontam para ela e os cards vinculados — para você voltar de onde parou.",
      argsSchema: {
        assunto: z
          .string()
          .describe("O assunto a retomar. Ex.: 'autenticação JWT', 'aula de React'."),
      },
    },
    ({ assunto }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `
Preciso retomar o que eu já registrei sobre: **${assunto}**

Siga este caminho:

1. Chame \`search_notes\` com "${assunto}". A busca ignora acento e aplica stemming, e aceita
   filtros no próprio texto (\`tipo:aula\`, \`tag:algo\`, \`#workspace\`) se ajudar a estreitar.
2. Escolha o resultado mais relevante e leia com \`get_note\`. Leia **uma** nota — o corpo inteiro
   é caro, e quase sempre uma basta para achar o fio.
3. Siga o grafo em volta dela: as notas listadas em "Referenciada por" e os cards vinculados.
   Leia mais uma nota vizinha **só se** o resumo depender dela.

Depois me devolva:

- **Onde parei.** O estado do assunto, do jeito que as notas contam.
- **O que está aberto.** Pergunta sem resposta, decisão pendente, tarefa em card não concluído.
- **O que existe em volta.** As notas e cards conectados, para eu saber o que mais posso abrir.

Regras:

- Cite o \`id\` de toda nota e card que mencionar.
- Se a busca voltar por semelhança de título em vez de correspondência exata, **diga isso** — quer
  dizer que eu talvez não tenha registrado esse assunto com essas palavras.
- Se não houver nada, diga que não há. Não construa um resumo a partir do nome do assunto.
- Não sugira criar nem alterar nada: este servidor é somente leitura.
`.trim(),
          },
        },
      ],
    }),
  );
}
