import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import {
  ganhoNaSemana,
  pontosDoDia,
  useHabitos,
  useRegistrarAvulso,
  useResumoRitmo,
} from "@yu-book/cliente/habitos";
import type { Ganho } from "@yu-book/cliente/habitos";
import { IconeFechar } from "@yu-book/cliente/icones";
import { SeletorPontos } from "@yu-book/cliente/ritmo/SeletorPontos";
import { ToastGanho } from "@yu-book/cliente/ritmo/ToastGanho";
import type { AvisoDeGanho } from "@yu-book/cliente/ritmo/ToastGanho";
import { MAX_PONTOS, quantoConta } from "@yu-book/shared";
import type { HabitItem } from "@yu-book/shared";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useFolhaNoHistorico } from "../../lib/historico";
import { Alca } from "../Alca";
import { Pilula } from "../folha/Pilulas";

interface Ritmo {
  /** RF-25: a folha "Registrar fora do plano", já num hábito ou para escolher. */
  abrirRegistro: (habitId?: string) => void;
  /** RF-27: o toast de pontos. */
  avisarGanho: (habito: HabitItem, ganho: Ganho) => void;
}

const ContextoRitmo = createContext<Ritmo | null>(null);

export function useRitmo(): Ritmo {
  const ritmo = useContext(ContextoRitmo);
  if (!ritmo) throw new Error("useRitmo fora de ProvedorRitmo");
  return ritmo;
}

/** "Inglês · 110 de 120" e o próximo passo, ou o "+N" do ganho. */
function avisoDe(habito: HabitItem, ganho: Ganho, id: number): AvisoDeGanho {
  return {
    id,
    ganho: `+${ganho.pontos}`,
    titulo: `${habito.name} · ${ganho.progresso} de ${ganho.meta}`,
    detalhe: ganho.frase,
  };
}

/**
 * O que a frente Ritmo põe por cima de qualquer tela do móvel (Ritmo 2): a
 * folha de registro e o toast de pontos, um de cada para o app inteiro, como
 * a folha de item (`ProvedorFolhaItem`). O Início, o detalhe do hábito e a
 * agenda pedem por `useRitmo`.
 */
export function ProvedorRitmo({ children }: { children: ReactNode }) {
  const [registro, setRegistro] = useState<{ habitId: string | null } | null>(null);
  const [aviso, setAviso] = useState<AvisoDeGanho | null>(null);
  const contador = useRef(0);

  const abrirRegistro = useCallback((habitId?: string) => {
    setRegistro({ habitId: habitId ?? null });
  }, []);
  const avisarGanho = useCallback((habito: HabitItem, ganho: Ganho) => {
    contador.current += 1;
    setAviso(avisoDe(habito, ganho, contador.current));
  }, []);
  const fechar = useCallback(() => setRegistro(null), []);
  const sumir = useCallback(() => setAviso(null), []);

  useFolhaNoHistorico(registro !== null, fechar);

  const valor = useMemo(() => ({ abrirRegistro, avisarGanho }), [abrirRegistro, avisarGanho]);

  return (
    <ContextoRitmo.Provider value={valor}>
      {children}
      <Dialogo
        aberto={registro !== null}
        onFechar={fechar}
        rotulo="Registrar fora do plano"
        posicao="folha"
        largura="max-w-lg"
      >
        {registro && (
          <FolhaRegistro
            habitoInicial={registro.habitId}
            onFechar={fechar}
            onRegistrado={avisarGanho}
          />
        )}
      </Dialogo>
      <ToastGanho aviso={aviso} onSumir={sumir} />
    </ContextoRitmo.Provider>
  );
}

const LIVRE = "livre";

/**
 * RF-25: o hábito (quando a folha veio do Início), a atividade ou "Valor
 * livre", e os pontos de 5 em 5. O aviso usa a conta do servidor
 * (`quantoConta`, RN-16), com o dia de hoje **do usuário** (RN-17): até o
 * resumo chegar, ele não promete nada.
 */
