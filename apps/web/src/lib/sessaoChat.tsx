import { useQueryClient } from "@tanstack/react-query";
import type { ErrorCode } from "@yu-book/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { invalidarAgenda } from "@yu-book/cliente/agenda";
import { ApiError } from "@yu-book/cliente/api";
import {
  CHAVE_CONVERSAS,
  alvoDe,
  aplicarEvento,
  chaveDaConversa,
  enviarMensagem,
  falaNova,
  useCriarConversa,
} from "@yu-book/cliente/chat";
import type { Anexo, EmCurso } from "@yu-book/cliente/chat";
import { CHAVE_AJUSTES } from "@yu-book/cliente/ia";
import { CHAVE_USO, invalidarConclusao, invalidarCriados } from "./chat";

/**
 * A sessão do chat (redesenho de UI, Etapa 3).
 *
 * O chat tem duas superfícies — o painel lateral e a rota `/assistente` — e uma
 * conversa só: trocar de uma para a outra no meio de uma resposta não pode
 * perdê-la. Por isso o estado e o fluxo moram aqui, num provedor sempre
 * montado, e as superfícies só desenham.
 *
 * **Dois contextos, de propósito.** O estado (texto, fala em curso) muda a
 * cada tecla e a cada pedaço da resposta; as ações quase nunca. Quem só abre o
 * painel — a casca, o editor, o card — assina as ações, e não renderiza de novo
 * a cada pedaço que chega. Num contexto só, a casca inteira (quadro e editor
 * inclusive) re-renderizaria dezenas de vezes por segundo durante a resposta.
 *
 * Importa só o núcleo do chat (`@yu-book/cliente/chat`) e `chat.ts`, que são
 * leves: o renderizador de Markdown e os átomos visuais ficam nas superfícies,
 * que carregam sob demanda. O que cada evento faz com a fala em curso é o
 * redutor puro de lá (`aplicarEvento`), o mesmo do móvel; o que tem efeito —
 * erro, invalidação, as marcas de "concluiu" — fica aqui.
 */

/**
 * Um erro da conversa. O `code` decide o que a tela oferece junto — o modelo do
 * agente que saiu dos favoritos pede um link para o editor dele —, e a
 * mensagem é só para ler (a regra é ramificar por `code`, nunca por texto).
 */
export interface ErroChat {
  mensagem: string;
  code: ErrorCode | null;
}

const CHAVE_ABERTO = "yb:chat-aberto";
/// Quanto vale um pedido de foco à espera do campo (o chunk do painel chegando).
const PRAZO_DO_FOCO = 5000;

/**
 * A rota em que a conversa ocupa a tela — e onde, por isso, o painel não
 * existe. **Não** é "a área Assistente": desde a Etapa D a área tem também a
 * galeria e o editor de agentes (`/assistente/agentes…`), e neles o painel
 * volta a existir. Confundir as duas faria uma resposta em curso sumir ao ir
 * do chat para a galeria — nenhuma superfície à vista, e o laço pagando
 * (INV-56).
 */
export function naTelaDoChat(pathname: string): boolean {
  return pathname === "/assistente" || pathname === "/assistente/";
}

/**
 * O `state` de navegação que leva a `/assistente` pedindo uma conversa nova —
 * com um agente, ou sem (Etapa D: da galeria e do editor de agentes). A troca
 * acontece **lá**, ao chegar, e não antes de navegar: saindo do editor com
 * rascunho sujo, a guarda de saída segura o `navigate`, e a conversa trocada
 * antes teria mudado sem a pessoa sair de onde estava.
 */
export interface EstadoRotaChat {
  conversaNova?: { agente: { id: string; name: string } | null };
}

/** O aviso de quem pediu conversa nova com uma resposta chegando (INV-56). */
export function avisoDeEspera(agente: string | null): string {
  return agente
    ? `Espere a resposta terminar para conversar com «${agente}».`
    : "Espere a resposta terminar para começar outra conversa.";
}

/** O botão do trilho que alterna o painel — recebe o foco quando não há origem. */
export const ID_BOTAO_PAINEL = "yb-botao-painel-assistente";

interface EstadoChat {
  conversaId: string | null;
  texto: string;
  anexos: Anexo[];
  emCurso: EmCurso | null;
  erro: ErroChat | null;
  /**
   * O agente escolhido para a **próxima** conversa (Etapa D), enquanto ela não
   * existe. Depois de criada, o agente é o dela (`Conversation.agent`) e fica
   * fixo: trocar exigiria reescrever as premissas de um histórico que já as
   * usou.
   */
  agenteId: string | null;
  /**
   * O que o usuário desfez do que o chat criou (RN-03 da IA). Mora aqui, e não
   * na superfície, para sobreviver à troca entre painel e `/assistente` e à
   * passagem da fala em curso para a gravada: um "Desfazer" que reaparecesse
   * mandaria apagar de novo o que já não existe.
   */
  desfeitos: ReadonlySet<string>;
}

