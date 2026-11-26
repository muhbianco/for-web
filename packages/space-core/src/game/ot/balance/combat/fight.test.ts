import assert from "node:assert/strict";
import test from "node:test";

import { encounters as E } from "../sim/encounters.ts";
import { GABARITO_KITS } from "../sim/kits.ts";
import { compileSkill } from "../skills/compile.ts";
import { skillOf } from "../skills/index.ts";
import { fight, skillTotalMultiplier } from "./fight.ts";
import type { EnemyInput, FighterInput, SkillDef } from "./types.ts";

// Mecânicas do motor de luta (spec §5), uma a uma.

const L = 100;
const bare = (
  cls: FighterInput["cls"],
  skills: SkillDef[] = [],
): FighterInput => ({
  ...E.fighter(cls, L),
  skills,
});
const hitter = (raw: number, extra: Partial<EnemyInput> = {}): EnemyInput => ({
  archetype: "chefe",
  level: L,
  hp: 1e15,
  autoRaw: raw,
  attacksPerSecond: 0.5,
  ...extra,
});
const run = (heroes: FighterInput[], enemies: EnemyInput[], maxSeconds = 30) =>
  fight(heroes, enemies, { maxSeconds, mode: "esperado" });

test("ameaça: com o guerreiro provocando, o chefe não encosta no mago", () => {
  const r = run(
    [
      bare("guerreiro", GABARITO_KITS.guerreiro),
      bare("mago", GABARITO_KITS.mago),
    ],
    [hitter(E.dungeonBoss(L, 4).autoRaw)],
  );
  assert.equal(r.heroes[1]!.hpPct, 1, "o mago apanhou");
  assert.ok(r.heroes[0]!.hpPct < 1, "o guerreiro não apanhou");
});

test("ameaça: sem tanque, o chefe fica em quem mais ameaça (o mago, que mais causa dano)", () => {
  // No tique 0 ninguém tem ameaça e o primeiro golpe vai no primeiro da fila (como no gabarito).
  const r = run(
    [bare("mago", GABARITO_KITS.mago), bare("padre")],
    [hitter(200)],
  );
  assert.ok(r.heroes[0]!.hpPct < 1, "o mago não apanhou");
  assert.equal(r.heroes[1]!.hpPct, 1, "o padre apanhou");
});

test("poções: no máximo 1 por segundo", () => {
  const h = { ...bare("cacador"), potions: { hp: 1, mp: 1, stock: 1000 } };
  const r = run([h], [hitter(800)], 30);
  // Com 1 de cura por poção ele bebe sem parar abaixo de 50%: nunca mais de 1 por segundo.
  const used = r.heroes[0]!.potionsUsed;
  assert.ok(used > 0, "não bebeu");
  assert.ok(used <= Math.ceil(r.seconds), `${used} poções em ${r.seconds} s`);
});

test("poções: vida antes de mana quando as duas estão abaixo do limiar", () => {
  // Limiares acima de 100%: as duas valem o tempo todo; só a de vida sai.
  const h = {
    ...bare("mago"),
    potions: { hp: 50, mp: 50, stock: 1000 },
    potionAt: { hp: 1.01, mp: 1.01 },
  };
  const r = run([h], [hitter(0)], 10);
  assert.ok(r.heroes[0]!.hpPotions >= 9, `${r.heroes[0]!.hpPotions} de vida`);
  assert.equal(r.heroes[0]!.mpPotions, 0);
});

test("Cataclismo: dano verdadeiro, 40% do HP máximo a cada 2 s, passa por cima de escudo", () => {
  const shieldAll: SkillDef = {
    id: "escudo",
    name: "Escudo",
    cooldownMs: 1000,
    manaPct: 0,
    condition: { kind: "sempre" },
    effects: [
      { type: "escudo", target: "proprio", pctMaxHp: 10, durationMs: 60_000 },
    ],
  };
  const r = run(
    [bare("guerreiro", [shieldAll])],
    [hitter(0, { cataclysm: { atSeconds: 0, pct: 0.4, everySeconds: 2 } })],
  );
  assert.equal(r.deaths, 1);
  assert.equal(r.firstDeath?.cause, "cataclismo");
  assert.ok(r.seconds <= 4.2, `morreu aos ${r.seconds} s`);
});

