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
import {
  type LimitStep,
  LIMIT_GROUP_PARTIES,
  LIMIT_STEPS,
  limitFighter,
} from "./calibration.ts";
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
  const E = createEncounters(B, "limite");
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
  // D41 (25/11/2026): a PT completa é de 5 e o conteúdo sai do perfil do limite (item da faixa, afixos
  // da classe, build e kit de referência). Cada DG fica no ponto do grupo de calibração mais frágil
  // (dungeons/edge.generated.ts); um degrau abaixo num eixo deve perder boa parte.
  const S1 = "§14.1 Composições no limite (corrida inteira, modo esperado, 37 Masmorras e 10 Regiões)";
  const groupDgs = DUNGEONS.filter((d) => d.kind !== "cacada");
  const stepRun = (d: DungeonDef, c: Comp, step?: LimitStep["id"]) =>
    simulateRun(
      d,
      c.map((x) => limitFighter(x, d.level, step ? { step } : {}, B)),
      { mode: "esperado" },
      B,
      M,
    );
  for (const c of LIMIT_GROUP_PARTIES) {
    const lost = groupDgs
      .filter((d) => stepRun(d, [...c]).outcome !== "vitoria")
      .map((d) => d.level);
    add(
      S1,
      `grupo de 5 ${short([...c])} vence no limite`,
      lost.length === 0 ? "ok" : "falha",
      lost.length === 0
        ? `${groupDgs.length}/${groupDgs.length}`
        : `perde em ${lost.join(", ")} (rodar scripts/gen-edge.ts)`,
    );
  }
  const main = [...LIMIT_GROUP_PARTIES[0]!];
  for (const st of LIMIT_STEPS) {
    const won = groupDgs.filter((d) => stepRun(d, main, st.id).outcome === "vitoria").length;
    add(
      S1,
      `um degrau abaixo (${st.label}) no ${short(main)}`,
      "info",
      `vence ${won}/${groupDgs.length} (${pct(won / groupDgs.length)})` +
        (st.id === "atributos"
          ? " (P85: a build da classe rende ~15% a mais que a igual na função; o HP extra da igual compensa)"
          : ""),
    );
  }
  // Quem ficou de fora da calibração: medido, não cobrado.
  const others: [string, Comp, string][] = [
    ["2 tanques, padre e druida (sem DPS puro)", ["guerreiro", "padre", "druida", "paladino"], " (D42: o druida de batalha conta como meio DPS)"],
    ["paladino com o druida", ["paladino", "druida", "mago", "cacador", "assassino"], " (D42: o druida de batalha é cura única com o guerreiro; com o paladino de tanque, ainda não)"],
    ["paladino de tanque", ["paladino", "padre", "mago", "cacador", "assassino"], ""],
    ["grupo de 4", ["guerreiro", "padre", "mago", "cacador"], " (D41: a PT completa é de 5; com 4 a falta aparece)"],
    ["trio", ["guerreiro", "padre", "mago"], " (a sala da Masmorra não encolhe abaixo de 3)"],
  ];
  for (const [what, c, why] of others) {
    const won = groupDgs.filter((d) => stepRun(d, c).outcome === "vitoria").length;
    add(S1, `${what} ${short(c)} no limite`, "info", `vence ${won}/${groupDgs.length}${why}`);
  }
  const mustLose: [string, Comp][] = [
    ["sem tanque", ["padre", "mago", "cacador", "assassino"]],
    ["sem tanque", ["druida", "mago", "cacador", "assassino"]],
    ["sem suporte", ["guerreiro", "mago", "cacador", "assassino"]],
    ["sem suporte", ["paladino", "mago", "cacador", "assassino"]],
    // D42: o druida de batalha bate (metade do mago): o "sem DPS" leva dois padres.
    ["sem DPS", ["guerreiro", "padre", "paladino", "padre"]],
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
  // D41: a proficiência de 10 × L faz parte do limite; sem treino (b = 1) o grupo perde, e é o esperado.
  const ref: Comp = [...LIMIT_GROUP_PARTIES[0]!];
  const low = masmorras.filter((d) => d.level <= 100);
  const lowWon = low.filter(
    (d) => run(d, ref, { proficiency: () => 1 }).outcome === "vitoria",
  ).length;
  add(
    S8,
    `grupo de 5 sem treino (b = 1) até o L100`,
    "info",
    `vence ${lowWon}/${low.length} (D41: o treino faz parte do limite)`,
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
    ...LIMIT_GROUP_PARTIES.map((c) => ["grupo de 5", [...c], true] as [string, Comp, boolean]),
    ["sem tanque", ["padre", "mago", "cacador", "assassino"], false],
    ["sem DPS", ["guerreiro", "padre", "paladino", "padre"], false],
  ];
  // D41: "vence 9 em 10" (decisão do dono) no grupo de calibração; o gerador confere com 20 corridas,
  // aqui são `n`: até 5 p.p. abaixo fica aceito pelo sorteio.
  const WIN = B.cfg.limit.winTarget;
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
    const bad = rates.filter((x) => (win ? x.rate < WIN : x.rate > 0.05));
    const nearWin = win && bad.every((x) => x.rate >= WIN - 0.05);
    // D29 e D33: até o L90 (onde a Consagração do paladino entra, D32) quem devia perder pode
    // vencer às vezes no aleatório; do 100 em diante, não.
    const earlyBand = !win && bad.length > 0 && bad.every((x) => x.L < 100);
    add(
      S9,
      `${what} ${short(c)} ${win ? `vence em ≥ ${pct(WIN)}` : "vence em ≤ 5%"}`,
      bad.length === 0 ? "ok" : earlyBand || nearWin ? "aceita" : "falha",
      rates.map((x) => `L${x.L} ${pct(x.rate)}`).join(" · ") +
        (bad.length && nearWin
          ? " (D41: a até 5 p.p. da meta, sorteio)"
          : bad.length && !win
            ? earlyBand
              ? " (D29/D33: até o L90 fica como exceção)"
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
  // D40: sem descanso entre as salas o mago solo perde algumas Caçadas do próprio nível. A curva mede
  // o XP de uma Caçada vencida, então nessas faixas entra a vitória do caçador (a derrota do mago já
  // aparece na §14.4/testes).
  const magoLost: number[] = [];
  for (const d of cacadas) {
    const solo = (cls: ClassId) =>
      simulateRun(
        d,
        [E.fighter(cls, d.level, { ...SPEC, solo: true })],
        { mode: "esperado" },
        B,
        M,
      );
    let r = solo("mago");
    if (r.outcome !== "vitoria") {
      magoLost.push(d.level);
      r = solo("cacador");
    }
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
      .join(" · ") +
      (magoLost.length
        ? ` (D40: o mago perde a do ${magoLost.join(", ")}; ali conta a vitória do caçador)`
        : ""),
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
    const ps = ref.map((c) => limitFighter(c, d.level, {}, B));
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
  // D40: sem descanso entre as salas a PT bebe mais (medido em 25/11/2026: até 21%). Aceito até 25%;
  // o piso de 5% continua valendo.
  const d40 = outside.every((x) => x.share >= 0.045 && x.share <= 0.25);
  // D41: no limite o grupo bebe mais (vence apertado, gastando poção). A meta do §13 fica em aberto
  // (P83: preço da poção ou ouro da Masmorra), medida aqui.
  const d41 = outside.every((x) => x.share >= 0.045);
  add(
    S13,
    "as poções de uma Masmorra custam 5–10% do ouro da corrida (grupo de 5 no limite, 37 Masmorras)",
    outside.length === 0 ? "ok" : near || d40 || d41 ? "aceita" : "falha",
    `${eco.length - outside.length}/${eco.length} na faixa` +
      (outside.length
        ? `; fora: ${outside.map((x) => `L${x.L} ${(x.share * 100).toFixed(1)}%`).join(", ")}${near ? " (P74: a até 0,5 p.p. da faixa)" : d40 ? " (D40: sem descanso, aceito até 25%)" : d41 ? " (P83: no limite o grupo bebe mais; preço em aberto)" : ""}`
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