interface AcoesChat {
  painelAberto: boolean;
  setTexto: (t: string) => void;
  limparErro: () => void;
  /**
   * Sem argumento, manda o rascunho da sessão. O compositor passa o texto à
   * vista — com o ditado ouvindo, o parcial ainda não chegou ao rascunho.
   */
  enviar: (visivel?: string) => Promise<void>;
  parar: () => void;
  /** Começa do zero; com `agenteId`, a próxima conversa será com ele. */
  novaConversa: (agenteId?: string | null) => void;
  /** Troca o agente da conversa ainda vazia — o seletor "Conversar com". */
  escolherAgente: (agenteId: string | null) => void;
  selecionar: (id: string) => void;
  anexar: (a: Anexo) => void;
  desanexar: (alvo: string) => void;
  abrirPainel: (opcoes?: { anexo?: Anexo; nova?: boolean }) => void;
  fecharPainel: () => void;
  alternarPainel: () => void;
  /** Há resposta sendo gerada agora — lido na hora, sem assinar o estado. */
  temFluxo: () => boolean;
  marcarDesfeito: (chave: string) => void;
  /** O campo da superfície visível — é ele que o atalho e o "abrir" focam. */
  registrarCampo: (ref: RefObject<HTMLTextAreaElement | null>) => () => void;
  focarCampo: () => void;
}

const ContextoEstado = createContext<EstadoChat | null>(null);
const ContextoAcoes = createContext<AcoesChat | null>(null);

