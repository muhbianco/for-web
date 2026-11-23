import {
  type Inventory,
  type MagicState,
  type Rates,
  type RpgHeroView,
  type RunHero,
  type RunReward,
  type RunSupplies,
  type SkillId,
  type SkillState,
  type Slot,
  type TrainingBank,
  type TrainingSession,
  type TrainingSkill,
  type VocationId,
  addExperience,
  addGold,
  addItem,
  addMoney,
  addManaSpent,
  addSkillTries,
  autoEquip,
  bankAfter,
  cannotPromote,
  bankNow,
  changeCoins,
  cloneInventory,
  coinValue,
  COINS,
  compactPack,
  DEFAULT_SUPPLIES,
  discardItem,
  equipItem,
  freshSkill,
  gearOf,
  inventoryKey,
  inventoryWeight,
  itemDef,
  merchantBuys,
  merchantOffer,
  MONEY_MAX,
  newStack,
  packSize,
  payCoins,
  PROMOTION,
  regenStamina,
  reqMana,
  reqSkillTries,
  sameStack,
  settleSession,
  SKILLS,
  STACK_MAX,
  STAMINA,
  START,
  startSession,
  starterInventory,
  TRAINING,
  unequipItem,
  validInventory,
  VOCATIONS,
} from "@muchat/space-core/game/ot";

/**
 * O herói do jogo idle (docs/espaco/jogo/ot) no servidor: um por conta, criado no primeiro
 * uso, em `rpg_heroes`. Versão 2 (etapa O7): o inventário do OT no lugar da bolsa de moedas e
 * da lista de itens da etapa O5.
 */
export const RPG_VERSION = 2;

/** O treino aberto: a sessão das regras mais onde ele acontece. */
export interface RpgTraining extends TrainingSession {
  instance: string;
  server: string;
  zone: string;
}

/** O herói está numa dungeon até `ends_at` (etapa O5). */
export interface RpgRunMark {
  id: string;
  dungeon: string;
  ends_at: number;
}

/** Uma marca de corrida que passou disto do fim sem ser fechada é tratada como solta. */
export const RUN_STALE_MS = 10 * 60_000;

export interface RpgHeroDoc {
  _id: string;
  v: typeof RPG_VERSION;
  rev: number;
  created_at: number;
  updated_at: number;
  vocation: VocationId;
  level: number;
  experience: number;
  health_max: number;
  mana_max: number;
  cap: number;
  skills: Record<SkillId, SkillState>;
  magic: MagicState;
  stamina: number;
  bank: TrainingBank;
  training: RpgTraining | null;
  /** Quando a stamina foi acertada e a corrida em andamento (etapa O5). */
  stamina_at: number;
  run: RpgRunMark | null;
  /** Etapa O7: o que veste e a mochila; "escolher o melhor sozinho". */
  inv: Inventory;
  auto_equip: boolean;
  /** Etapa O8: saldo do banco em ouro [TFS players.balance]. */
  bank_gold: number;
  /** Transferências que saíram do saldo e ainda não chegaram (entregues pelo serviço). */
  outbox: RpgTransfer[];
  /** As últimas transferências recebidas (a entrega repetida não credita duas vezes). */
  inbox: string[];
  /** Etapa O9: quando beber poção e o que não pegar do loot. */
  supplies: RunSupplies;
  loot_skip: string[];
}

/** Quantos itens o filtro de loot guarda. */
export const LOOT_SKIP_MAX = 64;

/** Uma transferência do banco a caminho de `to`. */
export interface RpgTransfer {
  id: string;
  to: string;
  amount: number;
  at: number;
}

/** Quantas transferências recebidas o herói lembra. */
export const INBOX_KEEP = 64;
/** Quantas transferências podem esperar entrega ao mesmo tempo. */
export const OUTBOX_MAX = 16;

/** A bolsa do primeiro dia [TFS first_items.lua]. */
function firstBag(): Inventory {
  return { equip: { mochila: newStack(itemDef("bolsa")!) }, pack: [] };
}

