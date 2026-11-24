// Mede o "confortável" de dungeons.ts (comfort): vence 70% ou mais, sozinho por vocação e em grupo.
// Rodar: node scripts/comfort-levels.ts [dungeon …] [--seeds N] (no space-core). Atualizar
// dungeons.ts com o resultado. Pesado: rodar com prioridade baixa (nice) e uma rodada por vez.
//
// O herói medido (24/11/2026, depois dos atributos e da árvore):
// - treino: skill principal min(10 + 2·level, 50 + level/2) (o 10 + 2·level é o dos heróis de
//   produção de 23/11 até o 20; depois o treino desacelera), escudo min(10 + level, 40 + level/2),
//   magic level do mago = level (até 70), do arqueiro level/3;
// - atributos: os 5 pontos por level na construção típica da classe (BUILDS);
// - árvore: min(60, level) pontos na ordem de PRIORITY, a 2ª classe no 20 e a 3ª no 50;
// - equipamento: o melhor que a classe veste no level, entre todos os itens do jogo (quem chega no
//   level já passou pelas dungeons de antes: AVAILABLE), 100 da melhor munição e as poções
//   do level (5 pequenas abaixo do 10; 15, 30 e 40 depois: no OT a caçada vai com muitas).
import {
  type RunHero,
  DUNGEONS,
  MAX_LEVEL,
  monsterDef,
  simulateRun,
} from "../src/game/ot/index.ts";
import { heroAt } from "./simHero.ts";

/** Média de segundos e de experiência crua por membro das corridas medidas (a calibragem da experiência). */
const STATS_RUN = { seconds: 0, exp: 0, n: 0 };

function winRate(dungeon: string, party: () => RunHero[], n: number): number {
  let w = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = simulateRun({ seed: seed * 104729, dungeon, heroes: party(), rateLoot: 2 });
    if (r.outcome === "vitoria") w++;
    STATS_RUN.seconds += r.seconds;
    STATS_RUN.exp += r.members.reduce((a, m) => a + m.exp, 0) / r.members.length;
    STATS_RUN.n++;
  }
  return w / n;
}

const args = process.argv.slice(2);
const seedsAt = args.indexOf("--seeds");
const SEEDS = seedsAt >= 0 ? Number(args[seedsAt + 1]) : 80;
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--seeds");

// TUNE (só para afinar): {"dungeon": [vida, corpo a corpo, magia]} multiplica os monstros dela na memória.
const TUNE = JSON.parse(process.env.TUNE ?? "{}") as Record<string, [number, number, number]>;
for (const [id, [hp, mel, mag]] of Object.entries(TUNE)) {
  const d = DUNGEONS.find((x) => x.id === id);
  const ids = new Set(d?.stages.flatMap((st) => st.monsters.map((g) => g.id)) ?? []);
  for (const mid of ids) {
    const m = monsterDef(mid) as unknown as { health: number; attacks: { kind: string; min: number; max: number }[] };
    m.health = Math.round(m.health * hp);
    for (const a of m.attacks) {
      const k = a.kind === "melee" ? mel : mag;
      a.min = Math.round(a.min * k);
      a.max = Math.round(a.max * k);
    }
  }
}

const parties: [string, (l: number) => RunHero[]][] = [
  ["cavaleiro sozinho", (l) => [heroAt(4, l)]],
  ["arqueiro sozinho", (l) => [heroAt(3, l)]],
  ["druida sozinho", (l) => [heroAt(2, l)]],
  ["feiticeiro sozinho", (l) => [heroAt(1, l)]],
  ["trio cav+arq+dru", (l) => [heroAt(4, l), heroAt(3, l), heroAt(2, l)]],
  // --papeis: o grupo sem curandeiro e sem tanque (os papéis ainda importam?).
  ...(args.includes("--papeis")
    ? ([
        ["dupla cav+arq (sem cura)", (l: number) => [heroAt(4, l), heroAt(3, l)]],
        ["trio arq+dru+fei (sem tanque)", (l: number) => [heroAt(3, l), heroAt(2, l), heroAt(1, l)]],
        ["quarteto completo", (l: number) => [heroAt(4, l), heroAt(3, l), heroAt(2, l), heroAt(1, l)]],
      ] as [string, (l: number) => RunHero[]][])
    : []),
];
for (const d of DUNGEONS) {
  if (only.length && !only.includes(d.id)) continue;
  console.log(`\n== ${d.id} (entra L${d.minLevel}, no menu: trio ${d.comfort.group}, sozinho ${JSON.stringify(d.comfort.solo)})`);
  const levels: number[] = [];
  const span = Math.max(40, Math.round(d.minLevel * 0.3));
  for (let l = d.minLevel; l <= Math.min(MAX_LEVEL, d.minLevel + span); l += l < 10 ? 1 : l < 30 ? 2 : l < 100 ? 3 : 10) levels.push(l);
  if (levels.length < 2) levels.push(d.minLevel);
  for (const [label, mk] of parties) {
    const row: string[] = [];
    let comfy: number | null = null;
    for (const l of levels) {
      STATS_RUN.seconds = 0;
      STATS_RUN.exp = 0;
      STATS_RUN.n = 0;
      const wr = winRate(d.id, () => mk(l), SEEDS);
      if (l === d.minLevel && label.startsWith("trio cav"))
        console.log(`  (trio na entrada: ${Math.round(STATS_RUN.seconds / STATS_RUN.n)} s, ${Math.round(STATS_RUN.exp / STATS_RUN.n)} de experiência crua por membro)`);
      row.push(`${l}:${Math.round(wr * 100)}`);
      if (comfy === null && wr >= 0.7) comfy = l;
      if (wr >= 0.97 && row.length > 2) break;
    }
    console.log(`${label.padEnd(20)} confortável(≥70%) ${String(comfy ?? "—").padStart(3)} | ${row.join(" ")}`);
  }
}
