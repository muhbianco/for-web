import { Rng } from "../../../rng.ts";
import { fight, randomSource } from "../combat/fight.ts";
import type { EnemyInput, FighterInput } from "../combat/types.ts";
import { type ClassId, CLASSES } from "../content.ts";
import { type DungeonDef, DUNGEONS } from "../dungeons/catalog.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { createMonsters } from "../monsters/generate.ts";
import { potionPrice } from "../npcs/merchant.ts";
import { compileSkill } from "../skills/compile.ts";
import { skillOf } from "../skills/index.ts";
import { runRewards } from "../run/rewards.ts";
import { type RunResult, simulateRun } from "../run/simulate.ts";
import { type SimOptions, createEncounters } from "./encounters.ts";

/**
 * O relatório da §14 (Fase 7): as invariantes do spec rodadas na engine nova, com corridas inteiras
 * (as 4 salas) no modo esperado, o Monte Carlo do §14.9 no modo aleatório, o ritmo do §14.7 com o XP
 * real das Caçadas e a meta de economia do §13. Nada aqui cobra duração (D21): o tempo aparece só como
 * informação. Uma linha "aceita" é uma falha conhecida com decisão (D20) ou achado aberto (P63).
 */

export type LineStatus = "ok" | "falha" | "aceita" | "info";

export interface ReportLine {
  section: string;
  label: string;
  status: LineStatus;
  detail: string;
}

export interface ReportOptions {
  /** Corridas por cenário no Monte Carlo (o spec pede 200). */
  mcRuns?: number;
}

