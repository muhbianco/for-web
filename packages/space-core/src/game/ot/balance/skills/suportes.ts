import {
  ALIADO_AMALDICOADO,
  ALIADO_CAIDO,
  CHEFE_PREPARANDO,
  PRECISA_CURA,
  SEMPRE,
  SO_EM_CHEFE,
  aliadoMp,
  duracao,
  efeito,
  fixo,
  gancho,
  inimigos,
  mag,
  mech,
  potencia,
  recarga,
  s,
  valor,
} from "./dsl.ts";
import type { SkillContent } from "./schema.ts";

/** §8.3 Padre e §8.4 Druida. */

export const PADRE: SkillContent[] = [
  {
    id: "curar",
    name: "Curar",
    cls: "padre",
    tier: 1,
    target: "aliado",
    cooldownMs: s(2.5),
    manaPct: 0.08,
    ai: [PRECISA_CURA],
    effects: [{ type: "cura", target: "aliado", coefMatk: 0.3 }],
    mechanics: [
      mech(
        "cura-rapida",
        "Cura Rápida",
        2,
        "−0,1 s de recarga (máx. −0,5 s).",
        [recarga(100)],
      ),
      mech("prece", "Prece", 3, "+4% em alvos abaixo de 35% (máx. +20%).", [
        gancho({ on: "bonus", when: "alvoAbaixo35", value: 0 }, "value", 0.04),
      ]),
      mech(
        "luz-remanescente",
        "Luz Remanescente",
        4,
        "6% da cura excedente vira escudo (máx. 30%).",
        [gancho({ on: "sobracura", shieldPct: 0 }, "shieldPct", 0.06)],
      ),
    ],
  },
  {
    id: "luz-sagrada",
    name: "Luz Sagrada",
    cls: "padre",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(3),
    manaPct: 0.05,
    ai: [SEMPRE],
    effects: [
      {
        type: "dano",
        parts: [mag(1.4)],
        vsFamilies: { families: ["morto-vivo", "sombrio"], mult: 1.5 },
      },
    ],
    mechanics: [
      mech(
        "clarao",
        "Clarão",
        2,
        "4% de chance de cegar por 4 s, −30% de Precisão no alvo (máx. 20%).",
        [
          gancho(
            {
              on: "acerto",
              chance: 0,
              effects: [
                {
                  type: "debuff",
                  stat: "precisao",
                  value: 0.3,
                  durationMs: s(4),
                  targets: "alvo",
                  group: "clarao",
                },
              ],
            },
            "chance",
            0.04,
          ),
        ],
      ),
      mech(
        "penitencia",
        "Penitência",
        3,
        "10% do dano vira cura no aliado com menos HP (máx. 50%).",
        [gancho({ on: "danoCura", pct: 0, target: "menorHp" }, "pct", 0.1)],
      ),
      mech(
        "julgamento-celeste",
        "Julgamento Celeste",
        4,
        "+6% de dano (máx. +30%).",
        [potencia([0], 0.06)],
      ),
    ],
  },
  {
    id: "escudo-sagrado",
    name: "Escudo Sagrado",
    cls: "padre",
    tier: 2,
    target: "alvo do chefe",
    cooldownMs: s(12),
    manaPct: 0.1,
    ai: [SO_EM_CHEFE],
    effects: [
      {
        type: "escudo",
        target: "alvo-do-chefe",
        coefMatk: 0.4,
        durationMs: s(8),
      },
    ],
    mechanics: [
      mech("egide-de-luz", "Égide de Luz", 3, "+4% (máx. +20%).", [
        potencia([0], 0.04),
      ]),
      mech(
        "espinhos-de-luz",
        "Espinhos de Luz",
        4,
        "Quando quebra, devolve 10% do valor absorvido ao atacante como dano sagrado (máx. 50%).",
        [
          gancho(
            { on: "escudoQuebra", pct: 0, targets: "atacante" },
            "pct",
            0.1,
          ),
        ],
      ),
    ],
  },
  {
    id: "bencao",
    name: "Bênção",
    cls: "padre",
    tier: 2,
    target: "grupo",
    cooldownMs: s(25),
    manaPct: 0.06,
    ai: [SEMPRE],
    effects: [
      {
        type: "buff",
        target: "grupo",
        stat: "dano",
        value: 0.08,
        durationMs: s(30),
      },
      {
        type: "buff",
        target: "grupo",
        stat: "precisao",
        value: 0.1,
        durationMs: s(30),
      },
    ],
    mechanics: [
      mech("bencao-maior", "Bênção Maior", 3, "+1% de dano (máx. +5%).", [
        valor(0, "value", 0.01),
      ]),
      mech(
        "graca-divina",
        "Graça Divina",
        4,
        "+2% de cura recebida pelo grupo (máx. +10%).",
        [
          efeito(
            {
              type: "buff",
              target: "grupo",
              stat: "curaRecebida",
              value: 0,
              durationMs: s(30),
            },
            ["value"],
            0.02,
          ),
        ],
      ),
    ],
  },
  {
    id: "santuario",
    name: "Santuário",
    cls: "padre",
    tier: 3,
    target: "grupo",
    cooldownMs: s(30),
    manaPct: 0.15,
    ai: [PRECISA_CURA, ALIADO_AMALDICOADO],
    effects: [
      { type: "hot", target: "grupo", coefMatkPerSec: 0.022, durationMs: s(8) },
      {
        type: "purificar",
        target: "grupo",
        count: 1,
        everyMs: s(2),
        durationMs: s(8),
      },
    ],
    mechanics: [
      mech(
        "solo-consagrado",
        "Solo Consagrado",
        4,
        "+5% de cura (máx. +25%). No 5/5, +1 s.",
        [potencia([0], 0.05)],
        [duracao([0, 1], 1000)],
      ),
    ],
  },
  {
    id: "ressurreicao",
    name: "Ressurreição",
    cls: "padre",
    tier: 4,
    target: "aliado caído",
    cooldownMs: s(120),
    manaPct: 0.25,
    ai: [ALIADO_CAIDO],
    effects: [{ type: "reviver", hpPct: 0.3 }],
    mechanics: [
      mech(
        "renascer",
        "Renascer",
        4,
        "+6% de HP ao reviver e −6 s de recarga (máx. +30% / −30 s).",
        [valor(0, "hpPct", 0.06), recarga(6000)],
      ),
    ],
  },
];

