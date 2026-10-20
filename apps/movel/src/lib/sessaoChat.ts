import { useQueryClient } from "@tanstack/react-query";
import { invalidarAgenda } from "@yu-book/cliente/agenda";
import { ApiError } from "@yu-book/cliente/api";
import {
  CHAVE_CONVERSAS,
  aplicarEvento,
  chaveDaConversa,
  enviarMensagem,
  falaNova,
  useCriarConversa,
} from "@yu-book/cliente/chat";
import type { EmCurso } from "@yu-book/cliente/chat";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * O envio do chat no móvel (Fase 5 da frente de agenda): o mesmo transporte e
 * o mesmo redutor do web (`@yu-book/cliente/chat`), numa sessão enxuta — sem
 * painel, sem anexos, uma superfície só. Mora na tela da conversa, e **sair
 * dela solta a conexão**: uma mensagem são até cinco chamadas ao provedor,
 * cada uma contra o teto do dia, e o laço não roda sem ninguém vendo (a regra
 * do INV-56 do web, aqui com uma superfície só).
 */

/** Um erro do envio. O `code` decide o que a tela diz junto; a mensagem é para ler. */
export interface ErroChat {
  mensagem: string;
  code: string | null;
}

export interface Envio {
  /** A conversa de destino; `null` cria uma no primeiro envio, como no web. */
  conversaId: string | null;
  pergunta: string;
  /** Só na criação: o agente é fixo por conversa (Etapa D). */
  agenteId: string | null;
  /** Só na criação: a conversa descartável do assistente rápido. */
  efemera?: boolean;
  /** A conversa nasceu — quem chama troca a rota para ela. */
  aoCriar: (id: string) => void;
  /** Recusada antes do fluxo: a pergunta volta ao campo. */
  aoRecusar: (pergunta: string) => void;
}

export function useEnvioChat() {
  const qc = useQueryClient();
  const criar = useCriarConversa();
  const [emCurso, setEmCurso] = useState<EmCurso | null>(null);
  const [erro, setErro] = useState<ErroChat | null>(null);
  /// Nasce antes de qualquer `await` e, enquanto existe, outro envio não
  /// começa — dois toques rápidos criariam duas conversas (a mesma regra da
  /// sessão do web).
  const abortarRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortarRef.current?.abort(), []);

  const parar = useCallback(() => abortarRef.current?.abort(), []);
  const limparErro = useCallback(() => setErro(null), []);

  const enviar = useCallback(
    async ({ conversaId, pergunta, agenteId, efemera, aoCriar, aoRecusar }: Envio) => {
      const texto = pergunta.trim();
      if (!texto || abortarRef.current) return;
      const controle = new AbortController();
      abortarRef.current = controle;
      setErro(null);
      setEmCurso(falaNova(conversaId, texto, []));

      let alvo = conversaId;
      /// `complete_task` e `complete_card` gravam sem criar: não passam pelo
      /// evento `criado`, e a agenda é refeita no fim, como no web.
      let concluiu = false;
      try {
        if (!alvo) {
          const nova = await criar.mutateAsync({
            title: texto.slice(0, 60),
            ...(agenteId && { agentId: agenteId }),
            ...(efemera && { ephemeral: true }),
          });
          alvo = nova.id;
          /// Saiu da tela enquanto a conversa nascia: nada vai ao provedor, e
          /// **a rota não troca**. A conferência vem antes do `aoCriar`, e não
          /// depois: ele navega com `replace`, e o `navigate` do react-router
          /// sem data router vale mesmo com a tela desmontada — puxaria de volta
          /// para a conversa quem já tinha saído dela. É o análogo, aqui, do
          /// INV-56 do web: nada depois do `await` age como se a tela ainda existisse.
          if (controle.signal.aborted) return;
          setEmCurso((f) => (f ? { ...f, conversaId: nova.id } : f));
          aoCriar(nova.id);
        }

        await enviarMensagem({
          conversationId: alvo,
          content: texto,
          attachments: [],
          signal: controle.signal,
          aoEvento: (evento) => {
            setEmCurso((f) => (f ? aplicarEvento(f, evento) : f));
            // Efeitos fora do updater, que o `StrictMode` roda duas vezes.
            if (evento.tipo === "teto") {
              setErro({ mensagem: evento.mensagem, code: "TETO_DIARIO_ATINGIDO" });
            }
            if (evento.tipo === "erro") setErro({ mensagem: evento.mensagem, code: evento.code });
            // O móvel não mostra notas; mostra a agenda — que traz também os
            // cards com prazo (`AgendaRange.cards`) — e os projetos, cuja
            // lista (`["boards", null]`) conta os cards de cada quadro.
            if (evento.tipo === "criado") {
              if (evento.criados.some((c) => c.kind !== "note")) invalidarAgenda(qc);
              if (evento.criados.some((c) => c.kind === "card")) {
                void qc.invalidateQueries({ queryKey: ["boards"] });
              }
            }
            if (
              evento.tipo === "ferramenta" &&
              (evento.nome === "complete_task" || evento.nome === "complete_card")
            ) {
              concluiu = true;
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
          if (e instanceof ApiError) aoRecusar(texto);
        }
      } finally {
        abortarRef.current = null;
        setEmCurso(null);
        if (alvo) void qc.invalidateQueries({ queryKey: chaveDaConversa(alvo) });
        void qc.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
        if (concluiu) invalidarAgenda(qc);
      }
    },
    [criar, qc],
  );

  return { emCurso, erro, limparErro, enviar, parar, respondendo: emCurso !== null };
}