test("escudo absorve antes do HP", () => {
  const shield: SkillDef = {
    id: "escudo",
    name: "Escudo",
    cooldownMs: 1000,
    manaPct: 0,
    condition: { kind: "sempre" },
    effects: [
      { type: "escudo", target: "proprio", pctMaxHp: 100, durationMs: 60_000 },
    ],
  };
  const r = run([bare("guerreiro", [shield])], [hitter(300)], 10);
  assert.equal(r.heroes[0]!.hpPct, 1);
});

test("Segurar explosão: o multiplicador total conta golpes físicos (Sequência 4×100% = 400%)", () => {
  const mult = (cls: keyof typeof GABARITO_KITS, id: string) =>
    skillTotalMultiplier(GABARITO_KITS[cls].find((s) => s.id === id)!);
  assert.equal(mult("assassino", "danca-das-laminas"), 0.8 * 8);
  assert.equal(mult("assassino", "sequencia-letal"), 4);
  assert.equal(mult("mago", "meteoro"), 6);
  assert.equal(mult("paladino", "golpe-sagrado"), 0.8);
  assert.equal(mult("cacador", "rajada-dupla"), 1.8);
});

test("Segurar explosão: com tanque, o assassino não passa de 80% da ameaça dele por explosão", () => {
  const r = run(
    [
      bare("guerreiro", GABARITO_KITS.guerreiro),
      bare("assassino", GABARITO_KITS.assassino),
    ],
    [hitter(E.dungeonBoss(L, 4).autoRaw)],
    60,
  );
  assert.equal(r.heroes[1]!.hpPct, 1, "o assassino tomou o aggro");
});

test("bloqueio do escudo (modo esperado): 10% de chance de cortar 60%, +15% no paladino", () => {
  const noShield = run([bare("cacador")], [hitter(400)], 10).heroes[0]!.hpPct;
  const pal = run([bare("paladino")], [hitter(400)], 10).heroes[0]!.hpPct;
  assert.ok(pal > noShield);
});

test("modo aleatório sem fonte de números é erro, não um resultado inventado", () => {
  assert.throws(() =>
    fight([bare("mago")], [hitter(10)], { maxSeconds: 5, mode: "aleatorio" }),
  );
});

// ------------------------------------------------------------ efeitos das 42 skills (Fase 4)

/** A skill do conteúdo, compilada, com IA "Sempre" (para o teste não depender da condição). */
const skill = (
  cls: FighterInput["cls"],
  id: string,
  mechanics: Record<string, number> = {},
): SkillDef => ({
  ...compileSkill(skillOf(cls, id)!, { potency: 1, efficiency: 0, mechanics }),
  condition: { kind: "sempre" },
});
const withSkills = (
  cls: FighterInput["cls"],
  skills: SkillDef[],
): FighterInput => ({
  ...bare(cls, skills),
  potencyRank: 1,
});
const pack = (n: number, extra: Partial<EnemyInput> = {}): EnemyInput[] =>
  Array.from({ length: n }, () =>
    hitter(0, { archetype: "lacaio", hp: 1e9, ...extra }),
  );

test("alvos: área acerta todos; cadeia o alvo + 3 saltos; linha até 3", () => {
  const area = run(
    [withSkills("mago", [skill("mago", "explosao-de-fogo")])],
    pack(5),
    3,
  );
  assert.ok(
    area.enemiesLeft.every((x) => x < 1),
    "a explosão não acertou todos",
  );
  const chain = run(
    [withSkills("mago", [skill("mago", "raio-em-cadeia")])],
    pack(5),
    3,
  );
  assert.ok(chain.enemiesLeft.slice(0, 4).every((x) => x < 1));
  assert.equal(chain.enemiesLeft[4], 1, "o raio saltou mais de 3 vezes");
  const line = run(
    [withSkills("cacador", [skill("cacador", "tiro-perfurante")])],
    pack(5),
    3,
  );
  assert.ok(line.enemiesLeft.slice(0, 3).every((x) => x < 1));
  assert.deepEqual(
    line.enemiesLeft.slice(3),
    [1, 1],
    "o tiro passou de 3 em linha",
  );
});

