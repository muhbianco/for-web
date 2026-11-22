import {
  ABYSS_STEP,
  type Boons,
  CLASSES,
  DEGREE,
  type Degree,
  type Element,
  ENEMIES,
  type EnemyId,
  MAX_ABYSS,
  MIN_INTERVAL_MS,
  POISON_MS,
  RULES,
  type SkillId,
  SPELL_BY_ID,
  type SpellDef,
  SPELLS,
  WEAPON_STUN_MS,
  WEAPONS,
} from "./data.ts";
import { Rng } from "./rng.ts";
import { baseHitCenti, type HeroCombat } from "./stats.ts";

/** Ordem das magias e limites (em % da vida) que o jogador escolhe no Refúgio. */
export interface Tactics {
  order: string[];
  potionAt: number;
  healAt: number;
}
export const DEFAULT_TACTICS: Readonly<Tactics> = { order: [], potionAt: 35, healAt: 60 };
export const MAX_TACTIC_SPELLS = 6;

/** Tudo o que decide uma luta. O servidor manda isto na `game.fight` e o app roda a mesma função. */
export interface FightInput {
  engine: number;
  seed: number;
  hero: HeroCombat;
  hp: number;
  mp: number;
  potions: number;
  boons: Boons;
  tactics: Tactics;
  foes: EnemyId[];
  degree: Degree;
  abyss: number;
  /** Escala da vida e do ataque dos inimigos (%); 100 fora da iniciação. */
  foePct: number;
}

export interface FightResult {
  won: boolean;
  /** Passou do limite de 120 s com o herói vivo (conta como derrota). */
  timeout: boolean;
  hp: number;
  mp: number;
  potions: number;
  durationMs: number;
  tries: Partial<Record<SkillId, number>>;
  kills: EnemyId[];
  events: number;
}

/** Quem age na luta: −1 é o herói, i ≥ 0 é o inimigo i (os chamados entram no fim da lista). */
export type FightEvent =
  | { t: number; k: "hit"; by: number; to: number; dmg: number; crit: boolean; spell?: string }
  | { t: number; k: "miss"; by: number; to: number }
  | { t: number; k: "cast"; spell: string }
  | { t: number; k: "heal"; v: number }
  | { t: number; k: "potion"; v: number }
  | { t: number; k: "dot"; to: number; dmg: number }
  | { t: number; k: "die"; who: number }
  | { t: number; k: "summon"; who: number; enemy: EnemyId };

interface Unit {
  enemy: EnemyId;
  hp: number;
  maxHp: number;
  /** Ataque em centésimos. */
  atkC: number;
  armor: number;
  intervalMs: number;
  next: number;
  resist: Partial<Record<Element, number>>;
  poisonPct: number;
  heavy: { every: number; pct: number } | undefined;
  boss: boolean;
  dead: boolean;
  attacks: number;
  stunUntil: number;
  weakUntil: number;
  weakPct: number;
  markUntil: number;
  markPct: number;
  dots: { dps: number; until: number }[];
}

/** Multiplicador do degrau em milésimos de % (100% = 100.000), com o Abismo composto passo a passo. */
export function degreeMul(base: number, stepPct: number, degree: Degree, abyss: number): number {
  let m = base * 1000;
  const steps = degree === "abismo" ? Math.min(MAX_ABYSS, Math.max(1, abyss)) - 1 : 0;
  for (let i = 0; i < steps; i++) m = Math.floor((m * stepPct) / 100);
  return m;
}

export function scaleEnemy(id: EnemyId, degree: Degree, abyss: number, foePct = 100): Unit {
  const e = ENEMIES[id];
  const d = DEGREE[degree];
  const hpM = degreeMul(d.hpPct, ABYSS_STEP.hpPct, degree, abyss);
  const atkM = degreeMul(d.atkPct, ABYSS_STEP.atkPct, degree, abyss);
  const hp = Math.max(1, Math.floor((Math.floor((e.hp * hpM) / 100_000) * foePct) / 100));
  const atkC = Math.max(1, Math.floor((Math.floor((e.atk10 * 10 * atkM) / 100_000) * foePct) / 100));
  return {
    enemy: id,
    hp,
    maxHp: hp,
    atkC,
    armor: Math.floor((e.armor * d.armorPct) / 100),
    intervalMs: e.intervalMs,
    next: 0,
    resist: e.resist,
    poisonPct: e.poisonPct,
    heavy: e.heavy,
    boss: e.boss,
    dead: false,
    attacks: 0,
    stunUntil: 0,
    weakUntil: 0,
    weakPct: 0,
    markUntil: 0,
    markPct: 0,
    dots: [],
  };
}

