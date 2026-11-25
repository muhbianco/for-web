import type { Effect, SkillDef } from "../combat/types.ts";
import type { ClassId } from "../content.ts";

/**
 * Os kits do gabarito (idlehunt_sim_referencia.py, KITS e SOLO_KITS) escritos como dado de skill: são
 * o fixture que calibrou o spec e que os invariantes da §14 usam. Reproduzem o gabarito, inclusive
 * nos atalhos dele (a Égide também reduz o mágico pela parte física, Égide e Pele de Carvalho se
 * sobrescrevem, Raízes vira −12% de dano do chefe, Consagração sai de uma vez). As 42 skills de
 * verdade, com o texto do spec, entram na Fase 4 e trocam estes kits nos invariantes.
 */

const s = (
  id: string,
  name: string,
  cooldownMs: number,
  manaPct: number,
  condition: SkillDef["condition"],
  effects: Effect[],
  threatMult?: number,
): SkillDef => ({
  id,
  name,
  cooldownMs,
  manaPct,
  condition,
  effects,
  ...(threatMult ? { threatMult } : {}),
});

const always = { kind: "sempre" } as const;
const ally = (pct: number) => ({ kind: "aliadoAbaixo", pct }) as const;
const selfBelow = (pct: number) => ({ kind: "meuHpAbaixo", pct }) as const;
const targeted = { kind: "sendoAlvo" } as const;
const phys = (coef: number) => ({ element: "fisico", coef }) as const;
const magic = (coef: number) => ({ element: "magico", coef }) as const;
const holy = (coef: number) => ({ element: "sagrado", coef }) as const;

const muralha = s(
  "muralha-de-ferro",
  "Muralha de Ferro",
  30_000,
  0.08,
  targeted,
  [
    {
      type: "buff",
      target: "proprio",
      stat: "reducao",
      value: 0.3,
      durationMs: 8000,
    },
  ],
);
const ultima = s(
  "ultima-resistencia",
  "Última Resistência",
  90_000,
  0.1,
  selfBelow(0.35),
  [{ type: "cura", target: "proprio", pctMaxHp: 0.25 }],
);
const escudoDaFe = s("escudo-da-fe", "Escudo da Fé", 20_000, 0.08, targeted, [
  { type: "escudo", target: "proprio", pctMaxHp: 0.2, durationMs: 10_000 },
]);
const imposicao = s(
  "imposicao-de-maos",
  "Imposição de Mãos",
  45_000,
  0.12,
  ally(0.4),
  [{ type: "cura", target: "aliado", pctMaxHp: 0.3, noBonus: true }],
);
const escudoSagrado = s(
  "escudo-sagrado",
  "Escudo Sagrado",
  12_000,
  0.1,
  always,
  [
    {
      type: "escudo",
      target: "alvo-do-chefe",
      coefMatk: 0.4,
      durationMs: 8000,
    },
  ],
);
const bencao = s("bencao", "Bênção", 25_000, 0.06, always, [
  {
    type: "buff",
    target: "grupo",
    stat: "dano",
    value: 0.08,
    durationMs: 30_000,
  },
]);
const pele = s("pele-de-carvalho", "Pele de Carvalho", 45_000, 0.1, always, [
  {
    type: "buff",
    target: "grupo",
    stat: "reducao",
    value: 0.12,
    durationMs: 12_000,
    group: "partydr",
  },
]);
const espinhos = s("espinhos", "Espinhos", 8000, 0.05, always, [
  {
    type: "debuff",
    stat: "danoCausado",
    value: 0.1,
    durationMs: 10_000,
    group: "bossweak",
  },
  { type: "dano", parts: [magic(1)] },
  { type: "dot", element: "magico", coefPerSec: 0.25, durationMs: 8000 },
]);
const rejuvenescer = (below: number) =>
  s("rejuvenescer", "Rejuvenescer", 2500, 0.07, ally(below), [
    {
      type: "hot",
      target: "aliado",
      coefMatkPerSec: 0.045,
      durationMs: 10_000,
      stacks: 2,
    },
  ]);
const curar = (below: number) =>
  s("curar", "Curar", 2500, 0.08, ally(below), [
    { type: "cura", target: "aliado", coefMatk: 0.3 },
  ]);