/** Herói novo [TFS schema.sql: level 1, vida 150, mana 0, cap 400, saldo de treino e stamina cheios]. */
export function newRpgHero(userId: string, now: number): RpgHeroDoc {
  const skills = {} as Record<SkillId, SkillState>;
  for (const s of SKILLS) skills[s] = freshSkill();
  return {
    _id: userId,
    v: RPG_VERSION,
    rev: 0,
    created_at: now,
    updated_at: now,
    vocation: 0,
    level: START.level,
    experience: 0,
    health_max: START.health,
    mana_max: START.mana,
    cap: START.cap,
    skills,
    magic: { level: 0, manaSpent: 0 },
    stamina: STAMINA.max,
    bank: { ms: TRAINING.maxBankMs, at: now },
    training: null,
    stamina_at: now,
    run: null,
    inv: firstBag(),
    auto_equip: true,
    bank_gold: 0,
    outbox: [],
    inbox: [],
    supplies: structuredClone(DEFAULT_SUPPLIES),
    loot_skip: [],
  };
}

function skillLevels(d: { skills: Record<SkillId, SkillState> }) {
  const out = {} as Record<SkillId, number>;
  for (const k of SKILLS) out[k] = d.skills[k].level;
  return out;
}

/** Espaços guardados para as moedas na conversão (ouro, platina e cristal). */
const MIGRATE_COIN_SLOTS = 3;

/**
 * Herói da etapa O5 para o inventário da O7 [nosso]: o kit vestido com uma mochila de 20
 * (para nada se perder na troca da lista sem limite pela mochila com espaços), os itens que
 * tinha, os de mais valor primeiro, e as moedas. O que não couber nos espaços vira moedas
 * pelo valor, como a venda da saída da O5.
 */
function migrateInventory(x: RpgHeroDoc & { gold?: unknown; bag?: unknown }) {
  if (x.vocation === 0) {
    x.inv = firstBag();
    return;
  }
  const inv = starterInventory(VOCATIONS[x.vocation].base, "mochila");
  let gold = typeof x.gold === "number" && x.gold > 0 ? Math.floor(x.gold) : 0;
  const old = (Array.isArray(x.bag) ? x.bag : []) as {
    item: unknown;
    count: unknown;
  }[];
  const items = old
    .filter(
      (b): b is { item: string; count: number } =>
        typeof b?.item === "string" &&
        !!itemDef(b.item) &&
        Number.isInteger(b.count) &&
        (b.count as number) > 0,
    )
    .sort(
      (a, b) =>
        itemDef(b.item)!.value - itemDef(a.item)!.value ||
        (a.item < b.item ? -1 : a.item > b.item ? 1 : 0),
    );
  const room = () => inv.pack.length < packSize(inv) - MIGRATE_COIN_SLOTS;
  for (const b of items) {
    const def = itemDef(b.item)!;
    const fresh = newStack(def, 0);
    for (let k = 0; k < b.count; k++) {
      const merge = inv.pack.some(
        (p) => sameStack(p, fresh) && p.count < STACK_MAX,
      );
      if ((merge || room()) && addItem(inv, Infinity, def.id, 1) === 1)
        continue;
      gold += def.value;
    }
  }
  addGold(inv, Infinity, gold);
  autoEquip(inv, x.vocation, x.level, skillLevels(x), x.mana_max);
  x.inv = inv;
}

/** Herói gravado antes (etapas O2–O5): os campos novos com o valor de partida. */
export function normalizeHero(d: RpgHeroDoc): RpgHeroDoc {
  const x = d as RpgHeroDoc & { gold?: unknown; bag?: unknown };
  if (typeof x.stamina_at !== "number") x.stamina_at = x.updated_at ?? 0;
  if (x.run === undefined) x.run = null;
  if (!validInventory(x.inv)) migrateInventory(x);
  // [nosso] Itens iguais se juntam (inventory.ts): o herói gravado antes junta na leitura.
  compactPack(x.inv);
  if (typeof x.auto_equip !== "boolean") x.auto_equip = true;
  if (typeof x.bank_gold !== "number" || !(x.bank_gold >= 0)) x.bank_gold = 0;
  if (!Array.isArray(x.outbox)) x.outbox = [];
  if (!Array.isArray(x.inbox)) x.inbox = [];
  if (!validSupplies(x.supplies)) x.supplies = structuredClone(DEFAULT_SUPPLIES);
  if (!Array.isArray(x.loot_skip)) x.loot_skip = [];
  delete x.gold;
  delete x.bag;
  x.v = RPG_VERSION;
  return x;
}

