import { useMatch, useNavigate } from "react-router-dom";
import type { RoutineSummary } from "@yu-book/shared";
import { useAgentes } from "../../../lib/agentes";
import { useAiAjustes } from "../../../lib/ia";
import { execucaoEmAndamento, useRotinas } from "../../../lib/rotinas";
import { useAcoesChat } from "../../../lib/sessaoChat";
import type { EstadoRotaChat } from "../../../lib/sessaoChat";
import { useAcoesDoAgente } from "../../agentes/acoesDoAgente";
import { AvatarAgente } from "../../agentes/AvatarAgente";
import { ListaConversas } from "../../assistente/ListaConversas";
import { Botao } from "../../base/Botao";
import { Menu } from "../../base/Menu";
import {
  IconeAgente,
  IconeAlerta,
  IconeMais,
  IconeOpcoes,
  IconeRelogio,
  IconeRotina,
} from "../../Icones";
import { horarioNoFuso, pedeAtencao } from "../../rotinas/comum";
import { Secao } from "../partes";

/** O botão que fica quando um agente sai da lista — recebe o foco (RNF-06 F1). */
const ID_NOVO_AGENTE = "yb-contexto-novo-agente";

/** Quantos agentes o painel mostra antes do "Ver todos". */
const VISIVEIS = 6;

/**
 * Os agentes no painel contextual (Etapa D da IA): um clique começa uma
 * conversa com ele. Acima das conversas, porque escolher com quem falar vem
 * antes de escolher sobre o quê.
 */
