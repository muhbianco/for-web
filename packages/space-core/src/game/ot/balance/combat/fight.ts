import type { HeroStats } from "../formulas.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import type {
  BuffStat,
  Condition,
  DebuffStat,
  Effect,
  Element,
  EnemyInput,
  FighterInput,
  FightOptions,
  FightResult,
  SkillDef,
  SkillHook,
} from "./types.ts";

/**
 * O motor de luta da engine nova (spec §5): tiques de 0,1 s, a ordem do golpe, os tipos de dano, a
 * diferença de nível, a ameaça (110% para trocar, provocar a 150%), a IA das skills com condições e
 * "Segurar explosão", poções de 1 por segundo, a regeneração e os efeitos e adereços das 42 skills.
 *
 * Dois modos: "esperado" troca cada rolagem pelo valor médio (é o modelo do gabarito em Python, que
 * calibrou o spec, e serve para a paridade e para afinar números); "aleatorio" rola de verdade, com a
 * fonte de números passada em `opts.random` (é o jogo e o Monte Carlo da §14.9). No modo esperado,
 * as chances de adereço (proc) viram um acumulador: dispara quando a soma das chances passa de 1, o
 * que mantém a taxa média sem sorteio.
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

interface Dot {
  key: string;
  perSec: number;
  until: number;
  enemy: number;
  nextPulse: number;
  tickStun?: { chance: number; durationMs: number };
}

interface Hero {
  i: number;
  input: FighterInput;
  ch: HeroStats;
  hp: number;
  mp: number;
  alive: boolean;
  revived: boolean;
  cheatedDeath: boolean;
  /** Ameaça em cada inimigo. */
  threat: number[];
  cds: Map<string, number>;
  gcd: number;
  auto: number;
  potCd: number;
  pots: number;
  shield: number;
  shieldUntil: number;
  /** O que acontece quando o escudo atual quebra (Reflexo Sagrado, Espinhos de Luz). */
  shieldBreak: {
    pct: number;
    targets: "area" | "atacante";
    caster: Hero;
    absorbed: number;
  } | null;
  manaShield: {
    pct: number;
    until: number;
    spent: number;
    refund: number;
  } | null;
  buffs: Map<string, Timed>;
  /** Efeitos negativos no herói (Maldição, Drenar Mana), removíveis por purificação. */
  debuffs: Map<string, { kind: string; until: number; value: number }>;
  hots: {
    key: string;
    perSec: number;
    pctMaxHpPerSec: number;
    until: number;
    src: Hero;
  }[];
  dots: Dot[];
  /** Ganchos que valem por um tempo (Espinhos de Aço enquanto a Muralha dura). */
  windows: { hook: SkillHook; until: number }[];
  /** Conjuração em andamento (Meteoro). */
  casting: { skill: SkillDef; until: number; ally: Hero | undefined } | null;
  /** Bloqueou desde o último uso desta skill (Martelo da Justiça). */
  blockedSince: Set<string>;
  /** Acumuladores de chance do modo esperado. */
  acc: Map<string, number>;
  damage: number;
  autoDamage: number;
  healed: number;
  potionsUsed: number;
  hpPotions: number;
  mpPotions: number;
  casts: Record<string, number>;
}

interface Enemy {
  i: number;
  input: EnemyInput;
  hp: number;
  alive: boolean;
  target: Hero | null;
  forced: Hero | null;
  forcedUntil: number;
  stunnedUntil: number;
  autoTimer: number;
  busterTimer: number;
  pulseTimer: number;
  curseTimer: number;
  summonTimer: number;
  drainTimer: number;
  chargeTimer: number;
  finalTimer: number;
  /** Já passou do limiar da fase 2. */
  inPhase: boolean;
  /** Rodízio de quem a mecânica escolhe no modo esperado. */
  pick: number;
  debuffs: Map<string, Timed>;
}

const BOSSES = new Set(["chefe", "chefeMenor", "regional"]);

/** Quem o Drenar Mana pega: as classes que vivem de magia. */
const CASTERS = new Set(["padre", "druida", "mago"]);

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

