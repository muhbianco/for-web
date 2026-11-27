import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import { CLASS_IDS } from "../content.ts";
import { dungeonById } from "../dungeons/catalog.ts";
import type { Equipment } from "../equipment.ts";
import { balance as B } from "../formulas.ts";
import {
  type HeroV5,
  type OwnedItem,
  createHero,
  imbuePerk,
  reforgeItem,
  rerollPerk,
} from "../hero.ts";
import { checkHero } from "../heroSchema.ts";
import { simulateRun } from "../run/simulate.ts";
import { limitFighter } from "../sim/calibration.ts";
import { compileSkill } from "../skills/compile.ts";
import { SKILLS_BY_CLASS } from "../skills/index.ts";
import { freshHeroSkills } from "../skills/tree.ts";
import { generateItem, materialOf } from "./generate.ts";
import {
  LEGENDARIES,
  itemPerks,
  jobXpBonus,
  jobXpOf,
  legendaryMods,
} from "./legendary.ts";
import {
  JOB_XP_PERK,
  PERKS,
  perkClass,
  perkMods,
  perkRangeText,
  perkText,
  rollPerk,
} from "./perks.ts";
import { dismantle, reforge } from "./smith.ts";
import { itemTooltip } from "./view.ts";

// O perk dos lendários (27/11/2026, pedido do dono): um por skill, rolável no Ferreiro por Essência.

let n = 0;
const id = () => `p${++n}`;
const rng = (seed = 1) => randomSource(new Rng(seed));
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  assert.ok(r.ok, JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const legendaryItem = (legendary: string, ilvl = 100): OwnedItem => {
  const def = LEGENDARIES.find((l) => l.id === legendary)!;
  return {
    ...generateItem(def.base, ilvl, "lendario", rng(ilvl), B),
    legendary,
    uid: id(),
  };
};

test("toda skill das 7 classes tem perk, com faixa válida, texto e um efeito que muda a skill", () => {
  for (const cls of CLASS_IDS)
    for (const s of SKILLS_BY_CLASS[cls]) {
      const t = PERKS[s.id];
      assert.ok(t, `${s.id} sem perk`);
      assert.ok(t.min > 0 && t.max >= t.min && t.step > 0, s.id);
      const steps = (t.max - t.min) / t.step;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${s.id}: passo`);
      const build = { potency: 1, efficiency: 0, mechanics: {} };
      const plain = JSON.stringify(compileSkill(s, build, undefined, B));
      for (const v of [t.min, t.max]) {
        const text = perkText({ skill: s.id, value: v });
        assert.ok(text && text.length > 10, s.id);
        const mods = perkMods({ skill: s.id, value: v });
        assert.ok(mods.length > 0, s.id);
        const withPerk = compileSkill(s, build, undefined, B, mods);
        assert.notEqual(
          JSON.stringify(withPerk),
          plain,
          `${s.id}: o perk não muda nada`,
        );
      }
      assert.equal(perkClass({ skill: s.id, value: t.min }), cls);
    }
  // Só as 42 skills e o da Coroa.
  assert.equal(Object.keys(PERKS).length, 43);
  assert.equal(perkClass({ skill: JOB_XP_PERK, value: 0.05 }), null);
});

// Os efeitos dos 7 lendários do spec antes do perk rolável: o de origem tem de dar exatamente isto.
const ORIGINAL_MODS: Record<string, unknown> = {
  "machado-do-rugido": [
    {
      kind: "efeito",
      add: {
        type: "dano",
        parts: [{ element: "fisico", coef: 0 }],
        targets: "area",
      },
      fields: ["parts.0.coef"],
      perUp: 0.8,
    },
  ],
  "egide-do-juramento": [{ kind: "potencia", effects: [0], perUp: 0.1 }],
  "cajado-da-aurora": [
    {
      kind: "gancho",
      add: { on: "semCusto", chance: 0 },
      field: "chance",
      perUp: 0.15,
    },
  ],
  "bastao-do-carvalho-velho": [
    { kind: "valor", effect: 0, field: "stacks", perUp: 1 },
  ],
  "cetro-das-cinzas": [
    {
      kind: "efeito",
      add: {
        type: "dot",
        element: "magico",
        coefPerSec: 0,
        durationMs: 4000,
        targets: "area",
      },
      fields: ["coefPerSec"],
      perUp: 0.04,
    },
  ],
  "arco-do-vendaval": [{ kind: "corte", pct: 0.2 }],
  "katar-bicefalo": [
    { kind: "gancho", add: { on: "repete", pct: 0 }, field: "pct", perUp: 0.5 },
  ],
};

test("o perk de origem dos lendários do spec é o efeito de antes, dentro da faixa da skill", () => {
  for (const def of LEGENDARIES) {
    const t = PERKS[def.perk.skill]!;
    assert.ok(def.perk.value >= t.min && def.perk.value <= t.max, def.id);
    if (def.perk.skill === JOB_XP_PERK) continue;
    assert.deepEqual(perkMods(def.perk), ORIGINAL_MODS[def.id], def.id);
  }
  assert.equal(
    perkText(LEGENDARIES[0]!.perk),
    "Grito de Guerra também causa 80% ATQ.",
  );
  assert.equal(perkText(LEGENDARIES[7]!.perk), "+5% de XP de job.");
  assert.equal(perkRangeText("seta-arcana"), "de 20% a 40%");
  assert.equal(perkRangeText("fumaca"), "de 1,5 s a 3 s");
  assert.equal(perkRangeText("rejuvenescer"), null);
});

test("a rolagem cai numa skill da classe (menos as excluídas), no passo da faixa, e cobre todas", () => {
  const r = rng(3);
  for (const cls of CLASS_IDS) {
    const ids = SKILLS_BY_CLASS[cls].map((s) => s.id);
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const p = rollPerk(cls, [ids[0]!], r);
      assert.ok(ids.includes(p.skill) && p.skill !== ids[0], p.skill);
      const t = PERKS[p.skill]!;
      assert.ok(p.value >= t.min - 1e-9 && p.value <= t.max + 1e-9);
      const k = (p.value - t.min) / t.step;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${p.skill} ${p.value}`);
      seen.add(p.skill);
    }
    assert.equal(seen.size, ids.length - 1, cls);
  }
  // As pontas da faixa saem.
  const vals = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const p = rollPerk(
      "mago",
      [
        "explosao-de-fogo",
        "nevasca",
        "escudo-de-mana",
        "raio-em-cadeia",
        "meteoro",
      ],
      r,
    );
    vals.add(p.value);
  }
  assert.ok(vals.has(0.2) && vals.has(0.4), [...vals].join(","));
});

