import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { IconeAssistente, IconeRitmo } from "@yu-book/cliente/icones";
import { BarraXp } from "@yu-book/cliente/ritmo/Nivel";
import { EmblemaSkill } from "@yu-book/cliente/ritmo/EmblemaSkill";
import { useSkills, useUsarSkill } from "@yu-book/cliente/skills";
import { NIVEIS_DA_SKILL } from "@yu-book/shared";
import type { SkillItem } from "@yu-book/shared";
import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EstadoVazio } from "../agenda/ItemAgenda";
import { useRitmo } from "./Ritmo";

/** "14 usos para Prata", "nível máximo". */
function proximoPasso(skill: SkillItem): string {
  const { next, nextName } = skill.level;
  return next === null ? "nível máximo" : `${next - skill.uses} para ${nextName}`;
}

/**
 * Ritmo › Skills (frente Ritmo, RF-52): a skill escolhida em destaque, com
 * "Usei agora"; o arsenal; e a legenda dos níveis. A escolha mora na URL
 * (`?skill=<id>`), para a skill do dia do Início abrir direto nela.
 */
export function AbaSkills() {
  const skills = useSkills();
  const usar = useUsarSkill();
  const { avisar, celebrar } = useRitmo();
  const [params, setParams] = useSearchParams();
  const [erro, setErro] = useState<string | null>(null);
  const idArsenal = useId();

  if (skills.isError) {
    return (
      <Aviso tom="erro">
        Não deu para carregar as skills.{" "}
        <button type="button" className="underline" onClick={() => void skills.refetch()}>
          Tentar de novo
        </button>
      </Aviso>
    );
  }
  if (skills.isPending) {
    return <div aria-hidden="true" className="h-96 animate-pulse rounded-dialogo bg-ink-900" />;
  }
  const lista = skills.data;
  if (lista.length === 0) {
    return (
      <EstadoVazio
        Icone={IconeRitmo}
        tom="[--tom:var(--color-nivel-mestre)]"
        titulo="Nenhuma skill ainda"
        texto={
          "Skills são modos de agir que você quer internalizar. Peça pelo MCP: " +
          "“crie a skill Pausa tática”."
        }
        acao={
          <Link
            to="/assistente/nova"
            className="inline-flex min-h-11 items-center gap-2 rounded-controle bg-ink-800 px-4
                       text-sm font-semibold text-titulo"
          >
            <IconeAssistente className="size-4" />
            Abrir o assistente
          </Link>
        }
      />
    );
  }
  const escolhida = lista.find((s) => s.id === params.get("skill")) ?? lista[0];
  if (!escolhida) return null;
  const totalDeUsos = lista.reduce((soma, s) => soma + s.uses, 0);
  const { level } = escolhida;
  const fracao =
    level.next === null ? 1 : (escolhida.uses - level.from) / Math.max(1, level.next - level.from);

  function escolher(id: string) {
    setErro(null);
    setParams(
      (atual) => {
        const novos = new URLSearchParams(atual);
        novos.set("skill", id);
        return novos;
      },
      { replace: true },
    );
  }

  function usarAgora(skill: SkillItem) {
    setErro(null);
    usar
      .mutateAsync(skill.id)
      .then(({ skill: depois, levelUp }) => {
        if (levelUp) {
          celebrar({
            rotulo: "Nível novo",
            titulo: `${depois.name} agora é ${levelUp.name}`,
            detalhe:
              `${depois.uses} vezes você escolheu agir assim. ` +
              "Isso já é parte de quem você é.",
            emblema: <EmblemaSkill emblema={depois.emblem} nivel={levelUp.key} tamanho="g" />,
          });
          return;
        }
        avisar({
          ganho: "+1",
          titulo: `${depois.name} usada`,
          detalhe:
            depois.level.next === null
              ? `${depois.uses} usos · Mestre`
              : `${proximoPasso(depois)} · ${depois.uses} usos`,
        });
      })
      .catch(() => setErro("Não deu para registrar o uso. Confira a conexão e tente de novo."));
  }

  return (
    <div className="space-y-4">
      <section
        aria-label={`${escolhida.name}, ${level.name}`}
        className="flex flex-col items-center gap-3 rounded-dialogo border border-ink-800/70
                   bg-superficie px-4 pb-4 pt-5 text-center shadow-e1"
      >
        <EmblemaSkill emblema={escolhida.emblem} nivel={level.key} tamanho="g" />
        <div className="flex flex-col items-center gap-1">
          <p className="rotulo text-ink-200">{level.name}</p>
          <h2 className="text-2xl font-extrabold tracking-tight text-titulo">{escolhida.name}</h2>
          {escolhida.description && (
            <p className="max-w-xs text-sm text-ink-200">{escolhida.description}</p>
          )}
        </div>
        {escolhida.whenToUse && (
          <div className="w-full rounded-cartao bg-ink-900 px-3.5 py-3 text-left">
            <p className="rotulo text-accent-400">Quando usar</p>
            <p className="mt-0.5 text-sm text-ink-200">{escolhida.whenToUse}</p>
          </div>
        )}
        <div className="w-full">
          <div className="flex justify-between text-miudo text-ink-400">
            <span className="tabular-nums">
              {escolhida.uses} {escolhida.uses === 1 ? "uso" : "usos"}
              {escolhida.usesToday > 0 ? ` · ${escolhida.usesToday} hoje` : ""}
            </span>
            <span>{proximoPasso(escolhida)}</span>
          </div>
          <div className="mt-1.5">
            <BarraXp fracao={fracao} />
          </div>
        </div>
        {erro && (
          <Aviso tom="erro" className="w-full text-left">
            {erro}
          </Aviso>
        )}
        <Botao
          variante="primario"
          tamanho="g"
          carregando={usar.isPending}
          onClick={() => usarAgora(escolhida)}
          className="w-full"
        >
          Usei agora
        </Botao>
      </section>

      <section aria-labelledby={idArsenal}>
        <div className="flex items-baseline justify-between px-0.5 pb-2 pt-1">
          <h2 id={idArsenal} className="text-base font-bold text-titulo">
            Seu arsenal
          </h2>
          <span className="text-xs text-ink-400">
            {lista.length} {lista.length === 1 ? "skill" : "skills"} · {totalDeUsos} usos
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2.5">
          {lista.map((s) => {
            const ativa = s.id === escolhida.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={ativa}
                  aria-label={`${s.name}, ${s.level.name}, ${s.uses} usos`}
                  onClick={() => escolher(s.id)}
                  className={`flex h-full w-full flex-col items-center gap-2 rounded-dialogo border-2
                              bg-superficie px-1 pb-3 pt-3.5 shadow-e1 transition-colors ${
                                ativa ? "border-accent-500" : "border-transparent"
                              }`}
                >
                  <EmblemaSkill emblema={s.emblem} nivel={s.level.key} />
                  <span className="text-[0.8125rem] font-bold leading-tight text-titulo">
                    {s.name}
                  </span>
                  <span className="text-miudo font-semibold text-ink-400">
                    {s.level.name}
                    {s.uses ? ` · ${s.uses}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-label="Níveis"
        className="flex items-center gap-2.5 rounded-dialogo border border-ink-800/70 bg-superficie
                   p-4 shadow-e1"
      >
        {NIVEIS_DA_SKILL.map((n) => (
          <EmblemaSkill key={n.key} nivel={n.key} tamanho="p" />
        ))}
        <p className="flex-1 text-miudo text-ink-400">
          {NIVEIS_DA_SKILL.map((n) =>
            n.from === 1 ? `${n.name} no 1º uso` : `${n.name} ${n.from}`,
          ).join(" · ")}
        </p>
      </section>
    </div>
  );
}
