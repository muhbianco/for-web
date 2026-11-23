import { Rng } from "../rng.ts";
import {
  type BlockType,
  type BloodState,
  type FightMode,
  ATTACK_FACTOR,
  blockHit,
  defenseFactor,
  distanceDamage,
  distanceHitChance,
  distanceHits,
  distanceSkillPoint,
  freshBlood,
  maxWeaponDamage,
  meleeDamage,
  meleeSkillPoint,
  normalRandom,
  onOwnBlock,
  onTargetBlock,
  playerArmor,
  playerDefense,
  uniformRandom,
} from "./combat.ts";
import {
  type Rates,
  type SkillId,
  type Vocation,
  type VocationId,
  VOCATIONS,
} from "./data.ts";
import { type Dungeon, dungeonOf } from "./dungeons.ts";
import {
  type ArmorSlot,
  type Element,
  type ItemDef,
  ARMOR_SLOTS,
  canUse,
  itemDef,
  starterKit,
} from "./items.ts";
import { rollLoot } from "./loot.ts";
import { type MonsterAttack, type MonsterDef, monsterDef } from "./monsters.ts";
import { canShare, sharedExperience } from "./party.ts";
import { lowLevelBonus } from "./progression.ts";
import { type SpellDef, spellRange, spellsFor } from "./spells.ts";
import { STAMINA, staminaMultiplier } from "./stamina.ts";

/**
 * A corrida da dungeon (docs/espaco/jogo/ot, etapa O5). O servidor calcula a corrida inteira
 * quando o líder começa: não há escolha no meio (é idle), então nada depende do que o app
 * manda depois. A simulação anda de segundo em segundo, no ritmo do OT (ataque a cada 2 s,
 * 2 bloqueios por segundo, magias por intervalo), e usa as fórmulas de combat.ts. O app
 * recebe um quadro por segundo, quando o segundo chega.
 *
 * Adaptações [nosso], todas aqui:
 * - sem mapa: o cavaleiro fica na frente; o arqueiro atira de 3 tiles; o grupo inteiro bate
 *   no primeiro monstro vivo da sala; monstros corpo a corpo escolhem um cavaleiro se houver;
 * - os heróis lutam no modo equilibrado e estão sempre "atacando há pouco" (fator de defesa);
 * - quem morre fica fora até o fim; vida e mana se recuperam pelo ritmo da vocação (comida);
 * - level, vida e skills não mudam no meio da corrida: o ganho entra no fim.
 */

export const RUN = {
  maxSeconds: 20 * 60,
  /** Respiro entre as salas. */
  stagePauseSeconds: 3,
  /** Distância do arqueiro ao alvo, em tiles [nosso]. */
  archerDistance: 3,
  fightMode: "equilibrado" as FightMode,
  /** Cura em si abaixo desta fração da vida; cura num companheiro abaixo de `healOtherBelow`. */
  healBelow: 0.5,
  healOtherBelow: 0.4,
  /** Muda quando as regras da simulação mudam: corrida gravada com outra versão não é refeita. */
  engine: 1,
} as const;

// ---- equipamento -------------------------------------------------------------

/** O que o herói veste na corrida: ids de itens. */
export interface Gear {
  weapon: string | null;
  shield: string | null;
  armor: Partial<Record<ArmorSlot, string>>;
}

/** Skill que a arma usa [TFS Player::getWeaponSkill]; varinha e sem arma de distância: punhos. */
function weaponSkill(item: ItemDef | null, skills: Record<SkillId, number>) {
  if (!item) return skills.punhos;
  switch (item.kind) {
    case "espada":
    case "machado":
    case "maca":
      return skills[item.kind];
    case "distancia":
      return skills.distancia;
    default:
      return 0;
  }
}