function validSupplies(s: unknown): s is RunSupplies {
  const rule = (r: unknown) =>
    typeof r === "object" &&
    r !== null &&
    typeof (r as { below?: unknown }).below === "number" &&
    ((r as { item?: unknown }).item === null ||
      typeof (r as { item?: unknown }).item === "string");
  return (
    typeof s === "object" &&
    s !== null &&
    rule((s as RunSupplies).health) &&
    rule((s as RunSupplies).mana)
  );
}

/** Na dungeon agora (uma marca muito velha, de corrida que não fechou, não prende o herói). */
export function inRun(d: RpgHeroDoc, now: number): boolean {
  return d.run !== null && now < d.run.ends_at + RUN_STALE_MS;
}

/** Stamina agora: recupera fora da dungeon [TFS regenerate_stamina.lua; aqui, desde a última corrida]. */
export function staminaNow(d: RpgHeroDoc, now: number): number {
  if (inRun(d, now)) return d.stamina;
  return regenStamina(d.stamina, Math.max(0, (now - d.stamina_at) / 1000));
}

/** O herói no avatar do mapa: level, vocação e o que veste (o mapa desenha enquanto treina). */
export function heroLook(d: RpgHeroDoc): {
  level: number;
  vocation: number;
  gear: {
    weapon?: string;
    shield?: string;
    head?: string;
    body?: string;
    legs?: string;
    feet?: string;
    ammo?: string;
  };
} {
  const g = gearOf(d.inv);
  const gear: ReturnType<typeof heroLook>["gear"] = {};
  if (g.weapon) gear.weapon = g.weapon;
  if (g.shield) gear.shield = g.shield;
  if (g.armor.cabeca) gear.head = g.armor.cabeca;
  if (g.armor.corpo) gear.body = g.armor.corpo;
  if (g.armor.pernas) gear.legs = g.armor.pernas;
  if (g.armor.pes) gear.feet = g.armor.pes;
  if (g.ammo) gear.ammo = g.ammo;
  return { level: d.level, vocation: d.vocation, gear };
}

/** O herói como entra na corrida: skills, inventário e stamina de agora. */
export function heroRunSnapshot(
  d: RpgHeroDoc,
  name: string,
  now: number,
): RunHero {
  const inv = cloneInventory(d.inv);
  return {
    userId: d._id,
    name,
    vocation: d.vocation,
    level: d.level,
    healthMax: d.health_max,
    manaMax: d.mana_max,
    skills: skillLevels(d),
    magicLevel: d.magic.level,
    stamina: staminaNow(d, now),
    gear: gearOf(inv),
    inv,
    cap: d.cap,
    supplies: structuredClone(d.supplies),
    lootSkip: [...d.loot_skip],
  };
}

/**
 * Entra na dungeon: fecha um treino que tenha ficado aberto, acerta a stamina até agora (na
 * dungeon ela não recupera) e marca a corrida.
 */
export function markRun(
  d: RpgHeroDoc,
  mark: RpgRunMark,
  now: number,
  rates: Rates,
): RpgOutcome {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  if (inRun(d, now)) return { ok: false, reason: "in_run" };
  stopTraining(d, now, rates);
  d.stamina = staminaNow({ ...d, run: null }, now);
  d.stamina_at = now;
  d.run = { ...mark };
  return { ok: true };
}

/** Desfaz a marca (a corrida não chegou a começar). */
export function unmarkRun(d: RpgHeroDoc, id: string): RpgOutcome {
  if (d.run?.id !== id) return { ok: false, reason: "not_in_run" };
  d.run = null;
  return { ok: true };
}

/** O que o fechamento da corrida fez no herói, para o app contar e para o log. */
export interface RunSettled {
  levelBefore: number;
  levelAfter: number;
  /** O inventário mudou desde o começo (não deveria: os comandos esperam a corrida). */
  invMismatch: boolean;
}

/** O inventário do fim da corrida (etapa O7): o de partida, com o loot e só com o gasto. */
export interface RunInventories {
  start: Inventory;
  alive: Inventory;
  bare: Inventory;
}

