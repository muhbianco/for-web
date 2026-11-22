// Simulação de balanceamento do Refúgio sobre as regras reais (ADR 0009, GDD em
// muchat/docs/espaco/jogo/gdd.md). Jogadores simulados com uma política fixa,
// dia a dia, e um relatório em Markdown. Não entra no bundle (index.ts não exporta).
//
//   node packages/space-core/src/game/balance/cli.ts [--seeds 16] [--days 180]

import {
  addSkillTries,
  addXp,
  type BoonId,
  CLASSES,
  CLASS_IDS,
  type ClassId,
  DEFAULT_TACTICS,
  type Degree,
  DUMMIES,
  equipError,
  type HeroCore,
  heroCombat,
  type Item,
  itemScore,
  maxHpWithBoons,
  type NodeType,
  reachableLanes,
  RULES,
  type RunChoice,
  type RunState,
  sellValue,
  settleRun,
  simpleSeeds,
  type SkillId,
  SKILL_IDS,
  startRun,
  stepRun,
  WEAPONS,
} from "../index.ts";
import { Rng } from "../rng.ts";
import { freshHero } from "../../testing/game.ts";

type Profile = "dedicado" | "casual";
type Ladder = { degree: Degree; abyss: number };

interface SimHero extends HeroCore {
  xp: number;
  gold: number;
  tier: number;
  potions: number;
}

const BOON_ORDER: BoonId[] = ["furia", "olho_agucado", "ritmo", "vigor", "egide", "seiva_viva", "lamina_larga", "eco_arcano"];
const PREF_LOW: NodeType[] = ["descanso", "loja", "tesouro", "evento", "combate", "elite", "chefe"];
const PREF_HIGH: NodeType[] = ["elite", "tesouro", "evento", "combate", "loja", "descanso", "chefe"];

/** A política do jogador simulado (a mesma do protótipo de muchat/docs/espaco/jogo/sim). */
function policy(s: RunState, maxHp: number): RunChoice {
  const hpPct = (s.hp * 100) / maxHp;
  const o = s.offer;
  if (o?.kind === "bencao") return { t: "choose", option: [...o.boons].map((b, i) => [BOON_ORDER.indexOf(b), i] as const).sort((a, b) => a[0] - b[0])[0]![1] };
  if (o?.kind === "descanso") return { t: "choose", option: o.retreat && hpPct < 30 ? 2 : hpPct < 70 ? 0 : 1 };
  if (o?.kind === "evento") {
    if (o.event === "altar") return { t: "choose", option: hpPct > 40 ? 0 : 1 };
    if (o.event === "bau") return { t: "choose", option: 0 };
    return { t: "choose", option: s.bagGold >= o.price ? 0 : 1 };
  }
  if (o?.kind === "loja") {
    if (s.bagGold >= o.boonPrice && hpPct >= 50 && !s.boons.dmgPct) return { t: "choose", option: 1 };
    if (s.potions < RULES.maxPotions && s.bagGold >= o.potionPrice) return { t: "choose", option: 0 };
  }
  const lanes = reachableLanes(s);
  const pref = hpPct < 50 ? PREF_LOW : PREF_HIGH;
  const next = s.map[s.row + 1]!;
  return { t: "go", lane: [...lanes].sort((a, b) => pref.indexOf(next[a]!.type) - pref.indexOf(next[b]!.type))[0]! };
}

function playRun(h: SimHero, l: Ladder, initiation: boolean, rng: Rng) {
  const hc = heroCombat(h);
  const seeds = simpleSeeds(rng.u32());
  let s = startRun({ degree: l.degree, abyss: l.abyss, initiation, hp: hc.maxHp, mp: hc.maxMp, potions: h.potions }, seeds);
  for (let guard = 0; !s.end && guard < 200; guard++) {
    let r = stepRun(s, hc, DEFAULT_TACTICS, policy(s, maxHpWithBoons(hc, s.boons)), seeds);
    if (!r.ok) r = stepRun(s, hc, DEFAULT_TACTICS, s.offer ? { t: "choose", option: -1 } : { t: "go", lane: reachableLanes(s)[0]! }, seeds);
    if (!r.ok) throw new Error(`política travou: ${r.error}`);
    s = r.state;
  }
  return { s, reward: settleRun(s) };
}