/** Dano médio esperado por golpe, para escolher a melhor arma [nosso]. */
export function weaponScore(
  item: ItemDef,
  voc: Vocation,
  level: number,
  skills: Record<SkillId, number>,
  manaMax: number,
): number {
  const factor = ATTACK_FACTOR[RUN.fightMode];
  switch (item.kind) {
    case "espada":
    case "machado":
    case "maca":
      return (
        (maxWeaponDamage(level, skills[item.kind], item.attack ?? 0, factor) *
          voc.meleeDamage) /
        2
      );
    case "distancia": {
      const max =
        maxWeaponDamage(level, skills.distancia, item.attack ?? 0, factor) *
        voc.distDamage;
      const chance = distanceHitChance(
        skills.distancia,
        RUN.archerDistance,
        item.hitCap ?? 75,
      );
      return ((Math.ceil(level * 0.2) + max) / 2) * (chance / 100);
    }
    case "varinha": {
      const w = item.wand;
      if (!w || (w.mana > 0 && manaMax < w.mana)) return 0;
      return (w.min + w.max) / 2;
    }
    default:
      return 0;
  }
}

/**
 * O melhor do kit e da mochila [nosso]: a arma de maior dano esperado com as skills de hoje,
 * o escudo de maior defesa (só o cavaleiro: o arco usa as duas mãos e o mago não tem escudo
 * nesta etapa) e, em cada peça, a maior armadura.
 */
export function bestGear(
  vocation: VocationId,
  level: number,
  skills: Record<SkillId, number>,
  manaMax: number,
  owned: readonly string[],
): Gear {
  const voc = VOCATIONS[vocation];
  const base = voc.base;
  const items: ItemDef[] = [...starterKit(base)];
  for (const id of owned) {
    const it = itemDef(id);
    if (it && !items.includes(it)) items.push(it);
  }
  const usable = items.filter((i) => canUse(i, base, level));
  const pick = (slot: string, score: (i: ItemDef) => number) => {
    let best: ItemDef | null = null;
    let bestScore = -Infinity;
    for (const i of usable) {
      if (i.slot !== slot) continue;
      const s = score(i);
      if (s > bestScore || (s === bestScore && best && i.id < best.id)) {
        best = i;
        bestScore = s;
      }
    }
    return best;
  };
  const weapon = pick(
    "arma",
    (i) =>
      weaponScore(i, voc, level, skills, manaMax) * 1000 + (i.defense ?? 0),
  );
  const shield = base === 4 ? pick("escudo", (i) => i.defense ?? 0) : null;
  const armor: Gear["armor"] = {};
  for (const slot of ARMOR_SLOTS) {
    const it = pick(slot, (i) => i.armor ?? 0);
    if (it) armor[slot] = it.id;
  }
  return { weapon: weapon?.id ?? null, shield: shield?.id ?? null, armor };
}

// ---- simulação ---------------------------------------------------------------

/**
 * Quanto a sala cresce com o grupo [nosso]: ×1 sozinho, +30% por herói a mais. Com +50% a
 * dupla de level 1 (cavaleiro e mago sem mana) perdia sempre, pior que o cavaleiro sozinho.
 */
export function partyScale(members: number): number {
  return 1 + 0.3 * (Math.max(1, members) - 1);
}

/** Os monstros de uma sala, já no tamanho do grupo (o app mostra a lista e a vida). */
export function stageMonsters(
  dungeonId: string,
  st: number,
  members: number,
): { id: string; health: number }[] {
  const stage = dungeonOf(dungeonId)?.stages[st];
  if (!stage) return [];
  const scale = partyScale(members);
  const out: { id: string; health: number }[] = [];
  for (const g of stage.monsters) {
    const def = monsterDef(g.id);
    if (!def) continue;
    const count = def.boss ? g.count : Math.round(g.count * scale);
    const health = def.boss ? Math.round(def.health * scale) : def.health;
    for (let c = 0; c < count; c++) out.push({ id: g.id, health });
  }
  return out;
}

/** Um herói como entra na corrida (cópia do herói no início). */
export interface RunHero {
  userId: string;
  name: string;
  vocation: VocationId;
  level: number;
  healthMax: number;
  manaMax: number;
  skills: Record<SkillId, number>;
  magicLevel: number;
  /** Stamina no início, em minutos: decide o multiplicador e o loot. */
  stamina: number;
  gear: Gear;
}

