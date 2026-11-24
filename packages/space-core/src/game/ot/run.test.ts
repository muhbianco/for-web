import assert from "node:assert/strict";
import test from "node:test";

import {
  type SkillId,
  type VocationId,
  DEFAULT_RATES,
  START,
  VOCATIONS,
} from "./data.ts";
import {
  type Inventory,
  addItem,
  emptyInventory,
  gearOf,
  gearStats,
  withGearStats,
  starterInventory,
} from "./inventory.ts";
import { abilityDef } from "./abilities.ts";
import { type Stats, withInt, withVit } from "./attributes.ts";
import { ITEMS } from "./items.ts";
import {
  applyPotionEvent,
  expAt,
  nextPotion,
  potionCounts,
  potionSizes,
  potionsAt,
} from "./belt.ts";
import { addExperience, expForLevel } from "./progression.ts";
import {
  type RunHero,
  abilityBar,
  autoEquip,
  RUN,
  runExpRate,
  runReward,
  runStaminaCost,
  simulateRun,
  stageMonsters,
} from "./run.ts";

function hero(
  vocation: VocationId,
  level: number,
  skill = 10,
  opts: {
    ml?: number;
    owned?: string[];
    stamina?: number;
    healthMax?: number;
    /** Flechas a mais na mochila (o kit traz 100). */
    arrows?: number;
  } = {},
): RunHero {
  const voc = VOCATIONS[vocation];
  const st = addExperience(
    voc,
    {
      level: 1,
      experience: 0,
      healthMax: START.health,
      manaMax: START.mana,
      cap: START.cap,
    },
    expForLevel(level),
  );
  const skills = {
    punhos: 10,
    maca: 10,
    espada: 10,
    machado: 10,
    distancia: 10,
    escudo: 10,
  } as Record<SkillId, number>;
  if (voc.base === 4) {
    skills.espada = skill;
    skills.escudo = skill;
  }
  if (voc.base === 3) skills.distancia = skill;
  return {
    userId: `u${vocation}-${level}`,
    name: `H${vocation}`,
    vocation,
    level: st.level,
    healthMax: opts.healthMax ?? st.healthMax,
    manaMax: st.manaMax,
    skills,
    magicLevel: opts.ml ?? 0,
    stamina: opts.stamina ?? 2520,
    ...equipped(vocation, st.level, skills, st.manaMax, opts.owned ?? [], {
      arrows: opts.arrows,
      cap: st.cap,
    }),
  };
}

/** O kit com a mochila, os itens a mais e o melhor vestido. */
function equipped(
  vocation: VocationId,
  level: number,
  skills: Record<SkillId, number>,
  manaMax: number,
  owned: string[],
  opts: { arrows?: number; cap?: number } = {},
): { inv: Inventory; gear: RunHero["gear"]; cap: number } {
  const cap = opts.cap ?? 10_000;
  const inv = starterInventory(VOCATIONS[vocation].base, "mochila");
  for (const id of owned) addItem(inv, 100_000, id, 1);
  if (opts.arrows) addItem(inv, 100_000, "flecha", opts.arrows);
  autoEquip(inv, vocation, level, skills, manaMax);
  return { inv, gear: gearOf(inv), cap };
}

const gearOfHero = (
  vocation: VocationId,
  level: number,
  skills: Record<SkillId, number>,
  manaMax: number,
  owned: string[],
) => equipped(vocation, level, skills, manaMax, owned).gear;

const run = (dungeon: string, heroes: RunHero[], seed = 7) =>
  simulateRun({ seed, dungeon, heroes, rateLoot: DEFAULT_RATES.loot });

function winRate(dungeon: string, heroes: RunHero[], n = 120): number {
  let win = 0;
  for (let i = 0; i < n; i++)
    if (run(dungeon, heroes, 5000 + i).outcome === "vitoria") win++;
  return win / n;
}

test("a mesma semente dá a mesma corrida; outra semente, outra", () => {
  const party = [hero(4, 5, 25), hero(2, 5, 10, { ml: 8 })];
  const a = run("cripta-do-musgo", party, 42);
  const b = run("cripta-do-musgo", party, 42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.frames, run("cripta-do-musgo", party, 43).frames);
});

test("quadros contínuos, vida dentro dos limites e o fim coerente", () => {
  const party = [hero(4, 8, 35), hero(1, 8, 10, { ml: 10 })];
  const r = run("cripta-do-musgo", party);
  assert.equal(r.outcome, "vitoria");
  r.frames.forEach((f, i) => {
    assert.equal(f.s, i);
    f.h.forEach((hp, k) => {
      assert.ok(hp >= 0 && hp <= party[k]!.healthMax);
    });
    f.x.forEach((hp) => assert.ok(hp >= 0));
  });
  const last = r.frames[r.frames.length - 1]!;
  assert.equal(last.st, 3, "vitória só depois da sala do chefe");
  assert.ok(last.x.every((hp) => hp === 0));
  assert.equal(r.seconds, r.frames.length);
  // Cada sala começa com um evento "sala".
  const salas = r.frames.flatMap((f) => f.e.filter((e) => e.k === "sala"));
  assert.deepEqual(
    salas.map((e) => (e.k === "sala" ? e.st : -1)),
    [0, 1, 2, 3],
  );
});

test("sozinho e vivo, a experiência crua é a soma dos monstros [TFS creature.cpp:887-910]", () => {
  // Cripta: 3 ratos (15) + 2 ratos e uma ossada (45) + 3 morcegos e uma ossada (65)
  // + Matriarca e 2 ratos (160) = 285.
  const r = run("cripta-do-musgo", [hero(4, 8, 40)]);
  assert.equal(r.outcome, "vitoria");
  assert.equal(r.members[0]!.exp, 285);
  assert.ok(r.members[0]!.tries.espada! > 0, "golpes que ferem dão tentativa");
  assert.ok(
    r.members[0]!.tries.escudo! > 0,
    "bloqueios com escudo dão tentativa",
  );
});

