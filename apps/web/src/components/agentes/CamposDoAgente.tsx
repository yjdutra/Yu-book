import { AGENT_COLORS, LIVE_SOURCE_DETAILS, MAX_LIMITE_FONTE_VIVA } from "@yu-book/shared";
import type { AgentColor, AiFavorite, LiveSourceDetail } from "@yu-book/shared";
import { useId } from "react";
import { Link } from "react-router-dom";
import { useAiAjustes } from "../../lib/ia";
import { useBoard, useBoards } from "../../lib/kanban";
import { CartaoModelo } from "../ajustes/CartaoModelo";
import { Aviso } from "../base/Aviso";
import { BotaoIcone } from "../base/Botao";
import { IconeCheck, IconeFechar } from "../Icones";
import { COR_DO_AGENTE } from "./AvatarAgente";

/**
 * Os campos do editor de agentes que têm desenho próprio: a cor, a fonte viva
 * e o modelo. Separados do editor para ele caber numa leitura.
 */

/** Classe comum dos campos de texto e seleção do editor. */
export const CLASSE_CAMPO = `h-8 w-full rounded-controle border border-ink-700 bg-ink-900 px-2.5
  text-sm text-ink-200 outline-none transition-colors placeholder:text-ink-400/70
  focus:border-accent-400 aria-invalid:border-red-300/60 disabled:cursor-not-allowed
  disabled:opacity-50`;

/**
 * A cor em amostras de rádio. **Cada amostra tem o nome visível** e a
 * escolhida ganha o visto e o anel (RNF-09): quem não distingue as cores
 * escolhe pelo nome. Rádio nativo escondido, e não botões: as setas trocam a
 * escolha, e o leitor de tela anuncia "3 de 6".
 *
 * Derivado de `AGENT_COLORS` (INV-54): cor nova no enum aparece aqui sozinha,
 * e o `Record` de `AvatarAgente.tsx` cobra a classe dela.
 */