export const DRUIDA: SkillContent[] = [
  {
    id: "rejuvenescer",
    name: "Rejuvenescer",
    cls: "druida",
    tier: 1,
    target: "aliado",
    cooldownMs: s(2.5),
    manaPct: 0.07,
    ai: [PRECISA_CURA],
    effects: [
      {
        type: "hot",
        target: "aliado",
        coefMatkPerSec: 0.045,
        durationMs: s(10),
        stacks: 2,
      },
    ],
    mechanics: [
      mech("seiva-viva", "Seiva Viva", 2, "+0,5 s (máx. +2,5 s).", [
        duracao([0], 500),
      ]),
      mech(
        "seiva-purificadora",
        "Seiva Purificadora",
        3,
        "20% de chance de remover 1 efeito negativo ao aplicar (máx. 100%).",
        [
          efeito(
            { type: "purificar", target: "aliado", count: 1, chance: 0 },
            ["chance"],
            0.2,
          ),
        ],
      ),
      mech("florada", "Florada", 4, "+4% de cura (máx. +20%).", [
        potencia([0], 0.04),
      ]),
    ],
  },
  {
    id: "espinhos",
    name: "Espinhos",
    cls: "druida",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(8),
    manaPct: 0.05,
    ai: [SEMPRE],
    effects: [
      { type: "dano", parts: [mag(1)] },
      { type: "dot", element: "magico", coefPerSec: 0.25, durationMs: s(8) },
      {
        type: "debuff",
        stat: "danoCausado",
        value: 0.1,
        bossValue: 0.1,
        durationMs: s(10),
        targets: "alvo",
      },
    ],
    mechanics: [
      mech(
        "espinhos-venenosos",
        "Espinhos Venenosos",
        2,
        "+10% de dano (máx. +50%).",
        [potencia([0, 1], 0.1)],
      ),
      mech(
        "enfraquecer",
        "Enfraquecer",
        3,
        "−1% a mais de dano do alvo (máx. −5%, ou seja, −15% no total).",
        [valor(2, "value", 0.01), valor(2, "bossValue", 0.01)],
      ),
      mech(
        "espinheiro",
        "Espinheiro",
        4,
        "20% de chance de espalhar para mais 1 inimigo (máx. 100%).",
        [
          gancho(
            {
              on: "acerto",
              chance: 0,
              spread: true,
              effects: [
                {
                  type: "dot",
                  element: "magico",
                  coefPerSec: 0.25,
                  durationMs: s(8),
                },
                {
                  type: "debuff",
                  stat: "danoCausado",
                  value: 0.1,
                  bossValue: 0.1,
                  durationMs: s(10),
                  targets: "alvo",
                },
              ],
            },
            "chance",
            0.2,
          ),
        ],
      ),
    ],
  },
  {
    id: "cancao-da-floresta",
    name: "Canção da Floresta",
    cls: "druida",
    tier: 2,
    target: "grupo",
    cooldownMs: s(40),
    manaPct: 0.06,
    ai: [aliadoMp(0.4)],
    effects: [
      {
        type: "buff",
        target: "grupo",
        stat: "regenManaPct",
        value: 0.02,
        durationMs: s(10),
      },
    ],
    mechanics: [
      mech("coro", "Coro", 3, "+0,2%/s (máx. +1%/s).", [
        valor(0, "value", 0.002),
      ]),
      mech(
        "harmonia",
        "Harmonia",
        4,
        "Também regenera 0,4% do HP máx./s (máx. 2%/s).",
        [
          efeito(
            {
              type: "buff",
              target: "grupo",
              stat: "regenVidaPct",
              value: 0,
              durationMs: s(10),
            },
            ["value"],
            0.004,
          ),
        ],
      ),
    ],
  },
  {
    id: "raizes",
    name: "Raízes",
    cls: "druida",
    tier: 2,
    target: "sala inteira",
    cooldownMs: s(25),
    manaPct: 0.08,
    ai: [inimigos(3), SO_EM_CHEFE],
    effects: [
      {
        type: "debuff",
        stat: "velocidade",
        value: 0.25,
        bossValue: 0.12,
        durationMs: s(8),
        targets: "area",
      },
    ],
    mechanics: [
      mech(
        "enredar",
        "Enredar",
        3,
        "5% de chance de imobilizar lacaio por 2 s (máx. 25%).",
        [
          efeito(
            { type: "atordoar", durationMs: s(2), targets: "area", chance: 0 },
            ["chance"],
            0.05,
          ),
        ],
      ),
      mech("terra-viva", "Terra Viva", 4, "+1 s (máx. +5 s).", [
        duracao([0], 1000),
      ]),
    ],
  },
  {
    id: "pele-de-carvalho",
    name: "Pele de Carvalho",
    cls: "druida",
    tier: 3,
    target: "grupo",
    cooldownMs: s(45),
    manaPct: 0.1,
    ai: [SO_EM_CHEFE, CHEFE_PREPARANDO],
    effects: [
      {
        type: "buff",
        target: "grupo",
        stat: "reducao",
        value: 0.12,
        durationMs: s(12),
      },
    ],
    mechanics: [
      mech(
        "casca-antiga",
        "Casca Antiga",
        4,
        "+0,3% de regeneração de HP máx./s (máx. 1,5%/s).",
        [
          efeito(
            {
              type: "buff",
              target: "grupo",
              stat: "regenVidaPct",
              value: 0,
              durationMs: s(12),
            },
            ["value"],
            0.003,
          ),
        ],
      ),
    ],
  },
  {
    id: "florescer",
    name: "Florescer",
    cls: "druida",
    tier: 4,
    target: "grupo",
    cooldownMs: s(60),
    manaPct: 0.2,
    ai: [PRECISA_CURA],
    effects: [{ type: "cura", target: "grupo", coefMatk: 0.45 }],
    mechanics: [
      mech(
        "primavera",
        "Primavera",
        4,
        "+4% (máx. +20%). No 5/5, aplica Rejuvenescer em todos.",
        [potencia([0], 0.04)],
        [
          fixo({
            effects: [
              {
                type: "hot",
                target: "grupo",
                coefMatkPerSec: 0.045,
                durationMs: s(10),
              },
            ],
          }),
        ],
      ),
    ],
  },
];
