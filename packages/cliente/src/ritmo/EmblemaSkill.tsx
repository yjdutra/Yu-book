import type { ChaveDoNivelDaSkill, EmblemaDaSkill } from "@yu-book/shared";
import { ICONE_EMBLEMA_SKILL } from "../Icones";

const HEXAGONO = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

/// A moldura (clara) e o miolo (escuro) de cada nível, misturados do token.
const MOLDURA: Record<ChaveDoNivelDaSkill, string> = {
  nova: "bg-ink-700",
  bronze: "bg-[color-mix(in_srgb,var(--color-nivel-bronze)_55%,white)]",
  prata: "bg-[color-mix(in_srgb,var(--color-nivel-prata)_45%,white)]",
  ouro: "bg-[color-mix(in_srgb,var(--color-nivel-ouro)_50%,white)]",
  mestre: "bg-[color-mix(in_srgb,var(--color-nivel-mestre)_50%,white)]",
};
const MIOLO: Record<ChaveDoNivelDaSkill, string> = {
  nova: "bg-ink-900 text-ink-400",
  bronze: "bg-nivel-bronze text-white",
  prata: "bg-nivel-prata text-white",
  ouro: "bg-nivel-ouro text-white",
  mestre: "bg-nivel-mestre text-white",
};

const TAMANHO = {
  p: { caixa: "w-[30px] h-[34px]", borda: "inset-[2px]", icone: "size-3.5" },
  m: { caixa: "w-[60px] h-[68px]", borda: "inset-[3px]", icone: "size-6" },
  g: { caixa: "w-[112px] h-[128px]", borda: "inset-[6px]", icone: "size-12" },
} as const;

/**
 * O emblema de uma skill (frente Ritmo, RNF-17): o desenho do catálogo num
 * hexágono com a moldura do nível. Decorativo — quem usa escreve o nome da
 * skill e o do nível ao lado. Sem `emblema`, só a moldura (a legenda).
 */
export function EmblemaSkill({
  emblema,
  nivel,
  tamanho = "m",
}: {
  emblema?: EmblemaDaSkill;
  nivel: ChaveDoNivelDaSkill;
  tamanho?: keyof typeof TAMANHO;
}) {
  const t = TAMANHO[tamanho];
  const Icone = emblema ? (ICONE_EMBLEMA_SKILL[emblema] ?? ICONE_EMBLEMA_SKILL.raio) : null;
  return (
    <span
      aria-hidden="true"
      className={`relative grid shrink-0 place-items-center ${t.caixa} ${MOLDURA[nivel]}`}
      style={{ clipPath: HEXAGONO }}
    >
      <span
        className={`absolute grid place-items-center ${t.borda} ${MIOLO[nivel]}`}
        style={{ clipPath: HEXAGONO }}
      >
        {Icone && <Icone className={t.icone} />}
      </span>
    </span>
  );
}
