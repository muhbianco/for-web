import {
  SEMPRE,
  SENDO_ALVO,
  SO_EM_CHEFE,
  duracao,
  efeito,
  fis,
  fixo,
  gancho,
  inimigos,
  mag,
  mech,
  meuHp,
  potencia,
  recarga,
  s,
  valor,
} from "./dsl.ts";
import type { SkillContent } from "./schema.ts";

/** §8.5 Mago, §8.6 Caçador e §8.7 Assassino. */

export const MAGO: SkillContent[] = [
  {
    id: "seta-arcana",
    name: "Seta Arcana",
    cls: "mago",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(3),
    manaPct: 0.04,
    ai: [SEMPRE],
    effects: [{ type: "dano", parts: [mag(1.6)] }],
    mechanics: [
      mech(
        "seta-dupla",
        "Seta Dupla",
        2,
        "10% de chance de uma 2ª seta (máx. 50%).",
        [
          gancho(
            {
              on: "acerto",
              chance: 0,
              effects: [{ type: "dano", parts: [mag(1.6)] }],
            },
            "chance",
            0.1,
          ),
        ],
      ),
      mech(
        "fluxo",
        "Fluxo",
        3,
        "Cada acerto reduz em 0,1 s a recarga das outras magias (máx. 0,5 s).",
        [gancho({ on: "fluxo", seconds: 0 }, "seconds", 0.1)],
      ),
      mech(
        "sobrecarga",
        "Sobrecarga",
        4,
        "+5% contra alvos acima de 70% de HP (máx. +25%).",
        [gancho({ on: "bonus", when: "alvoAcima70", value: 0 }, "value", 0.05)],
      ),
    ],
  },
  {
    id: "explosao-de-fogo",
    name: "Explosão de Fogo",
    cls: "mago",
    tier: 1,
    target: "sala inteira",
    cooldownMs: s(10),
    manaPct: 0.08,
    ai: [inimigos(3)],
    effects: [{ type: "dano", parts: [mag(1.1)], targets: "area" }],
    mechanics: [
      mech(
        "queimadura",
        "Queimadura",
        2,
        "DoT de 4% MATQ/s por 4 s (máx. 20%/s).",
        [
          efeito(
            {
              type: "dot",
              element: "magico",
              coefPerSec: 0,
              durationMs: s(4),
              targets: "area",
              kind: "queimadura",
            },
            ["coefPerSec"],
            0.04,
          ),
        ],
      ),
      mech("combustao", "Combustão", 3, "+6% contra 3+ inimigos (máx. +30%).", [
        gancho({ on: "bonus", when: "3+inimigos", value: 0 }, "value", 0.06),
      ]),
      mech("inferno", "Inferno", 4, "−0,6 s (máx. −3 s).", [recarga(600)]),
    ],
  },
  {
    id: "nevasca",
    name: "Nevasca",
    cls: "mago",
    tier: 3,
    target: "sala inteira",
    cooldownMs: s(18),
    manaPct: 0.12,
    ai: [inimigos(3)],
    effects: [
      {
        type: "dot",
        element: "magico",
        coefPerSec: 0.5,
        durationMs: s(6),
        targets: "area",
        tickStun: { chance: 0, durationMs: s(1) },
      },
      {
        type: "debuff",
        stat: "velocidade",
        value: 0.2,
        bossValue: 0.2,
        durationMs: s(6),
        targets: "area",
        group: "nevasca",
      },
    ],
    mechanics: [
      mech(
        "congelar",
        "Congelar",
        3,
        "4% por pulso de congelar lacaio por 1 s (máx. 20%).",
        [valor(0, "tickStun.chance", 0.04)],
      ),
      mech("tempestade-de-gelo", "Tempestade de Gelo", 4, "+1 s (máx. +5 s).", [
        duracao([0, 1], 1000),
      ]),
    ],
  },
  {
    id: "escudo-de-mana",
    name: "Escudo de Mana",
    cls: "mago",
    tier: 2,
    target: "próprio",
    cooldownMs: s(30),
    manaPct: 0,
    ai: [meuHp(0.6)],
    effects: [{ type: "escudoDeMana", pct: 0.4, durationMs: s(12) }],
    mechanics: [
      mech("barreira", "Barreira", 3, "+4% (máx. +20%).", [
        valor(0, "pct", 0.04),
      ]),
      mech(
        "retorno-arcano",
        "Retorno Arcano",
        4,
        "10% da mana gasta pelo escudo volta no fim (máx. 50%).",
        [gancho({ on: "manaVolta", pct: 0 }, "pct", 0.1)],
      ),
    ],
  },
  {
    id: "raio-em-cadeia",
    name: "Raio em Cadeia",
    cls: "mago",
    tier: 3,
    target: "alvo + 3 saltos",
    cooldownMs: s(10),
    manaPct: 0.08,
    ai: [SEMPRE],
    effects: [
      {
        type: "dano",
        parts: [mag(2.4)],
        targets: { kind: "cadeia", hops: 3, falloff: 0.2 },
      },
    ],
    mechanics: [
      mech("condutor", "Condutor", 4, "+6% (máx. +30%).", [
        potencia([0], 0.06),
      ]),
    ],
  },
  {
    id: "meteoro",
    name: "Meteoro",
    cls: "mago",
    tier: 4,
    target: "sala inteira",
    cooldownMs: s(30),
    manaPct: 0.1,
    castMs: s(2),
    ai: [SO_EM_CHEFE, inimigos(3)],
    effects: [{ type: "dano", parts: [mag(3)], targets: "area" }],
    mechanics: [
      mech(
        "chuva-de-meteoros",
        "Chuva de Meteoros",
        4,
        "+4% (máx. +20%). No 5/5, cai um 2º meteoro de 50%.",
        [potencia([0], 0.04)],
        [fixo({ hooks: [{ on: "repete", pct: 0.5 }] })],
      ),
    ],
  },
];