test("grupo que divide recebe a mesma experiência cada um, com o bônus de vocações", () => {
  const party = [hero(4, 8, 35), hero(1, 8, 10, { ml: 10 })];
  const r = run("cripta-do-musgo", party);
  assert.equal(r.outcome, "vitoria");
  assert.equal(r.members[0]!.exp, r.members[1]!.exp);
  // Duas vocações: ×1,3 dividido por 2 [TFS party.lua]; a sala também cresce ×1,3.
  assert.ok(r.members[0]!.exp > 0);
});

test("stamina até 14 h: o corpo sai vazio [TFS default_onDropLoot.lua]", () => {
  const tired = run("cripta-do-musgo", [hero(4, 8, 40, { stamina: 840 })]);
  assert.equal(tired.members[0]!.gold, 0);
  assert.deepEqual(tired.members[0]!.loot, []);
  const rested = run("cripta-do-musgo", [hero(4, 8, 40, { stamina: 841 })]);
  assert.ok(rested.members[0]!.gold > 0);
});

test("a sala cresce com o grupo: monstros comuns em número, o chefe em vida", async () => {
  const { partyScale } = await import("./run.ts");
  assert.deepEqual(
    stageMonsters("cripta-do-musgo", 0, 1).map((m) => m.id),
    ["rato-do-musgo", "rato-do-musgo", "rato-do-musgo"],
  );
  // A Cripta é de iniciante (difficulty.ts): a sala de antes, +40% por herói.
  assert.equal(stageMonsters("cripta-do-musgo", 0, 2).length, 4); // round(3 × 1,4)
  const boss2 = stageMonsters("cripta-do-musgo", 3, 2);
  assert.equal(boss2[0]!.id, "matriarca-do-musgo");
  assert.equal(boss2[0]!.health, 308); // 220 × 1,4
  assert.equal(boss2.filter((m) => m.id === "matriarca-do-musgo").length, 1);
  // As outras (24/11/2026): a sala é do grupo completo (2,2 com 4) e encolhe pouco sem alguém.
  assert.ok(Math.abs(partyScale(4, "forja-rachada") - 2.2) < 1e-9);
  assert.ok(partyScale(3, "forja-rachada") > 2.05 && partyScale(3, "forja-rachada") < 2.2);
  assert.equal(partyScale(1, "forja-rachada"), 1);
});

test("equipamento: a melhor arma pela skill, o level manda e cada vocação na sua", () => {
  const skills = {
    punhos: 10,
    maca: 10,
    espada: 40,
    machado: 10,
    distancia: 10,
    escudo: 10,
  } as Record<SkillId, number>;
  assert.equal(gearOfHero(4, 5, skills, 0, []).weapon, "espada-curta");
  assert.equal(
    gearOfHero(4, 5, skills, 0, ["espada-de-ferro"]).weapon,
    "espada-de-ferro",
  );
  // Espada larga pede level 12.
  assert.equal(
    gearOfHero(4, 5, skills, 0, ["espada-larga", "espada-de-ferro"]).weapon,
    "espada-de-ferro",
  );
  assert.equal(
    gearOfHero(4, 12, skills, 0, ["espada-larga"]).weapon,
    "espada-larga",
  );
  assert.equal(
    gearOfHero(4, 5, skills, 0, ["escudo-de-bronze"]).shield,
    "escudo-de-bronze",
  );
  const archer = gearOfHero(3, 5, skills, 0, ["escudo-de-bronze"]);
  assert.equal(archer.weapon, "arco-de-caca");
  assert.equal(archer.shield, null, "arco usa as duas mãos");
  assert.equal(archer.ammo, "flecha");
  assert.equal(archer.ammoCount, 100, "o kit traz 100 flechas");
  // A besta sem virote não atira: fica o arco; com virote, a besta (30 de ataque).
  assert.equal(
    gearOfHero(3, 5, skills, 0, ["besta-leve"]).weapon,
    "arco-de-caca",
  );
  const bolts = equipped(3, 5, skills, 0, ["besta-leve"]);
  addItem(bolts.inv, 100_000, "virote", 50);
  autoEquip(bolts.inv, 3, 5, skills, 0);
  assert.equal(gearOf(bolts.inv).weapon, "besta-leve");
  assert.equal(gearOf(bolts.inv).ammo, "virote");
  assert.equal(
    gearOfHero(1, 1, skills, 0, ["bastao-de-raiz"]).weapon,
    "varinha-de-faiscas",
  );
  assert.equal(gearOfHero(2, 1, skills, 0, []).weapon, "varinha-de-musgo");
  // Varinha de mana 2 no level 7 com mana de sobra.
  assert.equal(
    gearOfHero(2, 7, skills, 180, ["bastao-de-raiz"]).weapon,
    "bastao-de-raiz",
  );
  assert.equal(
    gearOfHero(4, 5, skills, 0, ["colete-de-escamas"]).armor.corpo,
    "colete-de-escamas",
  );
  assert.equal(
    gearOfHero(1, 5, skills, 0, ["colete-de-escamas"]).armor.corpo,
    "gibao-de-couro",
  );
});