function conditions(s: SkillDef): Condition[] {
  return Array.isArray(s.condition) ? s.condition : [s.condition];
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
    hp: opts.carry?.[i]?.hp ?? input.stats.hp,
    mp: opts.carry?.[i]?.mp ?? input.stats.mp,
    alive: opts.carry?.[i]?.alive ?? true,
    revived: opts.carry?.[i]?.revived ?? false,
    cheatedDeath: opts.carry?.[i]?.cheatedDeath ?? false,
    threat: enemyInputs.map(() => 0),
    cds: new Map(Object.entries(opts.carry?.[i]?.cooldowns ?? {})),
    gcd: 0,
    auto: 0,
    potCd: 0,
    pots: opts.carry?.[i]?.pots ?? input.potions.stock,
    shield: 0,
    shieldUntil: 0,
    shieldBreak: null,
    manaShield: null,
    buffs: new Map(),
    debuffs: new Map(),
    hots: [],
    dots: [],
    windows: [],
    casting: null,
    blockedSince: new Set(),
    acc: new Map(),
    damage: 0,
    autoDamage: 0,
    healed: 0,
    potionsUsed: 0,
    hpPotions: 0,
    mpPotions: 0,
    casts: {},
  }));
  const newEnemy = (input: EnemyInput, i: number): Enemy => ({
    i,
    input,
    hp: input.hp,
    alive: true,
    target: null,
    forced: null,
    forcedUntil: 0,
    stunnedUntil: 0,
    autoTimer: 0,
    busterTimer: input.buster?.everySeconds ?? Infinity,
    pulseTimer: input.pulse?.everySeconds ?? Infinity,
    curseTimer: input.curse?.everySeconds ?? Infinity,
    summonTimer: input.summon?.everySeconds ?? Infinity,
    drainTimer: input.manaDrain?.everySeconds ?? Infinity,
    chargeTimer: input.charge?.everySeconds ?? Infinity,
    finalTimer: 0,
    inPhase: false,
    pick: 0,
    debuffs: new Map(),
  });
  const enemies: Enemy[] = enemyInputs.map(newEnemy);
  const partyBuffs = new Map<string, Timed>();
  const partyPurges: {
    count: number;
    every: number;
    next: number;
    until: number;
  }[] = [];

  let t = 0;
  let total = 0;
  let deaths = 0;
  let firstDeath: FightResult["firstDeath"] = null;
  let roundRobin = 0;

  const active = (m: Map<string, Timed>, stat: Timed["stat"]): Timed[] => {
    const out: Timed[] = [];
    for (const b of m.values()) if (b.stat === stat && b.until > t) out.push(b);
    return out;
  };
  const sum = (xs: Timed[]): number => xs.reduce((a, b) => a + b.value, 0);
  const prod = (xs: Timed[]): number =>
    xs.reduce((a, b) => a * (1 - b.value), 1);
  const aliveHeroes = (): Hero[] => heroes.filter((h) => h.alive);
  const aliveEnemies = (): Enemy[] => enemies.filter((e) => e.alive);
  const focus = (): Enemy | null => enemies.find((e) => e.alive) ?? null;
  const isBoss = (e: Enemy) => BOSSES.has(e.input.archetype);
  /** Buff do próprio herói + o do grupo. */
  const buffOf = (h: Hero, stat: BuffStat): number =>
    sum(active(h.buffs, stat)) + sum(active(partyBuffs, stat));
  const maxHp = (h: Hero): number => h.ch.hp * (1 + buffOf(h, "hpMaxPct"));
  const ratio = (h: Hero): number => h.hp / maxHp(h);

  /** Chance: rola no aleatório; no esperado, acumula e dispara a cada 1 inteiro. */
  const proc = (h: Hero, key: string, chance: number): boolean => {
    if (chance <= 0) return false;
    if (chance >= 1) return true;
    if (!expected) return rnd() < chance;
    const v = (h.acc.get(key) ?? 0) + chance;
    if (v >= 1) {
      h.acc.set(key, v - 1);
      return true;
    }
    h.acc.set(key, v);
    return false;
  };

  const die = (h: Hero, cause: "golpe" | "cataclismo" | "mecanica") => {
    h.alive = false;
    h.hp = 0;
    h.casting = null;
    deaths++;
    if (!firstDeath)
      firstDeath = {
        seconds: Math.round(t * 10) / 10,
        cls: h.input.cls,
        cause,
      };
  };

  // -------------------------------------------------------------- herói → inimigo

  const enemyReduction = (
    e: Enemy,
    heroLevel: number,
    magic: boolean,
    pen: number,
  ): number => {
    const mon = B.monsterStats(e.input.archetype, e.input.level);
    const defMult = magic ? 1 : prod(active(e.debuffs, "defesa"));
    const d = (magic ? mon.mdef : mon.def) * (1 - pen) * defMult;
    return B.reduction(
      d,
      heroLevel,
      magic ? cfg.defense.magicCap : cfg.defense.monsterPhysicalCap,
    );
  };

  interface HitOpts {
    critFlat?: number;
    critMult?: number;
    pen?: number;
    canCrit?: boolean;
    /** DoT no modo aleatório: o erro já foi rolado no golpe que o aplicou; vale a rolagem média. */
    dot?: boolean;
    forceCrit?: boolean;
  }

  /** Dano de 1 golpe do herói no inimigo, antes dos bônus % (passo 6) e já com a defesa do alvo. */
  const heroHit = (
    h: Hero,
    e: Enemy,
    mult: number,
    element: Element,
    o: HitOpts = {},
  ): { value: number; landed: boolean } => {
    const ch = h.ch;
    const arch = e.input.archetype;
    const m = e.input.level;
    const power = 1 + buffOf(h, "poder");
    const avgRoll = (ch.minRoll + 1) / 2;
    const roll = () => ch.minRoll + (1 - ch.minRoll) * rnd();
    if (element === "sagrado") {
      const red = 1 - enemyReduction(e, ch.level, true, o.pen ?? 0);
      const r = expected || o.dot ? avgRoll : roll();
      return { value: ch.atk * power * mult * r * red, landed: true };
    }
    const magic = element === "magico";
    const base = (magic ? ch.matk : ch.atk) * power;
    const mon = B.monsterStats(arch, m);
    let c =
      (o.canCrit ?? true) && !magic
        ? B.critChance(ch.critRating, mon.critRes, o.critFlat ?? 0)
        : 0;
    if (o.forceCrit && !magic) c = 1;
    const critMult = cfg.crit.multiplier + (o.critMult ?? 0);
    const hit = ch.hit * (1 + buffOf(h, "precisao"));
    const miss = magic ? 0 : B.heroMissChance(hit, mon.flee, false);
    const red =
      1 - enemyReduction(e, ch.level, magic, (o.pen ?? 0) + ch.penetration);
    if (expected || o.dot) {
      const expMult = (1 - c) * avgRoll + c * critMult;
      const landed = expected ? 1 - miss : 1;
      return { value: base * mult * expMult * landed * red, landed: true };
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

  /** Cura (capada no HP máximo, com a cura recebida do alvo); devolve quanto sobrou. */
  const heal = (h: Hero, amount: number, src: Hero | null): number => {
    if (!h.alive) return 0;
    amount *=
      1 +
      sum(active(partyBuffs, "curaRecebida")) +
      sum(active(h.buffs, "curaRecebida"));
    const real = Math.min(amount, maxHp(h) - h.hp);
    h.hp += real;
    if (src) {
      src.healed += real;
      const share =
        (cfg.threat.healShare * real) / Math.max(1, aliveHeroes().length);
      for (const e of enemies) if (e.alive) src.threat[e.i]! += share;
    }
    return Math.max(0, amount - real);
  };

  const stun = (e: Enemy, ms: number) => {
    if (!e.alive || isBoss(e)) return;
    e.stunnedUntil = Math.max(e.stunnedUntil, t + ms / 1000);
  };

  // -------------------------------------------------------------- inimigo → herói

  const takenMult = (
    h: Hero,
    e: Enemy,
    magic: boolean,
    certeiro: boolean,
  ): number => {
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
    if (certeiro)
      for (const b of active(partyBuffs, "reducaoCerteiro")) m *= 1 - b.value;
    return m;
  };

  const equippedHooks = (
    h: Hero,
    on: SkillHook["on"],
  ): { s: SkillDef; hook: SkillHook }[] => {
    const out: { s: SkillDef; hook: SkillHook }[] = [];
    for (const s of h.input.skills)
      for (const hook of s.hooks ?? [])
        if (hook.on === on) out.push({ s, hook });
    return out;
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
      const hitE =
        B.monsterStats(e.input.archetype, m).hit *
        prod(active(e.debuffs, "precisao"));
      const av = B.avoidChance(ch.flee, ch.luck, hitE, m, {
        attackers: Math.max(1, attackers),
        fleeMult: 1 + buffOf(h, "fuga"),
        flat: buffOf(h, "esquiva"),
      });
      const blk = ch.block + (ch.block > 0 ? (h.input.blockBonus ?? 0) : 0);
      let dodged = false;
      let blocked = false;
      if (expected) {
        raw *= 1 - av;
        raw *= 1 - cfg.block.reduce * blk;
        dodged = proc(h, "evento:esquiva", av);
        blocked = proc(h, "evento:bloqueio", blk);
      } else {
        if (rnd() < av) dodged = true;
        else if (rnd() < blk) {
          raw *= 1 - cfg.block.reduce;
          blocked = true;
        }
      }
      if (dodged)
        for (const { s, hook } of equippedHooks(h, "esquiva"))
          if (hook.on === "esquiva" && proc(h, `${s.id}:esquiva`, hook.chance))
            for (const eff of hook.effects)
              applyEffect(h, s, eff, e, undefined, { landed: true });
      if (blocked) {
        for (const s of h.input.skills) h.blockedSince.add(s.id);
        for (const { s, hook } of equippedHooks(h, "bloqueio"))
          if (
            hook.on === "bloqueio" &&
            proc(h, `${s.id}:bloqueio`, hook.chance)
          )
            h.cds.delete(s.id);
      }
      if (!expected && dodged) return;
    }
    const red = magic
      ? B.magicReduction(ch.mdef, m)
      : B.heroPhysicalReduction(ch.def, m);
    let d =
      raw *
      B.capTakenMultiplier(
        (1 - red) * takenMult(h, e, magic, o.certeiro ?? false),
      ) *
      (1 - B.levelDiffMod(ch.level - m));
    for (const w of h.windows)
      if (w.until > t && w.hook.on === "reflete" && e.alive)
        deal(h, e, d * w.hook.pct);
    if (h.manaShield && h.manaShield.until > t) {
      const take = Math.min(d * h.manaShield.pct, h.mp);
      h.mp -= take;
      h.manaShield.spent += take;
      d -= take;
    }
    if (h.shield > 0 && h.shieldUntil > t) {
      const a = Math.min(h.shield, d);
      h.shield -= a;
      d -= a;
      if (h.shieldBreak) {
        h.shieldBreak.absorbed += a;
        if (h.shield <= 0) breakShield(h, e);
      }
    }
    h.hp -= d;
    if (h.hp <= 0 && h.alive) {
      if (!h.cheatedDeath && tryCheatDeath(h)) return;
      die(h, "golpe");
    }
  };

  const breakShield = (h: Hero, attacker: Enemy) => {
    const sb = h.shieldBreak;
    h.shieldBreak = null;
    if (!sb || !sb.caster.alive) return;
    const amount = sb.absorbed * sb.pct;
    const targets =
      sb.targets === "area" ? aliveEnemies() : attacker.alive ? [attacker] : [];
    for (const x of targets) {
      const red = 1 - enemyReduction(x, sb.caster.ch.level, true, 0);
      deal(sb.caster, x, amount * red);
    }
  };

  /** Recusa da Morte (5/5): uma vez por luta, golpe fatal com a skill pronta → 1 HP e a skill sai. */
  const tryCheatDeath = (h: Hero): boolean => {
    for (const { s } of equippedHooks(h, "recusaMorte")) {
      if ((h.cds.get(s.id) ?? 0) > t) continue;
      const cost = s.manaPct * h.ch.manaBase;
      if (cost > h.mp) continue;
      h.cheatedDeath = true;
      h.hp = 1;
      doCast(h, s, undefined, cost);
      return true;
    }
    return false;
  };

  // -------------------------------------------------------------- IA

  const lowest = (below: number): Hero | null => {
    let best: Hero | null = null;
    for (const q of heroes) {
      if (!q.alive) continue;
      const r = ratio(q);
      if (r >= below) continue;
      if (!best || r < ratio(best)) best = q;
    }
    return best;
  };

  const fallen = (): Hero | null =>
    heroes.find((q) => !q.alive && !q.revived) ?? null;

  const conditionHolds = (
    h: Hero,
    c: Condition,
  ): { ok: boolean; ally?: Hero } => {
    switch (c.kind) {
      case "sempre":
        return { ok: true };
      case "soEmChefe":
        return { ok: enemies.some((e) => e.alive && isBoss(e)) };
      case "inimigos":
        return { ok: aliveEnemies().length >= c.min };
      case "aliadoAbaixo": {
        const ally = lowest(c.pct);
        return ally ? { ok: true, ally } : { ok: false };
      }
      case "aliadosAbaixo":
        return {
          ok: heroes.filter((q) => q.alive && ratio(q) < c.pct).length >= c.min,
        };
      case "aliadoComMpAbaixo":
        return { ok: heroes.some((q) => q.alive && q.mp / q.ch.mp < c.pct) };
      case "aliadoAmaldicoado":
        return {
          ok: heroes.some(
            (q) =>
              q.alive &&
              [...q.debuffs.values()].some(
                (d) => d.kind === "maldicao" && d.until > t,
              ),
          ),
        };
      case "aliadoCaido":
        return { ok: fallen() !== null };
      case "meuHpAbaixo":
        return { ok: ratio(h) < c.pct };
      case "sendoAlvo":
        return { ok: enemies.some((e) => e.alive && e.target === h) };
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

  const anyCondition = (h: Hero, s: SkillDef): { ok: boolean; ally?: Hero } => {
    let ok = false;
    let ally: Hero | undefined;
    for (const c of conditions(s)) {
      const r = conditionHolds(h, c);
      if (r.ok) {
        ok = true;
        if (r.ally && !ally) ally = r.ally;
      }
    }
    return ally ? { ok, ally } : { ok };
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

  // -------------------------------------------------------------- efeitos

  interface Ctx {
    landed: boolean;
    /** Dano causado pela skill nesta conjuração (para Luz Purificadora e Penitência). */
    dealt?: number;
    /** Multiplicador extra (2º meteoro). */
    scale?: number;
  }

  const skillBonus = (
    h: Hero,
    s: SkillDef,
    e: Enemy | null,
    healTarget?: Hero,
  ): number => {
    let b = 0;
    for (const hook of s.hooks ?? []) {
      if (hook.on !== "bonus") continue;
      switch (hook.when) {
        case "3+inimigos":
          if (aliveEnemies().length >= 3) b += hook.value;
          break;
        case "alvoAbaixo35":
          if (
            healTarget
              ? ratio(healTarget) < 0.35
              : e && e.hp / e.input.hp < 0.35
          )
            b += hook.value;
          break;
        case "alvoAcima70":
          if (e && e.hp / e.input.hp > 0.7) b += hook.value;
          break;
        case "familia":
          if (e?.input.family && hook.families?.includes(e.input.family))
            b += hook.value;
          break;
        case "aposBloqueio":
          if (h.blockedSince.has(s.id)) b += hook.value;
          break;
      }
    }
    return b;
  };

  const damageTargets = (
    eff: Extract<Effect, { type: "dano" }>,
    e: Enemy | null,
  ): { x: Enemy; scale: number }[] => {
    const alive = aliveEnemies();
    const tg = eff.targets ?? "alvo";
    if (tg === "area") return alive.map((x) => ({ x, scale: 1 }));
    if (tg === "alvo" || tg === "primeiro" || tg === "aleatorios")
      return e ? [{ x: e, scale: 1 }] : [];
    if (tg.kind === "linha")
      return alive.slice(0, tg.max).map((x) => ({ x, scale: 1 }));
    // Cadeia: o alvo e mais `hops` saltos, perdendo `falloff` a cada salto.
    const start = e ? alive.indexOf(e) : 0;
    const order = [...alive.slice(start), ...alive.slice(0, start)];
    return order
      .slice(0, tg.hops + 1)
      .map((x, k) => ({ x, scale: Math.pow(1 - tg.falloff, k) }));
  };

  const pickRandomEnemy = (): Enemy | null => {
    const alive = aliveEnemies();
    if (alive.length === 0) return null;
    if (expected) return alive[roundRobin++ % alive.length]!;
    return alive[Math.floor(rnd() * alive.length)]!;
  };

  const otherEnemy = (e: Enemy | null): Enemy | null => {
    const others = aliveEnemies().filter((x) => x !== e);
    if (others.length === 0) return null;
    return expected ? others[0]! : others[Math.floor(rnd() * others.length)]!;
  };

  /**
   * Potência aplicada na hora da luta, nos coeficientes de ATQ/MATQ (não nos % de HP), como no
   * gabarito. Skills compiladas (skills/compile.ts) já trazem a Potência e chegam com rank 1.
   */
  const pmOf = (h: Hero): number => B.potencyMult(h.input.potencyRank);

  const applyDamage = (
    h: Hero,
    s: SkillDef,
    eff: Extract<Effect, { type: "dano" }>,
    e: Enemy | null,
    ctx: Ctx,
  ) => {
    const hits = eff.hits ?? 1;
    const pm = pmOf(h);
    const critMult =
      buffOf(h, "multCritico") + h.ch.critMultBonus + (eff.critMult ?? 0);
    const below = (s.hooks ?? []).find((x) => x.on === "criticoAbaixo");
    let any = false;
    let enemiesHit = 0;
    for (const { x: target, scale } of damageTargets(eff, e)) {
      let dealtHere = 0;
      // O gabarito soma "valor × golpes" de uma vez; com o último golpe diferente, golpe a golpe.
      const loops =
        !expected || eff.lastHitCritFlat || eff.targets === "aleatorios"
          ? hits
          : 1;
      for (let k = 0; k < loops; k++) {
        const x =
          eff.targets === "aleatorios" ? (pickRandomEnemy() ?? target) : target;
        let critFlat = (eff.critFlat ?? 0) + buffOf(h, "critico");
        if (k === hits - 1) critFlat += eff.lastHitCritFlat ?? 0;
        if (eff.ambush && x.target !== h) critFlat = 1;
        const forceCrit =
          below?.on === "criticoAbaixo" && x.hp / x.input.hp < below.pct;
        let d = 0;
        let landed = false;
        for (const p of eff.parts) {
          const n =
            p.element === "fisico"
              ? loops === 1
                ? hits
                : 1
              : loops === 1
                ? 1
                : k === 0
                  ? 1
                  : 0;
          if (n === 0) continue;
          const r = heroHit(h, x, p.coef * pm, p.element, {
            critFlat,
            critMult,
            pen: p.element === "sagrado" ? 0 : eff.penetration,
            forceCrit,
          });
          d += r.value * n;
          landed ||= r.landed;
        }
        if (
          eff.vsFamilies &&
          x.input.family &&
          eff.vsFamilies.families.includes(x.input.family)
        )
          d *= eff.vsFamilies.mult;
        d *= (1 + skillBonus(h, s, x)) * scale * (ctx.scale ?? 1);
        any ||= landed;
        if (d <= 0 && !landed) continue;
        const dealt = deal(h, x, d);
        dealtHere += dealt;
        if (s.threatMult)
          h.threat[x.i]! += dealt * h.ch.threat * (s.threatMult - 1);
        if (landed) onHit(h, s, x);
      }
      if (dealtHere > 0) enemiesHit++;
      ctx.dealt = (ctx.dealt ?? 0) + dealtHere;
    }
    ctx.landed = any;
    for (const hook of s.hooks ?? []) {
      if (hook.on === "porInimigo")
        heal(h, enemiesHit * hook.healPctMaxHp * maxHp(h), null);
    }
  };

  /** Ganchos de acerto: procs (Seta Dupla, Julgamento, Clarão, Espinheiro) e Fluxo. */
  const onHit = (h: Hero, s: SkillDef, x: Enemy) => {
    for (const hook of s.hooks ?? []) {
      if (hook.on === "fluxo") {
        for (const [id, until] of h.cds)
          if (id !== s.id) h.cds.set(id, until - hook.seconds);
      } else if (
        hook.on === "acerto" &&
        proc(h, `${s.id}:acerto`, hook.chance)
      ) {
        const target = hook.spread ? otherEnemy(x) : x;
        if (!target) continue;
        const sub: SkillDef = {
          ...s,
          hooks: (s.hooks ?? []).filter(
            (k) => k.on !== "acerto" && k.on !== "fluxo",
          ),
        };
        for (const eff of hook.effects)
          applyEffect(h, sub, eff, target, undefined, { landed: true });
      }
    }
  };

  const healTargets = (
    target: "aliado" | "grupo" | "proprio",
    h: Hero,
    ally: Hero | undefined,
  ): Hero[] => {
    if (target === "grupo") return heroes;
    if (target === "proprio") return [h];
    const a = ally ?? lowest(Infinity);
    return a ? [a] : [];
  };

  const applyEffect = (
    h: Hero,
    s: SkillDef,
    eff: Effect,
    e: Enemy | null,
    ally: Hero | undefined,
    ctx: Ctx,
  ) => {
    const dur = (ms: number) => t + ms / 1000;
    const hb = 1 + (h.input.healBonus ?? 0);
    const power = 1 + buffOf(h, "poder");
    const pm = pmOf(h);
    switch (eff.type) {
      case "dano":
        applyDamage(h, s, eff, e, ctx);
        return;
      case "dot": {
        if (!ctx.landed) return;
        const targets = eff.targets === "area" ? aliveEnemies() : e ? [e] : [];
        for (const x of targets) {
          let per = heroHit(h, x, eff.coefPerSec * pm, eff.element, {
            canCrit: false,
            dot: !expected,
          }).value;
          if (eff.poison) per *= 1 + (h.input.poisonBonus ?? 0);
          per *= 1 + skillBonus(h, s, x);
          const key = `${s.id}:dot:${eff.element}:${eff.coefPerSec}`;
          const mine = h.dots.filter(
            (d) => d.key === key && d.enemy === x.i && d.until > t,
          );
          if (mine.length >= (eff.stacks ?? 1)) {
            const oldest = mine.reduce((a, b) => (a.until <= b.until ? a : b));
            h.dots.splice(h.dots.indexOf(oldest), 1);
          }
          h.dots.push({
            key,
            perSec: per,
            until: dur(eff.durationMs),
            enemy: x.i,
            nextPulse: t + 1,
            ...(eff.tickStun && eff.tickStun.chance > 0
              ? { tickStun: eff.tickStun }
              : {}),
          });
        }
        return;
      }
      case "cura": {
        const src = eff.target === "proprio" ? null : h;
        for (const q of healTargets(eff.target, h, ally)) {
          let amount = 0;
          if (eff.coefMatk)
            amount +=
              eff.coefMatk * h.ch.matk * power * pm * (eff.noBonus ? 1 : hb);
          if (eff.pctMaxHp) amount += eff.pctMaxHp * maxHp(q);
          amount *= 1 + skillBonus(h, s, null, q);
          const over = heal(q, amount, src);
          for (const hook of s.hooks ?? [])
            if (hook.on === "sobracura" && over > 0 && q.alive) {
              q.shield = Math.max(q.shield, over * hook.shieldPct);
              q.shieldUntil = Math.max(q.shieldUntil, dur(8000));
            }
        }
        return;
      }
      case "hot": {
        const targets =
          eff.target === "grupo" ? aliveHeroes() : ally ? [ally] : [];
        const per =
          (eff.coefMatkPerSec ?? 0) *
          h.ch.matk *
          power *
          pm *
          (hb + (h.input.hotBonus ?? 0));
        const key = `${s.id}:hot:${eff.coefMatkPerSec ?? 0}:${eff.pctMaxHpPerSec ?? 0}`;
        for (const q of targets) {
          const mine = q.hots.filter((x) => x.key === key && x.until > t);
          if (mine.length >= (eff.stacks ?? 99)) {
            const oldest = mine.reduce((a, b) => (a.until <= b.until ? a : b));
            q.hots.splice(q.hots.indexOf(oldest), 1);
          }
          q.hots.push({
            key,
            perSec: per,
            pctMaxHpPerSec: eff.pctMaxHpPerSec ?? 0,
            until: dur(eff.durationMs),
            src: h,
          });
        }
        return;
      }
      case "escudo": {
        const amountFor = (tt: Hero) =>
          (eff.pctMaxHp ?? 0) * maxHp(tt) +
          (eff.coefMatk ?? 0) * h.ch.matk * power * pm;
        let targets: Hero[];
        if (eff.target === "proprio") targets = [h];
        else if (eff.target === "grupo") targets = aliveHeroes();
        else if (eff.target === "aliado")
          targets = [ally ?? lowest(Infinity) ?? h];
        else targets = [e && e.target && e.target.alive ? e.target : h];
        const breakHook = (s.hooks ?? []).find((x) => x.on === "escudoQuebra");
        for (const tt of targets) {
          tt.shield = amountFor(tt);
          tt.shieldUntil = dur(eff.durationMs);
          tt.shieldBreak =
            breakHook && breakHook.on === "escudoQuebra"
              ? {
                  pct: breakHook.pct,
                  targets: breakHook.targets,
                  caster: h,
                  absorbed: 0,
                }
              : null;
        }
        for (const hook of s.hooks ?? [])
          if (hook.on === "escudoDivide") {
            const other = heroes
              .filter((q) => q.alive && !targets.includes(q))
              .sort((a, b) => ratio(a) - ratio(b))[0];
            if (other) {
              other.shield = Math.max(
                other.shield,
                amountFor(targets[0]!) * hook.pct,
              );
              other.shieldUntil = Math.max(
                other.shieldUntil,
                dur(eff.durationMs),
              );
            }
          }
        return;
      }
      case "escudoDeMana": {
        const ret = (s.hooks ?? []).find((x) => x.on === "manaVolta");
        h.manaShield = {
          pct: eff.pct,
          until: dur(eff.durationMs),
          spent: 0,
          refund: ret && ret.on === "manaVolta" ? ret.pct : 0,
        };
        return;
      }
      case "buff": {
        const map = eff.target === "grupo" ? partyBuffs : h.buffs;
        map.set(eff.group ?? `${s.id}:${eff.stat}`, {
          stat: eff.stat,
          value: eff.value,
          until: dur(eff.durationMs),
        });
        if (eff.stat === "hpMaxPct")
          for (const q of eff.target === "grupo" ? aliveHeroes() : [h])
            q.hp += q.ch.hp * eff.value;
        for (const hook of s.hooks ?? [])
          if (hook.on === "reflete")
            h.windows.push({ hook, until: dur(eff.durationMs) });
        return;
      }
      case "debuff": {
        const targets = eff.targets === "area" ? aliveEnemies() : e ? [e] : [];
        for (const x of targets) {
          const value = isBoss(x) ? (eff.bossValue ?? eff.value) : eff.value;
          if (value <= 0) continue;
          x.debuffs.set(eff.group ?? `${s.id}:${eff.stat}`, {
            stat: eff.stat,
            value,
            until: dur(eff.durationMs),
          });
        }
        return;
      }
      case "atordoar": {
        const pool =
          eff.targets === "area"
            ? aliveEnemies()
            : e
              ? [e, ...aliveEnemies().filter((x) => x !== e)]
              : [];
        let n = 0;
        for (const x of pool) {
          if (n >= (eff.max ?? Infinity)) break;
          if (isBoss(x)) continue;
          if (
            eff.chance !== undefined &&
            !proc(h, `${s.id}:atordoar`, eff.chance)
          )
            continue;
          stun(x, eff.durationMs);
          n++;
        }
        return;
      }
      case "provocar": {
        const targets = eff.scope === "sala" ? aliveEnemies() : e ? [e] : [];
        for (const x of targets) {
          x.forced = h;
          x.forcedUntil = dur(eff.durationMs);
          const top = Math.max(...heroes.map((q) => q.threat[x.i]!));
          h.threat[x.i] = Math.max(h.threat[x.i]!, top * cfg.threat.tauntTop);
        }
        return;
      }
      case "cortaAmeaca":
        for (let k = 0; k < h.threat.length; k++)
          h.threat[k] = h.threat[k]! * (1 - eff.pct);
        return;
      case "reviver": {
        const q = fallen();
        if (!q) return;
        q.alive = true;
        q.revived = true;
        q.hp = eff.hpPct * maxHp(q);
        q.dots = [];
        return;
      }
      case "purificar": {
        if (
          eff.chance !== undefined &&
          !proc(h, `${s.id}:purificar`, eff.chance)
        )
          return;
        const targets =
          eff.target === "grupo"
            ? aliveHeroes()
            : healTargets("aliado", h, ally);
        for (const q of targets) purge(q, eff.count);
        if (eff.everyMs && eff.durationMs)
          partyPurges.push({
            count: eff.count,
            every: eff.everyMs / 1000,
            next: dur(eff.everyMs),
            until: dur(eff.durationMs),
          });
        return;
      }
    }
  };

  const purge = (q: Hero, count: number) => {
    let n = 0;
    for (const [k, d] of q.debuffs) {
      if (n >= count) break;
      if (d.until > t) {
        q.debuffs.delete(k);
        n++;
      }
    }
  };

  /** Os efeitos da skill (no fim da conjuração, se tiver) e os ganchos que dependem do dano. */
  const resolve = (h: Hero, s: SkillDef, ally: Hero | undefined) => {
    const e = focus();
    const ctx: Ctx = { landed: true };
    for (const eff of s.effects) applyEffect(h, s, eff, e, ally, ctx);
    for (const hook of s.hooks ?? []) {
      if (hook.on === "repete") {
        const again: Ctx = { landed: true, scale: hook.pct };
        for (const eff of s.effects)
          if (eff.type === "dano") applyEffect(h, s, eff, focus(), ally, again);
      } else if (hook.on === "danoCura" && (ctx.dealt ?? 0) > 0) {
        const target = hook.target === "proprio" ? h : (lowest(Infinity) ?? h);
        heal(
          target,
          ctx.dealt! * hook.pct,
          hook.target === "proprio" ? null : h,
        );
      }
    }
    h.blockedSince.delete(s.id);
  };

  /** Gasta, põe em recarga e dispara (ou começa a conjurar). */
  const doCast = (
    h: Hero,
    s: SkillDef,
    ally: Hero | undefined,
    cost: number,
  ) => {
    h.mp -= cost;
    for (const hook of s.hooks ?? [])
      if (hook.on === "semCusto" && proc(h, `${s.id}:semCusto`, hook.chance))
        h.mp += cost;
    const base = (s.baseCooldownMs ?? s.cooldownMs) / 1000;
    const cd = Math.max(
      cfg.cooldown.floorOfBase * base,
      (s.cooldownMs / 1000) *
        (1 - h.ch.cooldownCut) *
        (1 - (s.ownCooldownCut ?? 0)),
    );
    h.cds.set(s.id, t + cd);
    h.gcd = cfg.skills.gcdMs / 1000;
    h.casts[s.id] = (h.casts[s.id] ?? 0) + 1;
    if (s.castMs) h.casting = { skill: s, until: t + s.castMs / 1000, ally };
    else resolve(h, s, ally);
  };

  /** A skill tem o que fazer? (HoT que já acumulou o máximo em todos; ninguém para reviver.) */
  const pickAlly = (
    h: Hero,
    s: SkillDef,
    ally: Hero | undefined,
  ): { ok: boolean; ally?: Hero } => {
    for (const eff of s.effects) {
      if (eff.type === "reviver" && !fallen()) return { ok: false };
      if (eff.type === "hot" && eff.target === "aliado") {
        const cap = eff.stacks ?? 1;
        const key = `${s.id}:hot:${eff.coefMatkPerSec ?? 0}:${eff.pctMaxHpPerSec ?? 0}`;
        const count = (q: Hero) =>
          q.hots.filter((x) => x.key === key && x.until > t).length;
        const below = conditions(s).find((c) => c.kind === "aliadoAbaixo");
        const limit = below && below.kind === "aliadoAbaixo" ? below.pct : 1;
        if (!ally || count(ally) >= cap) {
          let best: Hero | null = null;
          for (const q of heroes)
            if (q.alive && count(q) < cap && ratio(q) < limit)
              if (!best || ratio(q) < ratio(best)) best = q;
          if (!best) return { ok: false };
          ally = best;
        }
      }
    }
    return ally ? { ok: true, ally } : { ok: true };
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
        q.hp -= c.pct * maxHp(q);
        if (q.hp <= 0) die(q, "cataclismo");
      }
      if (!heroes.some((q) => q.alive)) wiped = true;
    }
    if (wiped) break;

    // Ações dos inimigos (atordoado não age; lentidão atrasa os relógios).
    for (const e of [...enemies]) {
      if (!e.alive || !e.target) continue;
      if (e.stunnedUntil > t) continue;
      // Fase 2 (desde o 150): mais dano e intervalos menores abaixo do limiar.
      const ph = e.input.phase;
      if (ph && !e.inPhase && e.hp <= ph.at * e.input.hp) e.inPhase = true;
      const dmg = e.inPhase && ph ? ph.damageMult : 1;
      const tick = e.inPhase && ph ? DT / ph.intervalMult : DT;
      const pace = tick * prod(active(e.debuffs, "velocidade"));
      e.autoTimer -= pace;
      if (e.autoTimer <= 0) {
        hurt(e.target, e, e.input.autoRaw * dmg, {
          magic: e.input.magicAuto ?? false,
        });
        e.autoTimer += 1 / e.input.attacksPerSecond;
      }
      if (e.input.buster) {
        e.busterTimer -= tick;
        if (e.busterTimer <= 0) {
          if (e.target.alive)
            hurt(e.target, e, e.input.autoRaw * e.input.buster.mult * dmg, {
              certeiro: true,
            });
          e.busterTimer += e.input.buster.everySeconds;
        }
      }
      if (e.input.pulse) {
        e.pulseTimer -= tick;
        if (e.pulseTimer <= 0) {
          for (const q of heroes)
            if (q.alive) hurt(q, e, e.input.pulse.raw * dmg, { magic: true });
          e.pulseTimer += e.input.pulse.everySeconds;
        }
      }
      const pickNonTank = (): Hero | null => {
        const pool = heroes.filter((q) => q.alive && q.input.role !== "tanque");
        if (pool.length === 0) return null;
        return expected
          ? pool[e.pick++ % pool.length]!
          : pool[Math.floor(rnd() * pool.length)]!;
      };
      const cu = e.input.curse;
      if (cu) {
        e.curseTimer -= tick;
        if (e.curseTimer <= 0) {
          const q = pickNonTank();
          if (q)
            q.debuffs.set("maldicao", {
              kind: "maldicao",
              until: t + cu.maxSeconds,
              value: cu.pctPerSecond,
            });
          e.curseTimer += cu.everySeconds;
        }
      }
      const md = e.input.manaDrain;
      if (md) {
        e.drainTimer -= tick;
        if (e.drainTimer <= 0) {
          for (const q of heroes)
            if (q.alive && CASTERS.has(q.input.cls))
              q.debuffs.set("drenar", {
                kind: "drenar",
                until: t + md.durationSeconds,
                value: md.pctPerSecond,
              });
          e.drainTimer += md.everySeconds;
        }
      }
      const ca = e.input.charge;
      if (ca) {
        e.chargeTimer -= tick;
        if (e.chargeTimer <= 0) {
          const q = pickNonTank();
          if (q) hurt(q, e, e.input.autoRaw * ca.mult * dmg);
          e.chargeTimer += ca.everySeconds;
        }
      }
      const su = e.input.summon;
      if (su) {
        e.summonTimer -= tick;
        if (e.summonTimer <= 0) {
          for (let k = 0; k < su.count; k++) {
            enemies.push(newEnemy(su.minion, enemies.length));
            for (const q of heroes) q.threat.push(0);
          }
          e.summonTimer += su.everySeconds;
        }
      }
      const fp = e.input.finalPhase;
      if (fp && e.hp <= fp.at * e.input.hp) {
        e.finalTimer -= tick;
        if (e.finalTimer <= 0) {
          for (const q of heroes) {
            if (!q.alive) continue;
            q.hp -= fp.pct * maxHp(q);
            if (q.hp <= 0) die(q, "mecanica");
          }
          e.finalTimer += fp.everySeconds;
        }
      }
    }
    if (!heroes.some((q) => q.alive)) break;

    // Purificações periódicas do grupo (Santuário).
    for (const p of partyPurges)
      if (p.until > t && p.next <= t) {
        for (const q of aliveHeroes()) purge(q, p.count);
        p.next += p.every;
      }

    // Heróis.
    for (const h of heroes) {
      if (!h.alive) continue;
      const ch = h.ch;
      if (h.hp > maxHp(h)) h.hp = maxHp(h);
      // Maldição e Drenar Mana: por segundo, até acabar ou ser purificado.
      for (const d of h.debuffs.values()) {
        if (d.until <= t) continue;
        if (d.kind === "maldicao") h.hp -= d.value * maxHp(h) * DT;
        else if (d.kind === "drenar")
          h.mp = Math.max(0, h.mp - d.value * ch.mp * DT);
      }
      if (h.hp <= 0) {
        die(h, "mecanica");
        continue;
      }
      const regen =
        ch.mp * cfg.regen.mpPctPerSecond +
        cfg.regen.mpPerIntPerSecond * ch.attrs.INT +
        ch.mp * sum(active(partyBuffs, "regenManaPct"));
      h.mp = Math.min(ch.mp, h.mp + regen * DT);
      const hpRegen = buffOf(h, "regenVidaPct");
      if (hpRegen > 0) heal(h, maxHp(h) * hpRegen * DT, null);

      if (h.manaShield && h.manaShield.until <= t) {
        h.mp = Math.min(ch.mp, h.mp + h.manaShield.spent * h.manaShield.refund);
        h.manaShield = null;
      }

      h.hots = h.hots.filter((x) => {
        if (x.until > t) {
          heal(h, (x.perSec + x.pctMaxHpPerSec * maxHp(h)) * DT, x.src);
          return true;
        }
        return false;
      });

      h.potCd -= DT;
      if (h.potCd <= 0 && h.pots > 0) {
        const at = h.input.potionAt ?? { hp: 0.5, mp: 0.3 };
        if (ratio(h) < at.hp) {
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

      if (h.casting) {
        if (h.casting.until <= t) {
          const c = h.casting;
          h.casting = null;
          resolve(h, c.skill, c.ally);
        }
      } else {
        h.auto -= DT;
        if (h.auto <= 0) {
          const e = focus();
          if (e) {
            const r =
              ch.kind === "magic"
                ? heroHit(h, e, h.input.magicAutoAttack ?? 0.6, "magico")
                : heroHit(h, e, 1, "fisico", {
                    critFlat: buffOf(h, "critico"),
                    critMult: buffOf(h, "multCritico") + ch.critMultBonus,
                  });
            h.autoDamage += deal(h, e, r.value);
          }
          h.auto += 1 / ch.attacksPerSecond;
        }
      }

      h.dots = h.dots.filter((x) => {
        if (x.until <= t) return false;
        const e = enemies[x.enemy];
        if (e && e.alive) {
          deal(h, e, x.perSec * DT);
          if (x.tickStun && t >= x.nextPulse) {
            x.nextPulse += 1;
            if (proc(h, `${x.key}:pulso`, x.tickStun.chance))
              stun(e, x.tickStun.durationMs);
          }
        }
        return true;
      });

      h.gcd -= DT;
      if (h.gcd > 0 || h.casting) continue;
      for (const s of h.input.skills) {
        if ((h.cds.get(s.id) ?? 0) > t) continue;
        const cost = s.manaPct * ch.manaBase;
        if (cost > h.mp) continue;
        const cond = anyCondition(h, s);
        if (!cond.ok) continue;
        if (burstHeld(h, s)) continue;
        const target = pickAlly(h, s, cond.ally);
        if (!target.ok) continue;
        doCast(h, s, target.ally, cost);
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
      casts: h.casts,
      carry: {
        hp: Math.max(0, h.hp),
        mp: h.mp,
        alive: h.alive,
        pots: h.pots,
        cooldowns: Object.fromEntries(
          [...h.cds]
            .map(([id, until]) => [id, Math.max(0, until - t)] as const)
            .filter(([, left]) => left > 0),
        ),
        revived: h.revived,
        cheatedDeath: h.cheatedDeath,
      },
    })),
  };
}