/**
 * Fecha a corrida no herói, uma vez só: a marca tem de ser desta corrida. Gasta a stamina do
 * tempo na dungeon; o inventário fica como a corrida deixou (com o loot se ele não caiu, só
 * com o gasto se caiu); se não caiu, credita experiência, tentativas e mana. Corrida da etapa
 * O5 (sem inventário): o loot e as moedas entram no que couber.
 */
export function settleRun(
  d: RpgHeroDoc,
  id: string,
  reward: RunReward | null,
  staminaCost: number,
  now: number,
  after: RunInventories | null = null,
): { ok: true; settled: RunSettled } | { ok: false; reason: string } {
  if (d.run?.id !== id) return { ok: false, reason: "not_in_run" };
  const voc = VOCATIONS[d.vocation];
  const settled: RunSettled = {
    levelBefore: d.level,
    levelAfter: d.level,
    invMismatch: false,
  };
  d.stamina = Math.max(0, d.stamina - staminaCost);
  d.stamina_at = now;
  d.run = null;
  if (after) {
    // Comparadas já juntadas: a corrida que começou antes da mochila juntar as pilhas (o herói
    // é juntado na leitura) não pode perder o loot por isso.
    if (packedKey(d.inv) === packedKey(after.start)) {
      d.inv = cloneInventory(reward ? after.alive : after.bare);
      compactPack(d.inv);
    } else settled.invMismatch = true;
  } else if (reward) {
    for (const l of reward.loot) addItem(d.inv, d.cap, l.item, l.count);
    addGold(d.inv, d.cap, reward.gold);
  }
  if (reward) {
    const lv = addExperience(
      voc,
      {
        level: d.level,
        experience: d.experience,
        healthMax: d.health_max,
        manaMax: d.mana_max,
        cap: d.cap,
      },
      reward.exp,
    );
    d.level = lv.level;
    d.experience = lv.experience;
    d.health_max = lv.healthMax;
    d.mana_max = lv.manaMax;
    d.cap = lv.cap;
    settled.levelAfter = lv.level;
    for (const [k, n] of Object.entries(reward.tries) as [SkillId, number][])
      d.skills[k] = addSkillTries(voc, k, d.skills[k], n);
    d.magic = addManaSpent(voc, d.magic, reward.manaSpent);
  }
  if (d.auto_equip)
    autoEquip(d.inv, d.vocation, d.level, skillLevels(d), d.mana_max);
  return { ok: true, settled };
}

/** A chave do inventário com a mochila juntada (não mexe no original). */
function packedKey(inv: Inventory): string {
  const c = cloneInventory(inv);
  compactPack(c);
  return inventoryKey(c);
}

export type RpgOutcome = { ok: true } | { ok: false; reason: string };

/** Escolhe a vocação, só uma vez [TFS: a escolha é definitiva]; o kit dela vem junto. */
export function applyVocation(d: RpgHeroDoc, vocation: VocationId): RpgOutcome {
  if (d.vocation !== 0) return { ok: false, reason: "vocation_set" };
  if (vocation < 1 || vocation > 4)
    return { ok: false, reason: "bad_vocation" };
  d.vocation = vocation;
  const kit = starterInventory(VOCATIONS[vocation].base);
  // O que já estava na bolsa continua (o herói sem vocação não ganha nada, mas por garantia).
  for (const x of d.inv.pack) kit.pack.push({ ...x });
  d.inv = kit;
  if (d.auto_equip)
    autoEquip(d.inv, d.vocation, d.level, skillLevels(d), d.mana_max);
  return { ok: true };
}

// ---- inventário (etapa O7) ---------------------------------------------------

/** Lugares que o "escolher o melhor sozinho" cuida: mexer neles à mão desliga o automático. */
const AUTO_SLOTS: readonly Slot[] = [
  "arma",
  "escudo",
  "cabeca",
  "corpo",
  "pernas",
  "pes",
  "mochila",
  "municao",
];

function invGuard(d: RpgHeroDoc, now: number): RpgOutcome | null {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  if (inRun(d, now)) return { ok: false, reason: "in_run" };
  return null;
}

