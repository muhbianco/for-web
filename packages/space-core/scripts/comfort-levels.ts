// Mede o "confortável" de dungeons.ts (comfort): vence 70% ou mais, sozinho por vocação e em grupo.
// Rodar: node scripts/comfort-levels.ts (no space-core). Atualizar dungeons.ts com o resultado.
// Treino pelos heróis de produção (23/11/2026): skill principal ≈ 10 + 2·level (arqueiro 34 no 12),
// escudo ≈ 10 + level, magic level do mago ≈ level (druida 10 no 10). Kit inicial + 100 flechas; 5 poções.
import {
  type RunHero,
  type SkillId,
  type VocationId,
  addExperience,
  addItem,
  autoEquip,
  DUNGEONS,
  expForLevel,
  gearOf,
  simulateRun,
  START,
  starterInventory,
  VOCATIONS,
} from "../src/game/ot/index.ts";

function heroAt(vocation: VocationId, level: number, potions = 5): RunHero {
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
  const main = 10 + 2 * level;
  if (voc.base === 4) {
    skills.espada = main;
    skills.escudo = 10 + level;
  }
  if (voc.base === 3) {
    skills.distancia = main;
    skills.escudo = 10 + level;
  }
  const ml = voc.base === 1 || voc.base === 2 ? level : 0;
  const inv = starterInventory(voc.base, "mochila");
  if (voc.base === 3) addItem(inv, 100_000, "flecha", 100);
  const pot =
    voc.base === 1 || voc.base === 2
      ? "pocao-de-mana"
      : "pocao-pequena-de-vida";
  if (potions) addItem(inv, 100_000, pot, potions);
  autoEquip(inv, vocation, st.level, skills, st.manaMax);
  return {
    userId: `u${vocation}`,
    name: `H${vocation}`,
    vocation,
    level: st.level,
    healthMax: st.healthMax,
    manaMax: st.manaMax,
    skills,
    magicLevel: ml,
    stamina: 2520,
    gear: gearOf(inv),
    inv,
    cap: st.cap,
    supplies: {
      health: { item: potions && voc.base >= 3 ? pot : null, below: 50 },
      mana: { item: potions && voc.base <= 2 ? pot : null, below: 30 },
    },
    lootSkip: [],
  } as RunHero;
}

function winRate(dungeon: string, party: () => RunHero[], n = 120): number {
  let w = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = simulateRun({
      seed: seed * 104729,
      dungeon,
      heroes: party(),
      rateLoot: 2,
    });
    if (r.outcome === "vitoria") w++;
  }
  return w / n;
}

const LEVELS = [1, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 45, 50];
const parties: [string, (l: number) => RunHero[]][] = [
  ["cavaleiro sozinho", (l) => [heroAt(4, l)]],
  ["arqueiro sozinho", (l) => [heroAt(3, l)]],
  ["druida sozinho", (l) => [heroAt(2, l)]],
  ["feiticeiro sozinho", (l) => [heroAt(1, l)]],
  ["trio cav+arq+dru", (l) => [heroAt(4, l), heroAt(3, l), heroAt(2, l)]],
  [
    "quarteto +feiticeiro",
    (l) => [heroAt(4, l), heroAt(3, l), heroAt(2, l), heroAt(1, l)],
  ],
];
for (const d of DUNGEONS) {
  console.log(
    `\n== ${d.id} (entra L${d.minLevel}, no menu: trio ${d.comfort.group}, sozinho ${JSON.stringify(d.comfort.solo)})`,
  );
  for (const [label, mk] of parties) {
    const row: string[] = [];
    let comfy: number | null = null;
    for (const l of LEVELS) {
      if (l < d.minLevel) continue;
      const wr = winRate(d.id, () => mk(l));
      row.push(`${l}:${Math.round(wr * 100)}`);
      if (comfy === null && wr >= 0.7) comfy = l;
      if (wr >= 0.97 && row.length > 2) break;
    }
    console.log(
      `${label.padEnd(22)} confortável(≥70%) ${String(comfy ?? "—").padStart(3)} | ${row.join(" ")}`,
    );
  }
}
