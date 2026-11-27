import { dungeonById, dungeonRooms, dungeonType } from "../dungeons/catalog.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Monsters, createMonsters } from "../monsters/generate.ts";
import { type RewardKill, rewardsFor } from "./rewards.ts";

/**
 * Ganho por hora (a aba "Ganho" do medidor, 27/11/2026): o XP e o ouro que o herói levou em cada DG,
 * divididos pelo tempo de DG contando a largada entre uma corrida e a próxima (nas DGs curtas ela pesa
 * mais). O XP sai como as corridas rendem hoje: sem a stamina (o ×1,5 de um e o ×0,5 de outro no mesmo
 * grupo, até ela sair do jogo em 27/11/2026) e com a taxa do servidor de agora.
 */

/** Os multiplicadores de XP da stamina (TFS): cansado, normal, descansado. */
const STAMINA_MULTS = [0.5, 1, 1.5] as const;
/** Folga para reconhecer o multiplicador pela razão (o arredondamento e quem caiu e levantou). */
const SNAP_TOLERANCE = 0.04;
/** Intervalo depois do fim maior que isto não é largada: o jogador parou (não entra no tempo da DG). */
export const GAIN_MAX_LEAD_S = 60;
/** Quantas corridas a estatística lê, no máximo (as mais recentes). */
export const GAIN_MAX_RUNS = 3000;
/** As janelas que o app pede, em dias. */
export const GAIN_WINDOWS = [1, 7] as const;
export type GainWindow = (typeof GAIN_WINDOWS)[number];

/** Uma corrida fechada do ponto de vista de um herói. */
export interface GainRunRow {
  dungeon: string;
  outcome: string;
  /** Largada (ms). */
  startedAt: number;
  /** Segundos da corrida (os quadros). */
  seconds: number;
  /** Os níveis dos heróis na largada, na ordem da corrida. */
  levels: number[];
  /** Quem caiu, na ordem da corrida. */
  dead: boolean[];
  /** A posição do herói na corrida. */
  me: number;
  /** O que o herói levou (o XP já com a stamina e a taxa). */
  xp: number;
  jobXp: number;
  gold: number;
  /** Stamina × taxa gravada na largada (corridas a partir de 27/11/2026). */
  xpMult?: number;
}

export interface GainDungeon {
  dungeon: string;
  runs: number;
  wins: number;
  /** Corridas em que o herói caiu. */
  deaths: number;
  /** Segundos das corridas (os quadros). */
  runSeconds: number;
  /** Segundos com a largada: o divisor do "por hora". */
  cycleSeconds: number;
  /** O XP e o de job como rendem hoje (sem a stamina, com a taxa de `rate`). */
  xp: number;
  jobXp: number;
  gold: number;
}

export interface GainSummary {
  /** Da que mais rende XP por hora para a que menos rende. */
  dungeons: GainDungeon[];
  runs: number;
  /** A largada medida entre as corridas (mediana, segundos); 0 se nenhuma foi medida. */
  leadSeconds: number;
}

/**
 * O XP de cada herói numa vitória com todos vivos em todos os abates, antes da taxa (e da stamina antiga). As
 * salas são determinísticas (`dungeonRooms`), então a conta é exata: é o que a corrida rende a quem
 * não caiu. `null`: DG que o catálogo não conhece.
 */
export function createVictoryXp(
  B: Balance = gameBalance,
  M: Monsters = createMonsters(B),
) {
  const kills = new Map<string, Omit<RewardKill, "alive">[]>();
  return (dungeonId: string, levels: number[]): number[] | null => {
    const d = dungeonById(dungeonId);
    if (!d || levels.length === 0) return null;
    const key = `${d.id}:${levels.length}`;
    let list = kills.get(key);
    if (!list) {
      list = dungeonRooms(d, levels.length, M)
        .flat()
        .map((e) => ({
          archetype: e.archetype,
          level: e.level,
          summoned: false,
        }));
      kills.set(key, list);
    }
    const alive = levels.map(() => true);
    return rewardsFor(
      list.map((k) => ({ ...k, alive })),
      levels,
      dungeonType(d),
      true,
      B,
    ).heroes.map((h) => h.xp);
  };
}