export type RunOutcome = "vitoria" | "derrota" | "retirada";

/** Atores nos eventos: heróis pelo índice (0–3); monstros por 100 + índice na sala. */
export const MONSTER_BASE = 100;

export type RunEvent =
  /** Golpe de arma: `bl` diz como foi segurado; "erro" é a flecha que não acertou. */
  | { k: "golpe"; a: number; b: number; v: number; bl: BlockType | "erro" }
  /** Magia de herói (ataque ou cura) ou de monstro; `v` é o dano ou a cura que entrou. */
  | { k: "magia"; a: number; b: number; v: number; s: string; cura?: true }
  | { k: "abate"; b: number; exp: number }
  | { k: "queda"; b: number }
  | { k: "loot"; a: number; item: string; n: number }
  | { k: "sala"; st: number };

/** O estado no fim de um segundo: vida e mana dos heróis, vida dos monstros da sala. */
export interface RunFrame {
  s: number;
  st: number;
  h: number[];
  m: number[];
  x: number[];
  e: RunEvent[];
}

export interface RunMemberResult {
  dead: boolean;
  /** Experiência crua (antes da taxa, do bônus de level baixo e da stamina). */
  exp: number;
  /** Tentativas cruas (antes da taxa de skill). */
  tries: Partial<Record<SkillId, number>>;
  /** Mana gasta crua (antes da taxa de magia). */
  manaSpent: number;
  loot: { item: string; count: number }[];
  gold: number;
  damage: number;
  healing: number;
}

export interface RunResult {
  outcome: RunOutcome;
  seconds: number;
  members: RunMemberResult[];
  frames: RunFrame[];
}

export interface RunInput {
  seed: number;
  dungeon: string;
  heroes: readonly RunHero[];
  rateLoot: number;
}

interface HeroRt {
  i: number;
  h: RunHero;
  voc: Vocation;
  hp: number;
  mana: number;
  blocks: number;
  alive: boolean;
  weapon: ItemDef | null;
  hasShield: boolean;
  defense: number;
  armor: number;
  nextAttack: number;
  blood: BloodState;
  heals: SpellDef[];
  healOthers: SpellDef[];
  attacks: SpellDef[];
  cooldown: Map<string, number>;
  healGroup: number;
  attackGroup: number;
  res: RunMemberResult;
}

interface MonsterRt {
  i: number;
  def: MonsterDef;
  hp: number;
  max: number;
  blocks: number;
  alive: boolean;
  next: number[];
  healNext: number;
  target: number;
  dmgBy: number[];
}

/**
 * Quem leva um item do corpo [nosso]. No OT o corpo inteiro é de quem fez mais dano e o grupo
 * reparte à mão; aqui não há troca, então o item vai para quem do grupo pode usá-lo (o que
 * fez mais dano nesse monstro, empate no menor índice) e, se ninguém pode, para o dono do
 * corpo. Devolve o índice do herói.
 */
export function lootReceiver(
  itemId: string,
  alive: readonly { i: number; h: { vocation: VocationId; level: number } }[],
  dmgBy: readonly number[],
  owner: number,
): number {
  const item = itemDef(itemId);
  if (!item) return owner;
  let best: { i: number } | null = null;
  for (const x of alive) {
    if (!canUse(item, VOCATIONS[x.h.vocation].base, x.h.level)) continue;
    if (!best || (dmgBy[x.i] ?? 0) > (dmgBy[best.i] ?? 0)) best = x;
  }
  return best ? best.i : owner;
}

/** Defesa do herói [TFS player.cpp:367-396]: o escudo manda; sem escudo, a arma; sem arma, os punhos (7). */
function heroDefense(
  h: RunHero,
  weapon: ItemDef | null,
  shield: ItemDef | null,
) {
  const voc = VOCATIONS[h.vocation];
  let skill = h.skills.punhos;
  let value = 7;
  if (weapon) {
    value = weapon.defense ?? 0;
    skill = weaponSkill(weapon, h.skills);
  }
  if (shield) {
    value = shield.defense ?? 0;
    skill = h.skills.escudo;
  }
  return playerDefense(
    skill,
    value,
    RUN.fightMode,
    defenseFactor(RUN.fightMode, true),
    voc,
  );
}

