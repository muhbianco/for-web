import { fight } from "../combat/fight.ts";
import type {
  EnemyInput,
  FighterInput,
  FightOptions,
  FightResult,
  SkillDef,
} from "../combat/types.ts";
import { type ClassId, CLASSES, FAMILIES } from "../content.ts";
import { heroFighter } from "../fighter.ts";
import {
  type Balance,
  type Tier,
  balance as gameBalance,
} from "../formulas.ts";
import {
  type Reference,
  type ReferenceProfile,
  createReference,
} from "../reference.ts";
import {
  REFERENCE_KITS,
  REFERENCE_KITS_T4,
  REFERENCE_SOLO_KITS,
  SKILLS_BY_CLASS,
} from "../skills/index.ts";
import { skillOf } from "../skills/index.ts";
import { type HeroSkills, learnableSkills, MAX_SLOTS } from "../skills/tree.ts";
import { GABARITO_KITS } from "./kits.ts";

/**
 * Os encontros que calibram o spec (§11.2), montados dos perfis de referência: o chefe de masmorra,
 * o chefe menor da Caçada e o boneco de treino (alvo de HP infinito que só apanha). Na Fase 6 isto
 * vira o gerador de monstros; por ora é o que os invariantes da §14 usam.
 */

export interface SimOptions {
  /**
   * De onde vêm as skills: "gabarito" (os kits do gabarito, para a paridade) ou "spec" (as 42 skills
   * compiladas, com as regras de tier e os traços do §6 inteiros). Padrão: "gabarito".
   */
  source?: "gabarito" | "spec";
  /** Com `source: "spec"`, usa os kits solo do §8. */
  solo?: boolean;
  /** Kit por classe (só com `source: "gabarito"`; padrão: os de referência do gabarito). */
  kits?: Record<ClassId, SkillDef[]>;
  /** Cura das poções no lugar da do jogo (o gabarito usa poção fracionária). */
  potions?: (level: number) => { hp: number; mp: number };
  mode?: FightOptions["mode"];
  random?: FightOptions["random"];
  /** Proficiência dos heróis (padrão: 10 × nível). O chefe continua calibrado na referência. */
  proficiency?: (level: number) => number;
  /**
   * IA do perfil de referência com `source: "spec"`: "spec" usa a IA padrão de cada skill; "gabarito"
   * põe "Sempre" nas skills de dano (como o gabarito rodou) e deixa a do spec nas de cura e defesa.
   */
  referenceAi?: "spec" | "gabarito";
}

/** O que calibra o chefe: só o kit e as poções; a proficiência e o modo são dos heróis da luta. */
function calibration(o: SimOptions): SimOptions {
  return {
    ...(o.source ? { source: o.source } : {}),
    ...(o.kits ? { kits: o.kits } : {}),
    ...(o.potions ? { potions: o.potions } : {}),
    ...(o.referenceAi ? { referenceAi: o.referenceAi } : {}),
    mode: "esperado",
  };
}

/** Skill de dano: tem dano direto ou DoT. */
function dealsDamage(id: string, cls: ClassId): boolean {
  const s = SKILLS_BY_CLASS[cls].find((x) => x.id === id);
  return !!s && s.effects.some((e) => e.type === "dano" || e.type === "dot");
}

/**
 * As skills do perfil de referência com as regras do spec: o kit de referência filtrado pelo tier
 * (no T1 só existem as 2 skills do T1), completado com as outras aprendidas na ordem do spec, e a
 * Potência esperada em todas (§8, "rank de Potência esperado no perfil de teste").
 */
export function referenceSkills(
  cls: ClassId,
  tier: Tier,
  job: number,
  solo: boolean,
  B: Balance = gameBalance,
  ai: "spec" | "gabarito" = "spec",
): HeroSkills {
  const rank = B.referencePotencyRank(tier, job);
  const learned = learnableSkills(cls, tier).map((s) => s.id);
  const boss =
    (tier >= 4 ? REFERENCE_KITS_T4[cls] : undefined) ?? REFERENCE_KITS[cls];
  const kit = (solo ? REFERENCE_SOLO_KITS[cls] : boss).filter((id) =>
    learned.includes(id),
  );
  for (const id of learned)
    if (kit.length < MAX_SLOTS && !kit.includes(id)) kit.push(id);
  const builds: HeroSkills["builds"] = {};
  for (const id of learned)
    builds[id] = { potency: rank, efficiency: 0, mechanics: {} };
  const overrides: HeroSkills["ai"] = {};
  if (ai === "gabarito")
    for (const id of kit)
      if (dealsDamage(id, cls)) overrides[id] = [{ kind: "sempre" }];
  return { tier, builds, slots: kit, ai: overrides, resets: 0 };
}

