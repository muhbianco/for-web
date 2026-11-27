import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import type { FighterInput } from "../combat/types.ts";
import { type ClassId, ARMOR_SLOTS, CLASSES } from "../content.ts";
import { type DungeonDef, DUNGEONS } from "../dungeons/catalog.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import {
  type HeroV5,
  type OwnedItem,
  applyRun,
  autoEquipBag,
  buyPotions,
  createHero,
  evolveTier,
  heroRunFighter,
  raiseAttributes,
  refineItem,
  sellItem,
  spendSkillPoint,
} from "../hero.ts";
import { createMonsters } from "../monsters/generate.ts";
import { potionPrice } from "../npcs/merchant.ts";
import { runLoot } from "../run/loot.ts";
import { runRewards } from "../run/rewards.ts";
import { simulateRun } from "../run/simulate.ts";
import { learnableSkills, skillCapacity } from "../skills/tree.ts";
import { createEncounters } from "./encounters.ts";

/**
 * A jornada de um jogador (P81, pedida pelo dono em 25/11/2026): um herói recém-criado sobe com as regras
 * do jogo, corrida a corrida — XP, ouro, drops e minério de verdade; distribui os atributos e gasta os
 * pontos de habilidade como o perfil de referência; evolui no marco; auto-equipa; vende o que sobra;
 * refina até +4 o que veste e repõe as poções. Mede se ele acompanha a curva do conteúdo (o perfil
 * Raro +4 do próprio nível) e onde empaca. O modo "grupo" faz Masmorra do 40 em diante com 3
 * companheiros no perfil de referência do nível dele.
 */

export interface JourneyOptions {
  /** Até que nível (padrão 100). */
  to?: number;
  /** "solo": só Caçada; "grupo": Masmorra do 40 em diante, Caçada antes. */
  mode?: "solo" | "grupo";
  /** Proficiência: "dojo" = a recomendada para o nível (treinou), "nenhuma" = fica em 1. */
  proficiency?: "dojo" | "nenhuma";
  /** Teto de corridas (a jornada para e registra onde ficou). */
  maxRuns?: number;
  /** Derrotas seguidas que contam como "empacou" no nível. */
  stuckAfter?: number;
  /**
   * Depois de tantas derrotas seguidas, caça na Caçada de baixo (10 níveis abaixo) até subir de
   * nível, como faria um jogador que bateu na parede. Sem isso, insiste na do próprio nível.
   */
  retreatAfter?: number;
  seed?: number;
}

export interface JourneyLevelMark {
  level: number;
  runs: number;
  losses: number;
  /** Nível médio dos itens vestidos menos o nível do herói (quanto o equipamento fica atrás). */
  gearLag: number;
  /** Refino médio do que veste. */
  refine: number;
  gold: number;
}

export interface JourneyResult {
  cls: ClassId;
  reached: number;
  runs: number;
  losses: number;
  stuckAt: number | null;
  /** Ouro em poções / ouro ganho, na jornada toda. */
  potionShare: number;
  marks: JourneyLevelMark[];
  /** O herói no fim (onde chegou ou empacou), para medir a corrida que travou. */
  hero: HeroV5;
}

const MARKS = [10, 20, 30, 40, 50, 70, 100, 150, 200];

/** A Caçada (ou Masmorra) mais alta em que o herói pode entrar (a partir de R − 5, D14). */
function pickDungeon(
  level: number,
  kind: DungeonDef["kind"],
  cautious: boolean,
): DungeonDef {
  let best: DungeonDef | null = null;
  for (const d of DUNGEONS)
    if (
      d.kind === kind &&
      d.minLevel <= level &&
      (!cautious || d.level <= level) &&
      (!best || d.level > best.level)
    )
      best = d;
  return best ?? DUNGEONS.find((d) => d.kind === "cacada")!;
}

/** Atributos até a distribuição de referência do nível. */
function allocate(h: HeroV5, B: Balance): HeroV5 {
  const target = B.allocateByWeights(
    B.attributePoints(h.level),
    CLASSES[h.cls].referenceBuild,
  );
  const add: Partial<Record<keyof HeroV5["attrs"], number>> = {};
  for (const k of Object.keys(target) as (keyof HeroV5["attrs"])[]) {
    const d = target[k] - h.attrs[k];
    if (d > 0) add[k] = d;
  }
  if (Object.keys(add).length === 0) return h;
  const r = raiseAttributes(h, add, B);
  return r.ok ? r.hero : h;
}

