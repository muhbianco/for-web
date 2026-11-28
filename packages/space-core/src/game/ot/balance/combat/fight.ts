import type { HeroStats } from "../formulas.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import type {
  BuffStat,
  Condition,
  DebuffStat,
  BossDot,
  DotKind,
  Effect,
  Element,
  EnemyInput,
  FighterInput,
  FightOptions,
  FightEvent,
  FightFrame,
  FightResult,
  FrameAggro,
  FrameStatus,
  KillEvent,
  MechanicEvent,
  SkillDef,
  SkillHook,
} from "./types.ts";
import { FOE_BASE } from "./types.ts";

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

/**
 * O custo de mana de uma skill compilada para quem a solta (D44): a INT barateia
 * (cfg.mana.costCutPerInt). A ficha, a tela da corrida e o motor usam esta conta.
 */
export function skillManaCostFor(
  s: Pick<SkillDef, "manaPct">,
  stats: Pick<HeroStats, "manaBase" | "attrs">,
  B: Balance = gameBalance,
): number {
  return (
    (s.manaPct * stats.manaBase) /
    (1 + B.cfg.mana.costCutPerInt * stats.attrs.INT)
  );
}

/** Fonte de números em [0, 1) a partir do RNG com semente do jogo (game/rng.ts). */
export function randomSource(rng: { u32(): number }): { next(): number } {
  return { next: () => rng.u32() / 4294967296 };
}

interface Timed {
  stat: BuffStat | DebuffStat;
  value: number;
  until: number;
  /** A skill que pôs e o herói (a tela da corrida lê; `selfless` também). */
  src?: string;
  by?: number;
  /** Não vale para quem soltou (`excludeCaster` do efeito). */
  selfless?: boolean;
}

/** O que a tela precisa saber de um dano (só gravação: não muda a luta). */
interface HitTag {
  crit?: boolean;
  dot?: DotKind;
}

interface Dot {
  key: string;
  /** Para a tela: a cor do número do tique. */
  kind: DotKind;
  perSec: number;
  until: number;
  enemy: number;
  nextPulse: number;
  tickStun?: { chance: number; durationMs: number };
  /** Cura de quem conjurou, em fração do HP máximo por segundo, enquanto o inimigo queima. */
  selfHeal?: number;
  /** Multiplicador de ameaça da skill que pôs o DoT (Consagração ×2), como no dano direto. */
  threatMult?: number;
}

/**
 * Um efeito do chefe no herói. No DoT (D71): `by` é o chefe que pôs; com `raw`, `value` é o golpe
 * bruto por segundo (cortado pela DEF ou MDEF); sem ele, a fração do HP máx./s (dano verdadeiro).
 */
interface HeroDebuff {
  kind: string;
  until: number;
  value: number;
  by?: number;
  raw?: boolean;
  magic?: boolean;
}