test("atordoar: o lacaio atordoado para de bater; chefe não é atordoado", () => {
  const raw = 300;
  const lacaio = (skills: SkillDef[]) =>
    run(
      [withSkills("cacador", skills)],
      [hitter(raw, { archetype: "lacaio" })],
      6,
    ).heroes[0]!.hpPct;
  assert.ok(
    lacaio([skill("cacador", "armadilha-de-gelo")]) > lacaio([]),
    "a armadilha não segurou o lacaio",
  );
  const boss = (skills: SkillDef[]) =>
    run([withSkills("cacador", skills)], [hitter(raw)], 6);
  assert.ok(
    boss([skill("cacador", "armadilha-de-gelo")]).heroes[0]!.hpPct < 1,
    "o chefe ficou parado",
  );
});

test("conjuração: o Meteoro só cai depois de 2 s, e o mago não bate enquanto conjura", () => {
  const mage = withSkills("mago", [skill("mago", "meteoro")]);
  // No tique 0 o auto-ataque vem antes da skill: sai 1 golpe e começa a conjuração.
  const opening = run([mage], [hitter(0)], 0.1).damage;
  const early = run([mage], [hitter(0)], 1.9).damage;
  const late = run([mage], [hitter(0)], 2.5).damage;
  assert.equal(early, opening, "bateu enquanto conjurava");
  assert.ok(late > 10 * early, "o meteoro não caiu");
});

test("Ressurreição: revive o aliado caído uma vez por luta", () => {
  const r = run(
    [
      withSkills("mago", []),
      withSkills("padre", [skill("padre", "ressurreicao")]),
    ],
    [hitter(1e7)],
    10,
  );
  assert.equal(r.heroes[1]!.casts["ressurreicao"], 1);
  assert.ok(r.deaths >= 2, "o mago não morreu de novo depois de revivido");
});

test("Recusa da Morte (5/5): o golpe fatal deixa o guerreiro com 1 HP uma vez", () => {
  const big = 1e5;
  const without = run(
    [withSkills("guerreiro", [skill("guerreiro", "ultima-resistencia")])],
    [hitter(big)],
    10,
  );
  const withIt = run(
    [
      withSkills("guerreiro", [
        skill("guerreiro", "ultima-resistencia", { "recusa-da-morte": 5 }),
      ]),
    ],
    [hitter(big)],
    10,
  );
  assert.equal(without.firstDeath?.seconds, 0);
  assert.ok(
    (withIt.firstDeath?.seconds ?? 99) > 0,
    "morreu no primeiro golpe mesmo assim",
  );
});

test("Reflexo Sagrado: o escudo que quebra causa dano sagrado", () => {
  const dmg = (mech: Record<string, number>) =>
    run(
      [withSkills("paladino", [skill("paladino", "escudo-da-fe", mech)])],
      [hitter(3000)],
      12,
    ).damage;
  assert.ok(dmg({ "reflexo-sagrado": 5 }) > dmg({}));
});

test("Consagração: cada inimigo consagrado cura o paladino em 2% do HP máx. por segundo (P63)", () => {
  const gain = (n: number) => {
    const pal = withSkills("paladino", [skill("paladino", "consagracao")]);
    const start = 0.6; // acima da linha da poção, que fica sem estoque
    const r = fight([pal], pack(n), {
      maxSeconds: 3,
      mode: "esperado",
      carry: [
        {
          hp: start * pal.stats.hp,
          mp: pal.stats.mp,
          alive: true,
          pots: 0,
          cooldowns: {},
          revived: false,
          cheatedDeath: false,
        },
      ],
    });
    return r.heroes[0]!.hpPct - start;
  };
  const one = gain(1);
  // Os pulsos começam no tique seguinte à conjuração: 2,9 s de cura em 3 s de luta.
  assert.ok(Math.abs(one - 0.02 * 2.9) < 0.002, `1 inimigo: ${one}`);
  assert.ok(Math.abs(gain(3) - 3 * one) < 1e-9, "não cresceu com os inimigos");
});