export const CACADOR: SkillContent[] = [
  {
    id: "rajada-dupla",
    name: "Rajada Dupla",
    cls: "cacador",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(6),
    manaPct: 0.04,
    ai: [SEMPRE],
    effects: [{ type: "dano", parts: [fis(0.9)], hits: 2 }],
    mechanics: [
      mech(
        "flecha-certeira",
        "Flecha Certeira",
        2,
        "+3% de crítico nesta skill (máx. +15%).",
        [valor(0, "critFlat", 0.03)],
      ),
      mech(
        "flecha-perfurante",
        "Flecha Perfurante",
        3,
        "12% de chance de acertar +1 inimigo (máx. 60%).",
        [
          gancho(
            {
              on: "acerto",
              chance: 0,
              spread: true,
              effects: [{ type: "dano", parts: [fis(0.9)] }],
            },
            "chance",
            0.12,
          ),
        ],
      ),
      mech(
        "rajada-tripla",
        "Rajada Tripla",
        4,
        "3º disparo com 15% do dano (máx. 75%).",
        [
          efeito(
            { type: "dano", parts: [fis(0)] },
            ["parts.0.coef"],
            0.9 * 0.15,
          ),
        ],
      ),
    ],
  },
  {
    id: "chuva-de-flechas",
    name: "Chuva de Flechas",
    cls: "cacador",
    tier: 1,
    target: "sala inteira",
    cooldownMs: s(12),
    manaPct: 0.08,
    ai: [inimigos(3)],
    effects: [{ type: "dano", parts: [fis(0.7)], targets: "area" }],
    mechanics: [
      mech("saraivada", "Saraivada", 2, "+6% (máx. +30%).", [
        potencia([0], 0.06),
      ]),
      mech(
        "flechas-farpadas",
        "Flechas Farpadas",
        3,
        "Sangramento de 5% ATQ/s por 4 s (máx. 25%/s).",
        [
          efeito(
            {
              type: "dot",
              element: "fisico",
              coefPerSec: 0,
              durationMs: s(4),
              targets: "area",
              kind: "sangramento",
            },
            ["coefPerSec"],
            0.05,
          ),
        ],
      ),
      mech("ceu-fechado", "Céu Fechado", 4, "−0,6 s (máx. −3 s).", [
        recarga(600),
      ]),
    ],
  },
  {
    id: "marca-do-cacador",
    name: "Marca do Caçador",
    cls: "cacador",
    tier: 2,
    target: "alvo único",
    cooldownMs: s(20),
    manaPct: 0.06,
    ai: [SO_EM_CHEFE],
    effects: [
      {
        type: "debuff",
        stat: "danoRecebido",
        value: 0.12,
        bossValue: 0.12,
        durationMs: s(10),
        targets: "alvo",
        group: "marca",
      },
    ],
    mechanics: [
      mech("presa-exposta", "Presa Exposta", 3, "+1% (máx. +5%).", [
        valor(0, "value", 0.01),
        valor(0, "bossValue", 0.01),
      ]),
      mech("cacada-prolongada", "Caçada Prolongada", 4, "+1 s (máx. +5 s).", [
        duracao([0], 1000),
      ]),
    ],
  },
  {
    id: "armadilha-de-gelo",
    name: "Armadilha de Gelo",
    cls: "cacador",
    tier: 3,
    target: "primeiro inimigo",
    cooldownMs: s(20),
    manaPct: 0.08,
    ai: [SEMPRE],
    effects: [
      { type: "dano", parts: [fis(1.5)], targets: "primeiro" },
      { type: "atordoar", durationMs: s(2), targets: "alvo", max: 1 },
      {
        type: "debuff",
        stat: "velocidade",
        value: 0,
        bossValue: 0.2,
        durationMs: s(4),
        targets: "alvo",
        group: "armadilha",
      },
    ],
    mechanics: [
      mech(
        "estilhacos",
        "Estilhaços",
        3,
        "O atordoamento atinge +1 inimigo (máx. +5).",
        [valor(1, "max", 1)],
      ),
      mech("gelo-eterno", "Gelo Eterno", 4, "+0,4 s (máx. +2 s).", [
        duracao([1], 400),
      ]),
    ],
  },
  {
    id: "foco-mortal",
    name: "Foco Mortal",
    cls: "cacador",
    tier: 3,
    target: "próprio",
    cooldownMs: s(30),
    manaPct: 0.06,
    ai: [SO_EM_CHEFE],
    effects: [
      {
        type: "buff",
        target: "proprio",
        stat: "critico",
        value: 0.15,
        durationMs: s(6),
      },
      {
        type: "buff",
        target: "proprio",
        stat: "multCritico",
        value: 0.3,
        durationMs: s(6),
      },
    ],
    mechanics: [
      mech("concentracao", "Concentração", 4, "+0,75 s (máx. +3,75 s).", [
        duracao([0, 1], 750),
      ]),
    ],
  },
  {
    id: "tiro-perfurante",
    name: "Tiro Perfurante",
    cls: "cacador",
    tier: 4,
    target: "linha (até 3)",
    cooldownMs: s(30),
    manaPct: 0.1,
    ai: [SO_EM_CHEFE],
    effects: [
      {
        type: "dano",
        parts: [fis(3)],
        penetration: 0.5,
        targets: { kind: "linha", max: 3 },
      },
    ],
    mechanics: [
      mech(
        "disparo-fatal",
        "Disparo Fatal",
        4,
        "+5% (máx. +25%). No 5/5, sempre crítico em alvos < 30% de HP.",
        [potencia([0], 0.05)],
        [fixo({ hooks: [{ on: "criticoAbaixo", pct: 0.3 }] })],
      ),
    ],
  },
];

