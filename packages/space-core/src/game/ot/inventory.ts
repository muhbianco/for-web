import type { VocationId } from "./data.ts";
import {
  type AmmoType,
  type ItemDef,
  type Slot,
  ARMOR_SLOTS,
  COINS,
  GOLD,
  SLOTS,
  cannotUse,
  itemDef,
  starterKit,
} from "./items.ts";

/**
 * O inventário do herói (etapa O7), pelas regras do TFS: os 10 lugares do corpo, a mochila
 * com espaços contados, pilhas de até 100 e o peso contra a capacidade. Funções puras, iguais
 * no servidor, na simulação da corrida e no app.
 *
 * Adaptações [nosso]:
 * - um recipiente só (o do lugar da mochila); bolsa ou mochila guardada dentro dele é um item
 *   vazio, sem conteúdo próprio;
 * - item novo entra no começo da mochila [TFS container.cpp addThing: push_front].
 */

/** Pilha máxima [TFS game.h ITEM_STACK_SIZE]. */
export const STACK_MAX = 100;

/** Um item (ou uma pilha) com o que ainda resta de cargas e de tempo. */
export interface ItemStack {
  item: string;
  count: number;
  charges?: number;
  /** Segundos de uso que restam (anéis). */
  duration?: number;
}

export interface Inventory {
  equip: Partial<Record<Slot, ItemStack>>;
  /** O que está dentro do recipiente do lugar da mochila. */
  pack: ItemStack[];
}

export type InvOutcome = { ok: true } | { ok: false; reason: string };

/** Um item novo, com as cargas e o tempo cheios. */
export function newStack(def: ItemDef, count = 1): ItemStack {
  const s: ItemStack = { item: def.id, count };
  if (def.charges) s.charges = def.charges;
  if (def.duration) s.duration = def.duration;
  return s;
}

export function emptyInventory(): Inventory {
  return { equip: {}, pack: [] };
}

export function cloneInventory(inv: Inventory): Inventory {
  const equip: Inventory["equip"] = {};
  for (const s of SLOTS) {
    const x = inv.equip[s];
    if (x) equip[s] = { ...x };
  }
  return { equip, pack: inv.pack.map((x) => ({ ...x })) };
}

/** Quantos espaços tem o recipiente vestido (0: sem recipiente). */
export function packSize(inv: Inventory): number {
  const c = inv.equip.mochila;
  return c ? (itemDef(c.item)?.container ?? 0) : 0;
}

export function stackWeight(s: ItemStack): number {
  return (itemDef(s.item)?.weight ?? 0) * s.count;
}

/** Peso de tudo o que o herói carrega, vestido e na mochila [TFS Player::getInventoryWeight]. */
export function inventoryWeight(inv: Inventory): number {
  let w = 0;
  for (const s of SLOTS) {
    const x = inv.equip[s];
    if (x) w += stackWeight(x);
  }
  for (const x of inv.pack) w += stackWeight(x);
  return w;
}

/** Capacidade livre em centésimos de oz (`cap` em oz); negativa se passou [TFS getFreeCapacity]. */
export function freeCapacity(inv: Inventory, cap: number): number {
  return cap * 100 - inventoryWeight(inv);
}

/** Valor das moedas que o herói carrega, em ouro. */
export function coinValue(inv: Inventory): number {
  let v = 0;
  for (const x of inv.pack)
    if (COINS.includes(x.item)) v += (itemDef(x.item)?.value ?? 0) * x.count;
  return v;
}

/**
 * Põe até `n` de um item na mochila: completa as pilhas que existem e abre outras enquanto
 * houver espaço; só o que cabe no peso [TFS Player::queryAdd, Container::queryMaxCount].
 * Devolve quantos entraram.
 */
export function addItem(
  inv: Inventory,
  cap: number,
  itemId: string,
  n: number,
): number {
  const def = itemDef(itemId);
  if (!def || n <= 0) return 0;
  const size = packSize(inv);
  let left = n;
  if (def.weight > 0) {
    const fit = Math.floor(freeCapacity(inv, cap) / def.weight);
    left = Math.min(left, Math.max(0, fit));
  }
  let added = 0;
  if (def.stackable) {
    for (const x of inv.pack) {
      if (left <= 0) break;
      if (x.item !== itemId || x.count >= STACK_MAX) continue;
      const k = Math.min(left, STACK_MAX - x.count);
      x.count += k;
      left -= k;
      added += k;
    }
    while (left > 0 && inv.pack.length < size) {
      const k = Math.min(left, STACK_MAX);
      inv.pack.unshift(newStack(def, k));
      left -= k;
      added += k;
    }
    return added;
  }
  while (left > 0 && inv.pack.length < size) {
    inv.pack.unshift(newStack(def, 1));
    left--;
    added++;
  }
  return added;
}

/** Tira `n` de uma pilha da mochila (a pilha some quando zera). */
function takeFromPack(inv: Inventory, index: number, n: number) {
  const x = inv.pack[index]!;
  x.count -= n;
  if (x.count <= 0) inv.pack.splice(index, 1);
}