/** A pilha `index` ainda é a que o app viu? */
function samePack(d: RpgHeroDoc, index: number, item: string): RpgOutcome | null {
  return d.inv.pack[index]?.item === item
    ? null
    : { ok: false, reason: "changed" };
}

export function equipHero(
  d: RpgHeroDoc,
  index: number,
  item: string,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now) ?? samePack(d, index, item);
  if (g) return g;
  const slot = itemDef(item)?.slot ?? null;
  const r = equipItem(d.inv, VOCATIONS[d.vocation].base, d.level, index);
  if (r.ok && slot && AUTO_SLOTS.includes(slot)) d.auto_equip = false;
  return r;
}

export function unequipHero(d: RpgHeroDoc, slot: Slot, now: number): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  const r = unequipItem(d.inv, slot);
  if (r.ok && AUTO_SLOTS.includes(slot)) d.auto_equip = false;
  return r;
}

export function setAutoEquip(d: RpgHeroDoc, on: boolean, now: number): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  d.auto_equip = on;
  if (on) autoEquip(d.inv, d.vocation, d.level, skillLevels(d), d.mana_max);
  return { ok: true };
}

export function changeHeroCoins(
  d: RpgHeroDoc,
  index: number,
  item: string,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now) ?? samePack(d, index, item);
  if (g) return g;
  return changeCoins(d.inv, d.cap, index);
}

export function discardHeroItem(
  d: RpgHeroDoc,
  index: number,
  item: string,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now) ?? samePack(d, index, item);
  if (g) return g;
  return discardItem(d.inv, index);
}

// ---- NPCs (etapa O8) -----------------------------------------------------------

/**
 * Paga `amount` como o NPC do OT cobra [TFS player.lua removeTotalMoney]: das moedas que
 * carrega e, se faltar, do banco. O troco que não couber na mochila vai para o banco [nosso;
 * no OT cai no chão]. Recusa sem mexer em nada se não tem.
 */
function payTotal(d: RpgHeroDoc, inv: Inventory, amount: number): boolean {
  const carried = coinValue(inv);
  if (amount <= carried) {
    d.bank_gold += payCoins(inv, d.cap, amount)!;
    return true;
  }
  if (amount > carried + d.bank_gold) return false;
  payCoins(inv, d.cap, carried);
  d.bank_gold -= amount - carried;
  return true;
}

/** Compra do mercador: o item tem de caber (espaço e capacidade) antes de pagar. */
export function buyFromMerchant(
  d: RpgHeroDoc,
  item: string,
  count: number,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  const offer = merchantOffer(item);
  if (!offer) return { ok: false, reason: "not_sold" };
  const trial = cloneInventory(d.inv);
  if (addItem(trial, d.cap, item, count) !== count)
    return { ok: false, reason: "no_room" };
  const bank = d.bank_gold;
  if (!payTotal(d, trial, offer.price * count)) {
    d.bank_gold = bank;
    return { ok: false, reason: "no_money" };
  }
  d.inv = trial;
  return { ok: true };
}

/** Venda ao mercador pelo valor do item; o dinheiro entra como moedas (o que não couber, no banco). */
export function sellToMerchant(
  d: RpgHeroDoc,
  index: number,
  item: string,
  count: number,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now) ?? samePack(d, index, item);
  if (g) return g;
  const price = merchantBuys(item);
  if (price === null) return { ok: false, reason: "not_bought" };
  const x = d.inv.pack[index]!;
  if (count > x.count) return { ok: false, reason: "not_enough" };
  x.count -= count;
  if (x.count <= 0) d.inv.pack.splice(index, 1);
  d.bank_gold += addMoney(d.inv, d.cap, price * count);
  return { ok: true };
}

/** Depósito [TFS player.lua depositMoney]: `amount` 0 deposita todas as moedas. */
export function bankDeposit(
  d: RpgHeroDoc,
  amount: number,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  const value = amount === 0 ? coinValue(d.inv) : amount;
  if (value <= 0) return { ok: false, reason: "no_money" };
  const change = payCoins(d.inv, d.cap, value);
  if (change === null) return { ok: false, reason: "no_money" };
  d.bank_gold += value + change;
  return { ok: true };
}

