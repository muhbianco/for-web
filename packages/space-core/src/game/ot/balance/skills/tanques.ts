import {
  CHEFE_PREPARANDO,
  PERDI_AGGRO,
  SEMPRE,
  SENDO_ALVO,
  SO_EM_CHEFE,
  aliado,
  aliados,
  duracao,
  efeito,
  fis,
  fixo,
  gancho,
  inimigos,
  mech,
  meuHp,
  s,
  sag,
  valor,
} from "./dsl.ts";
import type { SkillContent } from "./schema.ts";

/** §8.1 Guerreiro e §8.2 Paladino. */

export const GUERREIRO: SkillContent[] = [
  {
    id: "golpe-provocador",
    name: "Golpe Provocador",
    cls: "guerreiro",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(8),
    manaPct: 0.04,
    threatMult: 2,
    ai: [SEMPRE],
    effects: [
      { type: "dano", parts: [fis(1.3)] },
      { type: "provocar", durationMs: s(4), scope: "alvo" },
    ],
    mechanics: [
      mech("desafio", "Desafio", 2, "+0,4 s de provocação (máx. +2 s).", [
        duracao([1], 400),
      ]),
      mech(
        "quebra-guarda",
        "Quebra-Guarda",
        3,
        "Alvo −3% DEF por 6 s (máx. −15%).",
        [
          efeito(
            {
              type: "debuff",
              stat: "defesa",
              value: 0,
              durationMs: s(6),
              targets: "alvo",
              group: "quebra-guarda",
            },
            ["value", "bossValue"],
            0.03,
          ),
        ],
      ),
      mech(
        "revide",
        "Revide",
        4,
        "Ao bloquear, 4% de chance de zerar a recarga (máx. 20%).",
        [
          gancho(
            { on: "bloqueio", chance: 0, resetCooldown: true },
            "chance",
            0.04,
          ),
        ],
      ),
    ],
  },
  {
    id: "grito-de-guerra",
    name: "Grito de Guerra",
    cls: "guerreiro",
    tier: 1,
    target: "sala inteira",
    cooldownMs: s(15),
    manaPct: 0.06,
    ai: [inimigos(2), PERDI_AGGRO],
    effects: [
      { type: "provocar", durationMs: s(3), scope: "sala" },
      {
        type: "buff",
        target: "proprio",
        stat: "reducao",
        value: 0.1,
        durationMs: s(6),
      },
    ],
    mechanics: [
      mech("eco", "Eco", 2, "+0,3 s de provocação (máx. +1,5 s).", [
        duracao([0], 300),
      ]),
      mech(
        "intimidar",
        "Intimidar",
        3,
        "Provocados causam −2% de dano por 6 s (máx. −10%).",
        [
          efeito(
            {
              type: "debuff",
              stat: "danoCausado",
              value: 0,
              durationMs: s(6),
              targets: "area",
              group: "intimidar",
            },
            ["value", "bossValue"],
            0.02,
          ),
        ],
      ),
      mech(
        "brado-fortificante",
        "Brado Fortificante",
        4,
        "Aliados −1% de dano recebido por 6 s (máx. −5%).",
        [
          efeito(
            {
              type: "buff",
              target: "grupo",
              stat: "reducao",
              value: 0,
              durationMs: s(6),
              group: "brado",
            },
            ["value"],
            0.01,
          ),
        ],
      ),
    ],
  },
  {
    id: "muralha-de-ferro",
    name: "Muralha de Ferro",
    cls: "guerreiro",
    tier: 2,
    target: "próprio",
    cooldownMs: s(30),
    manaPct: 0.08,
    ai: [SENDO_ALVO, CHEFE_PREPARANDO],
    effects: [
      {
        type: "buff",
        target: "proprio",
        stat: "reducao",
        value: 0.3,
        durationMs: s(8),
      },
    ],
    mechanics: [
      mech(
        "espinhos-de-aco",
        "Espinhos de Aço",
        3,
        "Reflete 3% do dano recebido (máx. 15%).",
        [gancho({ on: "reflete", pct: 0 }, "pct", 0.03)],
      ),
      mech("inabalavel", "Inabalável", 4, "+0,6 s (máx. +3 s).", [
        duracao([0], 600),
      ]),
    ],
  },
  {
    id: "redemoinho",
    name: "Redemoinho",
    cls: "guerreiro",
    tier: 2,
    target: "sala inteira",
    cooldownMs: s(10),
    manaPct: 0.06,
    threatMult: 2,
    ai: [inimigos(3)],
    effects: [{ type: "dano", parts: [fis(0.9)], targets: "area" }],
    mechanics: [
      mech(
        "laminas-giratorias",
        "Lâminas Giratórias",
        3,
        "+8% de dano contra 3+ inimigos (máx. +40%).",
        [gancho({ on: "bonus", when: "3+inimigos", value: 0 }, "value", 0.08)],
      ),
      mech(
        "folego",
        "Fôlego",
        4,
        "Cada inimigo atingido cura 0,4% do HP máx. (máx. 2%).",
        [gancho({ on: "porInimigo", healPctMaxHp: 0 }, "healPctMaxHp", 0.004)],
      ),
    ],
  },
  {
    id: "ultima-resistencia",
    name: "Última Resistência",
    cls: "guerreiro",
    tier: 3,
    target: "próprio",
    cooldownMs: s(90),
    manaPct: 0.1,
    ai: [meuHp(0.35)],
    effects: [
      { type: "cura", target: "proprio", pctMaxHp: 0.25, noBonus: true },
      {
        type: "buff",
        target: "proprio",
        stat: "hpMaxPct",
        value: 0.2,
        durationMs: s(10),
      },
    ],
    mechanics: [
      mech(
        "recusa-da-morte",
        "Recusa da Morte",
        4,
        "+4% de cura (máx. +20%). No 5/5, uma vez por luta, um golpe fatal com a skill pronta deixa o guerreiro com 1 HP e dispara a skill.",
        [valor(0, "pctMaxHp", 0.04)],
        [fixo({ hooks: [{ on: "recusaMorte" }] })],
      ),
    ],
  },
  {
    id: "estandarte-de-guerra",
    name: "Estandarte de Guerra",
    cls: "guerreiro",
    tier: 4,
    target: "grupo",
    cooldownMs: s(60),
    manaPct: 0.15,
    ai: [SO_EM_CHEFE],
    effects: [
      {
        type: "buff",
        target: "grupo",
        stat: "poder",
        value: 0.1,
        durationMs: s(12),
      },
      {
        type: "buff",
        target: "grupo",
        stat: "reducao",
        value: 0.1,
        durationMs: s(12),
      },
    ],
    mechanics: [
      mech("hasteado", "Hasteado", 4, "+1 s (máx. +5 s).", [
        duracao([0, 1], 1000),
      ]),
    ],
  },
];