test("Ferreiro: rolar o perk custa 1 Essência, numa skill da classe de quem rola; imbuir o 2º custa 20", () => {
  const staff = legendaryItem("cajado-da-aurora");
  const h0: HeroV5 = {
    ...createHero("druida", id),
    level: 100,
    bag: [staff],
    essence: 25,
  };
  // O cajado do padre num druida: o perk de origem (Curar) não vale para ele.
  assert.deepEqual(itemPerks(staff), [{ skill: "curar", value: 0.15 }]);
  const r1 = ok(rerollPerk(h0, staff.uid, 0, rng(5)));
  const after = r1.hero.bag[0]!;
  assert.equal(r1.hero.essence, 24);
  assert.equal(after.perks!.length, 1);
  assert.equal(perkClass(after.perks![0]!), "druida");
  assert.deepEqual(after.affixes, staff.affixes);
  assert.equal(after.refine, staff.refine);
  // Imbuir: 20 Essência, um 2º perk numa skill diferente do 1º.
  const r2 = ok(imbuePerk(r1.hero, staff.uid, rng(6)));
  const two = r2.hero.bag[0]!.perks!;
  assert.equal(r2.hero.essence, 4);
  assert.equal(two.length, 2);
  assert.notEqual(two[0]!.skill, two[1]!.skill);
  assert.deepEqual(imbuePerk({ ...r2.hero, essence: 99 }, staff.uid, rng()), {
    ok: false,
    error: "perks-cheios",
  });
  // Rolar o 2º não toca no 1º e nunca repete a skill dele.
  let h = r2.hero;
  for (let i = 0; i < 40; i++) {
    h = ok(rerollPerk({ ...h, essence: 1 }, staff.uid, 1, rng(100 + i))).hero;
    const p = h.bag[0]!.perks!;
    assert.deepEqual(p[0], two[0]);
    assert.notEqual(p[1]!.skill, p[0]!.skill);
  }
  // Os erros.
  assert.deepEqual(rerollPerk({ ...h, essence: 0 }, staff.uid, 0, rng()), {
    ok: false,
    error: "sem-essencia",
  });
  assert.deepEqual(rerollPerk(h, staff.uid, 2, rng()), {
    ok: false,
    error: "perk-invalido",
  });
  assert.deepEqual(rerollPerk(h0, staff.uid, 1, rng()), {
    ok: false,
    error: "perk-invalido",
  });
  const epic: OwnedItem = {
    ...generateItem({ slot: "arma", family: "cajado" }, 100, "epico", rng(), B),
    uid: id(),
  };
  assert.deepEqual(rerollPerk({ ...h0, bag: [epic] }, epic.uid, 0, rng()), {
    ok: false,
    error: "nao-lendario",
  });
  assert.deepEqual(imbuePerk({ ...h0, essence: 19 }, staff.uid, rng()), {
    ok: false,
    error: "sem-essencia",
  });
});