/** O multiplicador de stamina × taxa mais perto da razão, se estiver dentro da folga. */
export function snapXpMult(ratio: number, rate = 1): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  let best: number | null = null;
  for (const m of STAMINA_MULTS) {
    const c = m * rate;
    if (Math.abs(ratio / c - 1) <= SNAP_TOLERANCE)
      if (best === null || Math.abs(ratio - c) < Math.abs(ratio - best))
        best = c;
  }
  return best;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Soma as corridas por DG. O tempo de cada corrida é o dela mais a largada até a próxima, quando a
 * próxima vem logo (até `GAIN_MAX_LEAD_S` depois do fim); sem a próxima logo depois, soma a largada
 * mediana das medidas. O multiplicador de XP de cada corrida: o gravado; senão o que a vitória com
 * todos vivos mostra (`victoryXp`); senão o da corrida mais perto no tempo (a stamina muda devagar);
 * senão a taxa. Dividido por ele e vezes a taxa de agora, é o que a corrida renderia hoje.
 */
export function gainByDungeon(
  input: readonly GainRunRow[],
  opts: {
    victoryXp?: (dungeon: string, levels: number[]) => number[] | null;
    rate?: number;
  } = {},
): GainSummary {
  const rate = opts.rate ?? 1;
  const rows = [...input].sort((a, b) => a.startedAt - b.startedAt);
  const leads: (number | null)[] = rows.map((r, i) => {
    const next = rows[i + 1];
    if (!next) return null;
    const lead = (next.startedAt - r.startedAt) / 1000 - r.seconds;
    return lead >= 0 && lead <= GAIN_MAX_LEAD_S ? lead : null;
  });
  const leadSeconds = median(leads.filter((x): x is number => x !== null));

  const known: (number | null)[] = rows.map((r) => {
    if (typeof r.xpMult === "number" && r.xpMult > 0) return r.xpMult;
    if (!opts.victoryXp || r.outcome !== "vitoria" || r.dead.some(Boolean))
      return null;
    const base = opts.victoryXp(r.dungeon, r.levels)?.[r.me];
    return base && base > 0 ? snapXpMult(r.xp / base, rate) : null;
  });
  const multOf = (i: number): number => {
    if (known[i] !== null) return known[i]!;
    for (let k = 1; k < rows.length; k++) {
      const a = known[i - k];
      const b = known[i + k];
      // Empate: a de antes (a stamina só cai durante a DG; a recuperação é fora dela).
      if (a !== undefined && a !== null) return a;
      if (b !== undefined && b !== null) return b;
    }
    return rate;
  };

  const by = new Map<string, GainDungeon>();
  rows.forEach((r, i) => {
    const id = dungeonById(r.dungeon)?.id ?? r.dungeon;
    let g = by.get(id);
    if (!g) {
      g = {
        dungeon: id,
        runs: 0,
        wins: 0,
        deaths: 0,
        runSeconds: 0,
        cycleSeconds: 0,
        xp: 0,
        jobXp: 0,
        gold: 0,
      };
      by.set(id, g);
    }
    g.runs++;
    if (r.outcome === "vitoria") g.wins++;
    if (r.dead[r.me]) g.deaths++;
    g.runSeconds += r.seconds;
    g.cycleSeconds += r.seconds + (leads[i] ?? leadSeconds);
    const today = rate / multOf(i);
    g.xp += r.xp * today;
    g.jobXp += r.jobXp * today;
    g.gold += r.gold;
  });
  const perHour = (g: GainDungeon) =>
    g.cycleSeconds > 0 ? g.xp / g.cycleSeconds : 0;
  const dungeons = [...by.values()]
    .map((g) => ({ ...g, xp: Math.round(g.xp), jobXp: Math.round(g.jobXp) }))
    .sort((a, b) => perHour(b) - perHour(a));
  return { dungeons, runs: rows.length, leadSeconds };
}

/** Por hora de DG (com a largada). */
export function gainPerHour(total: number, cycleSeconds: number): number {
  return cycleSeconds > 0 ? (total / cycleSeconds) * 3600 : 0;
}
