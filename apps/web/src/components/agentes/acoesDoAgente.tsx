import type { AgentColor } from "@yu-book/shared";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { baixarAgente, useExcluirAgente } from "../../lib/agentes";
import { ApiError } from "../../lib/api";
import { avisoDeEspera, naTelaDoChat, useAcoesChat } from "../../lib/sessaoChat";
import type { EstadoRotaChat } from "../../lib/sessaoChat";
import { Aviso } from "../base/Aviso";
import { Botao } from "../base/Botao";
import { Dialogo } from "../base/Dialogo";
import type { ItemMenu } from "../base/Menu";
import { IconeAssistente, IconeBaixar, IconeCopiar, IconeLapis, IconeLixeira } from "../Icones";
import { AvatarAgente } from "./AvatarAgente";

interface AgenteAlvo {
  id: string;
  name: string;
  color: AgentColor;
}

/**
 * Confirmar a exclusão. Diz o que fica — as conversas, legíveis e sem aceitar
 * mensagem nova, e as notas-base, intocadas —, porque "excluir o agente" soa
 * como apagar tudo o que ele tocou.
 *
 * Montado dentro de `&&` (INV-53): a devolução do foco mora na limpeza do
 * `Dialogo`, e quem desaparece da tela é tratado por `onExcluido`.
 */
function DialogoExcluirAgente({
  agente,
  onFechar,
  onExcluido,
}: {
  agente: AgenteAlvo;
  onFechar: () => void;
  onExcluido: () => void;
}) {
  const excluir = useExcluirAgente();
  const [erro, setErro] = useState<string | null>(null);

  return (
    // O foco começa no "Cancelar", o primeiro botão: excluir é o que se confirma,
    // não o que um Enter distraído faz.
    <Dialogo aberto onFechar={onFechar} rotulo={`Excluir o agente ${agente.name}`}>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <AvatarAgente nome={agente.name} cor={agente.color} tamanho="g" />
          <h2 className="text-sm font-semibold text-titulo">Excluir «{agente.name}»?</h2>
        </div>
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-ink-400">
          <li>
            As conversas com ele continuam legíveis, com o nome guardado, mas não aceitam
            mensagens novas.
          </li>
          <li>As notas-base não são apagadas — elas são suas, não do agente.</li>
          <li>O que ele criou continua marcado com o nome dele.</li>
        </ul>
        {erro && (
          <Aviso tom="erro" onFechar={() => setErro(null)} className="mt-3">
            {erro}
          </Aviso>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Botao variante="fantasma" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            carregando={excluir.isPending}
            icone={<IconeLixeira className="size-3.5" />}
            onClick={() =>
              excluir.mutate(agente.id, {
                onSuccess: onExcluido,
                onError: (e) =>
                  setErro(e instanceof ApiError ? e.message : "Não foi possível excluir."),
              })
            }
          >
            Excluir
          </Botao>
        </div>
      </div>
    </Dialogo>
  );
}

/**
 * As ações de um agente — conversar, editar, duplicar, exportar e excluir —,
 * iguais no painel contextual, na galeria e no editor.
 *
 * `vizinho` é quem recebe o foco quando o diálogo de exclusão fecha e ele não
 * tem para onde voltar: o menu que o abriu já se fechou, e depois de excluir o
 * próprio item some. Sem isso o foco cairia no `<body>` (RNF-06 da Fase 1).
 */
export function useAcoesDoAgente({
  onExcluido,
  vizinho,
}: {
  onExcluido?: (id: string) => void;
  vizinho?: () => HTMLElement | null;
} = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { abrirPainel, focarCampo, temFluxo } = useAcoesChat();
  const [excluindo, setExcluindo] = useState<AgenteAlvo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** O agente com quem se pediu conversa enquanto uma resposta chegava. */
  const [esperando, setEsperando] = useState<string | null>(null);

  /**
   * Conversa nova com o agente, na tela cheia do chat. Não envia nada: uma
   * mensagem são até cinco chamadas pagas, e a primeira é de quem digita.
   *
   * Com uma resposta chegando, **não troca a conversa**: ela sumiria da tela e
   * o laço seguiria pago sem ninguém vendo (INV-56). Mostra a resposta em
   * curso — no painel, ou no campo da tela do chat, onde o painel não existe e
   * abri-lo não mostraria nada — e diz por que não trocou.
   *
   * Sem fluxo, a troca **não** acontece aqui: vai no `state` da navegação e
   * `AssistentePage` a aplica ao chegar. No editor com rascunho sujo a guarda
   * segura o `navigate`, e só a navegação que ela deixar passar troca a
   * conversa (`EstadoRotaChat`).
   */
  const conversar = useCallback(
    (a: AgenteAlvo) => {
      if (temFluxo()) {
        setEsperando(a.name);
        if (naTelaDoChat(pathname)) focarCampo();
        else abrirPainel();
        return;
      }
      setEsperando(null);
      const estado: EstadoRotaChat = { conversaNova: { agente: { id: a.id, name: a.name } } };
      navigate("/assistente", { state: estado });
    },
    [navigate, pathname, abrirPainel, focarCampo, temFluxo],
  );

  const exportar = useCallback(async (a: AgenteAlvo) => {
    setErro(null);
    try {
      await baixarAgente(a.id, a.name);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível exportar o agente.");
    }
  }, []);

  const itens = useCallback(
    (
      a: AgenteAlvo,
      { noEditor = false }: { noEditor?: boolean } = {},
    ): ItemMenu[] => [
      // No editor, "Editar" é onde já se está, e "Conversar" não tem outro botão.
      noEditor
        ? {
            rotulo: "Conversar",
            icone: <IconeAssistente className="size-3.5" />,
            aoEscolher: () => conversar(a),
          }
        : {
            rotulo: "Editar",
            icone: <IconeLapis className="size-3.5" />,
            aoEscolher: () => navigate(`/assistente/agentes/${a.id}`),
          },
      {
        rotulo: "Duplicar",
        icone: <IconeCopiar className="size-3.5" />,
        aoEscolher: () => navigate(`/assistente/agentes/novo?duplicar=${a.id}`),
      },
      {
        rotulo: "Exportar em Markdown",
        icone: <IconeBaixar className="size-3.5" />,
        aoEscolher: () => void exportar(a),
      },
      {
        rotulo: "Excluir…",
        icone: <IconeLixeira className="size-3.5" />,
        aoEscolher: () => setExcluindo(a),
      },
    ],
    [conversar, exportar, navigate],
  );

  const devolverFoco = () =>
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) vizinho?.()?.focus();
    });

  const elementos: ReactNode = (
    <>
      {erro && (
        <Aviso tom="erro" onFechar={() => setErro(null)} className="mt-2">
          {erro}
        </Aviso>
      )}
      {/* Entra na tela já preenchido: sem `urgente`, o `status` passaria calado. */}
      {esperando && (
        <Aviso tom="alerta" urgente onFechar={() => setEsperando(null)} className="mt-2">
          {avisoDeEspera(esperando)}
        </Aviso>
      )}
      {excluindo && (
        <DialogoExcluirAgente
          agente={excluindo}
          onFechar={() => {
            setExcluindo(null);
            devolverFoco();
          }}
          onExcluido={() => {
            const id = excluindo.id;
            setExcluindo(null);
            onExcluido?.(id);
            devolverFoco();
          }}
        />
      )}
    </>
  );

  return { conversar, exportar, itens, elementos, pedirExclusao: setExcluindo };
}
