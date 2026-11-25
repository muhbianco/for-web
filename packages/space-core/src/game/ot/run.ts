import { Rng } from "../rng.ts";
import {
  type AbilityNow,
  type Mastery,
  type Tree,
  CONCENTRATION,
  CRIT_MULT,
  MIN_COOLDOWN_MS,
  abilitiesOf,
  abilityNow,
} from "./abilities.ts";
import {
  type Derived,
  type Stats,
  derive,
  freshStats,
  monsterHitChance,
} from "./attributes.ts";
import {
  type BlockType,
  type BloodState,
  type FightMode,
  ATTACK_FACTOR,
  ammoHitChance,
  blockHit,
  defenseFactor,
  distanceHits,
  distanceSkillPoint,
  freshBlood,
  maxWeaponDamage,
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
import { DIFFICULTY } from "./difficulty.ts";
import { type Dungeon, dungeonOf } from "./dungeons.ts";
import {
  type Gear,
  type Inventory,
  type ItemStack,
  addGold,
  addItem,
  cloneInventory,
  equipItem,
  sameStack,
  unequipItem,
} from "./inventory.ts";
import {
  type AmmoType,
  type Element,
  type ItemDef,
  type Slot,
  ARMOR_SLOTS,
  GOLD,
  canDrink,
  canUse,
  itemDef,
  refineFactor,
} from "./items.ts";
import { rollLoot } from "./loot.ts";
import { type MonsterAttack, type MonsterDef, monsterDef } from "./monsters.ts";
import { canShare, sharedExperience } from "./party.ts";
import { lowLevelBonus } from "./progression.ts";
import { type NormalHitKind, normalHitRange, spellRange, wandRange } from "./spells.ts";
import { damageClass, itemAbsorb, monsterResist } from "./resist.ts";
import { STAMINA, staminaMultiplier } from "./stamina.ts";

/**
 * A corrida da dungeon (docs/espaco/jogo/ot, etapas O5 e O7). O servidor calcula a corrida
 * inteira quando o líder começa: não há escolha no meio (é idle), então nada depende do que o
 * app manda depois. A simulação anda de segundo em segundo, no ritmo do OT (ataque a cada 2 s,
 * 2 bloqueios por segundo, magias por intervalo), e usa as fórmulas de combat.ts. O app
 * recebe um quadro por segundo, quando o segundo chega.
 *
 * Adaptações [nosso], todas aqui:
 * - sem mapa: o cavaleiro fica na frente; o arqueiro atira de 3 tiles; o grupo inteiro bate
 *   no primeiro monstro vivo da sala; monstros corpo a corpo escolhem um cavaleiro se houver;
 * - os heróis lutam no modo equilibrado e estão sempre "atacando há pouco" (fator de defesa);
 * - quem morre fica fora até o fim; vida e mana se recuperam pelo ritmo da vocação (comida);
 * - level, vida e skills não mudam no meio da corrida: o ganho entra no fim;
 * - etapa O7: o loot entra direto na mochila de quem leva, se couber (o que não cabe fica no
 *   corpo, como no OT); quando a munição do lugar acaba, o herói repõe da mochila; a pilha de
 *   100 moedas vira a moeda de cima (inventory.ts changeFullStacks); o tempo do anel só corre
 *   aqui dentro.
 * - 24/11/2026: os atributos do Ragnarok (attributes.ts) entram no dano, no crítico, na
 *   esquiva, na velocidade de ataque, na regeneração e na defesa; as 4 habilidades da classe,
 *   com os adereços da árvore (abilities.ts), tomam o lugar das magias por level.
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
  /**
   * A Fúria da sala [nosso] (24/11/2026, pedido do dono: sem um membro do grupo, a falta tem de
   * ser evidente): depois de `afterMs` na mesma sala (na do chefe, o `furyMs` da dungeon), os
   * golpes dos monstros sobem `pct`% a cada `everyFrac` desse tempo. O grupo que tem dano limpa a
   * sala antes; o que não tem, apanha cada vez mais. Só em grupo (sozinho, a dungeon de antes).
   */
  fury: { afterMs: 30_000, bossMs: 120_000, everyFrac: 0.1, everyMaxMs: 5_000, pct: 15 },
  /** O tamanho da sala do grupo completo (4) e quanto ela muda por herói (partyScale). */
  party: { full: 2.2, per: 0.05 },
  /** A parte do corte de intervalo dos atributos (AGI, DES) que o arco aproveita [nosso]. */
  bowAspd: 0.5,
  /**
   * O mesmo para a varinha [nosso] (24/11/2026): com o corte todo, a AGI era o melhor atributo
   * de dano do mago (o feiticeiro de AGI fazia 4579 de dano por segundo no level 500, o de INT
   * 3674, scripts/hit-lab.ts), e o mago vive das magias, que crescem com a INT.
   */
  wandAspd: 0.5,
  /**
   * A Proteção do cavaleiro [nosso, no molde da Devoção do Ragnarok]: com ele vivo e de
   * escudo, esta fração do dano que um aliado levaria vai para ele. Cresce com a skill de
   * escudo (a base dele, do dummy de vocação): nada até `from`, o máximo em `from + span`.
   */
  protect: { from: 40, span: 80, max: 0.5 },
  /** Muda quando as regras da simulação mudam: corrida gravada com outra versão não é refeita. */
  engine: 15,
  /** [nosso] Intervalo mínimo entre ataques (o Ragnarok para em ASPD 190: 200 ms). */
  minAttackMs: 500,
  /** [nosso] Sem ferir nenhum monstro por este tempo, o grupo se retira (impasse). */
  stallMs: 60_000,
} as const;

// ---- equipamento -------------------------------------------------------------

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

/**
 * Dano médio esperado por golpe, para escolher a melhor arma [nosso]. Arco e besta contam com
 * a munição `ammo` (sem ela, 0: o arco sem munição não atira [TFS Player::getWeapon]).
 */
