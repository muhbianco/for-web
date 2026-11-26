/**
 * Quanto o tanque segura a ameaça (26/11/2026, pedido do dono: "a IA do boneco tem de saber quando
 * provocar; com os ups do guerreiro ele vai conseguir segurar 100% do aggro").
 *
 * Nos grupos de calibração com tanque (D41), no perfil do limite: a fração dos segundos-monstro em
 * que o monstro mira um tanque ("segura"), quantas provocações saem por corrida, o resultado e o
 * tempo. Esperado (uma corrida) e aleatório (N sementes: vitórias e a média do "segura").
 *
 *   node scripts/taunt-hold.ts [--seeds 10] [--ups "golpe-provocador:desafio=5,grito-de-guerra:eco=5"]
 *
 * `--ups` põe ups de mecânica nas skills do guerreiro e do paladino (por cima do kit de referência).
 */
import {
  type ClassId,
  type DungeonDef,
  type FighterInput,
  balance as BALANCE,
  DUNGEONS,
  Rng,
  createReference,
  heroFighter,
  randomSource,
  referenceSkills,
  simulateRun,
} from "../src/game/ot/balance/index.ts";
import {
  LIMIT_GROUP_PARTIES,
  LIMIT_HUNT_GROUPS,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SEEDS = Number(arg("--seeds") ?? 10);
const UPS = (arg("--ups") ?? "")
  .split(",")
  .filter(Boolean)
  .map((x) => {
    const [skill, rest] = x.split(":");
    const [mech, n] = rest!.split("=");
    return { skill: skill!, mech: mech!, n: Number(n) };
  });

const TANKS = new Set<ClassId>(["guerreiro", "paladino"]);
const TAUNTS = new Set(["golpe-provocador", "grito-de-guerra", "golpe-sagrado"]);

/** O herói do limite (como o limitFighter, sem degrau) com os ups de mecânica pedidos. */
function fighter(cls: ClassId, L: number): FighterInput {
  const mine = UPS.filter((u) => SKILL_CLASS[u.skill] === cls);
  if (mine.length === 0) return limitFighter(cls, L);
  const B = BALANCE;
  const RL = createReference(B, "limite");
  const R0 = createReference(B);
  const h = RL.referenceBalanceHero(cls, L, {});
  const hs = referenceSkills(cls, B.tierFor(h.job), h.job, false, B, "gabarito");
  for (const u of mine) {
    const b = hs.builds[u.skill];
    if (b) b.mechanics = { ...b.mechanics, [u.mech]: u.n };
  }
  return heroFighter(
    h,
    hs,
    { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 100 } },
    B,
    R0,
  );
}
const SKILL_CLASS: Record<string, ClassId> = {
  "golpe-provocador": "guerreiro",
  "grito-de-guerra": "guerreiro",
  "golpe-sagrado": "paladino",
};

function measure(d: DungeonDef, comp: readonly ClassId[]) {
  const party = () => comp.map((c) => fighter(c, d.level));
  const one = (mode: "esperado" | "aleatorio", seed: number) => {
    const r = simulateRun(d, party(), {
      mode,
      ...(mode === "aleatorio" ? { random: randomSource(new Rng(seed)) } : {}),
      record: true,
    });
    let held = 0;
    let total = 0;
    let taunts = 0;
    for (const f of r.frames ?? []) {
      for (const g of f.g ?? []) {
        if (!g) continue;
        total++;
        if (g.a >= 0 && TANKS.has(comp[g.a]!)) held++;
      }
      for (const e of f.e) if (e.k === "lanca" && TAUNTS.has(e.s)) taunts++;
    }
    return { win: r.outcome === "vitoria", s: r.seconds, hold: total ? held / total : 1, taunts };
  };
  const exp = one("esperado", 0);
  const rnd = Array.from({ length: SEEDS }, (_, i) => one("aleatorio", 1000 + i));
  return {
    exp,
    wins: rnd.filter((x) => x.win).length,
    hold: rnd.reduce((a, x) => a + x.hold, 0) / rnd.length,
    taunts: rnd.reduce((a, x) => a + x.taunts, 0) / rnd.length,
    s: rnd.reduce((a, x) => a + x.s, 0) / rnd.length,
  };
}

const pick = (kind: string, levels: number[]) =>
  DUNGEONS.filter((d) => d.kind === kind && levels.includes(d.level));
const rows: [DungeonDef, readonly ClassId[]][] = [];
for (const d of pick("masmorra", [40, 70, 90, 140, 190, 290, 390, 490]))
  for (const p of LIMIT_GROUP_PARTIES) rows.push([d, p]);
for (const d of pick("cacada", [40, 60, 90, 190, 490]))
  for (const p of [...LIMIT_HUNT_GROUPS[2]!, ...LIMIT_HUNT_GROUPS[3]!])
    if (p.some((c) => TANKS.has(c))) rows.push([d, p]);

const short = (c: ClassId) => c.slice(0, 3);
console.log(`segura = segundos-monstro mirando um tanque; aleatório com ${SEEDS} sementes${UPS.length ? `; ups ${arg("--ups")}` : ""}`);
let sumHold = 0;
for (const [d, comp] of rows) {
  const m = measure(d, comp);
  sumHold += m.hold;
  console.log(
    `${d.id.padEnd(13)} ${comp.map(short).join("+").padEnd(20)} esperado ${m.exp.win ? "V" : "D"} ${String(Math.round(m.exp.s)).padStart(3)}s segura ${String(Math.round(m.exp.hold * 100)).padStart(3)}% · aleatório ${m.wins}/${SEEDS} ${String(Math.round(m.s)).padStart(3)}s segura ${String(Math.round(m.hold * 100)).padStart(3)}% provocações ${m.taunts.toFixed(1)}`,
  );
}
console.log(`média do segura (aleatório): ${Math.round((sumHold / rows.length) * 100)}%`);
