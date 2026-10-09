import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChatAttachmentInput,
  ChatCreated,
  ChatEvent,
  ChatMessage,
  ChatSource,
  Conversation,
  ConversationDetail,
  ConversationInput,
} from "@yu-book/shared";
import { api, apiStream } from "./api";

/**
 * O núcleo do chat ancorado (Etapa B da frente de IA), comum aos dois fronts
 * desde a Fase 5 da frente de agenda: o transporte, as consultas de conversa e
 * o redutor da fala em curso. O web e o móvel desenham diferente; o que chega
 * do servidor, e como vira estado, é um só.
 *
 * O invariante do arquivo é o mesmo de `ia.ts` do web: **nenhuma chave de
 * provedor passa por aqui**. Toda chamada de modelo sai do servidor (RNF-02), e
 * o que o front conhece é um fluxo de eventos.
 *
 * Fica de fora o que toca as telas de um app só: as invalidações do acervo
 * depois de criar ou concluir (`invalidarCriados`, `invalidarConclusao`), o
 * "Virar nota" e as chaves do gasto, em `apps/web/src/lib/chat.ts`. O móvel não
 * tem as listas de notas e quadros que elas refazem — cada app invalida o que
 * mostra. Daqui, só `import type` de `shared`: a sessão do web, que importa
 * este módulo, mora no chunk inicial.
 */

/**
 * As chaves de cache, **exportadas**.
 *
 * Quem invalida está na sessão de cada app, e quem consulta está aqui. Escritas
 * à mão nos dois lugares, trocar uma deixaria a outra invalidando coisa
 * nenhuma, sem erro de tipo e sem sintoma.
 */
export const CHAVE_CONVERSAS = ["ia", "conversas"] as const;
export const chaveDaConversa = (id: string) => ["ia", "conversa", id] as const;

const CONVERSAS = CHAVE_CONVERSAS;
const conversa = chaveDaConversa;

export function useConversas() {
  return useQuery({
    queryKey: CONVERSAS,
    queryFn: () => api.get<Conversation[]>("/ai/conversations"),
    staleTime: 30_000,
  });
}

export function useConversa(id: string | null) {
  return useQuery({
    queryKey: conversa(id ?? ""),
    queryFn: () => api.get<ConversationDetail>(`/ai/conversations/${id}`),
    enabled: Boolean(id),
  });
}

export function useCriarConversa() {
  const qc = useQueryClient();
  return useMutation({
    /// `agentId` só na criação: o agente é fixo por conversa (Etapa D).
    mutationFn: (input: ConversationInput) => api.post<Conversation>("/ai/conversations", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONVERSAS }),
  });
}

export function useRenomearConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<Conversation>(`/ai/conversations/${id}`, { title }),
    onSuccess: (atualizada) => {
      qc.invalidateQueries({ queryKey: CONVERSAS });
      /// Costura em vez de invalidar: renomear não muda uma mensagem sequer, e
      /// recarregar a conversa inteira jogaria fora o que já está na tela.
      qc.setQueryData<ConversationDetail>(conversa(atualizada.id), (atual) =>
        atual ? { ...atual, ...atualizada } : atual,
      );
    },
  });
}

