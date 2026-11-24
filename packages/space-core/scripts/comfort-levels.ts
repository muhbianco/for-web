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
  type ItemDef,
  type JobTier,
  type RunHero,
  type SkillId,
  type StatId,
  type Stats,
  type Tree,
  type VocationId,
  addExperience,
  addItem,
  autoEquip,
  canUse,
  cannotLearn,
  DUNGEONS,
  expForLevel,
  freshStats,
  gearOf,
  gearStats,
  statScore,
  withGearStats,
  ITEMS,
  MERCHANT_SELLS,
  monsterDef,
  simulateRun,
  START,
  STAT_MAX,
  starterInventory,
  statPointsTotal,
  VOCATIONS,
  withInt,
  withVit,
} from "../src/game/ot/index.ts";

/** Construção típica por classe: a fração dos pontos em cada atributo. */
const BUILDS: Record<1 | 2 | 3 | 4, Partial<Record<StatId, number>>> = {
  4: { for: 0.45, vit: 0.35, agi: 0.1, des: 0.1 },
  3: { des: 0.5, agi: 0.25, vit: 0.15, sor: 0.1 },
  1: { int: 0.55, des: 0.25, vit: 0.2 },
  2: { int: 0.5, vit: 0.3, des: 0.2 },
};

/** A ordem em que a classe põe os pontos da árvore (cada adereço até o máximo). */
const PRIORITY: Record<1 | 2 | 3 | 4, string[]> = {
  4: [
    "golpe-brutal.forca", "atadura.forca", "desafio.presenca", "giro-da-lamina.forca",
    "atadura.reflexo", "golpe-brutal.economia", "giro-da-lamina.economia",
    "atadura.fechar-feridas", "desafio.muralha", "golpe-brutal.atordoar", "giro-da-lamina.sangria",
    "golpe-brutal.forca2", "atadura.forca2", "giro-da-lamina.forca2", "desafio.estrondo",
    "desafio.bastiao", "golpe-brutal.duplo", "giro-da-lamina.redemoinho", "atadura.economia",
    "golpe-brutal.ritmo", "giro-da-lamina.ritmo", "desafio.economia", "atadura.reflexo2", "desafio.eco",
  ],
  3: [
    "lanca-eterea.forca", "cura-de-campo.forca", "missil-sagrado.forca", "lanca-eterea.economia",
    "cura-de-campo.reflexo", "caldeira-sagrada.forca", "caldeira-sagrada.economia",
    "lanca-eterea.perfurar", "cura-de-campo.intensa", "missil-sagrado.luz", "caldeira-sagrada.consagrar",
    "lanca-eterea.forca2", "cura-de-campo.forca2", "missil-sagrado.forca2", "caldeira-sagrada.forca2",
    "lanca-eterea.dupla", "cura-de-campo.abrigo", "missil-sagrado.julgamento", "caldeira-sagrada.coro",
    "lanca-eterea.ritmo", "missil-sagrado.economia", "cura-de-campo.economia",
  ],
  1: [
    "remendo.cura-leve", "golpe-de-raio.forca", "onda-de-fogo.forca", "golpe-de-chama.forca",
    "remendo.reflexo", "onda-de-fogo.economia", "golpe-de-raio.economia", "remendo.intensa",
    "onda-de-fogo.grande-onda", "golpe-de-raio.corrente", "golpe-de-chama.combustao", "remendo.forca",
    "onda-de-fogo.forca2", "golpe-de-raio.forca2", "golpe-de-chama.forca2", "onda-de-fogo.tempestade",
    "golpe-de-raio.sobrecarga", "golpe-de-chama.chama-solar", "remendo.economia", "onda-de-fogo.ritmo",
  ],
  2: [
    "seiva.cura-leve", "cura-do-companheiro.forca", "golpe-de-gelo.forca", "onda-de-gelo.forca",
    "seiva.reflexo", "cura-do-companheiro.economia", "onda-de-gelo.economia", "seiva.intensa",
    "cura-do-companheiro.em-massa", "golpe-de-gelo.congelar", "onda-de-gelo.raizes", "seiva.forca",
    "cura-do-companheiro.forca2", "golpe-de-gelo.forca2", "onda-de-gelo.forca2", "seiva.abrigo",
    "golpe-de-gelo.estilhaco", "onda-de-gelo.inverno", "cura-do-companheiro.bencao", "seiva.economia",
  ],
};

