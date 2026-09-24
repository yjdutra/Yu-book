import { useQueryClient } from "@tanstack/react-query";
import type { ChatAttachmentInput, ChatSource } from "@yu-book/shared";
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
import { ApiError } from "./api";
import {
  CHAVE_AJUSTES,
  CHAVE_CONVERSAS,
  chaveDaConversa,
  enviarMensagem,
  useCriarConversa,
} from "./chat";

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
 * Importa só `chat.ts`, que é leve: o renderizador de Markdown fica nas
 * superfícies, que carregam sob demanda.
 */

export interface Anexo extends ChatAttachmentInput {
  titulo: string;
}

/// O alvo de um anexo, que é sempre um dos três. Serve de chave de lista e de
/// identidade para tirar um do contexto — **o título não serve**: dois cards em
/// colunas diferentes podem se chamar igual, e remover pelo título levaria o
/// homônimo junto.
export const alvoDe = (a: ChatAttachmentInput & { titulo?: string }) =>
  a.noteId ?? a.cardId ?? a.boardId ?? a.titulo ?? "";

/** Uma fala ainda não persistida, enquanto o fluxo corre. */
export interface EmCurso {
  /** A conversa a que a fala pertence — `null` enquanto ela está sendo criada. */
  conversaId: string | null;
  pergunta: string;
  anexos: Anexo[];
  texto: string;
  ferramenta: string | null;
  fontes: ChatSource[];
  cortados: string[];
}

const CHAVE_ABERTO = "yb:chat-aberto";

/** O botão do trilho que alterna o painel — recebe o foco quando não há origem. */
export const ID_BOTAO_PAINEL = "yb-botao-painel-assistente";

interface EstadoChat {
  conversaId: string | null;
  texto: string;
  anexos: Anexo[];
  emCurso: EmCurso | null;
  erro: string | null;
}

interface AcoesChat {
  painelAberto: boolean;
  setTexto: (t: string) => void;
  limparErro: () => void;
  enviar: () => Promise<void>;
  parar: () => void;
  novaConversa: () => void;
  selecionar: (id: string) => void;
  anexar: (a: Anexo) => void;
  desanexar: (alvo: string) => void;
  abrirPainel: (opcoes?: { anexo?: Anexo; nova?: boolean }) => void;
  fecharPainel: () => void;
  alternarPainel: () => void;
  /** Há resposta sendo gerada agora — lido na hora, sem assinar o estado. */
  temFluxo: () => boolean;
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
  const [erro, setErro] = useState<string | null>(null);

  /// As ações leem o estado por aqui, para continuarem as mesmas entre renders.
  const atual = useRef({ painelAberto, conversaId, texto, anexos });
  atual.current = { painelAberto, conversaId, texto, anexos };

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

  const focarCampo = useCallback(() => {
    // O campo pode acabar de montar junto com o painel: um quadro depois ele existe.
    requestAnimationFrame(() => campoRef.current?.current?.focus());
  }, []);

  const registrarCampo = useCallback((ref: RefObject<HTMLTextAreaElement | null>) => {
    campoRef.current = ref;
    return () => {
      if (campoRef.current === ref) campoRef.current = null;
    };
  }, []);

  const parar = useCallback(() => abortarRef.current?.abort(), []);
  const temFluxo = useCallback(() => abortarRef.current !== null, []);

  const novaConversa = useCallback(() => {
    setConversaId(null);
    setAnexos([]);
    setTexto("");
    setErro(null);
  }, []);

  const selecionar = useCallback((id: string) => {
    setConversaId(id);
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
      if (!atual.current.painelAberto && document.activeElement instanceof HTMLElement) {
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
    requestAnimationFrame(() => {
      if (origem?.isConnected) origem.focus();
      else document.getElementById(ID_BOTAO_PAINEL)?.focus();
    });
  }, [parar]);

  const alternarPainel = useCallback(() => {
    if (atual.current.painelAberto) fecharPainel();
    else abrirPainel();
  }, [fecharPainel, abrirPainel]);

  const enviar = useCallback(async () => {
    const { texto: rascunho, conversaId: escolhida, anexos: enviados } = atual.current;
    const pergunta = rascunho.trim();
    if (!pergunta || abortarRef.current) return;

    const controle = new AbortController();
    abortarRef.current = controle;
    setErro(null);
    setTexto("");
    setAnexos([]);
    setEmCurso({
      conversaId: escolhida,
      pergunta,
      anexos: enviados,
      texto: "",
      ferramenta: null,
      fontes: [],
      cortados: [],
    });

    let alvo = escolhida;
    try {
      if (!alvo) {
        // A conversa nasce com o começo da primeira pergunta como título — o
        // usuário renomeia depois se quiser (RF-24).
        const nova = await criar.mutateAsync(pergunta.slice(0, 60));
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
          setEmCurso((f) => {
            if (!f) return f;
            switch (evento.tipo) {
              case "inicio":
                return { ...f, cortados: evento.cortados };
              case "delta":
                return { ...f, texto: f.texto + evento.texto, ferramenta: null };
              case "ferramenta":
                return { ...f, ferramenta: evento.nome };
              case "fontes": {
                /// Sem repetir: buscar e depois ler a mesma nota é o caminho
                /// normal do laço, e cada evento traz a lista **daquela**
                /// ferramenta, não o acumulado. Concatenar mostraria a nota
                /// duas vezes e repetiria a chave React em `Fontes`.
                const novas = evento.fontes.filter(
                  (x) => !f.fontes.some((j) => j.kind === x.kind && j.id === x.id),
                );
                return novas.length ? { ...f, fontes: [...f.fontes, ...novas] } : f;
              }
              default:
                return f;
            }
          });

          /// Fora do updater de propósito: com o `StrictMode` ligado ele roda
          /// duas vezes, e um updater que produz efeito deixa de ser puro.
          if (evento.tipo === "teto" || evento.tipo === "erro") setErro(evento.mensagem);
        },
      });
    } catch (e) {
      if (!controle.signal.aborted) {
        setErro(e instanceof ApiError ? e.message : "Não foi possível falar com o assistente.");
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
    }
  }, [criar, qc]);

  const estado = useMemo<EstadoChat>(
    () => ({ conversaId, texto, anexos, emCurso, erro }),
    [conversaId, texto, anexos, emCurso, erro],
  );

  const acoes = useMemo<AcoesChat>(
    () => ({
      painelAberto,
      setTexto,
      limparErro: () => setErro(null),
      enviar,
      parar,
      novaConversa,
      selecionar,
      anexar,
      desanexar,
      abrirPainel,
      fecharPainel,
      alternarPainel,
      temFluxo,
      registrarCampo,
      focarCampo,
    }),
    [
      painelAberto,
      enviar,
      parar,
      novaConversa,
      selecionar,
      anexar,
      desanexar,
      abrirPainel,
      fecharPainel,
      alternarPainel,
      temFluxo,
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
