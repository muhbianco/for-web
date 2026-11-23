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
  starterInventory,
} from "./inventory.ts";
import { addExperience, expForLevel } from "./progression.ts";
import {
  type RunHero,
  autoEquip,
  RUN,
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

test("a sala cresce com o grupo: monstros comuns em número, o chefe em vida", () => {
  assert.deepEqual(
    stageMonsters("cripta-do-musgo", 0, 1).map((m) => m.id),
    ["rato-do-musgo", "rato-do-musgo", "rato-do-musgo"],
  );
  assert.equal(stageMonsters("cripta-do-musgo", 0, 2).length, 4); // round(3 × 1,3)
  const boss2 = stageMonsters("cripta-do-musgo", 3, 2);
  assert.equal(boss2[0]!.id, "matriarca-do-musgo");
  assert.equal(boss2[0]!.health, 286); // 220 × 1,3
  assert.equal(boss2.filter((m) => m.id === "matriarca-do-musgo").length, 1);
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
  // Level 2: +100% [TFS player.lua:548-556]; taxa 5; stamina cheia: ×1,5.
  const r = runReward(h, result, "vitoria", DEFAULT_RATES)!;
  assert.equal(r.exp, 100 * 5 * 2 * 1.5);
  assert.deepEqual(r.tries, { espada: 20, escudo: 8 });
  assert.equal(r.manaSpent, 12);
  assert.equal(r.gold, 9);
  const tired = runReward(
    { ...h, stamina: 840 },
    result,
    "retirada",
    DEFAULT_RATES,
  )!;
  assert.equal(tired.exp, 100 * 5 * 2 * 0.5);
  assert.equal(
    runReward(h, { ...result, dead: true }, "vitoria", DEFAULT_RATES),
    null,
  );
  assert.equal(runReward(h, result, "derrota", DEFAULT_RATES), null);
  assert.equal(runStaminaCost(61), 2);
  assert.equal(runStaminaCost(60), 1);
});

test("quem não morre nem vence sai pela retirada aos 20 min", () => {
  // Um cavaleiro de punhos e vida enorme contra o Guardião: não cai e não derruba.
  const tank = hero(4, 1, 10, { healthMax: 10_000_000 });
  const r = run("forja-rachada", [
    {
      ...tank,
      inv: { equip: {}, pack: [] },
      gear: { weapon: null, shield: null, armor: {} },
    },
  ]);
  assert.equal(r.outcome, "retirada");
  assert.equal(r.seconds, RUN.maxSeconds);
  assert.equal(r.frames.length, RUN.maxSeconds);
  const reward = runReward(tank, r.members[0]!, r.outcome, DEFAULT_RATES);
  assert.ok(reward, "quem se retira vivo fica com o que ganhou");
});

// Guardas do balanceamento medido em 23/11/2026 (muchat/docs/espaco/jogo/ot): uma mudança
// de ficha ou de regra que mude a curva acende aqui.
test("balanceamento: a primeira dungeon é possível no level 1 com um cavaleiro", () => {
  const k1 = winRate("cripta-do-musgo", [hero(4, 1)]);
  assert.ok(k1 >= 0.6 && k1 <= 0.95, `cavaleiro 1 sozinho: ${k1}`);
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
  addItem(k.inv, 100_000, "pocao-pequena-de-vida", 10);
  addItem(k.inv, 100_000, "pocao-de-vida", 10);
  addItem(k.inv, 100_000, "pocao-forte-de-vida", 5);
  k.supplies = {
    health: { item: null, below: 60 },
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
