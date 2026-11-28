import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import type { ItemInstance, WeaponItem } from "../equipment.ts";
import { heroLoadout } from "../equipment.ts";
import { balance as B } from "../formulas.ts";
import { type HeroV5, type OwnedItem, createHero, forgeSupreme, rerollPerk } from "../hero.ts";
import { checkHero } from "../heroSchema.ts";
import { buyBackPrice } from "../npcs/merchant.ts";
import { generateItem } from "./generate.ts";
import { itemPerks } from "./legendary.ts";
import { dismantle } from "./smith.ts";
import { isSupreme, rollSupremePower, supremeRecipeError } from "./supreme.ts";
import { itemTooltip } from "./view.ts";

// D68 Arma Suprema (27/11/2026): 5 lendárias iguais no Ferreiro viram uma, com +10–20% de poder e 2 perks.

let n = 0;
const id = () => `s${++n}`;
const rng = (seed = 1) => randomSource(new Rng(seed));
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  assert.ok(r.ok, JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const sword = (ilvl = 200, seed = 1, rarity: "lendario" | "epico" = "lendario"): OwnedItem =>
  ({ ...generateItem({ slot: "arma", family: "espada" }, ilvl, rarity, rng(seed), B), uid: id() }) as OwnedItem;
const hero = (bag: OwnedItem[]): HeroV5 => ({ ...createHero("guerreiro", id), level: 200, bag });

test("Suprema: a base fica (afixos, refino, 1º perk), ganha o poder e o 2º perk; as outras 4 somem", () => {
  const five = [1, 2, 3, 4, 5].map((s) => sword(200, s));
  const base = { ...five[0]!, refine: 7, perks: [{ skill: "grito-de-guerra", value: 0.5 }] } as OwnedItem;
  const h = hero([base, ...five.slice(1), sword(200, 9, "epico")]);
  const r = ok(forgeSupreme(h, base.uid, five.slice(1).map((x) => x.uid), rng(3)));
  assert.equal(r.hero.bag.length, 2, "a mochila não perdeu exatamente as 4");
  const got = r.hero.bag.find((x) => x.uid === base.uid)! as WeaponItem;
  assert.ok(isSupreme(got));
  assert.deepEqual(got.affixes, base.affixes);
  assert.equal(got.refine, 7);
  const p = itemPerks(got);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], itemPerks(base)[0]);
  assert.notEqual(p[0]!.skill, p[1]!.skill);
  assert.ok(got.supreme!.power >= 0.1 && got.supreme!.power <= 0.2);
  // O poder entra no dano base da arma (o que a dica mostra como ATQ).
  const eq = (w: ItemInstance) => heroLoadout({ ...h, equipment: { arma: w as WeaponItem } } as never, B).weaponBase;
  assert.ok(Math.abs(eq(got) / eq(base) - (1 + got.supreme!.power)) < 1e-9);
  const atq = (w: ItemInstance) => itemTooltip(w).base.find((x) => x.label === "ATQ")!.value;
  assert.ok(Math.abs(atq(got) / atq(base) - (1 + got.supreme!.power)) < 0.01);
  // O herói forjado passa no esquema; o 2º perk rola no Ferreiro como o 1º.
  const check = checkHero(r.hero);
  assert.ok(check.ok, check.ok ? "" : check.reason);
  const rolled = ok(rerollPerk({ ...r.hero, essence: 1 }, base.uid, 1, rng(8)));
  const again = itemPerks(rolled.hero.bag.find((x) => x.uid === base.uid)!);
  assert.deepEqual(again[0], p[0]);
  assert.notEqual(again[1]!.skill, again[0]!.skill);
});

test("Suprema: a base pode estar vestida; as outras, só da mochila", () => {
  const five = [1, 2, 3, 4, 5].map((s) => sword(300, s));
  const h: HeroV5 = { ...hero(five.slice(1)), level: 300, equipment: { arma: five[0]! as never } };
  const r = ok(forgeSupreme(h, five[0]!.uid, five.slice(1).map((x) => x.uid), rng(4)));
  assert.ok(isSupreme(r.hero.equipment.arma));
  assert.equal(r.hero.bag.length, 0);
  // Vestida como uma das 4: recusa.
  const h2: HeroV5 = { ...hero([five[0]!, ...five.slice(2)]), equipment: { arma: five[1]! as never } };
  assert.deepEqual(forgeSupreme(h2, five[0]!.uid, five.slice(1).map((x) => x.uid), rng()), {
    ok: false,
    error: "suprema-fora-da-mochila",
  });
});