export function useExcluirConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ai/conversations/${id}`),
    onSuccess: (_vazio, id) => {
      qc.removeQueries({ queryKey: conversa(id) });
      qc.invalidateQueries({ queryKey: CONVERSAS });
    },
  });
}

/**
 * Lê o `text/event-stream` da resposta, entregando cada evento a quem chamou.
 *
 * É a única leitura incremental de corpo HTTP dos fronts. Três cuidados que não
 * são opcionais:
 *
 * - o pedaço que chega pode **cortar um evento ao meio** — TCP não respeita
 *   fronteira de `\n\n` —, então o resto fica guardado para o pedaço seguinte;
 * - `decode(..., { stream: true })` porque um caractere multibyte também pode
 *   vir partido entre dois pedaços, e sem isto acentos viram `�`;
 * - o `signal` cancela de verdade: fechar o painel no meio de uma resposta
 *   precisa soltar a conexão, não deixá-la escrevendo em memória.
 *
 * Genérico no evento desde a Etapa E: o chat lê `ChatEvent`, a execução de
 * rotina lê `RotinaEvent`. Bloco sem linha `data:` — o `: ping` de 15 em 15 s
 * que segura a conexão da rotina aberta atrás de proxy — é comentário de SSE e
 * é ignorado.
 */
export async function lerEventos<E = ChatEvent>(
  resposta: Response,
  aoEvento: (evento: E) => void,
): Promise<void> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return;

  const decodificador = new TextDecoder();
  let resto = "";

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;

    resto += decodificador.decode(value, { stream: true });
    const blocos = resto.split("\n\n");
    resto = blocos.pop() ?? "";

    for (const bloco of blocos) {
      const linha = bloco.split("\n").find((l) => l.startsWith("data:"));
      if (!linha) continue;
      try {
        aoEvento(JSON.parse(linha.slice("data:".length).trim()) as E);
      } catch {
        /// Evento malformado não derruba a conversa inteira.
      }
    }
  }
}

export interface EnvioDeMensagem {
  conversationId: string;
  content: string;
  attachments: ChatAttachmentInput[];
  aoEvento: (evento: ChatEvent) => void;
  signal?: AbortSignal;
}

/**
 * Manda a mensagem e consome o fluxo.
 *
 * Não é `useMutation`: o valor desta chamada não é o retorno, são os eventos
 * que chegam durante ela — e o cache de quem acompanha é o estado local da
 * sessão, não o do TanStack.
 */
export async function enviarMensagem({
  conversationId,
  content,
  attachments,
  aoEvento,
  signal,
}: EnvioDeMensagem): Promise<void> {
  const resposta = await apiStream(`/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, attachments }),
    ...(signal && { signal }),
  });
  await lerEventos(resposta, aoEvento);
}

/* ---------------------------------------------------------------
   A fala em curso e o redutor dos eventos
   --------------------------------------------------------------- */

export interface Anexo extends ChatAttachmentInput {
  titulo: string;
}

/// O alvo de um anexo, que é sempre um dos três. Serve de chave de lista e de
/// identidade para tirar um do contexto — **o título não serve**: dois cards em
/// colunas diferentes podem se chamar igual, e remover pelo título levaria o
/// homônimo junto.
export const alvoDe = (a: ChatAttachmentInput & { titulo?: string }) =>
  a.noteId ?? a.cardId ?? a.boardId ?? a.titulo ?? "";

/** Identidade de um item criado — nota e card vivem em tabelas diferentes. */
export const chaveCriado = (c: ChatCreated) => `${c.kind}:${c.id}`;

/** Uma fala ainda não persistida, enquanto o fluxo corre. */
export interface EmCurso {
  /** A conversa a que a fala pertence — `null` enquanto ela está sendo criada. */
  conversaId: string | null;
  pergunta: string;
  /**
   * O id da pergunta **como o servidor a gravou**, que chega no evento
   * `inicio` — `null` até lá. É por ele que `semOTurnoEmCurso` esconde a cópia
   * gravada, nunca pelo texto.
   */
  perguntaId: string | null;
  anexos: Anexo[];
  texto: string;
  ferramenta: string | null;
  /** O provedor está buscando na web antes de responder (Etapa G) — até o primeiro pedaço. */
  buscando: boolean;
  fontes: ChatSource[];
  /** O que a resposta já gravou no acervo (Etapa C da IA) — chega antes do fim. */
  criados: ChatCreated[];
  cortados: string[];
  /** Premissas do agente que não couberam (Etapa D) — declaradas como os anexos. */
  premissasCortadas: string[];
}

/** A fala recém-enviada, antes do primeiro evento. */
export function falaNova(
  conversaId: string | null,
  pergunta: string,
  anexos: Anexo[],
): EmCurso {
  return {
    conversaId,
    pergunta,
    perguntaId: null,
    anexos,
    texto: "",
    ferramenta: null,
    buscando: false,
    fontes: [],
    criados: [],
    cortados: [],
    premissasCortadas: [],
  };
}

