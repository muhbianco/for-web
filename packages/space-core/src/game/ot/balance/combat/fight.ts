import type { HeroStats } from "../formulas.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import type {
  BuffStat,
  DebuffStat,
  Effect,
  Element,
  EnemyInput,
  FighterInput,
  FightOptions,
  FightResult,
  SkillDef,
} from "./types.ts";

/**
 * O motor de luta da engine nova (spec §5): tiques de 0,1 s, a ordem do golpe, os tipos de dano, a
 * diferença de nível, a ameaça (110% para trocar, provocar a 150%), a IA das skills com condições e
 * "Segurar explosão", poções de 1 por segundo e a regeneração.
 *
 * Dois modos: "esperado" troca cada rolagem pelo valor médio (é o modelo do gabarito em Python, que
 * calibrou o spec, e serve para a paridade e para afinar números); "aleatorio" rola de verdade, com a
 * fonte de números passada em `opts.random` (é o jogo e o Monte Carlo da §14.9).
 *
 * A ordem de um tique segue a do gabarito: alvo de cada inimigo → Cataclismo → ações dos inimigos →
 * cada herói vivo, na ordem do grupo (mana, HoTs, poção, auto-ataque, DoTs, skill).
 */

export const TICK_SECONDS = 0.1;

/** Fonte de números em [0, 1) a partir do RNG com semente do jogo (game/rng.ts). */
export function randomSource(rng: { u32(): number }): { next(): number } {
  return { next: () => rng.u32() / 4294967296 };
}

interface Timed {
  stat: BuffStat | DebuffStat;
  value: number;
  until: number;
}

interface Hero {
  i: number;
  input: FighterInput;
  ch: HeroStats;
  hp: number;
  mp: number;
  alive: boolean;
  /** Ameaça em cada inimigo. */
  threat: number[];
  cds: Map<string, number>;
  gcd: number;
  auto: number;
  potCd: number;
  pots: number;
  shield: number;
  shieldUntil: number;
  manaShield: { pct: number; until: number } | null;
  buffs: Map<string, Timed>;
  hots: { perSec: number; until: number; src: Hero }[];
  dots: { perSec: number; until: number; enemy: number }[];
  damage: number;
  autoDamage: number;
  healed: number;
  potionsUsed: number;
  hpPotions: number;
  mpPotions: number;
}

interface Enemy {
  i: number;
  input: EnemyInput;
  hp: number;
  alive: boolean;
  target: Hero | null;
  forced: Hero | null;
  forcedUntil: number;
  autoTimer: number;
  busterTimer: number;
  pulseTimer: number;
  debuffs: Map<string, Timed>;
}

const BOSSES = new Set(["chefe", "chefeMenor", "regional"]);

/** O multiplicador total de dano de uma skill (soma das partes × golpes): ≥ 300% obedece "Segurar explosão". */
export function skillTotalMultiplier(s: SkillDef): number {
  let total = 0;
  for (const e of s.effects)
    if (e.type === "dano")
      for (const p of e.parts)
        total = Math.max(
          total,
          p.element === "fisico" ? p.coef * (e.hits ?? 1) : p.coef,
        );
  return total;
}

