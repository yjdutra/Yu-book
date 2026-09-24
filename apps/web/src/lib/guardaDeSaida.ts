import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

/**
 * Segura a saída de uma tela com alterações não salvas (Etapa D da IA, o editor
 * de agentes — o primeiro formulário do projeto com salvar explícito; nota e
 * card têm autosave e não precisam disto).
 *
 * O `useBlocker` do React Router só existe com o roteador de dados
 * (`createBrowserRouter`), e o projeto usa `BrowserRouter`. Trocar de roteador
 * para uma tela não se paga, então a guarda intercepta o `navigator` do
 * contexto — é por ele que passam `navigate()`, `<Link>` e `<Navigate>`, isto
 * é, o trilho, o painel contextual e a paleta. A navegação pedida fica
 * guardada até a pessoa confirmar ou desistir.
 *
 * Dois caminhos ficam de fora, e a guarda diz isso em vez de fingir:
 * - **fechar ou recarregar a aba** — coberto por `beforeunload`, com o aviso
 *   genérico do navegador;
 * - **o Voltar do navegador** — o `popstate` já aconteceu quando alguém fica
 *   sabendo, e desfazê-lo embaralha o histórico. Nesse caso o rascunho se perde.
 *
 * A interceptação vive na limpeza do efeito, então some com o componente e
 * com `ativa` virando `false`.
 */
export function useGuardaDeSaida(ativa: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [pendente, setPendente] = useState<(() => void) | null>(null);
  /// Liberar uma navegação — a do "sair mesmo assim", ou a que o próprio
  /// editor faz depois de salvar — sem passar pela guarda.
  const liberada = useRef(false);

  useEffect(() => {
    if (!ativa) return;
    const push = navigator.push;
    const replace = navigator.replace;

    navigator.push = (...args: Parameters<typeof push>) => {
      if (liberada.current) return push(...args);
      setPendente(() => () => push(...args));
    };
    navigator.replace = (...args: Parameters<typeof replace>) => {
      if (liberada.current) return replace(...args);
      setPendente(() => () => replace(...args));
    };

    function aoSair(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Navegadores antigos só mostram o aviso com `returnValue` preenchido.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", aoSair);

    return () => {
      navigator.push = push;
      navigator.replace = replace;
      window.removeEventListener("beforeunload", aoSair);
    };
  }, [ativa, navigator]);

  /** Segue para onde a pessoa queria ir, descartando o rascunho. */
  const confirmar = useCallback(() => {
    const seguir = pendente;
    setPendente(null);
    if (!seguir) return;
    liberada.current = true;
    seguir();
    liberada.current = false;
  }, [pendente]);

  const cancelar = useCallback(() => setPendente(null), []);

  /** Navega sem perguntar — depois de salvar, o rascunho já está no servidor. */
  const semGuarda = useCallback((navegar: () => void) => {
    liberada.current = true;
    navegar();
    liberada.current = false;
  }, []);

  return { pedindoConfirmacao: pendente !== null, confirmar, cancelar, semGuarda };
}