test("recompensa: quem caiu não leva nada; taxa, bônus de level baixo e stamina", () => {
  const h = hero(4, 2, 30);
  const result = {
    dead: false,
    exp: 100,
    tries: { espada: 10, escudo: 4 },
    manaSpent: 6,
    loot: [{ item: "elmo-de-ferro", count: 1 }],
    gold: 9,
    damage: 0,
    healing: 0,
    left: [],
    spent: [],
    inv: emptyInventory(),
    invBare: emptyInventory(),
  };
  // Level 2: +100% [TFS player.lua:548-556]; a taxa padrão (1,5 desde 24/11/2026); stamina cheia: ×1,5.
  const r = runReward(h, result, "vitoria", DEFAULT_RATES)!;
  assert.equal(r.exp, Math.floor(100 * DEFAULT_RATES.exp * 2 * 1.5));
  assert.deepEqual(r.tries, { espada: 20, escudo: 8 });
  assert.equal(r.manaSpent, 12);
  assert.equal(r.gold, 9);
  const tired = runReward(
    { ...h, stamina: 840 },
    result,
    "retirada",
    DEFAULT_RATES,
  )!;
  assert.equal(tired.exp, Math.floor(100 * DEFAULT_RATES.exp * 2 * 0.5));
  assert.equal(
    runReward(h, { ...result, dead: true }, "vitoria", DEFAULT_RATES),
    null,
  );
  assert.equal(runReward(h, result, "derrota", DEFAULT_RATES), null);
  assert.equal(runStaminaCost(61), 2);
  assert.equal(runStaminaCost(60), 1);
});

test("impasse [nosso]: 60 s sem ferir nenhum monstro, o grupo se retira (antes eram 20 min)", () => {
  // Um cavaleiro de punhos e vida enorme contra o Guardião (armadura 25): não cai e não fere.
  const tank = hero(4, 1, 10, { healthMax: 10_000_000 });
  const r = run("forja-rachada", [
    {
      ...tank,
      inv: { equip: {}, pack: [] },
      gear: { weapon: null, shield: null, armor: {} },
    },
  ]);
  assert.equal(r.outcome, "retirada");
  assert.equal(r.seconds, RUN.stallMs / 1000 + 1);
  assert.ok(r.frames.at(-1)!.e.some((e) => e.k === "impasse"));
  const reward = runReward(tank, r.members[0]!, r.outcome, DEFAULT_RATES);
  assert.ok(reward, "quem se retira vivo fica com o que ganhou");
});

test("besta com flecha (munição de outro tipo) luta com os punhos [TFS getWeapon sem munição]", () => {
  const a = hero(3, 9, 30);
  // O caso de produção (23/11/2026): a besta vestida à mão, flechas no lugar da munição.
  a.inv.equip.arma = { item: "besta-leve", count: 1 };
  a.gear = { ...a.gear, weapon: "besta-leve" };
  const r = run("cripta-do-musgo", [a], 4);
  const hits = r.frames.flatMap((f) => f.e).filter((e) => e.k === "golpe" && e.a === 0);
  assert.ok(hits.length > 0, "bate com os punhos");
  assert.ok(r.frames.some((f) => f.e.some((e) => e.k === "municao" && e.a === 0)), "avisa");
  assert.ok((r.members[0]!.tries.punhos ?? 0) > 0, "treina punhos, como no OT");
  assert.equal(r.members[0]!.spent.length, 0, "nenhuma flecha gasta");
  assert.notEqual(r.seconds, RUN.maxSeconds, "não fica preso até o fim");
});

// Guardas do balanceamento medido em 23/11/2026 (muchat/docs/espaco/jogo/ot): uma mudança
// de ficha ou de regra que mude a curva acende aqui.
test("balanceamento: a primeira dungeon é possível no level 1 com um cavaleiro", () => {
  // 24/11/2026: com a esquiva do Ragnarok (level + AGI contra o HIT do monstro) o cavaleiro de
  // level 1 vence quase sempre; a Cripta é a primeira descida.
  const k1 = winRate("cripta-do-musgo", [hero(4, 1)]);
  assert.ok(k1 >= 0.6, `cavaleiro 1 sozinho: ${k1}`);
  const pair = winRate("cripta-do-musgo", [hero(4, 1), hero(1, 1)]);
  assert.ok(pair >= 0.85, `cavaleiro 1 + feiticeiro 1: ${pair}`);
  const mage = winRate("cripta-do-musgo", [hero(1, 1)]);
  assert.ok(mage <= 0.2, `feiticeiro 1 sozinho: ${mage}`);
  const k8 = winRate("cripta-do-musgo", [hero(4, 8, 35)]);
  assert.ok(k8 >= 0.95, `cavaleiro 8: ${k8}`);
});

test("balanceamento: Forja no level 40 com grupo completo", () => {
  const party = [
    hero(4, 40, 75, {
      ml: 7,
      owned: [
        "lamina-da-forja",
        "escudo-da-forja",
        "placa-de-ferreiro",
        "calca-de-malha",
        "elmo-de-aco",
      ],
    }),
    hero(2, 40, 10, { ml: 50, owned: ["cajado-de-pedra", "manto-azul"] }),
    hero(3, 40, 75, {
      ml: 12,
      owned: ["arco-de-guerra", "cota-de-malha", "elmo-de-aco"],
      arrows: 900,
    }),
    hero(1, 40, 10, { ml: 50, owned: ["varinha-ardente", "manto-azul"] }),
  ];
  // 24/11/2026: no level 40 o herói tem 200 pontos de atributo (e a Forja ficou mais dura).
  const builds: Stats[] = [
    { for: 91, vit: 71, agi: 21, des: 21, int: 1, sor: 1 },
    { int: 99, vit: 61, des: 41, for: 1, agi: 1, sor: 1 },
    { des: 99, agi: 51, vit: 51, for: 1, int: 1, sor: 1 },
    { int: 99, des: 61, vit: 41, for: 1, agi: 1, sor: 1 },
  ];
  party.forEach((p, i) => {
    p.stats = builds[i]!;
    p.healthMax = withVit(p.healthMax, p.stats);
    p.manaMax = withInt(p.manaMax, p.stats);
  });
  const w = winRate("forja-rachada", party, 60);
  assert.ok(w >= 0.9, `grupo 40 na Forja: ${w}`);
});

