/* global console, process */
/**
 * Varredura do modelo de mana (26/11/2026, pedido do dono): skill melhorada (Potência e adereços)
 * gasta mais; INT aumenta a mana, a regeneração e barateia a skill; quem não tem INT paga em poção
 * ou precisa do druida. Para cada combinação de termos, os grupos de calibração (com e sem druida)
 * em Masmorras de 4 faixas, com os heróis gastando os pontos de skill como jogador ("agressivo":
 * adereços e Potência primeiro; "economico": Eficiência primeiro). Por classe (INT ou não):
 * poções de mana por corrida, a fatia do ouro da corrida que vai nelas, as skills que a mana barra
 * com poção e sem poção, e o efeito do druida (a mesma classe com e sem druida no grupo).
 *
 *   node scripts/mana-sweep.ts [--quick] [--build agressivo|economico] [--only "1,0.03,0.05,0.003,0.004,0.008"]
 */
import {
  type Balance,
  type ClassId,
  type DungeonDef,
  type FighterInput,
  type HeroSkills,
  BALANCE,
  DUNGEONS,
  SKILLS_BY_CLASS,
  createBalance,
  createMonsters,
  createReference,
  heroFighter,
  potionPrice,
  referenceSkills,
  runRewards,
  simulateRun,
  spendPoint,
} from "../src/game/ot/balance/index.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const QUICK = process.argv.includes("--quick");
const BUILD = (arg("--build") ?? "agressivo") as "agressivo" | "economico" | "ref";
const LEVELS = QUICK ? [190, 490] : [90, 190, 290, 490];
const PARTIES: ClassId[][] = [
  ["guerreiro", "padre", "mago", "cacador", "assassino"],
  ["guerreiro", "druida", "mago", "cacador", "assassino"],
  ["guerreiro", "paladino", "padre", "mago", "cacador"],
];
const INT_CLASSES = new Set<ClassId>(["mago", "padre", "druida"]);

interface Params {
  costScale: number;
  perRank: number;
  perUp: number;
  cutPerInt: number;
  regenPct: number;
  cancao: number;
}

function balanceOf(p: Params): Balance {
  const cfg = structuredClone(BALANCE) as typeof BALANCE;
  (cfg.mana as Record<string, number>).costScale = p.costScale;
  (cfg.mana as Record<string, number>).costPerPotencyRank = p.perRank;
  (cfg.mana as Record<string, number>).costPerMechanicUp = p.perUp;
  (cfg.mana as Record<string, number>).costCutPerInt = p.cutPerInt;
  (cfg.regen as Record<string, number>).mpPctPerSecond = p.regenPct;
  return createBalance(cfg);
}

/** O herói do limite (D41) com os pontos de skill gastos como jogador. */
function playerFighter(
  cls: ClassId,
  L: number,
  B: Balance,
  build: typeof BUILD,
  cancao: number,
): FighterInput {
  const RL = createReference(B, "limite");
  const R0 = createReference(B);
  const h = RL.referenceBalanceHero(cls, L);
  let hs: HeroSkills = referenceSkills(
    cls,
    B.tierFor(L, h.job),
    h.job,
    false,
    B,
    "gabarito",
  );
  if (build !== "ref") {
    const spend = (id: string, target: Parameters<typeof spendPoint>[4]) => {
      const r = spendPoint(cls, h.job, hs, id, target, B);
      if (r.ok) hs = r.skills;
      return r.ok;
    };
    const mechanicsOf = (id: string) =>
      (SKILLS_BY_CLASS[cls].find((s) => s.id === id)?.mechanics ?? [])
        .filter((m) => m.unlockTier <= hs.tier)
        .map((m) => ({ mechanic: m.id }));
    const order =
      build === "agressivo"
        ? (id: string) => [...mechanicsOf(id), "potencia" as const, "eficiencia" as const]
        : (id: string) => ["eficiencia" as const, ...mechanicsOf(id), "potencia" as const];
    for (const id of hs.slots)
      for (const target of order(id)) while (spend(id, target)) {}
  }
  const f = heroFighter(
    h,
    hs,
    { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 100 } },
    B,
    R0,
  );
  if (cancao !== 0.02)
    for (const s of f.skills)
      for (const e of s.effects)
        if (e.type === "buff" && e.stat === "regenManaPct") e.value = cancao;
  return f;
}

const masmorraAt = (L: number): DungeonDef =>
  DUNGEONS.filter((d) => d.kind === "masmorra").reduce((a, b) =>
    Math.abs(b.level - L) < Math.abs(a.level - L) ? b : a,
  );

const casts = (r: ReturnType<typeof simulateRun>, j: number) =>
  r.rooms.reduce(
    (a, room) => a + Object.values(room.heroes[j]!.casts).reduce((x, y) => x + y, 0),
    0,
  );

