import type {
  Condition,
  Effect,
  SkillDef,
  SkillHook,
} from "../combat/types.ts";
import type { ClassId } from "../content.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { SKILLS_BY_CLASS } from "./index.ts";
import {
  type MechanicMod,
  type SkillContent,
  isSupportSkill,
} from "./schema.ts";
import type { HeroSkills, SkillBuild } from "./tree.ts";

/**
 * Do conteúdo ao motor: aplica as escolhas do jogador (Potência, Eficiência, ups de Mecânica) e
 * entrega a skill com os números já somados (§7). O motor de luta não sabe o que é um adereço.
 *
 * - Mecânicas, na ordem do conteúdo; no 5/5, o extra (`atMax`).
 * - Potência: +5% por rank acima do 1 no número principal (dano, DoT, cura, HoT, escudo, reviver),
 *   inclusive nos efeitos que os adereços acrescentam; em skill de apoio puro, −1% de recarga por rank
 *   e o valor do buff não escala.
 * - Eficiência: −4% de mana e −3% de recarga por up.
 */

type Bag = Record<string, unknown>;

function getPath(o: Bag, path: string): number {
  let cur: unknown = o;
  for (const k of path.split(".")) cur = (cur as Bag | undefined)?.[k];
  return typeof cur === "number" ? cur : 0;
}

function setPath(o: Bag, path: string, v: number): void {
  const keys = path.split(".");
  let cur: Bag = o;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Bag;
  }
  cur[keys[keys.length - 1]!] = v;
}

/** × m no número principal do efeito. */
function scaleMain(e: Effect, m: number): void {
  switch (e.type) {
    case "dano":
      for (const p of e.parts) p.coef *= m;
      return;
    case "dot":
      e.coefPerSec *= m;
      return;
    case "cura":
      if (e.coefMatk) e.coefMatk *= m;
      if (e.pctMaxHp) e.pctMaxHp *= m;
      return;
    case "hot":
      if (e.coefMatkPerSec) e.coefMatkPerSec *= m;
      if (e.pctMaxHpPerSec) e.pctMaxHpPerSec *= m;
      return;
    case "escudo":
      if (e.pctMaxHp) e.pctMaxHp *= m;
      if (e.coefMatk) e.coefMatk *= m;
      return;
    case "reviver":
      e.hpPct *= m;
      return;
    default:
      return;
  }
}

interface Acc {
  effects: Effect[];
  hooks: SkillHook[];
  flatCutMs: number;
}

function applyMod(acc: Acc, mod: MechanicMod, ups: number): void {
  switch (mod.kind) {
    case "duracao":
      for (const i of mod.effects) {
        const e = acc.effects[i] as Bag | undefined;
        if (e && typeof e.durationMs === "number")
          e.durationMs += mod.perUpMs * ups;
      }
      return;
    case "valor": {
      const e = acc.effects[mod.effect] as Bag | undefined;
      if (e) setPath(e, mod.field, getPath(e, mod.field) + mod.perUp * ups);
      return;
    }
    case "potencia":
      for (const i of mod.effects) {
        const e = acc.effects[i];
        if (e) scaleMain(e, 1 + mod.perUp * ups);
      }
      return;
    case "recarga":
      acc.flatCutMs += mod.perUpMs * ups;
      return;
    case "efeito": {
      const e = structuredClone(mod.add) as Bag;
      for (const f of mod.fields) setPath(e, f, mod.perUp * ups);
      acc.effects.push(e as unknown as Effect);
      return;
    }
    case "gancho": {
      const h = structuredClone(mod.add) as Bag;
      setPath(h, mod.field, mod.perUp * ups);
      acc.hooks.push(h as unknown as SkillHook);
      return;
    }
    case "fixo":
      for (const e of mod.effects ?? []) acc.effects.push(structuredClone(e));
      for (const h of mod.hooks ?? []) acc.hooks.push(structuredClone(h));
      return;
  }
}

export function compileSkill(
  content: SkillContent,
  build: SkillBuild,
  ai?: Condition[],
  B: Balance = gameBalance,
): SkillDef {
  const sk = B.cfg.skills;
  const acc: Acc = {
    effects: structuredClone(content.effects),
    hooks: structuredClone(content.hooks ?? []),
    flatCutMs: 0,
  };
  for (const m of content.mechanics) {
    const ups = Math.max(
      0,
      Math.min(sk.mechanicMax, build.mechanics[m.id] ?? 0),
    );
    if (ups === 0) continue;
    for (const mod of m.mods) applyMod(acc, mod, ups);
    if (ups === sk.mechanicMax)
      for (const mod of m.atMax ?? []) applyMod(acc, mod, 1);
  }

  const rank = Math.max(1, Math.min(sk.potencyMax, build.potency));
  const eff = Math.max(0, Math.min(sk.efficiencyMax, build.efficiency));
  let ownCut = sk.efficiencyCooldownPerUp * eff;
  if (isSupportSkill(content)) ownCut += sk.supportCooldownPerRank * (rank - 1);
  else {
    const pm = B.potencyMult(rank);
    for (const e of acc.effects) scaleMain(e, pm);
    for (const h of acc.hooks)
      if (h.on === "acerto" || h.on === "esquiva")
        for (const e of h.effects) scaleMain(e, pm);
  }

  return {
    id: content.id,
    name: content.name,
    cooldownMs: Math.max(0, content.cooldownMs - acc.flatCutMs),
    ownCooldownCut: ownCut,
    baseCooldownMs: content.cooldownMs,
    manaPct: content.manaPct * (1 - sk.efficiencyManaPerUp * eff),
    ...(content.threatMult ? { threatMult: content.threatMult } : {}),
    ...(content.castMs ? { castMs: content.castMs } : {}),
    condition: ai && ai.length > 0 ? ai : content.ai,
    effects: acc.effects,
    ...(acc.hooks.length > 0 ? { hooks: acc.hooks } : {}),
  };
}

/** Os 4 slots do herói, na ordem de prioridade, prontos para a luta. */
export function compileLoadout(
  cls: ClassId,
  hs: HeroSkills,
  B: Balance = gameBalance,
): SkillDef[] {
  const out: SkillDef[] = [];
  for (const id of hs.slots) {
    const content = SKILLS_BY_CLASS[cls].find((s) => s.id === id);
    const build = hs.builds[id];
    if (!content || !build || content.tier > hs.tier) continue;
    out.push(compileSkill(content, build, hs.ai[id], B));
  }
  return out;
}
