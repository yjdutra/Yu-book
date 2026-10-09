import { useLayoutEffect, useRef } from "react";

/**
 * O item de lista que some com o foco dentro — excluído, ou a tarefa concluída
 * que o refetch tira das abertas — levaria o foco ao `<body>` (WCAG 2.4.3).
 * Na limpeza do layout, o `<li>` ainda está no documento: guarda-se a lista e
 * a posição, e depois do commit o foco vai ao primeiro botão do item que
 * ocupou o lugar (ou do último). Sem lista, ou sem botão nela, ao título da
 * seção mais próxima que sobreviveu: quem hospeda itens marca a seção com
 * `data-foco-retorno="<id do título>"`, e o título tem `tabIndex={-1}`.
 *
 * Subiu do móvel (`ItemAgenda`) na Fase 6 da frente de agenda, para o bloco
 * "Hoje" do web, onde a atrasada concluída sai da lista do mesmo jeito. Em
 * módulo à parte: no web só tela `lazy` o usa, e um módulo do pacote que o
 * chunk inicial importa levaria esta exportação junto (contrato §6).
 */
export function useFocoQueSobrevive() {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const li = ref.current;
    return () => {
      if (!li || !li.contains(document.activeElement)) return;
      const lista = li.parentElement;
      const posicao = lista ? [...lista.children].indexOf(li) : -1;
      const retornos: HTMLElement[] = [];
      for (let el = li.parentElement; el; el = el.parentElement) {
        if (el.dataset.focoRetorno) retornos.push(el);
      }
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        if (lista?.isConnected && lista.children.length > 0) {
          const vizinho = lista.children[Math.min(posicao, lista.children.length - 1)];
          const alvo = vizinho?.querySelector<HTMLElement>("button");
          if (alvo) return alvo.focus();
        }
        const secao = retornos.find((el) => el.isConnected);
        const titulo = secao?.dataset.focoRetorno
          ? document.getElementById(secao.dataset.focoRetorno)
          : null;
        (titulo ?? secao)?.focus();
      });
    };
  }, []);
  return ref;
}
