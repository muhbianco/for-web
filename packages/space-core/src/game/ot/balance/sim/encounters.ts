import { fight } from "../combat/fight.ts";
import type {
  EnemyInput,
  FighterInput,
  FightOptions,
  FightResult,
  SkillDef,
} from "../combat/types.ts";
import { type ClassId, CLASSES, FAMILIES } from "../content.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Reference, createReference } from "../reference.ts";
import { GABARITO_KITS } from "./kits.ts";

/**
 * Os encontros que calibram o spec (§11.2), montados dos perfis de referência: o chefe de masmorra,
 * o chefe menor da Caçada e o boneco de treino (alvo de HP infinito que só apanha). Na Fase 6 isto
 * vira o gerador de monstros; por ora é o que os invariantes da §14 usam.
 */

export interface SimOptions {
  /** Kit por classe (padrão: os de referência do gabarito). */
  kits?: Record<ClassId, SkillDef[]>;
  /** Cura das poções no lugar da do jogo (o gabarito usa poção fracionária). */
  potions?: (level: number) => { hp: number; mp: number };
  mode?: FightOptions["mode"];
  random?: FightOptions["random"];
  /** Proficiência dos heróis (padrão: 10 × nível). O chefe continua calibrado na referência. */
  proficiency?: (level: number) => number;
}

/** O que calibra o chefe: só o kit e as poções; a proficiência e o modo são dos heróis da luta. */
function calibration(o: SimOptions): SimOptions {
  return {
    ...(o.kits ? { kits: o.kits } : {}),
    ...(o.potions ? { potions: o.potions } : {}),
    mode: "esperado",
  };
}

export function createEncounters(B: Balance = gameBalance) {
  const R: Reference = createReference(B);
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
    return {
      cls,
      stats: h,
      role: c.role,
      skills: (o.kits ?? GABARITO_KITS)[cls],
      potencyRank: B.referencePotencyRank(h.tier, h.job),
      lifesteal: c.trait.lifesteal ?? 0,
      blockBonus: c.trait.blockBonus ?? 0,
      healBonus: (c.trait.healBonus ?? 0) + (fam.healBonus ?? 0),
      hotBonus: c.trait.hotBonus ?? 0,
      magicAutoAttack: fam.magicAutoAttack ?? c.trait.magicAutoAttack ?? 0.6,
      potions: { ...pot, stock: 100 },
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
    const key = `${m}:${o.kits ? "k" : ""}:${o.potions ? "p" : ""}`;
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
    const key = `${m}:${o.kits ? "k" : ""}:${o.potions ? "p" : ""}`;
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