/**
 * [nosso] Na dungeon o herói troca sozinho a pilha de 100 pela moeda de cima, como o jogador
 * faz usando a pilha [TFS change_gold.lua]. A pilha cheia sai e libera o espaço; a moeda de
 * cima entra (cabe: o peso cai de 10 oz para 0,10 oz).
 */
export function changeFullStacks(inv: Inventory, cap: number): void {
  for (let c = 0; c < COINS.length - 1; c++) {
    for (;;) {
      const i = inv.pack.findIndex(
        (x) => x.item === COINS[c] && x.count >= STACK_MAX,
      );
      if (i < 0) break;
      // Num herói acima da capacidade nem a moeda de cima cabe: a pilha fica como está.
      const trial = cloneInventory(inv);
      takeFromPack(trial, i, STACK_MAX);
      if (addItem(trial, cap, COINS[c + 1]!, 1) !== 1) break;
      inv.pack = trial.pack;
    }
  }
}

/**
 * Moedas que caíram, em ouro: entram como moedas de ouro, trocando cada pilha que fecha 100.
 * Devolve quantas entraram (o resto ficou no corpo).
 */
export function addGold(inv: Inventory, cap: number, n: number): number {
  let added = 0;
  let left = n;
  while (left > 0) {
    const k = addItem(inv, cap, GOLD, Math.min(left, STACK_MAX));
    if (k <= 0) break;
    added += k;
    left -= k;
    changeFullStacks(inv, cap);
  }
  return added;
}

/**
 * Põe `value` em ouro como moedas, das maiores para as menores [TFS Game::addMoney]. Devolve o
 * valor que não coube (no OT cai no chão; quem chama decide: banco ou recusa).
 */
export function addMoney(inv: Inventory, cap: number, value: number): number {
  let left = value;
  for (let c = COINS.length - 1; c >= 0; c--) {
    const worth = itemDef(COINS[c]!)?.value ?? 0;
    if (worth <= 0) continue;
    const n = Math.floor(left / worth);
    if (n <= 0) continue;
    left -= addItem(inv, cap, COINS[c]!, n) * worth;
  }
  return left;
}

/**
 * Paga `amount` com as moedas que carrega e recebe o troco nas maiores [TFS Player::removeMoney
 * e Game::addMoney]. Devolve o troco que não coube (vai para o banco) ou null se não tem.
 */
export function payCoins(
  inv: Inventory,
  cap: number,
  amount: number,
): number | null {
  const total = coinValue(inv);
  if (amount < 0 || total < amount) return null;
  inv.pack = inv.pack.filter((x) => !COINS.includes(x.item));
  return addMoney(inv, cap, total - amount);
}

/**
 * Usar uma pilha de moedas [TFS change_gold.lua]: 100 viram 1 da moeda de cima; senão, 1
 * vira 100 da de baixo (e o ouro não desce).
 */
export function changeCoins(
  inv: Inventory,
  cap: number,
  index: number,
): InvOutcome {
  const x = inv.pack[index];
  if (!x) return { ok: false, reason: "no_item" };
  const c = COINS.indexOf(x.item);
  if (c < 0) return { ok: false, reason: "not_coin" };
  const up = COINS[c + 1];
  const down = COINS[c - 1];
  if (up && x.count === STACK_MAX) {
    const trial = cloneInventory(inv);
    takeFromPack(trial, index, STACK_MAX);
    if (addItem(trial, cap, up, 1) !== 1)
      return { ok: false, reason: "no_room" };
    inv.pack = trial.pack;
    return { ok: true };
  }
  if (!down) return { ok: false, reason: "not_enough" };
  const trial = cloneInventory(inv);
  takeFromPack(trial, index, 1);
  if (addItem(trial, cap, down, STACK_MAX) !== STACK_MAX)
    return { ok: false, reason: "no_room" };
  inv.pack = trial.pack;
  return { ok: true };
}

/**
 * Veste o item da mochila (troca de lugar com o que estava lá). As duas mãos: arma de duas
 * mãos não entra com escudo, nem escudo com ela [TFS player.cpp queryAdd, "Both hands need to
 * be free"]. Trocar de recipiente leva o conteúdo para o novo, com o velho dentro.
 */
export function equipItem(
  inv: Inventory,
  base: VocationId,
  level: number,
  index: number,
): InvOutcome {
  const x = inv.pack[index];
  if (!x) return { ok: false, reason: "no_item" };
  const def = itemDef(x.item);
  if (!def) return { ok: false, reason: "no_item" };
  const why = cannotUse(def, base, level);
  if (why) return { ok: false, reason: why };
  const slot = def.slot!;
  if (slot === "arma" && def.twoHanded && inv.equip.escudo)
    return { ok: false, reason: "both_hands" };
  if (slot === "escudo") {
    const w = inv.equip.arma ? itemDef(inv.equip.arma.item) : undefined;
    if (w?.twoHanded) return { ok: false, reason: "both_hands" };
  }
  if (slot === "mochila") {
    const old = inv.equip.mochila;
    const after = inv.pack.length - 1 + (old ? 1 : 0);
    if (after > (def.container ?? 0)) return { ok: false, reason: "no_room" };
    inv.pack.splice(index, 1);
    inv.equip.mochila = x;
    if (old) inv.pack.unshift(old);
    return { ok: true };
  }
  const cur = inv.equip[slot];
  inv.equip[slot] = x;
  if (cur) inv.pack[index] = cur;
  else inv.pack.splice(index, 1);
  return { ok: true };
}