test("Consagração: desde a D50 o DoT dá ameaça ×1, como o auto-ataque (era ×2 no spec)", () => {
  const pal = withSkills("paladino", [skill("paladino", "consagracao")]);
  const r = run([pal], [hitter(0)], 5).heroes[0]!;
  const dot = r.damage - r.autoDamage;
  assert.ok(dot > 0, "a Consagração não queimou");
  const expected = pal.stats.threat * (r.autoDamage + dot);
  assert.ok(
    Math.abs(r.threat[0]! / expected - 1) < 1e-9,
    `ameaça ${r.threat[0]} × esperada ${expected}`,
  );
});

test("Esquiva Sombria corta a ameaça; o veneno do assassino ganha +20%", () => {
  const plain = run(
    [withSkills("assassino", [skill("assassino", "lamina-envenenada")])],
    [hitter(0)],
    6,
  ).damage;
  const poison = run(
    [
      {
        ...withSkills("assassino", [skill("assassino", "lamina-envenenada")]),
        poisonBonus: 0.2,
      },
    ],
    [hitter(0)],
    6,
  ).damage;
  assert.ok(poison > plain);
});

// ------------------------------------------------------------ cura inteligente (D25)

/** A skill do conteúdo com a IA padrão dela (a cura inteligente). */
const withAi = (cls: FighterInput["cls"], id: string): SkillDef =>
  compileSkill(skillOf(cls, id)!, { potency: 1, efficiency: 0, mechanics: {} });

/** Luta curta contra um chefe que não bate, com cada herói começando em `hpPct` do HP (sem poção). */
const healFight = (
  heroes: FighterInput[],
  hpPct: number[],
  maxSeconds = 2,
  pots: number[] = [],
) =>
  fight(heroes, [hitter(0)], {
    maxSeconds,
    mode: "esperado",
    carry: heroes.map((f, i) => ({
      hp: f.stats.hp * hpPct[i]!,
      mp: f.stats.mp,
      alive: true,
      pots: pots[i] ?? 0,
      cooldowns: {},
      revived: false,
      cheatedDeath: false,
    })),
  });

test("cura inteligente: o Curar sai quando rende, sem esperar o aliado cair a 80%", () => {
  const party = (heal: boolean) => [
    bare("guerreiro"),
    withSkills("padre", heal ? [withAi("padre", "curar")] : []),
  ];
  const r = healFight(party(true), [0.88, 1]);
  const base = healFight(party(false), [0.88, 1]);
  assert.equal(r.heroes[1]!.casts["curar"], 1);
  assert.equal(r.heroes[0]!.hpPct, 1, "o tanque não foi curado");
  assert.ok(base.heroes[0]!.hpPct < 0.95);
});

test("cura inteligente: ninguém ferido, nenhuma cura (sem gastar mana à toa)", () => {
  const r = healFight(
    [
      bare("guerreiro"),
      bare("mago"),
      withSkills("padre", [withAi("padre", "curar")]),
    ],
    [1, 1, 1],
    5,
  );
  assert.equal(r.heroes[2]!.casts["curar"] ?? 0, 0);
});

test("cura inteligente: com o tanque precisando, ele vem primeiro", () => {
  const party = (heal: boolean) => [
    bare("guerreiro"),
    bare("cacador"),
    withSkills("padre", heal ? [withAi("padre", "curar")] : []),
  ];
  // Os dois aproveitam o Curar inteiro e o caçador está mais baixo (62%), mas o tanque tem a prioridade.
  const r = healFight(party(true), [0.7, 0.62, 1]);
  const base = healFight(party(false), [0.7, 0.62, 1]);
  assert.ok(
    r.heroes[0]!.hpPct > base.heroes[0]!.hpPct + 0.1,
    "o tanque não foi curado",
  );
  assert.ok(
    r.heroes[1]!.hpPct < base.heroes[1]!.hpPct + 0.01,
    "a cura foi no caçador",
  );
});