export function EscolhaDeCor({
  cor,
  onMudar,
  nome,
}: {
  cor: AgentColor;
  onMudar: (cor: AgentColor) => void;
  nome: string;
}) {
  const grupo = useId();
  return (
    <fieldset>
      <legend className="rotulo mb-1.5">Cor</legend>
      <div className="flex flex-wrap gap-1.5">
        {AGENT_COLORS.map((c) => {
          const escolhida = c === cor;
          return (
            <label
              key={c}
              className={`flex cursor-pointer items-center gap-1.5 rounded-controle border py-1 pl-1
                          pr-2.5 text-xs transition-colors
                          has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2
                          has-[:focus-visible]:outline-accent-400 ${
                            escolhida
                              ? `${COR_DO_AGENTE[c].tinta} text-titulo`
                              : `border-ink-700 text-ink-400 hover:border-ink-400
                                 hover:text-ink-200`
                          }`}
            >
              <input
                type="radio"
                name={grupo}
                value={c}
                checked={escolhida}
                onChange={() => onMudar(c)}
                className="sr-only"
                aria-label={`Cor ${COR_DO_AGENTE[c].nome}${nome ? ` para ${nome}` : ""}`}
              />
              <span
                aria-hidden="true"
                className={`flex size-5 items-center justify-center rounded-etiqueta text-white
                            ${COR_DO_AGENTE[c].fundo}`}
              >
                {escolhida && <IconeCheck className="size-3.5" />}
              </span>
              {COR_DO_AGENTE[c].nome}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface FonteRascunho {
  /// Chave local da linha: a fonte ainda sem coluna não tem id nenhum.
  chave: string;
  boardId: string;
  columnId: string;
  limite: number;
  detalhe: LiveSourceDetail;
  /// A coluna que o servidor disse que não existe mais.
  sumiu?: boolean;
}

/**
 * O rótulo de cada detalhe de fonte viva. `Record` total (INV-54): detalhe novo
 * no enum de `shared` não compila sem rótulo, e a escolha abaixo o percorre.
 */
const ROTULO_DETALHE: Record<LiveSourceDetail, string> = {
  titulos: "só títulos",
  faces: "faces inteiras",
};

/**
 * O estado de uma escolha de quadro e coluna: as listas e o que sumiu. Separado
 * de `SeletorColuna` porque quem o usa também precisa dizer, fora dos campos,
 * que a coluna escolhida não existe mais. As consultas são as mesmas do
 * seletor, e o TanStack as partilha — chamar os dois não dobra requisição.
 */
export function useEscolhaDeColuna(boardId: string, columnId: string, sumiu = false) {
  const { data: quadros } = useBoards(null);
  const { data: quadro, isLoading } = useBoard(boardId || null);
  const quadroSumiu = Boolean(boardId && quadros && !quadros.some((q) => q.id === boardId));
  const colunaSumiu =
    sumiu || Boolean(columnId && quadro && !quadro.columns.some((c) => c.id === columnId));
  return { quadros, quadro, carregando: isLoading, quadroSumiu, colunaSumiu };
}

/**
 * Quadro e coluna, em dois `<select>` — saiu de `LinhaFonte` na Etapa E, com o
 * editor de rotinas como segundo consumidor. Devolve **os dois rótulos soltos**,
 * sem invólucro: quem chama decide a grade (a fonte viva põe o botão de
 * remover na mesma linha).
 *
 * `quadroFixo` esconde a escolha de quadro e oferece só as colunas dele — a
 * coluna das ideias usadas de uma rotina, que precisa ser do quadro da entrada
 * porque card não atravessa quadro (RN-04 da Fase 2). `excluir` tira colunas da
 * lista sem apagar a escolha que já as cite.
 */
export function SeletorColuna({
  boardId,
  columnId,
  onMudar,
  rotuloQuadro,
  rotuloColuna,
  sumiu = false,
  quadroFixo = false,
  excluir = [],
  semContagem = false,
}: {
  boardId: string;
  columnId: string;
  onMudar: (escolha: { boardId: string; columnId: string }) => void;
  /** Nome acessível do campo de quadro. */
  rotuloQuadro: string;
  /** Nome acessível do campo de coluna. */
  rotuloColuna: string;
  sumiu?: boolean;
  quadroFixo?: boolean;
  excluir?: readonly string[];
  /** Tira o "(3)" de cards de cada coluna. */
  semContagem?: boolean;
}) {
  const { quadros, quadro, carregando, quadroSumiu, colunaSumiu } = useEscolhaDeColuna(
    boardId,
    columnId,
    sumiu,
  );
  const colunas = quadro?.columns.filter((c) => c.id === columnId || !excluir.includes(c.id));

  return (
    <>
      {!quadroFixo && (
        <label className="block min-w-0">
          <span className="text-miudo text-ink-400">Quadro</span>
          <select
            value={boardId}
            onChange={(e) => onMudar({ boardId: e.target.value, columnId: "" })}
            aria-label={rotuloQuadro}
            aria-invalid={quadroSumiu || undefined}
            className={`mt-0.5 ${CLASSE_CAMPO}`}
          >
            <option value="">Escolha…</option>
            {quadroSumiu && <option value={boardId}>(quadro excluído)</option>}
            {quadros?.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name} · {q.workspaceName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block min-w-0">
        <span className="text-miudo text-ink-400">Coluna</span>
        <select
          value={columnId}
          onChange={(e) => onMudar({ boardId, columnId: e.target.value })}
          disabled={!boardId || carregando}
          aria-label={rotuloColuna}
          aria-invalid={colunaSumiu || undefined}
          className={`mt-0.5 ${CLASSE_CAMPO}`}
        >
          <option value="">{carregando ? "Carregando…" : "Escolha…"}</option>
          {colunaSumiu && columnId && <option value={columnId}>(coluna excluída)</option>}
          {colunas?.map((c) => (
            <option key={c.id} value={c.id}>
              {semContagem ? c.name : `${c.name} (${c.cards.length})`}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * Uma fonte viva: quadro, coluna, quantos cards e com que detalhe. A coluna
 * vem do quadro escolhido (`useBoard`), por isso a linha é um componente: cada
 * uma consulta o seu quadro.
 */
export function LinhaFonte({
  fonte,
  indice,
  onMudar,
  onRemover,
}: {
  fonte: FonteRascunho;
  indice: number;
  onMudar: (f: FonteRascunho) => void;
  onRemover: () => void;
}) {
  const { quadroSumiu, colunaSumiu } = useEscolhaDeColuna(
    fonte.boardId,
    fonte.columnId,
    fonte.sumiu,
  );
  const id = useId();
  const n = indice + 1;

  return (
    <li className="rounded-controle border border-ink-800 bg-ink-900/40 p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <SeletorColuna
          boardId={fonte.boardId}
          columnId={fonte.columnId}
          sumiu={fonte.sumiu}
          onMudar={(escolha) => onMudar({ ...fonte, ...escolha, sumiu: false })}
          rotuloQuadro={`Quadro da fonte ${n}`}
          rotuloColuna={`Coluna da fonte ${n}`}
        />
        <BotaoIcone
          rotulo={`Remover a fonte ${n}`}
          icone={<IconeFechar className="size-3.5" />}
          onClick={onRemover}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-xs text-ink-400">
          Até
          <input
            type="number"
            min={1}
            max={MAX_LIMITE_FONTE_VIVA}
            value={fonte.limite}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              onMudar({
                ...fonte,
                limite: Number.isFinite(v) ? Math.min(Math.max(v, 1), MAX_LIMITE_FONTE_VIVA) : 1,
              });
            }}
            aria-label={`Quantos cards ler da fonte ${n}, de 1 a ${MAX_LIMITE_FONTE_VIVA}`}
            className="h-7 w-16 rounded-controle border border-ink-700 bg-ink-900 px-2 text-xs
                       tabular-nums text-ink-200 outline-none focus:border-accent-400"
          />
          cards, os do topo da coluna
        </label>
        <fieldset className="flex items-center gap-1 text-xs">
          <legend className="sr-only">Detalhe da fonte {n}</legend>
          {LIVE_SOURCE_DETAILS.map((valor) => (
            <label
              key={valor}
              className={`cursor-pointer rounded-etiqueta border px-2 py-0.5 transition-colors
                          has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2
                          has-[:focus-visible]:outline-accent-400 ${
                            fonte.detalhe === valor
                              ? "border-accent-500/50 bg-accent-500/10 text-accent-400"
                              : "border-ink-700 text-ink-400 hover:text-ink-200"
                          }`}
            >
              <input
                type="radio"
                name={`${id}-detalhe`}
                value={valor}
                checked={fonte.detalhe === valor}
                onChange={() => onMudar({ ...fonte, detalhe: valor })}
                className="sr-only"
              />
              {fonte.detalhe === valor && <span aria-hidden="true">● </span>}
              {ROTULO_DETALHE[valor]}
            </label>
          ))}
        </fieldset>
      </div>

      {(quadroSumiu || colunaSumiu) && (
        <Aviso tom="alerta" className="mt-2">
          {quadroSumiu ? "O quadro" : "A coluna"} desta fonte não existe mais — escolha outra
          ou remova a fonte. Até lá, ela fica fora do contexto.
        </Aviso>
      )}
    </li>
  );
}

/**
 * O modelo do agente: o do chat, ou um favorito. Os favoritos em `CartaoModelo`,
 * o mesmo desenho do quadro de modelos, numa lista de rádio.
 *
 * O servidor confere o favorito **na hora do uso**, não ao salvar: o favorito
 * pode sair depois. Por isso o modelo que sumiu continua escolhido, com o
 * aviso, até alguém trocar — trocar sozinho mudaria o preço sem ninguém ver.
 */
export function EscolhaDeModelo({
  modelId,
  onMudar,
  usaFerramentas,
}: {
  modelId: string | null;
  onMudar: (id: string | null) => void;
  usaFerramentas: boolean;
}) {
  const { data: ajustes, isLoading } = useAiAjustes();
  const grupo = useId();
  const favoritos: AiFavorite[] = ajustes?.favorites ?? [];
  const doChat = ajustes?.taskModels.chat;
  const nomeDoChat = favoritos.find((f) => f.id === doChat)?.name ?? doChat;
  const escolhido = favoritos.find((f) => f.id === modelId);
  const sumiu = Boolean(modelId && ajustes && !escolhido);

  const classeOpcao = `block cursor-pointer rounded-cartao transition
    has-[:checked]:ring-2 has-[:checked]:ring-accent-400
    has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2
    has-[:focus-visible]:outline-accent-400`;

  return (
    <fieldset>
      <legend className="sr-only">Modelo do agente</legend>

      {sumiu && (
        <Aviso tom="alerta" className="mb-3">
          O modelo <code className="font-mono">{modelId}</code> saiu dos favoritos, e o agente não
          responde até você escolher outro — ou favoritá-lo de novo em{" "}
          <Link to="/ajustes/modelos" className="font-medium underline underline-offset-2">
            Ajustes
          </Link>
          .
        </Aviso>
      )}
      {escolhido && usaFerramentas && !escolhido.supportsTools && (
        <Aviso tom="alerta" className="mb-3">
          «{escolhido.name}» não chama ferramentas: com ele, o agente não consulta nem cria nada
          no acervo. Desligue as ferramentas ou escolha outro modelo.
        </Aviso>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
        <label className={classeOpcao}>
          <input
            type="radio"
            name={grupo}
            checked={modelId === null}
            onChange={() => onMudar(null)}
            className="sr-only"
          />
          <div
            className="flex h-full flex-col justify-center rounded-cartao border border-dashed
                       border-ink-700 bg-superficie p-3"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium text-titulo">
              {modelId === null && <IconeCheck className="size-3.5 text-accent-400" />}
              Usar o modelo do chat
            </p>
            <p className="mt-1 text-miudo text-ink-400">
              {doChat
                ? `Hoje: ${nomeDoChat}. Acompanha o que você escolher para o chat.`
                : "Nenhum escolhido ainda para o chat."}
            </p>
          </div>
        </label>

        {isLoading &&
          [0, 1].map((i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-[118px] animate-pulse rounded-cartao border border-ink-800 bg-ink-900"
            />
          ))}

        {favoritos.map((f) => (
          <label key={f.favoriteId} className={classeOpcao}>
            <input
              type="radio"
              name={grupo}
              checked={modelId === f.id}
              onChange={() => onMudar(f.id)}
              className="sr-only"
              aria-label={`${f.name}${f.supportsTools ? ", chama ferramentas" : ""}`}
            />
            <CartaoModelo
              modelo={f}
              destaque={modelId === f.id}
              className="h-full"
              acoes={
                modelId === f.id ? (
                  <IconeCheck className="size-4 text-accent-400" />
                ) : undefined
              }
            />
          </label>
        ))}
      </div>

      {ajustes && favoritos.length === 0 && (
        <p className="mt-2 text-xs text-ink-400">
          Para dar um modelo próprio ao agente, favorite modelos em{" "}
          <Link to="/ajustes/modelos" className="text-accent-400 underline underline-offset-2">
            Ajustes → Modelos
          </Link>
          .
        </p>
      )}
    </fieldset>
  );
}