/** Tira do corpo para a mochila (precisa de espaço; o recipiente não sai, ele leva tudo). */
export function unequipItem(inv: Inventory, slot: Slot): InvOutcome {
  const cur = inv.equip[slot];
  if (!cur) return { ok: false, reason: "no_item" };
  if (slot === "mochila") return { ok: false, reason: "is_container" };
  if (inv.pack.length >= packSize(inv)) return { ok: false, reason: "no_room" };
  delete inv.equip[slot];
  inv.pack.unshift(cur);
  return { ok: true };
}

/** Joga fora uma pilha da mochila [TFS: largar no chão; aqui ela some]. */
export function discardItem(inv: Inventory, index: number): InvOutcome {
  if (!inv.pack[index]) return { ok: false, reason: "no_item" };
  inv.pack.splice(index, 1);
  return { ok: true };
}

/**
 * O kit da vocação vestido (as outras armas do kit vão na mochila) e a bolsa do primeiro dia.
 * `container` troca a bolsa por outro recipiente (heróis convertidos da etapa O5 ganham a
 * mochila, para nada se perder).
 */
export function starterInventory(
  base: VocationId,
  container = "bolsa",
): Inventory {
  const inv = emptyInventory();
  const c = itemDef(container);
  if (c) inv.equip.mochila = newStack(c);
  for (const def of starterKit(base)) {
    const st = newStack(def, def.starterCount ?? 1);
    const slot = def.slot!;
    if (!inv.equip[slot]) inv.equip[slot] = st;
    else inv.pack.push(st);
  }
  return inv;
}

/** O que está vestido, do jeito que a corrida e o app usam. */
export interface Gear {
  weapon: string | null;
  shield: string | null;
  armor: Partial<Record<(typeof ARMOR_SLOTS)[number], string>>;
  /** Etapa O7: colar, anel e munição (com quantas há no lugar e na mochila). */
  necklace?: string | null;
  ring?: string | null;
  ammo?: string | null;
  ammoCount?: number;
}

export function gearOf(inv: Inventory): Gear {
  const armor: Gear["armor"] = {};
  for (const s of ARMOR_SLOTS) {
    const x = inv.equip[s];
    if (x) armor[s] = x.item;
  }
  const ammo = inv.equip.municao ?? null;
  let ammoCount = ammo?.count ?? 0;
  if (ammo)
    for (const x of inv.pack) if (x.item === ammo.item) ammoCount += x.count;
  return {
    weapon: inv.equip.arma?.item ?? null,
    shield: inv.equip.escudo?.item ?? null,
    armor,
    necklace: inv.equip.colar?.item ?? null,
    ring: inv.equip.anel?.item ?? null,
    ammo: ammo?.item ?? null,
    ammoCount,
  };
}

/**
 * A arma de distância sem munição para ela (acabou, ou só tem a de outro tipo: flecha com a
 * besta): devolve o tipo que falta; null se não falta (ou a arma não usa munição).
 */
export function missingAmmo(
  inv: Inventory,
  base: VocationId,
  level: number,
): AmmoType | null {
  const w = inv.equip.arma ? itemDef(inv.equip.arma.item) : undefined;
  if (!w?.ammo) return null;
  const fits = (s: ItemStack | undefined) => {
    const d = s ? itemDef(s.item) : undefined;
    return !!d && d.ammo === w.ammo && d.slot === "municao" && cannotUse(d, base, level) === null;
  };
  if (fits(inv.equip.municao) || inv.pack.some(fits)) return null;
  return w.ammo;
}

/** Chave canônica (ordem fixa de lugares e campos), para comparar dois inventários. */
export function inventoryKey(inv: Inventory): string {
  const k = (s: ItemStack | undefined) =>
    s ? [s.item, s.count, s.charges ?? null, s.duration ?? null] : null;
  return JSON.stringify([SLOTS.map((s) => k(inv.equip[s])), inv.pack.map(k)]);
}

/** Confere a forma (documento lido do banco): pilhas válidas, mochila dentro do tamanho. */
export function validInventory(inv: unknown): inv is Inventory {
  if (typeof inv !== "object" || inv === null) return false;
  const x = inv as Inventory;
  if (typeof x.equip !== "object" || x.equip === null || !Array.isArray(x.pack))
    return false;
  const ok = (s: unknown) =>
    typeof s === "object" &&
    s !== null &&
    typeof (s as ItemStack).item === "string" &&
    Number.isInteger((s as ItemStack).count) &&
    (s as ItemStack).count > 0 &&
    (s as ItemStack).count <= STACK_MAX;
  for (const s of SLOTS)
    if (x.equip[s] !== undefined && !ok(x.equip[s])) return false;
  if (!x.pack.every(ok)) return false;
  return x.pack.length <= packSize(x);
}
