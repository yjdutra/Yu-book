import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { ID_BOTAO_PAINEL } from "../../lib/sessaoChat";
import { useWorkspaceAtivo } from "../../lib/workspace";
import { BotaoIcone } from "../base/Botao";
import { Menu } from "../base/Menu";
import {
  IconeAjustes,
  IconeAssistente,
  IconeBoard,
  IconeBusca,
  IconeInicio,
  IconeLink,
  IconeMais,
  IconeNotas,
  IconePainelDireito,
  IconeRecolher,
  IconeTeclado,
} from "../Icones";
import { SeletorTema } from "../SeletorTema";
import { areaDe } from "./PainelContexto";

/** Id do botão que traz o painel de volta — a casca devolve o foco a ele. */
export const ID_MOSTRAR_CONTEXTO = "yb-mostrar-contexto";

/** Botão de área do trilho: ícone grande, nome na dica e no leitor de tela. */
function ItemTrilho({
  rotulo,
  dica,
  ativo = false,
  destaque = false,
  marca,
  onClick,
  children,
}: {
  rotulo: string;
  dica: string;
  ativo?: boolean;
  destaque?: boolean;
  /** Badge ou ponto sobre o ícone — sempre acompanhado de texto no `rotulo`. */
  marca?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={dica}
      aria-current={ativo ? "page" : undefined}
      className={`relative flex size-10 items-center justify-center rounded-controle
                  transition duration-[120ms] ${
                    destaque
                      ? `bg-linear-to-br from-accent-500/15 to-ia-500/15 text-accent-400
                         hover:from-accent-500/25 hover:to-ia-500/25 ${
                           ativo ? "shadow-brilho-ia" : ""
                         }`
                      : ativo
                        ? "bg-ink-800 text-titulo shadow-e1"
                        : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-200"
                  }`}
    >
      {/* Barra de ativo: forma, além do fundo (RNF-09). */}
      {ativo && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 -left-2 w-[3px] rounded-full bg-accent-400"
        />
      )}
      {children}
      {marca}
    </button>
  );
}

/**
 * Trilho de áreas (redesenho de UI, Etapa 2). Substitui a barra lateral única,
 * em que área, filtro e ação tinham o mesmo peso: aqui fica só "para onde ir";
 * o "o que ver" mora no painel contextual ao lado.
 */