test("loot: o item vai para quem do grupo pode usar; sem ninguém, para o dono do corpo [nosso]", async () => {
  const { lootReceiver } = await import("./run.ts");
  const party = [
    { i: 0, h: { vocation: 4 as VocationId, level: 8 } },
    { i: 1, h: { vocation: 2 as VocationId, level: 8 } },
    { i: 2, h: { vocation: 1 as VocationId, level: 8 } },
  ];
  // O cavaleiro fez mais dano e é o dono do corpo.
  const dmg = [100, 30, 40];
  assert.equal(lootReceiver("bastao-de-raiz", party, dmg, 0), 1, "do druida");
  assert.equal(
    lootReceiver("varinha-de-brasa", party, dmg, 0),
    2,
    "do feiticeiro",
  );
  assert.equal(
    lootReceiver("tunica-de-linho", party, dmg, 0),
    2,
    "dos magos: o que bateu mais",
  );
  assert.equal(lootReceiver("escudo-de-bronze", party, dmg, 0), 0);
  // Ninguém pode usar (arco de arqueiro sem arqueiro no grupo): fica com o dono.
  assert.equal(lootReceiver("besta-leve", party, dmg, 0), 0);
  // O level conta: a varinha de brasa pede 7.
  const low = [
    { i: 0, h: { vocation: 4 as VocationId, level: 3 } },
    { i: 1, h: { vocation: 1 as VocationId, level: 3 } },
  ];
  assert.equal(lootReceiver("varinha-de-brasa", low, [50, 10], 0), 0);
});

test("munição: cada tiro gasta uma; repõe da mochila; sem flecha o arco para [TFS weapons.xml removecount]", () => {
  const a = hero(3, 8, 30, { arrows: 30 });
  // Só 20 no lugar e 30 na mochila.
  a.inv.equip.municao!.count = 20;
  const r = run("cripta-do-musgo", [a, hero(4, 8, 35)], 11);
  const shots = r.frames
    .flatMap((f) => f.e)
    .filter((e) => e.k === "golpe" && e.a === 0).length;
  const spent =
    r.members[0]!.spent.find((x) => x.item === "flecha")?.count ?? 0;
  assert.equal(spent, Math.min(shots, 50), "um por tiro, certo ou não");
  const left = (inv: Inventory) =>
    (inv.equip.municao?.item === "flecha" ? inv.equip.municao.count : 0) +
    inv.pack
      .filter((x) => x.item === "flecha")
      .reduce((n, x) => n + x.count, 0);
  assert.equal(
    left(r.members[0]!.invBare),
    50 - spent,
    "o gasto vale até para quem caiu",
  );
  if (shots >= 50) {
    assert.ok(
      r.frames.some((f) => f.e.some((e) => e.k === "municao" && e.a === 0)),
      "avisa quando acaba",
    );
  }
});

test("loot pela regra do OT: o que não cabe fica no corpo; quem cai fica só com o gasto", () => {
  const k = hero(4, 8, 35);
  // Mochila cheia de itens que não empilham.
  k.inv.pack = [];
  for (let i = 0; i < 20; i++)
    k.inv.pack.push({ item: "elmo-de-ferro", count: 1 });
  let sawLeft = false;
  for (let seed = 1; seed <= 20 && !sawLeft; seed++) {
    const r = run("cripta-do-musgo", [k], seed);
    const m = r.members[0]!;
    assert.ok(m.inv.pack.length <= 20);
    assert.deepEqual(
      m.invBare.pack,
      k.inv.pack,
      "sem loot na cópia de quem cai",
    );
    if (m.left.length > 0) {
      sawLeft = true;
      assert.ok(
        r.frames.some((f) => f.e.some((e) => e.k === "deixado")),
        "o registro conta",
      );
    }
  }
  assert.ok(sawLeft, "em 20 corridas, algo ficou no corpo");
});

test("anel e colar: o tempo do anel corre na dungeon; o colar gasta uma carga por golpe absorvido", () => {
  const k = hero(4, 8, 35);
  k.inv.equip.anel = { item: "anel-do-gume", count: 1, duration: 5 };
  k.inv.equip.colar = { item: "amuleto-de-pedra", count: 1, charges: 5 };
  const r = run("cripta-do-musgo", [k], 3);
  const m = r.members[0]!;
  assert.ok(r.seconds > 5);
  assert.equal(m.inv.equip.anel, undefined, "5 s de anel acabam");
  assert.equal(m.invBare.equip.anel, undefined);
  assert.ok(m.spent.some((x) => x.item === "anel-do-gume"));
  const hits = r.frames
    .flatMap((f) => f.e)
    .filter(
      (e) => (e.k === "golpe" || e.k === "magia") && e.b === 0 && e.a >= 100,
    ).length;
  if (hits >= 20) {
    assert.equal(m.inv.equip.colar, undefined, "5 cargas acabam");
    assert.ok(
      r.frames.some((f) =>
        f.e.some((e) => e.k === "gasto" && e.item === "amuleto-de-pedra"),
      ),
    );
  }
});

