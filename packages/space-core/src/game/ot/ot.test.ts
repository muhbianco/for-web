import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../rng.ts";
import {
  DEFAULT_RATES,
  TRAINING,
  VOCATIONS,
  addExperience,
  addManaSpent,
  addSkillTries,
  bankAfter,
  bankNow,
  blockHit,
  canShare,
  distanceHitChance,
  distanceSkillPoint,
  expForLevel,
  freshBlood,
  maxWeaponDamage,
  meleeSkillPoint,
  minShareLevel,
  monsterMeleeMax,
  normalRandom,
  onOwnBlock,
  onTargetBlock,
  playerDefense,
  regainBlocks,
  regenStamina,
  reqMana,
  reqSkillTries,
  rollLoot,
  sessionSeconds,
  settleSession,
  sharedExperience,
  sharedMultiplier,
  staminaMultiplier,
  startSession,
  trainingDelta,
  trainingGain,
} from "./index.ts";

// Valores-ouro calculados à mão das fórmulas do TFS (commit 1561fa91), com a linha citada
// em cada módulo. Cavaleiro = Knight (4), Arqueiro = Paladin (3), Feiticeiro = Sorcerer (1).
const CAV = VOCATIONS[4];
const ARQ = VOCATIONS[3];
const FEI = VOCATIONS[1];
const ARQUIMAGO = VOCATIONS[5];
const H = 3600;

test("tentativas por skill: base × multiplicador^(level − 11), truncado", () => {
  assert.equal(reqSkillTries(CAV, "espada", 11), 50);
  assert.equal(reqSkillTries(CAV, "espada", 12), 55);
  assert.equal(reqSkillTries(CAV, "espada", 20), 117); // 50 × 1,1^9 = 117,897
  assert.equal(reqSkillTries(CAV, "espada", 10), 45); // 50 / 1,1
  assert.equal(reqSkillTries(ARQ, "distancia", 12), 33);
  assert.equal(reqSkillTries(FEI, "espada", 13), 200);
  assert.equal(reqSkillTries(CAV, "escudo", 11), 100);
});

test("mana por magic level: 1600 × multiplicador^(M − 1)", () => {
  assert.equal(reqMana(FEI, 0), 0);
  assert.equal(reqMana(FEI, 1), 1600);
  assert.equal(reqMana(FEI, 2), 1760);
  assert.equal(reqMana(FEI, 10), 3772); // 1600 × 1,1^9 = 3772,7
  assert.equal(reqMana(CAV, 2), 4800);
});

test("subir skill: o resto passa para o nível seguinte, como no TFS", () => {
  assert.deepEqual(addSkillTries(CAV, "espada", { level: 10, tries: 0 }, 50), {
    level: 11,
    tries: 0,
  });
  assert.deepEqual(addSkillTries(CAV, "espada", { level: 10, tries: 0 }, 104), {
    level: 11,
    tries: 54,
  });
  assert.deepEqual(addSkillTries(CAV, "espada", { level: 10, tries: 0 }, 105), {
    level: 12,
    tries: 0,
  });
  assert.deepEqual(addSkillTries(CAV, "espada", { level: 10, tries: 0 }, 0), {
    level: 10,
    tries: 0,
  });
  assert.deepEqual(
    addManaSpent(FEI, { level: 0, manaSpent: 0 }, 1600 + 1760 + 7),
    { level: 2, manaSpent: 7 },
  );
});

test("somar em pedaços dá o mesmo que somar de uma vez", () => {
  const rng = new Rng(7);
  let a = { level: 10, tries: 0 };
  let total = 0;
  for (let i = 0; i < 500; i++) {
    const n = rng.int(0, 400);
    total += n;
    a = addSkillTries(CAV, "machado", a, n);
  }
  assert.deepEqual(
    a,
    addSkillTries(CAV, "machado", { level: 10, tries: 0 }, total),
  );
});

test("experiência por level: ((L−6)·L+17)·L−12)/6 × 100", () => {
  assert.equal(expForLevel(1), 0);
  assert.equal(expForLevel(2), 100);
  assert.equal(expForLevel(8), 4_200);
  assert.equal(expForLevel(20), 98_800);
  assert.equal(expForLevel(100), 15_694_800);
  assert.equal(expForLevel(200), 129_389_800);
});

test("subir de level dá vida, mana e capacidade da vocação", () => {
  const s = addExperience(
    CAV,
    { level: 1, experience: 0, healthMax: 150, manaMax: 0, cap: 400 },
    4_200,
  );
  assert.deepEqual(s, {
    level: 8,
    experience: 4_200,
    healthMax: 255,
    manaMax: 35,
    cap: 575,
    gained: 7,
  });
  const t = addExperience(CAV, s, 99);
  assert.equal(t.level, 8);
  assert.equal(t.gained, 0);
});