export function ProvedorSessaoChat({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const criar = useCriarConversa();

  const [painelAberto, setPainelAberto] = useState(
    () => localStorage.getItem(CHAVE_ABERTO) === "1",
  );
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [emCurso, setEmCurso] = useState<EmCurso | null>(null);
  const [erro, setErro] = useState<ErroChat | null>(null);
  const [agenteId, setAgenteId] = useState<string | null>(null);
  const [desfeitos, setDesfeitos] = useState<ReadonlySet<string>>(() => new Set());

  /// As ações leem o estado por aqui, para continuarem as mesmas entre renders.
  const atual = useRef({ painelAberto, conversaId, texto, anexos, agenteId });
  atual.current = { painelAberto, conversaId, texto, anexos, agenteId };

  /**
   * O controle do envio **inteiro**, criado antes de qualquer `await`. Se ele
   * nascesse só depois de criar a conversa, fechar o painel nessa janela
   * chamaria um `parar()` sem nada para parar, e o fluxo começaria depois com
   * ninguém vendo. Enquanto ele existe, outro envio não começa — dois Enter
   * rápidos numa conversa nova criariam duas conversas e dois fluxos.
   */
  const abortarRef = useRef<AbortController | null>(null);
  const campoRef = useRef<RefObject<HTMLTextAreaElement | null> | null>(null);
  /** Quem tinha o foco quando o painel abriu — recebe-o de volta ao fechar (RNF-06 F1). */
  const origemRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    localStorage.setItem(CHAVE_ABERTO, painelAberto ? "1" : "0");
  }, [painelAberto]);

  /**
   * Sair da sessão (logout desmonta o provedor) solta a conexão. É uma das
   * regras que garantem que o laço do servidor — até cinco passos, cada um
   * gravando contra o teto do dia — não siga rodando sem ninguém vendo.
   */
  useEffect(() => () => abortarRef.current?.abort(), []);

  /**
   * O foco pedido para um campo que ainda não existe — até quando ele vale.
   *
   * O painel é `lazy()`: no primeiro `Ctrl+Shift+Y` da página o chunk ainda
   * está chegando quando o quadro seguinte roda, e o foco caía no vazio. O
   * pedido fica guardado e quem o cumpre é o campo, ao se registrar. Com prazo:
   * um pedido esquecido não pode roubar o foco de uma montagem qualquer, minutos
   * depois.
   */
  const focoPendenteRef = useRef(0);

  const focarCampo = useCallback(() => {
    // O campo pode acabar de montar junto com o painel: um quadro depois ele existe.
    requestAnimationFrame(() => {
      const campo = campoRef.current?.current;
      if (campo) {
        focoPendenteRef.current = 0;
        campo.focus();
      } else {
        focoPendenteRef.current = Date.now() + PRAZO_DO_FOCO;
      }
    });
  }, []);

  const registrarCampo = useCallback((ref: RefObject<HTMLTextAreaElement | null>) => {
    campoRef.current = ref;
    if (focoPendenteRef.current > Date.now()) {
      focoPendenteRef.current = 0;
      requestAnimationFrame(() => ref.current?.focus());
    }
    return () => {
      if (campoRef.current === ref) campoRef.current = null;
    };
  }, []);

  const parar = useCallback(() => abortarRef.current?.abort(), []);
  const temFluxo = useCallback(() => abortarRef.current !== null, []);
  const marcarDesfeito = useCallback((chave: string) => {
    setDesfeitos((atual) => new Set(atual).add(chave));
  }, []);

  const novaConversa = useCallback((agente: string | null = null) => {
    setConversaId(null);
    setAgenteId(agente);
    setAnexos([]);
    setTexto("");
    setErro(null);
  }, []);

  /// Só vale na conversa vazia: depois de criada, o agente é o dela.
  const escolherAgente = useCallback((agente: string | null) => {
    if (atual.current.conversaId) return;
    setAgenteId(agente);
    setErro(null);
  }, []);

  const selecionar = useCallback((id: string) => {
    setConversaId(id);
    setAgenteId(null);
    setErro(null);
  }, []);

  const anexar = useCallback((novo: Anexo) => {
    setAnexos((lista) =>
      lista.some((a) => alvoDe(a) === alvoDe(novo)) ? lista : [...lista, novo],
    );
  }, []);

  const desanexar = useCallback((alvo: string) => {
    setAnexos((lista) => lista.filter((a) => alvoDe(a) !== alvo));
  }, []);

  const abrirPainel = useCallback(
    (opcoes: { anexo?: Anexo; nova?: boolean } = {}) => {
      // O `<body>` não é origem: devolver o foco a ele é perdê-lo.
      if (
        !atual.current.painelAberto &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
      ) {
        origemRef.current = document.activeElement;
      }
      if (opcoes.nova) novaConversa();
      if (opcoes.anexo) anexar(opcoes.anexo);
      setPainelAberto(true);
      focarCampo();
    },
    [novaConversa, anexar, focarCampo],
  );

  /**
   * Fechar o painel no meio de uma resposta solta a conexão — o painel é a
   * superfície que a mostrava. A rota `/assistente` não passa por aqui: trocar
   * de superfície não é fechar.
   *
   * O foco volta a quem o tinha. Se não há a quem — o painel abriu sozinho ao
   * recarregar, ou a origem sumiu da tela —, vai para o botão do trilho que
   * o reabre: fechar desmonta o que tinha o foco, e ele cairia no `<body>`.
   */
  const fecharPainel = useCallback(() => {
    parar();
    setPainelAberto(false);
    const origem = origemRef.current;
    origemRef.current = null;
    focoPendenteRef.current = 0;
    requestAnimationFrame(() => {
      if (origem?.isConnected && origem !== document.body) origem.focus();
      // A origem pode não aceitar foco (sem `tabIndex`, desabilitada no meio do
      // caminho): conferido depois, e não presumido.
      if (!origem || document.activeElement !== origem) {
        document.getElementById(ID_BOTAO_PAINEL)?.focus();
      }
    });
  }, [parar]);

  const alternarPainel = useCallback(() => {
    if (atual.current.painelAberto) fecharPainel();
    else abrirPainel();
  }, [fecharPainel, abrirPainel]);

  const enviar = useCallback(async (visivel?: string) => {
    const {
      texto: rascunho,
      conversaId: escolhida,
      anexos: enviados,
      agenteId: agente,
    } = atual.current;
    const pergunta = (visivel ?? rascunho).trim();
    if (!pergunta || abortarRef.current) return;

    const controle = new AbortController();
    abortarRef.current = controle;
    setErro(null);
    setTexto("");
    setAnexos([]);
    setEmCurso(falaNova(escolhida, pergunta, enviados));

    let alvo = escolhida;
    /// Frente de cards, Parte 1: concluir não cria nada, então não passa pelo
    /// evento `criado` — que alimenta o Desfazer e não serve para isto. O
    /// pedido da ferramenta marca, e o fim do fluxo refaz o que mostra card.
    let concluiuCard = false;
    /// O mesmo para `complete_task` (frente de agenda, Fase 2): sem a marca,
    /// a lista de tarefas aberta mostraria a tarefa ainda por fazer.
    let concluiuTarefa = false;
    try {
      if (!alvo) {
        // A conversa nasce com o começo da primeira pergunta como título — o
        // usuário renomeia depois se quiser (RF-24).
        // Com agente, ele fica gravado na conversa desde aqui (Etapa D).
        const nova = await criar.mutateAsync({
          title: pergunta.slice(0, 60),
          ...(agente && { agentId: agente }),
        });
        alvo = nova.id;
        setConversaId(nova.id);
        setEmCurso((f) => (f ? { ...f, conversaId: nova.id } : f));
      }
      // Parado enquanto a conversa nascia: nada vai ao provedor.
      if (controle.signal.aborted) return;

      await enviarMensagem({
        conversationId: alvo,
        content: pergunta,
        attachments: enviados.map(({ titulo: _titulo, ...alvos }) => alvos),
        signal: controle.signal,
        aoEvento: (evento) => {
          setEmCurso((f) => (f ? aplicarEvento(f, evento) : f));

          /// Fora do updater de propósito: com o `StrictMode` ligado ele roda
          /// duas vezes, e um updater que produz efeito deixa de ser puro.
          if (evento.tipo === "teto" || evento.tipo === "erro") {
            setErro({ mensagem: evento.mensagem, code: null });
          }
          /// O acervo mudou agora, não no fim: o quadro aberto ao lado mostra o
          /// card assim que ele existe.
          if (evento.tipo === "criado") invalidarCriados(qc, evento.criados);
          if (evento.tipo === "ferramenta" && evento.nome === "complete_card") concluiuCard = true;
          if (evento.tipo === "ferramenta" && evento.nome === "complete_task") {
            concluiuTarefa = true;
          }
        },
      });
    } catch (e) {
      if (!controle.signal.aborted) {
        setErro(
          e instanceof ApiError
            ? { mensagem: e.message, code: e.code }
            : { mensagem: "Não foi possível falar com o assistente.", code: null },
        );
        // Recusada antes do fluxo — o agente saiu, o modelo dele saiu dos
        // favoritos: a pergunta volta ao campo, e ninguém redigita o que já
        // tinha escrito. Só se o campo continuar vazio, para não pisar no que
        // a pessoa começou a digitar enquanto isso.
        if (e instanceof ApiError) {
          setTexto((t) => t || pergunta);
          setAnexos((a) => (a.length > 0 ? a : enviados));
        }
      }
    } finally {
      abortarRef.current = null;
      setEmCurso(null);
      /// O histórico persistido vira a fonte da verdade assim que o fluxo
      /// acaba, e o gasto do dia mudou — `["ia","ajustes"]` tem `staleTime` de
      /// 30 s e ficaria mostrando o valor de antes.
      if (alvo) await qc.invalidateQueries({ queryKey: chaveDaConversa(alvo) });
      await qc.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      await qc.invalidateQueries({ queryKey: CHAVE_AJUSTES });
      await qc.invalidateQueries({ queryKey: CHAVE_USO });
      if (concluiuCard) invalidarConclusao(qc);
      if (concluiuTarefa) invalidarAgenda(qc);
    }
  }, [criar, qc]);

  const estado = useMemo<EstadoChat>(
    () => ({ conversaId, texto, anexos, emCurso, erro, desfeitos, agenteId }),
    [conversaId, texto, anexos, emCurso, erro, desfeitos, agenteId],
  );

  const acoes = useMemo<AcoesChat>(
    () => ({
      painelAberto,
      setTexto,
      limparErro: () => setErro(null),
      enviar,
      parar,
      novaConversa,
      escolherAgente,
      selecionar,
      anexar,
      desanexar,
      abrirPainel,
      fecharPainel,
      alternarPainel,
      temFluxo,
      marcarDesfeito,
      registrarCampo,
      focarCampo,
    }),
    [
      painelAberto,
      enviar,
      parar,
      novaConversa,
      escolherAgente,
      selecionar,
      anexar,
      desanexar,
      abrirPainel,
      fecharPainel,
      alternarPainel,
      temFluxo,
      marcarDesfeito,
      registrarCampo,
      focarCampo,
    ],
  );

  return (
    <ContextoAcoes.Provider value={acoes}>
      <ContextoEstado.Provider value={estado}>{children}</ContextoEstado.Provider>
    </ContextoAcoes.Provider>
  );
}

/** Só as ações e se o painel está aberto — para quem abre o chat sem desenhá-lo. */
export function useAcoesChat(): AcoesChat {
  const acoes = useContext(ContextoAcoes);
  if (!acoes) throw new Error("useAcoesChat fora do ProvedorSessaoChat");
  return acoes;
}

/** Estado e ações — para as superfícies que desenham a conversa. */
export function useSessaoChat(): EstadoChat & AcoesChat {
  const estado = useContext(ContextoEstado);
  const acoes = useAcoesChat();
  if (!estado) throw new Error("useSessaoChat fora do ProvedorSessaoChat");
  return { ...estado, ...acoes };
}