test("poções: abaixo do limite bebe a que mais cura, uma por segundo; o frasco volta [TFS potions.lua]", () => {
  const k = hero(4, 1, 10);
  // Capacidade de sobra: o loot não toma o lugar do frasco (que só volta se couber).
  k.cap = 100_000;
  addItem(k.inv, 100_000, "pocao-pequena-de-vida", 10);
  addItem(k.inv, 100_000, "pocao-de-vida", 30);
  addItem(k.inv, 100_000, "pocao-forte-de-vida", 5);
  k.supplies = {
    health: { item: null, below: 90 },
    mana: { item: null, below: 0 },
  };
  const r = run("cripta-do-musgo", [k], 3);
  const drinks = r.frames.flatMap((f) =>
    f.e.filter((e) => e.k === "pocao").map((e) => ({ s: f.s, e })),
  );
  const m = r.members[0]!;
  const used = m.spent.find((x) => x.item === "pocao-de-vida")?.count ?? 0;
  assert.ok(used > 0, "bebeu alguma");
  assert.equal(drinks.length, used, "cada gole gasta uma");
  assert.ok(
    drinks.every((d) => d.e.k === "pocao" && d.e.item === "pocao-de-vida"),
    "a forte pede level 50: bebe a de vida, que cura mais que a pequena",
  );
  const seconds = drinks.map((d) => d.s);
  assert.equal(new Set(seconds).size, seconds.length, "uma por segundo");
  const flasks = m.inv.pack
    .filter((x) => x.item === "frasco-vazio")
    .reduce((n, x) => n + x.count, 0);
  assert.equal(flasks, used, "o frasco vazio volta para a mochila");
  // Desligado (0%): não bebe.
  const off = hero(4, 8, 35);
  addItem(off.inv, 100_000, "pocao-de-vida", 10);
  off.supplies = {
    health: { item: null, below: 0 },
    mana: { item: null, below: 0 },
  };
  const r2 = run("cripta-do-musgo", [off], 3);
  assert.ok(!r2.frames.some((f) => f.e.some((e) => e.k === "pocao")));
});

test("filtro de loot: o que o herói não pega fica no corpo, sem contar como falta de espaço", () => {
  const k = hero(4, 8, 35);
  k.lootSkip = ["elmo-de-ferro", "espada-de-ferro", "flecha"];
  for (let seed = 1; seed <= 30; seed++) {
    const m = run("cripta-do-musgo", [k], seed).members[0]!;
    for (const id of k.lootSkip)
      assert.ok(!m.loot.some((l) => l.item === id), `${id} na semente ${seed}`);
    assert.ok(!m.left.some((l) => k.lootSkip!.includes(l.item)));
  }
});

test("troca de alvo e desafio [TFS onThinkTarget, challenge.lua]: na Cripta (chance 0) o cavaleiro segura tudo; na Forja os monstros trocam e o desafio os puxa de volta por 8 s", async () => {
  const { abilitiesOf } = await import("./abilities.ts");
  // Desde 24/11/2026 o desafio é uma das 4 habilidades fixas do cavaleiro, de saída.
  assert.ok(abilitiesOf(4).some((a) => a.id === "desafio"));
  // Cripta: os monstros comuns (troca 0%) não largam o cavaleiro. A matriarca, na última sala,
  // troca 5% a cada 2 s (TFS), então fica de fora: com ela vale a sorte da semente.
  const crypt = run("cripta-do-musgo", [hero(4, 8, 35), hero(3, 8, 30)], 5);
  const singleOnArcher = crypt.frames.flatMap((f) =>
    f.st === 3
      ? []
      : f.e.filter((e) => e.k === "golpe" && e.a >= 100 && e.b === 1),
  );
  assert.equal(singleOnArcher.length, 0);
  // Forja com o Campeão (8): o desafio sai e, nos 8 s seguintes, golpe corpo a corpo só nele.
  const party = (knight: VocationId) => [
    hero(knight, 40, 75, {
      ml: 7,
      owned: [
        "lamina-da-forja",
        "escudo-da-forja",
        "placa-de-ferreiro",
        "elmo-de-aco",
      ],
    }),
    // 24/11/2026: magic level 15 (com o 50, a varinha nova limpava a Forja antes de um golpe).
    hero(2, 40, 10, { ml: 15, owned: ["cajado-de-pedra", "manto-azul"] }),
    hero(1, 40, 10, { ml: 15, owned: ["varinha-ardente", "manto-azul"] }),
  ];
  let casts = 0;
  let checked = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = run("forja-rachada", party(8), seed);
    r.frames.forEach((f, i) => {
      if (!f.e.some((e) => e.k === "desafio")) return;
      casts++;
      // Nos segundos seguintes (dentro dos 8 s), o corpo a corpo dos monstros é no cavaleiro.
      // A trava vence no 8º pensamento do monstro (o do próprio segundo conta): até o 6º seguinte.
      // Só a mesma sala: os monstros da sala seguinte não foram desafiados.
      for (const g of r.frames.slice(i + 1, i + 7).filter((g) => g.st === f.st))
        for (const e of g.e)
          if (e.k === "golpe" && e.a >= 100) {
            checked++;
            assert.equal(e.b, 0, `semente ${seed}, segundo ${g.s}`);
          }
    });
  }
  assert.ok(casts > 0, "o desafio saiu");
  assert.ok(checked > 0);
  // Sem o desafio (o cavaleiro sem mana) os monstros trocam e alguém atrás leva golpe corpo a corpo.
  const noChallenge = () => {
    const p = party(4);
    p[0]!.manaMax = 0;
    return p;
  };
  let backHits = 0;
  for (let seed = 1; seed <= 20; seed++)
    for (const f of run("forja-rachada", noChallenge(), seed).frames)
      backHits += f.e.filter(
        (e) => e.k === "golpe" && e.a >= 100 && e.b > 0,
      ).length;
  assert.ok(backHits > 0, "a troca de alvo do TFS chega aos de trás");
});

