import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFolhaNoHistorico } from "../../lib/historico";
import { useHoje } from "../../lib/hoje";
import { FormularioItem, tituloDaFolha } from "./FormularioItem";
import type { AberturaFolha, TipoItem } from "./FormularioItem";
import { VisualizacaoItem } from "./VisualizacaoItem";
import type { AberturaVer } from "./VisualizacaoItem";

/** O que a folha abre: o formulário (criar, editar) ou a visualização. */
export type AberturaDaFolha = AberturaFolha | AberturaVer;

interface Folha {
  /**
   * Abre a folha para criar, editar ou ver. O toque num item **vê**; o
   * "Editar" da visualização troca para o formulário na mesma folha.
   */
  abrir: (abertura: AberturaDaFolha) => void;
  /** O "+" da barra: decide o tipo de partida (ver `tipoDaBarra`). */
  abrirDaBarra: (pathname: string) => void;
  /** A folha está aberta pelo "+" da barra — o `aria-expanded` dele. */
  abertaPelaBarra: boolean;
}

const ContextoFolha = createContext<Folha | null>(null);

export function useFolhaItem(): Folha {
  const folha = useContext(ContextoFolha);
  if (!folha) throw new Error("useFolhaItem fora de ProvedorFolhaItem");
  return folha;
}

/**
 * O tipo com que o "+" da barra abre. Na Agenda, evento; em Tarefas, tarefa —
 * a área diz o que se quer. Fora delas, o último tipo criado **nesta sessão**,
 * e evento enquanto nenhum foi: quem anota várias tarefas seguidas não troca a
 * alternância a cada uma. Memória de módulo, e não `localStorage`, de
 * propósito: recarregar volta ao evento, e a preferência não merece chave.
 * O "+" do dia, na Agenda, abre sempre como evento, no dia escolhido.
 */
let ultimoTipo: TipoItem = "evento";

function tipoDaBarra(pathname: string): TipoItem {
  if (pathname.startsWith("/agenda")) return "evento";
  if (pathname.startsWith("/tarefas")) return "tarefa";
  return ultimoTipo;
}

/**
 * A folha de criar e editar evento e tarefa, uma só para o app inteiro, na
 * casca: a abrem o "+" da barra, o "+" do dia e o toque num item. Montada com
 * a prop viva (`aberto`), e o formulário nasce de novo a cada abertura.
 */
export function ProvedorFolhaItem({ children }: { children: ReactNode }) {
  const [abertura, setAbertura] = useState<AberturaDaFolha | null>(null);
  const [pelaBarra, setPelaBarra] = useState(false);
  const [tipo, setTipo] = useState<TipoItem>("evento");
  const focoTitulo = useRef<HTMLInputElement>(null);
  const focoCabecalho = useRef<HTMLHeadingElement>(null);
  // Só para manter o hoje do usuário em cache: o formulário nasce no toque e
  // já encontra "Hoje" e "Amanhã" decididos, sem esperar a API.
  useHoje();

  const abrir = useCallback((nova: AberturaDaFolha) => {
    setAbertura(nova);
    setPelaBarra(false);
    setTipo(nova.modo === "criar" ? nova.tipo : "evento" in nova ? "evento" : "tarefa");
  }, []);

  const abrirDaBarra = useCallback(
    (pathname: string) => {
      abrir({ modo: "criar", tipo: tipoDaBarra(pathname), dia: null });
      setPelaBarra(true);
    },
    [abrir],
  );

  const fechar = useCallback(() => {
    setAbertura(null);
    setPelaBarra(false);
  }, []);

  // A guarda do formulário: com alteração não salva, véu, `Esc`, Voltar e
  // "Fechar" perguntam antes (a pergunta é dele, inline, sem diálogo aninhado).
  const guarda = useRef<(() => boolean) | null>(null);
  const registrarGuarda = useCallback((nova: (() => boolean) | null) => {
    guarda.current = nova;
  }, []);
  const pedirFechar = useCallback((): boolean => {
    if (guarda.current && !guarda.current()) return false;
    fechar();
    return true;
  }, [fechar]);

  useFolhaNoHistorico(abertura !== null, pedirFechar);

  const valor = useMemo(
    () => ({ abrir, abrirDaBarra, abertaPelaBarra: pelaBarra }),
    [abrir, abrirDaBarra, pelaBarra],
  );

  return (
    <ContextoFolha.Provider value={valor}>
      {children}
      <Dialogo
        aberto={abertura !== null}
        onFechar={pedirFechar}
        rotulo={
          !abertura
            ? "Criar"
            : abertura.modo === "ver"
              ? "evento" in abertura
                ? abertura.evento.title
                : abertura.tarefa.title
              : tituloDaFolha(abertura, tipo)
        }
        posicao="folha"
        largura="max-w-lg"
        // Criar abre o teclado no título, que é o que se vai escrever. Editar
        // não: quem tocou numa tarefa quase sempre quer ver ou concluir, e o
        // teclado cobriria metade da folha.
        focoInicial={abertura?.modo === "criar" ? focoTitulo : focoCabecalho}
      >
        {abertura?.modo === "ver" && (
          <VisualizacaoItem
            abertura={abertura}
            onEditar={() =>
              abrir(
                "evento" in abertura
                  ? { modo: "editar", evento: abertura.evento }
                  : { modo: "editar", tarefa: abertura.tarefa },
              )
            }
            onFechar={fechar}
            focoCabecalho={focoCabecalho}
          />
        )}
        {abertura && abertura.modo !== "ver" && (
          <FormularioItem
            abertura={abertura}
            onFechar={fechar}
            onPedirFechar={pedirFechar}
            registrarGuarda={registrarGuarda}
            onTipo={setTipo}
            onCriado={(criado) => {
              ultimoTipo = criado;
            }}
            focoTitulo={focoTitulo}
            focoCabecalho={focoCabecalho}
          />
        )}
      </Dialogo>
    </ContextoFolha.Provider>
  );
}
