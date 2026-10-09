import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ditado por voz no compositor do chat (Fase 5 da frente de agenda).
 *
 * É a Web Speech API do navegador, sem dependência e sem rota nova: o Yu-book
 * não recebe áudio. **Quem recebe é o serviço de reconhecimento do
 * navegador** — no Chrome, o Google —, e o botão diz isso na dica. O Firefox
 * não tem a API; ali `suportado` é falso e o botão não existe.
 *
 * O texto ditado **nunca é enviado sozinho**: o final é anexado ao campo e o
 * usuário revê antes de mandar. Uma mensagem são até cinco chamadas pagas ao
 * provedor, e um reconhecimento errado não pode virar uma delas.
 *
 * `continuous: false` — uma fala por toque. O navegador encerra sozinho na
 * pausa, o que cabe no uso (ditar um pedido curto) e evita duas armadilhas do
 * modo contínuo: no Chrome do Android ele repete resultados já finais, e
 * esquecido aberto segue ouvindo. Quem quer mais toca de novo.
 */

/* O lib `dom` do TypeScript não declara a API (ela nunca saiu de rascunho no
   W3C). Só o mínimo que este arquivo usa. */
interface AlternativaFala {
  readonly transcript: string;
}
interface ResultadoFala {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [indice: number]: AlternativaFala | undefined;
}
interface EventoResultadoFala extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [indice: number]: ResultadoFala | undefined;
  };
}
interface EventoErroFala extends Event {
  readonly error: string;
}
interface Reconhecedor {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: EventoResultadoFala) => void) | null;
  onerror: ((e: EventoErroFala) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type ConstrutorReconhecedor = new () => Reconhecedor;

function construtor(): ConstrutorReconhecedor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorReconhecedor;
    webkitSpeechRecognition?: ConstrutorReconhecedor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** O código do erro (`SpeechRecognitionErrorEvent.error`) dito para gente. */
function mensagemDoErro(codigo: string): string | null {
  switch (codigo) {
    case "aborted":
      // Fomos nós (enviar, fechar, desmontar): não é erro de ninguém.
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return (
        "O microfone está bloqueado para o Yu-book. " +
        "Libere o acesso nas permissões do site e tente de novo."
      );
    case "no-speech":
      return "Não ouvi nada. Tente de novo, falando logo depois de tocar no microfone.";
    case "audio-capture":
      return "Nenhum microfone encontrado neste aparelho.";
    case "network":
      return "O ditado precisa de internet: quem reconhece a fala é o serviço do navegador.";
    case "language-not-supported":
      return "Este navegador não reconhece fala em português.";
    default:
      return "O ditado falhou. Tente de novo.";
  }
}

export interface Ditado {
  /** O navegador tem a API. Sem ela, quem desenha não mostra o botão. */
  suportado: boolean;
  ouvindo: boolean;
  /** O que está sendo reconhecido agora, ainda sem ser final — some ao virar final. */
  parcial: string;
  erro: string | null;
  iniciar: () => void;
  /** Para de ouvir e entrega o que já foi dito (o navegador fecha o resultado). */
  parar: () => void;
  /** Para e descarta o que estava em curso — enviar e desmontar usam este. */
  cancelar: () => void;
  limparErro: () => void;
}

export function useDitado({
  aoFinal,
  idioma = "pt-BR",
}: {
  /** O trecho final reconhecido — quem chama o anexa ao campo. */
  aoFinal: (texto: string) => void;
  idioma?: string;
}): Ditado {
  /// Lido uma vez: a API não aparece nem some com a página aberta.
  const [suportado] = useState(() => construtor() !== null);
  const [ouvindo, setOuvindo] = useState(false);
  const [parcial, setParcial] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const reconhecedor = useRef<Reconhecedor | null>(null);
  /// Em ref, como os callbacks do autosave: quem chama passa uma função nova a
  /// cada render, e o reconhecedor já criado precisa da mais recente.
  const aoFinalRef = useRef(aoFinal);
  aoFinalRef.current = aoFinal;

  /// Desmontar (fechar o painel, sair da tela) solta o microfone.
  useEffect(
    () => () => {
      const atual = reconhecedor.current;
      reconhecedor.current = null;
      atual?.abort();
    },
    [],
  );

  const iniciar = useCallback(() => {
    const Construtor = construtor();
    if (!Construtor || reconhecedor.current) return;
    const rec = new Construtor();
    rec.lang = idioma;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    /// Cada callback confere se ainda é o reconhecedor da vez: um cancelado
    /// pode entregar resultado ou `end` atrasado, depois de outro começar.
    rec.onresult = (e) => {
      if (reconhecedor.current !== rec) return;
      let final = "";
      let emCurso = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const resultado = e.results[i];
        const texto = resultado?.[0]?.transcript ?? "";
        if (resultado?.isFinal) final += texto;
        else emCurso += texto;
      }
      if (final.trim()) aoFinalRef.current(final.trim());
      setParcial(emCurso.trim());
    };
    rec.onerror = (e) => {
      if (reconhecedor.current !== rec) return;
      const mensagem = mensagemDoErro(e.error);
      if (mensagem) setErro(mensagem);
    };
    rec.onend = () => {
      if (reconhecedor.current !== null && reconhecedor.current !== rec) return;
      reconhecedor.current = null;
      setOuvindo(false);
      setParcial("");
    };

    reconhecedor.current = rec;
    setErro(null);
    setParcial("");
    try {
      rec.start();
      setOuvindo(true);
    } catch {
      reconhecedor.current = null;
      setErro("Não foi possível começar a ouvir. Tente de novo.");
    }
  }, [idioma]);

  const parar = useCallback(() => reconhecedor.current?.stop(), []);

  const cancelar = useCallback(() => {
    const atual = reconhecedor.current;
    reconhecedor.current = null;
    atual?.abort();
    setOuvindo(false);
    setParcial("");
  }, []);

  const limparErro = useCallback(() => setErro(null), []);

  return { suportado, ouvindo, parcial, erro, iniciar, parar, cancelar, limparErro };
}

/**
 * Anexa o trecho ditado ao que já está no campo, com um espaço entre os dois —
 * a fala não sabe onde o texto terminou.
 */
export function juntarDitado(campo: string, trecho: string): string {
  if (!trecho) return campo;
  if (!campo.trim()) return trecho;
  return /\s$/.test(campo) ? campo + trecho : `${campo} ${trecho}`;
}