test("cinto de poções: a contagem segue a corrida e a próxima poção é a que a corrida bebe", () => {
  let looted = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const k = hero(4, 6, 30);
    addItem(k.inv, 100_000, "pocao-pequena-de-vida", 6);
    addItem(k.inv, 100_000, "pocao-de-vida", 4);
    addItem(k.inv, 100_000, "pocao-forte-de-vida", 3);
    addItem(k.inv, 100_000, "pocao-de-mana", 5);
    k.supplies = {
      health: { item: null, below: 80 },
      mana: { item: null, below: 60 },
    };
    const r = run("toca-dos-javalis", [k], seed);
    const base = VOCATIONS[k.vocation].base;
    // Acontecimento por acontecimento: antes de cada gole, a escolha bate com o que bebeu.
    const counts = potionsAt([k], [], -1);
    for (const f of r.frames)
      for (const ev of f.e) {
        if (ev.k === "pocao") {
          const kind = ev.mana ? "mana" : "health";
          assert.equal(
            nextPotion(kind, counts[0]!, k.supplies[kind], base, k.level),
            ev.item,
            `seed ${seed}, segundo ${f.s}`,
          );
        }
        if (ev.k === "loot" && ev.item.startsWith("pocao")) looted++;
        applyPotionEvent(counts, ev);
      }
    // No fim, o mesmo que a mochila da corrida.
    const end = potionsAt([k], r.frames, r.frames.length - 1);
    assert.deepEqual(end, counts);
    const real = potionCounts(r.members[0]!.inv.pack);
    for (const id of new Set([...Object.keys(real), ...Object.keys(end[0]!)]))
      assert.equal(end[0]![id] ?? 0, real[id] ?? 0, `seed ${seed}: ${id}`);
  }
  assert.ok(looted > 0, "alguma corrida pegou poção no loot");
  // Sem poção que sirva, ou com o limite em "nunca": nada a beber.
  const rule = { item: null, below: 50 };
  assert.equal(nextPotion("health", { "pocao-forte-de-vida": 3 }, rule, 1, 80), null);
  assert.equal(
    nextPotion("health", { "pocao-forte-de-vida": 3 }, rule, 4, 80),
    "pocao-forte-de-vida",
  );
  assert.equal(
    nextPotion("health", { "pocao-de-vida": 3 }, { item: null, below: 0 }, 4, 8),
    null,
  );
  assert.equal(
    nextPotion(
      "health",
      { "pocao-de-vida": 3, "pocao-pequena-de-vida": 1 },
      { item: "pocao-pequena-de-vida", below: 50 },
      4,
      8,
    ),
    "pocao-pequena-de-vida",
  );
  assert.deepEqual(
    potionSizes("health").map((d) => d.id),
    [
      "pocao-pequena-de-vida",
      "pocao-de-vida",
      "pocao-forte-de-vida",
      "pocao-grande-de-vida",
      "pocao-suprema-de-vida",
    ],
  );
  assert.deepEqual(
    potionSizes("mana").map((d) => d.id),
    [
      "pocao-de-mana",
      "pocao-forte-de-mana",
      "pocao-grande-de-mana",
      "pocao-suprema-de-mana",
    ],
  );
});

test("experiência na tela: a soma dos abates bate com a da corrida e a taxa dá a recompensa", () => {
  const parties: RunHero[][] = [
    [hero(4, 6, 30)],
    [hero(4, 10, 40), hero(1, 10, 10, { ml: 12 }), hero(3, 10, 40)],
  ];
  for (const party of parties)
    for (let seed = 1; seed <= 15; seed++) {
      const r = run("toca-dos-javalis", party, seed);
      const raw = expAt(party.length, r.frames, r.frames.length - 1);
      assert.deepEqual(
        raw,
        r.members.map((m) => m.exp),
        `seed ${seed}, grupo de ${party.length}`,
      );
      party.forEach((h, i) => {
        const reward = runReward(h, r.members[i]!, r.outcome, DEFAULT_RATES);
        if (!reward) return;
        const shown = Math.floor(raw[i]! * runExpRate(h, DEFAULT_RATES));
        assert.ok(Math.abs(shown - reward.exp) <= 1, `${shown} x ${reward.exp}`);
      });
    }
});

test("itens com atributos: todo equipamento fora do kit inicial soma atributos, e a soma entra no herói", () => {
  const wearable = ["arma", "escudo", "cabeca", "corpo", "pernas", "pes"];
  for (const d of Object.values(ITEMS)) {
    if (!d.slot || !wearable.includes(d.slot) || d.starter) continue;
    assert.ok(d.stats && Object.keys(d.stats).length > 0, `${d.id} sem atributos`);
  }
  // O vestido soma; o da mochila não.
  const inv = emptyInventory();
  inv.equip.cabeca = { item: "bandana", count: 1 };
  inv.equip.anel = { item: "anel-do-guerreiro", count: 1 };
  inv.pack.push({ item: "anel-de-forca", count: 1 });
  assert.deepEqual(gearStats(inv), { for: 4, vit: 1 });
  const base: Stats = { for: 10, agi: 1, vit: 5, int: 1, des: 1, sor: 1 };
  assert.deepEqual(withGearStats(base, gearStats(inv)), {
    for: 14,
    agi: 1,
    vit: 6,
    int: 1,
    des: 1,
    sor: 1,
  });
});

