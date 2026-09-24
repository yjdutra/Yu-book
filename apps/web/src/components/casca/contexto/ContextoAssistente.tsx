import { useMatch, useNavigate } from "react-router-dom";
import { useAgentes } from "../../../lib/agentes";
import { useAcoesChat } from "../../../lib/sessaoChat";
import type { EstadoRotaChat } from "../../../lib/sessaoChat";
import { useAcoesDoAgente } from "../../agentes/acoesDoAgente";
import { AvatarAgente } from "../../agentes/AvatarAgente";
import { ListaConversas } from "../../assistente/ListaConversas";
import { Botao } from "../../base/Botao";
import { Menu } from "../../base/Menu";
import { IconeAgente, IconeMais, IconeOpcoes } from "../../Icones";
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
      <ListaConversas
        onEscolher={() => {
          if (!naTela) navigate("/assistente");
          focarCampo();
        }}
      />
    </>
  );
}