export function Trilho({
  linksParaVer,
  chatAberto,
  notasComFiltroOculto,
  contextoRecolhido,
  onMostrarContexto,
  onIrParaNotas,
  onBuscar,
  onNovaNota,
  onAbrirChat,
  onAbrirGaveta,
  onAlternarChat,
  onAbrirAtalhos,
}: {
  /** RF-16 da Fase 3: quantos esperam na fila de "ver depois". */
  linksParaVer: number;
  chatAberto: boolean;
  /**
   * Painel contextual recolhido com filtro de nota valendo: o trilho é o único
   * lugar que sobrou para avisar — a mesma regra da seção recolhida.
   */
  notasComFiltroOculto: boolean;
  contextoRecolhido: boolean;
  onMostrarContexto: () => void;
  onIrParaNotas: () => void;
  onBuscar: () => void;
  onNovaNota: () => void;
  onAbrirChat: () => void;
  onAbrirGaveta: () => void;
  onAlternarChat: () => void;
  onAbrirAtalhos: () => void;
}) {
  const navigate = useNavigate();
  const area = areaDe(useLocation().pathname);
  const { user, logout } = useAuth();
  const { ativo } = useWorkspaceAtivo();

  return (
    <nav
      aria-label="Áreas"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-ink-800
                 bg-ink-950 py-3"
    >
      <h1 className="sr-only">Yu-book</h1>
      <span
        aria-hidden="true"
        className="mb-2 flex size-8 items-center justify-center rounded-controle bg-linear-to-br
                   from-accent-500 to-ia-500 text-xs font-bold text-white shadow-e2"
      >
        Yu
      </span>

      <BotaoIcone
        rotulo="Buscar (Ctrl+K)"
        icone={<IconeBusca className="size-[18px]" />}
        onClick={onBuscar}
        tamanho="g"
      />
      <Menu
        rotulo="Criar"
        lado="direita"
        gatilho={(p) => (
          <button
            {...p}
            type="button"
            aria-label="Criar"
            title="Criar"
            className="flex size-10 items-center justify-center rounded-controle text-ink-400
                       transition hover:bg-ink-800/60 hover:text-ink-200"
          >
            <IconeMais className="size-[18px]" />
          </button>
        )}
        itens={[
          { rotulo: "Nova nota", icone: <IconeNotas />, atalho: "Ctrl+N", aoEscolher: onNovaNota },
          {
            rotulo: "Novo board",
            icone: <IconeBoard />,
            aoEscolher: () => navigate("/b", { state: { focarNovo: true } }),
          },
          {
            rotulo: "Salvar link",
            icone: <IconeLink />,
            atalho: "Ctrl+Shift+L",
            aoEscolher: onAbrirGaveta,
          },
          {
            rotulo: "Conversar com o assistente",
            icone: <IconeAssistente />,
            atalho: "Ctrl+Shift+Y",
            aoEscolher: onAbrirChat,
          },
        ]}
      />

      <div aria-hidden="true" className="my-2 h-px w-6 bg-ink-800" />

      <ItemTrilho
        rotulo="Início"
        dica="Início"
        ativo={area === "inicio"}
        onClick={() => navigate("/")}
      >
        <IconeInicio className="size-5" />
      </ItemTrilho>
      <ItemTrilho
        rotulo={notasComFiltroOculto ? "Notas, com filtro ativo" : "Notas"}
        dica="Notas"
        ativo={area === "notas"}
        onClick={onIrParaNotas}
        marca={
          notasComFiltroOculto && (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent-400 ring-2
                         ring-ink-950"
            />
          )
        }
      >
        <IconeNotas className="size-5" />
      </ItemTrilho>
      <ItemTrilho
        rotulo="Boards"
        dica="Boards (Ctrl+Shift+B)"
        ativo={area === "boards"}
        onClick={() => navigate("/b")}
      >
        <IconeBoard className="size-5" />
      </ItemTrilho>
      <ItemTrilho
        rotulo="Assistente"
        dica="Assistente"
        ativo={area === "assistente"}
        destaque
        onClick={() => navigate("/assistente")}
      >
        <IconeAssistente className="size-5" />
      </ItemTrilho>
      <ItemTrilho
        rotulo={linksParaVer ? `Links, ${linksParaVer} para ver depois` : "Links"}
        dica="Links (Ctrl+Shift+L)"
        onClick={onAbrirGaveta}
        marca={
          linksParaVer > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent-500 px-1
                         text-center text-miudo font-semibold leading-4 text-white ring-2
                         ring-ink-950"
            >
              {linksParaVer > 9 ? "9+" : linksParaVer}
            </span>
          )
        }
      >
        <IconeLink className="size-5" />
      </ItemTrilho>
      <ItemTrilho
        rotulo="Ajustes"
        dica="Ajustes"
        ativo={area === "ajustes"}
        onClick={() => navigate("/ajustes")}
      >
        <IconeAjustes className="size-5" />
      </ItemTrilho>

      <div className="mt-auto flex flex-col items-center gap-1">
        {/* O painel lateral do assistente. Some na tela cheia, que já é ele. */}
        {area !== "assistente" && (
          <button
            id={ID_BOTAO_PAINEL}
            type="button"
            onClick={onAlternarChat}
            aria-pressed={chatAberto}
            aria-label="Painel do assistente"
            title="Painel do assistente (Ctrl+Shift+Y)"
            className={`mb-1 flex size-8 items-center justify-center rounded-controle transition
                        duration-[120ms] ${
                          chatAberto
                            ? `bg-linear-to-br from-accent-500 to-ia-500 text-white
                               shadow-brilho-ia`
                            : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-200"
                        }`}
          >
            <IconePainelDireito />
          </button>
        )}
        {/* Recolhido, o painel só volta por aqui ou pelo atalho. E o workspace
            ativo, que mora nele, continua à vista: ele segue filtrando tudo, e
            some da tela não pode (RF-01 da Fase 2, a regra da seção recolhida). */}
        {contextoRecolhido && ativo && (
          <button
            type="button"
            onClick={onMostrarContexto}
            aria-label={`Workspace ${ativo.name} — mostrar painel lateral`}
            title={`Workspace ${ativo.name}`}
            // A cor do workspace vai na borda, não no fundo: é escolhida pelo
            // usuário, e texto sobre ela não teria contraste garantido.
            className="flex size-7 items-center justify-center rounded-etiqueta border-2
                       bg-ink-800 text-miudo font-bold text-ink-200 shadow-e1"
            style={{ borderColor: ativo.color }}
          >
            {ativo.name.charAt(0).toUpperCase()}
          </button>
        )}
        {contextoRecolhido && (
          <BotaoIcone
            id={ID_MOSTRAR_CONTEXTO}
            rotulo="Mostrar painel lateral (Ctrl+\)"
            icone={<IconeRecolher className="size-4 -scale-x-100" />}
            onClick={onMostrarContexto}
          />
        )}
        <BotaoIcone
          rotulo="Atalhos de teclado (Ctrl+/)"
          icone={<IconeTeclado />}
          onClick={onAbrirAtalhos}
        />
        <SeletorTema />
        <Menu
          rotulo={`Conta de ${user?.name ?? "usuário"}`}
          lado="direita-acima"
          cabecalho={
            <>
              <span className="block text-ink-400">Conectado como</span>
              <span className="block truncate font-medium text-titulo">{user?.name}</span>
            </>
          }
          gatilho={(p) => (
            <button
              {...p}
              type="button"
              aria-label={`Conta de ${user?.name ?? "usuário"}`}
              title={user?.name}
              className="mt-1 flex size-8 items-center justify-center rounded-full bg-ink-800
                         text-xs font-semibold text-ink-200 ring-1 ring-ink-700 transition
                         hover:ring-accent-400"
            >
              {(user?.name ?? "?").charAt(0).toUpperCase()}
            </button>
          )}
          itens={[{ rotulo: "Sair", aoEscolher: () => void logout() }]}
        />
      </div>
    </nav>
  );
}
