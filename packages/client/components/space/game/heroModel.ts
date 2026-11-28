import {
  type ArchetypeKey,
  type ClassId,
  type Effect,
  type EnemyInput,
  type GearSlot,
  type HeroStats,
  type HeroV5,
  type ItemInstance,
  type OwnedItem,
  type PotionSize,
  type SkillBuild,
  type SkillContent,
  type SkillDef,
  type Stat,
  type Tier,
  AUTO_SLOTS,
  autoEquipBag,
  balance as B,
  balanceHero,
  cannotEquip,
  CLASSES,
  compileSkill,
  createMonsters,
  createReference,
  dungeonById,
  dungeonRooms,
  equipItem,
  evolve,
  freshBuild,
  GEAR_SLOTS,
  heroDerived,
  itemName,
  itemPerks,
  legendaryMods,
  legendaryOf,
  levelProgress,
  perkRangeText,
  PERKS,
  perkText,
  perkValueText,
  POTION_SIZES,
  potionPrice,
  roleScore,
  scoreHero,
  skillManaCostFor,
  skillPoints,
  skillPointsSpent,
  SKILLS_BY_CLASS,
  spendPoint,
  treeCapacity,
} from "@muchat/space-core/game/ot/balance";

/**
 * O que as telas do Idle Hunt mostram, calculado no app com as funções puras do núcleo (o servidor
 * manda só o herói v5; spec §0.2: nada derivado é salvo). Sem texto traduzido aqui (os textos
 * ficam em `gameText.ts`), para este arquivo rodar nos testes do node.
 */

const R = createReference(B);

// ------------------------------------------------------------ números

const intFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** 12.345 */
export const num = (n: number) => intFmt.format(Math.round(n));
/** 11,5 (uma casa, só quando tem). */
export const num1 = (n: number) => oneFmt.format(n);
/** 0,34 → "34%"; com casa decimal abaixo de 10%. */
export function pct(x: number): string {
  const v = x * 100;
  return `${Math.abs(v) < 10 && v !== 0 ? oneFmt.format(v) : intFmt.format(v)}%`;
}
/** Ouro: 1.234, 12,3 mil, 1,2 mi (a tela estreita não cabe o número inteiro). */
export function gold(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${oneFmt.format(n / 1e6)} mi`;
  if (a >= 1e5) return `${intFmt.format(n / 1e3)} mil`;
  return intFmt.format(n);
}

// ------------------------------------------------------------ progresso

export interface HeroBars {
  level: number;
  xp: { into: number; need: number; frac: number };
  job: number;
  jobXp: { into: number; need: number; frac: number };
  tier: Tier;
  /** O nome da linha (o título do T2) e o título do tier. */
  className: string;
  title: string;
  maxLevel: boolean;
}

export function heroBars(h: HeroV5): HeroBars {
  const lp = levelProgress(h);
  const lv = B.cfg.levels;
  const jobBase = B.jobXpTotalAt(h.job);
  const jobNeed = h.job >= lv.maxJob ? 0 : B.jobXpToNext(h.job);
  const jobInto = Math.max(0, h.jobXp - jobBase);
  const c = CLASSES[h.cls];
  return {
    level: h.level,
    xp: {
      into: lp.into,
      need: lp.need,
      frac: lp.need > 0 ? Math.min(1, lp.into / lp.need) : 1,
    },
    job: h.job,
    jobXp: {
      into: jobInto,
      need: jobNeed,
      frac: jobNeed > 0 ? Math.min(1, jobInto / jobNeed) : 1,
    },
    tier: h.skills.tier,
    className: c.titles[1],
    title: c.titles[h.skills.tier - 1]!,
    maxLevel: h.level >= lv.maxLevel,
  };
}

/** O que está pendente na ficha (o selo nas abas: "o que importa agora"). */
export function pending(h: HeroV5) {
  const attr =
    B.attributePoints(h.level) -
    Object.values(h.attrs).reduce((a, v) => a + B.statCostTo(v), 0);
  const free = skillPoints(h.job) - skillPointsSpent(h.skills);
  const room = treeCapacity(h.cls, h.skills);
  return {
    attrPoints: Math.max(0, attr),
    skillPoints: Math.max(0, Math.min(free, room)),
    /** Pontos de job sem onde gastar no tier (esperando a evolução no Mestre). */
    skillPointsHeld: Math.max(0, free - room),
    canEvolve: evolveCheck(h).ok,
    upgrades: Object.values(bagMarks(h)).filter((m) => m.mark === "up").length,
  };
}

// ------------------------------------------------------------ derivados e comparação

export const derivedOf = (h: HeroV5): HeroStats => heroDerived(balanceHero(h));

export type DerivedKey =
  | "hp"
  | "mp"
  | "atk"
  | "matk"
  | "def"
  | "mdef"
  | "hit"
  | "flee"
  | "critRating"
  | "attacksPerSecond"
  | "cooldownCut"
  | "block";

/** O que importa para cada classe, na ordem em que aparece (o resto fica no "ver tudo"). */
export const DERIVED_MAIN: Record<ClassId, DerivedKey[]> = {
  guerreiro: ["hp", "def", "mdef", "atk", "block"],
  paladino: ["hp", "def", "mdef", "atk", "block"],
  padre: ["matk", "mp", "hp", "mdef", "def"],
  druida: ["matk", "mp", "hp", "mdef", "def"],
  mago: ["matk", "mp", "hp", "mdef", "cooldownCut"],
  cacador: ["atk", "hit", "critRating", "attacksPerSecond", "hp"],
  assassino: ["atk", "critRating", "flee", "attacksPerSecond", "hp"],
};
export const DERIVED_ALL: DerivedKey[] = [
  "hp",
  "mp",
  "atk",
  "matk",
  "def",
  "mdef",
  "hit",
  "flee",
  "critRating",
  "attacksPerSecond",
  "cooldownCut",
  "block",
];

export interface DerivedRow {
  key: DerivedKey;
  a: number;
  b: number;
  /** +1 melhora, −1 piora, 0 igual (todo derivado aqui é "mais é melhor"). */
  dir: -1 | 0 | 1;
}

/** Valor como a tela mostra (inteiro, % ou por segundo com 2 casas). */
export function derivedText(key: DerivedKey, v: number): string {
  if (key === "cooldownCut" || key === "block") return pct(v);
  if (key === "attacksPerSecond") return v.toFixed(2).replace(".", ",");
  return num(v);
}

export function derivedDiff(
  a: HeroStats,
  b: HeroStats,
  keys: DerivedKey[] = DERIVED_ALL,
): DerivedRow[] {
  return keys.map((key) => {
    const x = a[key] as number;
    const y = b[key] as number;
    const eps =
      key === "attacksPerSecond"
        ? 0.005
        : key === "cooldownCut" || key === "block"
          ? 0.0005
          : 0.5;
    return { key, a: x, b: y, dir: Math.abs(y - x) < eps ? 0 : y > x ? 1 : -1 };
  });
}

// ------------------------------------------------------------ itens

export function equippedIn(h: HeroV5, slot: GearSlot): OwnedItem | undefined {
  return (h.equipment as Record<string, OwnedItem | undefined>)[slot];
}

export function findItem(
  h: HeroV5,
  uid: string,
): { item: OwnedItem; where: "bag" | "equip" } | null {
  const b = h.bag.find((x) => x.uid === uid);
  if (b) return { item: b, where: "bag" };
  for (const x of Object.values(h.equipment))
    if (x?.uid === uid) return { item: x as OwnedItem, where: "equip" };
  return null;
}

export type BagMark = "up" | "down" | "same" | "blocked";

/**
 * A comparação de cada item da mochila com o vestido, pela MESMA nota do "escolher o melhor
 * sozinho" (§9.8: dano por segundo contra o chefe do nível, HP efetivo, cura), não por pesos à parte.
 * `blocked` traz o motivo (classe, peso, nível, mãos). Custa ~0,5 ms por item.
 */
export function bagMarks(
  h: HeroV5,
): Record<string, { mark: BagMark; score: number; reason?: string }> {
  const out: Record<string, { mark: BagMark; score: number; reason?: string }> =
    {};
  const role = CLASSES[h.cls].role;
  const base = scoreHero(balanceHero(h), h.skills, B, R);
  for (const it of h.bag) {
    const r = equipItem(h, it.uid);
    if (!r.ok) {
      out[it.uid] = { mark: "blocked", score: 0, reason: r.error };
      continue;
    }
    const s = roleScore(
      role,
      scoreHero(balanceHero(r.hero), h.skills, B, R),
      base,
    );
    out[it.uid] = {
      mark: s > 1.005 ? "up" : s < 0.995 ? "down" : "same",
      score: s,
    };
  }
  return out;
}

/** Vestir este item: o herói depois (para a prévia dos derivados) ou por que não dá. */
export function equipPreview(
  h: HeroV5,
  uid: string,
): { ok: true; after: HeroV5 } | { ok: false; error: string } {
  const r = equipItem(h, uid);
  return r.ok ? { ok: true, after: r.hero } : { ok: false, error: r.error };
}

export interface AutoPlan {
  /** O que troca: o que sai (ou nada) e o que entra. */
  changes: { slot: GearSlot; from?: OwnedItem; to: OwnedItem }[];
  /** Trocas que esbarram num item +7 ou mais: só com confirmação, uma a uma (§9.8). */
  confirm: { slot: GearSlot; current: OwnedItem; candidate: OwnedItem }[];
  after: HeroV5;
}

/** A prévia do "escolher o melhor sozinho": roda o mesmo autoEquip do servidor aqui. */
export function autoPlan(h: HeroV5): AutoPlan | null {
  const r = autoEquipBag(h);
  if (!r.ok) return null;
  const changes: AutoPlan["changes"] = [];
  for (const slot of AUTO_SLOTS) {
    const a = equippedIn(h, slot);
    const b = equippedIn(r.hero, slot);
    if (b && b.uid !== a?.uid)
      changes.push({ slot, ...(a ? { from: a } : {}), to: b });
  }
  const confirm: AutoPlan["confirm"] = [];
  for (const c of r.confirm) {
    const current = equippedIn(h, c.slot);
    const candidate = h.bag.find((x) => x.uid === c.uid);
    if (current && candidate)
      confirm.push({ slot: c.slot, current, candidate });
  }
  return { changes, confirm, after: r.hero };
}

/** Por que não veste (null = veste). */
export function cannotWear(h: HeroV5, item: ItemInstance): string | null {
  return cannotEquip(balanceHero(h), item, B);
}

export const GEAR_ORDER = GEAR_SLOTS;

// ------------------------------------------------------------ cinto (D35)

export interface BeltOption {
  size: PotionSize;
  stock: number;
  /** Cura de cada poção (fixa, pela faixa de nível do herói) e a recarga depois de beber. */
  heal: number;
  cooldownS: number;
  /** Cura por segundo (a mesma nos 3 tamanhos: D35). */
  perSecond: number;
  price: number;
  equipped: boolean;
}

/** Cura de uma poção de `size` no nível (a faixa do herói; D35) e a recarga depois do gole. */
export function potionOf(
  kind: "hp" | "mp",
  size: PotionSize,
  level: number,
): { heal: number; cooldownMs: number } {
  const s = B.cfg.potions.sizes[size];
  const base = kind === "hp" ? R.potionHp(level) : R.potionMp(level);
  return { heal: Math.round(base * s.mult), cooldownMs: s.cooldownMs };
}

export function beltOptions(h: HeroV5, kind: "hp" | "mp"): BeltOption[] {
  const base = kind === "hp" ? R.potionHp(h.level) : R.potionMp(h.level);
  const price = potionPrice(h.level)[kind];
  return POTION_SIZES.map((size) => {
    const s = B.cfg.potions.sizes[size];
    const heal = Math.round(base * s.mult);
    return {
      size,
      stock: h.potions[kind][size],
      heal,
      cooldownS: s.cooldownMs / 1000,
      perSecond: heal / (s.cooldownMs / 1000),
      price: price * s.mult,
      equipped: h.belt[kind] === size,
    };
  });
}

// ------------------------------------------------------------ skills (§7)

export interface MainNumber {
  kind: "dano" | "cura" | "escudo" | "apoio";
  /** O número esperado contra um alvo (ATQ/MATQ/HP do herói já aplicados). */
  value: number;
}

/** O número principal de uma skill compilada (dano, cura ou escudo), para a prévia de Potência. */
export function mainNumber(def: SkillDef, d: HeroStats): MainNumber {
  let dano = 0;
  let cura = 0;
  let escudo = 0;
  const of = (e: Effect) => {
    switch (e.type) {
      case "dano":
        for (const p of e.parts)
          dano +=
            p.coef * (p.element === "magico" ? d.matk : d.atk) * (e.hits ?? 1);
        return;
      case "dot":
        dano +=
          e.coefPerSec *
          (e.element === "magico" ? d.matk : d.atk) *
          (e.durationMs / 1000);
        return;
      case "cura":
        cura += (e.coefMatk ?? 0) * d.matk + (e.pctMaxHp ?? 0) * d.hp;
        return;
      case "hot":
        cura +=
          ((e.coefMatkPerSec ?? 0) * d.matk + (e.pctMaxHpPerSec ?? 0) * d.hp) *
          (e.durationMs / 1000);
        return;
      case "escudo":
        escudo += (e.pctMaxHp ?? 0) * d.hp + (e.coefMatk ?? 0) * d.matk;
        return;
      default:
        return;
    }
  };
  for (const e of def.effects) of(e);
  if (dano > 0) return { kind: "dano", value: dano };
  if (cura > 0) return { kind: "cura", value: cura };
  if (escudo > 0) return { kind: "escudo", value: escudo };
  return { kind: "apoio", value: 0 };
}

export interface SkillNumbers {
  main: MainNumber;
  mana: number;
  cooldownS: number;
  /** A skill como o motor recebe (com os efeitos de lendário), para o texto do detalhe. */
  def: SkillDef;
}

export function skillNumbers(
  h: HeroV5,
  s: SkillContent,
  build: SkillBuild,
  d: HeroStats = derivedOf(h),
  /** false: a mesma skill sem os perks vestidos (a comparação do detalhe, 27/11/2026). */
  withPerks = true,
): SkillNumbers {
  // Com os lendários vestidos, como o motor monta o kit (fighter.ts): a ficha e a corrida batem.
  const def = compileSkill(
    s,
    build,
    h.skills.ai[s.id],
    B,
    withPerks ? (legendaryMods(h.equipment)[s.id] ?? []) : [],
  );
  // A mesma conta do motor (combat/fight.ts): nunca abaixo de 50% da base.
  const base = (def.baseCooldownMs ?? def.cooldownMs) / 1000;
  return {
    main: mainNumber(def, d),
    mana: skillManaCostFor(def, d, B),
    cooldownS: Math.max(
      B.cfg.cooldown.floorOfBase * base,
      (def.cooldownMs / 1000) *
        (1 - d.cooldownCut) *
        (1 - (def.ownCooldownCut ?? 0)),
    ),
    def,
  };
}

/** Um perk lendário vestido que fortalece a skill: de que item, o que faz e quanto saiu. */
export interface SkillPerkSource {
  item: string;
  slot: GearSlot;
  text: string;
  value: string;
  /** A faixa do perk ("de 8% a 16%"); null se for fixo. */
  range: string | null;
}

/**
 * Os perks lendários vestidos que mexem nesta skill (27/11/2026). O mesmo perk em mais de um item
 * soma (items/legendary.ts): cada item aparece.
 */
export function skillPerkSources(
  h: HeroV5,
  skillId: string,
): SkillPerkSource[] {
  const out: SkillPerkSource[] = [];
  for (const [slot, it] of Object.entries(h.equipment) as [
    GearSlot,
    OwnedItem | undefined,
  ][]) {
    if (!it) continue;
    for (const p of itemPerks(it)) {
      const t = PERKS[p.skill];
      const text = perkText(p);
      if (p.skill !== skillId || !t || !text) continue;
      out.push({
        item: itemName(it, legendaryOf(it)?.name),
        slot,
        text,
        value: perkValueText(t, p.value),
        range: perkRangeText(p.skill),
      });
    }
  }
  return out;
}

export interface SkillRow {
  content: SkillContent;
  learned: boolean;
  build: SkillBuild;
  /** 0–3 nos slots, ou −1. */
  slot: number;
  numbers: SkillNumbers;
  mechanics: {
    id: string;
    name: string;
    text: string;
    ups: number;
    unlockTier: number;
    locked: boolean;
  }[];
}

export function skillRows(h: HeroV5, skills = h.skills): SkillRow[] {
  const d = derivedOf(h);
  return SKILLS_BY_CLASS[h.cls].map((s) => {
    const learned = s.tier <= skills.tier && !!skills.builds[s.id];
    const build = skills.builds[s.id] ?? freshBuild();
    return {
      content: s,
      learned,
      build,
      slot: skills.slots.indexOf(s.id),
      numbers: skillNumbers({ ...h, skills }, s, build, d),
      mechanics: s.mechanics.map((m) => ({
        id: m.id,
        name: m.name,
        text: m.text,
        ups: build.mechanics[m.id] ?? 0,
        unlockTier: m.unlockTier,
        locked: m.unlockTier > skills.tier,
      })),
    };
  });
}

export type SpendTarget = "potencia" | "eficiencia" | { mechanic: string };

/** Marca 1 ponto no rascunho (a mesma regra do servidor): o rascunho novo ou o motivo. */
export function stageSpend(
  h: HeroV5,
  draft: HeroV5["skills"],
  skill: string,
  target: SpendTarget,
) {
  return spendPoint(h.cls, h.job, draft, skill, target);
}

export function skillBudget(h: HeroV5, skills = h.skills) {
  const total = skillPoints(h.job);
  const spent = skillPointsSpent(skills);
  return {
    total,
    spent,
    free: total - spent,
    room: treeCapacity(h.cls, skills),
    potencyCap: B.potencyCap(skills.tier),
    efficiencyMax: B.cfg.skills.efficiencyMax,
    mechanicMax: B.cfg.skills.mechanicMax,
  };
}

// ------------------------------------------------------------ Mestre (§6, §10)

export interface EvolveCheck {
  ok: boolean;
  next: Tier | null;
  /** Os marcos, todos pelo job (D51): job 20 (T2), 40 (T3) e 70 (T4). */
  milestone: {
    kind: "job";
    need: number;
    have: number;
    ok: boolean;
  } | null;
  /** Pontos que ainda cabem na árvore do tier (precisa zerar; P38). */
  pointsLeft: number;
  newSkills: SkillContent[];
  newTitle: string | null;
  error: string | null;
}

/** O job que abre o tier (D51): 1 no T1, 20 no T2, 40 no T3, 70 no T4. */
export function tierJob(tier: Tier): number {
  const t = B.cfg.tiers;
  return tier === 1 ? 1 : tier === 2 ? t.t2Job : tier === 3 ? t.t3Job : t.t4Job;
}

export function evolveCheck(h: HeroV5): EvolveCheck {
  const tier = h.skills.tier;
  if (tier >= 4)
    return {
      ok: false,
      next: null,
      milestone: null,
      pointsLeft: 0,
      newSkills: [],
      newTitle: null,
      error: "tier-maximo",
    };
  const next = (tier + 1) as Tier;
  const milestone = { kind: "job" as const, need: tierJob(next), have: h.job };
  const free = skillPoints(h.job) - skillPointsSpent(h.skills);
  const pointsLeft = Math.max(0, Math.min(free, treeCapacity(h.cls, h.skills)));
  const r = evolve(h.cls, h.job, h.skills);
  return {
    ok: r.ok,
    next,
    milestone: { ...milestone, ok: milestone.have >= milestone.need },
    pointsLeft,
    newSkills: SKILLS_BY_CLASS[h.cls].filter((s) => s.tier === next),
    newTitle: CLASSES[h.cls].titles[next - 1]!,
    error: r.ok ? null : r.error,
  };
}

export function respecCosts(h: HeroV5) {
  return {
    attrs: B.respecCost(h.attrResets),
    skills: B.respecCost(h.skills.resets),
  };
}

// ------------------------------------------------------------ DGs (§12; a escolha na TV mora em dungeonUi.ts)

export const dungeonOf = (id: string) => dungeonById(id);

// ------------------------------------------------------------ corrida

let monsters: ReturnType<typeof createMonsters> | null = null;

/** As 4 salas da corrida (determinístico pelo id e pelo tamanho do grupo). */
export function runRooms(dungeon: string, members: number): EnemyInput[][] {
  const d = dungeonById(dungeon);
  if (!d) return [];
  monsters ??= createMonsters(B);
  return dungeonRooms(d, members, monsters);
}

export const BOSS_ARCHETYPES: ReadonlySet<ArchetypeKey> = new Set([
  "chefeMenor",
  "chefe",
  "regional",
]);

// ------------------------------------------------------------ Dojô (§2)

/** O relógio do servidor agora, pelo que ele mandou e o tempo que passou aqui. */
export const serverClock = (
  rpg: { serverNow: number; at: number },
  now = Date.now(),
) => rpg.serverNow + (now - rpg.at);

export interface DojoNow {
  stored: number;
  effective: number;
  recommended: number;
  /** XP dentro da Proficiência atual e quanto falta para a próxima. */
  into: number;
  need: number;
  /** Quanto subiu neste treino (projetado; o servidor credita ao parar). */
  gained: number;
  /** XP por segundo agora, com os colegas na zona (cada um dá +5%, até +25%). */
  perSecond: number;
  /** Quantos treinam junto agora e o bônus deles (0,15 = +15%). */
  peers: number;
  bonus: number;
  /** A Proficiência guardada já passou do teto do nível: o treino fica guardado até subir. */
  capped: boolean;
}

/**
 * O treino projetado. `peers`: quem treina junto agora (a conta da tela usa a taxa de agora para o
 * treino todo; o servidor credita a média do tempo, a cada mudança de quem está no boneco).
 */
export function dojoNow(
  state: { hero: HeroV5; dojo: { since: number } | null },
  now: number,
  peers = 0,
): DojoNow {
  let b = state.hero.proficiency;
  let xp = state.hero.proficiencyXp;
  const perSecond = B.proficiencyXpPerSecond(peers);
  const bonus = perSecond / B.proficiencyXpPerSecond(0) - 1;
  if (state.dojo) {
    xp += Math.max(0, (now - state.dojo.since) / 1000) * perSecond;
    const max = B.cfg.levels.maxProficiency;
    while (b < max && xp >= B.proficiencyXpToNext(b)) {
      xp -= B.proficiencyXpToNext(b);
      b++;
    }
  }
  const effective = B.effectiveProficiency(b, state.hero.level);
  return {
    stored: b,
    effective,
    recommended: B.recommendedProficiency(state.hero.level),
    into: xp,
    need: B.proficiencyXpToNext(b),
    gained: b - state.hero.proficiency,
    perSecond,
    peers,
    bonus,
    capped: b > effective,
  };
}

// ------------------------------------------------------------ atributos

export const STAT_ORDER: Stat[] = ["FOR", "AGI", "VIT", "INT", "DES", "SOR"];

/** A sugestão da classe (a build de referência, §6): a fatia de cada atributo. */
export function suggestion(cls: ClassId): Partial<Record<Stat, number>> {
  const out: Partial<Record<Stat, number>> = {};
  for (const [s, w] of CLASSES[cls].referenceBuild) out[s] = w / 100;
  return out;
}

/**
 * Distribui `free` pontos pela sugestão da classe, um a um no atributo mais longe da fatia (o que
 * o alocador do núcleo faz para o perfil de referência), sem passar dos pontos.
 */
export function suggestRaise(
  h: HeroV5,
  free: number,
): Partial<Record<Stat, number>> {
  const share = suggestion(h.cls);
  const add: Partial<Record<Stat, number>> = {};
  const cur = { ...h.attrs };
  const spentIn = (s: Stat) => B.statCostTo(cur[s]) - B.statCostTo(1);
  let left = free;
  for (let guard = 0; guard < 5000 && left > 0; guard++) {
    let pick: Stat | null = null;
    let worst = Infinity;
    const total = STAT_ORDER.reduce((a, s) => a + spentIn(s), 0) || 1;
    for (const s of STAT_ORDER) {
      const w = share[s];
      if (!w) continue;
      const cost = B.statRaiseCost(cur[s] + 1);
      if (cost > left) continue;
      const have = spentIn(s) / total;
      const gap = have - w;
      if (gap < worst) {
        worst = gap;
        pick = s;
      }
    }
    if (!pick) break;
    left -= B.statRaiseCost(cur[pick] + 1);
    cur[pick]++;
    add[pick] = (add[pick] ?? 0) + 1;
  }
  return add;
}
