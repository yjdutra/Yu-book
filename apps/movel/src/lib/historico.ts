import { useEffect, useRef } from "react";

/// A marca da entrada que a folha empurra, no `history.state`. O resto do
/// estado (o `idx` e a `key` do React Router) vai junto, intacto: o roteador lê
/// o `idx` no `popstate` para saber de quanto se andou.
const CHAVE = "ybFolha";

let proximoId = 0;
/// As entradas de folhas abertas agora, em qualquer instância do hook.
const vivas = new Set<number>();

function estadoAtual(): Record<string, unknown> {
  return (window.history.state as Record<string, unknown> | null) ?? {};
}

function idNoHistorico(): unknown {
  return estadoAtual()[CHAVE];
}

function empurrar(id: number) {
  window.history.pushState({ ...estadoAtual(), [CHAVE]: id }, "");
}

/**
 * O Voltar do Android fecha a folha, em vez de sair da tela atrás dela
 * (frente de agenda, Fase 4).
 *
 * Ao abrir, empurra uma entrada no histórico com a **mesma URL** e uma marca
 * própria; o Voltar a tira, e o `popstate` pede o fechamento. Fechar pela tela
 * (botão, `Esc`, véu, salvar) desfaz a entrada com `history.back()` — senão o
 * próximo Voltar do usuário gastaria um passo sem efeito visível. Como a URL é
 * a mesma, o roteador recebe o `popstate` e não troca de tela.
 *
 * `aoVoltar` devolve `false` quando a folha **ficou** aberta (alterações não
 * salvas: ela pergunta antes de descartar). O Voltar já tirou a entrada, então
 * ela é empurrada de novo — senão o próximo Voltar sairia da tela com a folha
 * aberta por cima.
 *
 * O `back()` da limpeza vai num microtask, e só acontece se a folha não
 * reabriu: o `StrictMode` desmonta e remonta o efeito na mesma passada, e um
 * `back()` síncrono ali, seguido do `pushState` da remontagem, voltaria
 * **depois** dele — o `popstate` fecharia a folha que acabou de abrir. E só se
 * a entrada da vez ainda for a do topo: se alguém empurrou outra por cima, o
 * `back()` desfaria a dela.
 *
 * O botão "Fechar" continua obrigatório: com TalkBack o véu fica fora da
 * árvore, e o Voltar não é o único jeito de sair (`Alca.tsx`).
 */
export function useFolhaNoHistorico(aberta: boolean, aoVoltar: () => boolean | void): void {
  const aoVoltarRef = useRef(aoVoltar);
  aoVoltarRef.current = aoVoltar;
  const entrada = useRef<number | null>(null);
  const viva = useRef(false);

  // Recarregar com a folha aberta deixa a marca no topo, sem folha nenhuma
  // para tirá-la: limpa-se no lugar, sem navegar. Só a marca que nenhuma folha
  // aberta reclama — a de outra instância continua dela.
  useEffect(() => {
    const id = idNoHistorico();
    if (id === undefined || (typeof id === "number" && vivas.has(id))) return;
    const { [CHAVE]: _orfa, ...resto } = estadoAtual();
    window.history.replaceState(resto, "");
  }, []);

  useEffect(() => {
    if (!aberta) return;
    viva.current = true;
    // Remontagem do `StrictMode`: a entrada da montagem anterior ainda está no
    // topo e continua servindo.
    if (entrada.current === null || idNoHistorico() !== entrada.current) {
      const id = ++proximoId;
      empurrar(id);
      entrada.current = id;
    }
    const minha = entrada.current;
    vivas.add(minha);

    function aoVoltarNoHistorico() {
      if (idNoHistorico() === minha) return;
      if (aoVoltarRef.current() === false) {
        empurrar(minha);
        return;
      }
      entrada.current = null;
    }
    window.addEventListener("popstate", aoVoltarNoHistorico);

    return () => {
      window.removeEventListener("popstate", aoVoltarNoHistorico);
      viva.current = false;
      queueMicrotask(() => {
        if (viva.current) return;
        vivas.delete(minha);
        if (entrada.current !== null && idNoHistorico() === entrada.current) {
          window.history.back();
        }
        entrada.current = null;
      });
    };
  }, [aberta]);
}