test("dummy: regra do treino offline do TFS, com a taxa do servidor", () => {
  const r = DEFAULT_RATES; // skill 2, magia 2
  // corpo a corpo: 3600 s / 2 s / 2 = 900 tentativas × 2
  assert.deepEqual(trainingGain(CAV, "espada", H, r), {
    main: 1800,
    escudo: 1800,
  });
  // distância: / 4
  assert.deepEqual(trainingGain(ARQ, "distancia", H, r), {
    main: 900,
    escudo: 1800,
  });
  // magia sem promoção: mana do Feiticeiro (5) / (ticks do Arquimago 2 × 2) = 1,25 por s
  assert.deepEqual(trainingGain(FEI, "magia", H, r), {
    main: 9_000,
    escudo: 1800,
  });
  // promovido: 10 / 4 = 2,5 por s
  assert.deepEqual(trainingGain(ARQUIMAGO, "magia", H, r), {
    main: 18_000,
    escudo: 1800,
  });
  assert.deepEqual(trainingGain(CAV, "espada", 0, r), { main: 0, escudo: 0 });
});

test("dummy: creditar em pedaços não perde o resto da truncagem", () => {
  const rng = new Rng(11);
  let at = 0;
  let main = 0;
  let escudo = 0;
  while (at < 5 * H) {
    const next = at + rng.int(1, 97);
    const d = trainingDelta(ARQ, "distancia", at, next, DEFAULT_RATES);
    main += d.main;
    escudo += d.escudo;
    at = next;
  }
  const all = trainingGain(ARQ, "distancia", at, DEFAULT_RATES);
  assert.equal(main, all.main);
  assert.equal(escudo, all.escudo);
});

test("dummy: saldo de 12 h, sessão limitada ao saldo, menos de 60 s não rende nem gasta", () => {
  const full = { ms: TRAINING.maxBankMs, at: 0 };
  const s = startSession(full, "espada", 0);
  assert.equal(s.budgetMs, 12 * H * 1000);
  // 2 h treinando: sobram 10 h; mais 3 h fora: enche até o teto de 12 h
  const after = bankAfter(s, 2 * H * 1000);
  assert.equal(after.ms, 10 * H * 1000);
  assert.equal(bankNow(after, 5 * H * 1000), 12 * H * 1000);
  // a sessão para no fim do orçamento
  const short = startSession({ ms: 30 * 60 * 1000, at: 0 }, "espada", 0);
  assert.equal(sessionSeconds(short, 5 * H * 1000), 30 * 60);
  // 59 s: nada
  const quick = startSession(full, "espada", 0);
  const q = settleSession(CAV, quick, 59_000, DEFAULT_RATES);
  assert.deepEqual(q.gain, { main: 0, escudo: 0 });
  assert.equal(q.spentMs, 0);
  assert.equal(bankAfter(quick, 59_000).ms, full.ms);
  // 1 h fechada de uma vez
  const one = settleSession(CAV, s, H * 1000, DEFAULT_RATES);
  assert.deepEqual(one.gain, { main: 1800, escudo: 1800 });
});

test("dano máximo do golpe e golpe de monstro", () => {
  // level 8, punhos 10, ataque 7: round(1 + (3,5 × 2,333 × 1,03)/1) = round(9,41)
  assert.equal(maxWeaponDamage(8, 10, 7, 1.0), 9);
  // level 100, skill 80, ataque 50, equilibrado: round(20 + 21 × 16,667 × 1,03 / 1,2) = round(320,4)
  assert.equal(maxWeaponDamage(100, 80, 50, 1.2), 320);
  assert.equal(monsterMeleeMax(30, 25), 50);
});

test("defesa e chance de acerto à distância", () => {
  // (50/4 + 2,23) × 30 × 0,15 = 66,285
  assert.equal(playerDefense(50, 30, "defesa", 1, CAV), 66);
  assert.equal(playerDefense(0, 30, "ataque", 1, CAV), 1);
  assert.equal(distanceHitChance(50, 3, 90), 90);
  assert.equal(distanceHitChance(20, 4, 75), 28);
  assert.equal(distanceHitChance(30, 2, 75), 75); // 28 × 2,4f = 67,2 → 67 + 8
  assert.equal(distanceHitChance(40, 9, 75, 33), 33);
});

