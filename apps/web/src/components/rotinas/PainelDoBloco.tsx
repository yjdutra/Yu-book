import {
  FERRAMENTAS_DO_ACERVO,
  MAX_INSTRUCAO_DO_PASSO,
  MAX_PEDIDO_DA_ROTINA,
  MAX_TITULO_FIXO_DA_ROTINA,
  ROUTINE_CONSUME_ACTIONS,
  ROUTINE_INPUT_KINDS,
  ROUTINE_OUTPUT_KINDS,
  ROUTINE_OUTPUT_TITLES,
  ROUTINE_STEP_MODES,
  TETO_POR_EXECUCAO_MAXIMO_MICROS,
  microsParaDolares,
} from "@yu-book/shared";
import type {
  RoutineDetail,
  RoutineInputKind,
  RoutineOutputKind,
  RoutineOutputTitle,
} from "@yu-book/shared";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAgente, useAgentes } from "../../lib/agentes";
import { useBoard } from "../../lib/kanban";
import { useWorkspaces } from "../../lib/notas";
import { CLASSE_CAMPO, SeletorColuna, useEscolhaDeColuna } from "../agentes/CamposDoAgente";
import { AvatarAgente } from "../agentes/AvatarAgente";
import { emDolares } from "../ajustes/comum";
import { Aviso } from "../base/Aviso";
import { Etiqueta } from "../base/Etiqueta";
import { Interruptor } from "../base/Interruptor";
import { CampoMarkdown } from "../CampoMarkdown";
import {
  IconeBoard,
  IconeCheck,
  IconeFala,
  IconeLapis,
  IconeNotas,
  IconeRotina,
} from "../Icones";
import { GLIFO_MODO, NUMERO, ROTULO_CONSUMO, ROTULO_MODO } from "./comum";
import type { BlocoEscolhido, PassoRascunho, Rascunho } from "./rascunho";

/**
 * O painel de configuração do bloco escolhido no fluxo. Muda com o bloco:
 * entrada, passo ou saída. Os campos escrevem direto no rascunho — salvar é
 * explícito, no cabeçalho do editor.
 */

/*
 * Os três `Record` são totais (INV-54): tipo novo no enum de `shared` não
 * compila sem rótulo, e os grupos de rádio abaixo o percorrem.
 */

const ROTULO_TITULO: Record<RoutineOutputTitle, { titulo: string; explica: string }> = {
  ideia: {
    titulo: "O título da ideia",
    explica: "A saída leva o mesmo título do card-ideia.",
  },
  primeira_linha: {
    titulo: "A primeira linha do rascunho",
    explica: "Bom quando o último passo escreve um gancho que serve de título.",
  },
  fixo: {
    titulo: "Um título fixo",
    explica: "O mesmo texto em toda execução.",
  },
};

const ROTULO_ENTRADA: Record<RoutineInputKind, { titulo: string; explica: string }> = {
  coluna: {
    titulo: "Coluna de ideias",
    explica: "Cada execução pega a próxima ideia de uma coluna do quadro.",
  },
  pedido: {
    titulo: "Pedido",
    explica: "O que você escrever aqui é a tarefa de cada execução.",
  },
};

const ROTULO_SAIDA: Record<RoutineOutputKind, { titulo: string; explica: string }> = {
  card: {
    titulo: "Card numa coluna",
    explica: "O resultado vira card no fim de uma coluna, de qualquer quadro.",
  },
  nota: {
    titulo: "Nota nova",
    explica: "O resultado vira uma nota, a cada execução uma nova.",
  },
};

/** Uma opção de rádio em cartão, com a explicação que ensina a escolha. */
function Opcao({
  nome,
  marcada,
  onMarcar,
  titulo,
  explica,
  prefixo,
}: {
  nome: string;
  marcada: boolean;
  onMarcar: () => void;
  titulo: ReactNode;
  explica: ReactNode;
  prefixo?: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-controle border p-2.5
                  transition-colors has-[:focus-visible]:outline-2
                  has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-400 ${
                    marcada
                      ? "border-accent-500/60 bg-accent-500/10"
                      : "border-ink-700 hover:border-ink-400"
                  }`}
    >
      <input
        type="radio"
        name={nome}
        checked={marcada}
        onChange={onMarcar}
        className="sr-only"
      />
      {/* O visto marca a escolha além da cor (RNF-09). */}
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
          marcada ? "border-accent-400 bg-accent-500 text-white" : "border-ink-400"
        }`}
      >
        {marcada && <IconeCheck className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink-200">
          {prefixo}
          {titulo}
        </span>
        <span className="mt-0.5 block text-xs text-ink-400">{explica}</span>
      </span>
    </label>
  );
}

