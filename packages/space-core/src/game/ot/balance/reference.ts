import {
  type ClassId,
  type RarityId,
  type Stat,
  type Stats,
  ARMOR_SLOTS,
  CLASSES,
} from "./content.ts";
import {
  type Balance,
  type HeroStats,
  type Tier,
  balance as gameBalance,
} from "./formulas.ts";

/**
 * O perfil de referência (spec §9.4 e §11.2): cada classe no nível L com a build de referência,
 * equipamento Raro +4 de iL = L (5 afixos no atributo principal e 3 no secundário), proficiência
 * 10 × L e a Potência esperada. Todo o conteúdo é calibrado nele, e o gerador de monstros parte dele.
 */

export interface ReferenceOptions {
  /** Proficiência guardada (padrão: 10 × nível). */
  proficiency?: number;
  refine?: number;
  rarity?: RarityId;
  ilvl?: number;
  /** Atributos de pontos no lugar da build de referência (os afixos do perfil somam por cima). */
  attrs?: Stats;
  /** Com os afixos de atributo do perfil (padrão: sim). */
  gearAttrs?: boolean;
}

export interface ReferenceHero extends HeroStats {
  cls: ClassId;
  job: number;
  tier: Tier;
}

/** Como a referência se sai contra os monstros do próprio nível (a 2ª tabela da §17). */
export interface ReferenceVersus {
  physicalReduction: number;
  magicReduction: number;
  critVsBoss: number;
  avoidVsBoss: number;
  missVsLacaio: number;
}

export function createReference(B: Balance = gameBalance) {
  const cfg = B.cfg;

  /** Os dois atributos que recebem os afixos do perfil: os de maior peso na build (empate: ordem). */
  function affixTargets(cls: ClassId): [Stat, Stat] {
    const order = [...CLASSES[cls].referenceBuild].sort((a, b) => b[1] - a[1]);
    return [order[0]![0], (order[1] ?? order[0]!)[0]];
  }

  function referenceAttrs(
    cls: ClassId,
    level: number,
    opts: ReferenceOptions = {},
  ): Stats {
    const ilvl = opts.ilvl ?? level;
    const base = opts.attrs
      ? { ...opts.attrs }
      : B.allocateByWeights(
          B.attributePoints(level),
          CLASSES[cls].referenceBuild,
        );
    if (opts.gearAttrs === false) return base;
    const [main, second] = affixTargets(cls);
    const v = B.attributeAffix(ilvl);
    base[main] += cfg.reference.mainAttrAffixes * v;
    base[second] += cfg.reference.secondaryAttrAffixes * v;
    return base;
  }

  function referenceHero(
    cls: ClassId,
    level: number,
    opts: ReferenceOptions = {},
  ): ReferenceHero {
    const c = CLASSES[cls];
    const ilvl = opts.ilvl ?? level;
    const rarity = (opts.rarity ?? cfg.reference.rarity) as RarityId;
    const refine = opts.refine ?? cfg.reference.refine;
    const rm = B.rarityMult(rarity);
    const armorRm = rm * B.refineMult(refine, false);
    let armorDef = 0;
    let armorMdef = 0;
    for (const slot of ARMOR_SLOTS) {
      armorDef += B.armorDefPiece(ilvl, slot, c.armor);
      armorMdef += B.armorMdefPiece(ilvl, slot, c.armor);
    }
    const stats = B.heroStats({
      cls: c,
      level,
      attrs: referenceAttrs(cls, level, opts),
      proficiency: opts.proficiency ?? B.recommendedProficiency(level),
      family: c.referenceWeapon,
      weaponBase: B.weaponBaseValue(ilvl) * rm * B.refineMult(refine, true),
      offhand: c.referenceOffhand,
      shieldDef:
        c.referenceOffhand === "escudo" ? B.shieldDefValue(ilvl) * armorRm : 0,
      armorDef: armorDef * armorRm,
      armorMdef: armorMdef * armorRm,
    });
    const job = B.jobForLevel(level);
    return { ...stats, cls, job, tier: B.tierFor(level, job) };
  }

  /** Reduções, crítico e evasão contra o chefe e erro contra o lacaio, todos no nível do herói. */
  function versus(h: ReferenceHero): ReferenceVersus {
    const m = h.level;
    const boss = B.monsterStats("chefe", m);
    const lacaio = B.monsterStats("lacaio", m);
    return {
      physicalReduction: B.heroPhysicalReduction(h.def, m),
      magicReduction: B.magicReduction(h.mdef, m),
      critVsBoss: B.critChance(h.critRating, boss.critRes),
      avoidVsBoss: B.avoidChance(h.flee, h.luck, boss.hit, m),
      missVsLacaio: B.heroMissChance(h.hit, lacaio.flee, h.kind === "magic"),
    };
  }

  /** HP médio dos dois tanques de referência e a redução física média deles. */
  function tankReference(m: number): { hp: number; physicalReduction: number } {
    const g = referenceHero("guerreiro", m);
    const p = referenceHero("paladino", m);
    return {
      hp: (g.hp + p.hp) / 2,
      physicalReduction:
        (B.heroPhysicalReduction(g.def, m) +
          B.heroPhysicalReduction(p.def, m)) /
        2,
    };
  }

  /** O caçador de referência: o alvo de pano que calibra lacaios, chefe menor e Pulso Sombrio. */
  function hunterReference(m: number) {
    const c = referenceHero("cacador", m);
    return {
      hp: c.hp,
      physicalReduction: B.heroPhysicalReduction(c.def, m),
      magicReduction: B.magicReduction(c.mdef, m),
    };
  }

  /** Golpes brutos (antes da defesa do herói) gerados dos perfis (§11.2). */
  function monsterHits(m: number) {
    const mon = cfg.monsters;
    const hunter = hunterReference(m);
    const tank = tankReference(m);
    const lacaio =
      (mon.lacaioHitPct * hunter.hp) / (1 - hunter.physicalReduction);
    const boss = (mon.bossHitPct * tank.hp) / (1 - tank.physicalReduction);
    return {
      lacaio,
      elite: mon.eliteHitMult * lacaio,
      chefeMenor:
        (mon.menorHitPct * hunter.hp) / (1 - hunter.physicalReduction),
      chefe: boss,
      golpePesado: mon.busterMult * boss,
      pulso: (mon.pulsePct * hunter.hp) / (1 - hunter.magicReduction),
    };
  }

  /** Poção de vida: 6% do HP do caçador de referência no nível do tier, arredondado (cura inteira). */
  function potionHp(level: number): number {
    return Math.round(
      cfg.potions.hpPctOfReference *
        referenceHero("cacador", B.potionTierLevel(level)).hp,
    );
  }

  /** Poção de mana: 4% da mana-base do mago no nível do tier, arredondado. */
  function potionMp(level: number): number {
    const mage = CLASSES.mago;
    const t = B.potionTierLevel(level);
    return Math.round(
      cfg.potions.mpPctOfMageBase * (mage.mp0 + mage.mpPerLevel * (t - 1)),
    );
  }

  return {
    affixTargets,
    referenceAttrs,
    referenceHero,
    versus,
    tankReference,
    hunterReference,
    monsterHits,
    potionHp,
    potionMp,
  };
}

export type Reference = ReturnType<typeof createReference>;

export const reference: Reference = createReference();
