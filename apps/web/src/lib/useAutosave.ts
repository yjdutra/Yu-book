import { useCallback, useEffect, useRef, useState } from "react";

export type EstadoSalvamento =
  | { tipo: "ocioso" }
  | { tipo: "editando" }
  | { tipo: "salvando" }
  | { tipo: "salvo"; em: Date }
  | { tipo: "erro"; mensagem: string; tentativas: number };

const DEBOUNCE_MS = 800; // RF-14
const RETENTATIVA_MS = 5000; // RF-17
const MAX_TENTATIVAS = 3; // RF-17

interface Opcoes<T> {
  valor: T;
  /** Quando muda, o autosave reinicia sem tentar salvar o valor anterior. */
  chave: string | null;
  salvar: (valor: T) => Promise<unknown>;
  iguais: (a: T, b: T) => boolean;
}

/**
 * Autosave com debounce, retentativa e salvamento imediato sob demanda.
 *
 * A digitação nunca espera a rede (RNF-13): o valor vive no estado do
 * componente e este hook só decide quando enviar.
 */
export function useAutosave<T>({ valor, chave, salvar, iguais }: Opcoes<T>) {
  const [estado, setEstado] = useState<EstadoSalvamento>({ tipo: "ocioso" });

  const salvoRef = useRef<T>(valor);
  const valorRef = useRef<T>(valor);
  const chaveRef = useRef(chave);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emVooRef = useRef(false);
  const tentativasRef = useRef(0);

  // `salvar` e `iguais` vêm do componente e mudam de identidade a cada render
  // (o objeto de mutação do TanStack Query é recriado sempre). Guardá-los em
  // refs é o que mantém `enviar` estável — com ele instável, o efeito de
  // debounce se reagenda a cada render e o autosave nunca dispara.
  const salvarRef = useRef(salvar);
  const iguaisRef = useRef(iguais);
  salvarRef.current = salvar;
  iguaisRef.current = iguais;

  valorRef.current = valor;

  // Trocar de nota: descarta o que estava agendado e adota o novo valor como
  // "já salvo" — senão o conteúdo da nota anterior vazaria para esta.
  useEffect(() => {
    if (chaveRef.current !== chave) {
      chaveRef.current = chave;
      if (timerRef.current) clearTimeout(timerRef.current);
      salvoRef.current = valor;
      tentativasRef.current = 0;
      setEstado({ tipo: "ocioso" });
    }
  }, [chave, valor]);

  const enviar = useCallback(async () => {
    if (emVooRef.current) return;

    const alvo = valorRef.current;
    if (iguaisRef.current(alvo, salvoRef.current)) return;

    emVooRef.current = true;
    setEstado({ tipo: "salvando" });

    try {
      await salvarRef.current(alvo);
      salvoRef.current = alvo;
      tentativasRef.current = 0;
      emVooRef.current = false;

      // Digitou durante o envio: agenda outra rodada em vez de marcar "salvo".
      if (!iguaisRef.current(valorRef.current, salvoRef.current)) {
        setEstado({ tipo: "editando" });
        timerRef.current = setTimeout(() => void enviar(), DEBOUNCE_MS);
      } else {
        setEstado({ tipo: "salvo", em: new Date() });
      }
    } catch (erro) {
      emVooRef.current = false;
      tentativasRef.current += 1;
      const mensagem = erro instanceof Error ? erro.message : "Falha ao salvar";
      setEstado({ tipo: "erro", mensagem, tentativas: tentativasRef.current });

      // RF-17: 3 tentativas a cada 5s. O texto digitado continua na tela.
      if (tentativasRef.current < MAX_TENTATIVAS) {
        timerRef.current = setTimeout(() => void enviar(), RETENTATIVA_MS);
      }
    }
  }, []);

  useEffect(() => {
    if (chaveRef.current !== chave) return;
    if (iguaisRef.current(valor, salvoRef.current)) return;

    // Preservar a identidade quando já está "editando" evita um render extra
    // que reagendaria este mesmo efeito.
    setEstado((atual) =>
      atual.tipo === "erro" || atual.tipo === "editando" ? atual : { tipo: "editando" },
    );

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void enviar(), DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [valor, chave, enviar]);

  /** RF-15: Ctrl+S não espera o debounce. */
  const salvarAgora = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    tentativasRef.current = 0;
    void enviar();
  }, [enviar]);

  const pendente = !iguaisRef.current(valor, salvoRef.current);

  // RF-18: fechar a aba com alteração pendente pede confirmação.
  useEffect(() => {
    if (!pendente) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendente]);

  return { estado, salvarAgora, pendente };
}
