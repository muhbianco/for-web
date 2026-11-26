import {
  type AffixId,
  type ClassId,
  type RarityId,
  type Stat,
  type Stats,
  AFFIXES,
  ARMOR_SLOTS,
  CLASSES,
  JEWEL_EXTRA_AFFIXES,
  RARITIES,
} from "./content.ts";
import {
  type Affix,
  type BalanceHero,
  type Equipment,
  type ItemInstance,
  heroDerived,
} from "./equipment.ts";
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

/**
 * "referencia": o perfil do spec (Raro +4, 5 + 3 afixos de atributo), que dá o kit inicial, as poções
 * e o "escolher o melhor sozinho". "limite" (D41): o item da faixa do `limit` do config, com os
 * afixos da classe; é dele que os monstros saem.
 */
export type ReferenceProfile = "referencia" | "limite";

/** Valor nominal de um afixo no iL (o meio da rolagem; nos de %, o meio da faixa). */
export function affixNominal(id: AffixId, ilvl: number, B: Balance): number {
  const a = AFFIXES[id];
  if (a.scale === "atributo") return B.attributeAffix(ilvl);
  if (a.scale === "rating") return B.ratingAffix(ilvl);
  return ((a.min ?? 0) + (a.max ?? 0)) / 2;
}

export function createReference(
  B: Balance = gameBalance,
  profile: ReferenceProfile = "referencia",
) {
  const cfg = B.cfg;
  // As poções são as do jogo (perfil de referência), também quando os monstros saem do limite.
  const game = profile === "referencia" ? null : createReference(B);

  /** A faixa do limite do nível (a última vale acima dela). */
  function limitBand(level: number) {
    const bands = cfg.limit.bands;
    return bands.find((b) => level <= b.upTo) ?? bands[bands.length - 1]!;
  }

  /** Os dois atributos que recebem os afixos do perfil: os de maior peso na build (empate: ordem). */
  function affixTargets(cls: ClassId): [Stat, Stat] {
    const order = [...CLASSES[cls].referenceBuild].sort((a, b) => b[1] - a[1]);
    return [order[0]![0], (order[1] ?? order[0]!)[0]];
  }

  /**
   * O equipamento do perfil: arma e mão secundária da classe, as 4 peças do peso da classe, colar e
   * anel, todos com a mesma raridade, refino e iL. Os afixos de atributo (5 no principal e 3 no
   * secundário, no valor nominal) vão um por item, em ordem; só a soma importa para os derivados.
   */
  function referenceEquipment(
    cls: ClassId,
    level: number,
    opts: ReferenceOptions = {},
  ): Equipment {
    const c = CLASSES[cls];
    const ilvl = opts.ilvl ?? level;
    const band = profile === "limite" ? limitBand(level) : null;
    const rarity = (opts.rarity ??
      band?.rarity ??
      cfg.reference.rarity) as RarityId;
    const refine = opts.refine ?? band?.refine ?? cfg.reference.refine;
    const common = { ilvl, rarity, refine };
    const items: ItemInstance[] = [
      { ...common, slot: "arma", family: c.referenceWeapon, affixes: [] },
    ];
    if (c.referenceOffhand)
      items.push({
        ...common,
        slot: "secundaria",
        offhand: c.referenceOffhand,
        affixes: [],
      });
    for (const slot of ARMOR_SLOTS)
      items.push({ ...common, slot, weight: c.armor, affixes: [] });
    items.push({ ...common, slot: "colar", affixes: [] });
    items.push({ ...common, slot: "anel", affixes: [] });

    if (
      opts.gearAttrs !== false &&
      profile === "limite" &&
      !(band && "referenceAffixes" in band && band.referenceAffixes)
    ) {
      // D41: cada peça com os primeiros afixos do plano da classe que a raridade dá.
      const plan = cfg.limit.affixPlan[cls] ?? {};
      for (const it of items) {
        const n =
          RARITIES[it.rarity].affixes +
          (it.slot === "colar" || it.slot === "anel" ? JEWEL_EXTRA_AFFIXES : 0);
        for (const id of (plan[it.slot] ?? []).slice(0, n))
          it.affixes.push({
            id: id as AffixId,
            value: affixNominal(id as AffixId, it.ilvl, B),
          });
      }
    } else if (opts.gearAttrs !== false) {
      const [main, second] = affixTargets(cls);
      const v = B.attributeAffix(ilvl);
      const affixes: Affix[] = [
        ...Array.from({ length: cfg.reference.mainAttrAffixes }, () => ({
          id: main,
          value: v,
        })),
        ...Array.from({ length: cfg.reference.secondaryAttrAffixes }, () => ({
          id: second,
          value: v,
        })),
      ];
      affixes.forEach((a, i) => items[i % items.length]!.affixes.push(a));
    }

    const eq: Equipment = {};
    for (const it of items) (eq as Record<string, ItemInstance>)[it.slot] = it;
    return eq;
  }

  /** O herói de referência como a engine nova o guarda. */
  function referenceBalanceHero(
    cls: ClassId,
    level: number,
    opts: ReferenceOptions = {},
  ): BalanceHero {
    const attrs: Stats = opts.attrs
      ? { ...opts.attrs }
      : B.allocateByWeights(
          B.attributePoints(level),
          CLASSES[cls].referenceBuild,
        );
    return {
      cls,
      level,
      job: B.jobForLevel(level),
      proficiency: opts.proficiency ?? B.recommendedProficiency(level),
      attrs,
      equipment: referenceEquipment(cls, level, opts),
    };
  }

  function referenceHero(
    cls: ClassId,
    level: number,
    opts: ReferenceOptions = {},
  ): ReferenceHero {
    const hero = referenceBalanceHero(cls, level, opts);
    const stats = heroDerived(hero, B);
    return { ...stats, cls, job: hero.job, tier: B.tierFor(level, hero.job) };
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
    if (game) return game.potionHp(level);
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
    referenceEquipment,
    referenceBalanceHero,
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
