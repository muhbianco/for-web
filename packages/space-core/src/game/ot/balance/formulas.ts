import { type BalanceConfig, BALANCE } from "./config.ts";
import {
  type ArmorSlot,
  type ArmorWeight,
  type ClassDef,
  type FamilyId,
  type OffhandId,
  type RarityId,
  type Stat,
  type Stats,
  ARMOR_SLOT_WEIGHT,
  ARMOR_WEIGHT,
  FAMILIES,
  RARITIES,
} from "./content.ts";

/**
 * As fórmulas do rebalanceamento do Idle Hunt (spec de 25/11/2026, §2 a §13), puras e sem estado:
 * combate, UI, tooltip, auto-equipar e gerador de monstros chamam este módulo (§0.2). Nenhum valor
 * derivado é salvo: tudo se recalcula de atributos, equipamento, nível e proficiência.
 *
 * `createBalance(cfg)` amarra as fórmulas a um config; `balance` é o do jogo. Um simulador passa
 * uma cópia afinada do config em vez de mexer em estado global.
 */

export type ArchetypeId = keyof BalanceConfig["archetypes"];
export type DungeonType = keyof BalanceConfig["dungeonType"];
export type Tier = 1 | 2 | 3 | 4;

/** `cap × x / (x + y)`: nunca chega no teto. Base de crítico, esquiva, velocidade e recarga. */
export function hyper(x: number, y: number, cap: number): number {
  if (x <= 0) return 0;
  return (cap * x) / (x + y);
}

export function freshStats(value = 0): Stats {
  return {
    FOR: value,
    AGI: value,
    VIT: value,
    INT: value,
    DES: value,
    SOR: value,
  };
}

/** Bônus de equipamento além dos atributos (afixos e lendários). Tudo opcional, em fração ou plano. */
export interface GearBonus {
  hpPct?: number;
  mpPct?: number;
  atkPct?: number;
  matkPct?: number;
  defPct?: number;
  mdefPct?: number;
  hit?: number;
  flee?: number;
  critRating?: number;
  critMultPct?: number;
  hastePct?: number;
  cooldownPct?: number;
  /** Usados pelo combate (Fase 3), não pelos derivados: cura causada e resistência a efeitos. */
  healPct?: number;
  effectResPct?: number;
}

/** O que o herói carrega para os derivados. A arma e as peças já vêm com raridade e refino. */
export interface HeroLoadout {
  cls: ClassDef;
  level: number;
  /** Atributos totais (pontos + afixos de atributo). */
  attrs: Stats;
  /** Proficiência guardada; a efetiva é calculada aqui. */
  proficiency: number;
  family: FamilyId;
  /** Base da arma já com raridade e refino: (12 + 2,4·iL) × raridade × refino. */
  weaponBase: number;
  offhand: OffhandId | null;
  /** DEF do escudo já com raridade e refino (0 sem escudo). */
  shieldDef: number;
  /** Soma das peças de armadura já com raridade e refino. */
  armorDef: number;
  armorMdef: number;
  /** Bônus da munição (0, 5% ou 10%) no ATQ à distância. */
  ammoPct?: number;
  bonus?: GearBonus;
}

export interface HeroStats {
  level: number;
  attrs: Stats;
  proficiencyEffective: number;
  hp: number;
  mp: number;
  /** A mana-base da classe: os custos de skill são % dela. */
  manaBase: number;
  atk: number;
  matk: number;
  def: number;
  mdef: number;
  block: number;
  critRating: number;
  critMultBonus: number;
  hit: number;
  flee: number;
  luck: number;
  attacksPerSecond: number;
  haste: number;
  cooldownCut: number;
  minRoll: number;
  kind: "melee" | "ranged" | "magic";
  penetration: number;
  threat: number;
}