export function fight(
  heroInputs: FighterInput[],
  enemyInputs: EnemyInput[],
  opts: FightOptions,
  B: Balance = gameBalance,
): FightResult {
  const cfg = B.cfg;
  const DT = TICK_SECONDS;
  const expected = opts.mode === "esperado";
  const rnd = (): number => {
    if (!opts.random) throw new Error("modo aleatório sem fonte de números");
    return opts.random.next();
  };

  const heroes: Hero[] = heroInputs.map((input, i) => ({
    i,
    input,
    ch: input.stats,
    hp: input.stats.hp,
    mp: input.stats.mp,
    alive: true,
    threat: enemyInputs.map(() => 0),
    cds: new Map(),
    gcd: 0,
    auto: 0,
    potCd: 0,
    pots: input.potions.stock,
    shield: 0,
    shieldUntil: 0,
    manaShield: null,
    buffs: new Map(),
    hots: [],
    dots: [],
    damage: 0,
    autoDamage: 0,
    healed: 0,
    potionsUsed: 0,
    hpPotions: 0,
    mpPotions: 0,
  }));
  const enemies: Enemy[] = enemyInputs.map((input, i) => ({
    i,
    input,
    hp: input.hp,
    alive: true,
    target: null,
    forced: null,
    forcedUntil: 0,
    autoTimer: 0,
    busterTimer: input.buster?.everySeconds ?? Infinity,
    pulseTimer: input.pulse?.everySeconds ?? Infinity,
    debuffs: new Map(),
  }));
  const partyBuffs = new Map<string, Timed>();

  let t = 0;
  let total = 0;
  let deaths = 0;
  let firstDeath: FightResult["firstDeath"] = null;

  const active = (m: Map<string, Timed>, stat: Timed["stat"]): Timed[] => {
    const out: Timed[] = [];
    for (const b of m.values()) if (b.stat === stat && b.until > t) out.push(b);
    return out;
  };
  const sum = (xs: Timed[]): number => xs.reduce((a, b) => a + b.value, 0);
  const aliveHeroes = (): Hero[] => heroes.filter((h) => h.alive);
  const aliveEnemies = (): Enemy[] => enemies.filter((e) => e.alive);
  const focus = (): Enemy | null => enemies.find((e) => e.alive) ?? null;

  const die = (h: Hero, cause: "golpe" | "cataclismo") => {
    h.alive = false;
    h.hp = 0;
    deaths++;
    if (!firstDeath)
      firstDeath = {
        seconds: Math.round(t * 10) / 10,
        cls: h.input.cls,
        cause,
      };
  };

  // -------------------------------------------------------------- herói → inimigo

  /** Dano de 1 golpe do herói no inimigo, antes dos bônus % (passo 6) e já com a defesa do alvo. */
  const heroHit = (
    h: Hero,
    e: Enemy,
    mult: number,
    element: Element,
    o: {
      critFlat?: number;
      critMult?: number;
      pen?: number;
      canCrit?: boolean;
      dot?: boolean;
    } = {},
  ): { value: number; landed: boolean } => {
    const ch = h.ch;
    const arch = e.input.archetype;
    const m = e.input.level;
    const avgRoll = (ch.minRoll + 1) / 2;
    const roll = () => ch.minRoll + (1 - ch.minRoll) * rnd();
    if (element === "sagrado") {
      const red = 1 - B.monsterReduction(arch, m, ch.level, true, o.pen ?? 0);
      const r = expected || o.dot ? avgRoll : roll();
      return { value: ch.atk * mult * r * red, landed: true };
    }
    const magic = element === "magico";
    const base = magic ? ch.matk : ch.atk;
    const mon = B.monsterStats(arch, m);
    const c =
      (o.canCrit ?? true) && !magic
        ? B.critChance(ch.critRating, mon.critRes, o.critFlat ?? 0)
        : 0;
    const critMult = cfg.crit.multiplier + (o.critMult ?? 0);
    const miss = magic ? 0 : B.heroMissChance(ch.hit, mon.flee, false);
    const red =
      1 -
      B.monsterReduction(
        arch,
        m,
        ch.level,
        magic,
        (o.pen ?? 0) + ch.penetration,
      );
    if (expected || o.dot) {
      const expMult = (1 - c) * avgRoll + c * critMult;
      // No DoT do modo aleatório o erro já foi rolado no golpe que o aplicou.
      const hit = expected ? 1 - miss : 1;
      return { value: base * mult * expMult * hit * red, landed: true };
    }
    if (rnd() < miss) return { value: 0, landed: false };
    const r = rnd() < c ? critMult : roll();
    return { value: base * mult * r * red, landed: true };
  };

  /** Passos 6 a 10 do lado do inimigo: bônus %, Marca, diferença de nível; ameaça e roubo de vida. */
  const deal = (h: Hero, e: Enemy, amount: number): number => {
    let mult = 1;
    for (const b of active(partyBuffs, "dano")) mult *= 1 + b.value;
    for (const b of active(e.debuffs, "danoRecebido")) mult *= 1 + b.value;
    amount *= mult * (1 + B.levelDiffMod(h.ch.level - e.input.level));
    e.hp -= amount;
    if (e.hp <= 0) e.alive = false;
    total += amount;
    h.damage += amount;
    h.threat[e.i]! += amount * h.ch.threat;
    if (h.input.lifesteal) heal(h, amount * h.input.lifesteal, null);
    return amount;
  };

  const heal = (h: Hero, amount: number, src: Hero | null) => {
    if (!h.alive) return;
    const real = Math.min(amount, h.ch.hp - h.hp);
    h.hp += real;
    if (src) {
      src.healed += real;
      const share =
        (cfg.threat.healShare * real) / Math.max(1, aliveHeroes().length);
      for (const e of enemies) if (e.alive) src.threat[e.i]! += share;
    }
  };

  // -------------------------------------------------------------- inimigo → herói

  const takenMult = (h: Hero, e: Enemy, magic: boolean): number => {
    let m = 1;
    for (const b of active(h.buffs, "reducao")) m *= 1 - b.value;
    for (const b of active(partyBuffs, "reducao")) m *= 1 - b.value;
    for (const b of active(e.debuffs, "danoCausado")) m *= 1 - b.value;
    for (const b of active(
      partyBuffs,
      magic ? "reducaoMagica" : "reducaoFisica",
    ))
      m *= 1 - b.value;
    for (const b of active(h.buffs, magic ? "reducaoMagica" : "reducaoFisica"))
      m *= 1 - b.value;
    return m;
  };

  const hurt = (
    h: Hero,
    e: Enemy,
    raw: number,
    o: { magic?: boolean; certeiro?: boolean } = {},
  ) => {
    if (!h.alive) return;
    const ch = h.ch;
    const m = e.input.level;
    const magic = o.magic ?? false;
    if (!o.certeiro && !magic) {
      const attackers = enemies.filter((x) => x.alive && x.target === h).length;
      const av = B.avoidChance(
        ch.flee,
        ch.luck,
        B.monsterStats(e.input.archetype, m).hit,
        m,
        {
          attackers: Math.max(1, attackers),
        },
      );
      const blk = ch.block + (ch.block > 0 ? (h.input.blockBonus ?? 0) : 0);
      if (expected) {
        raw *= 1 - av;
        raw *= 1 - cfg.block.reduce * blk;
      } else {
        if (rnd() < av) return;
        if (rnd() < blk) raw *= 1 - cfg.block.reduce;
      }
    }
    const red = magic
      ? B.magicReduction(ch.mdef, m)
      : B.heroPhysicalReduction(ch.def, m);
    let d =
      raw *
      B.capTakenMultiplier((1 - red) * takenMult(h, e, magic)) *
      (1 - B.levelDiffMod(ch.level - m));
    if (h.manaShield && h.manaShield.until > t) {
      const take = Math.min(d * h.manaShield.pct, h.mp);
      h.mp -= take;
      d -= take;
    }
    if (h.shield > 0 && h.shieldUntil > t) {
      const a = Math.min(h.shield, d);
      h.shield -= a;
      d -= a;
    }
    h.hp -= d;
    if (h.hp <= 0 && h.alive) die(h, "golpe");
  };

  // -------------------------------------------------------------- IA

  const lowest = (below: number): Hero | null => {
    let best: Hero | null = null;
    for (const q of heroes) {
      if (!q.alive) continue;
      const r = q.hp / q.ch.hp;
      if (r >= below) continue;
      if (!best || r < best.hp / best.ch.hp) best = q;
    }
    return best;
  };

  const targetedBySome = (h: Hero): boolean =>
    enemies.some((e) => e.alive && e.target === h);

  const conditionHolds = (
    h: Hero,
    s: SkillDef,
  ): { ok: boolean; ally?: Hero } => {
    const c = s.condition;
    switch (c.kind) {
      case "sempre":
        return { ok: true };
      case "soEmChefe":
        return {
          ok: enemies.some((e) => e.alive && BOSSES.has(e.input.archetype)),
        };
      case "inimigos":
        return { ok: aliveEnemies().length >= c.min };
      case "aliadoAbaixo": {
        const ally = lowest(c.pct);
        return ally ? { ok: true, ally } : { ok: false };
      }
      case "meuHpAbaixo":
        return { ok: h.hp / h.ch.hp < c.pct };
      case "sendoAlvo":
        return { ok: targetedBySome(h) };
      case "chefePreparando":
        return {
          ok: enemies.some(
            (e) =>
              e.alive &&
              e.input.buster !== undefined &&
              e.busterTimer <= cfg.monsters.warningSeconds,
          ),
        };
      case "perdiAggro":
        return {
          ok: enemies.some(
            (e) => e.alive && e.target !== null && e.target !== h,
          ),
        };
    }
  };

  const burstHeld = (h: Hero, s: SkillDef): boolean => {
    if (h.input.role === "tanque") return false;
    if (skillTotalMultiplier(s) < cfg.threat.burstMultiplierFrom) return false;
    const e = focus();
    if (!e) return false;
    const tanks = heroes.filter((q) => q.alive && q.input.role === "tanque");
    if (tanks.length === 0) return false;
    const top = Math.max(...tanks.map((q) => q.threat[e.i]!));
    return h.threat[e.i]! > cfg.threat.burstGuard * top;
  };

  const buffSum = (h: Hero, stat: BuffStat): number =>
    sum(active(h.buffs, stat));

  /** Executa os efeitos da skill; `false` quando ela não tem o que fazer (o herói tenta a próxima). */
  const cast = (h: Hero, s: SkillDef, ally: Hero | undefined): boolean => {
    const pm = B.potencyMult(h.input.potencyRank);
    const hb = 1 + (h.input.healBonus ?? 0);
    const e = focus();
    let landed = true;

    // O Rejuvenescer acumula até `stacks` no mesmo alvo; cheio, procura outro aliado.
    for (const eff of s.effects)
      if (eff.type === "hot" && eff.target === "aliado") {
        const cap = eff.stacks ?? 1;
        const count = (q: Hero) => q.hots.filter((x) => x.until > t).length;
        const below = s.condition.kind === "aliadoAbaixo" ? s.condition.pct : 1;
        if (!ally || count(ally) >= cap) {
          let best: Hero | null = null;
          for (const q of heroes)
            if (q.alive && count(q) < cap && q.hp / q.ch.hp < below)
              if (!best || q.hp / q.ch.hp < best.hp / best.ch.hp) best = q;
          if (!best) return false;
          ally = best;
        }
      }

    for (const eff of s.effects)
      applyEffect(
        h,
        s,
        eff,
        e,
        ally,
        pm,
        hb,
        () => landed,
        (v) => (landed = v),
      );
    return true;
  };

  const applyEffect = (
    h: Hero,
    s: SkillDef,
    eff: Effect,
    e: Enemy | null,
    ally: Hero | undefined,
    pm: number,
    hb: number,
    wasLanded: () => boolean,
    setLanded: (v: boolean) => void,
  ) => {
    switch (eff.type) {
      case "dano": {
        const targets = eff.area ? aliveEnemies() : e ? [e] : [];
        for (const x of targets) {
          let critFlat = (eff.critFlat ?? 0) + buffSum(h, "critico");
          if (eff.ambush && x.target !== h) critFlat = 1;
          const critMult = buffSum(h, "multCritico") + h.ch.critMultBonus;
          let d = 0;
          let any = false;
          for (const p of eff.parts) {
            const hits = p.element === "fisico" ? (eff.hits ?? 1) : 1;
            for (let k = 0; k < (expected ? 1 : hits); k++) {
              const r = heroHit(h, x, p.coef * pm, p.element, {
                critFlat,
                critMult,
                pen: p.element === "sagrado" ? 0 : eff.penetration,
              });
              d += expected ? r.value * hits : r.value;
              any ||= r.landed;
            }
          }
          setLanded(any);
          const dealt = deal(h, x, d);
          if (s.threatMult)
            h.threat[x.i]! += dealt * h.ch.threat * (s.threatMult - 1);
        }
        return;
      }
      case "dot": {
        if (!e || !wasLanded()) return;
        const per = heroHit(h, e, eff.coefPerSec * pm, eff.element, {
          canCrit: false,
          dot: !expected,
        }).value;
        h.dots.push({
          perSec: per,
          until: t + eff.durationMs / 1000,
          enemy: e.i,
        });
        return;
      }
      case "cura": {
        const targets =
          eff.target === "grupo"
            ? heroes
            : eff.target === "proprio"
              ? [h]
              : ally
                ? [ally]
                : [];
        const src = eff.target === "proprio" ? null : h;
        for (const q of targets) {
          let amount = 0;
          if (eff.coefMatk)
            amount += eff.coefMatk * h.ch.matk * pm * (eff.noBonus ? 1 : hb);
          if (eff.pctMaxHp) amount += eff.pctMaxHp * q.ch.hp;
          heal(q, amount, src);
        }
        return;
      }
      case "hot": {
        const targets =
          eff.target === "grupo" ? aliveHeroes() : ally ? [ally] : [];
        const per =
          eff.coefMatkPerSec * h.ch.matk * pm * (hb + (h.input.hotBonus ?? 0));
        for (const q of targets)
          q.hots.push({
            perSec: per,
            until: t + eff.durationMs / 1000,
            src: h,
          });
        return;
      }
      case "escudo": {
        const tt =
          eff.target === "proprio"
            ? h
            : e && e.target && e.target.alive
              ? e.target
              : h;
        tt.shield =
          (eff.pctMaxHp ?? 0) * tt.ch.hp + (eff.coefMatk ?? 0) * h.ch.matk * pm;
        tt.shieldUntil = t + eff.durationMs / 1000;
        return;
      }
      case "escudoDeMana":
        h.manaShield = { pct: eff.pct, until: t + eff.durationMs / 1000 };
        return;
      case "buff": {
        const map = eff.target === "grupo" ? partyBuffs : h.buffs;
        map.set(eff.group ?? `${s.id}:${eff.stat}`, {
          stat: eff.stat,
          value: eff.value,
          until: t + eff.durationMs / 1000,
        });
        return;
      }
      case "debuff":
        if (!e) return;
        e.debuffs.set(eff.group ?? `${s.id}:${eff.stat}`, {
          stat: eff.stat,
          value: eff.value,
          until: t + eff.durationMs / 1000,
        });
        return;
      case "provocar": {
        const targets = eff.scope === "sala" ? aliveEnemies() : e ? [e] : [];
        for (const x of targets) {
          x.forced = h;
          x.forcedUntil = t + eff.durationMs / 1000;
          const top = Math.max(...heroes.map((q) => q.threat[x.i]!));
          h.threat[x.i] = Math.max(h.threat[x.i]!, top * cfg.threat.tauntTop);
        }
        return;
      }
    }
  };

  // -------------------------------------------------------------- laço

  while (
    t < opts.maxSeconds &&
    enemies.some((e) => e.alive) &&
    heroes.some((h) => h.alive)
  ) {
    const alive = aliveHeroes();

    // Alvo de cada inimigo: provocação; senão quem passar de 110% da ameaça do alvo atual.
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.forced && e.forcedUntil > t && e.forced.alive) e.target = e.forced;
      else {
        let best = alive[0]!;
        for (const q of alive) if (q.threat[e.i]! > best.threat[e.i]!) best = q;
        if (
          !e.target ||
          !e.target.alive ||
          best.threat[e.i]! > cfg.threat.switchAt * e.target.threat[e.i]!
        )
          e.target = best;
      }
    }

    // Cataclismo: fração do HP máximo de cada herói, dano verdadeiro, a cada N s.
    let wiped = false;
    for (const e of enemies) {
      const c = e.input.cataclysm;
      if (!e.alive || !c || t < c.atSeconds) continue;
      if (Math.trunc(t / DT) % Math.trunc(c.everySeconds / DT) !== 0) continue;
      for (const q of heroes) {
        if (!q.alive) continue;
        q.hp -= c.pct * q.ch.hp;
        if (q.hp <= 0) die(q, "cataclismo");
      }
      if (!heroes.some((q) => q.alive)) wiped = true;
    }
    if (wiped) break;

    // Ações dos inimigos.
    for (const e of enemies) {
      if (!e.alive || !e.target) continue;
      e.autoTimer -= DT;
      if (e.autoTimer <= 0) {
        hurt(e.target, e, e.input.autoRaw, {
          magic: e.input.magicAuto ?? false,
        });
        e.autoTimer += 1 / e.input.attacksPerSecond;
      }
      if (e.input.buster) {
        e.busterTimer -= DT;
        if (e.busterTimer <= 0) {
          hurt(e.target, e, e.input.autoRaw * e.input.buster.mult, {
            certeiro: true,
          });
          e.busterTimer += e.input.buster.everySeconds;
        }
      }
      if (e.input.pulse) {
        e.pulseTimer -= DT;
        if (e.pulseTimer <= 0) {
          for (const q of heroes)
            if (q.alive) hurt(q, e, e.input.pulse.raw, { magic: true });
          e.pulseTimer += e.input.pulse.everySeconds;
        }
      }
    }

    // Heróis.
    for (const h of heroes) {
      if (!h.alive) continue;
      const ch = h.ch;
      const regen =
        ch.mp * cfg.regen.mpPctPerSecond +
        cfg.regen.mpPerIntPerSecond * ch.attrs.INT +
        ch.mp * sum(active(partyBuffs, "regenManaPct"));
      h.mp = Math.min(ch.mp, h.mp + regen * DT);

      h.hots = h.hots.filter((x) => {
        if (x.until > t) {
          heal(h, x.perSec * DT, x.src);
          return true;
        }
        return false;
      });

      h.potCd -= DT;
      if (h.potCd <= 0 && h.pots > 0) {
        const at = h.input.potionAt ?? { hp: 0.5, mp: 0.3 };
        if (h.hp / ch.hp < at.hp) {
          heal(h, h.input.potions.hp, null);
          h.pots--;
          h.potionsUsed++;
          h.hpPotions++;
          h.potCd = cfg.potions.cooldownMs / 1000;
        } else if (h.mp / ch.mp < at.mp) {
          h.mp = Math.min(ch.mp, h.mp + h.input.potions.mp);
          h.pots--;
          h.potionsUsed++;
          h.mpPotions++;
          h.potCd = cfg.potions.cooldownMs / 1000;
        }
      }

      h.auto -= DT;
      if (h.auto <= 0) {
        const e = focus();
        if (e) {
          const r =
            ch.kind === "magic"
              ? heroHit(h, e, h.input.magicAutoAttack ?? 0.6, "magico")
              : heroHit(h, e, 1, "fisico", {
                  critFlat: buffSum(h, "critico"),
                  critMult: buffSum(h, "multCritico") + ch.critMultBonus,
                });
          h.autoDamage += deal(h, e, r.value);
        }
        h.auto += 1 / ch.attacksPerSecond;
      }

      h.dots = h.dots.filter((x) => {
        if (x.until <= t) return false;
        const e = enemies[x.enemy];
        if (e && e.alive) deal(h, e, x.perSec * DT);
        return true;
      });

      h.gcd -= DT;
      if (h.gcd > 0) continue;
      for (const s of h.input.skills) {
        if ((h.cds.get(s.id) ?? 0) > t) continue;
        const cost = s.manaPct * ch.manaBase;
        if (cost > h.mp) continue;
        const cond = conditionHolds(h, s);
        if (!cond.ok) continue;
        if (burstHeld(h, s)) continue;
        if (!cast(h, s, cond.ally)) continue;
        h.mp -= cost;
        h.cds.set(
          s.id,
          t + B.skillCooldown(s.cooldownMs / 1000, ch.cooldownCut),
        );
        h.gcd = cfg.skills.gcdMs / 1000;
        break;
      }
    }

    t += DT;
  }

  return {
    win: enemies.every((e) => !e.alive),
    seconds: Math.round(t * 10) / 10,
    deaths,
    firstDeath,
    damage: total,
    enemiesLeft: enemies.map((e) => Math.max(0, e.hp) / e.input.hp),
    heroes: heroes.map((h) => ({
      cls: h.input.cls,
      damage: h.damage,
      autoDamage: h.autoDamage,
      healed: h.healed,
      hpPct: h.hp / h.ch.hp,
      potionsUsed: h.potionsUsed,
      hpPotions: h.hpPotions,
      mpPotions: h.mpPotions,
      alive: h.alive,
    })),
  };
}