/** Gasta os pontos de habilidade: Potência nas skills dos slots, depois Eficiência; evolui no marco. */
function growSkills(h: HeroV5, B: Balance): HeroV5 {
  for (let guard = 0; guard < 400; guard++) {
    let spent = false;
    for (const target of ["potencia", "eficiencia"] as const) {
      for (const id of h.skills.slots) {
        const r = spendSkillPoint(h, id, target, B);
        if (r.ok) {
          h = r.hero;
          spent = true;
          break;
        }
      }
      if (spent) break;
    }
    if (!spent) {
      // Sobrou ponto e não cabe nos slots: põe em qualquer skill aprendida com espaço.
      const s = learnableSkills(h.cls, h.skills.tier).find(
        (x) =>
          h.skills.builds[x.id] &&
          skillCapacity(x, h.skills.builds[x.id]!, h.skills.tier, B) > 0,
      );
      const m = s?.mechanics.find(
        (x) =>
          x.unlockTier <= h.skills.tier &&
          (h.skills.builds[s.id]!.mechanics[x.id] ?? 0) <
            B.cfg.skills.mechanicMax,
      );
      const r = s
        ? spendSkillPoint(h, s.id, m ? { mechanic: m.id } : "eficiencia", B)
        : null;
      if (r && r.ok) {
        h = r.hero;
        continue;
      }
      const e = evolveTier(h, B);
      if (e.ok) {
        h = e.hero;
        continue;
      }
      break;
    }
  }
  return h;
}

/** Refina até +4 o que veste (arma, armadura, escudo), enquanto tiver ouro e minério. */
function refine(h: HeroV5, rng: () => number, B: Balance): HeroV5 {
  const slots = ["arma", ...ARMOR_SLOTS, "secundaria"] as const;
  for (let guard = 0; guard < 40; guard++) {
    let done = false;
    for (const slot of slots) {
      const it = (h.equipment as Record<string, OwnedItem | undefined>)[slot];
      if (!it || it.refine >= 4) continue;
      const r = refineItem(h, it.uid, { next: rng }, false, B);
      if (r.ok) {
        h = r.hero;
        done = true;
      }
    }
    if (!done) break;
  }
  return h;
}

function gearMarks(h: HeroV5): { lag: number; refine: number } {
  const worn = Object.values(h.equipment).filter(Boolean) as OwnedItem[];
  if (worn.length === 0) return { lag: -h.level, refine: 0 };
  const il = worn.reduce((a, x) => a + x.ilvl, 0) / worn.length;
  const rf = worn.reduce((a, x) => a + x.refine, 0) / worn.length;
  return { lag: il - h.level, refine: rf };
}

