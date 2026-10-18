import type { ComponentType } from "react";
import {
  IconeAssistente,
  IconeBoard,
  IconeBusca,
  IconeCalendario,
  IconeCheck,
  IconeGlobo,
  IconeInicio,
  IconeNotas,
  IconeTarefa,
} from "../Icones";
import type { IconeProps } from "../Icones";

/**
 * O rótulo humano de cada ação — a tela não diz `search_notes` a ninguém. Veio
 * de `Conversa.tsx` do web para o móvel dizer o mesmo. Ação de fora daqui cai
 * no nome cru, sem erro: ação nova do chat ganha entrada (contrato §4.6).
 */
export const ROTULO_DA_ACAO: Record<string, string> = {
  search_notes: "procurando nas suas notas",
  get_note: "lendo uma nota",
  list_boards: "vendo seus quadros",
  get_board: "abrindo um quadro",
  get_dashboard: "conferindo o que vence",
  // Etapa C: as duas escritas que o chat tem. O rótulo diz que algo está sendo
  // gravado — é a hora em que o usuário mais precisa saber o que acontece.
  create_card: "criando card",
  create_note: "criando nota",
  // Frente de cards, Parte 1: grava, mas não cria — o rótulo não diz "criando".
  complete_card: "concluindo card",
  // Frente de agenda, Fase 2. "Agendando" e não "criando evento": é a palavra
  // de quem marca um compromisso. Concluir tarefa, como concluir card, grava
  // sem criar.
  list_agenda: "consultando a agenda",
  create_event: "agendando",
  create_task: "criando tarefa",
  complete_task: "concluindo tarefa",
  // Frente Ritmo: registrar pontos grava sem criar item.
  list_habits: "vendo seus hábitos",
  log_habit: "registrando pontos",
  // Etapa G: a única que sai do Yu-book. A espera é a rede de um terceiro, e
  // pode chegar a segundos.
  open_page: "abrindo página",
};

/** O glifo de cada ação, ao lado do rótulo — nunca no lugar dele. Sem entrada, a faísca. */
const ICONE_DA_ACAO: Record<string, ComponentType<IconeProps>> = {
  search_notes: IconeBusca,
  get_note: IconeNotas,
  list_boards: IconeBoard,
  get_board: IconeBoard,
  get_dashboard: IconeInicio,
  create_card: IconeBoard,
  create_note: IconeNotas,
  complete_card: IconeCheck,
  list_agenda: IconeCalendario,
  create_event: IconeCalendario,
  create_task: IconeTarefa,
  complete_task: IconeCheck,
  list_habits: IconeTarefa,
  log_habit: IconeCheck,
  open_page: IconeGlobo,
};

function Pilula({ Icone, texto }: { Icone: ComponentType<IconeProps>; texto: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-ia-500/30
                 bg-linear-to-r from-accent-500/10 to-ia-500/10 py-1 pl-2 pr-2.5 text-xs
                 text-accent-400"
    >
      <Icone className="size-3.5" />
      {texto}
    </span>
  );
}

/** Três pontos que sobem em sequência. Parados para quem pede menos movimento (`tema.css`). */
function Reticencias() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {[0, 160, 320].map((atraso) => (
        <span
          key={atraso}
          style={{ animationDelay: `${atraso}ms` }}
          className="size-1.5 rounded-full bg-accent-400 opacity-60 animate-digitando"
        />
      ))}
    </span>
  );
}

/**
 * O passo da resposta em curso (RNF-07 da IA). Uma mensagem vira até cinco
 * chamadas ao provedor, e entre elas há segundos de silêncio enquanto o Yu-book
 * executa uma ferramenta — por isso cada passo é anunciado, e não só um
 * "gerando" genérico. Silêncio sem explicação é o que faz alguém clicar de novo.
 *
 * A região `status` fica montada a fala inteira, mesmo vazia: região viva que
 * aparece já preenchida costuma passar calada. O texto visível é a própria
 * região — o leitor de tela não repete.
 */
export function StatusDaResposta({
  ferramenta,
  buscando,
  temTexto,
}: {
  ferramenta: string | null;
  buscando: boolean;
  /** Já chegou texto: sem ferramenta em curso, o próprio texto é o sinal. */
  temTexto: boolean;
}) {
  let conteudo = null;
  if (ferramenta) {
    conteudo = (
      <Pilula
        Icone={ICONE_DA_ACAO[ferramenta] ?? IconeAssistente}
        texto={`${ROTULO_DA_ACAO[ferramenta] ?? ferramenta}…`}
      />
    );
  } else if (!temTexto && buscando) {
    // Etapa G: a primeira chamada com busca demora mais que as outras, e o
    // silêncio seria sem explicação.
    conteudo = <Pilula Icone={IconeGlobo} texto="buscando na web…" />;
  } else if (!temTexto) {
    conteudo = (
      <span className="inline-flex h-7 items-center gap-2 text-xs text-ink-400">
        <Reticencias />
        pensando…
      </span>
    );
  }
  return (
    <p role="status" className={conteudo && temTexto ? "mt-2" : ""}>
      {conteudo}
    </p>
  );
}
