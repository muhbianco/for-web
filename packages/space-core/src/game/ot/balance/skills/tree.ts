import type { Condition } from "../combat/types.ts";
import type { ClassId } from "../content.ts";
import {
  type Balance,
  type Tier,
  balance as gameBalance,
} from "../formulas.ts";
import { SKILLS_BY_CLASS } from "./index.ts";
import type { SkillContent } from "./schema.ts";

/**
 * A árvore de habilidades (spec §7): 1 ponto por nível de job acima do 1; cada skill tem Potência
 * (1–20, teto pelo tier: 5/10/15/20), Eficiência (0–5) e Mecânicas (0–5 cada, liberadas pelo tier).
 * 4 slots equipáveis em ordem de prioridade. Evolução no Mestre (§6) e redistribuição (§7).
 */

export interface SkillBuild {
  potency: number;
  efficiency: number;
  /** Ups de cada Mecânica (id → 0–5). */
  mechanics: Record<string, number>;
}

export interface HeroSkills {
  tier: Tier;
  /** Uma entrada por skill aprendida (todas as do tier e abaixo, aprendidas de graça no rank 1). */
  builds: Record<string, SkillBuild>;
  /** Até 4, em ordem de prioridade. */
  slots: string[];
  /** IA escolhida pelo jogador para a skill (sem entrada = a padrão do spec). */
  ai: Record<string, Condition[]>;
  /** Quantas redistribuições já fez (a 1ª é grátis). */
  resets: number;
}

export type SpendTarget = "potencia" | "eficiencia" | { mechanic: string };

export type TreeError =
  | "skill-nao-aprendida"
  | "sem-pontos"
  | "potencia-no-teto"
  | "eficiencia-no-teto"
  | "mecanica-no-teto"
  | "mecanica-bloqueada"
  | "mecanica-inexistente"
  | "slot-invalido"
  | "slot-repetido"
  | "slots-demais";

export const MAX_SLOTS = 4;

export function freshBuild(): SkillBuild {
  return { potency: 1, efficiency: 0, mechanics: {} };
}

/** Pontos de habilidade do job: 1 por nível acima do 1 (máx. 149). */
export function skillPoints(job: number, B: Balance = gameBalance): number {
  return Math.max(0, Math.min(B.cfg.levels.maxJob, job) - 1);
}

export function buildCost(b: SkillBuild): number {
  let n = b.potency - 1 + b.efficiency;
  for (const v of Object.values(b.mechanics)) n += v;
  return n;
}

export function skillPointsSpent(hs: HeroSkills): number {
  let n = 0;
  for (const b of Object.values(hs.builds)) n += buildCost(b);
  return n;
}

/** As skills da classe que o tier já liberou. */
export function learnableSkills(cls: ClassId, tier: Tier): SkillContent[] {
  return SKILLS_BY_CLASS[cls].filter((s) => s.tier <= tier);
}

/** Quantos pontos ainda cabem numa skill no tier (tetos de Potência, Eficiência e Mecânicas liberadas). */
export function skillCapacity(
  s: SkillContent,
  b: SkillBuild,
  tier: Tier,
  B: Balance = gameBalance,
): number {
  const sk = B.cfg.skills;
  let room =
    Math.max(0, B.potencyCap(tier) - b.potency) +
    Math.max(0, sk.efficiencyMax - b.efficiency);
  for (const m of s.mechanics)
    if (m.unlockTier <= tier)
      room += Math.max(0, sk.mechanicMax - (b.mechanics[m.id] ?? 0));
  return room;
}

/** O que ainda dá para gastar na classe toda, no tier. */
export function treeCapacity(
  cls: ClassId,
  hs: HeroSkills,
  B: Balance = gameBalance,
): number {
  let room = 0;
  for (const s of learnableSkills(cls, hs.tier))
    room += skillCapacity(s, hs.builds[s.id] ?? freshBuild(), hs.tier, B);
  return room;
}

/** Total absorvível com tudo liberado (T4): 114 Potência + 30 Eficiência + 60 Mecânicas = 204 (§7). */
export function totalAbsorbable(
  cls: ClassId,
  B: Balance = gameBalance,
): number {
  let n = 0;
  for (const s of SKILLS_BY_CLASS[cls])
    n += skillCapacity(s, freshBuild(), 4, B);
  return n;
}

/** As skills do herói recém-criado (T1): as duas do T1 aprendidas e nos slots. */
export function freshHeroSkills(cls: ClassId): HeroSkills {
  const hs: HeroSkills = { tier: 1, builds: {}, slots: [], ai: {}, resets: 0 };
  learnNewSkills(cls, hs);
  return hs;
}

