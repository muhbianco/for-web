// Laboratório de golpes (24/11/2026, pedido do dono: "a habilidade deveria pegar o dano base e
// bater em cima"; "quanto mais end game, mais as habilidades vão contar"; "os magos precisam
// aproveitar melhor as skills do que o auto ataque"; "faça uma medição inclusive de status"; "a
// redução de cooldown precisa ser capada, baseada no level máximo 500").
//
// No grupo completo, na dungeon da faixa de cada level, para cada classe: o golpe normal médio, o
// golpe médio de cada habilidade (× o normal), a parte do dano que vem das habilidades, o dano por
// segundo e o corte de recarga da habilidade de ataque principal. Cada construção de atributos
// troca a de todas as classes juntas (padrão, mais DES, mais AGI, mais o atributo principal).
//
// Rodar (no space-core): node scripts/hit-lab.ts [--levels 27,60,120,224,350,500] [--seeds 8]
//   [--builds padrao,des,agi,principal] [--rebirths 0]
import {
  type StatId,
  type VocationId,
  abilitiesOf,
  abilityCooldownMs,
  abilityNow,
  derive,
  DUNGEONS,
  simulateRun,
  VOCATIONS,
} from "../src/game/ot/index.ts";
import { BUILDS, heroAt } from "./simHero.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const LEVELS = opt("levels", "27,60,120,224,350,500").split(",").map(Number);
const SEEDS = Number(opt("seeds", "8"));
const VARIANTS = opt("builds", "padrao,des,agi,principal").split(",");
const NAMES: Record<number, string> = { 4: "Cavaleiro", 3: "Arqueiro", 2: "Druida", 1: "Feiticeiro" };
const MAIN: Record<number, StatId> = { 4: "for", 3: "des", 2: "int", 1: "int" };
const BASE = structuredClone(BUILDS);

/** A construção da variante: +30 pontos percentuais no atributo, o resto na proporção de antes. */
function variant(cls: 1 | 2 | 3 | 4, v: string): Partial<Record<StatId, number>> {
  const b = { ...BASE[cls] };
  const stat: StatId | null = v === "des" ? "des" : v === "agi" ? "agi" : v === "principal" ? MAIN[cls]! : null;
  if (!stat) return b;
  const total = Object.values(b).reduce((x, y) => x + (y ?? 0), 0);
  for (const k of Object.keys(b) as StatId[]) b[k] = (b[k]! / total) * 0.7;
  b[stat] = (b[stat] ?? 0) + 0.3;
  return b;
}

const party: VocationId[] = [4, 3, 2, 1];
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
for (const L of LEVELS) {
  const d = [...DUNGEONS].reverse().find((x) => x.minLevel <= L)!;
  console.log(`\n== level ${L} · ${d.id}`);
  for (const v of VARIANTS) {
    for (const cls of [1, 2, 3, 4] as const) BUILDS[cls] = variant(cls, v);
    const heroes = party.map((voc) => heroAt(voc, L));
    const acc = party.map(() => ({ auto: [] as number[], ab: {} as Record<string, number[]>, abTotal: 0, autoTotal: 0, dmg: 0, secs: 0 }));
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = simulateRun({ seed: seed * 104729, dungeon: d.id, heroes, rateLoot: 2 });
      for (let i = 0; i < party.length; i++) {
        acc[i]!.dmg += r.members[i]!.damage;
        acc[i]!.secs += r.seconds;
      }
      for (const f of r.frames)
        for (const e of f.e as Array<{ k: string; a: number; b: number; v: unknown; s?: string; cura?: boolean }>) {
          if (typeof e.v !== "number" || e.b < 100 || e.cura || e.a < 0 || e.a >= party.length) continue;
          const a = acc[e.a]!;
          if (e.k === "golpe") {
            a.autoTotal += e.v;
            if (e.v > 0) a.auto.push(e.v);
          } else if (e.k === "magia" && e.s) {
            a.abTotal += e.v;
            if (e.v > 0) (a.ab[e.s] ??= []).push(e.v);
          }
        }
    }
    console.log(`  -- construção ${v}`);
    for (let i = 0; i < party.length; i++) {
      const voc = party[i]!;
      const h = heroes[i]!;
      const a = acc[i]!;
      const normal = avg(a.auto);
      const abs = Object.entries(a.ab)
        .sort()
        .map(([id, xs]) => `${id} ×${(avg(xs) / Math.max(1, normal)).toFixed(2)}`)
        .join(" · ");
      const share = Math.round((100 * a.abTotal) / Math.max(1, a.abTotal + a.autoTotal));
      // O corte de recarga da habilidade de ataque principal (a primeira de ataque da classe).
      const main = abilitiesOf(VOCATIONS[voc].base).find((x) => x.kind === "ataque")!;
      const now = abilityNow(main, h.tree ?? {}, h.mastery);
      const cut = Math.round(100 * (1 - abilityCooldownMs(now, derive(h.stats!, L)) / main.cooldownMs));
      console.log(
        `    ${NAMES[voc]!.padEnd(10)} normal ${String(Math.round(normal)).padStart(5)} · habilidades ${String(share).padStart(2)}% · dps ${String(Math.round(a.dmg / Math.max(1, a.secs))).padStart(5)} · recarga −${cut}% · ${abs}`,
      );
    }
  }
}