test("o perk rolado vale vestido: a skill do druida muda; o herói rolado passa no esquema", () => {
  const staff = legendaryItem("cajado-da-aurora");
  const base: HeroV5 = { ...createHero("druida", id), level: 100, essence: 30 };
  const h = ok(
    imbuePerk(
      ok(rerollPerk({ ...base, bag: [staff] }, staff.uid, 0, rng(7))).hero,
      staff.uid,
      rng(8),
    ),
  ).hero;
  const it = h.bag[0]!;
  const mods = legendaryMods({ arma: it } as Equipment);
  for (const p of it.perks!) assert.ok(mods[p.skill]?.length, p.skill);
  assert.equal(mods["curar"], undefined);
  const check = checkHero(h);
  assert.ok(check.ok, check.ok ? "" : check.reason);
  // Perk de skill que não existe, ou 3 perks: o esquema recusa (não conserta em silêncio).
  const bad = (perks: unknown) =>
    checkHero({ ...h, bag: [{ ...it, perks }] }).ok;
  assert.equal(bad([{ skill: "toString", value: 0.1 }]), false);
  assert.equal(bad([...it.perks!, it.perks![0]]), false);
  // A Coroa: o perk de origem é o +5% de XP de job.
  assert.equal(
    jobXpBonus({ elmo: legendaryItem("coroa-do-mentor") } as Equipment),
    0.05,
  );
});

test("reforjar mantém os perks; desmontar lendário dá 2 Essências; o tooltip mostra os perks e a classe", () => {
  const axe = {
    ...legendaryItem("machado-do-rugido"),
    perks: [
      { skill: "redemoinho", value: 0.009 },
      { skill: "grito-de-guerra", value: 0.65 },
    ],
  };
  assert.deepEqual(reforge(axe, rng(2)).perks, axe.perks);
  const h: HeroV5 = {
    ...createHero("guerreiro", id),
    level: 100,
    gold: 1e9,
    bag: [axe],
    ores: { [materialOf(100)]: 99 },
  };
  assert.deepEqual(
    ok(reforgeItem(h, axe.uid, rng(3))).hero.bag[0]!.perks,
    axe.perks,
  );
  assert.equal(dismantle(axe).essence, B.cfg.legendaryPerks.dismantleEssence);
  assert.equal(B.cfg.legendaryPerks.dismantleEssence, 2);
  assert.deepEqual(itemTooltip(axe).perks, [
    {
      text: "Redemoinho cura 0,9% do HP máximo por inimigo atingido.",
      cls: "guerreiro",
    },
    { text: "Grito de Guerra também causa 65% ATQ.", cls: "guerreiro" },
  ]);
  assert.equal(
    itemTooltip({
      ...axe,
      rarity: "epico",
      legendary: undefined,
      perks: undefined,
    }).perks,
    undefined,
  );
});

test("o perk entra na skill compilada do herói que o veste (Arco do Vendaval rolado para Tiro Perfurante)", () => {
  const bow = {
    ...legendaryItem("arco-do-vendaval"),
    perks: [{ skill: "tiro-perfurante", value: 0.2 }],
  };
  const hs = freshHeroSkills("cacador");
  const s = SKILLS_BY_CLASS.cacador.find((x) => x.id === "tiro-perfurante")!;
  const build = hs.builds[s.id] ?? { potency: 1, efficiency: 0, mechanics: {} };
  const c = compileSkill(
    s,
    build,
    undefined,
    B,
    legendaryMods({ arma: bow } as Equipment)[s.id] ?? [],
  );
  const dano = c.effects[0]!;
  assert.equal(dano.type === "dano" ? dano.penetration : 0, 0.7);
});

test("luta de verdade: todas as 42 skills com o perk no máximo rodam na Masmorra 290 (sem travar)", () => {
  const groups: (typeof CLASS_IDS)[number][][] = [
    ["guerreiro", "padre", "mago", "cacador", "assassino"],
    ["paladino", "druida", "mago", "cacador", "assassino"],
  ];
  const d = dungeonById("masmorra-290")!;
  for (const g of groups) {
    const party = g.map((cls) => {
      const f = limitFighter(cls, 300);
      const skills = SKILLS_BY_CLASS[cls].map((s) => {
        const t = PERKS[s.id]!;
        return compileSkill(
          s,
          { potency: 5, efficiency: 0, mechanics: {} },
          undefined,
          B,
          perkMods({ skill: s.id, value: t.max }),
        );
      });
      return { ...f, skills };
    });
    for (let i = 0; i < 6; i++) {
      const r = simulateRun(
        d,
        party,
        i === 0
          ? { mode: "esperado" }
          : { mode: "aleatorio", random: randomSource(new Rng(40 + i)) },
      );
      assert.notEqual(r.outcome, "travada", `${g.join("+")} ${i}`);
    }
  }
});

test("Coroa do Mentor vestida: o XP de job da corrida ganha +5%; rolada para skill, perde", () => {
  const crown = legendaryItem("coroa-do-mentor");
  const xp = 100_000;
  const base = Math.floor(xp * B.cfg.xp.jobShare);
  assert.equal(jobXpOf(xp, {} as Equipment), base);
  assert.equal(
    jobXpOf(xp, { elmo: crown } as Equipment),
    Math.floor(xp * B.cfg.xp.jobShare * 1.05),
  );
  // Na mochila não conta: só vestida.
  const rolled = { ...crown, perks: [{ skill: "curar", value: 0.15 }] };
  assert.equal(jobXpOf(xp, { elmo: rolled } as Equipment), base);
});