/** Saque [TFS player.lua withdrawMoney]: só se as moedas couberem inteiras. */
export function bankWithdraw(
  d: RpgHeroDoc,
  amount: number,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  if (amount <= 0 || amount > d.bank_gold)
    return { ok: false, reason: "no_money" };
  const trial = cloneInventory(d.inv);
  if (addMoney(trial, d.cap, amount) > 0) return { ok: false, reason: "no_room" };
  d.inv = trial;
  d.bank_gold -= amount;
  return { ok: true };
}

/**
 * Tira do saldo e põe a transferência na fila de saída, no mesmo documento: se o processo cair
 * antes da entrega, ela continua lá e é entregue depois [TFS player.lua transferMoneyTo].
 */
export function transferOut(
  d: RpgHeroDoc,
  t: RpgTransfer,
  now: number,
): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  if (t.to === d._id) return { ok: false, reason: "self" };
  if (t.amount <= 0 || t.amount > MONEY_MAX || t.amount > d.bank_gold)
    return { ok: false, reason: "no_money" };
  if (d.outbox.length >= OUTBOX_MAX) return { ok: false, reason: "busy" };
  d.bank_gold -= t.amount;
  d.outbox.push({ ...t });
  return { ok: true };
}

/** Credita uma transferência, uma vez só (a mesma `id` de novo não muda nada). */
export function transferIn(d: RpgHeroDoc, t: RpgTransfer): RpgOutcome {
  if (d.inbox.includes(t.id)) return { ok: true };
  d.bank_gold += t.amount;
  d.inbox.push(t.id);
  while (d.inbox.length > INBOX_KEEP) d.inbox.shift();
  return { ok: true };
}

/** Tira da fila de saída a transferência entregue; `refund` devolve ao saldo (destino sumiu). */
export function transferSettled(
  d: RpgHeroDoc,
  id: string,
  refund: boolean,
): RpgOutcome {
  const i = d.outbox.findIndex((t) => t.id === id);
  if (i < 0) return { ok: false, reason: "not_found" };
  const [t] = d.outbox.splice(i, 1);
  if (refund) d.bank_gold += t!.amount;
  return { ok: true };
}

/** Promoção [TFS promotion.lua: level 20, 20.000 de ouro, das moedas e do banco]. */
export function promoteHero(d: RpgHeroDoc, now: number): RpgOutcome {
  const g = invGuard(d, now);
  if (g) return g;
  const why = cannotPromote(d.vocation, d.level);
  if (why) return { ok: false, reason: why };
  const trial = cloneInventory(d.inv);
  const bank = d.bank_gold;
  if (!payTotal(d, trial, PROMOTION.cost)) {
    d.bank_gold = bank;
    return { ok: false, reason: "no_money" };
  }
  d.inv = trial;
  d.vocation = VOCATIONS[d.vocation].promotion!;
  return { ok: true };
}

// ---- poções e filtro de loot (etapa O9) ----------------------------------------

/** Quando beber poção: a poção escolhida tem de existir e cuidar daquilo (vida ou mana). */
export function setSupplies(d: RpgHeroDoc, s: RunSupplies): RpgOutcome {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  for (const kind of ["health", "mana"] as const) {
    const item = s[kind].item;
    if (item !== null && !itemDef(item)?.potion?.[kind])
      return { ok: false, reason: "not_potion" };
  }
  d.supplies = structuredClone(s);
  return { ok: true };
}

/** Pegar ou não pegar um item (moedas sempre se pegam). */
export function setLootSkip(
  d: RpgHeroDoc,
  item: string,
  skip: boolean,
): RpgOutcome {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  if (!itemDef(item) || COINS.includes(item))
    return { ok: false, reason: "not_item" };
  const has = d.loot_skip.includes(item);
  if (skip && !has) {
    if (d.loot_skip.length >= LOOT_SKIP_MAX)
      return { ok: false, reason: "busy" };
    d.loot_skip.push(item);
  }
  if (!skip && has) d.loot_skip = d.loot_skip.filter((x) => x !== item);
  return { ok: true };
}

// ---- treino ------------------------------------------------------------------

