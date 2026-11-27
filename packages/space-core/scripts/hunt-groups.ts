/**
 * A Caçada de 2 a 5 (27/11/2026, pedido do dono: "liberar as caçadas até 5 players; a caçada deve
 * crescer a partir do 4º; dificuldade, XP e drop crescem proporcionalmente").
 *
 * Para cada nível, na Caçada do próprio nível: a vitória (% no aleatório) de cada grupo de calibração
 * de cada tamanho (LIMIT_HUNT_GROUPS) no perfil do limite e no abaixo do limite, e o que cada herói
 * leva por corrida vencida (XP, ouro e itens) em relação ao trio.
 *
 *   node scripts/hunt-groups.ts [--seeds 20] [--levels 45,60,90,150,250,400,490]
 */
import { DUNGEON_EDGE } from "../src/game/ot/balance/dungeons/edge.generated.ts";
import {
  type ClassId,
  type DungeonDef,
  DUNGEONS,
  Rng,
  randomSource,
  simulateRun,
} from "../src/game/ot/balance/index.ts";
import { dungeonLootOdds } from "../src/game/ot/balance/run/lootOdds.ts";
import { runRewards } from "../src/game/ot/balance/run/rewards.ts";
import {
  LIMIT_HUNT_GROUPS,
  belowLimitFighter,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SEEDS = Number(arg("--seeds") ?? 20);
const LEVELS = (arg("--levels") ?? "45,60,90,150,250,400,490")
  .split(",")
  .map(Number);
const HUNTS = DUNGEONS.filter((d) => d.kind === "cacada").sort(
  (a, b) => a.level - b.level,
);
const huntFor = (L: number): DungeonDef =>
  [...HUNTS].reverse().find((d) => d.level <= L) ?? HUNTS[0]!;

type Profile = "limite" | "abaixo";
const party = (comp: readonly ClassId[], L: number, p: Profile) =>
  comp.map((c) =>
    p === "limite" ? limitFighter(c, L) : belowLimitFighter(c, L),
  );

function wins(
  d: DungeonDef,
  comp: readonly ClassId[],
  L: number,
  p: Profile,
): number {
  let w = 0;
  for (let i = 0; i < SEEDS; i++)
    if (
      simulateRun(d, party(comp, L, p), {
        mode: "aleatorio",
        random: randomSource(new Rng(9100 + i * 7919)),
      }).outcome === "vitoria"
    )
      w++;
  return Math.round((100 * w) / SEEDS);
}

const SIZES = [2, 3, 4, 5] as const;
const short = (c: readonly ClassId[]) => c.map((x) => x.slice(0, 3)).join("+");

for (const p of ["limite", "abaixo"] as Profile[]) {
  console.log(
    `\n== perfil ${p} (${SEEDS} corridas por grupo; % de vitória na Caçada do próprio nível)`,
  );
  for (const L of LEVELS) {
    const d = huntFor(L);
    const cells = SIZES.map(
      (n) =>
        `${n}: ${LIMIT_HUNT_GROUPS[n]!.map((c) => `${short(c)} ${wins(d, c, L, p)}`).join(" ")}`,
    );
    console.log(`L${L} ${d.id}  ${cells.join("  |  ")}`);
  }
}

// O que cada herói leva por corrida vencida, em relação ao trio (o XP pela corrida esperada do grupo).
console.log(
  "\n== por herói, corrida vencida, relação com o trio (XP · ouro · itens · Lendário por herói)",
);
for (const L of LEVELS) {
  const d = huntFor(L);
  const per = SIZES.map((n) => {
    const comp = LIMIT_HUNT_GROUPS[n]![0]!;
    const r = simulateRun(d, party(comp, L, "limite"), { mode: "esperado" });
    const rw = runRewards(
      d,
      comp.map(() => L),
      r,
    ).heroes;
    const xp = rw.reduce((a, h) => a + h.xp, 0) / rw.length;
    const gold = rw.reduce((a, h) => a + h.gold, 0) / rw.length;
    const odds = dungeonLootOdds(d, n, "mago");
    return {
      n,
      win: r.outcome,
      xp,
      gold,
      items: odds.perHero.items,
      leg: odds.perHero.expected.lendario,
    };
  });
  const trio = per.find((x) => x.n === 3)!;
  console.log(
    `L${L} ${d.id} (golpe ${JSON.stringify(DUNGEON_EDGE[d.id]?.party ?? {})})  ` +
      per
        .map(
          (x) =>
            `${x.n}: ${(x.xp / trio.xp).toFixed(2)} · ${(x.gold / trio.gold).toFixed(2)} · ${(x.items / trio.items).toFixed(2)} · ${(x.leg * 100).toFixed(2)}%${x.win === "vitoria" ? "" : " ✗"}`,
        )
        .join("  "),
  );
}
