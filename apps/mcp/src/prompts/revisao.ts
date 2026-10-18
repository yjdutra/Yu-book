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
 *
 * **A escrita entra no texto só quando está liberada**, pelo mesmo `escrita`
 * que decide o registro das tools (`criarServidor`). Prompt que oferece uma
 * tool que a sessão não tem é o "sugerir ação que não existe como tool" que as
 * regras dele proíbem: numa sessão só de leitura, o modelo proporia
 * `create_task` e o usuário pediria uma ação que não há como executar.
 */
export function registrarPrompts(server: McpServer, { escrita }: { escrita: boolean }): void {
  // Frente de agenda, Fase 2: a agenda também escreve, então a lista de ações
  // cresce com ela. Fora desta regra o ritual é o mesmo nas duas sessões.
  const regraDeEscrita = escrita
    ? `- **Você pode criar, mover e concluir cards, criar, alterar, converter e excluir eventos e
  tarefas, concluir tarefas, criar e alterar hábitos, registrar pontos e mandar notas para a
  lixeira** — mas só quando eu pedir. Neste ritual, no máximo *proponha* a ação e
  diga qual tool a executa; não chame nenhuma tool de escrita sem eu mandar. Um ritual de revisão
  que mexe no quadro sozinho deixa de ser confiável.`
    : `- **Esta sessão só lê.** Se algo pedir uma ação, diga qual é e que ela se faz no aplicativo;
  não proponha tool que não esteja na sua lista.`;

  server.registerPrompt(
    "revisao_semanal",
    {
      title: "Revisão semanal",
      description:
        "Mostra o que precisa de você agora: o que já venceu, a agenda e os prazos desta semana, " +
        "o que você andou escrevendo, e por onde começar.",
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

Faça estas duas chamadas, sem montar o recorte com outras:

- \`get_dashboard\`${workspace ? ` com workspaceId "${workspace}"` : ""}: prazos de card, notas
  recentes e a fila de links;
- \`list_agenda\` de hoje até hoje + 6 dias: compromissos e tarefas${
              workspace ? " (ela não filtra por workspace)" : ""
            }. A resposta diz que dia é hoje no meu fuso; se a sua data estiver errada, refaça
  com a certa.

Organize a resposta exatamente nesta ordem:

1. **O que já venceu.** Prazo de card vencido e tarefa atrasada são a única urgência de verdade
   neste aplicativo, e abrem a resposta. Se não houver, diga isso em uma linha e siga.
2. **A semana.** Compromissos, tarefas e prazos dos próximos 7 dias, por dia.
3. **O que andei escrevendo.** As notas editadas recentemente, para eu retomar o fio.
4. **Por onde começar.** Uma recomendação só, justificada pelo que está acima.

Regras:

- Não invente prazo, compromisso, tarefa, card ou nota que não tenha vindo dessas duas chamadas.
  Se o recorte disser que há mais itens fora dele, mencione o número em vez de adivinhar quais são.
${regraDeEscrita}
- **Tarefa sem data e fila de links não são urgência.** Nada nelas expira, por decisão de
  projeto. Mencione o tamanho se for grande, sem tratar como pendência.
- Cite o \`id\` de cada item que você mencionar, para eu conseguir abrir depois.
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
- **Não chame tool de escrita aqui.** Retomar contexto é leitura; se algo pedir uma ação, diga
  qual tool resolve e espere eu pedir.
`.trim(),
          },
        },
      ],
    }),
  );
}
