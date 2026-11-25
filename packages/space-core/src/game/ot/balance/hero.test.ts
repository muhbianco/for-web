import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../rng.ts";
import { fight, randomSource } from "./combat/fight.ts";
import { CLASS_IDS, CLASSES } from "./content.ts";
import { cannotEquip } from "./equipment.ts";
import { balance as B } from "./formulas.ts";
import {
  type HeroV5,
  type OwnedItem,
  BAG_SLOTS,
  applyRun,
  autoEquipBag,
  balanceHero,
  bankGold,
  buyAmmo,
  buyCommonItem,
  buyPotions,
  createHero,
  discardItem,
  dismantleItem,
  equipItem,
  evolveTier,
  heroRunFighter,
  raiseAttributes,
  refineItem,
  respecAttributes,
  respecSkills,
  sellItem,
  setBelt,
  startDojo,
  stopDojo,
  unequipItem,
  vaultExpand,
  vaultPut,
  vaultTake,
} from "./hero.ts";
import { generateItem, materialOf } from "./items/generate.ts";

// O herói v5 (Fase 8): criação e cada ação do jogador.

let n = 0;
const id = () => `i${++n}`;
const rng = (seed = 1) => randomSource(new Rng(seed));
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  assert.ok(r.ok, JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const own = (
  base: Parameters<typeof generateItem>[0],
  ilvl = 1,
  rarity: Parameters<typeof generateItem>[2] = "comum",
): OwnedItem => ({
  ...generateItem(base, ilvl, rarity, rng(ilvl), B),
  uid: id(),
});

test("jogador novo de cada classe: nível 1, kit Comum que ele veste, poções e flechas no caçador", () => {
  for (const cls of CLASS_IDS) {
    const h = createHero(cls, id);
    assert.equal(h.level, 1);
    assert.equal(h.skills.tier, 1);
    assert.ok(h.skills.slots.length > 0, cls);
    const worn = Object.values(h.equipment);
    assert.ok(worn.length >= 5, cls);
    for (const it of worn)
      assert.equal(cannotEquip(balanceHero(h), it!, B), null, cls);
    assert.equal(h.potions.hp.pequena, 10);
    assert.deepEqual(h.belt, { hp: "pequena", mp: "pequena" });
    assert.equal((h.ammo.comum ?? 0) > 0, cls === "cacador");
    assert.equal(new Set(worn.map((x) => x!.uid)).size, worn.length);
    // Já luta: o lutador sai do herói salvo.
    const f = heroRunFighter(h);
    assert.equal(f.cls, cls);
    assert.equal(f.potions.hpStock, 10);
    assert.equal(CLASSES[cls].role, f.role);
  }
});

test("atributos sobem com os pontos do nível; a redistribuição cobra do 2º em diante", () => {
  let h: HeroV5 = { ...createHero("mago", id), level: 10, gold: 6000 };
  h = ok(raiseAttributes(h, { INT: 30 })).hero;
  assert.equal(h.attrs.INT, 31);
  assert.deepEqual(raiseAttributes(h, { INT: 100 }), {
    ok: false,
    error: "sem-pontos",
  });
  const first = ok(respecAttributes(h));
  assert.equal(first.cost, 0);
  assert.equal(first.hero.attrs.INT, 1);
  const second = ok(respecAttributes(first.hero));
  assert.equal(second.cost, 5000);
  assert.equal(second.hero.gold, 1000);
  assert.deepEqual(respecAttributes(second.hero), {
    ok: false,
    error: "sem-ouro",
  });
  assert.equal(ok(respecSkills({ ...h, gold: 0 })).cost, 0);
});

test("equipar troca com a mochila; a mochila tem teto; a arma de 2 mãos devolve o escudo", () => {
  let h = createHero("guerreiro", id);
  const axe = own({ slot: "arma", family: "espada" }, 1, "raro");
  h = { ...h, bag: [axe] };
  const r = ok(equipItem(h, axe.uid));
  assert.equal(r.hero.equipment.arma?.uid, axe.uid);
  assert.equal(r.hero.bag.length, 1);
  // Machado de 2 mãos: entra e o escudo volta para a mochila.
  const two = own({ slot: "arma", family: "machado" });
  const withAxe = ok(equipItem({ ...r.hero, bag: [two] }, two.uid));
  assert.equal(withAxe.hero.equipment.arma?.uid, two.uid);
  assert.equal(withAxe.hero.equipment.secundaria, undefined);
  assert.deepEqual(withAxe.hero.bag.map((x) => x.slot).sort(), [
    "arma",
    "secundaria",
  ]);
  const full: HeroV5 = {
    ...h,
    bag: Array.from({ length: BAG_SLOTS }, () => own({ slot: "anel" })),
  };
  assert.deepEqual(unequipItem(full, "elmo"), {
    ok: false,
    error: "mochila-cheia",
  });
  assert.equal(equipItem(h, "nao-existe").ok, false);
  const wrong = own({ slot: "arma", family: "cajado" });
  assert.deepEqual(equipItem({ ...h, bag: [wrong] }, wrong.uid), {
    ok: false,
    error: "classe-nao-usa",
  });
});

test("auto-equipar veste o Raro melhor e devolve o Comum para a mochila", () => {
  const h = createHero("cacador", id);
  const bow = own({ slot: "arma", family: "arco" }, 1, "raro");
  const r = ok(autoEquipBag({ ...h, bag: [bow] }));
  assert.equal(r.hero.equipment.arma?.uid, bow.uid);
  assert.ok(r.hero.bag.some((x) => x.uid === h.equipment.arma!.uid));
  assert.equal(r.changed, 1);
});

test("Mercador: poções, munição e Comum pelo preço do tier; venda a 10%", () => {
  let h: HeroV5 = { ...createHero("cacador", id), level: 100, gold: 100_000 };
  const p = ok(buyPotions(h, "hp", "pequena", 10));
  assert.equal(p.hero.potions.hp.pequena, 20);
  assert.equal(p.cost, 10 * Math.ceil(0.25 * B.lacaioGold(100)));
  // D35: a grande custa e cura 3×, com recarga de 3 s.
  const g = ok(buyPotions(p.hero, "hp", "grande", 2));
  assert.equal(g.cost, 2 * 3 * Math.ceil(0.25 * B.lacaioGold(100)));
  const belted = ok(setBelt(g.hero, "hp", "grande")).hero;
  const f = heroRunFighter(belted);
  assert.equal(f.potions.hpStock, 2);
  assert.equal(f.potions.hpCooldownMs, 3000);
  assert.equal(f.potions.hp, 3 * heroRunFighter(p.hero).potions.hp);
  h = ok(buyAmmo(p.hero, "afiada", 2)).hero;
  assert.equal(h.ammo.afiada, 200);
  const c = ok(buyCommonItem(h, { slot: "anel" }, id, rng()));
  assert.equal(c.item.ilvl, 100);
  assert.equal(c.item.rarity, "comum");
  const s = ok(sellItem(c.hero, c.item.uid, false));
  assert.equal(s.gold, Math.floor(0.1 * 20 * B.lacaioGold(100)));
  assert.deepEqual(buyPotions({ ...h, gold: 0 }, "mp", "pequena", 1), {
    ok: false,
    error: "sem-ouro",
  });
  assert.deepEqual(buyPotions(h, "mp", "pequena", 0), {
    ok: false,
    error: "quantidade-invalida",
  });
  const refined = { ...own({ slot: "elmo", weight: "media" }), refine: 7 };
  assert.deepEqual(sellItem({ ...h, bag: [refined] }, refined.uid, false), {
    ok: false,
    error: "confirmacao",
  });
});

test("Ferreiro: refino cobra ouro e minério, a Pedra só se gasta no +8 a +10; desmontar dá minério", () => {
  const sword = own({ slot: "arma", family: "espada" }, 100, "raro");
  const mat = materialOf(100);
  let h: HeroV5 = {
    ...createHero("guerreiro", id),
    level: 100,
    gold: 1e7,
    bag: [sword],
    ores: { [mat]: 100 },
    stones: 1,
  };
  for (let i = 0; i < 4; i++)
    h = ok(refineItem(h, sword.uid, rng(i), false)).hero;
  const it = h.bag.find((x) => x.uid === sword.uid)!;
  assert.equal(it.refine, 4);
  assert.equal(h.ores[mat], 100 - (1 + 2 + 3 + 4));
  assert.deepEqual(refineItem({ ...h, ores: {} }, sword.uid, rng(), false), {
    ok: false,
    error: "sem-minerio",
  });
  const d = ok(dismantleItem(h, sword.uid));
  assert.equal(d.hero.ores[mat], h.ores[mat]! + 4);
  assert.equal(d.hero.bag.length, 0);
  assert.equal(ok(discardItem({ ...h }, sword.uid)).hero.bag.length, 0);
});

test("Banqueiro: ouro e itens no cofre, com teto e expansão", () => {
  const ring = own({ slot: "anel" });
  let h: HeroV5 = {
    ...createHero("mago", id),
    level: 50,
    gold: 1e6,
    bag: [ring],
  };
  h = ok(bankGold(h, 500)).hero;
  assert.deepEqual([h.gold, h.vault.gold], [1e6 - 500, 500]);
  h = ok(bankGold(h, -200)).hero;
  assert.equal(h.vault.gold, 300);
  assert.equal(bankGold(h, -301).ok, false);
  h = ok(vaultPut(h, ring.uid)).hero;
  assert.equal(h.vault.items.length, 1);
  h = ok(vaultTake(h, ring.uid)).hero;
  assert.equal(h.bag.length, 1);
  const e = ok(vaultExpand(h));
  assert.equal(e.hero.vault.expansions, 1);
  assert.equal(e.cost, 200 * B.lacaioGold(50));
});

test("Dojô: o tempo vira Proficiência ao parar; não começa duas vezes", () => {
  let h = createHero("padre", id);
  h = ok(startDojo(h, 0)).hero;
  assert.equal(startDojo(h, 1).ok, false);
  const hours = B.dojoHoursTo(100);
  const r = ok(stopDojo(h, Math.ceil(hours * 3600 * 1000) + 1000, 0));
  assert.equal(r.hero.proficiency, 100);
  assert.equal(r.hero.dojo, null);
  assert.equal(stopDojo(r.hero, 0, 0).ok, false);
});

test("Mestre: evolui no marco com os pontos gastos", () => {
  const h: HeroV5 = { ...createHero("druida", id), level: 30, job: 20 };
  const r = evolveTier(h);
  // Com pontos sobrando o Mestre recusa; gastos (ou sem onde pôr), evolui.
  if (!r.ok) assert.equal(r.error, "pontos-nao-gastos");
  else assert.equal(r.hero.skills.tier, 2);
});

test("a corrida fecha no herói: XP, ouro, itens até encher a mochila, poções e munição gastas", () => {
  const h: HeroV5 = {
    ...createHero("cacador", id),
    potions: {
      hp: { pequena: 10, media: 0, grande: 0 },
      mp: { pequena: 5, media: 0, grande: 0 },
    },
    ammo: { comum: 50, afiada: 30 },
    bag: Array.from({ length: BAG_SLOTS - 1 }, () => own({ slot: "anel" })),
  };
  const loot = [own({ slot: "colar" }), own({ slot: "colar" })];
  const r = ok(
    applyRun(h, {
      xp: B.xpTotalAt(5),
      jobXp: 0,
      gold: 1234,
      items: loot,
      ores: { [materialOf(1)]: 4 },
      stones: 1,
      potionsUsed: { hp: 3, mp: 1 },
      ammoUsed: 40,
    }),
  );
  assert.equal(r.hero.level, 5);
  assert.equal(r.hero.gold, 1234);
  assert.equal(r.hero.bag.length, BAG_SLOTS);
  assert.deepEqual(
    r.left.map((x) => x.uid),
    [loot[1]!.uid],
  );
  assert.deepEqual(r.hero.potions.hp.pequena, 7);
  assert.deepEqual(r.hero.potions.mp.pequena, 4);
  // A afiada (melhor) sai primeiro.
  assert.deepEqual(r.hero.ammo, { comum: 40, afiada: 0 });
  assert.equal(r.hero.stones, 1);
});

test("estoques separados de poção no motor: vida e mana gastam cada uma a sua", () => {
  const h = {
    ...createHero("mago", id),
    potions: {
      hp: { pequena: 0, media: 0, grande: 0 },
      mp: { pequena: 3, media: 0, grande: 0 },
    },
  };
  const f = heroRunFighter(h);
  const r = fight(
    [f],
    [
      {
        archetype: "chefe",
        level: 1,
        hp: 1e9,
        autoRaw: f.stats.hp * 0.2,
        attacksPerSecond: 1,
      },
    ],
    { maxSeconds: 30, mode: "aleatorio", random: rng(3) },
  );
  // Sem poção de vida ele não bebe vida; a de mana segue a dela.
  assert.equal(r.heroes[0]!.hpPotions, 0);
  assert.ok(r.heroes[0]!.carry.hpPots === 0);
  assert.ok((r.heroes[0]!.carry.mpPots ?? 3) <= 3);
});

// ------------------------------------------------------------ o documento lido do banco

import { checkHero } from "./heroSchema.ts";

test("o herói salvo passa na conferência; documento torto volta com o motivo (sem conserto silencioso)", () => {
  for (const cls of CLASS_IDS) {
    const h = createHero(cls, id);
    const back = JSON.parse(JSON.stringify(h));
    assert.deepEqual(checkHero(back), { ok: true, hero: back }, cls);
  }
  const h = createHero("guerreiro", id);
  const bad = (x: unknown) => {
    const r = checkHero(x);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.reason;
  };
  assert.match(bad({ ...h, v: 4 }), /forma/);
  assert.match(bad({ ...h, attrs: { ...h.attrs, FOR: 300 } }), /atributos/);
  const dup = { ...h.equipment.elmo!, slot: "elmo" as const };
  assert.match(bad({ ...h, bag: [dup] }), /repetido/);
  assert.match(
    bad({
      ...h,
      equipment: {
        ...h.equipment,
        arma: { ...h.equipment.arma!, family: "cajado" },
      },
    }),
    /arma: classe-nao-usa/,
  );
  assert.match(
    bad({
      ...h,
      bag: Array.from({ length: BAG_SLOTS + 1 }, () => own({ slot: "anel" })),
    }),
    /forma: bag/,
  );
});
