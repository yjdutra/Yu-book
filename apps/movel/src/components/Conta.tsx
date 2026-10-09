import { useAuth } from "@yu-book/cliente/auth";
import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { useId, useState } from "react";
import { useTema } from "../lib/tema";
import type { PreferenciaTema } from "../lib/tema";
import { iniciais } from "../lib/saudacao";
import { Alca } from "./Alca";

const OPCOES_TEMA: { valor: PreferenciaTema; rotulo: string }[] = [
  { valor: "claro", rotulo: "Claro" },
  { valor: "escuro", rotulo: "Escuro" },
  { valor: "sistema", rotulo: "Sistema" },
];

function Avatar({ nome, grande = false }: { nome: string; grande?: boolean }) {
  // Branco sobre `accent-500` passa AA nos dois temas (4,80 e 6,29).
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-500 font-semibold
                  text-white ${grande ? "size-12 text-base" : "size-11 text-sm"}`}
    >
      {iniciais(nome)}
    </span>
  );
}

/**
 * O avatar do cabeçalho e a folha que ele abre: quem está na conta, o tema e
 * sair. Folha, e não menu suspenso: no celular o item de menu do web (32px)
 * fica abaixo do alvo de toque de 44px, e o tema é uma escolha entre três —
 * controle segmentado, como o `SeletorModo` do web.
 */
export function Conta() {
  const { user, logout } = useAuth();
  const [tema, escolherTema] = useTema();
  const [aberta, setAberta] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const idTema = useId();
  const nome = user?.name ?? "";

  async function sair() {
    setSaindo(true);
    // O `AuthProvider` zera a sessão mesmo se a API falhar; a casca desmonta.
    await logout().catch(() => undefined);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-haspopup="dialog"
        aria-expanded={aberta}
        aria-label="Conta e tema"
        title="Conta e tema"
        className="rounded-full shadow-e2 transition duration-150 ease-(--ease-padrao)
                   active:scale-95"
      >
        <Avatar nome={nome} />
      </button>

      <Dialogo
        aberto={aberta}
        onFechar={() => setAberta(false)}
        rotulo="Conta e tema"
        posicao="folha"
      >
        <div className="px-5 pb-5 pt-3">
          <Alca />
          <div className="mt-4 flex items-center gap-3">
            <Avatar nome={nome} grande />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-titulo">{nome}</p>
              <p className="truncate text-sm text-ink-400">{user?.email}</p>
            </div>
          </div>

          <h2 id={idTema} className="rotulo mt-7">
            Tema
          </h2>
          {/* O ativo se ergue do trilho como cartão: forma além da cor, e
              `aria-pressed` diz o mesmo ao leitor de tela. */}
          <div
            role="group"
            aria-labelledby={idTema}
            className="mt-2 grid grid-cols-3 gap-1 rounded-cartao bg-ink-900 p-1"
          >
            {OPCOES_TEMA.map(({ valor, rotulo }) => {
              const ativo = tema === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => escolherTema(valor)}
                  className={`min-h-11 rounded-controle text-sm transition-colors duration-150 ${
                    ativo
                      ? "bg-superficie font-semibold text-titulo shadow-e1"
                      : "font-medium text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            Vale só neste aparelho. "Sistema" acompanha o modo claro ou escuro do celular.
          </p>

          <div className="mt-7 grid grid-cols-2 gap-2">
            <Botao variante="secundario" tamanho="g" onClick={() => setAberta(false)}>
              Fechar
            </Botao>
            <Botao variante="perigo" tamanho="g" carregando={saindo} onClick={sair}>
              Sair
            </Botao>
          </div>
        </div>
      </Dialogo>
    </>
  );
}