test("escolha automática: com a armadura igual, fica o item com o atributo que a vocação usa", () => {
  const skills = hero(4, 6, 20).skills;
  const inv = starterInventory(VOCATIONS[4].base, "mochila");
  addItem(inv, 100_000, "sandalias", 1);
  autoEquip(inv, 4, 6, skills, 0);
  assert.equal(inv.equip.pes?.item, "sandalias", "AGI conta para o cavaleiro");
  // Armadura maior ainda ganha de um atributo: botas de viajante (2, AGI+1) > sandálias (1, AGI+1).
  addItem(inv, 100_000, "botas-de-viajante", 1);
  autoEquip(inv, 4, 6, skills, 0);
  assert.equal(inv.equip.pes?.item, "botas-de-viajante");
  // O mago leva o chapéu de aprendiz (INT) no lugar do capuz de couro (mesma armadura).
  const mage = starterInventory(VOCATIONS[1].base, "mochila");
  addItem(mage, 100_000, "chapeu-de-aprendiz", 1);
  autoEquip(mage, 1, 1, skills, 50);
  assert.equal(mage.equip.cabeca?.item, "chapeu-de-aprendiz");
});

test("o arqueiro usa a Flecha carregada: ela rende mais por uso que a Rajada dupla, que só preenche", () => {
  // 24/11/2026: a Flecha carregada nunca saía (rendia menos que a Rajada, sempre pronta a cada 2 s).
  const used = new Set<string>();
  for (const seed of [1, 2, 3]) {
    const archer = hero(3, 40, 60);
    const r = run("mina-assombrada", [archer], seed);
    for (const f of r.frames)
      for (const e of f.e) if (e.k === "magia" && e.a === 0 && e.s) used.add(e.s);
  }
  assert.ok(used.has("rajada-dupla"), [...used].join(","));
  assert.ok(used.has("flecha-carregada"), [...used].join(","));
  const charge = abilityDef("flecha-carregada")!;
  const strafe = abilityDef("rajada-dupla")!;
  const avg = (d: typeof charge) =>
    d.formula.type === "golpe" ? (d.formula.min + d.formula.max) / 2 : 0;
  // A Rajada com a Tripla (eco de 50%) ainda rende menos que a Flecha carregada sem nada.
  assert.ok(avg(charge) > avg(strafe) * 1.5, `${avg(charge)} x ${avg(strafe)}`);
});

test("todas as habilidades de ataque e de área saem no quarteto (nenhum botão parado)", () => {
  // 24/11/2026: o Giro da lâmina (115 de mana) não cabia na mana do cavaleiro e a Chuva de
  // flechas perdia sempre para os tiros de um alvo. As de reação (curas, Desafio) dependem
  // do dano e ficam de fora; o feiticeiro escolhe raio ou chama pelo elemento do monstro.
  const used: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  for (const seed of [1, 2, 3]) {
    // Level 20: o cavaleiro tem ~95 de mana; o arqueiro com a árvore cheia nos três tiros.
    const archer = hero(3, 20, 50);
    archer.tree = {
      "rajada-dupla.forca": 5, "rajada-dupla.perfurante": 1, "rajada-dupla.forca2": 5, "rajada-dupla.tripla": 1,
      "flecha-carregada.forca": 5, "flecha-carregada.trespassar": 1, "flecha-carregada.forca2": 5, "flecha-carregada.impacto": 1,
      "chuva-de-flechas.forca": 5, "chuva-de-flechas.farpas": 1, "chuva-de-flechas.forca2": 5, "chuva-de-flechas.tormenta": 1,
    };
    const party = [hero(4, 20, 50), archer, hero(2, 20, 0, { ml: 20 }), hero(1, 20, 0, { ml: 20 })];
    const r = run("mina-assombrada", party, seed);
    for (const f of r.frames)
      for (const e of f.e) if (e.k === "magia" && e.s && e.a < 4) used[e.a]!.add(e.s);
  }
  const want: [number, string[]][] = [
    [0, ["golpe-brutal", "giro-da-lamina"]],
    [1, ["rajada-dupla", "chuva-de-flechas", "flecha-carregada", "concentracao"]],
    [2, ["golpe-de-gelo", "onda-de-gelo"]],
    [3, ["onda-de-fogo"]],
  ];
  for (const [i, ids] of want)
    for (const id of ids) assert.ok(used[i]!.has(id), `${id}: ${[...used[i]!].join(",")}`);
  assert.ok(used[3]!.has("golpe-de-raio") || used[3]!.has("golpe-de-chama"));
});

test("a cura da habilidade vem antes da poção no mesmo tique", () => {
  // 24/11/2026: a poção (abaixo de 50%) vinha antes e a Atadura (também 50%) não precisava sair.
  let checked = 0;
  for (const seed of [1, 2, 3, 4]) {
    const k = hero(4, 34, 50);
    addItem(k.inv!, 100_000, "pocao-de-vida", 30);
    const r = run("mina-assombrada", [k], seed);
    const firstPotion = r.frames.findIndex((f) => f.e.some((e) => e.k === "pocao" && e.a === 0 && !e.mana));
    if (firstPotion < 0) continue;
    const firstHeal = r.frames.findIndex((f) => f.e.some((e) => e.k === "magia" && e.a === 0 && e.s === "atadura"));
    assert.ok(firstHeal >= 0 && firstHeal <= firstPotion, `cura ${firstHeal}, poção ${firstPotion}`);
    if (firstHeal === firstPotion) {
      const e = r.frames[firstPotion]!.e;
      const h = e.findIndex((x) => x.k === "magia" && x.a === 0 && x.s === "atadura");
      const p = e.findIndex((x) => x.k === "pocao" && x.a === 0);
      assert.ok(h < p, "no mesmo quadro, a cura primeiro");
    }
    checked++;
  }
  assert.ok(checked > 0, "alguma corrida precisou de poção");
});