/** Modificador de elemento do monstro [TFS monster.cpp:631-654]. */
function monsterElement(
  m: MonsterDef,
  el: Element,
  damage: number,
  type: BlockType,
): { damage: number; type: BlockType } {
  if (damage === 0) return { damage, type };
  const mod = m.elements?.[el] ?? 0;
  if (mod === 0) return { damage, type };
  const out = Math.round(damage * ((100 - mod) / 100));
  return out <= 0 ? { damage: 0, type: "armor" } : { damage: out, type };
}

export function simulateRun(input: RunInput): RunResult {
  const dungeon: Dungeon | undefined = dungeonOf(input.dungeon);
  if (!dungeon) throw new Error(`unknown dungeon ${input.dungeon}`);
  if (input.heroes.length === 0) throw new Error("empty party");
  const rng = new Rng(input.seed);

  const heroes: HeroRt[] = input.heroes.map((h, i) => {
    const voc = VOCATIONS[h.vocation];
    const weapon = h.gear.weapon ? (itemDef(h.gear.weapon) ?? null) : null;
    const shield = h.gear.shield ? (itemDef(h.gear.shield) ?? null) : null;
    const pieces = ARMOR_SLOTS.map(
      (s) => (h.gear.armor[s] && itemDef(h.gear.armor[s]!)?.armor) || 0,
    );
    const known = spellsFor(voc.base, h.level);
    const byLevel = (a: SpellDef, b: SpellDef) => b.level - a.level;
    return {
      i,
      h,
      voc,
      hp: h.healthMax,
      mana: h.manaMax,
      blocks: 2,
      alive: true,
      weapon,
      hasShield: shield !== null,
      defense: heroDefense(h, weapon, shield),
      armor: playerArmor(pieces, voc),
      nextAttack: 0,
      blood: freshBlood(),
      heals: known.filter((s) => s.kind === "cura").sort(byLevel),
      healOthers: known.filter((s) => s.kind === "cura-outro").sort(byLevel),
      attacks: known.filter((s) => s.kind === "ataque").sort(byLevel),
      cooldown: new Map(),
      healGroup: 0,
      attackGroup: 0,
      res: {
        dead: false,
        exp: 0,
        tries: {},
        manaSpent: 0,
        loot: [],
        gold: 0,
        damage: 0,
        healing: 0,
      },
    };
  });

  let monsters: MonsterRt[] = [];
  const frames: RunFrame[] = [];
  let ev: RunEvent[] = [];

  const living = () => heroes.filter((h) => h.alive);
  const addTries = (h: HeroRt, skill: SkillId, n: number) => {
    if (n > 0) h.res.tries[skill] = (h.res.tries[skill] ?? 0) + n;
  };
  const spendMana = (h: HeroRt, n: number) => {
    h.mana -= n;
    h.res.manaSpent += n;
  };

  // A sala cresce com o grupo (stageMonsters): o app monta a mesma lista.
  function spawn(st: number, tMs: number) {
    monsters = stageMonsters(dungeon!.id, st, heroes.length).map((x, i) => {
      const def = monsterDef(x.id)!;
      return {
        i,
        def,
        hp: x.health,
        max: x.health,
        blocks: 2,
        alive: true,
        // Os heróis batem primeiro; os monstros entram em dois tempos [nosso].
        next: def.attacks.map(() => tMs + 1000 + (i % 2) * 1000),
        healNext: tMs + 2000,
        target: -1,
        dmgBy: heroes.map(() => 0),
      };
    });
    ev.push({ k: "sala", st });
  }

  /** Dano no monstro; mata e paga quando zera. */
  function hurtMonster(h: HeroRt, m: MonsterRt, damage: number) {
    const real = Math.min(m.hp, damage);
    m.hp -= real;
    m.dmgBy[h.i]! += real;
    h.res.damage += real;
    if (m.hp <= 0) killMonster(m);
  }

  function killMonster(m: MonsterRt) {
    m.alive = false;
    m.hp = 0;
    const exp = m.def.experience;
    ev.push({ k: "abate", b: MONSTER_BASE + m.i, exp });
    const total = m.dmgBy.reduce((a, b) => a + b, 0);
    const alive = living();
    // Cada um leva a parte do dano [TFS creature.cpp:887-910]; com o grupo dividindo, a soma
    // das partes é dividida com o bônus de vocações [TFS party.cpp, party.lua:43-67].
    const parts = heroes.map((h) =>
      total === 0 ? 0 : Math.floor((m.dmgBy[h.i]! / total) * exp),
    );
    if (alive.length >= 2 && canShare(alive.map((h) => h.h.level))) {
      const pool = parts.reduce((a, b) => a + b, 0);
      const each = sharedExperience(
        pool,
        alive.map((h) => h.h.vocation),
      );
      for (const h of alive) h.res.exp += each;
    } else {
      for (const h of alive) h.res.exp += parts[h.i]!;
    }
    // O corpo é de quem fez mais dano [TFS creature.cpp getCorpse]; sem stamina acima de 14 h,
    // o corpo sai vazio [TFS default_onDropLoot.lua]. [nosso] Se ele já caiu, o próximo vivo.
    let owner: HeroRt | null = null;
    for (const h of alive) {
      if (m.dmgBy[h.i]! <= 0) continue;
      if (!owner || m.dmgBy[h.i]! > m.dmgBy[owner.i]!) owner = h;
    }
    if (!owner || owner.h.stamina <= STAMINA.tiredAtOrBelow) return;
    for (const entry of m.def.loot) {
      const n = rollLoot(rng, entry, input.rateLoot);
      if (n <= 0) continue;
      if (entry.item === "moedas") {
        owner.res.gold += n;
        ev.push({ k: "loot", a: owner.i, item: entry.item, n });
        continue;
      }
      const to = heroes[lootReceiver(entry.item, alive, m.dmgBy, owner.i)]!;
      const prev = to.res.loot.find((l) => l.item === entry.item);
      if (prev) prev.count += n;
      else to.res.loot.push({ item: entry.item, count: n });
      ev.push({ k: "loot", a: to.i, item: entry.item, n });
    }
  }

  function focus(): MonsterRt | null {
    return monsters.find((m) => m.alive) ?? null;
  }

  function heroWeaponAttack(h: HeroRt, m: MonsterRt) {
    const w = h.weapon;
    const striker = {
      level: h.h.level,
      skill: weaponSkill(w, h.h.skills),
      attack: w?.attack ?? 7,
      mode: RUN.fightMode,
      voc: h.voc,
    };
    if (w?.kind === "varinha" && w.wand) {
      // Varinha [TFS weapons.cpp:948-954]: dano normal na faixa, elemental, sem bloqueio, sem skill.
      if (h.mana < w.wand.mana) return;
      spendMana(h, w.wand.mana);
      const raw = normalRandom(rng, w.wand.min, w.wand.max);
      const r = monsterElement(m.def, w.wand.element, raw, "none");
      ev.push({
        k: "golpe",
        a: h.i,
        b: MONSTER_BASE + m.i,
        v: r.damage,
        bl: r.type,
      });
      hurtMonster(h, m, r.damage);
      return;
    }
    if (w?.kind === "distancia") {
      // Distância [TFS weapons.cpp:673-899]: acerta pela tabela; passa só pela armadura.
      const chance = distanceHitChance(
        h.h.skills.distancia,
        RUN.archerDistance,
        w.hitCap ?? 75,
      );
      if (!distanceHits(rng, chance)) {
        ev.push({
          k: "golpe",
          a: h.i,
          b: MONSTER_BASE + m.i,
          v: 0,
          bl: "erro",
        });
        addTries(h, "distancia", distanceSkillPoint(h.blood));
        return;
      }
      const raw = distanceDamage(rng, striker);
      const b = blockHit(rng, {
        damage: raw,
        defense: m.def.defense,
        armor: m.def.armor,
        checkDefense: false,
        checkArmor: true,
        blocks: m.blocks,
      });
      m.blocks = b.blocks;
      const r = monsterElement(m.def, "fisico", b.damage, b.type);
      h.blood = onTargetBlock(h.blood, r.type);
      addTries(h, "distancia", distanceSkillPoint(h.blood));
      ev.push({
        k: "golpe",
        a: h.i,
        b: MONSTER_BASE + m.i,
        v: r.damage,
        bl: r.type,
      });
      hurtMonster(h, m, r.damage);
      return;
    }
    // Corpo a corpo [TFS weapons.cpp:613-628, 568-574]: defesa e armadura do alvo.
    const skill: SkillId =
      w && (w.kind === "espada" || w.kind === "machado" || w.kind === "maca")
        ? w.kind
        : "punhos";
    const raw = meleeDamage(rng, striker);
    const b = blockHit(rng, {
      damage: raw,
      defense: m.def.defense,
      armor: m.def.armor,
      checkDefense: true,
      checkArmor: true,
      blocks: m.blocks,
    });
    m.blocks = b.blocks;
    const r = monsterElement(m.def, "fisico", b.damage, b.type);
    h.blood = onTargetBlock(h.blood, r.type);
    addTries(h, skill, meleeSkillPoint(h.blood));
    ev.push({
      k: "golpe",
      a: h.i,
      b: MONSTER_BASE + m.i,
      v: r.damage,
      bl: r.type,
    });
    hurtMonster(h, m, r.damage);
  }

  function ready(h: HeroRt, s: SpellDef, tMs: number, reserve: number) {
    return (h.cooldown.get(s.id) ?? 0) <= tMs && h.mana >= s.mana + reserve;
  }

  function heroSpells(h: HeroRt, m: MonsterRt | null, tMs: number) {
    const hero = {
      level: h.h.level,
      magicLevel: h.h.magicLevel,
      weaponSkill: weaponSkill(h.weapon, h.h.skills),
      weaponAttack: h.weapon?.attack ?? 7,
      distance: h.h.skills.distancia,
    };
    if (tMs >= h.healGroup) {
      // Cura num companheiro: o mais ferido abaixo de 40% [nosso].
      let healed = false;
      const other = h.healOthers.find((s) => ready(h, s, tMs, 0));
      if (other) {
        let low: HeroRt | null = null;
        for (const x of living()) {
          if (x.hp / x.h.healthMax >= RUN.healOtherBelow) continue;
          if (!low || x.hp / x.h.healthMax < low.hp / low.h.healthMax) low = x;
        }
        if (low) {
          castHeal(h, low, other, hero, tMs);
          healed = true;
        }
      }
      if (!healed && h.hp < h.h.healthMax * RUN.healBelow) {
        const s = h.heals.find((x) => ready(h, x, tMs, 0));
        if (s) castHeal(h, h, s, hero, tMs);
      }
    }
    if (m && tMs >= h.attackGroup) {
      // Ataca guardando mana para a cura mais forte que ele tem [nosso].
      const reserve = h.heals[0]?.mana ?? 0;
      const s = h.attacks.find((x) => ready(h, x, tMs, reserve));
      if (!s) return;
      spendMana(h, s.mana);
      h.cooldown.set(s.id, tMs + s.cooldownMs);
      h.attackGroup = tMs + 2000;
      const raw = normalRandom(rng, ...spellRange(s, hero));
      let damage = raw;
      let type: BlockType = "none";
      if (s.blockArmor) {
        const b = blockHit(rng, {
          damage: raw,
          defense: m.def.defense,
          armor: m.def.armor,
          checkDefense: false,
          checkArmor: true,
          blocks: m.blocks,
        });
        m.blocks = b.blocks;
        damage = b.damage;
        type = b.type;
      }
      const el = s.element === "cura" ? "fisico" : s.element;
      const r = monsterElement(m.def, el, damage, type);
      ev.push({
        k: "magia",
        a: h.i,
        b: MONSTER_BASE + m.i,
        v: r.damage,
        s: s.id,
      });
      hurtMonster(h, m, r.damage);
    }
  }

  function castHeal(
    h: HeroRt,
    target: HeroRt,
    s: SpellDef,
    hero: Parameters<typeof spellRange>[1],
    tMs: number,
  ) {
    spendMana(h, s.mana);
    h.cooldown.set(s.id, tMs + s.cooldownMs);
    h.healGroup = tMs + 1000;
    const v = normalRandom(rng, ...spellRange(s, hero));
    const real = Math.min(target.h.healthMax - target.hp, v);
    target.hp += real;
    h.res.healing += real;
    ev.push({ k: "magia", a: h.i, b: target.i, v: real, s: s.id, cura: true });
  }

  function pickTarget(m: MonsterRt): HeroRt | null {
    const cur = m.target >= 0 ? heroes[m.target] : undefined;
    if (cur?.alive) return cur;
    const alive = living();
    if (alive.length === 0) return null;
    // [TFS monster.cpp:498-560] alvo sorteado entre quem ele alcança; [nosso] na frente fica o cavaleiro.
    const front = alive.filter((h) => h.voc.base === 4);
    const pool = front.length > 0 ? front : alive;
    const t = pool[uniformRandom(rng, 0, pool.length - 1)]!;
    m.target = t.i;
    return t;
  }

  function hurtHero(m: MonsterRt, h: HeroRt, at: MonsterAttack) {
    const raw = normalRandom(rng, at.min, at.max);
    const melee = at.kind === "melee";
    const physical = at.element === "fisico";
    const checkArmor = melee || physical;
    const hadBlock = (melee || checkArmor) && h.blocks > 0;
    const b = blockHit(rng, {
      damage: raw,
      defense: h.defense,
      armor: h.armor,
      checkDefense: melee,
      checkArmor,
      blocks: h.blocks,
    });
    h.blocks = b.blocks;
    // O escudo sobe quando segura, enquanto o herói fere o próprio alvo [TFS creature.cpp:674-676, player.cpp:1921-1929].
    if (hadBlock && b.type !== "none") {
      const o = onOwnBlock(h.blood, h.hasShield);
      h.blood = o.state;
      addTries(h, "escudo", o.shieldTries);
    }
    const real = Math.min(h.hp, b.damage);
    h.hp -= real;
    if (melee)
      ev.push({
        k: "golpe",
        a: MONSTER_BASE + m.i,
        b: h.i,
        v: real,
        bl: b.type,
      });
    else
      ev.push({
        k: "magia",
        a: MONSTER_BASE + m.i,
        b: h.i,
        v: real,
        s: at.name ?? at.element,
      });
    if (h.hp <= 0) {
      h.alive = false;
      h.res.dead = true;
      ev.push({ k: "queda", b: h.i });
    }
  }

  function monsterAct(m: MonsterRt, tMs: number) {
    m.def.attacks.forEach((at, a) => {
      if (!m.alive || tMs < m.next[a]!) return;
      m.next[a] = tMs + at.intervalMs;
      // [TFS monster.cpp] a magia sai se `chance >= uniforme(1, 100)`.
      if (at.chance < 100 && at.chance < uniformRandom(rng, 1, 100)) return;
      if (at.area) {
        for (const h of living()) hurtHero(m, h, at);
        return;
      }
      const t = pickTarget(m);
      if (t) hurtHero(m, t, at);
    });
    const heal = m.def.heal;
    if (heal && m.alive && tMs >= m.healNext) {
      m.healNext = tMs + heal.intervalMs;
      if (heal.chance >= uniformRandom(rng, 1, 100) && m.hp < m.max) {
        const v = normalRandom(rng, heal.min, heal.max);
        const real = Math.min(m.max - m.hp, v);
        m.hp += real;
        ev.push({
          k: "magia",
          a: MONSTER_BASE + m.i,
          b: MONSTER_BASE + m.i,
          v: real,
          s: "cura",
          cura: true,
        });
      }
    }
  }

  let st = 0;
  let pendingAt = -1;
  let outcome: RunOutcome = "retirada";
  spawn(0, 0);
  const last = dungeon.stages.length - 1;
  let s = 0;
  for (; s < RUN.maxSeconds; s++) {
    const tMs = s * 1000;
    if (s > 0) {
      // Um bloqueio a mais por segundo, até 2 [TFS creature.cpp:132-135]; vida e mana pelo
      // ritmo da vocação [TFS vocations.xml gainhpticks/gainmanaticks].
      for (const m of monsters) m.blocks = Math.min(2, m.blocks + 1);
      for (const h of living()) {
        h.blocks = Math.min(2, h.blocks + 1);
        if (s % h.voc.hpTicks === 0)
          h.hp = Math.min(h.h.healthMax, h.hp + h.voc.hpAmount);
        if (s % h.voc.manaTicks === 0)
          h.mana = Math.min(h.h.manaMax, h.mana + h.voc.manaAmount);
      }
    }
    if (pendingAt === s) {
      st++;
      pendingAt = -1;
      spawn(st, tMs);
    }
    if (pendingAt < 0) {
      for (const h of heroes) {
        if (!h.alive) continue;
        const m = focus();
        heroSpells(h, m, tMs);
        const target = focus();
        if (target && tMs >= h.nextAttack) {
          h.nextAttack = tMs + h.voc.attackSpeedMs;
          heroWeaponAttack(h, target);
        }
      }
      for (const m of monsters) if (m.alive) monsterAct(m, tMs);
    }
    const ended = living().length === 0;
    const cleared = pendingAt < 0 && !monsters.some((m) => m.alive);
    frames.push({
      s,
      st,
      h: heroes.map((h) => Math.max(0, h.hp)),
      m: heroes.map((h) => h.mana),
      x: monsters.map((m) => m.hp),
      e: ev,
    });
    ev = [];
    if (ended) {
      outcome = "derrota";
      break;
    }
    if (cleared) {
      if (st === last) {
        outcome = "vitoria";
        break;
      }
      pendingAt = s + RUN.stagePauseSeconds;
    }
  }
  return {
    outcome,
    seconds: Math.min(s + 1, RUN.maxSeconds),
    members: heroes.map((h) => h.res),
    frames,
  };
}