/**
 * As melhorias de mecânica do perfil do limite (D49): o guerreiro do limite é o tanque montado, com
 * as de provocação no máximo (Desafio: +2 s e 20% da ameaça em área; Revide; Eco); o paladino com a
 * Terra Santa no máximo (D50). As outras classes seguem sem mecânicas. Só entram as já destravadas no tier do herói. Vale para o `limitFighter` (o
 * gerador do aperto e o relatório) e para o `limitEncounters` (os testes): o limite é um só.
 */
export const LIMIT_MECHANICS: Partial<
  Record<ClassId, Record<string, Record<string, number>>>
> = {
  guerreiro: {
    "golpe-provocador": { desafio: 5, revide: 5 },
    "grito-de-guerra": { eco: 5 },
  },
  // D50: o paladino do limite cura o grupo com a Consagração.
  paladino: { consagracao: { "terra-santa": 5 } },
};

export function limitMechanics(cls: ClassId, hs: HeroSkills): HeroSkills {
  for (const [id, ups] of Object.entries(LIMIT_MECHANICS[cls] ?? {})) {
    const b = hs.builds[id];
    const def = skillOf(cls, id);
    if (!b || !def) continue;
    for (const [m, n] of Object.entries(ups))
      if ((def.mechanics.find((x) => x.id === m)?.unlockTier ?? 9) <= hs.tier)
        b.mechanics = { ...b.mechanics, [m]: n };
  }
  return hs;
}