test("a habilidade sai com o custo (com Economia) mais uma cura guardada, e a barra mostra isso", () => {
  // 24/11/2026: o cavaleiro de level 27 com Economia 3 no Golpe brutal (21 de mana) só usava
  // com 47 (duas Ataduras ou 20% da mana guardados). Agora guarda uma cura, a mais cara.
  const knight = hero(4, 27, 50);
  // 24/11/2026: em ups (5 = o cheio de antes: −30% de mana).
  knight.tree = { "golpe-brutal.forca": 1, "golpe-brutal.economia": 5 };
  const bar = Object.fromEntries(abilityBar(knight).map((s) => [s.id, s]));
  assert.equal(bar["golpe-brutal"]!.mana, 21);
  assert.equal(bar["golpe-brutal"]!.at, 21 + 10, "o custo e uma Atadura");
  assert.equal(bar["atadura"]!.at, 10, "a cura não guarda nada");
  const druid = Object.fromEntries(abilityBar(hero(2, 27, 0, { ml: 30 })).map((s) => [s.id, s]));
  assert.equal(druid["golpe-de-gelo"]!.at, 20 + 120, "o druida guarda a Cura do companheiro");
  const archer = Object.fromEntries(abilityBar(hero(3, 27, 50)).map((s) => [s.id, s]));
  // 24/11/2026: a Rajada passou a custar 30 (tiro especial de recarga longa).
  assert.equal(archer["rajada-dupla"]!.at, 30, "sem cura, nada guardado");
});

test("resistência física e mágica (24/11/2026): o elemento não importa; itens protegem do físico ou da magia", async () => {
  const { heroElementMod, monsterResist, itemAbsorb } = await import("./index.ts");
  const { MONSTERS } = await import("./monsters.ts");
  const all = Object.values(MONSTERS);
  // Monstro: a mágica é a média nos seis elementos mágicos; qualquer magia leva a mesma.
  const fire = all.find((m) => (m.elements?.fogo ?? 0) >= 100)!;
  const r = monsterResist(fire);
  for (const el of ["fogo", "gelo", "energia", "terra", "morte", "sagrado"] as const)
    assert.equal(heroElementMod(fire, el), r.magia, el);
  assert.ok(r.magia > 0 && r.magia < 100, `${fire.id} ${r.magia}`);
  const hard = all.find((m) => (m.elements?.fisico ?? 0) > 0)!;
  assert.equal(heroElementMod(hard, "fisico"), hard.elements!.fisico);
  // Itens: o amuleto de +20% terra e -10% fogo protege 10% de toda magia, sem o lado ruim.
  assert.deepEqual(itemAbsorb(ITEMS["amuleto-de-musgo"]!), { fisico: 0, magia: 10 });
  assert.deepEqual(itemAbsorb(ITEMS["anel-da-firmeza"]!), { fisico: 20, magia: 20 });
  assert.deepEqual(itemAbsorb(ITEMS["amuleto-de-pedra"]!), { fisico: 80, magia: 40 });
  // Na Cidadela de Cinzas (fogo), a Onda de fogo do feiticeiro sai (antes: nenhuma vez), e o
  // Golpe de raio e o de chama, iguais agora, se revezam.
  const used = new Map<string, number>();
  for (const seed of [1, 2, 3]) {
    const run1 = run("cidadela-de-cinzas", [hero(4, 60, 80), hero(1, 60, 0, { ml: 60 })], seed);
    for (const f of run1.frames) {
      const once = new Set<string>();
      for (const e of f.e) if (e.k === "magia" && e.a === 1 && e.s) once.add(e.s);
      for (const id of once) used.set(id, (used.get(id) ?? 0) + 1);
    }
  }
  assert.ok((used.get("onda-de-fogo") ?? 0) > 0, [...used.keys()].join(","));
  const raio = used.get("golpe-de-raio") ?? 0;
  const chama = used.get("golpe-de-chama") ?? 0;
  assert.ok(raio > 0 && chama > 0 && Math.abs(raio - chama) <= Math.max(raio, chama) / 2, `raio ${raio}, chama ${chama}`);
});

test("Proteção do cavaleiro (24/11/2026): de escudo, ele toma parte do golpe num aliado; sem ele, ninguém", async () => {
  const { RUN } = await import("./run.ts");
  const share = (escudo: number) =>
    Math.max(0, Math.min(RUN.protect.max, ((escudo - RUN.protect.from) / RUN.protect.span) * RUN.protect.max));
  // Nada até o escudo 40; o máximo (50% do golpe) no 120.
  assert.equal(share(40), 0);
  assert.equal(share(120), 0.5);
  let covered = 0;
  for (const seed of [1, 2, 3]) {
    const r = run("trono-do-vazio", [hero(4, 90, 100), hero(2, 90, 0, { ml: 70 })], seed);
    for (const f of r.frames)
      for (const e of f.e)
        if (e.k === "magia" && e.s === "protecao") {
          assert.equal(e.b, 0, "quem protege é o cavaleiro");
          covered += e.v;
        }
  }
  assert.ok(covered > 0, "o cavaleiro tomou parte dos golpes no druida");
  const alone = run("trono-do-vazio", [hero(3, 90, 90), hero(2, 90, 0, { ml: 70 })], 1);
  assert.ok(!alone.frames.some((f) => f.e.some((e) => e.k === "magia" && e.s === "protecao")));
});