// ---- recompensa ----------------------------------------------------------------

export interface RunReward {
  exp: number;
  tries: Partial<Record<SkillId, number>>;
  manaSpent: number;
  loot: { item: string; count: number }[];
  gold: number;
}

/** Stamina gasta: 1 min por minuto começado na dungeon [TFS default_onGainExperience.lua useStamina]. */
export function runStaminaCost(seconds: number): number {
  return Math.ceil(seconds / 60);
}

/**
 * O que o herói leva: nada se caiu (decisão do dono, 23/11/2026: a morte perde só a
 * recompensa daquela dungeon). Experiência × taxa × bônus de level baixo × stamina
 * [TFS default_onGainExperience.lua]; tentativas × taxa de skill e mana × taxa de magia
 * [TFS onGainSkillTries/rateMagic].
 */
export function runReward(
  hero: RunHero,
  r: RunMemberResult,
  outcome: RunOutcome,
  rates: Rates,
): RunReward | null {
  if (r.dead || outcome === "derrota") return null;
  const exp = Math.floor(
    r.exp *
      rates.exp *
      (1 + lowLevelBonus(hero.level) / 100) *
      staminaMultiplier(hero.stamina),
  );
  const tries: Partial<Record<SkillId, number>> = {};
  for (const [k, v] of Object.entries(r.tries) as [SkillId, number][])
    if (v > 0) tries[k] = Math.floor(v * rates.skill);
  return {
    exp,
    tries,
    manaSpent: Math.floor(r.manaSpent * rates.magic),
    loot: r.loot.map((l) => ({ ...l })),
    gold: r.gold,
  };
}