export const PALADINO: SkillContent[] = [
  {
    id: "golpe-sagrado",
    name: "Golpe Sagrado",
    cls: "paladino",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(8),
    manaPct: 0.04,
    threatMult: 3,
    ai: [SEMPRE],
    effects: [
      { type: "dano", parts: [fis(0.8), sag(0.8)] },
      { type: "provocar", durationMs: s(4), scope: "alvo" },
    ],
    mechanics: [
      mech(
        "julgamento",
        "Julgamento",
        2,
        "4% de chance de atordoar lacaio por 1 s (máx. 20%).",
        [
          gancho(
            {
              on: "acerto",
              chance: 0,
              effects: [
                { type: "atordoar", durationMs: s(1), targets: "alvo" },
              ],
            },
            "chance",
            0.04,
          ),
        ],
      ),
      mech(
        "luz-purificadora",
        "Luz Purificadora",
        3,
        "Cura o paladino em 2% do dano causado (máx. 10%).",
        [gancho({ on: "danoCura", pct: 0, target: "proprio" }, "pct", 0.02)],
      ),
      mech(
        "martelo-da-justica",
        "Martelo da Justiça",
        4,
        "Depois de bloquear, o próximo Golpe Sagrado causa +8% (máx. +40%).",
        [
          gancho(
            { on: "bonus", when: "aposBloqueio", value: 0 },
            "value",
            0.08,
          ),
        ],
      ),
    ],
  },
  {
    id: "escudo-da-fe",
    name: "Escudo da Fé",
    cls: "paladino",
    tier: 1,
    target: "próprio",
    cooldownMs: s(20),
    manaPct: 0.08,
    ai: [SENDO_ALVO],
    effects: [
      { type: "escudo", target: "proprio", pctMaxHp: 0.2, durationMs: s(10) },
    ],
    mechanics: [
      mech("fe-inabalavel", "Fé Inabalável", 2, "+2% do HP máx. (máx. +10%).", [
        valor(0, "pctMaxHp", 0.02),
      ]),
      mech(
        "reflexo-sagrado",
        "Reflexo Sagrado",
        3,
        "Quando quebra, causa 30% do valor absorvido como dano sagrado em área (máx. 150%).",
        [gancho({ on: "escudoQuebra", pct: 0, targets: "area" }, "pct", 0.3)],
      ),
      mech(
        "egide-compartilhada",
        "Égide Compartilhada",
        4,
        "5% do escudo vai também ao aliado com menos HP (máx. 25%).",
        [gancho({ on: "escudoDivide", pct: 0 }, "pct", 0.05)],
      ),
    ],
  },
  {
    id: "consagracao",
    name: "Consagração",
    cls: "paladino",
    tier: 2,
    target: "sala inteira",
    cooldownMs: s(15),
    manaPct: 0.08,
    threatMult: 2,
    ai: [inimigos(3)],
    // 200% ATQ sagrado em todos, distribuído ao longo de 6 s.
    effects: [
      {
        type: "dot",
        element: "sagrado",
        coefPerSec: 2 / 6,
        durationMs: s(6),
        targets: "area",
      },
    ],
    mechanics: [
      mech(
        "terra-santa",
        "Terra Santa",
        3,
        "Aliados curam 0,3% do HP máx./s enquanto dura (máx. 1,5%/s).",
        [
          efeito(
            {
              type: "hot",
              target: "grupo",
              pctMaxHpPerSec: 0,
              durationMs: s(6),
            },
            ["pctMaxHpPerSec"],
            0.003,
          ),
        ],
      ),
      mech(
        "expurgo",
        "Expurgo",
        4,
        "+10% contra mortos-vivos e sombrios (máx. +50%).",
        [
          gancho(
            {
              on: "bonus",
              when: "familia",
              families: ["morto-vivo", "sombrio"],
              value: 0,
            },
            "value",
            0.1,
          ),
        ],
      ),
    ],
  },
  {
    id: "bencao-da-egide",
    name: "Bênção da Égide",
    cls: "paladino",
    tier: 2,
    target: "grupo",
    cooldownMs: s(40),
    manaPct: 0.1,
    ai: [SO_EM_CHEFE, CHEFE_PREPARANDO],
    effects: [
      {
        type: "buff",
        target: "grupo",
        stat: "reducaoFisica",
        value: 0.1,
        durationMs: s(10),
      },
      {
        type: "buff",
        target: "grupo",
        stat: "reducaoMagica",
        value: 0.2,
        durationMs: s(10),
      },
    ],
    mechanics: [
      mech("protecao-estendida", "Proteção Estendida", 3, "+1 s (máx. +5 s).", [
        duracao([0, 1], 1000),
      ]),
      mech(
        "imunidade-sagrada",
        "Imunidade Sagrada",
        4,
        "−2% no dano de golpes certeiros (máx. −10%).",
        [
          efeito(
            {
              type: "buff",
              target: "grupo",
              stat: "reducaoCerteiro",
              value: 0,
              durationMs: s(10),
            },
            ["value"],
            0.02,
          ),
        ],
      ),
    ],
  },
  {
    id: "imposicao-de-maos",
    name: "Imposição de Mãos",
    cls: "paladino",
    tier: 3,
    target: "aliado",
    cooldownMs: s(45),
    manaPct: 0.12,
    ai: [aliado(0.4)],
    effects: [{ type: "cura", target: "aliado", pctMaxHp: 0.3, noBonus: true }],
    mechanics: [
      mech(
        "maos-abencoadas",
        "Mãos Abençoadas",
        4,
        "+3% (máx. +15%). No 5/5, também remove 1 efeito negativo.",
        [valor(0, "pctMaxHp", 0.03)],
        [
          fixo({
            effects: [{ type: "purificar", target: "aliado", count: 1 }],
          }),
        ],
      ),
    ],
  },
  {
    id: "intervencao-divina",
    name: "Intervenção Divina",
    cls: "paladino",
    tier: 4,
    target: "grupo",
    cooldownMs: s(90),
    manaPct: 0.18,
    ai: [CHEFE_PREPARANDO, aliados(2, 0.5)],
    effects: [
      { type: "escudo", target: "grupo", pctMaxHp: 0.2, durationMs: s(6) },
    ],
    mechanics: [
      mech("graca", "Graça", 4, "+1 s (máx. +5 s).", [duracao([0], 1000)]),
    ],
  },
];