test("segurar o golpe: defesa com bloqueio disponível, depois armadura", () => {
  const rng = new Rng(3);
  assert.deepEqual(
    blockHit(rng, {
      damage: 10,
      defense: 0,
      armor: 0,
      checkDefense: false,
      checkArmor: true,
      blocks: 2,
    }),
    {
      damage: 10,
      type: "none",
      blocks: 1,
    },
  );
  assert.equal(
    blockHit(rng, {
      damage: 10,
      defense: 0,
      armor: 2,
      checkDefense: false,
      checkArmor: true,
      blocks: 0,
    }).damage,
    9,
  );
  const big = blockHit(rng, {
    damage: 10,
    defense: 100,
    armor: 0,
    checkDefense: true,
    checkArmor: true,
    blocks: 1,
  });
  assert.equal(big.type, "defense");
  assert.equal(big.damage, 0);
  assert.equal(big.blocks, 0);
  // sem bloqueio disponível, a defesa não entra
  const noBlock = blockHit(rng, {
    damage: 10,
    defense: 100,
    armor: 0,
    checkDefense: true,
    checkArmor: true,
    blocks: 0,
  });
  assert.equal(noBlock.damage, 10);
  assert.equal(regainBlocks(0, 1999), 1);
  assert.equal(regainBlocks(1, 5000), 2);
  assert.equal(
    blockHit(rng, {
      damage: 5,
      defense: 0,
      armor: 0,
      checkDefense: true,
      checkArmor: true,
      blocks: 2,
      immune: true,
    }).type,
    "immunity",
  );
});

test("regra do sangue: golpe segurado conta só nos 30 seguintes a um que feriu", () => {
  let s = freshBlood();
  assert.equal(meleeSkillPoint(s), 0);
  s = onTargetBlock(s, "none");
  assert.equal(meleeSkillPoint(s), 1);
  assert.equal(distanceSkillPoint(s), 2);
  for (let i = 0; i < 30; i++) {
    s = onTargetBlock(s, "armor");
    assert.equal(meleeSkillPoint(s), 1);
    assert.equal(distanceSkillPoint(s), 1);
  }
  s = onTargetBlock(s, "armor");
  assert.equal(meleeSkillPoint(s), 0);
  // escudo de quem ataca: 30 bloqueios por golpe que feriu
  s = onTargetBlock(s, "none");
  let shield = 0;
  for (let i = 0; i < 40; i++) {
    const r = onOwnBlock(s, true);
    s = r.state;
    shield += r.shieldTries;
  }
  assert.equal(shield, 30);
});

test("sorteio normal: dentro da faixa, centrado e repetível pela semente", () => {
  const a = new Rng(42);
  const b = new Rng(42);
  let sum = 0;
  for (let i = 0; i < 20_000; i++) {
    const x = normalRandom(a, 0, 100);
    assert.ok(x >= 0 && x <= 100);
    assert.equal(x, normalRandom(b, 0, 100));
    sum += x;
  }
  const mean = sum / 20_000;
  assert.ok(Math.abs(mean - 50) < 1, `média ${mean}`);
});

test("grupo: bônus por vocação diferente e divisão igual", () => {
  assert.equal(sharedMultiplier([4]), 1.2);
  assert.equal(sharedMultiplier([4, 8]), 1.2); // promovido conta como a base
  assert.equal(sharedMultiplier([4, 3]), 1.3);
  assert.equal(sharedMultiplier([4, 3, 1]), 1.6);
  assert.equal(sharedMultiplier([4, 3, 1, 2]), 2.0);
  assert.equal(sharedExperience(1000, [4, 3]), 650);
  assert.equal(minShareLevel(100), 67);
  assert.equal(canShare([100, 66]), false);
  assert.equal(canShare([100, 67]), true);
});

test("loot: chance em 1/100.000 dividida pela taxa", () => {
  const rng = new Rng(5);
  let drops = 0;
  for (let i = 0; i < 10_000; i++)
    drops +=
      rollLoot(
        rng,
        { item: "x", chance: 10_000, countMax: 1, stackable: false },
        2,
      ) > 0
        ? 1
        : 0;
  // r < 10.000 com r = aleatório(0..100.000)/2: ~20 %
  assert.ok(drops > 1_800 && drops < 2_200, `drops ${drops}`);
  for (let i = 0; i < 1_000; i++) {
    const n = rollLoot(
      rng,
      { item: "ouro", chance: 100_000, countMax: 4, stackable: true },
      2,
    );
    assert.ok(n >= 1 && n <= 4);
  }
});

test("stamina: ×1,5 descansado, ×0,5 cansado, recuperação do TFS", () => {
  assert.equal(staminaMultiplier(2400), 1.5);
  assert.equal(staminaMultiplier(2340), 1);
  assert.equal(staminaMultiplier(840), 0.5);
  assert.equal(regenStamina(0, 600 + 180 * 100), 100);
  assert.equal(regenStamina(0, 300), 0);
  assert.equal(regenStamina(2340, 600 + 360 * 60), 2400);
  assert.equal(regenStamina(2500, 86_400), 2520);
});
