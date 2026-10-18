import { useResumoRitmo } from "@yu-book/cliente/habitos";
import { BarraXp } from "@yu-book/cliente/ritmo/Nivel";
import { EmblemaSkill } from "@yu-book/cliente/ritmo/EmblemaSkill";
import { useSkills } from "@yu-book/cliente/skills";
import { skillDoDia } from "@yu-book/shared";
import { Link } from "react-router-dom";

/**
 * A skill do dia no Início (frente Ritmo, RF-51): uma das ativas, em rodízio
 * pelo dia do usuário (RN-34), com o que falta para o próximo nível. Toca e
 * abre a skill na aba Skills. Sem skill, some.
 */
export function SkillDoDia() {
  const skills = useSkills();
  const resumo = useResumoRitmo();
  const hoje = resumo.data?.today;
  const skill = skills.data && hoje ? skillDoDia(skills.data, hoje) : null;
  if (!skill) return null;
  const { level } = skill;
  const fracao =
    level.next === null ? 1 : (skill.uses - level.from) / Math.max(1, level.next - level.from);
  return (
    <Link
      to={`/ritmo/skills?skill=${skill.id}`}
      className="flex items-center gap-3.5 rounded-dialogo border border-ink-800/70 bg-superficie
                 p-4 shadow-e1 transition active:scale-[0.99]"
    >
      <EmblemaSkill emblema={skill.emblem} nivel={level.key} />
      <span className="min-w-0 flex-1">
        <span className="rotulo block">Skill do dia</span>
        <span className="block text-base font-bold text-titulo">{skill.name}</span>
        {skill.description && (
          <span className="line-clamp-2 block text-xs text-ink-400">{skill.description}</span>
        )}
        <span className="mt-1.5 block">
          <BarraXp fracao={fracao} fina />
        </span>
        <span className="mt-1 block text-miudo text-ink-400">
          {level.name}
          {level.next !== null
            ? ` · falta${level.next - skill.uses === 1 ? "" : "m"} ${level.next - skill.uses} ${
                level.next - skill.uses === 1 ? "uso" : "usos"
              } para ${level.nextName}`
            : " · nível máximo"}
        </span>
      </span>
    </Link>
  );
}