test("cura inteligente: aliado abaixo de 60% e sem poção passa à frente do tanque", () => {
  const party = (heal: boolean) => [
    bare("guerreiro"),
    bare("mago"),
    withSkills("padre", heal ? [withAi("padre", "curar")] : []),
  ];
  const r = healFight(party(true), [0.7, 0.3, 1]);
  const base = healFight(party(false), [0.7, 0.3, 1]);
  assert.ok(
    r.heroes[1]!.hpPct > base.heroes[1]!.hpPct + 0.3,
    "o mago não foi curado",
  );
  assert.ok(
    r.heroes[0]!.hpPct < base.heroes[0]!.hpPct + 0.01,
    "a cura foi no tanque",
  );
});

test("cura inteligente: abaixo de 60% com a poção pronta, o tanque continua primeiro (D26)", () => {
  const party = (heal: boolean) => [
    bare("guerreiro"),
    bare("cacador"),
    withSkills("padre", heal ? [withAi("padre", "curar")] : []),
  ];
  // A 55% o caçador ainda não bebe (bebe abaixo de 50%): a poção dele está pronta, e o Curar vai no tanque.
  const r = healFight(party(true), [0.7, 0.55, 1], 2, [0, 5, 0]);
  const base = healFight(party(false), [0.7, 0.55, 1], 2, [0, 5, 0]);
  assert.equal(r.heroes[1]!.potionsUsed, 0);
  assert.ok(
    r.heroes[0]!.hpPct > base.heroes[0]!.hpPct + 0.1,
    "o tanque não foi curado",
  );
  assert.ok(
    r.heroes[1]!.hpPct < base.heroes[1]!.hpPct + 0.01,
    "a cura foi no caçador",
  );
});

test("cura inteligente: com a poção em recarga, conta como sem poção e passa à frente (D27)", () => {
  const party = (heal: boolean) => [
    bare("guerreiro"),
    bare("mago"),
    withSkills("padre", heal ? [withAi("padre", "curar")] : []),
  ];
  // A 30% o mago bebe uma poção no 1º tique; com ela em recarga, o Curar vai nele.
  const r = healFight(party(true), [0.7, 0.3, 1], 0.5, [0, 5, 0]);
  const base = healFight(party(false), [0.7, 0.3, 1], 0.5, [0, 5, 0]);
  assert.equal(r.heroes[1]!.potionsUsed, 1);
  assert.ok(
    r.heroes[1]!.hpPct > base.heroes[1]!.hpPct + 0.3,
    "o mago não foi curado",
  );
  assert.ok(
    r.heroes[0]!.hpPct < base.heroes[0]!.hpPct + 0.01,
    "a cura foi no tanque",
  );
});

test("cura inteligente: sem tanque, vai em quem aproveita mais a cura", () => {
  const party = (heal: boolean) => [
    bare("mago"),
    bare("cacador"),
    withSkills("padre", heal ? [withAi("padre", "curar")] : []),
  ];
  // Os dois a 70%: o mago perdeu ~300 de HP e o caçador ~435; o Curar (~536) rende mais no caçador.
  const r = healFight(party(true), [0.7, 0.7, 1]);
  const base = healFight(party(false), [0.7, 0.7, 1]);
  assert.ok(
    r.heroes[1]!.hpPct > base.heroes[1]!.hpPct + 0.2,
    "o caçador não foi curado",
  );
  assert.ok(
    r.heroes[0]!.hpPct < base.heroes[0]!.hpPct + 0.01,
    "a cura foi no mago",
  );
});

test("cura inteligente: a de grupo só sai quando rende no grupo", () => {
  const party = () => [
    bare("guerreiro"),
    bare("mago"),
    bare("cacador"),
    withSkills("druida", [withAi("druida", "florescer")]),
  ];
  const one = healFight(party(), [1, 0.5, 1, 1]);
  assert.equal(
    one.heroes[3]!.casts["florescer"] ?? 0,
    0,
    "saiu com um só ferido",
  );
  const all = healFight(party(), [0.5, 0.4, 0.4, 0.6]);
  assert.equal(all.heroes[3]!.casts["florescer"], 1);
});