function equipBest(h: SimHero, items: Item[]): number {
  let sold = 0;
  for (const it of items) {
    if (!equipError(h.cls, h.level, it) && itemScore(it, h.cls) > itemScore(h.gear[it.slot], h.cls)) {
      const old = h.gear[it.slot];
      if (old) sold += sellValue(old);
      h.gear[it.slot] = it;
    } else sold += sellValue(it);
  }
  return sold;
}

const rank = (l: Ladder) => (l.degree === "normal" ? 0 : l.degree === "dificil" ? 1 : l.degree === "pesadelo" ? 2 : 2 + l.abyss);
const up = (l: Ladder): Ladder =>
  l.degree === "normal" ? { degree: "dificil", abyss: 1 } : l.degree === "dificil" ? { degree: "pesadelo", abyss: 1 } : l.degree === "pesadelo" ? { degree: "abismo", abyss: 1 } : { degree: "abismo", abyss: l.abyss + 1 };
const down = (l: Ladder): Ladder =>
  l.degree === "abismo" && l.abyss > 1 ? { degree: "abismo", abyss: l.abyss - 1 } : l.degree === "abismo" ? { degree: "pesadelo", abyss: 1 } : l.degree === "pesadelo" ? { degree: "dificil", abyss: 1 } : { degree: "normal", abyss: 1 };
const label = (l: Ladder) => (l.degree === "abismo" ? `abismo ${l.abyss}` : l.degree);

function runsPerDay(day: number, p: Profile): number {
  if (p === "casual") return day === 1 ? 4 : 2;
  return day === 1 ? 8 : day <= 7 ? 6 : 4;
}

interface Snap {
  day: number;
  level: number;
  skill: number;
  ladder: string;
  ema: number;
  gold: number;
  earned: number;
  spent: number;
  runs: number;
  idle: number;
  active: number;
  tier: number;
}

