/**
 * Sozinho × em grupo nas Caçadas (26/11/2026, pedido do dono: "o jogo é difícil e precisa de grupo;
 * herói sozinho não pode ter muito sucesso; farmar sozinho exige DG de nível mais baixo; a
 * referência sempre valendo no limite; herói fraco pesa").
 *
 * Para cada classe sozinha (kit solo), no perfil do limite e no de referência: a vitória na Caçada do
 * próprio nível, na de 10 abaixo e na de 20 abaixo. E a dupla e o trio da calibração no próprio nível.
 *
 *   node scripts/solo-gap.ts [--seeds 20] [--levels 45,60,90,150,250,400,490]
 */
import {
  type ClassId,
  type DungeonDef,
  type FighterInput,
  DUNGEONS,
  Rng,
  randomSource,
  simulateRun,
} from "../src/game/ot/balance/index.ts";
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
const CLASSES: ClassId[] = [
  "mago",
  "cacador",
  "assassino",
  "guerreiro",
  "paladino",
  "padre",
  "druida",
];
const HUNTS = DUNGEONS.filter((d) => d.kind === "cacada").sort(
  (a, b) => a.level - b.level,
);
/** A Caçada do nível (a mais alta que não passa dele), e as de 10 e 20 abaixo. */
function huntsFor(L: number): (DungeonDef | null)[] {
  const own = [...HUNTS].reverse().find((d) => d.level <= L) ?? HUNTS[0]!;
  const below = (n: number) =>
    [...HUNTS].reverse().find((d) => d.level <= own.level - n) ?? null;
  return [own, below(10), below(20)];
}
// D53: "abaixo" é o herói abaixo do limite (itens do nível, refino do farm, sem ups).
const solo = (cls: ClassId, L: number, profile: "limite" | "abaixo") =>
  profile === "limite"
    ? limitFighter(cls, L, { solo: true })
    : belowLimitFighter(cls, L, { solo: true });
const group = (comp: readonly ClassId[], L: number, profile: string) =>
  comp.map((c) =>
    profile === "limite" ? limitFighter(c, L) : belowLimitFighter(c, L),
  );

function wins(d: DungeonDef, party: () => FighterInput[]): number {
  let w = 0;
  for (let i = 0; i < SEEDS; i++)
    if (
      simulateRun(d, party(), {
        mode: "aleatorio",
        random: randomSource(new Rng(4200 + i)),
      }).outcome === "vitoria"
    )
      w++;
  return Math.round((100 * w) / SEEDS);
}

for (const profile of ["limite", "abaixo"] as const) {
  console.log(`\n== perfil ${profile} (${SEEDS} corridas por célula; % de vitória)`);
  console.log(
    `nível  Caçada(própria/−10/−20)  ${CLASSES.map((c) => c.slice(0, 4).padStart(14)).join("")}   dupla  trio`,
  );
  for (const L of LEVELS) {
    const hs = huntsFor(L);
    const cells = CLASSES.map((c) =>
      hs
        .map((d) => (d ? String(wins(d, () => [solo(c, L, profile)])) : "-"))
        .join("/")
        .padStart(14),
    );
    const g = (n: 2 | 3) =>
      Math.round(
        LIMIT_HUNT_GROUPS[n]!.map((comp) => wins(hs[0]!, () => group(comp, L, profile))).reduce((a, x) => a + x, 0) /
          LIMIT_HUNT_GROUPS[n]!.length,
      );
    console.log(
      `${String(L).padStart(5)}  ${hs.map((d) => (d ? d.level : "-")).join("/").padEnd(22)} ${cells.join("")}   ${String(g(2)).padStart(5)} ${String(g(3)).padStart(5)}`,
    );
  }
}