test("D46: mana crítica passa na frente da poção de vida (se a vida não estiver crítica)", () => {
  const first = (hpPct: number, mpPct: number, at = { hp: 0.5, mp: 0.4 }) => {
    const f: FighterInput = {
      ...withSkills("cacador", []),
      potions: { hp: 10, mp: 10, stock: 0, hpStock: 5, mpStock: 5 },
      potionAt: at,
    };
    const r = fight([f], pack(1), {
      maxSeconds: 1,
      mode: "esperado",
      record: true,
      carry: [
        {
          hp: hpPct * f.stats.hp,
          mp: mpPct * f.stats.mp,
          alive: true,
          pots: 10,
          hpPots: 5,
          mpPots: 5,
          cooldowns: {},
          revived: false,
          cheatedDeath: false,
        },
      ],
    });
    const p = r.frames!.flatMap((x) => x.e).find((e) => e.k === "pocao");
    return p ? (p.k === "pocao" && p.mana ? "mana" : "vida") : "nenhuma";
  };
  // Vida abaixo da linha (50%) mas acima da crítica (35%), mana crítica: a de mana sai antes.
  assert.equal(first(0.45, 0.1), "mana");
  // Mana baixa mas não crítica (20%): a vida segue antes, como sempre.
  assert.equal(first(0.45, 0.2), "vida");
  // Vida crítica: vida antes, mesmo com a mana zerada.
  assert.equal(first(0.3, 0.05), "vida");
  // Quem desligou a poção de mana não bebe mana nunca.
  assert.equal(first(0.45, 0.05, { hp: 0.5, mp: 0 }), "vida");
});

test("provocação (26/11/2026): em grupo, o Grito de Guerra não sai com os monstros no tanque; sozinho, sai como antes", () => {
  const grito = compileSkill(skillOf("guerreiro", "grito-de-guerra")!, {
    potency: 1,
    efficiency: 0,
    mechanics: {},
  });
  const warrior = () => bare("guerreiro", [grito]);
  const weak = () => hitter(5);
  // O padre sem skill não puxa nada: os dois monstros ficam no guerreiro, vida cheia.
  const group = run([warrior(), bare("padre")], [weak(), weak()]);
  assert.equal(group.heroes[0]!.casts["grito-de-guerra"] ?? 0, 0, "gritou segurando os dois");
  // Sozinho não há a quem provocar: o Grito sai pelos outros efeitos (a defesa), como antes.
  const solo = run([warrior()], [weak(), weak()]);
  assert.ok((solo.heroes[0]!.casts["grito-de-guerra"] ?? 0) >= 1, "sozinho não gritou");
  // Apanhando de dois com a vida abaixo de 70%, sai como defesa mesmo segurando os dois.
  const hard = () => hitter(E.dungeonBoss(L, 4).autoRaw / 3);
  const pressed = run([warrior(), bare("padre")], [hard(), hard()]);
  assert.ok((pressed.heroes[0]!.casts["grito-de-guerra"] ?? 0) >= 1, "não se defendeu");
});

test("D49: a Desafio leva a ameaça do guerreiro aos monstros que ele não acerta (4% por up)", () => {
  const golpe = (desafio: number) =>
    compileSkill(skillOf("guerreiro", "golpe-provocador")!, {
      potency: 1,
      efficiency: 0,
      mechanics: desafio ? { desafio } : {},
    });
  const threat = (desafio: number) =>
    run([bare("guerreiro", [golpe(desafio)])], [hitter(5), hitter(5)], 20).heroes[0]!.threat;
  // Sem a Desafio, o monstro que ele não acerta fica sem ameaça nenhuma dele.
  assert.equal(threat(0)[1], 0);
  // Com 5 ups, 20% do que ele gera no alvo vale no outro (a provocação do alvo não entra na conta).
  const [a, b] = threat(5);
  assert.ok(b! > 0 && b! <= 0.2 * a! + 1e-9, `alvo ${a}, outro ${b}`);
});