/**
 * O que cada evento do fluxo faz com a fala em curso — **puro**, sem efeito.
 *
 * Saiu do `aoEvento` da sessão do web para os dois fronts concordarem sobre o
 * que se vê durante a resposta. O que tem efeito — o erro, as invalidações, as
 * marcas de "concluiu" — continua na sessão de cada app, fora do updater: com o
 * `StrictMode` ligado ele roda duas vezes, e um updater que produz efeito deixa
 * de ser puro. Evento que não muda nada devolve **a mesma** fala, e o React não
 * repinta.
 */
export function aplicarEvento(f: EmCurso, evento: ChatEvent): EmCurso {
  switch (evento.tipo) {
    case "inicio":
      return {
        ...f,
        perguntaId: evento.mensagem.id,
        cortados: evento.cortados,
        premissasCortadas: evento.premissasCortadas ?? [],
      };
    case "delta":
      return { ...f, texto: f.texto + evento.texto, ferramenta: null, buscando: false };
    case "ferramenta":
      return { ...f, ferramenta: evento.nome, buscando: false };
    case "busca":
      return { ...f, buscando: true };
    case "fontes":
      /// Acumula sem deduplicar, de propósito: quem tira a repetição é quem
      /// desenha (`Fontes` no web), pela `chaveDaFonteDoChat` da API. Chamá-la
      /// aqui traria o módulo `chat` de `shared` — com os schemas dele — para
      /// o bundle inicial do web, onde a sessão mora (medido na Etapa G). Uma
      /// segunda definição de "a mesma fonte" escrita aqui seria o
      /// espelhamento frágil que ela existe para evitar.
      return evento.fontes.length ? { ...f, fontes: [...f.fontes, ...evento.fontes] } : f;
    case "criado": {
      const novos = evento.criados.filter(
        (x) => !f.criados.some((j) => chaveCriado(j) === chaveCriado(x)),
      );
      return novos.length ? { ...f, criados: [...f.criados, ...novos] } : f;
    }
    default:
      return f;
  }
}

/**
 * As falas gravadas, menos as do turno que ainda está chegando.
 *
 * Na conversa nova o detalhe é lido pela primeira vez **durante** a resposta —
 * a conversa acaba de nascer —, e o servidor já gravou a pergunta, que a fala em
 * curso também desenha: ela aparecia duas vezes até o fim do fluxo, quando o
 * cache é refeito e a fala em curso some. Sai a pergunta gravada **deste**
 * fluxo, pelo id que o evento `inicio` trouxe, e o que veio depois dela.
 *
 * **Por identidade, não por texto.** Comparar o conteúdo escondia o turno
 * legítimo: a mesma pergunta repetida depois de um Parar ou de um erro some da
 * tela enquanto a nova corre. Antes do `inicio` não se sabe o id e nada sai —
 * a cópia, se o detalhe chegar nesse meio-tempo, dura até o primeiro evento.
 */
export function semOTurnoEmCurso(
  mensagens: ChatMessage[],
  emCurso: { perguntaId: string | null } | null,
): ChatMessage[] {
  const id = emCurso?.perguntaId;
  if (!id) return mensagens;
  const i = mensagens.findIndex((m) => m.id === id);
  return i === -1 ? mensagens : mensagens.slice(0, i);
}

const DIA = 24 * 60 * 60 * 1000;

/**
 * Hoje, últimos 7 dias, antes — a mesma divisão de qualquer histórico de
 * conversa, nos dois fronts. Pelo relógio do aparelho, de propósito: é a
 * vizinhança da conversa na lista, não um dia de agenda (INV-66 não se aplica).
 */
export function agruparConversas(conversas: Conversation[]): [string, Conversation[]][] {
  const inicioDeHoje = new Date();
  inicioDeHoje.setHours(0, 0, 0, 0);
  const hoje = inicioDeHoje.getTime();

  const grupos: [string, Conversation[]][] = [
    ["Hoje", []],
    ["Últimos 7 dias", []],
    ["Antes", []],
  ];
  for (const c of conversas) {
    const quando = new Date(c.updatedAt).getTime();
    const grupo = quando >= hoje ? grupos[0] : quando >= hoje - 7 * DIA ? grupos[1] : grupos[2];
    grupo?.[1].push(c);
  }
  return grupos.filter(([, lista]) => lista.length > 0);
}
