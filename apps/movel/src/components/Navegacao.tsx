import {
  IconeAssistente,
  IconeCalendario,
  IconeInicio,
  IconeMais,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import type { ReactElement } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useFolhaItem } from "./folha/FolhaItem";

interface Area {
  para: string;
  rotulo: string;
  Icone: (p: IconeProps) => ReactElement;
}

// O "+" fica entre as duas metades: no centro da barra, ao alcance do polegar.
const ANTES: Area[] = [
  { para: "/", rotulo: "Início", Icone: IconeInicio },
  { para: "/agenda", rotulo: "Agenda", Icone: IconeCalendario },
];
const DEPOIS: Area[] = [
  { para: "/tarefas", rotulo: "Tarefas", Icone: IconeTarefa },
  { para: "/assistente", rotulo: "Assistente", Icone: IconeAssistente },
];

function ItemArea({ para, rotulo, Icone }: Area) {
  return (
    <li className="flex flex-1 justify-center lg:w-full lg:flex-none">
      {/* `NavLink` põe `aria-current="page"` no ativo. O ativo tem forma além
          da cor — a pílula atrás do ícone e o rótulo em negrito (RNF-09). */}
      <NavLink
        to={para}
        end={para === "/"}
        className={({ isActive }) =>
          `group flex min-h-14 w-full max-w-20 flex-col items-center justify-center gap-1
           rounded-cartao text-miudo transition-colors duration-150 ease-(--ease-padrao) ${
             isActive ? "font-semibold text-accent-400" : "font-medium text-ink-400 hover:text-ink-200"
           }`
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors
                          duration-200 ease-(--ease-padrao) ${
                            isActive ? "bg-accent-500/15" : "group-active:bg-ink-800"
                          }`}
            >
              <Icone className="size-5" />
            </span>
            {rotulo}
          </>
        )}
      </NavLink>
    </li>
  );
}

function BotaoCriar() {
  const { abrirDaBarra, abertaPelaBarra } = useFolhaItem();
  const { pathname } = useLocation();
  return (
    <button
      type="button"
      onClick={() => abrirDaBarra(pathname)}
      aria-label="Criar"
      title="Criar"
      aria-haspopup="dialog"
      aria-expanded={abertaPelaBarra}
      className="flex size-14 -translate-y-3 items-center justify-center rounded-full
                 bg-accent-500 text-white shadow-(--sombra-criar) transition duration-150
                 ease-(--ease-padrao) hover:brightness-110 active:scale-95
                 lg:size-12 lg:translate-y-0"
    >
      <IconeMais className="size-6" />
    </button>
  );
}

/**
 * Barra de navegação do móvel: uma pílula flutuante no pé da tela, acima da
 * barra de gestos (`safe-area-inset-bottom`), com o "+" no centro. A partir de
 * 1024px vira trilho à esquerda — os mesmos itens, o "+" no topo —, que é o
 * móvel aberto no desktop. Todo alvo tem pelo menos 56px.
 */
export function Navegacao({ soTrilho = false }: { soTrilho?: boolean }) {
  return (
    <nav
      aria-label="Navegação principal"
      // `soTrilho`: dentro da conversa do chat, a barra do celular sairia por
      // cima do compositor; o trilho do desktop não atrapalha e fica.
      className={`${soTrilho ? "hidden lg:block" : ""}
                 fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]
                 z-(--z-navegacao) mx-auto max-w-md
                 lg:bottom-4 lg:left-4 lg:right-auto lg:top-4 lg:mx-0 lg:max-w-none`}
    >
      <ul
        className="flex h-16 items-center rounded-full border border-ink-800/70 bg-superficie/90
                   px-1.5 shadow-e3 backdrop-blur-md
                   lg:h-full lg:w-20 lg:flex-col lg:gap-1 lg:rounded-dialogo lg:px-0 lg:py-4"
      >
        {/* Dois "+", um por layout, cada um na posição em que aparece: a ordem
            do Tab segue a da tela (WCAG 2.4.3), o que `order` no CSS não faria.
            O oculto é `display: none` e sai da árvore de acessibilidade. */}
        <li className="mb-3 hidden justify-center lg:flex">
          <BotaoCriar />
        </li>
        {ANTES.map((area) => (
          <ItemArea key={area.para} {...area} />
        ))}
        <li className="flex flex-1 justify-center lg:hidden">
          <BotaoCriar />
        </li>
        {DEPOIS.map((area) => (
          <ItemArea key={area.para} {...area} />
        ))}
      </ul>
    </nav>
  );
}