test("Suprema: a receita recusa família ou iL diferente, épico, Suprema de ingrediente e quantidade errada", () => {
  const five = [1, 2, 3, 4, 5].map((s) => sword(200, s));
  const uids = five.slice(1).map((x) => x.uid);
  const err = (bag: OwnedItem[], base: string, others: string[]) => forgeSupreme(hero(bag), base, others, rng());
  const axe = { ...generateItem({ slot: "arma", family: "machado" }, 200, "lendario", rng(7), B), uid: id() } as OwnedItem;
  assert.deepEqual(err([five[0]!, five[1]!, five[2]!, five[3]!, axe], five[0]!.uid, [five[1]!.uid, five[2]!.uid, five[3]!.uid, axe.uid]), { ok: false, error: "suprema-armas-diferentes" });
  const low = sword(190, 6);
  assert.deepEqual(err([five[0]!, five[1]!, five[2]!, five[3]!, low], five[0]!.uid, [five[1]!.uid, five[2]!.uid, five[3]!.uid, low.uid]), { ok: false, error: "suprema-armas-diferentes" });
  const epic = sword(200, 8, "epico");
  assert.deepEqual(err([five[0]!, five[1]!, five[2]!, five[3]!, epic], five[0]!.uid, [five[1]!.uid, five[2]!.uid, five[3]!.uid, epic.uid]), { ok: false, error: "suprema-nao-lendaria" });
  const sup = { ...five[4]!, supreme: { power: 0.1 } } as OwnedItem;
  assert.deepEqual(err([...five.slice(0, 4), sup], five[0]!.uid, [five[1]!.uid, five[2]!.uid, five[3]!.uid, sup.uid]), { ok: false, error: "suprema-nao-lendaria" });
  assert.deepEqual(err(five, five[0]!.uid, uids.slice(0, 3)), { ok: false, error: "suprema-quantidade" });
  assert.deepEqual(err(five, five[0]!.uid, [five[0]!.uid, ...uids.slice(0, 3)]), { ok: false, error: "suprema-quantidade" });
  assert.deepEqual(err(five, "nada", uids), { ok: false, error: "item-nao-encontrado" });
  assert.equal(supremeRecipeError(five[0]!, five.slice(1), B), null);
});

test("Suprema: o poder sai de 10% a 20% em passos de 1%, média 15%", () => {
  const seen = new Map<number, number>();
  let sum = 0;
  const r = rng(11);
  const N = 22_000;
  for (let i = 0; i < N; i++) {
    const p = rollSupremePower(r, B);
    sum += p;
    seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  assert.equal(seen.size, 11);
  assert.ok(Math.min(...seen.keys()) === 0.1 && Math.max(...seen.keys()) === 0.2);
  assert.ok(Math.abs(sum / N - 0.15) < 0.002, `média ${sum / N}`);
});

test("Suprema: desmontar e vender valem as 5 lendárias; o lendário comum tem 1 perk", () => {
  const s = sword(200, 1);
  const sup = { ...s, supreme: { power: 0.15 } } as OwnedItem;
  assert.equal(dismantle(sup).essence, 5 * dismantle(s).essence);
  assert.equal(dismantle(sup).ore.count, 5 * dismantle(s).ore.count);
  assert.equal(buyBackPrice(sup), 5 * buyBackPrice(s));
  const two = [
    { skill: "golpe-provocador", value: 0.1 },
    { skill: "grito-de-guerra", value: 0.5 },
  ];
  assert.equal(itemPerks({ ...s, perks: two }).length, 1);
  assert.equal(itemPerks({ ...sup, perks: two }).length, 2);
  assert.equal(B.cfg.legendaryPerks.maxPerks, 1);
});