export function weaponScore(
  item: ItemDef,
  voc: Vocation,
  level: number,
  skills: Record<SkillId, number>,
  manaMax: number,
  ammo: ItemDef | null = null,
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
      if (item.ammo && (!ammo || ammo.ammo !== item.ammo)) return 0;
      const attack = (ammo?.attack ?? 0) + (item.attack ?? 0);
      const max =
        maxWeaponDamage(level, skills.distancia, attack, factor) *
        voc.distDamage;
      const chance = Math.min(
        100,
        ammoHitChance(
          skills.distancia,
          RUN.archerDistance,
          ammo?.maxHitChance ?? item.maxHitChance ?? 75,
          ammo ? (item.hitChance ?? 0) : 0,
        ),
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
 * "Escolher o melhor sozinho" (etapa O7) [nosso]: o maior recipiente, a arma de maior dano
 * esperado com as skills de hoje (o arco com a melhor munição que houver), o escudo de maior
 * defesa (o cavaleiro; com arma de duas mãos, nenhum), a maior armadura de cada peça e a
 * munição da arma. Colar e anel ficam como a pessoa deixou: gastam carga e tempo.
 */
/**
 * Quanto um atributo vale para cada vocação base [nosso] (o que ela mais usa pesa 1): a escolha
 * automática compara itens por ataque, defesa e armadura e, desde os itens com atributos
 * (24/11/2026), soma isto. Meio ponto de armadura vale um atributo do que a vocação mais usa.
 */
const STAT_WEIGHT: Readonly<Record<number, Readonly<Partial<Stats>>>> = {
  1: { int: 1, des: 0.6, vit: 0.5, agi: 0.3, sor: 0.3 },
  2: { int: 1, vit: 0.7, des: 0.5, agi: 0.3, sor: 0.3 },
  3: { des: 1, agi: 0.8, vit: 0.5, sor: 0.4, for: 0.2 },
  4: { for: 1, vit: 0.8, agi: 0.6, des: 0.4, sor: 0.3 },
};

export function statScore(d: ItemDef, base: VocationId): number {
  if (!d.stats) return 0;
  const w = STAT_WEIGHT[base] ?? {};
  let n = 0;
  for (const [k, v] of Object.entries(d.stats) as [keyof Stats, number][])
    n += v * (w[k] ?? 0);
  return n;
}

export function autoEquip(
  inv: Inventory,
  vocation: VocationId,
  level: number,
  skills: Record<SkillId, number>,
  manaMax: number,
): void {
  const voc = VOCATIONS[vocation];
  const base = voc.base;
  const usable = (s: ItemStack | undefined): ItemDef | null => {
    const d = s ? itemDef(s.item) : undefined;
    return d && canUse(d, base, level) ? d : null;
  };
  /** A pilha da mochila que é melhor que a vestida (empate: fica a vestida, depois o menor id). */
  const better = (
    slot: Slot,
    score: (d: ItemDef) => number,
  ): ItemStack | null => {
    const cur = usable(inv.equip[slot]);
    let bestScore = cur ? score(cur) : -Infinity;
    let bestId = cur ? "" : "￿";
    let pick: ItemStack | null = null;
    for (const x of inv.pack) {
      const d = usable(x);
      if (!d || d.slot !== slot) continue;
      const s = score(d);
      if (s > bestScore || (s === bestScore && !cur && d.id < bestId)) {
        pick = x;
        bestScore = s;
        bestId = d.id;
      }
    }
    return pick;
  };
  const wear = (x: ItemStack | null) => {
    if (!x) return;
    // A pilha pode ter virado outro objeto (o que saiu do lugar juntou nela).
    let i = inv.pack.indexOf(x);
    if (i < 0) i = inv.pack.findIndex((s) => sameStack(s, x));
    if (i >= 0) equipItem(inv, base, level, i);
  };
  const ammoFor = (type: AmmoType | undefined): ItemDef | null => {
    if (!type) return null;
    let best: ItemDef | null = null;
    const key = (x: ItemDef) => (x.attack ?? 0) * 1000 + (x.maxHitChance ?? 0);
    const look = (s: ItemStack | undefined) => {
      const d = usable(s);
      if (!d || d.slot !== "municao" || d.ammo !== type) return;
      if (
        !best ||
        key(d) > key(best) ||
        (key(d) === key(best) && d.id < best.id)
      )
        best = d;
    };
    look(inv.equip.municao);
    for (const x of inv.pack) look(x);
    return best;
  };

  wear(better("mochila", (d) => d.container ?? 0));
  // 24/11/2026: os atributos do item contam, pesados pelo que a vocação usa (statScore).
  const weapon = better(
    "arma",
    (d) =>
      weaponScore(d, voc, level, skills, manaMax, ammoFor(d.ammo)) * 1000 +
      statScore(d, base) * 300 +
      (d.defense ?? 0),
  );
  if (weapon) {
    // A arma de duas mãos não entra com escudo: o escudo vai para a mochila antes.
    const two = itemDef(weapon.item)?.twoHanded;
    if (!two || !inv.equip.escudo || unequipItem(inv, "escudo").ok)
      wear(weapon);
  }
  const w = usable(inv.equip.arma);
  if (!w?.twoHanded && base === 4)
    wear(better("escudo", (d) => (d.defense ?? 0) + statScore(d, base)));
  for (const s of ARMOR_SLOTS)
    wear(better(s, (d) => (d.armor ?? 0) + statScore(d, base) / 2));
  // A munição da arma: a melhor que houver, a maior pilha dela.
  const ammo = ammoFor(w?.ammo);
  if (ammo && inv.equip.municao?.item !== ammo.id) {
    let pick: ItemStack | null = null;
    for (const x of inv.pack)
      if (x.item === ammo.id && (!pick || x.count > pick.count)) pick = x;
    wear(pick);
  }
}

// ---- simulação ---------------------------------------------------------------

/**
 * Quanto a sala cresce com o grupo [nosso]: ×1 sozinho, +40% por herói a mais (era +30% até
 * 24/11/2026; com os atributos e a árvore o trio vencia tudo no level de entrada). Com +50% a
 * dupla de level 1 (cavaleiro e mago sem mana) perdia sempre, pior que o cavaleiro sozinho.
 */
export function partyScale(members: number, dungeonId?: string): number {
  const n = Math.max(1, members);
  if (n === 1) return 1;
  // Dungeon de iniciante (difficulty.ts): a sala de antes, +40% por herói.
  if (dungeonId && DIFFICULTY[dungeonId]?.beginner) return 1 + 0.4 * (n - 1);
  // 24/11/2026 (pedido do dono: "sem algum membro, a deficiência precisa ser evidente"): a sala
  // é feita para o grupo completo (RUN.party.full com 4) e encolhe só RUN.party.per por herói a
  // menos; sozinho continua do tamanho de antes.
  const p = RUN.party;
  return (p.full / (1 + 3 * p.per)) * (1 + p.per * (n - 1));
}

/** Os monstros de uma sala, já no tamanho do grupo (o app mostra a lista e a vida). */
export function stageMonsters(
  dungeonId: string,
  st: number,
  members: number,
): { id: string; health: number }[] {
  const d = dungeonOf(dungeonId);
  const stage = d?.stages[st];
  if (!stage) return [];
  const scale = partyScale(members, dungeonId);
  // A dificuldade da dungeon (24/11/2026, difficulty.ts): a vida dos monstros, só em grupo.
  const hp = members >= 2 ? (DIFFICULTY[dungeonId]?.hp ?? 1) : 1;
  const out: { id: string; health: number }[] = [];
  for (const g of stage.monsters) {
    const def = monsterDef(g.id);
    if (!def) continue;
    const count = def.boss ? g.count : Math.round(g.count * scale);
    const health = Math.round(def.health * hp * (def.boss ? scale : 1));
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
  /** O que veste (derivado de `inv`, para a sala ver). */
  gear: Gear;
  /** Etapa O7: o inventário e a capacidade em oz. */
  inv: Inventory;
  cap: number;
  /** Etapa O9: quando beber poção; sem isto, o padrão. */
  supplies?: RunSupplies;
  /** Etapa O9: itens que o herói não pega (ficam no corpo). */
  lootSkip?: readonly string[];
  /** 24/11/2026: os atributos (sem eles, todos em 1) e a árvore de habilidades. */
  stats?: Stats;
  tree?: Tree;
  /** A maestria dos renascimentos da árvore (abilities.ts): o efeito a mais de cada adereço. */
  mastery?: Mastery;
}

/** Beber poção abaixo de `below`% (0: nunca); `item` null: a que mais cura entre as que tem. */
export interface SupplyRule {
  item: string | null;
  below: number;
}

export interface RunSupplies {
  health: SupplyRule;
  mana: SupplyRule;
}

/** [nosso] Vida abaixo de 50% e mana abaixo de 30%, com a melhor poção que tiver. */
export const DEFAULT_SUPPLIES: RunSupplies = {
  health: { item: null, below: 50 },
  mana: { item: null, below: 30 },
};

export type RunOutcome = "vitoria" | "derrota" | "retirada";

/** Atores nos eventos: heróis pelo índice (0–3); monstros por 100 + índice na sala. */
export const MONSTER_BASE = 100;

export type RunEvent =
  /**
   * Golpe de arma: `bl` diz como foi segurado; "erro" é a flecha que não acertou ou o golpe
   * que o herói esquivou; `c`, crítico.
   */
  | {
      k: "golpe";
      a: number;
      b: number;
      v: number;
      bl: BlockType | "erro";
      c?: true;
    }
  /** Magia de herói (ataque ou cura) ou de monstro; `v` é o dano ou a cura que entrou. */
  | { k: "magia"; a: number; b: number; v: number; s: string; cura?: true }
  /**
   * Monstro morto; `xp` (24/11/2026) é a experiência crua que cada herói levou (pelo índice),
   * para a tela mostrar a barra enchendo. A recompensa continua saindo de `members[].exp`.
   */
  | { k: "abate"; b: number; exp: number; xp?: number[] }
  | { k: "queda"; b: number }
  | { k: "loot"; a: number; item: string; n: number }
  | { k: "sala"; st: number }
  /** Etapa O7: o arco ficou sem munição (uma vez por corrida). */
  | { k: "municao"; a: number }
  /** Etapa O7: não coube na mochila de ninguém e ficou no corpo. */
  | { k: "deixado"; a: number; item: string; n: number }
  /** Etapa O7: o anel ou o colar acabou (tempo ou cargas). */
  | { k: "gasto"; a: number; item: string }
  /** Etapa O9: poção bebida; `v` é o que entrou (vida, ou mana com `mana`). */
  | { k: "pocao"; a: number; item: string; v: number; mana?: true }
  /** O cavaleiro desafiou: `n` monstros presos nele [TFS challenge.lua]. */
  | { k: "desafio"; a: number; n: number }
  /** Ninguém feriu um monstro por RUN.stallMs: o grupo se retira [nosso]. */
  | { k: "impasse" }
  /** 24/11/2026: os monstros da sala se enfureceram (a Fúria, RUN.fury). */
  | { k: "furia"; st: number };

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
  /** O que entrou na mochila (moedas à parte, em ouro). */
  loot: { item: string; count: number }[];
  gold: number;
  damage: number;
  healing: number;
  /** Etapa O7: o que ficou no corpo por falta de espaço ou de capacidade. */
  left: { item: string; count: number }[];
  /** Etapa O7: munição gasta e anéis ou colares que acabaram. */
  spent: { item: string; count: number }[];
  /** Etapa O7: o inventário no fim, com o loot (vivo) e sem ele (caiu: só o gasto). */
  inv: Inventory;
  invBare: Inventory;
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
  /** As duas cópias do inventário: com o loot e só com o gasto. */
  inv: Inventory;
  bare: Inventory;
  weapon: ItemDef | null;
  hasShield: boolean;
  /** Skills de agora: as do herói mais o anel. */
  sk: Record<SkillId, number>;
  defense: number;
  armor: number;
  nextAttack: number;
  blood: BloodState;
  /** As 4 habilidades com os adereços, por tipo. */
  heals: AbilityNow[];
  healOthers: AbilityNow[];
  attacks: AbilityNow[];
  areas: AbilityNow[];
  supports: AbilityNow[];
  cooldown: Map<string, number>;
  /** A mana guardada para a cura (healReserveOf). */
  reserve: number;
  /** Os grupos de recarga [TFS spell:groupCooldown]: cura, suporte e ataque. */
  healGroup: number;
  supportGroup: number;
  attackGroup: number;
  /** O que os atributos dão (attributes.ts). */
  d: Derived;
  /** Até quando o desafio protege o cavaleiro, e quanto (adereço Muralha). */
  guardUntil: number;
  guardPct: number;
  /** O Escudo do grupo do desafio: a Proteção sobe `coverPct` até `coverUntil`. */
  coverUntil: number;
  coverPct: number;
  /** A Mira da Concentração: chance (%) a mais de crítico dos tiros enquanto ela dura. */
  focusCrit: number;
  /** A Concentração do arqueiro: até quando, e o dano e a velocidade a mais (em %). */
  focusUntil: number;
  focusDmg: number;
  focusAspd: number;
  /** As habilidades de reforço (a Concentração). */
  boosts: AbilityNow[];
  /** O refino da arma vestida: o dano dela é multiplicado por isto (items.ts refineFactor). */
  refine: number;
  /** A munição do último tiro (a reposição procura a mesma primeiro). */
  lastAmmo: string | null;
  /** Quando pode beber de novo (ms). */
  potionAt: number;
  noAmmo: boolean;
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
  /** Troca de alvo [TFS Monster targetChangeTicks, targetChangeCooldown, challengeFocusDuration]. */
  tTicks: number;
  tCooldown: number;
  focus: number;
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
  skills: Record<SkillId, number>,
  weapon: ItemDef | null,
  shield: ItemDef | null,
) {
  const voc = VOCATIONS[h.vocation];
  let skill = skills.punhos;
  let value = 7;
  if (weapon) {
    value = weapon.defense ?? 0;
    skill = weaponSkill(weapon, skills);
  }
  if (shield) {
    value = shield.defense ?? 0;
    skill = skills.escudo;
  }
  return playerDefense(
    skill,
    value,
    RUN.fightMode,
    defenseFactor(RUN.fightMode, true),
    voc,
  );
}

/**
 * A resistência do monstro contra o dano de um herói, em % (24/11/2026, decisão do dono: só
 * resistência física e resistência mágica; resist.ts). O elemento da magia não importa mais:
 * o herói não escolhe a magia pelo monstro, o jogo é automático.
 */
export function heroElementMod(m: Pick<MonsterDef, "elements">, el: Element): number {
  return monsterResist(m)[damageClass(el)];
}

function monsterElement(
  m: MonsterDef,
  el: Element,
  damage: number,
  type: BlockType,
  /** A parte da resistência que vale (1: toda; o Perfurar ignora o resto, só da que protege). */
  keep = 1,
): { damage: number; type: BlockType } {
  if (damage === 0) return { damage, type };
  const raw = heroElementMod(m, el);
  const mod = raw > 0 ? raw * keep : raw;
  if (mod === 0) return { damage, type };
  const out = Math.round(damage * ((100 - mod) / 100));
  return out <= 0 ? { damage: 0, type: "armor" } : { damage: out, type };
}

/** Gasta uma unidade da munição `id`: do lugar e, se ele esvaziar, repõe da mochila [nosso]. */
function takeAmmo(inv: Inventory, id: string): void {
  const slot = inv.equip.municao;
  if (slot && slot.item === id) {
    slot.count--;
    if (slot.count > 0) return;
    delete inv.equip.municao;
    const i = inv.pack.findIndex((x) => x.item === id);
    if (i >= 0) {
      inv.equip.municao = inv.pack[i]!;
      inv.pack.splice(i, 1);
    }
    return;
  }
  const i = inv.pack.findIndex((x) => x.item === id);
  if (i < 0) return;
  inv.pack[i]!.count--;
  if (inv.pack[i]!.count <= 0) inv.pack.splice(i, 1);
}

function addTo(
  list: { item: string; count: number }[],
  item: string,
  n: number,
) {
  const prev = list.find((l) => l.item === item);
  if (prev) prev.count += n;
  else list.push({ item, count: n });
}

/**
 * [nosso] O teto do corte de recarga (24/11/2026, pedido do dono: "capada com algum teto razoável,
 * baseada no level máximo 500"): a DES, o Ritmo da árvore e a maestria do renascimento juntos
 * nunca tiram mais que isto da recarga de base da habilidade. Sem teto, o Ritmo com renascimentos
 * infinitos levaria toda recarga ao mínimo.
 */
export const COOLDOWN_CUT_MAX = 0.4;

/** A recarga de uma habilidade com a DES e o teto [nosso]: a que a corrida usa. */
export function abilityCooldownMs(s: AbilityNow, d: Derived): number {
  const floor = Math.max(MIN_COOLDOWN_MS, Math.round(s.def.cooldownMs * (1 - COOLDOWN_CUT_MAX)));
  return Math.max(floor, Math.round(s.cooldownMs * d.cooldown));
}

/**
 * A mana que os ataques, o Desafio e a Concentração guardam (24/11/2026): uma cura, a mais cara
 * que o herói usa, já com a Economia (Atadura, Remendo, Seiva, Cura do companheiro). Antes eram
 * duas curas ou 20% da mana máxima: no cavaleiro de level 27 o Golpe brutal custava 21 e só saía
 * com 47, e a Economia quase não mudava nada. Só entra a cura que custa até metade da mana
 * máxima: o druida pequeno não paga a Cura do companheiro (120) e, guardando para ela, não atacava.
 */
export function healReserveOf(known: readonly AbilityNow[], manaMax: number): number {
  let r = 0;
  for (const a of known)
    if ((a.def.kind === "cura" || a.def.kind === "cura-outro") && a.mana * 2 <= manaMax)
      r = Math.max(r, a.mana);
  return r;
}

/**
 * As 4 habilidades do herói como entram na corrida (a barra da tela da dungeon): mana e recarga
 * com os adereços (e a maestria) e a DES; `at` é a mana com que a corrida a usa: o custo e a
 * cura guardada (nas que não são cura). O cavaleiro em grupo ainda segura os ataques quando
 * precisa do Desafio (heroSpells), o que a barra não antecipa.
 */
export function abilityBar(
  h: Pick<RunHero, "vocation" | "level" | "stats" | "tree" | "mastery" | "manaMax">,
): { id: string; mana: number; cd_ms: number; at: number }[] {
  const d = derive(h.stats ?? freshStats(), h.level);
  const known = abilitiesOf(VOCATIONS[h.vocation].base).map((def) =>
    abilityNow(def, h.tree ?? {}, h.mastery),
  );
  const reserve = healReserveOf(known, h.manaMax);
  return known.map((s) => {
    const heal = s.def.kind === "cura" || s.def.kind === "cura-outro";
    return {
      id: s.def.id,
      mana: s.mana,
      cd_ms: abilityCooldownMs(s, d),
      at: heal ? s.mana : s.mana + reserve,
    };
  });
}

export function simulateRun(input: RunInput): RunResult {
  const dungeon: Dungeon | undefined = dungeonOf(input.dungeon);
  if (!dungeon) throw new Error(`unknown dungeon ${input.dungeon}`);
  if (input.heroes.length === 0) throw new Error("empty party");
  const rng = new Rng(input.seed);

  const heroes: HeroRt[] = input.heroes.map((h, i) => {
    const voc = VOCATIONS[h.vocation];
    const inv = cloneInventory(h.inv);
    // As 4 habilidades da classe (a promovida tem a mesma base), com os adereços.
    const tree = h.tree ?? {};
    const known = abilitiesOf(voc.base).map((a) =>
      abilityNow(a, tree, h.mastery),
    );
    const of = (k: string) => known.filter((a) => a.def.kind === k);
    const rt: HeroRt = {
      i,
      h,
      voc,
      hp: h.healthMax,
      mana: h.manaMax,
      blocks: 2,
      alive: true,
      inv,
      bare: cloneInventory(h.inv),
      weapon: null,
      hasShield: false,
      sk: { ...h.skills },
      defense: 0,
      armor: 0,
      nextAttack: 0,
      blood: freshBlood(),
      heals: of("cura"),
      healOthers: of("cura-outro"),
      attacks: of("ataque"),
      areas: of("area"),
      supports: of("desafio"),
      boosts: of("foco"),
      focusUntil: 0,
      focusDmg: 0,
      focusAspd: 0,
      refine: 1,
      cooldown: new Map(),
      reserve: healReserveOf(known, h.manaMax),
      healGroup: 0,
      supportGroup: 0,
      attackGroup: 0,
      d: derive(h.stats ?? freshStats(), h.level),
      guardUntil: 0,
      guardPct: 0,
      coverUntil: 0,
      coverPct: 0,
      focusCrit: 0,
      lastAmmo: inv.equip.municao?.item ?? null,
      noAmmo: false,
      potionAt: 0,
      res: {
        dead: false,
        exp: 0,
        tries: {},
        manaSpent: 0,
        loot: [],
        gold: 0,
        damage: 0,
        healing: 0,
        left: [],
        spent: [],
        inv,
        invBare: inv,
      },
    };
    rt.res.invBare = rt.bare;
    refresh(rt);
    return rt;
  });

  /** Arma, escudo, armadura e skills a partir do que está vestido (o anel pode acabar). */
  function refresh(h: HeroRt) {
    const eq = h.inv.equip;
    h.weapon = eq.arma ? (itemDef(eq.arma.item) ?? null) : null;
    h.refine = refineFactor(eq.arma?.refine ?? 0);
    const shield = eq.escudo ? (itemDef(eq.escudo.item) ?? null) : null;
    h.hasShield = shield !== null;
    const pieces = ARMOR_SLOTS.map(
      (s) => (eq[s] && itemDef(eq[s]!.item)?.armor) || 0,
    );
    h.armor = playerArmor(pieces, h.voc);
    h.sk = { ...h.h.skills };
    const ring = eq.anel ? itemDef(eq.anel.item) : undefined;
    if (ring?.skillBonus)
      for (const [k, v] of Object.entries(ring.skillBonus) as [
        SkillId,
        number,
      ][])
        h.sk[k] += v;
    h.defense = heroDefense(h.h, h.sk, h.weapon, shield);
  }

  /** O anel ou o colar acabou: sai das duas cópias. */
  function wearOut(h: HeroRt, slot: "anel" | "colar") {
    const item = h.inv.equip[slot]?.item;
    if (!item) return;
    delete h.inv.equip[slot];
    delete h.bare.equip[slot];
    addTo(h.res.spent, item, 1);
    ev.push({ k: "gasto", a: h.i, item });
    if (slot === "anel") refresh(h);
  }

  let monsters: MonsterRt[] = [];
  const frames: RunFrame[] = [];
  /** O segundo de agora e o último em que um herói feriu um monstro (o impasse). */
  let nowMs = 0;
  let lastHitMs = 0;
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
  /** Quando a sala de agora começou (a Fúria conta daí) e se a Fúria já foi avisada nela. */
  let roomAt = 0;
  let furyShown = false;

  /**
   * O multiplicador da Fúria agora: 1 até RUN.fury.afterMs na sala (na do chefe, até o `furyMs`
   * da dungeon), depois sobe.
   */
  function furyFactor(): number {
    // Sozinho, ou numa dungeon de iniciante, a dungeon é a de antes (sem Fúria).
    if (heroes.length < 2 || DIFFICULTY[dungeon!.id]?.beginner) return 1;
    const f = RUN.fury;
    const boss = st === dungeon!.stages.length - 1;
    const after = boss ? (DIFFICULTY[dungeon!.id]?.furyMs ?? f.bossMs) : f.afterMs;
    const over = nowMs - roomAt - after;
    if (over < 0 || f.pct <= 0) return 1;
    // Um degrau a cada `everyFrac` do tempo da sala, nunca mais lento que `everyMaxMs`.
    const every = Math.max(1000, Math.min(f.everyMaxMs, Math.round(after * f.everyFrac)));
    if (!furyShown) {
      furyShown = true;
      ev.push({ k: "furia", st });
    }
    return 1 + (f.pct / 100) * (1 + Math.floor(over / every));
  }

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
        tTicks: 0,
        tCooldown: 0,
        focus: 0,
        dmgBy: heroes.map(() => 0),
      };
    });
    ev.push({ k: "sala", st });
    lastHitMs = tMs;
    roomAt = tMs;
    furyShown = false;
    // O ataque que venceu na pausa entre as salas não acumula: sai um golpe ao entrar.
    for (const h of heroes) h.nextAttack = Math.max(h.nextAttack, tMs);
  }

  /** Dano no monstro; mata e paga quando zera. */
  function hurtMonster(h: HeroRt, m: MonsterRt, damage: number) {
    const real = Math.min(m.hp, damage);
    if (real > 0) lastHitMs = nowMs;
    m.hp -= real;
    m.dmgBy[h.i]! += real;
    h.res.damage += real;
    if (m.hp <= 0) killMonster(m);
  }

  function killMonster(m: MonsterRt) {
    m.alive = false;
    m.hp = 0;
    const exp = m.def.experience;
    const abate: Extract<RunEvent, { k: "abate" }> = {
      k: "abate",
      b: MONSTER_BASE + m.i,
      exp,
    };
    ev.push(abate);
    const gains = heroes.map(() => 0);
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
      for (const h of alive) {
        h.res.exp += each;
        gains[h.i] = each;
      }
    } else {
      for (const h of alive) {
        h.res.exp += parts[h.i]!;
        gains[h.i] = parts[h.i]!;
      }
    }
    if (gains.some((g) => g > 0)) abate.xp = gains;
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
      if (entry.item === GOLD) {
        const got = addGold(owner.inv, owner.h.cap, n);
        if (got > 0) {
          owner.res.gold += got;
          ev.push({ k: "loot", a: owner.i, item: GOLD, n: got });
        }
        if (got < n) {
          addTo(owner.res.left, GOLD, n - got);
          ev.push({ k: "deixado", a: owner.i, item: GOLD, n: n - got });
        }
        continue;
      }
      // Quem pode usar leva; se não couber nele, o dono do corpo; se não couber em ninguém,
      // fica no corpo [TFS: o que não cabe não sai do corpo].
      // O filtro (etapa O9): quem marcou "não pegar" passa a vez; se ninguém pega, fica no corpo.
      const first = heroes[lootReceiver(entry.item, alive, m.dmgBy, owner.i)]!;
      let rest = n;
      let tried = false;
      for (const to of first === owner ? [owner] : [first, owner]) {
        if (to.h.lootSkip?.includes(entry.item)) continue;
        tried = true;
        const got = addItem(to.inv, to.h.cap, entry.item, rest);
        if (got > 0) {
          addTo(to.res.loot, entry.item, got);
          ev.push({ k: "loot", a: to.i, item: entry.item, n: got });
        }
        rest -= got;
        if (rest <= 0) break;
      }
      if (rest > 0 && tried) {
        addTo(owner.res.left, entry.item, rest);
        ev.push({ k: "deixado", a: owner.i, item: entry.item, n: rest });
      }
    }
  }

  function focus(): MonsterRt | null {
    return monsters.find((m) => m.alive) ?? null;
  }

  /** A poção que serve: a escolhida, ou a que mais cura entre as que pode beber e carrega. */
  function pickPotion(
    h: HeroRt,
    kind: "health" | "mana",
    item: string | null,
  ): ItemDef | null {
    let best: ItemDef | null = null;
    let bestAvg = -1;
    for (const x of h.inv.pack) {
      const d = itemDef(x.item);
      const range = d?.potion?.[kind];
      if (!d || !range || (item && d.id !== item)) continue;
      if (!canDrink(d, h.voc.base, h.h.level)) continue;
      const avg = (range[0] + range[1]) / 2;
      if (avg > bestAvg) {
        best = d;
        bestAvg = avg;
      }
    }
    return best;
  }

  /** Uma unidade da pilha `id` da mochila sai (a primeira pilha dele). */
  function takeFromPack(inv: Inventory, id: string) {
    const i = inv.pack.findIndex((x) => x.item === id);
    if (i < 0) return;
    inv.pack[i]!.count--;
    if (inv.pack[i]!.count <= 0) inv.pack.splice(i, 1);
  }

  /**
   * Poção (etapa O9) [TFS potions.lua]: abaixo do limite que a pessoa escolheu, bebe a poção
   * (vida antes de mana); uma por segundo [TFS config timeBetweenExActions = 1000]; o quanto
   * cura sai na faixa por sorteio normal [TFS luaDoTargetCombat normal_random]; o frasco
   * vazio volta para a mochila, se couber (no OT cai no chão).
   */
  function drink(h: HeroRt, tMs: number) {
    if (tMs < h.potionAt) return;
    const sup = h.h.supplies ?? DEFAULT_SUPPLIES;
    const need = (kind: "health" | "mana"): ItemDef | null => {
      const rule = sup[kind];
      const cur = kind === "health" ? h.hp : h.mana;
      const max = kind === "health" ? h.h.healthMax : h.h.manaMax;
      if (rule.below <= 0 || max <= 0 || cur * 100 >= max * rule.below)
        return null;
      return pickPotion(h, kind, rule.item);
    };
    const def = need("health") ?? need("mana");
    const p = def?.potion;
    if (!def || !p) return;
    h.potionAt = tMs + 1000;
    if (p.health) {
      const v = normalRandom(rng, p.health[0], p.health[1]);
      const real = Math.min(h.h.healthMax - h.hp, v);
      h.hp += real;
      h.res.healing += real;
      ev.push({ k: "pocao", a: h.i, item: def.id, v: real });
    }
    if (p.mana) {
      const v = normalRandom(rng, p.mana[0], p.mana[1]);
      const real = Math.min(h.h.manaMax - h.mana, v);
      h.mana += real;
      ev.push({ k: "pocao", a: h.i, item: def.id, v: real, mana: true });
    }
    takeFromPack(h.inv, def.id);
    takeFromPack(h.bare, def.id);
    addTo(h.res.spent, def.id, 1);
    addItem(h.inv, h.h.cap, p.flask, 1);
    addItem(h.bare, h.h.cap, p.flask, 1);
  }

  /**
   * A munição para o tiro: a do lugar, se é do tipo do arco; senão a primeira da mochila desse
   * tipo (a mesma do último tiro antes), que vai para o lugar [nosso: o jogador repõe à mão].
   */
  function readyAmmo(h: HeroRt, type: AmmoType): ItemDef | null {
    const base = h.voc.base;
    const slot = h.inv.equip.municao;
    const cur = slot ? itemDef(slot.item) : undefined;
    if (cur && cur.ammo === type && canUse(cur, base, h.h.level)) return cur;
    const fits = (x: ItemStack) => {
      const d = itemDef(x.item);
      return !!d && d.ammo === type && canUse(d, base, h.h.level);
    };
    let i = h.lastAmmo
      ? h.inv.pack.findIndex((x) => x.item === h.lastAmmo && fits(x))
      : -1;
    if (i < 0) i = h.inv.pack.findIndex(fits);
    if (i < 0) return null;
    const id = h.inv.pack[i]!.item;
    if (!equipItem(h.inv, base, h.h.level, i).ok) return null;
    const j = h.bare.pack.findIndex((x) => x.item === id);
    if (j >= 0) equipItem(h.bare, base, h.h.level, j);
    return itemDef(id) ?? null;
  }

  /**
   * O golpe normal do herói agora (spells.ts normalHitRange), sem gastar nem mexer na flecha: a
   * base das habilidades de ataque (fórmula "golpe"). A flecha é a que o arco atiraria.
   */
  function normalHit(h: HeroRt): { lo: number; hi: number; kind: NormalHitKind } {
    const w = h.weapon;
    let ammoAttack: number | null = null;
    if (w?.kind === "distancia" && w.ammo) {
      const fits = (d: ItemDef | undefined) =>
        !!d && d.ammo === w.ammo && canUse(d, h.voc.base, h.h.level);
      const slot = h.inv.equip.municao ? itemDef(h.inv.equip.municao.item) : undefined;
      const ammo = fits(slot) ? slot! : h.inv.pack.map((x) => itemDef(x.item)).find(fits);
      if (ammo) ammoAttack = ammo.attack ?? 0;
    }
    return normalHitRange({
      level: h.h.level,
      magicLevel: h.h.magicLevel,
      cls: h.voc.base,
      meleeDamage: h.voc.meleeDamage,
      distDamage: h.voc.distDamage,
      weapon: w ?? null,
      refine: h.refine,
      ammoAttack,
      skills: h.sk,
      minRoll: h.d.minRoll,
      attackFactor: ATTACK_FACTOR[RUN.fightMode],
    });
  }

  /** A Concentração está valendo agora? */
  const focused = (h: HeroRt) => h.focusUntil > nowMs;

  /** Uniforme em [0, 1] em milésimos, do mesmo gerador da corrida. */
  function unitRoll(): number {
    return uniformRandom(rng, 0, 1000) / 1000;
  }

  /**
   * Crítico [RO battle.cpp is_attack_critical, pré-renovação]: chance da SOR (attributes.ts);
   * o golpe sai no máximo e passa direto pela defesa e pela armadura.
   */
  function critical(h: HeroRt): boolean {
    const crit = h.d.crit + (focused(h) ? h.focusCrit : 0);
    return uniformRandom(rng, 1, 1000) <= Math.round(crit * 10);
  }

  /**
   * O dano cru de um golpe de arma [TFS weapons.cpp] com os atributos por cima: a DES sobe o
   * mínimo do sorteio, o ataque base (FOR ou DES) multiplica, e o crítico sai no máximo.
   */
  function weaponRoll(
    h: HeroRt,
    max: number,
    min: number,
    ranged: boolean,
    crit: boolean,
  ): number {
    const floor = Math.max(min, Math.floor(max * h.d.minRoll));
    const raw = crit ? max : normalRandom(rng, Math.min(floor, max), max);
    const pct = ranged
      ? h.d.rangedPct + (focused(h) ? h.focusDmg : 0)
      : h.d.meleePct;
    return Math.floor(raw * (1 + pct / 100));
  }

  function heroWeaponAttack(h: HeroRt, m: MonsterRt) {
    const w = h.weapon;
    const striker = {
      level: h.h.level,
      skill: weaponSkill(w, h.sk),
      attack: w?.attack ?? 7,
      mode: RUN.fightMode,
      voc: h.voc,
    };
    if (w?.kind === "varinha" && w.wand) {
      // Varinha [TFS weapons.cpp:948-954]: dano normal na faixa, elemental, sem bloqueio, sem skill.
      // [nosso] A INT soma como numa magia (MATQ); e a varinha guarda a mana da cura, como as
      // habilidades (o druida com a varinha cara gastava tudo nela e caía sem se curar).
      if (h.mana < w.wand.mana + healReserve(h)) return;
      // [nosso] No monstro imune ao elemento da varinha, não gasta a mana do tiro.
      if (elementFactor(m, w.wand.element) <= 0) return;
      spendMana(h, w.wand.mana);
      const pct =
        h.d.magicPct[0] + (h.d.magicPct[1] - h.d.magicPct[0]) * unitRoll();
      // [nosso] 24/11/2026: a faixa cresce com o magic level (spells.ts wandRange).
      const [wMin, wMax] = wandRange(w.wand, h.h.level, h.h.magicLevel);
      const raw = Math.floor(
        normalRandom(rng, wMin, wMax) * (1 + pct / 100) * h.refine,
      );
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
      // Arco e besta atiram a munição: sem ela, não há arma [TFS player.cpp:229-239]; o ataque é
      // o dela mais o do arco [TFS weapons.cpp:839-849]; cada tiro, certo ou não, gasta um
      // [TFS weapons.xml removecount, weapons.cpp:452-458].
      // Sem a munição do arco (acabou, ou é a de outro tipo), o herói luta com os punhos:
      // arma de distância sem munição não conta como arma [TFS player.cpp:229-239,
      // getWeapon → nullptr → punhos]. [nosso] Ele chega perto para bater.
      let ammo: ItemDef | null = null;
      let fists = false;
      if (w.ammo) {
        ammo = readyAmmo(h, w.ammo);
        if (!ammo) {
          if (!h.noAmmo) {
            h.noAmmo = true;
            ev.push({ k: "municao", a: h.i });
          }
          fists = true;
        } else {
          h.lastAmmo = ammo.id;
          takeAmmo(h.inv, ammo.id);
          takeAmmo(h.bare, ammo.id);
          addTo(h.res.spent, ammo.id, 1);
        }
      }
      if (!fists) {
        striker.attack = (ammo?.attack ?? 0) + (w.attack ?? 0);
        // Acerta pela chance da munição mais a do arco [TFS weapons.cpp:673-776], mais a
        // pontaria da DES [nosso]; passa só pela armadura (o crítico passa direto).
        const chance = Math.min(
          100,
          ammoHitChance(
            h.sk.distancia,
            RUN.archerDistance,
            ammo?.maxHitChance ?? w.maxHitChance ?? 75,
            ammo ? (w.hitChance ?? 0) : 0,
          ) + h.d.hitBonus,
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
        // [TFS weapons.cpp:827-836] mínimo `ceil(level × 0,2)` contra monstro.
        const max = Math.trunc(
          maxWeaponDamage(
            striker.level,
            striker.skill,
            striker.attack,
            ATTACK_FACTOR[striker.mode],
          ) *
            h.voc.distDamage *
            h.refine,
        );
        const crit = critical(h);
        const raw = weaponRoll(
          h,
          max,
          Math.ceil(striker.level * 0.2),
          true,
          crit,
        );
        const b = crit
          ? { damage: raw, type: "none" as BlockType, blocks: m.blocks }
          : blockHit(rng, {
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
          ...(crit ? { c: true as const } : {}),
        });
        hurtMonster(h, m, r.damage);
        return;
      }
      striker.skill = h.sk.punhos;
      striker.attack = 7;
    }
    // Corpo a corpo [TFS weapons.cpp:613-628, 568-574]: defesa e armadura do alvo (o crítico
    // passa direto).
    const skill: SkillId =
      w && (w.kind === "espada" || w.kind === "machado" || w.kind === "maca")
        ? w.kind
        : "punhos";
    // O refino vale para a arma; nos punhos (sem arma, ou o arco sem flecha), não.
    const refined = w && striker.attack !== 7 ? h.refine : 1;
    const max = Math.trunc(
      maxWeaponDamage(
        striker.level,
        striker.skill,
        striker.attack,
        ATTACK_FACTOR[striker.mode],
      ) *
        h.voc.meleeDamage *
        refined,
    );
    const crit = critical(h);
    const raw = weaponRoll(h, max, 0, false, crit);
    const b = crit
      ? { damage: raw, type: "none" as BlockType, blocks: m.blocks }
      : blockHit(rng, {
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
      ...(crit ? { c: true as const } : {}),
    });
    hurtMonster(h, m, r.damage);
  }

  /**
   * O cavaleiro segura os ataques para o Desafio (24/11/2026) só quando precisa dele: algum
   * monstro batendo em outra pessoa e o Desafio fora da recarga. Com o Giro da lâmina a 35 e a
   * reserva de uma cura, ele gastava a mana nos golpes e o Desafio não saía nunca (o papel do
   * tanque); guardando sempre, o Golpe brutal com Economia (21) só sairia com 59.
   */
  function tankHold(h: HeroRt, tMs: number): number {
    const s = h.supports[0];
    if (!s || (h.cooldown.get(s.def.id) ?? 0) > tMs) return 0;
    const loose = monsters.some(
      (m) => m.alive && m.target >= 0 && m.target !== h.i && heroes[m.target]?.alive,
    );
    return loose ? s.mana : 0;
  }

  /** A mana que os ataques não tocam: uma cura, a mais cara do herói (healReserveOf). */
  function healReserve(h: HeroRt): number {
    return h.reserve;
  }

  function ready(h: HeroRt, s: AbilityNow, tMs: number, reserve: number) {
    return (h.cooldown.get(s.def.id) ?? 0) <= tMs && h.mana >= s.mana + reserve;
  }

  /** Recarga da habilidade, encurtada pela DES [nosso]. */
  function cool(h: HeroRt, s: AbilityNow, tMs: number) {
    h.cooldown.set(s.def.id, tMs + abilityCooldownMs(s, h.d));
  }

  type HeroNumbers = Parameters<typeof spellRange>[1] & { baseKind?: NormalHitKind };

  /**
   * O valor de uma habilidade: a faixa da magia do TFS [onGetFormulaValues] × a força dos
   * adereços × os atributos (golpe de arma pela FOR, de distância pela DES, magia e cura pela
   * INT, como no Ragnarok).
   */
  function abilityValue(h: HeroRt, s: AbilityNow, hero: HeroNumbers): number {
    const raw = normalRandom(rng, ...spellRange(s, hero));
    const f = s.formula.type;
    // A fórmula "golpe" leva a % do golpe normal de onde ela sai (arma pela FOR, arco pela DES e a
    // Concentração, varinha pela INT); as do TFS, a da fórmula.
    const from: NormalHitKind | "magia" =
      f === "golpe" ? (hero.baseKind ?? "melee") : f === "arma" ? "melee" : f === "distancia" ? "ranged" : "magia";
    const pct =
      from === "melee"
        ? h.d.meleePct
        : from === "ranged"
          ? h.d.rangedPct + (f === "golpe" && focused(h) ? h.focusDmg : 0)
          : h.d.magicPct[0] + (h.d.magicPct[1] - h.d.magicPct[0]) * unitRoll();
    // O adereço de crítico (24/11/2026): a habilidade sai CRIT_MULT vezes mais forte.
    const crit = s.crit > 0 && uniformRandom(rng, 1, 1000) <= Math.round(s.crit * 10);
    return Math.max(
      0,
      Math.floor(raw * s.power * (1 + pct / 100) * (crit ? CRIT_MULT : 1)),
    );
  }

  /** O monstro atordoado atrasa os próximos ataques [nosso, no papel do stun do Bash do Ragnarok]. */
  function stun(m: MonsterRt, ms: number) {
    for (let a = 0; a < m.next.length; a++) m.next[a]! += ms;
  }

  /** Uma habilidade de ataque acerta um monstro: armadura, elemento e os adereços de golpe. */
  function strike(h: HeroRt, m: MonsterRt, s: AbilityNow, hero: HeroNumbers) {
    if (!m.alive) return;
    let damage = abilityValue(h, s, hero);
    let type: BlockType = "none";
    // Perfurar (24/11/2026): a habilidade ignora parte da armadura e da resistência.
    const keep = 1 - s.pierce / 100;
    if (s.blockArmor) {
      const b = blockHit(rng, {
        damage,
        defense: m.def.defense,
        armor: Math.round(m.def.armor * keep),
        checkDefense: false,
        checkArmor: true,
        blocks: m.blocks,
      });
      m.blocks = b.blocks;
      damage = b.damage;
      type = b.type;
    }
    const el = s.element === "cura" ? "fisico" : s.element;
    const r = monsterElement(m.def, el, damage, type, keep);
    ev.push({
      k: "magia",
      a: h.i,
      b: MONSTER_BASE + m.i,
      v: r.damage,
      s: s.def.id,
    });
    hurtMonster(h, m, r.damage);
    if (r.damage <= 0) return;
    if (s.leech > 0 && h.alive) {
      const real = Math.min(
        h.h.healthMax - h.hp,
        Math.floor(r.damage * s.leech),
      );
      if (real > 0) {
        h.hp += real;
        h.res.healing += real;
      }
    }
    if (s.stun && m.alive && s.stun.chance >= uniformRandom(rng, 1, 100))
      stun(m, s.stun.ms);
    if (s.echo > 0 && m.alive) {
      const again = Math.floor(r.damage * s.echo);
      ev.push({
        k: "magia",
        a: h.i,
        b: MONSTER_BASE + m.i,
        v: Math.min(m.hp, again),
        s: s.def.id,
      });
      hurtMonster(h, m, again);
    }
  }

  /** O quanto do dano deste elemento entra no monstro (1 = tudo; 0 = imune) [TFS monster.cpp:631-654]. */
  function elementFactor(m: MonsterRt, el: Element | "cura"): number {
    const mod = heroElementMod(m.def, el === "cura" ? "fisico" : el);
    return Math.max(0, (100 - mod) / 100);
  }

  /**
   * Quanto uma habilidade de ataque rende agora (para escolher qual lançar) [nosso]: a média da
   * faixa, os adereços e o elemento contra quem ela vai pegar (ninguém gasta mana em fogo no
   * monstro imune a fogo).
   */
  function attackScore(
    s: AbilityNow,
    hero: HeroNumbers,
    target: MonsterRt,
    alive: readonly MonsterRt[],
  ): number {
    const [a, b] = spellRange(s, hero);
    // Alvos em ups (24/11/2026): a parte quebrada conta pela chance de pegar mais um.
    const whole = Math.floor(s.targets);
    const others = alive.filter((x) => x !== target);
    const hit =
      s.def.kind === "area" ? alive : [target, ...others.slice(0, whole)];
    let k = 0;
    for (const x of hit) k += elementFactor(x, s.element);
    const next = s.def.kind === "area" ? undefined : others[whole];
    if (next) k += (s.targets - whole) * elementFactor(next, s.element);
    return ((a + b) / 2) * s.power * (1 + s.echo) * k;
  }

  function heroSpells(h: HeroRt, m: MonsterRt | null, tMs: number) {
    const hero: HeroNumbers = {
      level: h.h.level,
      magicLevel: h.h.magicLevel,
      weaponSkill: weaponSkill(h.weapon, h.sk),
      weaponAttack: h.weapon?.attack ?? 7,
      distance: h.sk.distancia,
    };
    const normal = normalHit(h);
    hero.baseHit = [normal.lo, normal.hi];
    hero.baseKind = normal.kind;
    if (tMs >= h.healGroup) {
      // Cura num companheiro: o mais ferido abaixo do limite (40%, mais os adereços) [nosso].
      let healed = false;
      const other = h.healOthers.find((s) => ready(h, s, tMs, 0));
      if (other) {
        const below = RUN.healOtherBelow + other.trigger / 100;
        let low: HeroRt | null = null;
        for (const x of living()) {
          if (x.hp / x.h.healthMax >= below) continue;
          if (!low || x.hp / x.h.healthMax < low.hp / low.h.healthMax) low = x;
        }
        if (low) {
          castHeal(h, low, other, hero, tMs);
          healed = true;
        }
      }
      if (!healed) {
        const s = h.heals.find((x) => ready(h, x, tMs, 0));
        if (s && h.hp < h.h.healthMax * (RUN.healBelow + s.trigger / 100))
          castHeal(h, h, s, hero, tMs);
      }
    }
    if (m && tMs >= h.supportGroup) challenge(h, tMs);
    // A Concentração: com monstro na sala e sem ela valendo, antes dos tiros [nosso].
    const boost = h.boosts[0];
    if (
      m &&
      boost &&
      !focused(h) &&
      hero.baseKind === "ranged" &&
      ready(h, boost, tMs, healReserve(h))
    ) {
      spendMana(h, boost.mana);
      cool(h, boost, tMs);
      h.focusUntil = tMs + boost.focusMs;
      h.focusDmg = CONCENTRATION.dmgPct * boost.power;
      h.focusAspd = CONCENTRATION.aspdPct * boost.power;
      h.focusCrit = boost.crit;
      ev.push({ k: "magia", a: h.i, b: h.i, v: 0, s: boost.def.id });
    }
    if (m && tMs >= h.attackGroup) {
      // Ataca guardando mana para a cura dele [nosso]: duas curas ou 20% da mana, o que for
      // maior (com uma só, o mago gastava tudo na magia de área cara e caía sem se curar);
      // entre as que estão prontas, a que mais rende agora (a de área com a sala cheia).
      const reserve = healReserve(h) + tankHold(h, tMs);
      const alive = monsters.filter((x) => x.alive);
      let s: AbilityNow | null = null;
      let best = 0;
      for (const x of [...h.attacks, ...h.areas]) {
        if (!ready(h, x, tMs, reserve)) continue;
        const score = attackScore(x, hero, m, alive);
        // Empate (o Golpe de raio e o de chama, desde que o elemento não importa): a que saiu
        // há mais tempo (24/11/2026; sem isso, a primeira da lista sairia sempre).
        const tie =
          s !== null &&
          Math.abs(score - best) <= 1e-9 * Math.max(1, best) &&
          (h.cooldown.get(x.def.id) ?? 0) < (h.cooldown.get(s.def.id) ?? 0);
        if (score > best + 1e-9 * Math.max(1, best) || tie) {
          best = score;
          s = x;
        }
      }
      if (!s) return;
      spendMana(h, s.mana);
      cool(h, s, tMs);
      h.attackGroup = tMs + 2000;
      if (s.def.kind === "area") for (const x of alive) strike(h, x, s, hero);
      else {
        // Alvos em ups (24/11/2026): a parte quebrada é a chance de pegar mais um.
        const extra =
          Math.floor(s.targets) +
          (unitRoll() < s.targets - Math.floor(s.targets) ? 1 : 0);
        const others = alive.filter((x) => x !== m).slice(0, extra);
        for (const x of [m, ...others]) strike(h, x, s, hero);
      }
    }
  }

  /**
   * O desafio do cavaleiro [TFS challenge.lua, monster.cpp challengeCreature]: quando algum
   * monstro bate em outra pessoa do grupo [nosso: a regra de quando usar], puxa todos os
   * monstros da sala [nosso: sem mapa, o cavaleiro vai até eles; no OT é a área 3×3 em
   * volta] e os prende nele por 8 s (mais os adereços), sem troca de alvo nesse tempo.
   */
  function challenge(h: HeroRt, tMs: number) {
    const s = h.supports[0];
    if (!s) return;
    if (!ready(h, s, tMs, healReserve(h))) return;
    const loose = monsters.some(
      (m) =>
        m.alive && m.target >= 0 && m.target !== h.i && heroes[m.target]?.alive,
    );
    if (!loose) return;
    spendMana(h, s.mana);
    cool(h, s, tMs);
    h.supportGroup = tMs + 2000;
    let n = 0;
    for (const m of monsters) {
      if (!m.alive) continue;
      m.target = h.i;
      m.tCooldown = s.focusMs;
      m.focus = s.focusMs;
      m.tTicks = 0;
      if (s.stun && s.stun.chance >= uniformRandom(rng, 1, 100))
        stun(m, s.stun.ms);
      n++;
    }
    if (s.guard > 0) {
      h.guardUntil = tMs + s.focusMs;
      h.guardPct = Math.min(60, s.guard);
    }
    if (s.cover > 0) {
      h.coverUntil = tMs + s.focusMs;
      h.coverPct = s.cover;
    }
    ev.push({ k: "desafio", a: h.i, n });
  }

  /**
   * Troca de alvo do monstro, a cada segundo [TFS monster.cpp onThinkTarget, intervalo de 1 s]:
   * o desafio e a troca recente seguram; vencido o intervalo, a chance de sortear outro herói
   * [TFS searchTarget RANDOM: corpo a corpo, qualquer um da lista].
   */
  function thinkTarget(m: MonsterRt) {
    const tc = m.def.targetChange;
    if (!tc || tc.intervalMs <= 0) return;
    const step = 1000;
    if (m.focus > 0) m.focus = Math.max(0, m.focus - step);
    if (m.tCooldown > 0) {
      m.tCooldown -= step;
      if (m.tCooldown > 0) return;
      m.tCooldown = 0;
      m.tTicks = tc.intervalMs;
    }
    m.tTicks += step;
    if (m.tTicks < tc.intervalMs) return;
    m.tTicks = 0;
    m.tCooldown = tc.intervalMs;
    m.focus = 0;
    // Chance 0 nunca troca: sem sorteio, o mesmo resultado sem gastar a semente.
    if (tc.chance <= 0 || tc.chance < uniformRandom(rng, 1, 100)) return;
    const alive = living();
    if (alive.length === 0) return;
    m.target = alive[uniformRandom(rng, 0, alive.length - 1)]!.i;
  }

  function castHeal(
    h: HeroRt,
    target: HeroRt,
    s: AbilityNow,
    hero: HeroNumbers,
    tMs: number,
  ) {
    spendMana(h, s.mana);
    cool(h, s, tMs);
    h.healGroup = tMs + 1000;
    const v = abilityValue(h, s, hero);
    const real = Math.min(target.h.healthMax - target.hp, v);
    target.hp += real;
    h.res.healing += real;
    ev.push({
      k: "magia",
      a: h.i,
      b: target.i,
      v: real,
      s: s.def.id,
      cura: true,
    });
    // Adereços de grupo (Abrigo, Cura em massa): o resto do grupo recebe uma parte.
    if (s.group <= 0) return;
    for (const x of living()) {
      if (x === target) continue;
      const part = Math.min(x.h.healthMax - x.hp, Math.floor(v * s.group));
      if (part <= 0) continue;
      x.hp += part;
      h.res.healing += part;
      ev.push({ k: "magia", a: h.i, b: x.i, v: part, s: s.def.id, cura: true });
    }
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

  /**
   * Colar, anel e escudo absorvem parte do dano que passou pela defesa e pela armadura, e cada
   * golpe absorvido gasta uma carga [TFS player.cpp:1997-2029, colar (2) antes do anel (9)].
   * Desde 24/11/2026 a proteção é física ou mágica (resist.ts); o escudo entrou (o Escudo
   * espelhado prometia 5% de proteção mágica e não protegia).
   */
  function absorb(h: HeroRt, el: Element, damage: number): number {
    let d = damage;
    const cls = damageClass(el);
    for (const slot of ["colar", "anel", "escudo"] as const) {
      const x = h.inv.equip[slot];
      const def = x ? itemDef(x.item) : undefined;
      const pct = def ? itemAbsorb(def)[cls] : 0;
      if (!x || pct === 0) continue;
      d -= Math.ceil(d * (pct / 100));
      if (x.charges !== undefined) {
        x.charges--;
        const y = h.bare.equip[slot];
        if (y?.charges !== undefined) y.charges--;
        if (x.charges <= 0 && slot !== "escudo") wearOut(h, slot);
      }
    }
    return Math.max(0, d);
  }

  function hurtHero(m: MonsterRt, h: HeroRt, at: MonsterAttack) {
    const melee = at.kind === "melee";
    const physical = at.element === "fisico";
    // Esquiva [RO battle.cpp, pré-renovação]: o golpe normal do monstro pode errar, primeiro
    // pela esquiva perfeita da SOR, depois pela FLEE contra o HIT dele (attributes.ts). As
    // magias não se esquivam.
    if (melee) {
      const attackers = monsters.filter(
        (x) => x.alive && x.target === h.i,
      ).length;
      const lucky =
        uniformRandom(rng, 1, 1000) <= Math.round(h.d.perfectDodge * 10);
      const hits =
        !lucky &&
        uniformRandom(rng, 1, 100) <=
          monsterHitChance(m.def.level, h.d.flee, attackers);
      if (!hits) {
        ev.push({
          k: "golpe",
          a: MONSTER_BASE + m.i,
          b: h.i,
          v: 0,
          bl: "erro",
        });
        return;
      }
    }
    // A Fúria da sala (24/11/2026): quem demora a limpar apanha mais.
    const raw = Math.round(
      normalRandom(rng, at.min, at.max) *
        furyFactor() *
        (heroes.length >= 2 ? (DIFFICULTY[dungeon!.id]?.dmg ?? 1) : 1),
    );
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
    // Depois da armadura, a defesa suave [RO]: a da VIT contra o físico, a da INT (e VIT/2)
    // contra a magia; e a Muralha do desafio.
    let type = b.type;
    let dmg = b.damage;
    if (dmg > 0) {
      dmg -= physical
        ? uniformRandom(rng, h.d.vitDef[0], h.d.vitDef[1])
        : h.d.mdef;
      if (h.guardUntil > nowMs && h.guardPct > 0)
        dmg = Math.floor((dmg * (100 - h.guardPct)) / 100);
      if (dmg <= 0) {
        dmg = 0;
        if (type === "none") type = "armor";
      }
    }
    let dealt = type === "none" && dmg > 0 ? absorb(h, at.element, dmg) : dmg;
    // A Proteção do cavaleiro: parte do golpe num aliado vai para ele (24/11/2026).
    if (dealt > 0 && h.voc.base !== 4) {
      const k = protector(h);
      if (k) {
        const share = Math.floor(dealt * protectShare(k));
        if (share > 0) {
          dealt -= share;
          coverHit(m, k, at, share);
        }
      }
    }
    const real = Math.min(h.hp, dealt);
    h.hp -= real;
    if (melee)
      ev.push({
        k: "golpe",
        a: MONSTER_BASE + m.i,
        b: h.i,
        v: real,
        bl: type,
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

  /** O cavaleiro vivo, de escudo, que protege o grupo (o de mais escudo, se houver dois). */
  function protector(ally: HeroRt): HeroRt | null {
    let best: HeroRt | null = null;
    for (const x of heroes)
      if (
        x !== ally &&
        x.alive &&
        x.voc.base === 4 &&
        x.hasShield &&
        (!best || x.sk.escudo > best.sk.escudo)
      )
        best = x;
    return best;
  }

  /** A fração que o cavaleiro tira do golpe num aliado, pela skill de escudo (RUN.protect). */
  function protectShare(k: HeroRt): number {
    const p = RUN.protect;
    const base = Math.max(0, Math.min(p.max, ((k.sk.escudo - p.from) / p.span) * p.max));
    // O Escudo do grupo do desafio soma enquanto ele prende (24/11/2026), até 75%.
    const cover = k.coverUntil > nowMs ? k.coverPct / 100 : 0;
    return Math.min(0.75, base + cover);
  }

  /**
   * O pedaço do golpe que o cavaleiro tomou para si: passa pela Muralha do desafio e pela
   * proteção dos itens dele (a armadura e a defesa já seguraram o golpe no aliado).
   */
  function coverHit(m: MonsterRt, k: HeroRt, at: MonsterAttack, share: number) {
    let dmg = share;
    if (k.guardUntil > nowMs && k.guardPct > 0)
      dmg = Math.floor((dmg * (100 - k.guardPct)) / 100);
    dmg = absorb(k, at.element, dmg);
    const real = Math.min(k.hp, Math.max(0, dmg));
    if (real <= 0) return;
    k.hp -= real;
    ev.push({
      k: "magia",
      a: MONSTER_BASE + m.i,
      b: k.i,
      v: real,
      s: "protecao",
    });
    if (k.hp <= 0) {
      k.alive = false;
      k.res.dead = true;
      ev.push({ k: "queda", b: k.i });
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

  /** O anel no dedo: o tempo corre e a regeneração dele entra [TFS items.xml duration, healthGain]. */
  function ringTick(h: HeroRt, s: number) {
    const x = h.inv.equip.anel;
    const def = x ? itemDef(x.item) : undefined;
    if (!x || !def) return;
    if (
      def.regen &&
      s % Math.max(1, Math.round(def.regen.ticksMs / 1000)) === 0
    ) {
      h.hp = Math.min(h.h.healthMax, h.hp + def.regen.health);
      h.mana = Math.min(h.h.manaMax, h.mana + def.regen.mana);
    }
    if (x.duration !== undefined) {
      x.duration--;
      const y = h.bare.equip.anel;
      if (y?.duration !== undefined) y.duration--;
      if (x.duration <= 0) wearOut(h, "anel");
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
    nowMs = tMs;
    if (s > 0) {
      // Um bloqueio a mais por segundo, até 2 [TFS creature.cpp:132-135]; vida e mana pelo
      // ritmo da vocação [TFS vocations.xml gainhpticks/gainmanaticks].
      for (const m of monsters) m.blocks = Math.min(2, m.blocks + 1);
      for (const h of living()) {
        h.blocks = Math.min(2, h.blocks + 1);
        // [RO] A VIT e a INT somam à regeneração (+VIT/5 de vida e +INT/6 de mana por tique).
        if (s % h.voc.hpTicks === 0)
          h.hp = Math.min(h.h.healthMax, h.hp + h.voc.hpAmount + h.d.hpRegen);
        if (s % h.voc.manaTicks === 0)
          h.mana = Math.min(
            h.h.manaMax,
            h.mana + h.voc.manaAmount + h.d.mpRegen,
          );
        ringTick(h, s);
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
        // A cura da habilidade antes da poção (24/11/2026): com as duas em 50% da vida, a poção
        // vinha antes, subia a vida e a Atadura do cavaleiro nunca saía (gastava poção paga no
        // lugar da cura de 10 de mana). A poção segue no mesmo tique se a vida continuar baixa.
        heroSpells(h, m, tMs);
        drink(h, tMs);
        // Velocidade de ataque com AGI e DES [RO status_base_amotion_pc]: com o intervalo
        // abaixo de 1 s, mais de um golpe cabe no mesmo segundo.
        // [nosso, no molde da velocidade por arma do Ragnarok] o arco leva só RUN.bowAspd do corte
        // dos atributos (24/11/2026): com ele todo, o arqueiro de AGI e DES atirava 1,7 vez mais
        // rápido que o mago no level 500 e se afastava dos magos a cada level.
        // A varinha também (RUN.wandAspd): o mago vive das magias.
        const aspd =
          h.weapon?.kind === "distancia"
            ? 1 - (1 - h.d.aspd) * RUN.bowAspd
            : h.weapon?.kind === "varinha"
              ? 1 - (1 - h.d.aspd) * RUN.wandAspd
              : h.d.aspd;
        const interval = Math.max(
          RUN.minAttackMs,
          Math.round(
            h.voc.attackSpeedMs *
              aspd *
              (focused(h) ? 1 - Math.min(60, h.focusAspd) / 100 : 1),
          ),
        );
        const cap = Math.ceil(1000 / interval);
        for (let n = 0; n < cap && h.alive && tMs >= h.nextAttack; n++) {
          const target = focus();
          if (!target) break;
          heroWeaponAttack(h, target);
          h.nextAttack += interval;
        }
        if (tMs >= h.nextAttack) h.nextAttack = tMs + 1;
      }
      for (const m of monsters) {
        if (!m.alive) continue;
        if (s > 0) thinkTarget(m);
        monsterAct(m, tMs);
      }
    }
    const ended = living().length === 0;
    const cleared = pendingAt < 0 && !monsters.some((m) => m.alive);
    // [nosso] Ninguém consegue ferir os monstros (arma sem munição, armadura alta demais):
    // em vez de esperar os 20 min, o grupo se retira, como quem desiste da caçada.
    const stalled =
      !ended && !cleared && pendingAt < 0 && tMs - lastHitMs >= RUN.stallMs;
    if (stalled) ev.push({ k: "impasse" });
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
    if (stalled) {
      outcome = "retirada";
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
 * [TFS onGainSkillTries/rateMagic]. O loot e as moedas já estão no inventário do resultado
 * (`inv`); aqui vão para o resumo.
 */
/**
 * Quanto cada ponto de experiência crua vale no fim (a mesma conta de runReward), para a tela
 * mostrar a experiência da corrida antes de ela entrar.
 */
export function runExpRate(
  hero: Pick<RunHero, "level" | "stamina">,
  rates: Pick<Rates, "exp">,
): number {
  return (
    rates.exp *
    (1 + lowLevelBonus(hero.level) / 100) *
    staminaMultiplier(hero.stamina)
  );
}

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
