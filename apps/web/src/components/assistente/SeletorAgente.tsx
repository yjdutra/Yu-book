import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentes } from "../../lib/agentes";
import { useSessaoChat } from "../../lib/sessaoChat";
import { AvatarAgente } from "../agentes/AvatarAgente";
import { Menu } from "../base/Menu";
import { IconeAgente, IconeAssistente, IconeChevron } from "../Icones";

/**
 * "Conversar com: Assistente ▾" (Etapa D da IA) — só na conversa vazia.
 *
 * O agente é fixo por conversa: escolhido aqui, ele vai junto na criação, e
 * depois o seletor some e vira a identidade no cabeçalho. Por isso ele não
 * aparece com a conversa começada — oferecer a troca prometeria algo que o
 * servidor não faz.
 */
export function SeletorAgente() {
  const navigate = useNavigate();
  const { agenteId, escolherAgente, focarCampo } = useSessaoChat();
  const { data: agentes } = useAgentes();
  const escolhido = agentes?.find((a) => a.id === agenteId) ?? null;
  const idRotulo = useId();

  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-ink-400">
      <span id={idRotulo}>Conversar com</span>
      <Menu
        rotulo="Com quem conversar"
        lado="cima"
        gatilho={(p) => (
          <button
            {...p}
            type="button"
            aria-describedby={idRotulo}
            className="inline-flex h-7 items-center gap-1.5 rounded-controle border border-ink-700
                       bg-superficie pl-1 pr-1.5 text-xs font-medium text-ink-200 shadow-e1
                       transition hover:border-ink-400 hover:text-titulo"
          >
            {escolhido ? (
              <AvatarAgente nome={escolhido.name} cor={escolhido.color} tamanho="p" />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-5 items-center justify-center rounded-etiqueta
                           bg-linear-to-br from-accent-500 to-ia-500 text-white"
              >
                <IconeAssistente className="size-3" />
              </span>
            )}
            <span className="max-w-[18ch] truncate">{escolhido?.name ?? "Assistente"}</span>
            <IconeChevron className="size-3 text-ink-400" />
          </button>
        )}
        itens={[
          {
            rotulo: "Assistente",
            icone: <IconeAssistente className="size-3.5" />,
            aoEscolher: () => {
              escolherAgente(null);
              focarCampo();
            },
          },
          ...(agentes ?? []).map((a) => ({
            rotulo: a.name,
            icone: <AvatarAgente nome={a.name} cor={a.color} tamanho="p" />,
            aoEscolher: () => {
              escolherAgente(a.id);
              focarCampo();
            },
          })),
          {
            rotulo: agentes?.length ? "Gerenciar agentes…" : "Criar um agente…",
            icone: <IconeAgente className="size-3.5" />,
            aoEscolher: () => navigate("/assistente/agentes"),
          },
        ]}
      />
    </div>
  );
}
