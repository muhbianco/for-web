import assert from "node:assert/strict";
import test from "node:test";

import {
  type OwnedItem,
  balance as B,
  generateItem,
  materialOf,
} from "@muchat/space-core/game/ot/balance";

import {
  type RpgHeroDoc,
  checkHeroDoc,
  closeDojo,
  heroLook,
  inRun,
  markRun,
  newRpgHero,
  openDojo,
  rpgDocBytes,
  settleRunFitting,
  settleRunHero,
  transferIn,
  transferOut,
  transferSettled,
} from "./hero.ts";

// O herói v5 no servidor (Fase 8): documento, Dojô, corrida e transferência.

let n = 0;
const id = () => `i${++n}`;
const hero = (
  cls: Parameters<typeof newRpgHero>[1] = "guerreiro",
): RpgHeroDoc => newRpgHero("U1", cls, 1_000, id);
const ring = (): OwnedItem => ({
  ...generateItem({ slot: "anel" }, 10, "raro", { next: () => 0.5 }, B),
  uid: id(),
});

test("jogador novo passa na conferência; documento torto volta com o motivo", () => {
  const d = hero("cacador");
  assert.equal(checkHeroDoc(JSON.parse(JSON.stringify(d))).ok, true);
  assert.equal(d.hero.level, 1);
  assert.deepEqual(checkHeroDoc({ ...d, v: 4 }), {
    ok: false,
    reason: "versão 4",
  });
  const r = checkHeroDoc({
    ...d,
    hero: { ...d.hero, attrs: { ...d.hero.attrs, FOR: 999 } },
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /atributos/);
  // A aparência no mapa: a família da arma e o peso da armadura.
  const look = heroLook(d);
  assert.equal(look.level, 1);
  assert.equal(look.vocation, 3);
  assert.equal(look.gear.weapon, "arco");
  assert.equal(look.gear.body, "media");
});

test("D64: documento de antes da faixa por raridade — épico e lendário da mochila e da fila de transferência sobem uma vez", () => {
  const d = hero();
  const epic = (uid: string): OwnedItem => ({
    uid,
    slot: "anel",
    ilvl: 40,
    rarity: "epico",
    refine: 0,
    affixes: [{ id: "VIT", value: 1.7 }],
  });
  const old = JSON.parse(
    JSON.stringify({
      ...d,
      hero: { ...d.hero, itemRules: undefined, bag: [epic("mochila")] },
      outbox: [{ id: "t1", to: "U2", gold: 0, items: [epic("saindo")], at: 1 }],
    }),
  );
  const r = checkHeroDoc(old);
  assert.ok(r.ok);
  assert.equal(r.itemsRescaled, 2);
  assert.equal(r.doc.hero.itemRules, 1);
  assert.equal(r.doc.hero.bag[0]!.affixes[0]!.value, 1.9);
  assert.equal(r.doc.outbox[0]!.items[0]!.affixes[0]!.value, 1.9);
  // Já na regra: nada muda (a fila também não).
  const again = checkHeroDoc(JSON.parse(JSON.stringify(r.doc)));
  assert.ok(again.ok);
  assert.equal(again.itemsRescaled, 0);
  assert.equal(again.doc.outbox[0]!.items[0]!.affixes[0]!.value, 1.9);
});

test("Dojô: abre ao lado do boneco, fecha creditando a Proficiência; a corrida fecha o treino", () => {
  const d = hero();
  const where = { instance: "boneco", server: "S1", zone: "z" };
  assert.deepEqual(openDojo(d, where, 0), { ok: true });
  // Abrir de novo no mesmo boneco não reinicia.
  assert.deepEqual(openDojo(d, where, 5_000), { ok: true });
  assert.equal(d.dojo?.since, 0);
  const secs = B.dojoHoursTo(50) * 3600;
  assert.equal(closeDojo(d, Math.ceil(secs * 1000) + 1000, 0), true);
  assert.equal(d.hero.proficiency, 50);
  assert.equal(d.dojo, null);
  openDojo(d, where, 10);
  markRun(d, { id: "r1", dungeon: "cacada-1", ends_at: 100_000 }, 20);
  assert.equal(d.dojo, null);
  assert.equal(inRun(d, 50), true);
  assert.deepEqual(openDojo(d, where, 30), { ok: false, reason: "in_run" });
});

test("a corrida fecha uma vez só: recompensa, poções gastas, o que não coube volta em `left`", () => {
  const d = hero("mago");
  markRun(d, { id: "r1", dungeon: "cacada-1", ends_at: 10_000 }, 0);
  const spoils = {
    xp: B.xpTotalAt(3),
    jobXp: 10,
    gold: 50,
    items: [ring()],
    ores: { [materialOf(1)]: 4 },
    stones: 0,
    potionsUsed: { hp: 2, mp: 0 },
    ammoUsed: 0,
  };
  const r = settleRunHero(d, "r1", spoils, spoils);
  assert.ok(r.ok);
  assert.equal(d.hero.level, 3);
  assert.equal(d.hero.gold, 50);
  assert.equal(d.hero.potions.hp.pequena, 98);
  assert.equal(d.hero.bag.length, 1);
  assert.equal(d.run, null);
  assert.deepEqual(settleRunHero(d, "r1", spoils, spoils), {
    ok: false,
    reason: "no_run",
  });
  // Quem saiu antes: sem recompensa, com o gasto.
  markRun(d, { id: "r2", dungeon: "cacada-1", ends_at: 20_000 }, 13_000);
  const gone = settleRunHero(
    d,
    "r2",
    null,
    { potionsUsed: { hp: 1, mp: 0 }, ammoUsed: 0 },
  );
  assert.ok(gone.ok);
  assert.equal(d.hero.gold, 50);
  assert.equal(d.hero.potions.hp.pequena, 97);
});

test("transferência: sai com a taxa, entra uma vez só, volta inteira se o destino não existe", () => {
  const a = hero();
  const b = { ...hero("padre"), _id: "U2" };
  const it = ring();
  a.hero = { ...a.hero, gold: 10_000, bag: [it] };
  const t = { id: "t1", to: "U2", gold: 1000, items: [it], at: 0 };
  assert.deepEqual(transferOut(a, t, 0), { ok: true });
  const fee = Math.ceil(0.02 * 1000) + 5 * B.lacaioGold(10);
  assert.equal(a.hero.gold, 10_000 - 1000 - fee);
  assert.equal(a.hero.bag.length, 0);
  assert.equal(a.outbox.length, 1);
  transferIn(b, a.outbox[0]!);
  transferIn(b, a.outbox[0]!);
  assert.equal(b.hero.gold, 1000);
  assert.equal(b.hero.bag.length, 1);
  transferSettled(a, "t1", false);
  assert.equal(a.outbox.length, 0);
  // Sem ouro para a taxa: recusa sem mexer.
  const poor = hero();
  poor.hero = { ...poor.hero, gold: 100 };
  assert.deepEqual(
    transferOut(poor, { id: "t2", to: "U2", gold: 100, items: [], at: 0 }, 0),
    { ok: false, reason: "sem-ouro" },
  );
  // Destino sem herói: volta tudo (a taxa fica).
  const c = hero();
  c.hero = { ...c.hero, gold: 5000 };
  transferOut(c, { id: "t3", to: "X", gold: 1000, items: [], at: 0 }, 0);
  transferSettled(c, "t3", true);
  assert.equal(c.hero.gold, 5000 - 20);
});

test("o cofre que saiu (28/11/2026): a leitura traz os itens para a mochila e o ouro para a mão e conta", () => {
  const d = hero();
  const kept = ring();
  const old = JSON.parse(
    JSON.stringify({
      ...d,
      hero: {
        ...d.hero,
        gold: 100,
        vault: { gold: 900, items: [kept], expansions: 0 },
      },
    }),
  );
  const r = checkHeroDoc(old);
  assert.ok(r.ok);
  assert.deepEqual([r.vaultItems, r.vaultGold], [1, 900]);
  assert.equal(r.doc.hero.gold, 1000);
  assert.ok(r.doc.hero.bag.some((x) => x.uid === kept.uid));
  assert.equal("vault" in r.doc.hero, false);
  const again = checkHeroDoc(JSON.parse(JSON.stringify(r.doc)));
  assert.ok(again.ok && again.vaultItems === 0 && again.vaultGold === 0);
});

test("fim da corrida com o documento cheio (28/11/2026): os itens ficam para trás, XP e ouro entram", () => {
  const d = hero("mago");
  markRun(d, { id: "r1", dungeon: "cacada-1", ends_at: 10_000 }, 0);
  const loot = [ring(), ring()];
  const spoils = {
    xp: B.xpTotalAt(3),
    jobXp: 10,
    gold: 50,
    items: loot,
    ores: { [materialOf(1)]: 4 },
    stones: 0,
    potionsUsed: { hp: 2, mp: 0 },
    ammoUsed: 0,
  };
  // Com folga: tudo entra.
  const roomy = structuredClone(d);
  const a = settleRunFitting(roomy, "r1", spoils, 1 << 20);
  assert.ok(a.ok && a.dropped.length === 0);
  assert.equal(roomy.hero.bag.length, 2);
  // Sem espaço para os itens (o teto bate antes da folga de 1 KB): XP, ouro e minério entram.
  const tight = structuredClone(d);
  const b = settleRunFitting(tight, "r1", spoils, rpgDocBytes(d) + 1024 + 100);
  assert.ok(b.ok);
  assert.deepEqual(
    b.dropped.map((x) => x.uid),
    loot.map((x) => x.uid),
  );
  assert.equal(tight.hero.bag.length, 0);
  assert.equal(tight.hero.level, 3);
  assert.equal(tight.hero.gold, 50);
  assert.equal(tight.hero.ores[materialOf(1)], 4);
  assert.equal(tight.run, null);
  // Fechada uma vez só.
  assert.equal(settleRunFitting(tight, "r1", spoils).ok, false);
});
