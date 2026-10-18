import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { juntarDitado, useDitado } from "@yu-book/cliente/ditado";
import { useResumoRitmo } from "@yu-book/cliente/habitos";
import { useGravarHumor, useHumor } from "@yu-book/cliente/humor";
import { IconeFechar, IconeMais, IconeMicrofone } from "@yu-book/cliente/icones";
import { RostoHumor, SeletorHumor } from "@yu-book/cliente/ritmo/RostoHumor";
import {
  MAX_HUMOR_NOTA,
  MOMENTOS_DO_HUMOR,
  NOMES_DO_HUMOR,
  NOMES_DOS_MOMENTOS,
} from "@yu-book/shared";
import type { MomentoDoHumor, MoodDayItem } from "@yu-book/shared";
import { useCallback, useId, useState } from "react";
import type { FormEvent } from "react";
import { useFolhaNoHistorico } from "../../lib/historico";
import { Alca } from "../Alca";

const PERGUNTAS: Record<MomentoDoHumor, string> = {
  morning: "Como você começou o dia?",
  midday: "E durante o dia?",
  evening: "Como você está terminando o dia?",
};

/**
 * "Como você está?" no Início (frente Ritmo, RF-44): os três momentos do dia
 * de hoje — o do usuário, da API (RN-17). Tocar abre a folha do momento.
 * Humor não dá pontos (RN-26), e a folha diz isso.
 */
export function HumorDoInicio() {
  const resumo = useResumoRitmo();
  const hoje = resumo.data?.today ?? null;
  const humor = useHumor(hoje, hoje);
  const [momento, setMomento] = useState<MomentoDoHumor | null>(null);
  const fechar = useCallback(() => setMomento(null), []);
  const idTitulo = useId();
  useFolhaNoHistorico(momento !== null, fechar);

  if (!hoje || !humor.data) return null;
  const dia = humor.data[0] ?? null;

  return (
    <section
      aria-labelledby={idTitulo}
      className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={idTitulo} className="text-base font-bold text-titulo">
          Como você está?
        </h2>
        <span className="rounded-full bg-ink-800 px-2.5 py-0.5 text-xs font-semibold text-ink-400">
          3 momentos
        </span>
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {MOMENTOS_DO_HUMOR.map((m) => {
          const valor = dia?.[m] ?? null;
          const nome = NOMES_DOS_MOMENTOS[m];
          return (
            <li key={m}>
              <button
                type="button"
                onClick={() => setMomento(m)}
                aria-haspopup="dialog"
                aria-label={`${nome}: ${valor ? NOMES_DO_HUMOR[valor - 1] : "registrar"}`}
                className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5
                           rounded-cartao py-2 transition-colors hover:bg-ink-800"
              >
                {valor ? (
                  <RostoHumor valor={valor} className="size-10" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-10 place-items-center rounded-full border-2 border-dashed
                               border-accent-400 text-accent-400"
                  >
                    <IconeMais className="size-5" />
                  </span>
                )}
                <span className="text-xs font-semibold text-ink-200">{nome}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Dialogo
        aberto={momento !== null}
        onFechar={fechar}
        rotulo={momento ? PERGUNTAS[momento] : "Humor"}
        posicao="folha"
        largura="max-w-lg"
      >
        {momento && <FolhaHumor momento={momento} dia={dia} onFechar={fechar} />}
      </Dialogo>
    </section>
  );
}

/**
 * A folha de um momento (RF-44): as cinco caras, a descrição do dia e o botão
 * de ditar — que só preenche o campo, nunca grava (`useDitado`). Salvar manda o
 * momento e, se mudou, a descrição.
 */
function FolhaHumor({
  momento,
  dia,
  onFechar,
}: {
  momento: MomentoDoHumor;
  dia: MoodDayItem | null;
  onFechar: () => void;
}) {
  const [escolha, setEscolha] = useState<number | null>(dia?.[momento] ?? null);
  const [nota, setNota] = useState(dia?.note ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useGravarHumor();
  const idNota = useId();
  const ditado = useDitado({
    aoFinal: (texto) => setNota((atual) => juntarDitado(atual, texto)),
  });

  function salvar(ev: FormEvent) {
    ev.preventDefault();
    if (escolha === null) return;
    ditado.cancelar();
    setErro(null);
    const notaMudou = nota.trim() !== (dia?.note ?? "");
    gravar
      .mutateAsync({ [momento]: escolha, ...(notaMudou && { note: nota.trim() || null }) })
      .then(onFechar)
      .catch(() => setErro("Não deu para salvar. Confira a conexão e tente de novo."));
  }

  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-4 px-5 pb-5 pt-3">
      <Alca />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-titulo">{PERGUNTAS[momento]}</h2>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="grid size-11 place-items-center rounded-full text-ink-400 hover:bg-ink-800"
        >
          <IconeFechar className="size-5" />
        </button>
      </div>
      <SeletorHumor valor={escolha} onEscolher={setEscolha} rotulo={NOMES_DOS_MOMENTOS[momento]} />
      <div>
        <label htmlFor={idNota} className="rotulo">
          Como foi o dia
        </label>
        <div className="mt-1.5 flex items-stretch gap-2">
          <textarea
            id={idNota}
            rows={3}
            maxLength={MAX_HUMOR_NOTA}
            value={juntarDitado(nota, ditado.parcial)}
            onChange={(e) => setNota(e.target.value)}
            readOnly={ditado.ouvindo}
            placeholder="Fale ou escreva…"
            className="min-w-0 flex-1 resize-none rounded-cartao border border-ink-700 bg-ink-900
                       px-3 py-2 text-sm text-ink-200 placeholder:text-ink-400"
          />
          {ditado.suportado && (
            <button
              type="button"
              onClick={ditado.ouvindo ? ditado.parar : ditado.iniciar}
              aria-pressed={ditado.ouvindo}
              aria-label={ditado.ouvindo ? "Parar de ditar" : "Ditar a descrição"}
              className={`grid w-13 shrink-0 place-items-center rounded-cartao ${
                ditado.ouvindo
                  ? "bg-accent-500 text-white"
                  : "bg-accent-500/15 text-accent-400"
              }`}
            >
              <IconeMicrofone className="size-5" />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-miudo text-ink-400">
          O ditado só preenche o campo. Humor não vale pontos — vale honestidade.
        </p>
        {ditado.erro && (
          <Aviso tom="alerta" onFechar={ditado.limparErro} className="mt-2">
            {ditado.erro}
          </Aviso>
        )}
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <Botao
        type="submit"
        variante="primario"
        tamanho="g"
        carregando={gravar.isPending}
        disabled={escolha === null}
        className="w-full"
      >
        Salvar
      </Botao>
    </form>
  );
}