function Grupo({ legenda, children }: { legenda: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="rotulo mb-1.5">{legenda}</legend>
      {children}
    </fieldset>
  );
}

function CabecalhoPainel({
  icone,
  titulo,
  descricao,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-ink-800 px-4 py-3">
      <span className="mt-0.5">{icone}</span>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-titulo">{titulo}</h3>
        <p className="mt-0.5 text-xs text-ink-400">{descricao}</p>
      </div>
    </header>
  );
}

function ConfigEntrada({
  rascunho,
  mudar,
  detalhe,
  entradaSalva,
}: {
  rascunho: Rascunho;
  mudar: (p: Partial<Rascunho>) => void;
  detalhe: RoutineDetail | undefined;
  entradaSalva: boolean;
}) {
  const grupoTipo = useId();
  const idExplicaPedido = useId();

  /// Trocar de tipo acerta o que o outro tipo não aceita, em vez de deixar o
  /// problema para o salvar: sem ideia não há título "da ideia" nem ideia a
  /// mover. A coluna escolhida fica no rascunho — voltar para "coluna" a traz.
  function trocarTipo(tipo: RoutineInputKind) {
    if (tipo === rascunho.inputKind) return;
    mudar(
      tipo === "pedido"
        ? {
            inputKind: tipo,
            ...(rascunho.outputTitle === "ideia" && { outputTitle: "primeira_linha" }),
            consumeAction: "manter",
            consumeColumnId: null,
          }
        : { inputKind: tipo },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 p-4">
      <Grupo legenda="De onde vem a tarefa">
        {ROUTINE_INPUT_KINDS.map((k) => (
          <Opcao
            key={k}
            nome={grupoTipo}
            marcada={rascunho.inputKind === k}
            onMarcar={() => trocarTipo(k)}
            prefixo={
              k === "coluna" ? (
                <IconeBoard className="size-3.5 text-ink-400" />
              ) : (
                <IconeFala className="size-3.5 text-ink-400" />
              )
            }
            titulo={ROTULO_ENTRADA[k].titulo}
            explica={ROTULO_ENTRADA[k].explica}
          />
        ))}
      </Grupo>

      {rascunho.inputKind === "coluna" ? (
        <EntradaPorColuna
          rascunho={rascunho}
          mudar={mudar}
          detalhe={detalhe}
          entradaSalva={entradaSalva}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <CampoMarkdown
            titulo="O pedido"
            rotuloCampo="O pedido da rotina"
            valor={rascunho.inputPrompt}
            onMudar={(inputPrompt) => mudar({ inputPrompt })}
            linhas={8}
            maxLength={MAX_PEDIDO_DA_ROTINA}
            descricao={idExplicaPedido}
            placeholder="Monte um resumo da minha semana a partir do painel e dos quadros…"
            extra={
              <span
                className={`text-miudo tabular-nums ${
                  rascunho.inputPrompt.length > MAX_PEDIDO_DA_ROTINA * 0.9
                    ? "text-amber-300"
                    : "text-ink-400"
                }`}
              >
                {NUMERO.format(rascunho.inputPrompt.length)}/
                {NUMERO.format(MAX_PEDIDO_DA_ROTINA)}
              </span>
            }
          />
          <p id={idExplicaPedido} className="text-miudo text-ink-400">
            O pedido é a tarefa de toda execução, igual a cada vez. Cada execução é
            independente: não lembra das anteriores, e rodar de novo faz de novo. Os agentes
            leem o acervo; busca na web e abrir página chegam na Etapa G.
          </p>
        </div>
      )}
    </div>
  );
}

function EntradaPorColuna({
  rascunho,
  mudar,
  detalhe,
  entradaSalva,
}: {
  rascunho: Rascunho;
  mudar: (p: Partial<Rascunho>) => void;
  detalhe: RoutineDetail | undefined;
  entradaSalva: boolean;
}) {
  const { data: quadro } = useBoard(rascunho.inputBoardId || null);
  const { quadroSumiu, colunaSumiu } = useEscolhaDeColuna(
    rascunho.inputBoardId,
    rascunho.inputColumnId,
  );
  const coluna = quadro?.columns.find((c) => c.id === rascunho.inputColumnId);
  const elegiveis = detalhe?.eligibleCount ?? 0;

  return (
    <>
      <div className="grid gap-2">
        <SeletorColuna
          boardId={rascunho.inputBoardId}
          columnId={rascunho.inputColumnId}
          onMudar={({ boardId, columnId }) =>
            mudar({
              inputBoardId: boardId,
              inputColumnId: columnId,
              // A coluna das ideias usadas precisa ser do mesmo quadro: trocar o
              // quadro a apaga, em vez de deixá-la apontando para o outro.
              ...(boardId !== rascunho.inputBoardId && { consumeColumnId: null }),
            })
          }
          rotuloQuadro="Quadro de entrada"
          rotuloColuna="Coluna de entrada"
        />
      </div>
      {(quadroSumiu || colunaSumiu) && (
        <Aviso tom="alerta">
          {quadroSumiu ? "O quadro" : "A coluna"} de entrada não existe mais — escolha outra.
        </Aviso>
      )}

      <div className="rounded-controle border border-ink-800 bg-ink-900/40 p-3">
        <p className="rotulo">Próxima ideia</p>
        {entradaSalva && detalhe ? (
          detalhe.nextIdea ? (
            <>
              <p className="mt-1 text-sm text-ink-200">«{detalhe.nextIdea.title}»</p>
              <p className="mt-0.5 text-miudo text-ink-400">
                {elegiveis === 1
                  ? "É a única ideia elegível."
                  : `${NUMERO.format(elegiveis)} ideias elegíveis na fila.`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-ink-400">
              Nenhuma ideia elegível: a coluna está vazia, ou todas já passaram por esta
              rotina.
            </p>
          )
        ) : (
          <p className="mt-1 text-xs text-ink-400">
            {coluna
              ? `${NUMERO.format(coluna.cards.length)} ${
                  coluna.cards.length === 1 ? "card" : "cards"
                } na coluna. Salve para ver qual ideia vem a seguir.`
              : "Escolha a coluna para ver a fila."}
          </p>
        )}
      </div>

      <p className="text-xs text-ink-400">
        A rotina pega o primeiro card da coluna que ela ainda não usou com sucesso. Se a
        execução falhar ou for cancelada, a mesma ideia volta na próxima.
      </p>
    </>
  );
}

function ConfigPasso({
  passo,
  posicao,
  mudarPasso,
  porColuna,
}: {
  passo: PassoRascunho;
  posicao: number;
  mudarPasso: (p: Partial<PassoRascunho>) => void;
  porColuna: boolean;
}) {
  const { data: agentes, isLoading } = useAgentes();
  const { data: agente } = useAgente(passo.agentId);
  const grupoAgente = useId();
  const grupoModo = useId();
  const excluido = Boolean(
    agentes && (!passo.agentId || !agentes.some((a) => a.id === passo.agentId)),
  );

  return (
    <div className="grid grid-cols-1 gap-5 p-4">
      <fieldset className="min-w-0">
        <legend className="rotulo mb-1.5">Agente</legend>
        {excluido && passo.agentName && !passo.sugestao && (
          <Aviso tom="alerta" className="mb-2">
            O agente «{passo.agentName}» foi excluído. Escolha outro para este passo.
          </Aviso>
        )}
        {!passo.agentId && passo.sugestao && (
          <Aviso tom="info" className="mb-2">
            O modelo pede «{passo.sugestao.nome}», e ele ainda não existe entre os seus agentes.
            Escolha outro abaixo, ou{" "}
            <Link
              to={`/assistente/agentes/novo?modelo=${passo.sugestao.chave}`}
              className="font-medium underline underline-offset-2"
            >
              crie-o a partir do modelo de agente
            </Link>{" "}
            — sair daqui pede para salvar ou descartar esta rotina.
          </Aviso>
        )}
        {isLoading && (
          <div aria-hidden="true" className="grid gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-controle bg-ink-800/60" />
            ))}
          </div>
        )}
        {agentes && agentes.length === 0 && (
          <div
            className="rounded-controle border border-dashed border-ink-700 p-3 text-xs
                       text-ink-400"
          >
            Nenhum agente ainda. Uma rotina encadeia agentes — crie o primeiro em{" "}
            <Link
              to="/assistente/agentes/novo"
              className="text-accent-400 underline underline-offset-2"
            >
              Novo agente
            </Link>
            .
          </div>
        )}
        <div className="grid max-h-64 gap-1.5 overflow-y-auto pr-0.5">
          {agentes?.map((a) => {
            const marcado = a.id === passo.agentId;
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-controle border px-2.5
                            py-2 transition-colors has-[:focus-visible]:outline-2
                            has-[:focus-visible]:outline-offset-2
                            has-[:focus-visible]:outline-accent-400 ${
                              marcado
                                ? "border-accent-500/60 bg-accent-500/10"
                                : "border-ink-700 hover:border-ink-400"
                            }`}
              >
                <input
                  type="radio"
                  name={grupoAgente}
                  checked={marcado}
                  onChange={() =>
                    mudarPasso({ agentId: a.id, agentName: a.name, agentColor: a.color })
                  }
                  className="sr-only"
                />
                <AvatarAgente nome={a.name} cor={a.color} tamanho="m" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-200">{a.name}</span>
                  {a.description && (
                    <span className="block truncate text-miudo text-ink-400">
                      {a.description}
                    </span>
                  )}
                </span>
                {marcado && <IconeCheck className="size-3.5 text-accent-400" />}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Grupo legenda="O que este passo faz">
        {ROUTINE_STEP_MODES.map((m) => (
          <Opcao
            key={m}
            nome={grupoModo}
            marcada={passo.mode === m}
            onMarcar={() => mudarPasso({ mode: m })}
            prefixo={<span aria-hidden="true">{GLIFO_MODO[m]}</span>}
            titulo={m === "reescreve" ? "Reescreve" : "Revisa"}
            explica={ROTULO_MODO[m].explica}
          />
        ))}
      </Grupo>

      <CampoMarkdown
        titulo="Instrução deste passo"
        rotuloCampo={`Instrução do passo ${posicao + 1}`}
        valor={passo.instruction}
        onMudar={(instruction) => mudarPasso({ instruction })}
        linhas={8}
        maxLength={MAX_INSTRUCAO_DO_PASSO}
        placeholder={
          passo.mode === "reescreve"
            ? `Escreva o primeiro rascunho a partir ${porColuna ? "da ideia" : "do pedido"}…`
            : "Aponte, em lista, o que corrigir — sem reescrever…"
        }
        extra={
          <span
            className={`text-miudo tabular-nums ${
              passo.instruction.length > MAX_INSTRUCAO_DO_PASSO * 0.9
                ? "text-amber-300"
                : "text-ink-400"
            }`}
          >
            {NUMERO.format(passo.instruction.length)}/{NUMERO.format(MAX_INSTRUCAO_DO_PASSO)}
          </span>
        }
      />
      <p className="-mt-3 text-miudo text-ink-400">
        Vai junto {porColuna ? "da ideia" : "do pedido"}, do rascunho atual e das observações
        dos passos anteriores. As premissas do agente valem por cima.
      </p>

      {passo.agentId && agente && (
        <div>
          <p className="rotulo mb-1.5">Ferramentas do agente</p>
          {agente.tools.length === 0 ? (
            <p className="text-xs text-ink-400">
              Nenhuma — o agente responde só com o contexto.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1" aria-label="Ferramentas do agente">
              {agente.tools.map((t) => {
                const f = FERRAMENTAS_DO_ACERVO[t];
                return (
                  <li key={t}>
                    {f.escrita ? (
                      <Etiqueta
                        icone={<IconeLapis className="size-3" />}
                        titulo="Fora na rotina: quem escreve no acervo é a rotina, na saída"
                      >
                        <span className="line-through">{f.titulo}</span>
                        <span className="sr-only">, desligada na rotina</span>
                      </Etiqueta>
                    ) : (
                      <Etiqueta tom="destaque">{f.titulo}</Etiqueta>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1.5 text-miudo text-ink-400">
            Só para ler: na rotina, valem apenas as ferramentas de leitura. O card ou a nota
            sai pelo código, no bloco de saída — o agente não cria nada.{" "}
            <Link
              to={`/assistente/agentes/${passo.agentId}`}
              className="text-accent-400 underline underline-offset-2"
            >
              Editar o agente
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * O teto por execução, em dólares na tela e em micro-dólares no rascunho. O
 * texto é local: com o número derivado a cada tecla, "0," viraria "0" antes de
 * a pessoa terminar de digitar.
 */
function CampoTeto({
  micros,
  onMudar,
  porColuna,
}: {
  micros: number;
  onMudar: (micros: number) => void;
  porColuna: boolean;
}) {
  const id = useId();
  const [texto, setTexto] = useState(() => String(microsParaDolares(micros)));
  // Descartar ou salvar troca o valor por fora: o texto acompanha.
  useEffect(() => {
    const atual = Math.round(Number(texto.replace(",", ".")) * 1_000_000);
    if (atual !== micros) setTexto(String(microsParaDolares(micros)));
    // Só quando o valor de fora muda; o texto é quem o muda por dentro.
  }, [micros]);

  return (
    <div>
      <label htmlFor={id} className="rotulo">
        Teto por execução
      </label>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-ink-400">US$</span>
        <input
          id={id}
          inputMode="decimal"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            const v = Number(e.target.value.replace(",", "."));
            onMudar(Number.isFinite(v) ? Math.round(v * 1_000_000) : 0);
          }}
          aria-describedby={`${id}-ajuda`}
          className="h-8 w-28 rounded-controle border border-ink-700 bg-ink-900 px-2.5 text-sm
                     tabular-nums text-ink-200 outline-none focus:border-accent-400"
        />
      </div>
      <p id={`${id}-ajuda`} className="mt-1 text-miudo text-ink-400">
        Antes de cada chamada ao provedor, o gasto da execução mais a próxima chamada é
        conferido contra este teto — e contra o do dia. Estourou, a execução para
        {porColuna ? ", e a ideia fica onde está" : " sem deixar nada"}. Máximo{" "}
        {emDolares(TETO_POR_EXECUCAO_MAXIMO_MICROS)}.
      </p>
    </div>
  );
}

function ConfigSaida({
  rascunho,
  mudar,
}: {
  rascunho: Rascunho;
  mudar: (p: Partial<Rascunho>) => void;
}) {
  const grupoTipo = useId();
  const grupoTitulo = useId();
  const grupoConsumo = useId();
  const idTituloFixo = useId();
  const idWorkspace = useId();
  const saida = useEscolhaDeColuna(rascunho.outputBoardId, rascunho.outputColumnId);
  const consumida = useEscolhaDeColuna(rascunho.inputBoardId, rascunho.consumeColumnId ?? "");
  const { data: workspaces } = useWorkspaces();
  const temRevisa = rascunho.passos.some((p) => p.mode === "revisa");
  const porColuna = rascunho.inputKind === "coluna";
  const nota = rascunho.outputKind === "nota";
  const workspaceSumiu = Boolean(
    rascunho.outputWorkspaceId &&
      workspaces &&
      !workspaces.some((w) => w.id === rascunho.outputWorkspaceId),
  );
  /// Sem ideia não há título dela: a opção nem aparece no pedido.
  const titulos = ROUTINE_OUTPUT_TITLES.filter((t) => t !== "ideia" || porColuna);

  return (
    <div className="grid grid-cols-1 gap-5 p-4">
      <Grupo legenda="O que a execução deixa">
        {ROUTINE_OUTPUT_KINDS.map((k) => (
          <Opcao
            key={k}
            nome={grupoTipo}
            marcada={rascunho.outputKind === k}
            onMarcar={() => mudar({ outputKind: k })}
            prefixo={
              k === "card" ? (
                <IconeBoard className="size-3.5 text-ink-400" />
              ) : (
                <IconeNotas className="size-3.5 text-ink-400" />
              )
            }
            titulo={ROTULO_SAIDA[k].titulo}
            explica={ROTULO_SAIDA[k].explica}
          />
        ))}
      </Grupo>

      {nota ? (
        <div>
          <label htmlFor={idWorkspace} className="rotulo">
            Workspace da nota
          </label>
          <select
            id={idWorkspace}
            value={rascunho.outputWorkspaceId ?? ""}
            onChange={(e) => mudar({ outputWorkspaceId: e.target.value || null })}
            aria-invalid={workspaceSumiu || undefined}
            className={`mt-1 ${CLASSE_CAMPO}`}
          >
            <option value="">Sem workspace</option>
            {workspaceSumiu && rascunho.outputWorkspaceId && (
              <option value={rascunho.outputWorkspaceId}>(workspace excluído)</option>
            )}
            {workspaces?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {workspaceSumiu && (
            <Aviso tom="alerta" className="mt-2">
              O workspace da nota não existe mais — escolha outro, ou nenhum.
            </Aviso>
          )}
          <p className="mt-1.5 text-miudo text-ink-400">
            A nota nasce marcada como gerada por IA, com a rotina que a escreveu.
          </p>
        </div>
      ) : (
        <div>
          <p className="rotulo mb-1.5">Onde o card nasce</p>
          <div className="grid gap-2">
            <SeletorColuna
              boardId={rascunho.outputBoardId}
              columnId={rascunho.outputColumnId}
              onMudar={({ boardId, columnId }) =>
                mudar({ outputBoardId: boardId, outputColumnId: columnId })
              }
              rotuloQuadro="Quadro de saída"
              rotuloColuna="Coluna de saída"
            />
          </div>
          {(saida.quadroSumiu || saida.colunaSumiu) && (
            <Aviso tom="alerta" className="mt-2">
              {saida.quadroSumiu ? "O quadro" : "A coluna"} de saída não existe mais — escolha
              outra.
            </Aviso>
          )}
          <p className="mt-1.5 text-miudo text-ink-400">
            De qualquer quadro. O card entra no fim da coluna, marcado como gerado por IA.
          </p>
        </div>
      )}

      <Grupo legenda={nota ? "Título da nota" : "Título do card"}>
        {titulos.map((t) => (
          <Opcao
            key={t}
            nome={grupoTitulo}
            marcada={rascunho.outputTitle === t}
            onMarcar={() => mudar({ outputTitle: t })}
            titulo={ROTULO_TITULO[t].titulo}
            explica={ROTULO_TITULO[t].explica}
          />
        ))}
        {rascunho.outputTitle === "fixo" && (
          <div className="rounded-controle border border-ink-800 bg-ink-900/40 p-2.5">
            <label htmlFor={idTituloFixo} className="flex items-baseline justify-between">
              <span className="text-miudo text-ink-400">Título fixo</span>
              <span className="text-miudo tabular-nums text-ink-400">
                {rascunho.outputTitleText.length}/{MAX_TITULO_FIXO_DA_ROTINA}
              </span>
            </label>
            <input
              id={idTituloFixo}
              value={rascunho.outputTitleText}
              onChange={(e) => mudar({ outputTitleText: e.target.value })}
              maxLength={MAX_TITULO_FIXO_DA_ROTINA}
              placeholder={nota ? "Resumo da semana" : "Post da semana"}
              className={`mt-0.5 ${CLASSE_CAMPO}`}
            />
          </div>
        )}
        {nota && (
          <p className="text-miudo text-ink-400">
            Título de nota não se repete: se já houver uma nota com ele, a nova ganha a data e a
            hora no fim.
          </p>
        )}
      </Grupo>

      <Interruptor
        ligado={rascunho.includeNotes}
        onMudar={(includeNotes) => mudar({ includeNotes })}
        rotulo="Incluir Observações"
        descricao={
          temRevisa
            ? `Acrescenta ${nota ? "à nota" : "ao card"} uma seção com o que os passos que ` +
              "revisam apontaram."
            : `Acrescenta ${nota ? "à nota" : "ao card"} o que os passos que revisam ` +
              "apontarem — nenhum passo revisa ainda."
        }
      />

      {/* Só há ideia a mover ou arquivar quando a rotina parte de uma coluna. */}
      {porColuna && (
        <Grupo legenda="A ideia usada">
          {ROUTINE_CONSUME_ACTIONS.map((a) => (
            <Opcao
              key={a}
              nome={grupoConsumo}
              marcada={rascunho.consumeAction === a}
              onMarcar={() => mudar({ consumeAction: a })}
              titulo={ROTULO_CONSUMO[a].titulo}
              explica={ROTULO_CONSUMO[a].explica}
            />
          ))}
          {rascunho.consumeAction === "mover" &&
            (rascunho.inputBoardId ? (
              <div className="rounded-controle border border-ink-800 bg-ink-900/40 p-2.5">
                <SeletorColuna
                  quadroFixo
                  boardId={rascunho.inputBoardId}
                  columnId={rascunho.consumeColumnId ?? ""}
                  excluir={[rascunho.inputColumnId]}
                  onMudar={({ columnId }) => mudar({ consumeColumnId: columnId || null })}
                  rotuloQuadro="Quadro das ideias usadas"
                  rotuloColuna="Coluna das ideias usadas"
                />
                <p className="mt-1.5 text-miudo text-ink-400">
                  Só colunas do quadro da entrada: card não muda de quadro.
                </p>
                {consumida.colunaSumiu && (
                  <Aviso tom="alerta" className="mt-2">
                    A coluna das ideias usadas não existe mais — escolha outra.
                  </Aviso>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-400">
                Escolha primeiro a coluna de entrada: a das ideias usadas é do mesmo quadro.
              </p>
            ))}
        </Grupo>
      )}

      <CampoTeto
        micros={rascunho.runCapMicros}
        onMudar={(runCapMicros) => mudar({ runCapMicros })}
        porColuna={porColuna}
      />
    </div>
  );
}

export function PainelDoBloco({
  escolhido,
  rascunho,
  mudar,
  mudarPasso,
  detalhe,
  entradaSalva,
}: {
  escolhido: BlocoEscolhido;
  rascunho: Rascunho;
  mudar: (p: Partial<Rascunho>) => void;
  mudarPasso: (chave: string, p: Partial<PassoRascunho>) => void;
  detalhe: RoutineDetail | undefined;
  /// A entrada do rascunho é a que está salva — a prévia da próxima ideia vale.
  entradaSalva: boolean;
}) {
  const posicao =
    escolhido.tipo === "passo"
      ? rascunho.passos.findIndex((p) => p.chave === escolhido.chave)
      : -1;
  const passo = rascunho.passos[posicao];

  return (
    <section
      aria-label="Configuração do bloco"
      // A chave troca a animação a cada bloco: a troca de conteúdo se vê.
      key={escolhido.tipo === "passo" ? escolhido.chave : escolhido.tipo}
      className="relative animate-surgir rounded-cartao border border-ink-800 bg-superficie
                 shadow-e1"
    >
      {/* A linha vai de ponta a ponta, como em `Bloco`, mas quem a recorta pela curva do cartão é
          esta moldura, não um `overflow-hidden` no cartão: o que se abrir para fora do painel,
          ou o contorno de foco rente à borda, não é cortado. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-cartao"
      >
        <span className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500" />
      </span>
      {escolhido.tipo === "entrada" && (
        <>
          <CabecalhoPainel
            icone={
              rascunho.inputKind === "coluna" ? (
                <IconeBoard className="size-4 text-accent-400" />
              ) : (
                <IconeFala className="size-4 text-accent-400" />
              )
            }
            titulo="Entrada"
            descricao="De onde vem a tarefa de cada execução."
          />
          <ConfigEntrada
            rascunho={rascunho}
            mudar={mudar}
            detalhe={detalhe}
            entradaSalva={entradaSalva}
          />
        </>
      )}
      {escolhido.tipo === "passo" && passo && (
        <>
          <CabecalhoPainel
            icone={
              <AvatarAgente
                nome={passo.agentName || "?"}
                cor={passo.agentColor ?? "cinza"}
                excluido={!passo.agentId}
              />
            }
            titulo={`Passo ${posicao + 1}${passo.agentName ? ` · ${passo.agentName}` : ""}`}
            descricao="Quem escreve, o que faz com o rascunho e o que recebe de instrução."
          />
          <ConfigPasso
            passo={passo}
            posicao={posicao}
            mudarPasso={(p) => mudarPasso(passo.chave, p)}
            porColuna={rascunho.inputKind === "coluna"}
          />
        </>
      )}
      {escolhido.tipo === "saida" && (
        <>
          <CabecalhoPainel
            icone={<IconeRotina className="size-4 text-accent-400" />}
            titulo="Saída"
            descricao={
              rascunho.inputKind === "coluna"
                ? "O que a execução deixa, e o que acontece com a ideia."
                : "O que a execução deixa."
            }
          />
          <ConfigSaida rascunho={rascunho} mudar={mudar} />
        </>
      )}
    </section>
  );
}