export function createBalance(cfg: BalanceConfig = BALANCE) {
  const lv = cfg.levels;

  // ------------------------------------------------------------ níveis e normalizador (§4.1)

  /** N(x) = 12·√x − 0,05·x: o atributo principal bem investido no nível x. */
  function normalizer(x: number): number {
    return (
      cfg.normalizer.sqrtCoef * Math.sqrt(x) - cfg.normalizer.linearCoef * x
    );
  }

  /** K(x) = 50 + 6·x: a constante de defesa do atacante de nível x. */
  function defenseK(attackerLevel: number): number {
    return cfg.defense.kBase + cfg.defense.kPerLevel * attackerLevel;
  }

  // ------------------------------------------------------------ atributos (§3)

  /** Pontos para levar um atributo ao valor `t` (vindo de t − 1): 1 até 50, depois 1 + ⌈(t−50)/10⌉. */
  function statRaiseCost(t: number): number {
    const a = cfg.attributes;
    return t < a.ladderFrom
      ? 1
      : 1 + Math.ceil((t - (a.ladderFrom - 1)) / a.ladderStep);
  }

  /** Pontos para levar um atributo do início até `v`. */
  function statCostTo(v: number): number {
    let total = 0;
    for (let t = cfg.attributes.start + 1; t <= v; t++)
      total += statRaiseCost(t);
    return total;
  }

  /** Pontos de atributo acumulados no nível L: 5 por nível acima do 1. */
  function attributePoints(level: number): number {
    return cfg.attributes.pointsPerLevel * (Math.max(1, level) - 1);
  }

  /**
   * Distribui `points` perseguindo a fatia de gasto de cada atributo (a build de referência e a
   * sugestão da UI). A ordem das entradas desempata, como no gabarito.
   */
  function allocateByWeights(
    points: number,
    weights: ReadonlyArray<readonly [Stat, number]>,
  ): Stats {
    const s = freshStats(cfg.attributes.start);
    const spent = freshStats(0);
    let total = 0;
    for (const [, w] of weights) total += w;
    let remaining = points;
    let totalSpent = 0;
    for (;;) {
      let best: Stat | null = null;
      let bestDeficit = -1e18;
      for (const [k, w] of weights) {
        if (w <= 0) continue;
        const c = statRaiseCost(s[k] + 1);
        if (c > remaining) continue;
        const deficit = (w / total) * (totalSpent + c) - spent[k];
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          best = k;
        }
      }
      if (best === null) break;
      const c = statRaiseCost(s[best] + 1);
      s[best] += 1;
      spent[best] += c;
      remaining -= c;
      totalSpent += c;
    }
    return s;
  }

  /** O maior valor que um atributo alcança com `points` só nele. */
  function maxSingleStat(points: number): number {
    let v = cfg.attributes.start;
    let left = points;
    while (statRaiseCost(v + 1) <= left) {
      left -= statRaiseCost(v + 1);
      v++;
    }
    return v;
  }

  // ------------------------------------------------------------ proficiência (§2, §4.1)

  /** A efetiva: min(b, 10·L + 250, 5000), no mínimo 1. O excedente fica guardado. */
  function effectiveProficiency(stored: number, level: number): number {
    const p = cfg.proficiency;
    return Math.max(
      1,
      Math.min(
        stored,
        p.perLevel * level + p.effectiveSlack,
        lv.maxProficiency,
      ),
    );
  }

  function recommendedProficiency(level: number): number {
    return Math.min(cfg.proficiency.perLevel * level, lv.maxProficiency);
  }

  /** Pstat = 1 + peso × b_efetivo / 5000. */
  function proficiencyMult(weight: number, effective: number): number {
    return 1 + (weight * effective) / lv.maxProficiency;
  }

  function proficiencyXpToNext(b: number): number {
    if (b >= lv.maxProficiency) return 0;
    const p = cfg.proficiency;
    return Math.round(p.xpBase + p.xpCoef * Math.pow(b, p.xpExp));
  }

  /** XP/s no Dojô com `othersTraining` outros heróis treinando na mesma sala. */
  function proficiencyXpPerSecond(othersTraining: number): number {
    const p = cfg.proficiency;
    return (
      p.xpPerSecond *
      (1 + Math.min(p.socialMax, p.socialPerHero * Math.max(0, othersTraining)))
    );
  }

  // ------------------------------------------------------------ equipamento (§9)

  function weaponBaseValue(ilvl: number): number {
    return cfg.items.weaponBase + cfg.items.weaponPerIlvl * ilvl;
  }

  function armorDefPiece(
    ilvl: number,
    slot: ArmorSlot,
    weight: ArmorWeight,
  ): number {
    return (
      (cfg.items.armorDefBase + cfg.items.armorDefPerIlvl * ilvl) *
      ARMOR_SLOT_WEIGHT[slot] *
      ARMOR_WEIGHT[weight].def
    );
  }

  function armorMdefPiece(
    ilvl: number,
    slot: ArmorSlot,
    weight: ArmorWeight,
  ): number {
    return (
      (cfg.items.armorMdefBase + cfg.items.armorMdefPerIlvl * ilvl) *
      ARMOR_SLOT_WEIGHT[slot] *
      ARMOR_WEIGHT[weight].mdef
    );
  }

  function shieldDefValue(ilvl: number): number {
    return cfg.items.shieldDefBase + cfg.items.shieldDefPerIlvl * ilvl;
  }

  /** Multiplicador do refino `r`: arma +5% até o +5 e +8% acima (+10 = +65%); armadura +4%/+6% (+50%). */
  function refineMult(refine: number, weapon: boolean): number {
    const f = cfg.refine;
    const r = Math.max(0, Math.min(f.max, Math.floor(refine)));
    const [low, high] = weapon
      ? [f.weaponLow, f.weaponHigh]
      : [f.armorLow, f.armorHigh];
    return 1 + low * Math.min(r, f.lowUpTo) + high * Math.max(0, r - f.lowUpTo);
  }

  /** Chance de subir de `from` para `from + 1`. */
  function refineChance(from: number): number {
    return cfg.refine.chance[from] ?? 0;
  }

  /** O que a falha faz ao tentar `from → from + 1`: só custa (até o +7) ou derruba 1 nível (+8 a +10). */
  function refineFailure(from: number): "custo" | "cai" {
    return from + 1 >= cfg.refine.dropFromTarget ? "cai" : "custo";
  }

  /** Custo de uma tentativa para o refino `target`: 50 × (1 + iL/20) × r² em ouro + r minérios. */
  function refineCost(
    ilvl: number,
    target: number,
  ): { gold: number; ore: number } {
    const f = cfg.refine;
    return {
      gold: Math.round(
        f.costBase * (1 + ilvl / f.costIlvlDiv) * target * target,
      ),
      ore: target,
    };
  }

  function rarityMult(rarity: RarityId): number {
    return RARITIES[rarity].mult;
  }

  /** Valor de um afixo de atributo num item de nível `ilvl` (antes da rolagem de ±20%). */
  function attributeAffix(ilvl: number): number {
    return cfg.items.attrAffixBase + ilvl / cfg.items.attrAffixIlvlDiv;
  }

  /** Precisão, Fuga e rating de crítico: 2 × o afixo de atributo. */
  function ratingAffix(ilvl: number): number {
    return cfg.items.ratingAffixMult * attributeAffix(ilvl);
  }

  function canEquip(level: number, ilvl: number): boolean {
    return level >= ilvl - cfg.items.requirementSlack;
  }

  // ------------------------------------------------------------ derivados do herói (§4.2)

  function heroStats(h: HeroLoadout): HeroStats {
    const d = cfg.derived;
    const A = h.attrs;
    const b = h.bonus ?? {};
    const L = h.level;
    const cls = h.cls;
    const fam = FAMILIES[h.family];
    const be = effectiveProficiency(h.proficiency, L);
    const P = {
      hp: proficiencyMult(cls.proficiency.hp, be),
      mp: proficiencyMult(cls.proficiency.mp, be),
      atk: proficiencyMult(cls.proficiency.atk, be),
      matk: proficiencyMult(cls.proficiency.matk, be),
      def: proficiencyMult(cls.proficiency.def, be),
      mdef: proficiencyMult(cls.proficiency.mdef, be),
    };

    const hp =
      (cls.hp0 + cls.hpPerLevel * (L - 1)) *
      (1 + d.hpPerVit * A.VIT) *
      P.hp *
      (1 + (b.hpPct ?? 0));
    const manaBase = cls.mp0 + cls.mpPerLevel * (L - 1);
    const mp =
      manaBase * (1 + d.mpPerInt * A.INT) * P.mp * (1 + (b.mpPct ?? 0));

    let watk = h.weaponBase * fam.atk;
    let wmatk = h.weaponBase * fam.matk;
    if (h.offhand === "aljava") watk *= 1 + cfg.items.quiverAtk;
    if (h.offhand === "focus")
      wmatk += h.weaponBase * cfg.items.focusMatkOfBase;
    if (fam.kind === "ranged") watk *= 1 + (h.ammoPct ?? 0);
    const scale = A[fam.scale];
    const statusMelee =
      d.statusPrimary * A.FOR +
      d.statusSecondary * A.DES +
      d.statusLuck * A.SOR +
      d.statusLevel * L;
    const statusRanged =
      d.statusPrimary * A.DES +
      d.statusSecondary * A.FOR +
      d.statusLuck * A.SOR +
      d.statusLevel * L;
    const statusMagic =
      d.statusPrimary * A.INT +
      d.statusMagicSecondary * A.DES +
      d.statusLuck * A.SOR +
      d.statusLevel * L;
    const status = fam.kind === "ranged" ? statusRanged : statusMelee;
    const atk =
      (status + watk * (1 + d.weaponScalePerPoint * scale)) *
      P.atk *
      (1 + (b.atkPct ?? 0));
    const matk =
      (statusMagic + wmatk * (1 + d.weaponScalePerPoint * A.INT)) *
      P.matk *
      (1 + (b.matkPct ?? 0));

    const def =
      (h.armorDef + h.shieldDef + d.defPerVit * A.VIT) *
      P.def *
      (1 + (b.defPct ?? 0));
    const mdef =
      (h.armorMdef + d.mdefPerInt * A.INT) * P.mdef * (1 + (b.mdefPct ?? 0));
    const block = h.offhand === "escudo" ? cfg.block.chance : 0;

    let critRating =
      d.critPerLuck * A.SOR + d.critPerDes * A.DES + (b.critRating ?? 0);
    if (fam.critRatingMult) critRating *= fam.critRatingMult;
    // O traço do caçador (+10% de Precisão) não está no gabarito: entra com os traços, na Fase 3.
    const hit =
      d.hitPerDes * A.DES +
      d.hitPerLuck * A.SOR +
      d.hitPerLevel * L +
      (b.hit ?? 0);
    const flee = d.fleePerAgi * A.AGI + d.fleePerLuck * A.SOR + (b.flee ?? 0);

    const haste = Math.min(
      cfg.haste.hardCap,
      hyper(A.AGI, cfg.haste.k, cfg.haste.curveCap) + (b.hastePct ?? 0),
    );
    const cooldownCut = Math.min(
      cfg.cooldown.hardCap,
      hyper(A.DES, cfg.cooldown.k, cfg.cooldown.curveCap) +
        (fam.cooldownCut ?? 0) +
        (b.cooldownPct ?? 0),
    );
    const minRoll =
      cfg.minRoll.base + (cfg.minRoll.span * A.DES) / (A.DES + cfg.minRoll.k);

    return {
      level: L,
      attrs: { ...A },
      proficiencyEffective: be,
      hp,
      mp,
      manaBase,
      atk,
      matk,
      def,
      mdef,
      block,
      critRating,
      critMultBonus: (fam.critMultBonus ?? 0) + (b.critMultPct ?? 0),
      hit,
      flee,
      luck: A.SOR,
      attacksPerSecond: fam.aps * (1 + haste),
      haste,
      cooldownCut,
      minRoll,
      kind: fam.kind,
      penetration: fam.penetration ?? 0,
      threat: cls.threat,
    };
  }

  // ------------------------------------------------------------ chances e reduções (§4.3)

  /** Redução por defesa: def / (def + K(nível do atacante)), até `cap`. */
  function reduction(
    defense: number,
    attackerLevel: number,
    cap: number,
  ): number {
    if (defense <= 0) return 0;
    return Math.min(cap, defense / (defense + defenseK(attackerLevel)));
  }

  function heroPhysicalReduction(def: number, attackerLevel: number): number {
    return reduction(def, attackerLevel, cfg.defense.heroPhysicalCap);
  }

  function magicReduction(mdef: number, attackerLevel: number): number {
    return reduction(mdef, attackerLevel, cfg.defense.magicCap);
  }

  /** Teto da redução final somada (DEF × buffs × debuffs): o dano recebido nunca cai abaixo de 15%. */
  function capTakenMultiplier(mult: number): number {
    return Math.max(1 - cfg.defense.finalCap, mult);
  }

  /** Os números de um monstro do arquétipo no nível m (precisão, fuga, resistência a crítico, defesas). */
  function monsterStats(arch: ArchetypeId, m: number) {
    const a = cfg.archetypes[arch];
    const n = normalizer(m);
    const k = defenseK(m);
    return {
      hit: a.hit * n,
      flee: a.flee * n,
      critRes: a.critRes * n,
      def: a.def * k,
      mdef: a.mdef * k,
      attacksPerSecond: a.aps,
    };
  }

  /** Redução física ou mágica de um monstro contra um herói de nível `heroLevel`, com penetração. */
  function monsterReduction(
    arch: ArchetypeId,
    m: number,
    heroLevel: number,
    magic: boolean,
    penetration = 0,
  ): number {
    const s = monsterStats(arch, m);
    const d = (magic ? s.mdef : s.def) * (1 - penetration);
    return reduction(
      d,
      heroLevel,
      magic ? cfg.defense.magicCap : cfg.defense.monsterPhysicalCap,
    );
  }

  /** Crítico = 1% + hyper(rating, resistência do alvo, 50%) + bônus planos, até 70%. */
  function critChance(rating: number, targetCritRes: number, flat = 0): number {
    const c = cfg.crit;
    return Math.min(
      c.hardCap,
      c.base + hyper(rating, targetCritRes, c.curveCap) + flat,
    );
  }

  /**
   * Evasão total contra um golpe não certeiro: esquiva hyper(Fuga efetiva, Precisão, 60%) + planos,
   * combinada com a esquiva perfeita hyper(SOR, N(m), 15%); teto de 60%.
   */
  function avoidChance(
    flee: number,
    luck: number,
    attackerHit: number,
    attackerLevel: number,
    opts: { attackers?: number; fleeMult?: number; flat?: number } = {},
  ): number {
    const a = cfg.avoid;
    const attackers = opts.attackers ?? 1;
    const crowd = Math.max(
      a.crowdFloor,
      1 - a.crowdStep * Math.max(0, attackers - a.crowdFrom),
    );
    const effective = flee * (opts.fleeMult ?? 1) * crowd;
    const dodge =
      hyper(effective, attackerHit, a.dodgeCurveCap) + (opts.flat ?? 0);
    const perfect = hyper(luck, normalizer(attackerLevel), a.perfectCurveCap);
    return Math.min(a.hardCap, 1 - (1 - dodge) * (1 - perfect));
  }

  /** Erro do herói = hyper(Fuga do monstro, Precisão, 40%); magia e dano sagrado nunca erram. */
  function heroMissChance(
    hit: number,
    monsterFlee: number,
    magic: boolean,
  ): number {
    if (magic) return 0;
    return hyper(monsterFlee, hit, cfg.heroMiss.curveCap);
  }

  /** Δ = herói − monstro: dano causado × (1 + mod), recebido × (1 − mod). */
  function levelDiffMod(delta: number): number {
    const c = cfg.levelDiff;
    return Math.max(-c.cap, Math.min(c.cap, c.step * delta));
  }

  // ------------------------------------------------------------ progressão (§2, §13)

  function lacaioXp(m: number): number {
    const x = cfg.xp;
    return x.lacaioBase + x.lacaioCoef * Math.pow(m, x.lacaioExp);
  }

  function runsPerLevel(level: number): number {
    return cfg.xp.runsBase + cfg.xp.runsPerLevel * level;
  }

  function xpToNext(level: number): number {
    if (level >= lv.maxLevel) return 0;
    return Math.round(
      runsPerLevel(level) *
        cfg.xp.runUnits *
        (1 + cfg.xp.endBonus) *
        lacaioXp(level),
    );
  }

  function jobXpToNext(job: number): number {
    if (job >= lv.maxJob) return 0;
    const x = cfg.xp;
    return Math.round(x.jobCoef * Math.pow(job, x.jobExp) + x.jobBase);
  }

  /** levelTotal[L] = XP acumulada para chegar no nível L; jobTotal[J] = idem para o job. */
  const levelTotal: number[] = [0, 0];
  for (let l = 1; l < lv.maxLevel; l++)
    levelTotal.push(levelTotal[l]! + xpToNext(l));
  const jobTotal: number[] = [0, 0];
  for (let j = 1; j < lv.maxJob; j++)
    jobTotal.push(jobTotal[j]! + jobXpToNext(j));

  function xpTotalAt(level: number): number {
    return levelTotal[Math.max(1, Math.min(lv.maxLevel, level))]!;
  }

  function jobXpTotalAt(job: number): number {
    return jobTotal[Math.max(1, Math.min(lv.maxJob, job))]!;
  }

  function levelForXp(xp: number): number {
    let l = 1;
    while (l < lv.maxLevel && levelTotal[l + 1]! <= xp) l++;
    return l;
  }

  function jobForXp(xp: number): number {
    let j = 1;
    while (j < lv.maxJob && jobTotal[j + 1]! <= xp) j++;
    return j;
  }

  /** O job esperado de quem chegou ao nível L só com XP de DG (30% do XP de nível). */
  function jobForLevel(level: number): number {
    return jobForXp(cfg.xp.jobShare * xpTotalAt(level));
  }

  /** Corridas padrão acumuladas para chegar no nível L. */
  function runsTo(level: number): number {
    let runs = 0;
    for (let l = 1; l < Math.min(level, lv.maxLevel); l++)
      runs += runsPerLevel(l);
    return runs;
  }

  /** Horas de Dojô (10 XP/s, sozinho) para levar a Proficiência de 1 até `b`. */
  function dojoHoursTo(b: number): number {
    let s = 0;
    for (let x = 1; x < Math.min(b, lv.maxProficiency); x++)
      s += proficiencyXpToNext(x) / cfg.proficiency.xpPerSecond;
    return s / 3600;
  }

  /** Tier pelo marco do job (D51): T2 no job 20, T3 no 40, T4 no 70. O nível do herói não conta. */
  function tierFor(job: number): Tier {
    const t = cfg.tiers;
    if (job < t.t2Job) return 1;
    if (job < t.t3Job) return 2;
    if (job < t.t4Job) return 3;
    return 4;
  }

  function potencyCap(tier: Tier): number {
    return cfg.skills.potencyCapByTier[tier - 1]!;
  }

  /** O rank de Potência do perfil de teste: min(teto do tier, 1 + 0,6·(J−1)/4), truncado. */
  function referencePotencyRank(tier: Tier, job: number): number {
    return Math.max(
      1,
      Math.min(
        potencyCap(tier),
        Math.floor(1 + cfg.skills.referencePotencyPerJob * (job - 1)),
      ),
    );
  }

  /** +5% no número principal por rank acima do 1. */
  function potencyMult(rank: number): number {
    return 1 + cfg.skills.potencyPerRank * (rank - 1);
  }

  /** Custo de mana: % da mana-base, −4% por up de Eficiência. */
  function skillManaCost(
    pctOfBase: number,
    manaBase: number,
    efficiency = 0,
  ): number {
    return (
      pctOfBase * manaBase * (1 - cfg.skills.efficiencyManaPerUp * efficiency)
    );
  }

  /** Recarga final = base × (1 − recarga global) × (1 − reduções da skill), nunca abaixo de 50% da base. */
  function skillCooldown(
    baseMs: number,
    globalCut: number,
    ownCut = 0,
  ): number {
    return Math.max(
      cfg.cooldown.floorOfBase * baseMs,
      baseMs * (1 - globalCut) * (1 - ownCut),
    );
  }

  /** Multiplicador do XP pela diferença de nível (Δ = herói − monstro). */
  function xpLevelDiffMult(delta: number): number {
    const x = cfg.xp;
    if (delta > x.diffFree)
      return Math.max(
        x.diffFloor,
        1 - x.diffPenaltyPerLevel * (delta - x.diffFree),
      );
    if (delta < 0)
      return Math.min(1 + x.diffBonusMax, 1 - x.diffBonusPerLevel * delta);
    return 1;
  }

  /** escala(n) = 1 + 0,75·(n − 1); a Masmorra usa n mínimo de 3. */
  function partyScale(members: number, type: DungeonType): number {
    const p = cfg.partyScale;
    const n = type === "cacada" ? members : Math.max(p.masmorraMin, members);
    return 1 + p.perExtra * (Math.max(1, n) - 1);
  }

  /** XP de uma criatura para CADA membro (antes da diferença de nível e do bônus de fim). */
  function creatureXpEach(
    m: number,
    arch: ArchetypeId,
    members: number,
    type: DungeonType,
  ): number {
    const group = 1 + cfg.xp.groupBonusPerExtra * (members - 1);
    return (
      (lacaioXp(m) *
        cfg.archetypes[arch].xp *
        partyScale(members, type) *
        cfg.dungeonType[type] *
        group) /
      members
    );
  }

  /** ouroLacaio(m) = 3 + 0,8·m^1,15, arredondado. */
  function lacaioGold(m: number): number {
    const g = cfg.gold;
    return Math.round(g.base + g.coef * Math.pow(m, g.exp));
  }

  function potionTierLevel(level: number): number {
    let t = cfg.potions.tiers[0]!;
    for (const x of cfg.potions.tiers) if (x <= level) t = x;
    return t;
  }

  /** D30: multiplicador do preço da poção nos tiers altos. */
  function potionPriceMult(tier: number): number {
    return cfg.potions.highTierPriceMult.find(([t]) => t === tier)?.[1] ?? 1;
  }

  function potionPrices(level: number): { hp: number; mp: number } {
    const tier = potionTierLevel(level);
    const g = lacaioGold(tier) * potionPriceMult(tier);
    return {
      hp: Math.ceil(cfg.potions.hpPriceOfGold * g),
      mp: Math.ceil(cfg.potions.mpPriceOfGold * g),
    };
  }

  /** Custo da próxima redistribuição: a 1ª é grátis, as seguintes custam o valor fixo (D25). */
  function respecCost(previousResets: number): number {
    return previousResets <= 0 ? 0 : cfg.respec.fixedGold;
  }

  return {
    cfg,
    hyper,
    normalizer,
    defenseK,
    statRaiseCost,
    statCostTo,
    attributePoints,
    allocateByWeights,
    maxSingleStat,
    effectiveProficiency,
    recommendedProficiency,
    proficiencyMult,
    proficiencyXpToNext,
    proficiencyXpPerSecond,
    weaponBaseValue,
    armorDefPiece,
    armorMdefPiece,
    shieldDefValue,
    refineMult,
    refineChance,
    refineFailure,
    refineCost,
    rarityMult,
    attributeAffix,
    ratingAffix,
    canEquip,
    heroStats,
    reduction,
    heroPhysicalReduction,
    magicReduction,
    capTakenMultiplier,
    monsterStats,
    monsterReduction,
    critChance,
    avoidChance,
    heroMissChance,
    levelDiffMod,
    lacaioXp,
    runsPerLevel,
    xpToNext,
    jobXpToNext,
    xpTotalAt,
    jobXpTotalAt,
    levelForXp,
    jobForXp,
    jobForLevel,
    runsTo,
    dojoHoursTo,
    tierFor,
    potencyCap,
    referencePotencyRank,
    potencyMult,
    skillManaCost,
    skillCooldown,
    xpLevelDiffMult,
    partyScale,
    creatureXpEach,
    lacaioGold,
    potionTierLevel,
    potionPrices,
    respecCost,
  };
}

export type Balance = ReturnType<typeof createBalance>;

/** As fórmulas com o config do jogo. */
export const balance: Balance = createBalance();
