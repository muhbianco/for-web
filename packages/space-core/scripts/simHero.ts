// O herói do simulador (24/11/2026, separado do comfort-levels.ts): treino, atributos, árvore e
// equipamento típicos de um level, para medir dungeons (comfort-levels.ts) e o renascimento
// (rebirth-lab.ts) com o mesmo herói. Detalhes no topo do comfort-levels.ts.
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
  MAX_LEVEL,
  MERCHANT_OFFERS,
  monsterDef,
  simulateRun,
  START,
  statCost,
  starterInventory,
  statPointsTotal,
  VOCATIONS,
  withInt,
  withVit,
} from "../src/game/ot/index.ts";

/** Construção típica por classe: a fração dos pontos em cada atributo. */
export const BUILDS: Record<1 | 2 | 3 | 4, Partial<Record<StatId, number>>> = {
  4: { for: 0.45, vit: 0.35, agi: 0.1, des: 0.1 },
  3: { des: 0.5, agi: 0.25, vit: 0.15, sor: 0.1 },
  1: { int: 0.55, des: 0.25, vit: 0.2 },
  2: { int: 0.5, vit: 0.3, des: 0.2 },
};

/** A ordem em que a classe põe os pontos da árvore (cada adereço até o máximo). */
export const PRIORITY: Record<1 | 2 | 3 | 4, string[]> = {
  4: [
    "golpe-brutal.forca", "atadura.forca", "desafio.presenca", "giro-da-lamina.forca",
    "atadura.reflexo", "golpe-brutal.economia", "giro-da-lamina.economia",
    "atadura.fechar-feridas", "desafio.muralha", "golpe-brutal.atordoar", "giro-da-lamina.sangria",
    "golpe-brutal.forca2", "atadura.forca2", "giro-da-lamina.forca2", "desafio.estrondo",
    "desafio.bastiao", "golpe-brutal.duplo", "giro-da-lamina.redemoinho", "atadura.economia",
    "golpe-brutal.ritmo", "giro-da-lamina.ritmo", "desafio.economia", "atadura.reflexo2", "desafio.eco",
  ],
  3: [
    "rajada-dupla.forca", "concentracao.foco", "chuva-de-flechas.forca", "flecha-carregada.forca",
    "rajada-dupla.economia", "concentracao.folego", "chuva-de-flechas.economia",
    "rajada-dupla.perfurante", "concentracao.economia", "chuva-de-flechas.farpas",
    "flecha-carregada.economia", "flecha-carregada.impacto", "rajada-dupla.forca2",
    "concentracao.foco2", "chuva-de-flechas.forca2", "flecha-carregada.forca2",
    "rajada-dupla.tripla", "chuva-de-flechas.tormenta", "flecha-carregada.trespassar",
    "concentracao.olho-de-aguia", "rajada-dupla.ritmo", "chuva-de-flechas.ritmo",
    "flecha-carregada.ritmo", "concentracao.ritmo",
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

/**
 * Os pontos do level na construção da classe, pela escada de custo (24/11/2026): um ponto por vez
 * no atributo mais abaixo da fração dele (pelo valor), enquanto o custo couber.
 */
export function buildStats(cls: 1 | 2 | 3 | 4, level: number): Stats {
  const s = freshStats();
  let left = statPointsTotal(level);
  const w = BUILDS[cls];
  const keys = Object.keys(w) as StatId[];
  for (;;) {
    let pick: StatId | null = null;
    for (const k of keys)
      if (statCost(s[k]) <= left && (!pick || s[k] / w[k]! < s[pick] / w[pick]!)) pick = k;
    if (!pick) break;
    left -= statCost(s[pick]);
    s[pick]++;
  }
  return s;
}

export function buildTree(cls: 1 | 2 | 3 | 4, tier: JobTier, points: number): Tree {
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
for (const o of MERCHANT_OFFERS) AVAILABLE.set(o.item, 0);
for (const d of DUNGEONS)
  for (const st of d.stages)
    for (const g of st.monsters)
      for (const e of monsterDef(g.id)?.loot ?? []) {
        const at = d.minLevel + 3;
        if ((AVAILABLE.get(e.item) ?? Infinity) > at) AVAILABLE.set(e.item, at);
      }

/** O melhor da classe no level, entre o que já está ao alcance; o automático escolhe. */
export function bestGear(vocation: VocationId, level: number) {
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
    // A melhor flecha e o melhor virote ao alcance (o arco ou a besta escolhe a sua).
    for (const type of ["flecha", "virote"] as const) {
      const ammo = Object.values(ITEMS)
        .filter((d) => d.ammo === type && d.slot === "municao" && canUse(d, 3, level) && (AVAILABLE.get(d.id) ?? Infinity) <= level)
        .sort((a, b) => (b.attack ?? 0) - (a.attack ?? 0))[0];
      addItem(inv, Infinity, ammo?.id ?? type, 100);
    }
  }
  // Os de level mais alto primeiro (a mochila tem 20 espaços); depois de vestir, a mochila
  // esvazia para as poções e a munição.
  usable.sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0) || b.value - a.value);
  for (const d of usable) addItem(inv, Infinity, d.id, 1);
  return inv;
}

export function heroAt(vocation: VocationId, level: number, potions = level < 10 ? 5 : level < 30 ? 15 : level < 50 ? 30 : level < 120 ? 40 : 60): RunHero {
  const voc = VOCATIONS[vocation];
  const cls = voc.base as 1 | 2 | 3 | 4;
  const st = addExperience(
    voc,
    { level: 1, experience: 0, healthMax: START.health, manaMax: START.mana, cap: START.cap },
    expForLevel(level),
  );
  const skills = { punhos: 10, maca: 10, espada: 10, machado: 10, distancia: 10, escudo: 10 } as Record<SkillId, number>;
  // O treino do OT é exponencial: depois do 100 a skill quase para (≈116 no 500).
  const main =
    level <= 100
      ? Math.min(10 + 2 * level, 50 + Math.floor(level / 2))
      : 100 + Math.floor((level - 100) / 25);
  const shield =
    level <= 100
      ? Math.min(10 + level, 40 + Math.floor(level / 2))
      : 90 + Math.floor((level - 100) / 25);
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
  const ml =
    cls <= 2
      ? level <= 70
        ? level
        : 70 + Math.floor((level - 70) / 10)
      : cls === 3
        ? Math.min(40, Math.floor(level / 3))
        : 0;
  const points = Math.min(70, level);
  const tier: JobTier = level >= 50 && points >= 24 ? 3 : level >= 20 && points >= 8 ? 2 : 1;
  const promoted = (tier >= 2 ? voc.promotion ?? vocation : vocation) as VocationId;
  const stats = buildStats(cls, level);
  const tree = buildTree(cls, tier, points);
  const inv = bestGear(vocation, level);
  const strong = level >= 50;
  const pot =
    cls <= 2
      ? level >= 250 ? "pocao-suprema-de-mana" : level >= 120 ? "pocao-grande-de-mana" : strong ? "pocao-forte-de-mana" : "pocao-de-mana"
      : cls === 4 && level >= 250
        ? "pocao-suprema-de-vida"
        : level >= 120
          ? "pocao-grande-de-vida"
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

