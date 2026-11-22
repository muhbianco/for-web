import {
  type ClassId,
  CLASSES,
  type HeroCombat,
  heroCombat,
  type HeroCore,
  type Rarity,
  SKILL_IDS,
  SLOTS,
  baseItem,
} from "../game/index.ts";

/** Herói de referência: todas as skills no mesmo nível e todas as peças no ilvl e raridade dados. */
export function refHero(cls: ClassId, level: number, skill: number, ilvl: number, rarity: Rarity): HeroCombat {
  const skills = Object.fromEntries(SKILL_IDS.map((s) => [s, { l: skill, p: 0 }])) as HeroCore["skills"];
  const gear: HeroCore["gear"] = {};
  for (const slot of SLOTS) gear[slot] = baseItem(`it${slot}`, slot, rarity, ilvl, cls);
  return heroCombat({ cls, level, skills, gear });
}

/** Herói recém-criado com o kit inicial (arma, armadura, elmo e botas comuns). */
export function freshHero(cls: ClassId): HeroCore {
  const skills = Object.fromEntries(SKILL_IDS.map((s) => [s, { l: 1, p: 0 }])) as HeroCore["skills"];
  return {
    cls,
    level: 1,
    skills,
    gear: {
      arma: baseItem("kit-arma", "arma", "comum", 1, cls, CLASSES[cls].starter),
      armadura: baseItem("kit-armadura", "armadura", "comum", 1, cls),
      elmo: baseItem("kit-elmo", "elmo", "comum", 1, cls),
      botas: baseItem("kit-botas", "botas", "comum", 1, cls),
    },
  };
}