function FolhaRegistro({
  habitoInicial,
  onFechar,
  onRegistrado,
}: {
  habitoInicial: string | null;
  onFechar: () => void;
  onRegistrado: (habito: HabitItem, ganho: Ganho) => void;
}) {
  const habitos = useHabitos();
  const resumo = useResumoRitmo();
  const registrar = useRegistrarAvulso();
  const lista = habitos.data ?? [];
  const [habitId, setHabitId] = useState<string | null>(habitoInicial);
  const habito = lista.find((h) => h.id === habitId) ?? (habitoInicial ? undefined : lista[0]);
  const ativas = habito?.activities.filter((a) => !a.archived) ?? [];
  // RN-19: sem atividade ativa, a folha abre no "Valor livre".
  const [escolha, setEscolha] = useState<string | null>(null);
  const atividade =
    escolha === LIVRE ? undefined : (ativas.find((a) => a.id === escolha) ?? ativas[0]);
  const [valorLivre, setValorLivre] = useState<number | null>(null);
  const valor = valorLivre ?? atividade?.points ?? 10;
  const [erro, setErro] = useState<string | null>(null);

  const hoje = resumo.data?.today ?? null;
  const jaHoje = habito && hoje ? pontosDoDia(habito, hoje) : 0;
  const cap = habito?.week.cap ?? 0;
  const { conta, extra } = quantoConta(valor, cap, jaHoje);
  const aviso = !habito || !hoje
    ? "Carregando a semana…"
    : extra === 0
      ? `Tudo conta para a meta de hoje (teto ${cap}).`
      : conta === 0
        ? `O teto de hoje (${cap}) já está cheio: os ${valor} viram XP extra.`
        : `${conta} contam para a meta; ${extra} ${extra === 1 ? "vira" : "viram"} XP extra.`;

  function escolherHabito(id: string) {
    setHabitId(id);
    setEscolha(null);
    setValorLivre(null);
  }

  function escolherAtividade(id: string) {
    setEscolha(id);
    // Com uma atividade, os pontos voltam aos dela; o "livre" guarda o último.
    if (id !== LIVRE) setValorLivre(null);
    else setValorLivre(valor);
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (!habito || !hoje) return;
    setErro(null);
    const ganho = ganhoNaSemana(habito, valor, hoje);
    registrar
      .mutateAsync({
        habitId: habito.id,
        ...(atividade && { activityId: atividade.id }),
        // Os pontos só vão quando não são os da atividade (RF-09).
        ...((!atividade || valor !== atividade.points) && { points: valor }),
      })
      .then(() => {
        onRegistrado(habito, ganho);
        onFechar();
      })
      .catch(() => setErro("Não deu para registrar. Confira a conexão e tente de novo."));
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5 pt-3">
      <Alca />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-titulo">Registrar fora do plano</h2>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="grid size-11 place-items-center rounded-full text-ink-400 hover:bg-ink-800"
        >
          <IconeFechar className="size-5" />
        </button>
      </div>

      {habitos.isError ? (
        <Aviso tom="erro">Não deu para carregar os hábitos.</Aviso>
      ) : habitos.isPending ? (
        <div aria-hidden="true" className="h-40 animate-pulse rounded-dialogo bg-ink-900" />
      ) : lista.length === 0 ? (
        <p className="text-sm text-ink-400">
          Nenhum hábito ativo. O hábito se cria pelo assistente ou pelo MCP.
        </p>
      ) : (
        <>
          {!habitoInicial && lista.length > 1 && (
            <div role="group" aria-label="Hábito" className="flex flex-wrap gap-2">
              {lista.map((h) => (
                <Pilula key={h.id} ativa={h.id === habito?.id} onClick={() => escolherHabito(h.id)}>
                  {h.name}
                </Pilula>
              ))}
            </div>
          )}
          {habito && (
            <>
              <div>
                <p className="rotulo">
                  {habitoInicial || lista.length === 1
                    ? `O que você fez em ${habito.name}`
                    : "O que você fez"}
                </p>
                <div role="group" aria-label="Atividade" className="mt-2 flex flex-wrap gap-2">
                  {ativas.map((a) => (
                    <Pilula
                      key={a.id}
                      ativa={atividade?.id === a.id}
                      onClick={() => escolherAtividade(a.id)}
                    >
                      {a.name} · {a.points}
                    </Pilula>
                  ))}
                  <Pilula ativa={!atividade} onClick={() => escolherAtividade(LIVRE)}>
                    Valor livre
                  </Pilula>
                </div>
              </div>
              <SeletorPontos
                valor={valor}
                onMudar={setValorLivre}
                min={1}
                max={MAX_PONTOS}
                aviso={aviso}
                fracaoDoTeto={cap > 0 ? (jaHoje + valor) / cap : 0}
              />
              {erro && <Aviso tom="erro">{erro}</Aviso>}
              <Botao
                type="submit"
                variante="primario"
                tamanho="g"
                carregando={registrar.isPending}
                disabled={!hoje}
                className="w-full"
              >
                Registrar +{valor}
              </Botao>
            </>
          )}
        </>
      )}
    </form>
  );
}