/** Os kits de referência contra chefe (spec §8, "Kits de referência usados no simulador"). */
export const GABARITO_KITS: Record<ClassId, SkillDef[]> = {
  guerreiro: [
    s(
      "golpe-provocador",
      "Golpe Provocador",
      8000,
      0.04,
      always,
      [
        { type: "dano", parts: [phys(1.3)] },
        { type: "provocar", durationMs: 4000, scope: "alvo" },
      ],
      2,
    ),
    s("grito-de-guerra", "Grito de Guerra", 15_000, 0.06, always, [
      {
        type: "buff",
        target: "proprio",
        stat: "reducao",
        value: 0.1,
        durationMs: 6000,
      },
      { type: "provocar", durationMs: 3000, scope: "sala" },
    ]),
    muralha,
    ultima,
  ],
  paladino: [
    s(
      "golpe-sagrado",
      "Golpe Sagrado",
      8000,
      0.04,
      always,
      [
        { type: "dano", parts: [phys(0.8), holy(0.8)] },
        { type: "provocar", durationMs: 4000, scope: "alvo" },
      ],
      3,
    ),
    escudoDaFe,
    s("bencao-da-egide", "Bênção da Égide", 40_000, 0.1, always, [
      {
        type: "buff",
        target: "grupo",
        stat: "reducao",
        value: 0.1,
        durationMs: 10_000,
        group: "partydr",
      },
      {
        type: "buff",
        target: "grupo",
        stat: "reducaoMagica",
        value: 0.2,
        durationMs: 10_000,
        group: "partymdr",
      },
    ]),
    imposicao,
  ],
  padre: [
    curar(0.8),
    escudoSagrado,
    s("santuario", "Santuário", 30_000, 0.15, ally(0.9), [
      { type: "hot", target: "grupo", coefMatkPerSec: 0.022, durationMs: 8000 },
    ]),
    bencao,
  ],
  druida: [
    s("florescer", "Florescer", 60_000, 0.2, ally(0.6), [
      { type: "cura", target: "grupo", coefMatk: 0.45 },
    ]),
    pele,
    espinhos,
    rejuvenescer(0.95),
  ],
  mago: [
    s("meteoro", "Meteoro", 60_000, 0.2, always, [
      { type: "dano", parts: [magic(6)] },
    ]),
    s("raio-em-cadeia", "Raio em Cadeia", 10_000, 0.08, always, [
      { type: "dano", parts: [magic(2.4)] },
    ]),
    s("seta-arcana", "Seta Arcana", 3000, 0.04, always, [
      { type: "dano", parts: [magic(1.6)] },
    ]),
    s("escudo-de-mana", "Escudo de Mana", 30_000, 0, selfBelow(0.6), [
      { type: "escudoDeMana", pct: 0.4, durationMs: 12_000 },
    ]),
  ],
  cacador: [
    s("marca-do-cacador", "Marca do Caçador", 20_000, 0.06, always, [
      {
        type: "debuff",
        stat: "danoRecebido",
        value: 0.12,
        durationMs: 10_000,
        group: "mark",
      },
    ]),
    s("foco-mortal", "Foco Mortal", 40_000, 0.08, always, [
      {
        type: "buff",
        target: "proprio",
        stat: "critico",
        value: 0.15,
        durationMs: 8000,
      },
      {
        type: "buff",
        target: "proprio",
        stat: "multCritico",
        value: 0.3,
        durationMs: 8000,
      },
    ]),
    s("tiro-perfurante", "Tiro Perfurante", 45_000, 0.15, always, [
      { type: "dano", parts: [phys(4.5)], penetration: 0.5 },
    ]),
    s("rajada-dupla", "Rajada Dupla", 6000, 0.04, always, [
      { type: "dano", parts: [phys(0.9)], hits: 2 },
    ]),
  ],
  assassino: [
    s("danca-das-laminas", "Dança das Lâminas", 50_000, 0.15, always, [
      { type: "dano", parts: [phys(0.8)], hits: 8, critFlat: 0.2 },
    ]),
    s("emboscada", "Emboscada", 20_000, 0.08, always, [
      { type: "dano", parts: [phys(3)], ambush: true },
    ]),
    s("sequencia-letal", "Sequência Letal", 10_000, 0.07, always, [
      { type: "dano", parts: [phys(1)], hits: 4 },
    ]),
    s("lamina-envenenada", "Lâmina Envenenada", 6000, 0.04, always, [
      { type: "dano", parts: [phys(1.4)] },
      { type: "dot", element: "fisico", coefPerSec: 0.3, durationMs: 6000 },
    ]),
  ],
};

/** Kits solo (§8): tanques trocam uma defensiva por área; padre com Luz Sagrada; druida com Raízes. */
export const GABARITO_SOLO_KITS: Record<ClassId, SkillDef[]> = {
  ...GABARITO_KITS,
  guerreiro: [
    s("golpe-provocador", "Golpe Provocador", 8000, 0.04, always, [
      { type: "dano", parts: [phys(1.3)] },
    ]),
    s("redemoinho", "Redemoinho", 10_000, 0.06, always, [
      { type: "dano", parts: [phys(0.9)] },
    ]),
    muralha,
    ultima,
  ],
  paladino: [
    s("golpe-sagrado", "Golpe Sagrado", 8000, 0.04, always, [
      { type: "dano", parts: [phys(0.8), holy(0.8)] },
    ]),
    s("consagracao", "Consagração", 15_000, 0.08, always, [
      { type: "dano", parts: [holy(2)] },
    ]),
    escudoDaFe,
    imposicao,
  ],
  padre: [
    curar(0.6),
    s("luz-sagrada", "Luz Sagrada", 3000, 0.05, always, [
      { type: "dano", parts: [magic(1.4)] },
    ]),
    escudoSagrado,
    bencao,
  ],
  druida: [
    rejuvenescer(0.8),
    espinhos,
    s("raizes", "Raízes", 25_000, 0.08, always, [
      {
        type: "debuff",
        stat: "danoCausado",
        value: 0.12,
        durationMs: 8000,
        group: "bossweak2",
      },
    ]),
    pele,
  ],
};