export function createEncounters(
  B: Balance = gameBalance,
  profile: ReferenceProfile = "referencia",
) {
  const R: Reference = createReference(B, profile);
  const cfg = B.cfg;
  const partyDpsCache = new Map<string, number>();
  const soloDpsCache = new Map<string, number>();

  function fighter(
    cls: ClassId,
    level: number,
    o: SimOptions = {},
  ): FighterInput {
    const c = CLASSES[cls];
    const h = R.referenceHero(
      cls,
      level,
      o.proficiency ? { proficiency: o.proficiency(level) } : {},
    );
    const fam = FAMILIES[c.referenceWeapon];
    const pot = o.potions?.(level) ?? {
      hp: R.potionHp(level),
      mp: R.potionMp(level),
    };
    const common = {
      cls,
      role: c.role,
      lifesteal: c.trait.lifesteal ?? 0,
      blockBonus: c.trait.blockBonus ?? 0,
      healBonus: (c.trait.healBonus ?? 0) + (fam.healBonus ?? 0),
      hotBonus: c.trait.hotBonus ?? 0,
      magicAutoAttack: fam.magicAutoAttack ?? c.trait.magicAutoAttack ?? 0.6,
      potions: { ...pot, stock: 100 },
    };
    if (o.source === "spec") {
      // Os traços que o gabarito não tinha: Olho de Águia (+10% de Precisão) e o +20% de veneno.
      const hs = referenceSkills(
        cls,
        h.tier,
        h.job,
        o.solo ?? false,
        B,
        o.referenceAi,
      );
      // O mesmo caminho do jogo (fighter.ts), com os traços que o gabarito não tinha.
      const hero = R.referenceBalanceHero(
        cls,
        level,
        o.proficiency ? { proficiency: o.proficiency(level) } : {},
      );
      if (profile === "limite") limitMechanics(cls, hs);
      return heroFighter(hero, hs, { potions: common.potions }, B, R);
    }
    return {
      ...common,
      stats: h,
      skills: (o.kits ?? GABARITO_KITS)[cls],
      potencyRank: B.referencePotencyRank(h.tier, h.job),
    };
  }

  /** Alvo de HP infinito que não bate: mede dano por segundo. */
  function dummy(m: number): EnemyInput {
    return {
      archetype: "chefe",
      level: m,
      hp: 1e15,
      autoRaw: 0,
      attacksPerSecond: 0.5,
    };
  }

  function run(
    comp: ClassId[],
    enemies: EnemyInput[],
    maxSeconds: number,
    o: SimOptions = {},
    levels?: number[],
  ): FightResult {
    const m = enemies[0]!.level;
    const heroes = comp.map((cls, i) => fighter(cls, levels?.[i] ?? m, o));
    return fight(
      heroes,
      enemies,
      {
        maxSeconds,
        mode: o.mode ?? "esperado",
        ...(o.random ? { random: o.random } : {}),
      },
      B,
    );
  }

  /** DPS_grupo_ref(m): guerreiro + padre + mago + caçador contra o boneco, 80 s. */
  function referencePartyDps(m: number, o: SimOptions = {}): number {
    const key = `${m}:${o.source ?? "gabarito"}:${o.referenceAi ?? ""}:${o.solo ? "solo" : ""}:${o.kits ? "k" : ""}:${o.potions ? "p" : ""}`;
    let v = partyDpsCache.get(key);
    if (v === undefined) {
      const secs = cfg.monsters.masmorraHpSeconds;
      v =
        run(
          ["guerreiro", "padre", "mago", "cacador"],
          [dummy(m)],
          secs,
          calibration(o),
        ).damage / secs;
      partyDpsCache.set(key, v);
    }
    return v;
  }

  /** DPS_solo_ref(m): média do DPS em alvo único de mago, caçador e assassino, 60 s. */
  function referenceSoloDps(m: number, o: SimOptions = {}): number {
    const key = `${m}:${o.source ?? "gabarito"}:${o.referenceAi ?? ""}:${o.solo ? "solo" : ""}:${o.kits ? "k" : ""}:${o.potions ? "p" : ""}`;
    let v = soloDpsCache.get(key);
    if (v === undefined) {
      let sum = 0;
      for (const k of ["mago", "cacador", "assassino"] as const)
        sum += run([k], [dummy(m)], 60, calibration(o)).damage / 60;
      v = sum / 3;
      soloDpsCache.set(key, v);
    }
    return v;
  }

  /** Chefe de masmorra (§11.2) para um grupo de `partySize` (escala mínima de 3). */
  function dungeonBoss(
    m: number,
    partySize: number,
    o: SimOptions = {},
  ): EnemyInput {
    const mon = cfg.monsters;
    const hits = R.monsterHits(m);
    const scale = B.partyScale(partySize, "masmorra");
    return {
      archetype: "chefe",
      level: m,
      hp:
        (mon.masmorraHpSeconds * referencePartyDps(m, o) * scale) /
        mon.masmorraHpDivisor,
      autoRaw: hits.chefe,
      attacksPerSecond: cfg.archetypes.chefe.aps,
      buster: { everySeconds: mon.busterEverySeconds, mult: mon.busterMult },
      pulse: { everySeconds: mon.pulseEverySeconds, raw: hits.pulso },
      cataclysm: {
        atSeconds: mon.cataclysmAtSeconds,
        pct: mon.cataclysmPct,
        everySeconds: mon.cataclysmEverySeconds,
      },
    };
  }

  /** Chefe menor da Caçada (§11.2): 25 s do DPS solo de referência, Cataclismo aos 120 s. */
  function huntBoss(m: number, o: SimOptions = {}): EnemyInput {
    const mon = cfg.monsters;
    return {
      archetype: "chefeMenor",
      level: m,
      hp: mon.menorHpSeconds * referenceSoloDps(m, o),
      autoRaw: R.monsterHits(m).chefeMenor,
      attacksPerSecond: cfg.archetypes.chefeMenor.aps,
      cataclysm: {
        atSeconds: mon.menorCataclysmAtSeconds,
        pct: mon.cataclysmPct,
        everySeconds: mon.cataclysmEverySeconds,
      },
    };
  }

  /** Uma PT contra o chefe de masmorra do nível m (heróis em m, ou nos níveis dados). */
  function dungeonFight(
    comp: ClassId[],
    m: number,
    o: SimOptions = {},
    levels?: number[],
  ): FightResult {
    return run(comp, [dungeonBoss(m, comp.length, o)], 240, o, levels);
  }

  /** Um herói sozinho contra o chefe menor do próprio nível. */
  function huntFight(cls: ClassId, m: number, o: SimOptions = {}): FightResult {
    return run([cls], [huntBoss(m, o)], 130, o);
  }

  /** Dano por segundo de uma classe sozinha contra o boneco. */
  function soloDps(
    cls: ClassId,
    m: number,
    seconds: number,
    o: SimOptions = {},
  ): number {
    return (
      run([cls], [dummy(m)], seconds, { ...o, mode: "esperado" }).damage /
      seconds
    );
  }

  return {
    fighter,
    dummy,
    run,
    referencePartyDps,
    referenceSoloDps,
    dungeonBoss,
    huntBoss,
    dungeonFight,
    huntFight,
    soloDps,
  };
}

export type Encounters = ReturnType<typeof createEncounters>;

export const encounters: Encounters = createEncounters();

/** D41: os heróis no perfil do limite, contra quem os monstros são feitos (testes de corrida). */
export const limitEncounters: Encounters = createEncounters(
  gameBalance,
  "limite",
);
