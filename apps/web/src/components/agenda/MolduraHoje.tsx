import { PERGUNTA_DO_DIA } from "@yu-book/cliente/agenda";
import { Bloco, Esqueleto } from "@yu-book/cliente/base/Bloco";
import { Botao } from "@yu-book/cliente/base/Botao";
import { IconeAssistente } from "@yu-book/cliente/icones";
import type { ReactNode } from "react";
import { useAcoesChat } from "../../lib/sessaoChat";
import { useWorkspaceAtivo } from "../../lib/workspace";

/*
 * A moldura do bloco "Hoje" do Início — título, rodapé e o esqueleto —, fora de
 * `BlocoHoje.tsx` para o fallback do `lazy` (`DashboardPage.tsx`) e o
 * carregamento da consulta desenharem a mesma coisa: um esqueleto só, da
 * altura do bloco pronto, rodapé incluído (RNF-11). Nada aqui traz valor de
 * `shared`: este módulo vai ao chunk inicial com o Início.
 */

/**
 * O rodapé: o desktop só lê, e diz onde se escreve. O botão leva a pergunta ao
 * assistente e **não envia** — como o "Pergunte ao seu acervo" e a paleta:
 * cada mensagem são chamadas pagas, e quem clicou ainda não viu o modelo nem o
 * teto (design system §5).
 */
function Rodape() {
  const { setTexto, abrirPainel } = useAcoesChat();
  // `flex-wrap` com piso no texto: estreito (o painel do assistente aberto),
  // o botão desce para a linha de baixo em vez de espremer a frase.
  return (
    <footer
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-800 px-4
                 py-2"
    >
      <p className="min-w-48 flex-1 text-miudo text-ink-400">
        Aqui só se lê. Crie e edite pelo celular ou pedindo ao assistente.
      </p>
      <Botao
        variante="fantasma"
        icone={<IconeAssistente className="size-3.5" />}
        className="ml-auto"
        onClick={() => {
          // Conversa nova: a pergunta do dia não continua a última conversa.
          abrirPainel({ nova: true });
          setTexto(PERGUNTA_DO_DIA);
        }}
      >
        {PERGUNTA_DO_DIA}
      </Botao>
    </footer>
  );
}

/**
 * Com um workspace ativo, o resto do Início é recortado por ele, e a agenda
 * não: evento e tarefa não pertencem a workspace. O cabeçalho diz isso, para
 * a lista não parecer filtrada.
 */
export function MolduraHoje({ children }: { children: ReactNode }) {
  const { ativo } = useWorkspaceAtivo();
  return (
    <Bloco
      titulo="Hoje"
      acao={
        ativo ? <span className="text-miudo text-ink-400">de todos os workspaces</span> : undefined
      }
    >
      {children}
      <Rodape />
    </Bloco>
  );
}

/** O corpo do bloco enquanto a agenda não chega — ou enquanto o próprio bloco não chega. */
export function EsqueletoHoje() {
  return <Esqueleto linhas={4} />;
}