function buildStats(cls: 1 | 2 | 3 | 4, level: number): Stats {
  const s = freshStats();
  const total = statPointsTotal(level);
  let left = total;
  for (const [k, f] of Object.entries(BUILDS[cls]) as [StatId, number][]) {
    const n = Math.min(STAT_MAX - 1, Math.floor(total * f));
    s[k] += n;
    left -= n;
  }
  // O que sobrou (arredondamento ou teto): VIT, depois o resto.
  for (const k of ["vit", "agi", "des", "sor", "for", "int"] as StatId[]) {
    const n = Math.min(STAT_MAX - s[k], left);
    s[k] += n;
    left -= n;
  }
  return s;
}

function buildTree(cls: 1 | 2 | 3 | 4, tier: JobTier, points: number): Tree {
  const t: Tree = {};
  let free = points;
  let progress = true;
  while (free > 0 && progress) {
    progress = false;
    for (const id of PRIORITY[cls]) {
      while (free > 0 && cannotLearn(t, id, cls, tier, free) === null) {
        t[id] = (t[id] ?? 0) + 1;
        free--;
        progress = true;
      }
    }
  }
  return t;
}

/**
 * Quando um item fica ao alcance: o kit e o que o mercador vende, desde o começo; o loot, depois
 * de umas corridas na dungeon que o dá (o level mínimo dela + 3).
 */
const AVAILABLE = new Map<string, number>();
for (const o of MERCHANT_SELLS) AVAILABLE.set(o.item, 0);
for (const d of DUNGEONS)
  for (const st of d.stages)
    for (const g of st.monsters)
      for (const e of monsterDef(g.id)?.loot ?? []) {
        const at = d.minLevel + 3;
        if ((AVAILABLE.get(e.item) ?? Infinity) > at) AVAILABLE.set(e.item, at);
      }

/** O melhor da classe no level, entre o que já está ao alcance; o automático escolhe. */
function bestGear(vocation: VocationId, level: number) {
  const voc = VOCATIONS[vocation];
  const inv = starterInventory(voc.base, "mochila");
  inv.equip.mochila = { item: "mochila", count: 1 };
  const usable = Object.values(ITEMS).filter(
    (d: ItemDef) =>
      d.slot !== null &&
      d.slot !== "mochila" &&
      !d.stackable &&
      canUse(d, voc.base, level) &&
      (AVAILABLE.get(d.id) ?? Infinity) <= level &&
      !d.charges &&
      !d.duration,
  );
  if (voc.base === 3) {
    const ammo = Object.values(ITEMS)
      .filter((d) => d.ammo === "flecha" && d.slot === "municao" && canUse(d, 3, level) && (AVAILABLE.get(d.id) ?? Infinity) <= level)
      .sort((a, b) => (b.attack ?? 0) - (a.attack ?? 0))[0];
    addItem(inv, Infinity, ammo?.id ?? "flecha", 100);
  }
  // Os de level mais alto primeiro (a mochila tem 20 espaços); depois de vestir, a mochila
  // esvazia para as poções e a munição.
  usable.sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0) || b.value - a.value);
  for (const d of usable) addItem(inv, Infinity, d.id, 1);
  return inv;
}