interface Acc {
  potMP: number[];
  share: number[];
  barred: number[];
  lostNoPot: number[];
  shareTotal: number[];
}
const acc = () =>
  ({ potMP: [], share: [], barred: [], lostNoPot: [], shareTotal: [] }) as Acc;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function evaluate(p: Params) {
  const B = balanceOf(p);
  const M = createMonsters(B);
  const byCls = new Map<string, Acc>();
  const get = (k: string) => {
    let a = byCls.get(k);
    if (!a) byCls.set(k, (a = acc()));
    return a;
  };
  let wins = 0;
  let total = 0;
  let slower = 0;
  for (const L of LEVELS) {
    const d = masmorraAt(L);
    const price = potionPrice(d.level, B);
    for (const [pi, comp] of PARTIES.entries()) {
      const party = comp.map((c) => playerFighter(c, d.level, B, BUILD, p.cancao));
      const run = (fs: FighterInput[]) =>
        simulateRun(d, fs, { mode: "esperado" }, B, M);
      const r = run(party);
      const inf = run(party.map((f) => ({ ...f, stats: { ...f.stats, mp: 1e12 } })));
      const dry = run(
        party.map((f) => ({
          ...f,
          potions: { ...f.potions, hpStock: f.potions.stock, mpStock: 0 },
        })),
      );
      total++;
      if (r.outcome === "vitoria") wins++;
      slower += r.seconds / Math.max(1, inf.seconds) - 1;
      const gold = runRewards(d, comp.map(() => d.level), r, B);
      comp.forEach((cls, j) => {
        const mp = r.rooms.reduce((a, x) => a + x.heroes[j]!.mpPotions, 0);
        const hp = r.rooms.reduce((a, x) => a + x.heroes[j]!.hpPotions, 0);
        const ci = casts(inf, j) || 1;
        const tag = `${cls}${pi === 1 ? "+dru" : ""}`;
        for (const k of [cls, tag, INT_CLASSES.has(cls) ? "INT" : "outras"]) {
          const a = get(k);
          a.potMP.push(mp);
          a.share.push((mp * price.mp) / Math.max(1, gold.heroes[j]!.gold));
          a.barred.push(Math.max(0, 1 - casts(r, j) / ci));
          a.lostNoPot.push(Math.max(0, 1 - casts(dry, j) / ci));
          a.shareTotal.push(
            (mp * price.mp + hp * price.hp) / Math.max(1, gold.heroes[j]!.gold),
          );
        }
      });
    }
  }
  return { byCls, wins, total, slower: slower / total };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const fmt = (p: Params) =>
  `escala ${p.costScale} · +${p.perRank}/rank · +${p.perUp}/adereço · INT ${p.cutPerInt} · regen ${p.regenPct} · Canção ${p.cancao}`;

function report(p: Params, detail: boolean) {
  const e = evaluate(p);
  const g = (k: string) => e.byCls.get(k) ?? acc();
  const line = [
    fmt(p),
    `vitórias ${e.wins}/${e.total}`,
    `INT: poção ${n1(avg(g("INT").potMP))} (${pct(avg(g("INT").share))} do ouro) barra ${pct(avg(g("INT").barred))} sem poção ${pct(avg(g("INT").lostNoPot))}`,
    `outras: poção ${n1(avg(g("outras").potMP))} (${pct(avg(g("outras").share))}) barra ${pct(avg(g("outras").barred))} sem poção ${pct(avg(g("outras").lostNoPot))}`,
  ].join(" | ");
  console.log(line);
  if (detail) {
    console.log(
      "classe\tpoção MP/corrida\t% do ouro (mana)\t% do ouro (vida+mana)\tbarradas c/ poção\tperdidas s/ poção",
    );
    for (const k of [
      "guerreiro",
      "paladino",
      "cacador",
      "assassino",
      "mago",
      "padre",
      "druida",
      "mago+dru",
      "cacador+dru",
      "assassino+dru",
      "guerreiro+dru",
    ]) {
      const a = e.byCls.get(k);
      if (!a) continue;
      console.log(
        [
          k,
          n1(avg(a.potMP)),
          pct(avg(a.share)),
          pct(avg(a.shareTotal)),
          pct(avg(a.barred)),
          pct(avg(a.lostNoPot)),
        ].join("\t"),
      );
    }
  }
}

const only = arg("--only");
if (only) {
  const [costScale, perRank, perUp, cutPerInt, regenPct, cancao] = only.split(",").map(Number);
  report({ costScale: costScale!, perRank: perRank!, perUp: perUp!, cutPerInt: cutPerInt!, regenPct: regenPct!, cancao: cancao! }, true);
} else {
  const base: Params = { costScale: 1, perRank: 0, perUp: 0, cutPerInt: 0, regenPct: 0.004, cancao: 0.02 };
  report(base, true);
  const fine = process.argv.includes("--fine");
  if (fine)
    for (const costScale of [1.15, 1.3, 1.45])
      for (const perRank of [0.01, 0.02])
        for (const perUp of [0.02, 0.03])
          for (const cutPerInt of [0.003, 0.005])
            for (const regenPct of [0.004, 0.003])
              for (const cancao of [0.02, 0.01])
                report({ costScale, perRank, perUp, cutPerInt, regenPct, cancao }, false);
  else
    for (const costScale of [1.5, 2, 3])
      for (const perRank of [0, 0.03])
        for (const perUp of [0, 0.04])
          for (const cutPerInt of [0, 0.003])
            for (const regenPct of [0.004, 0.002])
              for (const cancao of [0.02, 0.008])
                report({ costScale, perRank, perUp, cutPerInt, regenPct, cancao }, false);
}