export function simulateJourney(
  cls: ClassId,
  opts: JourneyOptions = {},
  B: Balance = gameBalance,
): JourneyResult {
  const to = opts.to ?? 100;
  const mode = opts.mode ?? "solo";
  const maxRuns = opts.maxRuns ?? 6000;
  const stuckAfter = opts.stuckAfter ?? 12;
  const rng = new Rng(opts.seed ?? 1);
  const rand = randomSource(rng);
  const roll = () => rand.next();
  const M = createMonsters(B);
  const E = createEncounters(B);
  let n = 0;
  const newId = () => `j${++n}`;
  let h = createHero(cls, newId, B);
  let runs = 0;
  let losses = 0;
  let streak = 0;
  let earned = 0;
  let spentOnPotions = 0;
  let stuckAt: number | null = null;
  let cautiousUntil = 0;
  /** O nível em que bateu na parede e foi para a Caçada de baixo (`retreatAfter`). */
  let retreatAt: number | null = null;
  const marks: JourneyLevelMark[] = [];
  let nextMark = 0;

  while (h.level < to && runs < maxRuns) {
    h = allocate(h, B);
    h = growSkills(h, B);
    if (opts.proficiency === "dojo")
      h = {
        ...h,
        proficiency: Math.max(h.proficiency, B.recommendedProficiency(h.level)),
      };
    const group = mode === "grupo" && h.level >= 40;
    // Perdeu: volta para a do próprio nível (ou abaixo) até subir de nível, como um jogador faria.
    const retreating = !group && retreatAt === h.level;
    // D53: sozinho se farma a Caçada 10 abaixo, fora da zona de entrada (lá, a do próprio nível).
    const farm = !group && h.level > B.cfg.limit.entryHuntsUpTo ? 10 : 0;
    const d = pickDungeon(
      (retreating ? h.level - 10 : h.level) - farm,
      group ? "masmorra" : "cacada",
      cautiousUntil > h.level || streak > 0 || retreating,
    );
    const me = heroRunFighter(h, B);
    const party: FighterInput[] = group
      ? [
          me,
          ...(["guerreiro", "padre", "mago", "cacador", "druida"] as const)
            .filter((c) => c !== cls)
            .slice(0, 3)
            .map((c) =>
              E.fighter(c, h.level, {
                source: "spec",
                referenceAi: "gabarito",
              }),
            ),
        ]
      : [me];
    const r = simulateRun(d, party, { mode: "aleatorio", random: rand }, B, M);
    runs++;
    const won = r.outcome === "vitoria";
    if (!won) {
      losses++;
      streak++;
      cautiousUntil = h.level + 1;
      if (opts.retreatAfter !== undefined && streak >= opts.retreatAfter)
        retreatAt = h.level;
    } else streak = 0;
    const levels = party.map(() => h.level);
    const rw = runRewards(d, levels, r, B).heroes[0]!;
    const loot = runLoot(
      d,
      party.map((p) => p.cls),
      r,
      rand,
      B,
    );
    const items = loot.items
      .filter((x) => x.hero === 0)
      .map((x) => ({ ...x.item, uid: newId() }));
    const potionsUsed = {
      hp: r.rooms.reduce((a, x) => a + x.heroes[0]!.hpPotions, 0),
      mp: r.rooms.reduce((a, x) => a + x.heroes[0]!.mpPotions, 0),
    };
    const applied = applyRun(
      h,
      {
        xp: rw.xp,
        jobXp: rw.jobXp,
        gold: rw.gold,
        items,
        ores: loot.ores[0] ?? {},
        stones: loot.protectionStones[0] ?? 0,
        potionsUsed,
        ammoUsed: 0,
      },
      B,
    );
    if (applied.ok) h = applied.hero;
    earned += rw.gold;
    // Veste o melhor e vende o resto (o +7 fica).
    const ae = autoEquipBag(h, B);
    if (ae.ok) h = ae.hero;
    for (const it of [...h.bag])
      if (it.refine < 7) {
        const s = sellItem(h, it.uid, true, B);
        if (s.ok) h = s.hero;
      }
    h = refine(h, roll, B);
    // Repõe as poções pequenas até 100 de cada, com o ouro que tiver.
    for (const kind of ["hp", "mp"] as const) {
      const want = 100 - h.potions[kind].pequena;
      const price = potionPrice(h.level, B)[kind];
      const can = Math.min(want, Math.floor(h.gold / Math.max(1, price)));
      if (can > 0) {
        const b = buyPotions(h, kind, "pequena", can, B);
        if (b.ok) {
          h = b.hero;
          spentOnPotions += b.cost;
        }
      }
    }
    while (nextMark < MARKS.length && h.level >= MARKS[nextMark]!) {
      const g = gearMarks(h);
      marks.push({
        level: MARKS[nextMark]!,
        runs,
        losses,
        gearLag: Math.round(g.lag * 10) / 10,
        refine: Math.round(g.refine * 10) / 10,
        gold: h.gold,
      });
      nextMark++;
    }
    if (streak >= stuckAfter) {
      stuckAt = h.level;
      break;
    }
  }
  return {
    cls,
    reached: h.level,
    runs,
    losses,
    stuckAt,
    potionShare: earned > 0 ? spentOnPotions / earned : 0,
    marks,
    hero: h,
  };
}