/** Magias que a tática usa, na ordem: as escolhidas e liberadas, ou todas as liberadas pela ordem de nível. */
export function tacticSpells(hc: HeroCombat, tactics: Tactics): SpellDef[] {
  const unlocked = (s: SpellDef | undefined): s is SpellDef => !!s && s.cls === hc.cls && s.unlock <= hc.level;
  const chosen = tactics.order.slice(0, MAX_TACTIC_SPELLS).map((id) => SPELL_BY_ID.get(id)).filter(unlocked);
  return chosen.length ? chosen : SPELLS.filter(unlocked);
}

/**
 * Uma luta inteira, por eventos: cada unidade tem a hora do próximo golpe e os
 * efeitos contínuos batem a cada 1 s. Determinística dada a entrada; tudo em
 * inteiros (centésimos de vida no meio da conta, décimos de mana).
 * Empate de horário: efeito contínuo, depois o herói, depois os inimigos na ordem.
 */
export function fight(input: FightInput, onEvent?: (e: FightEvent) => void): FightResult {
  const hc = input.hero;
  const boons = input.boons;
  const rng = new Rng(input.seed);
  const cls = CLASSES[hc.cls];
  const weapon = WEAPONS[hc.weapon];
  const maxHp = Math.floor((hc.maxHp * (100 + boons.maxHpPct)) / 100);
  const maxMp10 = hc.maxMp * 10;
  let hp = Math.max(0, Math.min(input.hp, maxHp));
  let mp10 = Math.max(0, Math.min(input.mp, hc.maxMp)) * 10;
  let potions = Math.max(0, Math.min(input.potions, RULES.maxPotions));
  const units = input.foes.map((f) => scaleEnemy(f, input.degree, input.abyss, input.foePct));
  units.forEach((u, i) => (u.next = 400 + i * 350));
  const spells = tacticSpells(hc, input.tactics);
  const cd = new Map<string, number>();
  const interval = Math.max(MIN_INTERVAL_MS, Math.floor((weapon.intervalMs * 100) / (100 + hc.speedPct + boons.speedPct)));
  const critBp = Math.min(RULES.critCapBoonsBp, hc.critBp + boons.critBp);
  const base = baseHitCenti(hc, boons.dmgPct);
  const magicClass = weapon.skill === "magia";
  const potionAt = clampPct(input.tactics.potionAt);
  const healAt = clampPct(input.tactics.healAt);
  let heroNext = 200;
  let ward = Math.floor((maxHp * boons.wardPct) / 100);
  let heroWeakUntil = 0;
  let shieldUntil = 0;
  let shieldPct = 0;
  let poison = { dps: 0, until: 0 };
  let potionCd = 0;
  let t = 0;
  let nextTick = RULES.tickMs;
  let events = 0;
  let summoned = false;
  const tries: Partial<Record<SkillId, number>> = {};
  const kills: EnemyId[] = [];
  const emit = onEvent ?? (() => {});
  const addTry = (sk: SkillId, n: number) => (tries[sk] = (tries[sk] ?? 0) + n);
  const alive = () => units.filter((u) => !u.dead);
  const kill = (u: Unit) => {
    if (u.dead || u.hp > 0) return;
    u.dead = true;
    kills.push(u.enemy);
    emit({ t, k: "die", who: units.indexOf(u) });
  };

  /** Dano do herói num inimigo, a partir de um valor em centésimos. */
  const hitUnit = (u: Unit, rawC: number, el: Element, spell?: string, ignoreArmor = false) => {
    const crit = rng.bp(critBp);
    let c = Math.floor((rawC * (85 + (rng.u32() % 31))) / 100);
    if (crit) c = Math.floor((c * RULES.critPct) / 100);
    if (u.markUntil > t) c = Math.floor((c * (100 + u.markPct)) / 100);
    c = Math.floor((c * (100 - (u.resist[el] ?? 0))) / 100);
    if (el === "fisico") {
      if (!ignoreArmor) c = Math.floor((c * 100) / (100 + u.armor));
    } else c = Math.floor((c * 100) / (100 + Math.floor(u.armor / 3)));
    const d = Math.max(1, Math.floor(c / 100));
    u.hp -= d;
    emit({ t, k: "hit", by: -1, to: units.indexOf(u), dmg: d, crit, ...(spell ? { spell } : {}) });
    if (cls.passive === "sangue_de_ferro" && el === "fisico") hp = Math.min(maxHp, hp + Math.floor(d / 10));
    kill(u);
  };

  /** Golpe de um inimigo no herói (centésimos); devolve o dano que entrou. */
  const damageHero = (u: Unit, rawC: number): number => {
    let c = rawC;
    if (shieldUntil > t) c = Math.floor((c * (100 - shieldPct)) / 100);
    if (rng.bp(hc.dodgeBp)) {
      emit({ t, k: "miss", by: units.indexOf(u), to: -1 });
      return 0;
    }
    if (hc.blockBp && rng.bp(hc.blockBp)) c = Math.floor((c * 40) / 100);
    c = Math.floor((c * 100) / (100 + hc.armor));
    addTry("escudo", RULES.tries.shield);
    let d = Math.max(1, Math.floor(c / 100));
    if (cls.passive === "veu_arcano") {
      const floor10 = Math.ceil((maxMp10 * 20) / 100);
      if (mp10 > floor10) {
        const m = Math.min(Math.floor((d * 25) / 100), Math.floor((mp10 - floor10) / 10));
        mp10 -= m * 10;
        d -= m;
      }
    }
    if (ward > 0) {
      const a = Math.min(ward, d);
      ward -= a;
      d -= a;
    }
    hp -= d;
    emit({ t, k: "hit", by: units.indexOf(u), to: -1, dmg: d, crit: false });
    return d;
  };

  while (t < RULES.fightLimitMs) {
    const live = alive();
    if (live.length === 0 || hp <= 0) break;
    events++;
    let tn = Math.min(heroNext, nextTick);
    for (const u of live) if (u.next < tn) tn = u.next;
    t = tn;
    if (t >= RULES.fightLimitMs) break;

    if (t === nextTick) {
      nextTick += RULES.tickMs;
      if (poison.until > t) hp -= poison.dps;
      for (const u of live) {
        u.dots = u.dots.filter((d) => d.until > t);
        for (const d of u.dots) {
          if (u.dead) break;
          u.hp -= d.dps;
          emit({ t, k: "dot", to: units.indexOf(u), dmg: d.dps });
          kill(u);
        }
      }
      mp10 = Math.min(maxMp10, mp10 + hc.mpRegen10);
      if (boons.regenPerMille > 0 && hp > 0) hp = Math.min(maxHp, hp + Math.max(1, Math.floor((maxHp * boons.regenPerMille) / 1000)));
      if (potions > 0 && potionCd <= t && hp > 0 && hp * 100 < maxHp * potionAt) {
        const v = Math.floor((maxHp * RULES.potionPct) / 100);
        hp = Math.min(maxHp, hp + v);
        potions--;
        potionCd = t + RULES.potionCdMs;
        emit({ t, k: "potion", v });
      }
      continue;
    }

    if (t === heroNext) {
      heroNext = t + interval;
      let cast: SpellDef | undefined;
      for (const sp of spells) {
        if ((cd.get(sp.id) ?? 0) > t || mp10 < sp.mp * 10) continue;
        if (sp.kind === "cura" && hp * 100 >= maxHp * healAt) continue;
        if (sp.kind === "escudo" && (shieldUntil > t || hp * 100 > maxHp * 85)) continue;
        if (sp.kind === "area" && !sp.targets && live.length < 2) continue;
        if (sp.kind === "enfraquece" && heroWeakUntil > t) continue;
        cast = sp;
        break;
      }
      const tgt = live.reduce((m, u) => (u.hp < m.hp ? u : m), live[0]!);
      if (!cast) {
        hitUnit(tgt, base, weapon.element);
        addTry(weapon.skill, RULES.tries.basic);
        if (weapon.stunBp && rng.bp(weapon.stunBp)) tgt.stunUntil = Math.max(tgt.stunUntil, t + WEAPON_STUN_MS);
        if (boons.cleaveBp && rng.bp(boons.cleaveBp)) {
          const other = alive().find((u) => u !== tgt);
          if (other) hitUnit(other, Math.floor((base * 60) / 100), weapon.element);
        }
        continue;
      }
      mp10 -= cast.mp * 10;
      cd.set(cast.id, t + cast.cdMs);
      addTry(magicClass ? "magia" : weapon.skill, RULES.tries.spell);
      emit({ t, k: "cast", spell: cast.id });
      const casts = boons.echoBp && rng.bp(boons.echoBp) ? 2 : 1;
      for (let c = 0; c < casts; c++) {
        const pw = Math.floor((Math.floor((base * cast.power) / 100) * (c === 1 ? 50 : 100)) / 100);
        switch (cast.kind) {
          case "dano":
            if (!tgt.dead) hitUnit(tgt, pw, cast.element, cast.id, cast.ignoreArmor);
            if (cast.stunMs) tgt.stunUntil = Math.max(tgt.stunUntil, t + cast.stunMs);
            if (cast.burnPct && !tgt.dead) tgt.dots.push({ dps: Math.max(1, Math.floor((pw * cast.burnPct) / 10_000)), until: t + 4000 });
            break;
          case "area":
            for (const u of alive().slice(0, cast.targets ?? units.length)) {
              hitUnit(u, pw, cast.element, cast.id);
              if (cast.stunMs) u.stunUntil = Math.max(u.stunUntil, t + cast.stunMs);
            }
            break;
          case "corrente": {
            let p = pw;
            for (const u of alive().slice(0, cast.targets ?? 3)) {
              hitUnit(u, p, cast.element, cast.id);
              p = Math.floor((p * 75) / 100);
            }
            break;
          }
          case "dot":
            // `pw` (power% do golpe base) já é o dano por segundo, por 6 s, em todos.
            for (const u of alive()) u.dots.push({ dps: Math.max(1, Math.floor(pw / 100)), until: t + 6000 });
            break;
          case "cura": {
            const before = hp;
            hp = Math.min(maxHp, hp + Math.floor((maxHp * cast.power) / 100) + Math.floor((pw * 40) / 10_000));
            emit({ t, k: "heal", v: hp - before });
            break;
          }
          case "escudo":
            shieldUntil = t + 6000;
            shieldPct = cast.power;
            break;
          case "marca":
            tgt.markUntil = t + 10_000;
            tgt.markPct = cast.power;
            break;
          case "enfraquece":
            heroWeakUntil = t + 8000;
            for (const u of alive()) {
              u.weakUntil = t + 8000;
              u.weakPct = cast.power;
            }
            break;
        }
      }
      continue;
    }

    for (const u of live) {
      if (u.next !== t || u.dead) continue;
      let iv = u.intervalMs;
      if (u.boss && u.hp * 4 < u.maxHp) iv = Math.floor((iv * 100) / 140);
      u.next = t + iv;
      if (u.stunUntil > t) continue;
      u.attacks++;
      let raw = Math.floor((u.atkC * (85 + (rng.u32() % 31))) / 100);
      if (u.heavy && u.attacks % u.heavy.every === 0) raw = Math.floor((raw * u.heavy.pct) / 100);
      if (u.weakUntil > t) raw = Math.floor((raw * (100 - u.weakPct)) / 100);
      if (u.boss && t > RULES.enrageMs) raw *= 2;
      if (t > RULES.collapseMs) raw = Math.floor((raw * (10 + Math.floor((t - RULES.collapseMs) / 10_000))) / 10);
      const taken = damageHero(u, raw);
      // O chefe só envenena na segunda fase (abaixo de 60% da vida).
      if (u.poisonPct && taken > 0 && (!u.boss || u.hp * 10 < u.maxHp * 6)) {
        poison = { dps: Math.max(1, Math.floor((taken * u.poisonPct) / 100)), until: t + POISON_MS };
      }
      if (u.boss && !summoned && u.hp * 2 < u.maxHp) {
        summoned = true;
        for (let k = 0; k < 2; k++) {
          const r = scaleEnemy("rato", input.degree, input.abyss, input.foePct);
          r.next = t + 600 + k * 300;
          units.push(r);
          emit({ t, k: "summon", who: units.length - 1, enemy: "rato" });
        }
      }
      if (hp <= 0) break;
    }
  }
  const won = alive().length === 0 && hp > 0;
  return {
    won,
    timeout: !won && hp > 0,
    hp: Math.max(0, hp),
    mp: Math.floor(mp10 / 10),
    potions,
    durationMs: t,
    tries,
    kills,
    events,
  };
}

function clampPct(v: number): number {
  return Math.min(90, Math.max(10, Math.floor(v)));
}