type Comp = ClassId[];
const SPEC: SimOptions = { source: "spec", referenceAi: "gabarito" };
const short = (c: Comp) => c.map((x) => x.slice(0, 3)).join("+");
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function balanceReport(
  opts: ReportOptions = {},
  B: Balance = gameBalance,
): ReportLine[] {
  const E = createEncounters(B);
  const M = createMonsters(B);
  const lines: ReportLine[] = [];
  const add = (
    section: string,
    label: string,
    status: LineStatus,
    detail: string,
  ) => lines.push({ section, label, status, detail });

  const masmorras = DUNGEONS.filter((d) => d.kind === "masmorra");
  const party = (c: Comp, L: number, extra: SimOptions = {}) =>
    c.map((x) => E.fighter(x, L, { ...SPEC, ...extra }));
  const run = (
    d: DungeonDef,
    c: Comp,
    extra: SimOptions = {},
    random?: { next(): number },
  ): RunResult =>
    simulateRun(
      d,
      party(c, d.level, extra),
      random ? { mode: "aleatorio", random } : { mode: "esperado" },
      B,
      M,
    );
  const clean = (r: RunResult) =>
    r.outcome === "vitoria" && r.heroes.every((h) => h.alive);

  // ------------------------------------------------------------ §14.1
  const S1 = "§14.1 Composições (corrida inteira, modo esperado, 37 Masmorras)";
  const TANKS: ClassId[] = ["guerreiro", "paladino"];
  const SUPPORTS: ClassId[] = ["padre", "druida"];
  const PAIRS: Comp[] = [
    ["mago", "cacador"],
    ["mago", "assassino"],
    ["cacador", "assassino"],
  ];
  for (const t of TANKS)
    for (const s of SUPPORTS)
      for (const p of PAIRS) {
        const c = [t, s, ...p];
        const bad = masmorras
          .filter((d) => !clean(run(d, c)))
          .map((d) => d.level);
        add(
          S1,
          `T/H/D/D ${short(c)} vence sem mortes`,
          bad.length === 0 ? "ok" : t === "paladino" ? "aceita" : "falha",
          bad.length === 0
            ? "37/37"
            : `${37 - bad.length}/37; com morte ou derrota: ${bad.join(", ")}${t === "paladino" ? " (P63: sobra depois da D32)" : ""}`,
        );
      }
  for (const t of TANKS)
    for (const s of SUPPORTS) {
      const c: Comp = [t, s, "mago"];
      const lost = masmorras
        .filter((d) => run(d, c).outcome !== "vitoria")
        .map((d) => d.level);
      const early = lost.filter((l) => l < 160);
      const why =
        early.length === 0
          ? " (D20: do 160 em diante pode perder)"
          : t === "paladino"
            ? " (P63: sobra depois da D32)"
            : "";
      add(
        S1,
        `trio ${short(c)} vence`,
        lost.length === 0
          ? "ok"
          : early.length === 0 || t === "paladino"
            ? "aceita"
            : "falha",
        lost.length === 0 ? "37/37" : `perde em ${lost.join(", ")}${why}`,
      );
    }
  const mustLose: [string, Comp][] = [
    ["sem tanque", ["padre", "mago", "cacador", "assassino"]],
    ["sem tanque", ["druida", "mago", "cacador", "assassino"]],
    ["sem suporte", ["guerreiro", "mago", "cacador", "assassino"]],
    ["sem suporte", ["paladino", "mago", "cacador", "assassino"]],
    ["sem DPS", ["guerreiro", "padre", "druida", "paladino"]],
    ["só DPS", ["mago", "cacador", "assassino", "mago"]],
  ];
  for (const [what, c] of mustLose) {
    const won = masmorras
      .filter((d) => run(d, c).outcome === "vitoria")
      .map((d) => d.level);
    add(
      S1,
      `${what} ${short(c)} perde`,
      won.length === 0 ? "ok" : "falha",
      won.length === 0 ? "perde as 37" : `vence em ${won.join(", ")}`,
    );
  }

  // ------------------------------------------------------------ §14.8
  const S8 = "§14.8 Proficiência";
  const ref: Comp = ["guerreiro", "padre", "mago", "cacador"];
  const lowLost = masmorras
    .filter((d) => d.level <= 100)
    .filter((d) => run(d, ref, { proficiency: () => 1 }).outcome !== "vitoria")
    .map((d) => d.level);
  add(
    S8,
    "PT de referência com b = 1 vence até o L100",
    lowLost.length === 0 ? "ok" : "falha",
    lowLost.length === 0 ? "vence todas" : `perde em ${lowLost.join(", ")}`,
  );

  // ------------------------------------------------------------ §14.9 e §14.10
  const n = opts.mcRuns ?? 200;
  const S9 = `§14.9 Monte Carlo (modo aleatório, ${n} corridas por cenário)`;
  const mcLevels = [40, 70, 100, 150, 200, 300, 400, 500].map((L) =>
    masmorras.reduce((a, d) =>
      Math.abs(d.level - L) < Math.abs(a.level - L) ? d : a,
    ),
  );
  const mc = (d: DungeonDef, c: Comp) => {
    const out: RunResult[] = [];
    for (let s = 1; s <= n; s++)
      out.push(run(d, c, {}, randomSource(new Rng(s * 7919 + d.level))));
    return out;
  };
  const scenarios: [string, Comp, boolean][] = [
    ["referência", ref, true],
    ["T/H/D/D", ["paladino", "druida", "assassino", "cacador"], true],
    ["sem tanque", ["padre", "mago", "cacador", "assassino"], false],
    ["sem DPS", ["guerreiro", "padre", "druida", "paladino"], false],
  ];
  const cloth = (Object.keys(CLASSES) as ClassId[]).filter(
    (c) => CLASSES[c].armor === "leve",
  );
  let roomLine: { L: number; roomDeath: number }[] | null = null;
  for (const [what, c, win] of scenarios) {
    const rates = mcLevels.map((d) => {
      const rs = mc(d, c);
      return {
        L: d.level,
        rate: rs.filter((r) => r.outcome === "vitoria").length / rs.length,
        roomDeath:
          rs.filter((r) =>
            r.rooms
              .slice(0, 3)
              .some((room) =>
                room.heroes.some((h, j) => !h.alive && cloth.includes(c[j]!)),
              ),
          ).length / rs.length,
      };
    });
    const bad = rates.filter((x) => (win ? x.rate < 0.95 : x.rate > 0.05));
    // D29: o L40 (começo da faixa) fica como exceção para quem devia perder.
    const onlyL40 = !win && bad.length > 0 && bad.every((x) => x.L < 70);
    add(
      S9,
      `${what} ${short(c)} ${win ? "vence em ≥ 95%" : "vence em ≤ 5%"}`,
      bad.length === 0
        ? "ok"
        : c[0] === "paladino" || onlyL40
          ? "aceita"
          : "falha",
      rates.map((x) => `L${x.L} ${pct(x.rate)}`).join(" · ") +
        (bad.length && c[0] === "paladino"
          ? " (P63: sobra depois da D32)"
          : bad.length && !win
            ? onlyL40
              ? " (D29: o L40 fica como exceção)"
              : " (P73: no começo da faixa o sorteio às vezes fecha antes do Cataclismo)"
            : ""),
    );
    if (what === "sem tanque") roomLine = rates;
  }
  const S10 = "§14.10 Sala de lacaios";
  if (roomLine) {
    const weak = roomLine.filter((x) => x.roomDeath < 0.5);
    add(
      S10,
      "sem tanque, um herói de pano morre nas salas 1–3 em ≥ 50%",
      // D31: aceito pelo dono; na sala de lacaios o tanque não faz falta, só o chefe cobra o tanque.
      weak.length === 0 ? "ok" : "aceita",
      roomLine.map((x) => `L${x.L} ${pct(x.roomDeath)}`).join(" · ") +
        (weak.length
          ? " (D31: aceito; nas salas os DPS tiram os lacaios do tanque, e subir o golpe mataria a PT completa junto)"
          : ""),
    );
  }
  add(
    S10,
    "a PT de referência limpa cada sala em 25–40 s",
    "info",
    "não cobrado: nada se balanceia por tempo (D21/D22)",
  );

  // Mecânicas sem [SIM]: Maldição e Drenar Mana.
  const SM = "§14.9 Mecânicas";
  const dummy = (extra: Partial<EnemyInput>): EnemyInput => ({
    archetype: "chefe",
    level: 100,
    hp: 1e15,
    autoRaw: 0,
    attacksPerSecond: 0.5,
    ...extra,
  });
  const boss100 = M.chefe(100, { partySize: 4, type: "masmorra" });
  const lone = (c: ClassId, skills = true): FighterInput => {
    const f = E.fighter(c, 100, SPEC);
    return {
      ...f,
      ...(skills ? {} : { skills: [] }),
      potions: { hp: 0, mp: 0, stock: 0 },
    };
  };
  const cursed = (withPriest: boolean) =>
    fight(
      withPriest ? [lone("mago", false), lone("padre")] : [lone("mago", false)],
      [dummy({ curse: boss100.curse! })],
      { maxSeconds: 20 + boss100.curse!.maxSeconds, mode: "esperado" },
    ).heroes[0]!.hpPct;
  const curseAlone = 1 - cursed(false);
  const curseCleansed = 1 - cursed(true);
  add(
    SM,
    "Maldição: o Santuário purifica",
    curseCleansed < curseAlone ? "ok" : "falha",
    `o mago perde ${pct(curseAlone)} sem purificação e ${pct(curseCleansed)} com o padre`,
  );
  add(
    SM,
    "Maldição sem purificação mata um alvo de pano em ≤ 15 s",
    "info",
    `sozinha ela tira ${pct(curseAlone)} (3%/s por no máximo 15 s): só mata somada ao dano do chefe (P71)`,
  );
  // O druida de referência não leva a Canção nos 4 slots: aqui ela entra no lugar de Espinhos.
  const song = compileSkill(skillOf("druida", "cancao-da-floresta")!, {
    potency: 1,
    efficiency: 0,
    mechanics: {},
  });
  const drained = (L: number, withSong: boolean) => {
    const at = (c: ClassId): FighterInput => ({
      ...E.fighter(c, L, SPEC),
      potions: { hp: 0, mp: 0, stock: 0 },
    });
    const second = at(withSong ? "druida" : "guerreiro");
    if (withSong)
      second.skills = [
        song,
        ...second.skills.filter((x) => x.id !== "espinhos"),
      ];
    const heroes = [at("mago"), second];
    const drain = M.chefe(L, { partySize: 4, type: "masmorra" }).manaDrain!;
    const r = fight(heroes, [dummy({ level: L, manaDrain: drain })], {
      maxSeconds: 100,
      mode: "esperado",
    });
    return r.heroes[0]!.carry.mp / heroes[0]!.stats.mp;
  };
  const dry = drained(100, false);
  const wet = drained(100, true);
  add(
    SM,
    "Drenar Mana (L100, sem poção): sem Canção seca o mago antes de 100 s; com Canção, não",
    dry < 0.05 && wet > 0.2 ? "ok" : "falha",
    `mana do mago aos 100 s: ${pct(dry)} sem a Canção, ${pct(wet)} com ela`,
  );
  add(
    SM,
    "Drenar Mana mais acima",
    "info",
    [200, 400]
      .map(
        (L) =>
          `L${L} ${pct(drained(L, false))} sem a Canção, ${pct(drained(L, true))} com ela`,
      )
      .join(" · ") + " (a mana do mago cresce mais que o dreno)",
  );

  // ------------------------------------------------------------ §14.7 ritmo
  const S7 = "§14.7 Ritmo";
  const cacadas = DUNGEONS.filter((d) => d.kind === "cacada");
  const ratioAt = new Map<number, { ratio: number; seconds: number }>();
  for (const d of cacadas) {
    const r = simulateRun(
      d,
      [E.fighter("mago", d.level, { ...SPEC, solo: true })],
      { mode: "esperado" },
      B,
      M,
    );
    const xp = runRewards(d, [d.level], r, B).heroes[0]!.xp;
    ratioAt.set(d.level, {
      ratio: xp / (B.xpToNext(d.level) / B.runsPerLevel(d.level)),
      seconds: r.seconds,
    });
  }
  const nearest = (l: number) => {
    let best = cacadas[0]!;
    for (const d of cacadas) if (d.level <= l) best = d;
    return ratioAt.get(best.level)!;
  };
  const marks = [10, 20, 40, 70, 100, 150, 200, 300, 400, 500];
  const devs = marks.map((L) => {
    let real = 0;
    let hours = 0;
    for (let l = 1; l < L; l++) {
      const x = nearest(l);
      const runs = B.runsPerLevel(l) / x.ratio;
      real += runs;
      hours += (runs * x.seconds) / 3600;
    }
    return { L, dev: real / B.runsTo(L) - 1, hours };
  });
  const off = devs.filter((x) => Math.abs(x.dev) > 0.1);
  add(
    S7,
    "corridas acumuladas a ±10% da tabela do §17 (XP real da Caçada solo)",
    off.length === 0 ? "ok" : "falha",
    devs
      .map(
        (x) => `L${x.L} ${x.dev >= 0 ? "+" : ""}${(x.dev * 100).toFixed(1)}%`,
      )
      .join(" · "),
  );
  let job20 = 1;
  while (B.jobForLevel(job20) < 20) job20++;
  add(
    S7,
    "job 20 entre o L24 e o L28",
    job20 >= 24 && job20 <= 28 ? "ok" : "falha",
    `job 20 no L${job20}`,
  );
  add(
    S7,
    "Dojô até 10·L em 70–100% das horas de DG",
    "info",
    devs
      .map((x) => `L${x.L} ${pct(B.dojoHoursTo(10 * x.L) / x.hours)}`)
      .join(" · ") +
      " (horas de DG da Caçada solo do mago; tempo só informa, D21)",
  );

  // ------------------------------------------------------------ §13 economia
  const S13 = "§13 Economia";
  const eco = masmorras.map((d) => {
    const ps = party(ref, d.level);
    const r = simulateRun(d, ps, { mode: "esperado" }, B, M);
    const rw = runRewards(
      d,
      ref.map(() => d.level),
      r,
      B,
    );
    const price = potionPrice(d.level, B);
    let spent = 0;
    let gold = 0;
    ref.forEach((_, j) => {
      const hp = r.rooms.reduce((a, room) => a + room.heroes[j]!.hpPotions, 0);
      const mp = r.rooms.reduce((a, room) => a + room.heroes[j]!.mpPotions, 0);
      spent += hp * price.hp + mp * price.mp;
      gold += rw.heroes[j]!.gold;
    });
    return { L: d.level, share: spent / Math.max(1, gold) };
  });
  const outside = eco.filter((x) => x.share < 0.05 || x.share > 0.1);
  // D30: a poção sobe por tier; dentro de um tier o gasto varia quase 2× (o 410 gasta o dobro do 420),
  // então uma sobra a até 0,5 p.p. da faixa fica aceita (P74).
  const near = outside.every((x) => x.share >= 0.045 && x.share <= 0.105);
  add(
    S13,
    "as poções de uma Masmorra custam 5–10% do ouro da corrida (PT de referência, 37 Masmorras)",
    outside.length === 0 ? "ok" : near ? "aceita" : "falha",
    `${eco.length - outside.length}/${eco.length} na faixa` +
      (outside.length
        ? `; fora: ${outside.map((x) => `L${x.L} ${(x.share * 100).toFixed(1)}%`).join(", ")}${near ? " (P74: a até 0,5 p.p. da faixa)" : ""}`
        : "") +
      ` · de ${(Math.min(...eco.map((x) => x.share)) * 100).toFixed(1)}% a ${(Math.max(...eco.map((x) => x.share)) * 100).toFixed(1)}%`,
  );

  return lines;
}

/** O relatório em texto, por seção, com o resumo no fim. */
export function formatReport(lines: ReportLine[]): string {
  const mark: Record<LineStatus, string> = {
    ok: "ok    ",
    falha: "FALHA ",
    aceita: "aceita",
    info: "info  ",
  };
  const out: string[] = [];
  let section = "";
  for (const l of lines) {
    if (l.section !== section) {
      section = l.section;
      out.push("", section);
    }
    out.push(`  [${mark[l.status]}] ${l.label}: ${l.detail}`);
  }
  const count = (s: LineStatus) => lines.filter((l) => l.status === s).length;
  out.push(
    "",
    `${count("ok")} ok · ${count("falha")} falha(s) · ${count("aceita")} aceita(s) · ${count("info")} informativa(s)`,
  );
  return out.join("\n");
}