function simulate(cls: ClassId, seed: number, days: number, p: Profile, checkpoints: number[]): Snap[] {
  const rng = new Rng(seed);
  const h: SimHero = { ...freshHero(cls), xp: 0, gold: 0, tier: 0, potions: 3 };
  let ladder: Ladder = { degree: "normal", abyss: 1 };
  const ema = new Map<number, number>();
  const out: Snap[] = [];
  let runs = 0;
  let earned = 0;
  let spent = 0;
  let idle = 0;
  let active = 0;
  const main = (): SkillId => WEAPONS[heroCombat(h).weapon].skill;
  const gainTries = (tries: Partial<Record<SkillId, number>>) => {
    for (const sk of SKILL_IDS) {
      const n = tries[sk];
      if (!n) continue;
      const r = addSkillTries(h.skills[sk].l, h.skills[sk].p, n, CLASSES[cls].skillCost10[sk]);
      h.skills[sk] = { l: r.level, p: r.progress };
    }
  };
  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < runsPerDay(day, p); i++) {
      const price = 20 + 2 * h.level;
      while (h.potions < RULES.maxPotions && h.gold >= price) {
        h.gold -= price;
        spent += price;
        h.potions++;
      }
      const { reward } = playRun(h, ladder, runs === 0, rng);
      runs++;
      h.potions = reward.potions;
      const lv = addXp(h.level, h.xp, reward.xp);
      h.level = lv.level;
      h.xp = lv.xp;
      active += reward.tries[main()] ?? 0;
      gainTries(reward.tries);
      const sold = equipBest(h, reward.items);
      h.gold += reward.gold + sold;
      earned += reward.gold + sold;
      if (runs === 1) continue; // a iniciação não conta para o degrau
      const k = rank(ladder);
      const won = reward.end === "vitoria" ? 1 : 0;
      const e = (ema.get(k) ?? 0.5) * 0.7 + won * 0.3;
      ema.set(k, e);
      if (e > 0.75 && won) ladder = up(ladder);
      else if (e < 0.35 && ladder.degree !== "normal") ladder = down(ladder);
    }
    const d = DUMMIES[h.tier]!;
    const minutes = p === "dedicado" ? 20 * 60 : d.capH * 60;
    const tries = Math.floor((minutes * d.triesPerMin10) / 10);
    idle += tries;
    gainTries({ [main()]: tries });
    const next = DUMMIES[h.tier + 1];
    if (next && h.gold >= next.cost * 1.2) {
      h.gold -= next.cost;
      spent += next.cost;
      h.tier++;
    }
    if (checkpoints.includes(day)) {
      out.push({ day, level: h.level, skill: h.skills[main()].l, ladder: label(ladder), ema: ema.get(rank(ladder)) ?? 0.5, gold: h.gold, earned, spent, runs, idle, active, tier: h.tier });
    }
  }
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
function mode(xs: string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

function main() {
  const seeds = arg("--seeds", 16);
  const days = arg("--days", 180);
  const checkpoints = [1, 3, 7, 14, 30, 60, 90, 180].filter((d) => d <= days);
  const t0 = Date.now();
  const out: string[] = ["# Refúgio: simulação de balanceamento (regras do space-core)", ""];
  out.push(`\`node packages/space-core/src/game/balance/cli.ts --seeds ${seeds} --days ${days}\`. Mediana de ${seeds} jogadores por classe e perfil.`, "");
  for (const p of ["dedicado", "casual"] as const) {
    out.push(`## Jogador ${p}`, "", "| Classe | Dia | Nível | Skill | Boneco | Degrau | Vitória (EMA) | Ouro em caixa | Ouro/dia | Expedições |", "|---|---|---|---|---|---|---|---|---|---|");
    const notes: string[] = [];
    for (const cls of CLASS_IDS) {
      const all = Array.from({ length: seeds }, (_, i) => simulate(cls, 1000 + i * 7919, days, p, checkpoints));
      checkpoints.forEach((day, c) => {
        const at = all.map((s) => s[c]!);
        const prev = c === 0 ? 0 : checkpoints[c - 1]!;
        const perDay = median(all.map((s) => (s[c]!.earned - (c === 0 ? 0 : s[c - 1]!.earned)) / (day - prev)));
        out.push(
          `| ${cls} | ${day} | ${median(at.map((s) => s.level))} | ${median(at.map((s) => s.skill))} | ${DUMMIES[median(at.map((s) => s.tier))]!.id} | ${mode(at.map((s) => s.ladder))} | ${Math.round(median(at.map((s) => s.ema)) * 100)}% | ${median(at.map((s) => s.gold))} | ${Math.round(perDay)} | ${median(at.map((s) => s.runs))} |`,
        );
      });
      const last = all.map((s) => s[s.length - 1]!);
      const idle = median(last.map((s) => s.idle));
      const act = median(last.map((s) => s.active));
      const earned = median(last.map((s) => s.earned));
      const spent = median(last.map((s) => s.spent));
      notes.push(`- ${cls}: boneco ${Math.round((idle * 100) / (idle + act))}% das tentativas da skill; ouro ganho ${earned}, gasto ${spent} (${Math.round((spent * 100) / earned)}%).`);
    }
    out.push("", ...notes, "");
  }
  out.push("## Primeiras expedições (herói novo, 300 tentativas)", "", "| Classe | Expedição | Vitória | Combate por expedição |", "|---|---|---|---|");
  for (const cls of CLASS_IDS) {
    for (const initiation of [true, false]) {
      const rng = new Rng(4242);
      let w = 0;
      let ms = 0;
      for (let i = 0; i < 300; i++) {
        const { s } = playRun({ ...freshHero(cls), xp: 0, gold: 0, tier: 0, potions: 3 }, { degree: "normal", abyss: 1 }, initiation, rng);
        if (s.end === "vitoria") w++;
        ms += s.combatMs;
      }
      out.push(`| ${cls} | ${initiation ? "iniciação" : "normal"} | ${Math.round(w / 3)}% | ${Math.round(ms / 300 / 1000)} s |`);
    }
  }
  out.push("", `_Levou ${((Date.now() - t0) / 1000).toFixed(1)} s._`);
  console.log(out.join("\n"));
}

main();
