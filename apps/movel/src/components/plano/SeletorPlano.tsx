import { IconeCalendario, IconeTarefa } from "@yu-book/cliente/icones";
import { Link, useLocation } from "react-router-dom";

const OPCOES = [
  { para: "/agenda", rotulo: "Agenda", Icone: IconeCalendario },
  { para: "/tarefas", rotulo: "Tarefas", Icone: IconeTarefa },
] as const;

/**
 * O seletor do topo de Plano (frente Ritmo, RF-16): Agenda e Tarefas são duas
 * rotas, e isto é navegação — links com `aria-current`, não abas. Trocar é
 * página nova no histórico, e o Voltar desfaz. O ativo tem forma além da cor:
 * o fundo erguido e o rótulo em negrito.
 */
export function SeletorPlano() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Plano" className="mb-5">
      <ul className="grid grid-cols-2 gap-1 rounded-cartao border border-ink-800/70 bg-ink-900 p-1">
        {OPCOES.map(({ para, rotulo, Icone }) => {
          const ativa = pathname === para;
          return (
            <li key={para}>
              <Link
                to={para}
                aria-current={ativa ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-controle text-sm
                            transition-colors duration-150 ${
                              ativa
                                ? "bg-superficie font-semibold text-titulo shadow-e1"
                                : "font-medium text-ink-400 hover:text-ink-200"
                            }`}
              >
                <Icone className="size-4" />
                {rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