function SecaoAgentes() {
  const navigate = useNavigate();
  const { data: agentes, isLoading } = useAgentes();
  const editando = useMatch("/assistente/agentes/:id")?.params.id;
  const acoes = useAcoesDoAgente({ vizinho: () => document.getElementById(ID_NOVO_AGENTE) });
  const lista = agentes ?? [];

  return (
    <Secao
      titulo="Agentes"
      chave="agentes"
      contagem={agentes ? lista.length : undefined}
      // Fechada, a seção ainda diz que existe com quem conversar.
      resumo={
        lista.length > 0 ? (
          <span className="ml-1 flex -space-x-1" aria-hidden="true">
            {lista.slice(0, 3).map((a) => (
              <AvatarAgente key={a.id} nome={a.name} cor={a.color} tamanho="p" />
            ))}
          </span>
        ) : undefined
      }
    >
      {isLoading && (
        <div aria-hidden="true" className="space-y-0.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-controle bg-ink-800/60" />
          ))}
        </div>
      )}

      {agentes && lista.length === 0 && (
        <p className="px-2.5 py-1 text-xs text-ink-400/80">
          Um agente é o assistente com premissas próprias — um guia, exemplos, o que já saiu.
        </p>
      )}

      {lista.slice(0, VISIVEIS).map((a) => (
        <div key={a.id} className="group relative flex items-center">
          {editando === a.id && (
            <span
              aria-hidden="true"
              className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-400"
            />
          )}
          <button
            type="button"
            onClick={() => acoes.conversar(a)}
            aria-current={editando === a.id ? "true" : undefined}
            title={a.description || `Conversar com ${a.name}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-controle px-2.5 py-1.5
                       text-left text-sm text-ink-400 transition-colors hover:bg-ink-800/60
                       hover:text-ink-200"
          >
            <AvatarAgente nome={a.name} cor={a.color} tamanho="p" />
            <span className="truncate">{a.name}</span>
            <span className="sr-only">— conversar</span>
          </button>
          {/* As ações aparecem no hover **e no foco**, como as das conversas:
              só no hover, o teclado não chega nelas. */}
          <div
            className="absolute right-1 opacity-0 transition-opacity group-hover:opacity-100
                       group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
          >
            <Menu
              rotulo={`Ações de ${a.name}`}
              lado="baixo-fim"
              gatilho={(p) => (
                <button
                  {...p}
                  type="button"
                  aria-label={`Ações de ${a.name}`}
                  title="Ações"
                  className="rounded-etiqueta bg-ink-800 p-1 text-ink-400 hover:text-ink-200"
                >
                  <IconeOpcoes className="size-3" />
                </button>
              )}
              itens={acoes.itens(a)}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-1 pt-1">
        <Botao
          id={ID_NOVO_AGENTE}
          variante="fantasma"
          icone={<IconeMais className="size-3.5" />}
          onClick={() => navigate("/assistente/agentes/novo")}
        >
          Novo agente
        </Botao>
        {lista.length > 0 && (
          <Botao
            variante="fantasma"
            className="ml-auto"
            icone={<IconeAgente className="size-3.5" />}
            onClick={() => navigate("/assistente/agentes")}
          >
            {lista.length > VISIVEIS ? `Ver todos (${lista.length})` : "Ver todos"}
          </Botao>
        )}
      </div>
      {acoes.elementos}
    </Secao>
  );
}

/**
 * O ponto de "rodando": forma que pulsa **e** o texto ao lado ou no nome
 * acessível — nunca só a cor (RNF-09). O pulso para com
 * `prefers-reduced-motion`.
 */
function PontoRodando() {
  return (
    <span aria-hidden="true" className="relative inline-flex size-2 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-accent-400 opacity-60" />
      <span className="relative size-2 rounded-full bg-accent-400" />
    </span>
  );
}

/**
 * As rotinas no painel contextual (Etapa E da IA), entre Agentes e Conversas:
 * uma rotina é agentes encadeados. A que está rodando ganha o ponto, e o clique
 * nela leva à execução ao vivo, não ao editor — a execução segue no servidor
 * com a aba fechada, e este ponto é como se sabe disso sem abrir nada.
 *
 * Etapa F: o relógio marca a rotina agendada, e o alerta — ícone **e**
 * palavra — a que falhou ou foi pulada na última vez.
 *
 * Só `import type` de `shared` passa por aqui: `lib/rotinas.ts` é leve de
 * propósito, e o modelo pronto e os schemas ficam no chunk da área. A próxima
 * execução vem pronta do servidor (`nextRuns`), não de `proximosHorarios`,
 * que moraria em `agenda.ts` — e o schema dela viria junto para o bundle
 * inicial.
 */
function SecaoRotinas() {
  const navigate = useNavigate();
  const { data: rotinas, isLoading } = useRotinas();
  const aberta = useMatch("/assistente/rotinas/:id/*")?.params.id;
  const lista = rotinas ?? [];
  const viva = execucaoEmAndamento(rotinas);
  const fuso = useAiAjustes().data?.timezone ?? null;
  const comAlerta = lista.filter((r) => pedeAtencao(r.lastRun?.status) !== null).length;

  return (
    <Secao
      titulo="Rotinas"
      chave="rotinas"
      contagem={rotinas ? lista.length : undefined}
      // Fechada, a seção continua dizendo que há uma rodando.
      resumo={
        viva ? (
          <span className="ml-1.5 inline-flex items-center gap-1 normal-case tracking-normal">
            <PontoRodando />
            <span className="text-accent-400">rodando</span>
          </span>
        ) : comAlerta > 0 ? (
          // Fechada, a seção continua dizendo que alguma deu errado.
          <span
            className="ml-1.5 inline-flex items-center gap-1 normal-case tracking-normal
                       text-amber-300"
          >
            <IconeAlerta className="size-3" />
            {comAlerta === 1 ? "1 pede atenção" : `${comAlerta} pedem atenção`}
          </span>
        ) : undefined
      }
    >
      {isLoading && (
        <div aria-hidden="true" className="h-8 animate-pulse rounded-controle bg-ink-800/60" />
      )}

      {rotinas && lista.length === 0 && (
        <p className="px-2.5 py-1 text-xs text-ink-400/80">
          Uma rotina encadeia agentes: pega uma ideia, escreve, revisa e deixa um card pronto.
        </p>
      )}

      {lista.slice(0, VISIVEIS).map((r) => {
        const rodando = r.lastRun?.status === "em_andamento";
        const atencao = pedeAtencao(r.lastRun?.status);
        const agendada = r.schedule.active;
        const proxima = r.nextRuns[0];
        const dica = [
          r.description || r.name,
          agendada
            ? proxima && fuso
              ? `Agendada · próxima ${horarioNoFuso(proxima, fuso, "curto")}`
              : "Agendada"
            : null,
          atencao ? `Última execução: ${atencao}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        return (
          <div key={r.id} className="relative flex items-center">
            {aberta === r.id && (
              <span
                aria-hidden="true"
                className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-400"
              />
            )}
            <button
              type="button"
              onClick={() =>
                navigate(
                  rodando && r.lastRun
                    ? `/assistente/rotinas/${r.id}/execucoes/${r.lastRun.id}`
                    : `/assistente/rotinas/${r.id}`,
                )
              }
              aria-current={aberta === r.id ? "true" : undefined}
              title={dica}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-controle px-2.5 py-1.5
                         text-left text-sm text-ink-400 transition-colors hover:bg-ink-800/60
                         hover:text-ink-200"
            >
              <IconeRotina className="size-4 shrink-0" />
              <span className="truncate">{r.name}</span>
              {agendada && (
                <span className="shrink-0 text-ink-400">
                  <IconeRelogio className="size-3" />
                  <span className="sr-only">— agendada</span>
                </span>
              )}
              {rodando && (
                <span className="ml-auto flex items-center gap-1.5 text-miudo text-accent-400">
                  <PontoRodando />
                  rodando
                </span>
              )}
              {atencao && !rodando && (
                <span
                  className={`ml-auto flex shrink-0 items-center gap-1 text-miudo ${
                    atencao === "falhou" ? "text-red-300" : "text-amber-300"
                  }`}
                >
                  <IconeAlerta className="size-3" />
                  <span className="sr-only">— última execução</span>
                  {atencao}
                </span>
              )}
              {!r.valid && !rodando && !atencao && (
                <span className="ml-auto text-miudo text-amber-300" title="Precisa de ajustes">
                  <span aria-hidden="true">!</span>
                  <span className="sr-only">— precisa de ajustes</span>
                </span>
              )}
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-1 pt-1">
        <Botao
          variante="fantasma"
          icone={<IconeMais className="size-3.5" />}
          onClick={() => navigate("/assistente/rotinas/novo")}
        >
          Nova rotina
        </Botao>
        {lista.length > 0 && (
          <Botao
            variante="fantasma"
            className="ml-auto"
            icone={<IconeRotina className="size-3.5" />}
            onClick={() => navigate("/assistente/rotinas")}
          >
            {lista.length > VISIVEIS ? `Ver todas (${lista.length})` : "Ver todas"}
          </Botao>
        )}
      </div>
    </Secao>
  );
}

/** Área Assistente: começar uma conversa, com um agente ou não, ou voltar a uma. */
export function ContextoAssistente() {
  const { novaConversa, focarCampo } = useAcoesChat();
  const navigate = useNavigate();
  const naTela = useMatch("/assistente");

  return (
    <>
      <Botao
        variante="ia"
        tamanho="m"
        icone={<IconeMais />}
        className="w-full"
        onClick={() => {
          if (naTela) {
            novaConversa();
            focarCampo();
            return;
          }
          // Da galeria ou do editor de agentes, a conversa nova é na tela do
          // chat, e troca lá, ao chegar: a guarda do editor pode segurar a
          // navegação, e uma resposta chegando no painel não pode sumir
          // (INV-56) — `AssistentePage` confere as duas coisas.
          const estado: EstadoRotaChat = { conversaNova: { agente: null } };
          navigate("/assistente", { state: estado });
        }}
      >
        Nova conversa
      </Botao>
      <SecaoAgentes />
      <SecaoRotinas />
      <ListaConversas
        onEscolher={() => {
          if (!naTela) navigate("/assistente");
          focarCampo();
        }}
      />
    </>
  );
}