function heroAt(vocation: VocationId, level: number, potions = level < 10 ? 5 : level < 30 ? 15 : level < 50 ? 30 : 40): RunHero {
  const voc = VOCATIONS[vocation];
  const cls = voc.base as 1 | 2 | 3 | 4;
  const st = addExperience(
    voc,
    { level: 1, experience: 0, healthMax: START.health, manaMax: START.mana, cap: START.cap },
    expForLevel(level),
  );
  const skills = { punhos: 10, maca: 10, espada: 10, machado: 10, distancia: 10, escudo: 10 } as Record<SkillId, number>;
  const main = Math.min(10 + 2 * level, 50 + Math.floor(level / 2));
  const shield = Math.min(10 + level, 40 + Math.floor(level / 2));
  if (cls === 4) {
    skills.espada = main;
    skills.machado = main;
    skills.maca = main;
    skills.escudo = shield;
  }
  if (cls === 3) {
    skills.distancia = main;
    skills.escudo = shield;
  }
  const ml = cls <= 2 ? Math.min(70, level) : cls === 3 ? Math.floor(level / 3) : 0;
  const points = Math.min(60, level);
  const tier: JobTier = level >= 50 && points >= 24 ? 3 : level >= 20 && points >= 8 ? 2 : 1;
  const promoted = (tier >= 2 ? voc.promotion ?? vocation : vocation) as VocationId;
  const stats = buildStats(cls, level);
  const tree = buildTree(cls, tier, points);
  const inv = bestGear(vocation, level);
  const strong = level >= 50;
  const pot =
    cls <= 2
      ? strong ? "pocao-forte-de-mana" : "pocao-de-mana"
      : strong ? "pocao-forte-de-vida" : level < 10 ? "pocao-pequena-de-vida" : "pocao-de-vida";
  autoEquip(inv, promoted, st.level, skills, st.manaMax);
  // 24/11/2026: o melhor anel e o melhor colar de atributos (a escolha automática não mexe neles;
  // quem joga põe à mão). E os atributos dos itens entram, como no servidor (hero.ts).
  for (const slot of ["anel", "colar"] as const) {
    let best: string | null = null;
    let score = 0;
    for (const x of inv.pack) {
      const d = ITEMS[x.item];
      if (d?.slot !== slot || !d.stats) continue;
      const v = statScore(d, VOCATIONS[vocation].base);
      if (v > score) {
        score = v;
        best = d.id;
      }
    }
    if (best) inv.equip[slot] = { item: best, count: 1 };
  }
  const eff = withGearStats(stats, gearStats(inv));
  inv.pack = inv.pack.filter((x) => ITEMS[x.item]?.ammo !== undefined && ITEMS[x.item]?.slot === "municao");
  if (potions) addItem(inv, Infinity, pot, potions);
  return {
    userId: `u${vocation}`,
    name: `H${vocation}`,
    vocation: promoted,
    level: st.level,
    healthMax: withVit(st.healthMax, eff),
    manaMax: withInt(st.manaMax, eff),
    skills,
    magicLevel: ml,
    stamina: 2520,
    gear: gearOf(inv),
    inv,
    cap: 100_000,
    supplies: {
      health: { item: potions && cls >= 3 ? pot : null, below: 50 },
      mana: { item: potions && cls <= 2 ? pot : null, below: 30 },
    },
    lootSkip: [],
    stats: eff,
    tree,
  };
}

function winRate(dungeon: string, party: () => RunHero[], n: number): number {
  let w = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = simulateRun({ seed: seed * 104729, dungeon, heroes: party(), rateLoot: 2 });
    if (r.outcome === "vitoria") w++;
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
];
for (const d of DUNGEONS) {
  if (only.length && !only.includes(d.id)) continue;
  console.log(`\n== ${d.id} (entra L${d.minLevel}, no menu: trio ${d.comfort.group}, sozinho ${JSON.stringify(d.comfort.solo)})`);
  const levels: number[] = [];
  for (let l = d.minLevel; l <= d.minLevel + 40; l += l < 10 ? 1 : l < 30 ? 2 : 3) levels.push(l);
  for (const [label, mk] of parties) {
    const row: string[] = [];
    let comfy: number | null = null;
    for (const l of levels) {
      const wr = winRate(d.id, () => mk(l), SEEDS);
      row.push(`${l}:${Math.round(wr * 100)}`);
      if (comfy === null && wr >= 0.7) comfy = l;
      if (wr >= 0.97 && row.length > 2) break;
    }
    console.log(`${label.padEnd(20)} confortável(≥70%) ${String(comfy ?? "—").padStart(3)} | ${row.join(" ")}`);
  }
}