/** Credita o que o treino aberto rendeu até `now` (sem fechar). Devolve se algo mudou. */
export function creditTraining(
  d: RpgHeroDoc,
  now: number,
  rates: Rates,
): boolean {
  const t = d.training;
  if (!t) return false;
  const voc = VOCATIONS[d.vocation];
  const { gain, creditedSeconds } = settleSession(voc, t, now, rates);
  if (creditedSeconds === t.creditedSeconds) return false;
  t.creditedSeconds = creditedSeconds;
  if (t.skill === "magia") d.magic = addManaSpent(voc, d.magic, gain.main);
  else
    d.skills[t.skill] = addSkillTries(
      voc,
      t.skill,
      d.skills[t.skill],
      gain.main,
    );
  d.skills.escudo = addSkillTries(voc, "escudo", d.skills.escudo, gain.escudo);
  return true;
}

/**
 * Fecha o treino em `now`: credita e devolve o saldo que sobrou. Se o orçamento acabou
 * antes, o treino terminou ali, e o saldo volta a encher a partir daquele instante.
 */
export function stopTraining(
  d: RpgHeroDoc,
  now: number,
  rates: Rates,
): boolean {
  const t = d.training;
  if (!t) return false;
  const end = Math.min(now, t.startedAt + t.budgetMs);
  creditTraining(d, end, rates);
  d.bank = bankAfter(t, end);
  d.training = null;
  return true;
}

/** Começa a treinar (fecha antes o treino anterior, se houver). */
export function startTraining(
  d: RpgHeroDoc,
  where: { instance: string; server: string; zone: string },
  skill: TrainingSkill,
  now: number,
  rates: Rates,
): RpgOutcome {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  if (inRun(d, now)) return { ok: false, reason: "in_run" };
  const t = d.training;
  if (
    t &&
    t.instance === where.instance &&
    t.server === where.server &&
    t.skill === skill &&
    now < t.startedAt + t.budgetMs
  ) {
    return { ok: true };
  }
  stopTraining(d, now, rates);
  const bank = bankNow(d.bank, now);
  if (bank < TRAINING.minCreditMs) return { ok: false, reason: "no_bank" };
  const s = startSession({ ms: bank, at: now }, skill, now);
  d.bank = { ms: bank, at: now };
  d.training = { ...s, ...where };
  return { ok: true };
}

/** O treino aberto já esgotou o orçamento? */
export function trainingExpired(d: RpgHeroDoc, now: number): boolean {
  const t = d.training;
  return !!t && now >= t.startedAt + t.budgetMs;
}

export function rpgHeroView(
  d: RpgHeroDoc,
  rates: Rates,
  now: number,
): RpgHeroView {
  const voc = VOCATIONS[d.vocation];
  const skills = {} as RpgHeroView["skills"];
  for (const s of SKILLS) {
    const st = d.skills[s];
    skills[s] = {
      level: st.level,
      tries: st.tries,
      next: reqSkillTries(voc, s, st.level + 1),
    };
  }
  return {
    vocation: d.vocation,
    level: d.level,
    experience: d.experience,
    health_max: d.health_max,
    mana_max: d.mana_max,
    cap: d.cap,
    skills,
    magic: {
      level: d.magic.level,
      mana_spent: d.magic.manaSpent,
      next: reqMana(voc, d.magic.level + 1),
    },
    stamina: staminaNow(d, now),
    bank_ms: d.bank.ms,
    bank_at: d.bank.at,
    training: d.training
      ? {
          skill: d.training.skill,
          instance: d.training.instance,
          started_at: d.training.startedAt,
          budget_ms: d.training.budgetMs,
          credited_s: d.training.creditedSeconds,
        }
      : null,
    rates: { ...rates },
    inventory: cloneInventory(d.inv),
    pack_size: packSize(d.inv),
    weight: inventoryWeight(d.inv),
    gold: coinValue(d.inv),
    bank_gold: d.bank_gold,
    supplies: structuredClone(d.supplies),
    loot_skip: [...d.loot_skip],
    auto_equip: d.auto_equip,
    gear: gearOf(d.inv),
    run: inRun(d, now) && d.run ? { ...d.run } : null,
  };
}

/** Teto do documento no Mongo (o herói é pequeno; isto pega um bug, não um jogador). */
export const RPG_DOC_MAX_BYTES = 16 * 1024;
export function rpgDocBytes(d: RpgHeroDoc): number {
  return Buffer.byteLength(JSON.stringify(d));
}