/** Aprende de graça (rank 1) o que o tier liberou e põe nos slots livres, na ordem do spec. */
function learnNewSkills(cls: ClassId, hs: HeroSkills): void {
  for (const s of learnableSkills(cls, hs.tier)) {
    if (hs.builds[s.id]) continue;
    hs.builds[s.id] = freshBuild();
    if (hs.slots.length < MAX_SLOTS) hs.slots.push(s.id);
  }
}

/** Gasta 1 ponto. Recusa com o motivo; nunca muda o original. */
export function spendPoint(
  cls: ClassId,
  job: number,
  hs: HeroSkills,
  skillId: string,
  target: SpendTarget,
  B: Balance = gameBalance,
): { ok: true; skills: HeroSkills } | { ok: false; error: TreeError } {
  const s = SKILLS_BY_CLASS[cls].find((x) => x.id === skillId);
  const cur = hs.builds[skillId];
  if (!s || !cur || s.tier > hs.tier)
    return { ok: false, error: "skill-nao-aprendida" };
  if (skillPointsSpent(hs) >= skillPoints(job, B))
    return { ok: false, error: "sem-pontos" };
  const b: SkillBuild = { ...cur, mechanics: { ...cur.mechanics } };
  if (target === "potencia") {
    if (b.potency >= B.potencyCap(hs.tier))
      return { ok: false, error: "potencia-no-teto" };
    b.potency++;
  } else if (target === "eficiencia") {
    if (b.efficiency >= B.cfg.skills.efficiencyMax)
      return { ok: false, error: "eficiencia-no-teto" };
    b.efficiency++;
  } else {
    const m = s.mechanics.find((x) => x.id === target.mechanic);
    if (!m) return { ok: false, error: "mecanica-inexistente" };
    if (m.unlockTier > hs.tier)
      return { ok: false, error: "mecanica-bloqueada" };
    const v = b.mechanics[m.id] ?? 0;
    if (v >= B.cfg.skills.mechanicMax)
      return { ok: false, error: "mecanica-no-teto" };
    b.mechanics[m.id] = v + 1;
  }
  return {
    ok: true,
    skills: { ...hs, builds: { ...hs.builds, [skillId]: b } },
  };
}

/** Troca os slots (fora da corrida): até 4, sem repetir, só skills aprendidas. */
export function setSlots(
  cls: ClassId,
  hs: HeroSkills,
  slots: string[],
): { ok: true; skills: HeroSkills } | { ok: false; error: TreeError } {
  if (slots.length > MAX_SLOTS) return { ok: false, error: "slots-demais" };
  if (new Set(slots).size !== slots.length)
    return { ok: false, error: "slot-repetido" };
  const learned = new Set(learnableSkills(cls, hs.tier).map((s) => s.id));
  if (slots.some((id) => !learned.has(id) || !hs.builds[id]))
    return { ok: false, error: "slot-invalido" };
  return { ok: true, skills: { ...hs, slots: [...slots] } };
}

export type EvolveError =
  | "tier-maximo"
  | "marco-nao-alcancado"
  | "pontos-nao-gastos";

/**
 * Evolução no Mestre (§6): T2 no job 20; T3 no nível 40; T4 no nível 70. Além do marco, o herói tem de
 * ter gasto os pontos — todos os que cabem na árvore do tier (no T1 cabem 18 e o job 20 dá 19, então
 * "todos" é o que dá para gastar; P38). Grátis; aprende as skills novas.
 */
export function evolve(
  cls: ClassId,
  level: number,
  job: number,
  hs: HeroSkills,
  B: Balance = gameBalance,
): { ok: true; skills: HeroSkills } | { ok: false; error: EvolveError } {
  if (hs.tier >= 4) return { ok: false, error: "tier-maximo" };
  const next = (hs.tier + 1) as Tier;
  if (B.tierFor(level, job) < next)
    return { ok: false, error: "marco-nao-alcancado" };
  const free = skillPoints(job, B) - skillPointsSpent(hs);
  if (Math.min(free, treeCapacity(cls, hs, B)) > 0)
    return { ok: false, error: "pontos-nao-gastos" };
  const out: HeroSkills = {
    ...hs,
    tier: next,
    builds: { ...hs.builds },
    slots: [...hs.slots],
    ai: { ...hs.ai },
  };
  learnNewSkills(cls, out);
  return { ok: true, skills: out };
}

/** Redistribuir as skills no Mestre: a 1ª é grátis; depois 5.000 de ouro fixos (D25). Os slots ficam. */
export function resetSkills(
  hs: HeroSkills,
  B: Balance = gameBalance,
): { skills: HeroSkills; cost: number } {
  const builds: Record<string, SkillBuild> = {};
  for (const id of Object.keys(hs.builds)) builds[id] = freshBuild();
  return {
    skills: { ...hs, builds, resets: hs.resets + 1 },
    cost: B.respecCost(hs.resets),
  };
}