/** Os DoTs de chefe (D71): todos saem com a purificação e contam como "aliado amaldiçoado". */
const BOSS_DOTS: ReadonlySet<string> = new Set<BossDot>(["maldicao", "sangramento", "veneno"]);
const DOT_KIND: Record<BossDot, DotKind> = {
  maldicao: "dot",
  sangramento: "sangramento",
  veneno: "veneno",
};

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
  /** Estoques separados de vida e mana (null = um estoque só, `pots`). */
  hpPots: number | null;
  mpPots: number | null;
  shield: number;
  shieldUntil: number;
  /** A skill do escudo atual (só a tela lê). */
  shieldSrc?: string;
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
    src?: string;
  } | null;
  /** D66 Devoção: quem protege este herói (parte do dano dos monstros vai para ele). */
  devotion: {
    by: Hero;
    pct: number;
    until: number;
    minHp: number;
    src: string;
  } | null;
  buffs: Map<string, Timed>;
  /** Efeitos negativos no herói (Maldição, Drenar Mana), removíveis por purificação. */
  debuffs: Map<string, HeroDebuff>;
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
  autos: number;
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
    hpPots: opts.carry?.[i]?.hpPots ?? input.potions.hpStock ?? null,
    mpPots: opts.carry?.[i]?.mpPots ?? input.potions.mpStock ?? null,
    shield: 0,
    shieldUntil: 0,
    shieldBreak: null,
    manaShield: null,
    devotion: null,
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
    autos: 0,
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
  /** Os da sala; daqui para a frente, só invocados. */
  const roomEnemies = enemies.length;
  /** D71: algum chefe da sala invoca lacaios que os heróis de dano atacam primeiro. */
  const priorityAdds = enemyInputs.some((x) => x.summon?.priority === true);
  const kills: KillEvent[] = [];
  const recorded = new Set<number>();
  // ------------------------------------------------------------ gravador da tela (Fase 8)
  const rec = opts.record
    ? {
        frames: [] as FightFrame[],
        events: [] as FightEvent[],
        acc: new Map<
          string,
          {
            a: number;
            b: number;
            s: string;
            v: number;
            cura: boolean;
            blocked: boolean;
            crit: boolean;
            dot: DotKind | null;
          }
        >(),
        cataclysm: new Map<number, number>(),
      }
    : null;
  /** De onde vem o dano ou a cura que está saindo agora ("auto" = ataque básico). */
  let source = "auto";
  let foeSource = "golpe";
  const who = (h: Hero) => heroes.indexOf(h);
  /** A INT barateia a skill (cfg.mana.costCutPerInt; D44). */
  const intCut = (h: Hero) =>
    1 / (1 + B.cfg.mana.costCutPerInt * h.ch.attrs.INT);
  const emit = (ev: FightEvent) => {
    if (rec) rec.events.push(ev);
  };
  const add = (
    a: number,
    b: number,
    s: string,
    v: number,
    cura: boolean,
    blocked = false,
    tag: HitTag = {},
  ) => {
    if (!rec || !(v > 0)) return;
    const crit = tag.crit ?? false;
    const dot = tag.dot ?? null;
    const key = `${a}|${b}|${s}|${cura ? 1 : 0}|${crit ? "c" : ""}|${dot ?? ""}`;
    const x = rec.acc.get(key);
    if (x) {
      x.v += v;
      x.blocked ||= blocked;
    } else rec.acc.set(key, { a, b, s, v, cura, blocked, crit, dot });
  };
  const announce = (e: Enemy, s: MechanicEvent, b?: Hero) =>
    emit({
      k: "mecanica",
      a: FOE_BASE + e.i,
      s,
      ...(b ? { b: who(b) } : {}),
    });
  const flushFrame = (second: number) => {
    if (!rec) return;
    const e: FightEvent[] = [];
    for (const x of rec.acc.values()) {
      const v = Math.round(x.v);
      if (v <= 0) continue;
      if (!x.cura && (x.s === "auto" || x.s === "golpe"))
        e.push({
          k: "golpe",
          a: x.a,
          b: x.b,
          v,
          ...(x.blocked ? { bl: "bloqueio" as const } : {}),
          ...(x.crit ? { cr: true as const } : {}),
        });
      else
        e.push({
          k: "magia",
          a: x.a,
          b: x.b,
          v,
          s: x.s,
          ...(x.cura ? { cura: true as const } : {}),
          ...(x.crit ? { cr: true as const } : {}),
          ...(x.dot ? { dt: x.dot } : {}),
        });
    }
    rec.acc.clear();
    e.push(...rec.events);
    rec.events = [];
    const u = statusesAt(second);
    rec.frames.push({
      s: second,
      h: heroes.map((h) => Math.max(0, Math.round(h.hp))),
      m: heroes.map((h) => Math.max(0, Math.round(h.mp))),
      x: enemies.map((x) => Math.max(0, Math.round(x.hp))),
      e,
      ...(u ? { u } : {}),
      g: aggroAt(),
    });
  };
  /** Quem cada inimigo mira e a ameaça de cada herói em % da do alvo (só lê o estado). */
  const aggroAt = (): (FrameAggro | null)[] =>
    enemies.map((x) => {
      if (!x.alive) return null;
      const tg = x.target && x.target.alive ? x.target : null;
      const base = tg
        ? tg.threat[x.i]!
        : Math.max(0, ...heroes.map((h) => (h.alive ? h.threat[x.i]! : 0)));
      return {
        a: tg ? who(tg) : -1,
        // O alvo é 100% por definição (no começo da sala ele é escolhido com ameaça 0).
        p: heroes.map((h) =>
          h === tg
            ? 100
            : h.alive && base > 0
              ? Math.round((100 * h.threat[x.i]!) / base)
              : 0,
        ),
      };
    });
  /** Os efeitos ativos no fim do segundo (só lê o estado; nada da luta muda). */
  const statusesAt = (now: number): FightFrame["u"] | null => {
    const left = (until: number) => Math.max(1, Math.ceil(until - now - 1e-9));
    const srcOf = (key: string) => key.split(":")[0]!;
    let any = false;
    const push = (out: FrameStatus[], st: FrameStatus) => {
      out.push(st);
      any = true;
    };
    const h = heroes.map((q) => {
      const out: FrameStatus[] = [];
      if (!q.alive) return out;
      for (const [key, b] of q.buffs)
        if (b.until > now)
          push(out, {
            s: b.src ?? srcOf(key),
            k: "buff",
            st: b.stat,
            t: left(b.until),
          });
      for (const [key, b] of partyBuffs)
        if (b.until > now)
          push(out, {
            s: b.src ?? srcOf(key),
            k: "buff",
            st: b.stat,
            t: left(b.until),
            ...(b.by !== undefined ? { a: b.by } : {}),
          });
      const hots = new Map<string, FrameStatus>();
      for (const x of q.hots) {
        if (x.until <= now) continue;
        const by = who(x.src);
        const id = x.key + "|" + by;
        const cur = hots.get(id);
        if (cur) {
          cur.n = (cur.n ?? 1) + 1;
          cur.t = Math.max(cur.t, left(x.until));
        } else
          hots.set(id, { s: srcOf(x.key), k: "hot", t: left(x.until), a: by });
      }
      for (const st of hots.values()) push(out, st);
      for (const [key, d] of q.debuffs)
        if (d.until > now) push(out, { s: key, k: "debuff", t: left(d.until) });
      if (q.shield > 0 && q.shieldUntil > now)
        push(out, {
          s: q.shieldSrc ?? "escudo",
          k: "escudo",
          t: left(q.shieldUntil),
          v: Math.round(q.shield),
        });
      if (q.manaShield && q.manaShield.until > now)
        push(out, {
          s: q.manaShield.src ?? "escudo-de-mana",
          k: "mana",
          t: left(q.manaShield.until),
        });
      if (q.devotion && q.devotion.until > now && q.devotion.by.alive)
        push(out, {
          s: q.devotion.src,
          k: "buff",
          st: "devocao",
          t: left(q.devotion.until),
          a: who(q.devotion.by),
        });
      return out;
    });
    const dots = new Map<number, Map<string, FrameStatus>>();
    for (const q of heroes)
      for (const d of q.dots) {
        if (d.until <= now) continue;
        const per = dots.get(d.enemy) ?? new Map<string, FrameStatus>();
        dots.set(d.enemy, per);
        const id = d.key + "|" + q.i;
        const cur = per.get(id);
        if (cur) {
          cur.n = (cur.n ?? 1) + 1;
          cur.t = Math.max(cur.t, left(d.until));
        } else
          per.set(id, {
            s: srcOf(d.key),
            k: "dot",
            t: left(d.until),
            a: q.i,
            dk: d.kind,
          });
      }
    const x = enemies.map((e) => {
      const out: FrameStatus[] = [];
      if (!e.alive) return out;
      for (const [key, b] of e.debuffs)
        if (b.until > now)
          push(out, {
            s: b.src ?? srcOf(key),
            k: "debuff",
            st: b.stat,
            t: left(b.until),
            ...(b.by !== undefined ? { a: b.by } : {}),
          });
      for (const st of dots.get(e.i)?.values() ?? []) push(out, st);
      if (e.stunnedUntil > now)
        push(out, { s: "atordoado", k: "atordoado", t: left(e.stunnedUntil) });
      if (e.forced && e.forcedUntil > now)
        push(out, {
          s: "provocar",
          k: "provocado",
          t: left(e.forcedUntil),
          a: who(e.forced),
        });
      return out;
    });
    return any ? { h, x } : null;
  };

  const recordKills = () => {
    for (const e of enemies)
      if (!e.alive && !recorded.has(e.i)) {
        recorded.add(e.i);
        kills.push({
          enemy: e.i,
          archetype: e.input.archetype,
          level: e.input.level,
          seconds: Math.round(t * 10) / 10,
          summoned: e.i >= roomEnemies,
          alive: heroes.map((h) => h.alive),
        });
        emit({ k: "abate", b: FOE_BASE + e.i });
      }
  };
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
  const focus = (h?: Hero): Enemy | null => {
    // D71: invocados de prioridade (`summon.priority`) puxam os heróis de dano; o tanque e o suporte
    // ficam no chefe. O mais antigo primeiro, como os lacaios da sala.
    if (h && h.input.role === "dps" && priorityAdds)
      for (let k = roomEnemies; k < enemies.length; k++)
        if (enemies[k]!.alive) return enemies[k]!;
    return enemies.find((e) => e.alive) ?? null;
  };
  const isBoss = (e: Enemy) => BOSSES.has(e.input.archetype);
  /** Buff do próprio herói + o do grupo. */
  const buffOf = (h: Hero, stat: BuffStat): number =>
    sum(active(h.buffs, stat)) + sum(active(partyBuffs, stat));
  const maxHp = (h: Hero): number => h.ch.hp * (1 + buffOf(h, "hpMaxPct"));
  /** Ameaça no alvo e, com o bônus de ameaça em área (D49), a fração dela nos outros monstros vivos. */
  const gainThreat = (h: Hero, e: Enemy, v: number) => {
    h.threat[e.i]! += v;
    const area = buffOf(h, "ameacaArea");
    if (area > 0)
      for (const x of enemies)
        if (x !== e && x.alive) h.threat[x.i]! += v * area;
  };
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
    emit({ k: "queda", b: who(h) });
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
    /**
     * Golpe de skill (não o ataque básico): híbrido, usa o maior ataque do herói, ATQ ou MATQ
     * (27/11/2026, o dono: "o druida pode escolher força em vez de INT; a ótica é a habilidade ser
     * híbrida"). O elemento segue decidindo defesa, crítico e erro. As 7 referências não mudam: o
     * elemento das skills de cada classe já é o do maior ataque da build de referência.
     */
    skill?: boolean;
  }

  /** Dano de 1 golpe do herói no inimigo, antes dos bônus % (passo 6) e já com a defesa do alvo. */
  const heroHit = (
    h: Hero,
    e: Enemy,
    mult: number,
    element: Element,
    o: HitOpts = {},
  ): { value: number; landed: boolean; crit?: boolean } => {
    const ch = h.ch;
    const arch = e.input.archetype;
    const m = e.input.level;
    const power = 1 + buffOf(h, "poder");
    const avgRoll = (ch.minRoll + 1) / 2;
    const roll = () => ch.minRoll + (1 - ch.minRoll) * rnd();
    const best = Math.max(ch.atk, ch.matk);
    if (element === "sagrado") {
      const red = 1 - enemyReduction(e, ch.level, true, o.pen ?? 0);
      const r = expected || o.dot ? avgRoll : roll();
      return {
        value: (o.skill ? best : ch.atk) * power * mult * r * red,
        landed: true,
      };
    }
    const magic = element === "magico";
    const base = (o.skill ? best : magic ? ch.matk : ch.atk) * power;
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
    const crit = rnd() < c;
    const r = crit ? critMult : roll();
    return { value: base * mult * r * red, landed: true, crit };
  };

  /** Passos 6 a 10 do lado do inimigo: bônus %, Marca, diferença de nível; ameaça e roubo de vida. */
  const deal = (
    h: Hero,
    e: Enemy,
    amount: number,
    tag: HitTag = {},
  ): number => {
    let mult = 1;
    for (const b of active(partyBuffs, "dano")) mult *= 1 + b.value;
    for (const b of active(e.debuffs, "danoRecebido")) mult *= 1 + b.value;
    amount *= mult * (1 + B.levelDiffMod(h.ch.level - e.input.level));
    add(
      who(h),
      FOE_BASE + e.i,
      source,
      Math.min(amount, Math.max(0, e.hp)),
      false,
      false,
      tag,
    );
    e.hp -= amount;
    if (e.hp <= 0) e.alive = false;
    total += amount;
    h.damage += amount;
    gainThreat(h, e, amount * h.ch.threat);
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
    if (source !== "pocao" && (src || source !== "auto"))
      add(who(src ?? h), who(h), source, real, true);
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
    o: {
      magic?: boolean;
      certeiro?: boolean;
      devoted?: boolean;
      /** D71: tique de DoT de chefe (a cor do número). */
      dot?: DotKind;
    } = {},
  ) => {
    if (!h.alive) return;
    // D66 Devoção: parte do golpe vai para o paladino, com as defesas dele; o resto segue no aliado.
    const dv = h.devotion;
    if (
      !o.devoted &&
      !o.dot &&
      dv &&
      dv.until > t &&
      dv.by !== h &&
      dv.by.alive &&
      ratio(dv.by) >= dv.minHp
    ) {
      const part = raw * dv.pct;
      const was = foeSource;
      foeSource = dv.src;
      hurt(dv.by, e, part, { ...o, devoted: true });
      foeSource = was;
      raw -= part;
    }
    const ch = h.ch;
    const m = e.input.level;
    const magic = o.magic ?? false;
    let blockedNow = false;
    if (!o.certeiro && !magic && !o.dot) {
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
      if (!expected && dodged) {
        emit({ k: "golpe", a: FOE_BASE + e.i, b: who(h), v: 0, bl: "erro" });
        return;
      }
      if (blocked) blockedNow = true;
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
    if (!o.dot)
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
    add(
      FOE_BASE + e.i,
      who(h),
      foeSource,
      Math.max(0, d),
      false,
      blockedNow,
      o.dot ? { dot: o.dot } : {},
    );
    h.hp -= d;
    if (h.hp <= 0 && h.alive) {
      if (!h.cheatedDeath && tryCheatDeath(h)) return;
      die(h, o.dot ? "mecanica" : "golpe");
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
      const cost = s.manaPct * h.ch.manaBase * intCut(h);
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

  /** HP que o HoT já posto no aliado ainda vai curar. */
  const pendingHot = (q: Hero): number => {
    let out = 0;
    for (const x of q.hots)
      if (x.until > t)
        out += (x.perSec + x.pctMaxHpPerSec * maxHp(q)) * (x.until - t);
    return out;
  };

  /** Quanto a skill cura neste aliado (direta + HoT inteiro), com os bônus de quem conjura e de quem recebe. */
  const expectedHeal = (h: Hero, s: SkillDef, q: Hero): number => {
    const hb = 1 + (h.input.healBonus ?? 0);
    const power = 1 + buffOf(h, "poder");
    const pm = pmOf(h);
    const received =
      1 +
      sum(active(partyBuffs, "curaRecebida")) +
      sum(active(q.buffs, "curaRecebida"));
    let out = 0;
    for (const eff of s.effects) {
      if (eff.type === "cura" && eff.target !== "proprio") {
        let amount =
          (eff.coefMatk ?? 0) *
            h.ch.matk *
            power *
            pm *
            (eff.noBonus ? 1 : hb) +
          (eff.pctMaxHp ?? 0) * maxHp(q);
        amount *= 1 + skillBonus(h, s, null, q);
        out += amount * received;
      } else if (eff.type === "hot") {
        const per =
          (eff.coefMatkPerSec ?? 0) *
            h.ch.matk *
            power *
            pm *
            (hb + (h.input.hotBonus ?? 0)) +
          (eff.pctMaxHpPerSec ?? 0) * maxHp(q);
        out += per * (eff.durationMs / 1000) * received;
      }
    }
    return out;
  };

  /**
   * Cura inteligente (D25): sai quando a cura rende (pelo menos `healMinUseful` dela entra) e vai para
   * quem aproveita mais; com tanque precisando, o tanque. Na de grupo, a conta é sobre o grupo inteiro.
   */
  /**
   * Abaixo de que fração do HP o aliado passa à frente do tanque (D26): sem poção, a linha cheia; com
   * poção, a linha de quem tem poção (0 = nunca, o tanque continua primeiro).
   */
  const emergencyLine = (q: Hero): number => {
    const gate = cfg.skills.healEmergencyPotionGate;
    const noPotion =
      gate === "nenhum" || q.pots <= 0 || (gate === "agora" && q.potCd > 0);
    return noPotion
      ? cfg.skills.healEmergencyBelow
      : cfg.skills.healEmergencyWithPotionBelow;
  };

  const healPlan = (h: Hero, s: SkillDef): { ok: boolean; ally?: Hero } => {
    const useful = cfg.skills.healMinUseful;
    const need = (q: Hero) => Math.max(0, maxHp(q) - q.hp - pendingHot(q));
    const group = s.effects.some(
      (x) => (x.type === "cura" || x.type === "hot") && x.target === "grupo",
    );
    const alive = aliveHeroes();
    if (group) {
      let full = 0;
      let lands = 0;
      for (const q of alive) {
        const amount = expectedHeal(h, s, q);
        full += amount;
        lands += Math.min(amount, need(q));
      }
      return { ok: full > 0 && lands >= useful * full };
    }
    const hot = s.effects.find(
      (x) => x.type === "hot" && x.target === "aliado",
    );
    const key =
      hot && hot.type === "hot"
        ? `${s.id}:hot:${hot.coefMatkPerSec ?? 0}:${hot.pctMaxHpPerSec ?? 0}`
        : null;
    const cap = hot && hot.type === "hot" ? (hot.stacks ?? 1) : Infinity;
    let best: { q: Hero; lands: number } | null = null;
    let bestTank: { q: Hero; lands: number } | null = null;
    let emergency: Hero | null = null;
    const better = (
      a: { q: Hero; lands: number } | null,
      q: Hero,
      lands: number,
    ) => !a || lands > a.lands || (lands === a.lands && ratio(q) < ratio(a.q));
    for (const q of alive) {
      if (
        key &&
        q.hots.filter((x) => x.key === key && x.until > t).length >= cap
      )
        continue;
      const amount = expectedHeal(h, s, q);
      if (amount <= 0) continue;
      const lands = Math.min(amount, need(q));
      if (lands < useful * amount) continue;
      if (better(best, q, lands)) best = { q, lands };
      if (q.input.role === "tanque") {
        if (better(bestTank, q, lands)) bestTank = { q, lands };
      } else if (
        ratio(q) < emergencyLine(q) &&
        (!emergency || ratio(q) < ratio(emergency))
      )
        emergency = q;
    }
    if (emergency && !(bestTank && ratio(bestTank.q) <= ratio(emergency)))
      return { ok: true, ally: emergency };
    const pick = (cfg.skills.healTankFirst ? bestTank : null) ?? best;
    return pick ? { ok: true, ally: pick.q } : { ok: false };
  };

  const conditionHolds = (
    h: Hero,
    c: Condition,
    s: SkillDef,
  ): { ok: boolean; ally?: Hero } => {
    switch (c.kind) {
      case "precisaCura":
        return healPlan(h, s);
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
                (d) => BOSS_DOTS.has(d.kind) && d.until > t,
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
        return { ok: looseFoes(h).length > 0 };
    }
  };

  /**
   * Os monstros soltos para o tanque `h`: vivos e mirando um herói vivo que não é ele nem outro
   * tanque (o que está com outro tanque já está seguro; dois tanques não roubam um do outro).
   */
  const looseFoes = (h: Hero): Enemy[] =>
    enemies.filter(
      (e) =>
        e.alive &&
        e.target !== null &&
        e.target.alive &&
        e.target !== h &&
        e.target.input.role !== "tanque",
    );
  const tauntScope = (s: SkillDef): "alvo" | "sala" | null => {
    for (const eff of s.effects) if (eff.type === "provocar") return eff.scope;
    return null;
  };
  /**
   * A provocação só sai quando algum monstro escapou do tanque (26/11/2026, pedido do dono: "o
   * guerreiro só provoca de novo quando não estiver com o aggro dos bichos"). Vale para a skill que
   * só provoca (o Grito de Guerra): a de sala espera 2 soltos, ou 1 sem provocação de alvo pronta.
   * O golpe que também é o dano do tanque (Golpe Provocador, Golpe Sagrado) segue na recarga e vai
   * no monstro solto quando houver (`tauntFoe`): segurado, o tanque sozinho nunca o soltava (o
   * paladino empacava no L40) e perdia dano em grupo. Sozinho não há a quem provocar: nada muda.
   */
  const tauntAllowed = (h: Hero, s: SkillDef): boolean => {
    const scope = tauntScope(s);
    if (!scope) return true;
    if (!heroes.some((q) => q !== h && q.alive)) return true;
    if (s.effects.some((e) => e.type === "dano")) return true;
    // A que também protege o tanque (o Grito dá −10% de dano recebido) sai como defesa quando ele
    // segura 2+ monstros e já perdeu 30% da vida: a provocação de quebra não encurta a que está no ar.
    if (
      s.effects.some((e) => e.type === "buff" && e.target === "proprio") &&
      ratio(h) < cfg.threat.tauntDefendBelow &&
      enemies.filter((e) => e.alive && e.target === h).length >= 2
    )
      return true;
    const loose = looseFoes(h).length;
    if (loose === 0) return false;
    if (scope === "alvo" || loose >= 2) return true;
    return !h.input.skills.some(
      (q) =>
        q !== s &&
        tauntScope(q) === "alvo" &&
        (h.cds.get(q.id) ?? 0) <= t &&
        q.manaPct * h.ch.manaBase * intCut(h) <= h.mp,
    );
  };
  /** O monstro da provocação de alvo: o solto que bate no aliado com menos vida. */
  const tauntFoe = (h: Hero, s: SkillDef): Enemy | null => {
    if (tauntScope(s) !== "alvo") return null;
    let best: Enemy | null = null;
    for (const e of looseFoes(h))
      if (!best || ratio(e.target!) < ratio(best.target!)) best = e;
    return best;
  };

  const anyCondition = (h: Hero, s: SkillDef): { ok: boolean; ally?: Hero } => {
    let ok = false;
    let ally: Hero | undefined;
    for (const c of conditions(s)) {
      const r = conditionHolds(h, c, s);
      if (r.ok) {
        ok = true;
        if (r.ally && !ally) ally = r.ally;
      }
    }
    return ally ? { ok, ally } : { ok };
  };

  /** D66: a Devoção só sai com aliado vivo (que não seja tanque) para proteger. */
  const devotionAllowed = (h: Hero, s: SkillDef): boolean =>
    !s.effects.some((x) => x.type === "devocao") ||
    heroes.some((q) => q !== h && q.alive && q.input.role !== "tanque");

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
        let crit = false;
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
            skill: true,
          });
          d += r.value * n;
          landed ||= r.landed;
          crit ||= r.crit ?? false;
        }
        if (
          eff.vsFamilies &&
          x.input.family &&
          eff.vsFamilies.families.includes(x.input.family)
        )
          d *= eff.vsFamilies.mult;
        d *= (1 + skillBonus(h, s, x)) * scale * (ctx.scale ?? 1);
        any ||= landed;
        if (d <= 0 && !landed) {
          // Errou (Precisão × Fuga): só para a tela, sem sorteio (26/11/2026).
          emit({
            k: "magia",
            a: who(h),
            b: FOE_BASE + x.i,
            v: 0,
            s: s.id,
            bl: "erro",
          });
          continue;
        }
        const dealt = deal(h, x, d, { crit });
        dealtHere += dealt;
        if (s.threatMult)
          gainThreat(h, x, dealt * h.ch.threat * (s.threatMult - 1));
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
            skill: true,
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
            kind: eff.poison ? "veneno" : (eff.kind ?? "dot"),
            perSec: per,
            until: dur(eff.durationMs),
            enemy: x.i,
            nextPulse: t + 1,
            ...(eff.tickStun && eff.tickStun.chance > 0
              ? { tickStun: eff.tickStun }
              : {}),
            ...(eff.selfHealPctMaxHpPerSec
              ? { selfHeal: eff.selfHealPctMaxHpPerSec }
              : {}),
            ...(s.threatMult ? { threatMult: s.threatMult } : {}),
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
              q.shieldSrc = s.id;
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
      case "devocao": {
        // Teto de 90%: o aliado sempre leva alguma parte (o motor não desvia o golpe inteiro). Não
        // pega em outro tanque (como a do Cruzado do Ragnarok): o guerreiro se defende melhor que o
        // paladino, e desviar o golpe dele enfraquecia o grupo de dois tanques (Região do 500: 97% →
        // 92% no relatório).
        const pct = Math.min(0.9, eff.pct);
        for (const q of heroes)
          if (q !== h && q.alive && q.input.role !== "tanque")
            q.devotion = {
              by: h,
              pct,
              until: dur(eff.durationMs),
              minHp: eff.minHpPct,
              src: s.id,
            };
        break;
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
          tt.shieldSrc = s.id;
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
              other.shieldSrc = s.id;
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
          src: s.id,
        };
        return;
      }
      case "buff": {
        const map = eff.target === "grupo" ? partyBuffs : h.buffs;
        map.set(eff.group ?? `${s.id}:${eff.stat}`, {
          stat: eff.stat,
          value: eff.value,
          until: dur(eff.durationMs),
          src: s.id,
          by: who(h),
          ...(eff.excludeCaster ? { selfless: true } : {}),
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
            src: s.id,
            by: who(h),
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
          // Não soma nem encurta: a do mesmo tanque vale até a que acabar por último.
          x.forcedUntil =
            x.forced === h
              ? Math.max(x.forcedUntil, dur(eff.durationMs))
              : dur(eff.durationMs);
          x.forced = h;
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
    const prevSource = source;
    source = s.id;
    try {
      resolveSkill(h, s, ally);
    } finally {
      source = prevSource;
    }
  };

  const resolveSkill = (h: Hero, s: SkillDef, ally: Hero | undefined) => {
    const e = tauntFoe(h, s) ?? focus(h);
    const ctx: Ctx = { landed: true };
    for (const eff of s.effects) applyEffect(h, s, eff, e, ally, ctx);
    for (const hook of s.hooks ?? []) {
      if (hook.on === "repete") {
        const again: Ctx = { landed: true, scale: hook.pct };
        for (const eff of s.effects)
          if (eff.type === "dano") applyEffect(h, s, eff, focus(h), ally, again);
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
    emit({ k: "lanca", a: who(h), s: s.id });
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
        // D65 (27/11/2026): com a ameaça zerada (o começo de cada sala), abre quem chama mais atenção
        // — o multiplicador de ameaça da classe com a VIT: o tanque; sem tanque, o suporte; empate, a
        // ordem — e não o 1º da lista, que no jogo é quem criou o grupo. Antes o mago que criava o
        // grupo levava o 1º golpe de todos os monstros de cada sala, antes de o tanque agir.
        let best = alive[0]!;
        for (const q of alive) if (q.ch.threat > best.ch.threat) best = q;
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
      if (rec) {
        const n = (rec.cataclysm.get(e.i) ?? 0) + 1;
        rec.cataclysm.set(e.i, n);
        emit({ k: "cataclismo", a: FOE_BASE + e.i, n });
      }
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
      if (ph && !e.inPhase && e.hp <= ph.at * e.input.hp) {
        e.inPhase = true;
        announce(e, "fase");
      }
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
          if (e.target.alive) {
            announce(e, "golpe-pesado", e.target);
            foeSource = "golpe-pesado";
            hurt(e.target, e, e.input.autoRaw * e.input.buster.mult * dmg, {
              certeiro: true,
            });
            foeSource = "golpe";
          }
          e.busterTimer += e.input.buster.everySeconds;
        }
      }
      if (e.input.pulse) {
        e.pulseTimer -= tick;
        if (e.pulseTimer <= 0) {
          const magicPulse = e.input.pulse.magic ?? true;
          const name = magicPulse ? "pulso" : "talho";
          announce(e, name);
          foeSource = name;
          for (const q of heroes)
            if (q.alive)
              hurt(q, e, e.input.pulse.raw * dmg, { magic: magicPulse });
          foeSource = "golpe";
          e.pulseTimer += e.input.pulse.everySeconds;
        }
      }
      const pickNonTank = (skip: readonly Hero[] = []): Hero | null => {
        const pool = heroes.filter(
          (q) => q.alive && q.input.role !== "tanque" && !skip.includes(q),
        );
        if (pool.length === 0) return null;
        return expected
          ? pool[e.pick++ % pool.length]!
          : pool[Math.floor(rnd() * pool.length)]!;
      };
      const cu = e.input.curse;
      if (cu) {
        e.curseTimer -= tick;
        if (e.curseTimer <= 0) {
          const kind: BossDot = cu.kind ?? "maldicao";
          const hit: Hero[] = [];
          if (cu.targets === "grupo")
            hit.push(...heroes.filter((q) => q.alive));
          else
            for (let k = 0; k < (cu.targets ?? 1); k++) {
              const q = pickNonTank(hit);
              if (q) hit.push(q);
            }
          if (hit.length > 0)
            announce(e, kind, hit.length === 1 ? hit[0] : undefined);
          const raw = cu.rawPerSecond !== undefined;
          for (const q of hit)
            q.debuffs.set(kind, {
              kind,
              until: t + cu.maxSeconds,
              // A fase 2 vale no DoT como no golpe (o bruto; a fração do HP fica como era).
              value: raw ? cu.rawPerSecond! * dmg : (cu.pctPerSecond ?? 0),
              by: e.i,
              ...(raw ? { raw: true, magic: cu.magic ?? true } : {}),
            });
          e.curseTimer += cu.everySeconds;
        }
      }
      const md = e.input.manaDrain;
      if (md) {
        e.drainTimer -= tick;
        if (e.drainTimer <= 0) {
          announce(e, "dreno");
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
          if (q) {
            announce(e, "investida", q);
            foeSource = "investida";
            hurt(q, e, e.input.autoRaw * ca.mult * dmg);
            foeSource = "golpe";
          }
          e.chargeTimer += ca.everySeconds;
        }
      }
      const su = e.input.summon;
      if (su) {
        e.summonTimer -= tick;
        if (e.summonTimer <= 0) {
          announce(e, "invocacao");
          const prey: Hero[] = [];
          const preyPool = heroes.filter(
            (q) => q.alive && q.input.role !== "tanque",
          ).length;
          for (let k = 0; k < su.count; k++) {
            const add = newEnemy(su.minion, enemies.length);
            // D71: nasce no pescoço de um não tanque (um para cada, depois repete); fica nele até alguém
            // passar a ameaça (o tanque puxa com ameaça em área ou provocação).
            if (su.hunt) {
              if (prey.length >= preyPool) prey.length = 0;
              const q = pickNonTank(prey);
              if (q) {
                prey.push(q);
                add.target = q;
              }
            }
            enemies.push(add);
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
        if (BOSS_DOTS.has(d.kind)) {
          const by = enemies[d.by ?? 0] ?? enemies[0]!;
          const dk = DOT_KIND[d.kind as BossDot];
          if (d.raw) {
            // D71: o golpe bruto do DoT, cortado como um golpe (DEF ou MDEF, nível, reduções, escudos).
            foeSource = d.kind;
            hurt(h, by, d.value * DT, { magic: d.magic ?? true, dot: dk });
            foeSource = "golpe";
          } else {
            const v = d.value * maxHp(h) * DT;
            add(FOE_BASE + by.i, who(h), d.kind, v, false, false, { dot: dk });
            h.hp -= v;
          }
          if (!h.alive) break;
        } else if (d.kind === "drenar")
          h.mp = Math.max(0, h.mp - d.value * ch.mp * DT);
      }
      if (!h.alive) continue;
      if (h.hp <= 0) {
        die(h, "mecanica");
        continue;
      }
      const regen =
        ch.mp * cfg.regen.mpPctPerSecond +
        cfg.regen.mpPerIntPerSecond * ch.attrs.INT +
        ch.mp *
          sum(
            active(partyBuffs, "regenManaPct").filter(
              (b) => !(b.selfless && b.by === h.i),
            ),
          );
      h.mp = Math.min(ch.mp, h.mp + regen * DT);
      // A regeneração da VIT (27/11/2026) soma com a dos buffs.
      const hpRegen = buffOf(h, "regenVidaPct") + (ch.hpRegenPct ?? 0);
      if (hpRegen > 0) heal(h, maxHp(h) * hpRegen * DT, null);

      if (h.manaShield && h.manaShield.until <= t) {
        h.mp = Math.min(ch.mp, h.mp + h.manaShield.spent * h.manaShield.refund);
        h.manaShield = null;
      }

      h.hots = h.hots.filter((x) => {
        if (x.until > t) {
          source = x.key.split(":")[0]!;
          heal(h, (x.perSec + x.pctMaxHpPerSec * maxHp(h)) * DT, x.src);
          source = "auto";
          return true;
        }
        return false;
      });

      h.potCd -= DT;
      const hasHp = h.hpPots === null ? h.pots > 0 : h.hpPots > 0;
      const hasMp = h.mpPots === null ? h.pots > 0 : h.mpPots > 0;
      if (h.potCd <= 0 && (hasHp || hasMp)) {
        const at = h.input.potionAt ?? { hp: 0.5, mp: 0.3 };
        // D46: mana crítica passa na frente (só para quem bebe mana; a vida não pode estar crítica).
        const crit = cfg.potions.manaCritical;
        const manaFirst =
          hasMp &&
          h.mp / ch.mp < Math.min(crit.mpBelow, at.mp) &&
          ratio(h) >= crit.hpAbove;
        if (!manaFirst && ratio(h) < at.hp && hasHp) {
          const before = h.hp;
          source = "pocao";
          heal(h, h.input.potions.hp * (ch.potionMult ?? 1), null);
          source = "auto";
          emit({ k: "pocao", a: who(h), v: Math.round(h.hp - before) });
          h.pots--;
          if (h.hpPots !== null) h.hpPots--;
          h.potionsUsed++;
          h.hpPotions++;
          h.potCd =
            (h.input.potions.hpCooldownMs ?? cfg.potions.cooldownMs) / 1000;
        } else if (h.mp / ch.mp < at.mp && hasMp) {
          const before = h.mp;
          h.mp = Math.min(ch.mp, h.mp + h.input.potions.mp);
          emit({
            k: "pocao",
            a: who(h),
            v: Math.round(h.mp - before),
            mana: true,
          });
          h.pots--;
          if (h.mpPots !== null) h.mpPots--;
          h.potionsUsed++;
          h.mpPotions++;
          h.potCd =
            (h.input.potions.mpCooldownMs ?? cfg.potions.cooldownMs) / 1000;
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
          const e = focus(h);
          if (e) {
            const r =
              ch.kind === "magic"
                ? heroHit(h, e, h.input.magicAutoAttack ?? 0.6, "magico")
                : heroHit(h, e, 1, "fisico", {
                    critFlat: buffOf(h, "critico"),
                    critMult: buffOf(h, "multCritico") + ch.critMultBonus,
                  });
            h.autos++;
            // Errou (Precisão × Fuga): a tela mostra; antes o golpe sumia (26/11/2026).
            if (!r.landed)
              emit({ k: "golpe", a: who(h), b: FOE_BASE + e.i, v: 0, bl: "erro" });
            h.autoDamage += deal(h, e, r.value, { crit: r.crit ?? false });
          }
          h.auto += 1 / ch.attacksPerSecond;
        }
      }

      h.dots = h.dots.filter((x) => {
        if (x.until <= t) return false;
        const e = enemies[x.enemy];
        if (e && e.alive) {
          source = x.key.split(":")[0]!;
          const dealt = deal(h, e, x.perSec * DT, { dot: x.kind });
          if (x.threatMult)
            gainThreat(h, e, dealt * h.ch.threat * (x.threatMult - 1));
          if (x.selfHeal) heal(h, x.selfHeal * maxHp(h) * DT, null);
          if (x.tickStun && t >= x.nextPulse) {
            x.nextPulse += 1;
            if (proc(h, `${x.key}:pulso`, x.tickStun.chance))
              stun(e, x.tickStun.durationMs);
          }
          source = "auto";
        }
        return true;
      });

      h.gcd -= DT;
      if (h.gcd > 0 || h.casting) continue;
      for (const s of h.input.skills) {
        if ((h.cds.get(s.id) ?? 0) > t) continue;
        const cost = s.manaPct * ch.manaBase * intCut(h);
        if (cost > h.mp) continue;
        const cond = anyCondition(h, s);
        if (!cond.ok) continue;
        if (!tauntAllowed(h, s)) continue;
        if (burstHeld(h, s)) continue;
        if (!devotionAllowed(h, s)) continue;
        const target = pickAlly(h, s, cond.ally);
        if (!target.ok) continue;
        doCast(h, s, target.ally, cost);
        break;
      }
    }

    recordKills();
    if (rec && Math.floor(t + DT + 1e-9) > Math.floor(t + 1e-9))
      flushFrame(Math.floor(t + DT + 1e-9));
    t += DT;
  }
  if (rec) {
    recordKills();
    const last = rec.frames.at(-1)?.s ?? 0;
    if (rec.events.length > 0 || rec.acc.size > 0 || last < Math.ceil(t - 1e-9))
      flushFrame(Math.max(last + 1, Math.ceil(t - 1e-9)));
  }

  return {
    win: enemies.every((e) => !e.alive),
    seconds: Math.round(t * 10) / 10,
    deaths,
    firstDeath,
    damage: total,
    enemiesLeft: enemies.map((e) => Math.max(0, e.hp) / e.input.hp),
    kills,
    ...(rec ? { frames: rec.frames } : {}),
    heroes: heroes.map((h) => ({
      cls: h.input.cls,
      damage: h.damage,
      autoDamage: h.autoDamage,
      healed: h.healed,
      hpPct: h.hp / h.ch.hp,
      potionsUsed: h.potionsUsed,
      autos: h.autos,
      hpPotions: h.hpPotions,
      mpPotions: h.mpPotions,
      alive: h.alive,
      casts: h.casts,
      threat: [...h.threat],
      carry: {
        hp: Math.max(0, h.hp),
        mp: h.mp,
        alive: h.alive,
        pots: h.pots,
        ...(h.hpPots !== null ? { hpPots: h.hpPots } : {}),
        ...(h.mpPots !== null ? { mpPots: h.mpPots } : {}),
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