export const ASSASSINO: SkillContent[] = [
  {
    id: "lamina-envenenada",
    name: "Lâmina Envenenada",
    cls: "assassino",
    tier: 1,
    target: "alvo único",
    cooldownMs: s(6),
    manaPct: 0.04,
    ai: [SEMPRE],
    effects: [
      { type: "dano", parts: [fis(1.4)] },
      {
        type: "dot",
        element: "fisico",
        coefPerSec: 0.3,
        durationMs: s(6),
        poison: true,
      },
    ],
    mechanics: [
      mech("toxina", "Toxina", 2, "+6% no veneno (máx. +30%).", [
        potencia([1], 0.06),
      ]),
      mech(
        "veneno-paralisante",
        "Veneno Paralisante",
        3,
        "O alvo ataca 3% mais devagar (máx. −15%).",
        [
          efeito(
            {
              type: "debuff",
              stat: "velocidade",
              value: 0,
              bossValue: 0,
              durationMs: s(6),
              targets: "alvo",
              group: "veneno-paralisante",
            },
            ["value", "bossValue"],
            0.03,
          ),
        ],
      ),
      mech(
        "necrose",
        "Necrose",
        4,
        "+4% (máx. +20%). No 5/5, o veneno acumula 2×.",
        [potencia([1], 0.04)],
        [valor(1, "stacks", 2)],
      ),
    ],
  },
  {
    id: "esquiva-sombria",
    name: "Esquiva Sombria",
    cls: "assassino",
    tier: 1,
    target: "próprio",
    cooldownMs: s(20),
    manaPct: 0.06,
    ai: [meuHp(0.6), SENDO_ALVO],
    effects: [
      {
        type: "buff",
        target: "proprio",
        stat: "fuga",
        value: 0.5,
        durationMs: s(6),
      },
      {
        type: "buff",
        target: "proprio",
        stat: "esquiva",
        value: 0.1,
        durationMs: s(6),
      },
      { type: "cortaAmeaca", pct: 0.5 },
    ],
    mechanics: [
      mech("passo-sombrio", "Passo Sombrio", 2, "+0,6 s (máx. +3 s).", [
        duracao([0, 1], 600),
      ]),
      mech(
        "contra-ataque",
        "Contra-Ataque",
        3,
        "Ao esquivar, 8% de chance de contra-atacar com 100% ATQ (máx. 40%).",
        [
          gancho(
            {
              on: "esquiva",
              chance: 0,
              effects: [{ type: "dano", parts: [fis(1)] }],
            },
            "chance",
            0.08,
          ),
        ],
      ),
      mech(
        "desvanecer",
        "Desvanecer",
        4,
        "Corta mais 4% de ameaça (máx. 20%).",
        [valor(2, "pct", 0.04)],
      ),
    ],
  },
  {
    id: "sequencia-letal",
    name: "Sequência Letal",
    cls: "assassino",
    tier: 2,
    target: "alvo único",
    cooldownMs: s(10),
    manaPct: 0.07,
    ai: [SEMPRE],
    effects: [{ type: "dano", parts: [fis(1)], hits: 4 }],
    mechanics: [
      mech("furia-das-laminas", "Fúria das Lâminas", 3, "+5% (máx. +25%).", [
        potencia([0], 0.05),
      ]),
      mech(
        "golpe-final",
        "Golpe Final",
        4,
        "+6% de crítico no último golpe (máx. +30%).",
        [valor(0, "lastHitCritFlat", 0.06)],
      ),
    ],
  },
  {
    // Era a Fumaça (−20% de Precisão na sala): medida em 26/11/2026, tirava ~1% do dano recebido
    // (ataque mágico e mecânica ignoram a esquiva). O dono pediu veneno em área no lugar. O id e os
    // das mecânicas ficam: quem já tem a skill nos slots e pontos nela não perde nada.
    id: "fumaca",
    name: "Nuvem Tóxica",
    cls: "assassino",
    tier: 3,
    target: "sala inteira",
    cooldownMs: s(20),
    manaPct: 0.08,
    ai: [inimigos(2), SO_EM_CHEFE],
    effects: [
      {
        type: "dot",
        element: "fisico",
        coefPerSec: 0.2,
        durationMs: s(8),
        targets: "area",
        poison: true,
      },
    ],
    mechanics: [
      mech("fumaca-densa", "Nuvem Densa", 3, "+6% no veneno (máx. +30%).", [
        potencia([0], 0.06),
      ]),
      mech("cortina", "Névoa Persistente", 4, "+1 s (máx. +5 s).", [
        duracao([0], 1000),
      ]),
    ],
  },
  {
    id: "emboscada",
    name: "Emboscada",
    cls: "assassino",
    tier: 3,
    target: "alvo único",
    cooldownMs: s(20),
    manaPct: 0.08,
    ai: [SO_EM_CHEFE],
    effects: [{ type: "dano", parts: [fis(3)], ambush: true }],
    mechanics: [
      mech(
        "golpe-nas-costas",
        "Golpe nas Costas",
        4,
        "+8% de multiplicador crítico (máx. +40%).",
        [valor(0, "critMult", 0.08)],
      ),
    ],
  },
  {
    id: "danca-das-laminas",
    name: "Dança das Lâminas",
    cls: "assassino",
    tier: 4,
    target: "inimigos aleatórios",
    cooldownMs: s(30),
    manaPct: 0.09,
    ai: [SO_EM_CHEFE, inimigos(3)],
    effects: [
      {
        type: "dano",
        parts: [fis(0.48)],
        hits: 8,
        critFlat: 0.2,
        targets: "aleatorios",
      },
    ],
    mechanics: [
      mech("frenesi", "Frenesi", 4, "+5% (máx. +25%).", [potencia([0], 0.05)]),
    ],
  },
];
