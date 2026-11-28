import type { SkillHook } from "../combat/types.ts";
import type { ClassId } from "../content.ts";
import {
  duracao,
  efeito,
  fis,
  gancho,
  mag,
  potencia,
  valor,
} from "../skills/dsl.ts";
import { SKILLS, SKILLS_BY_CLASS } from "../skills/index.ts";
import type { MechanicMod } from "../skills/schema.ts";
import type { RandomSource } from "./generate.ts";

/**
 * O perk dos lendários (27/11/2026, pedido do dono): cada uma das 42 skills tem o seu, no molde dos
 * lendários do spec (§9.5: "Grito de Guerra também causa 80% ATQ", "Escudo da Fé +10%", "Curar tem 15%
 * de chance de não gastar mana", "−20% de recarga", "dispara 2×"...) e feito só com o que o motor já
 * roda naquela skill: os adereços dela com outro valor, potência, duração, valor do efeito, recarga,
 * 2º disparo. Entra na compilação como um adereço de 1 up (skills/compile.ts), igual ao lendário de
 * antes.
 *
 * O tamanho rola numa faixa (`min`–`max`, em passos de `step`); o item guarda o valor que saiu (o
 * texto e o efeito saem dele). Os 7 lendários do spec ficam com o valor original, que está dentro da
 * faixa da skill deles.
 *
 * Fora do aperto das DGs: o perfil do limite não veste lendário, e o 2º perk o dono quer como força
 * a mais do herói, acima das medições (27/11/2026).
 */

/** Um perk no item: a skill e o tamanho que saiu. */
export interface ItemPerk {
  skill: string;
  value: number;
}

/** O perk da Coroa do Mentor (+XP de job): não é skill, e a rolagem nunca cai nele. */
export const JOB_XP_PERK = "xp-de-job";

type Unit = "pct" | "ms" | "fixo";

export interface PerkTemplate {
  min: number;
  max: number;
  step: number;
  unit: Unit;
  /** A frase do tooltip; `v` já formatado ("12%", "1,5 s"). */
  text: (v: string) => string;
  mods: (v: number) => MechanicMod[];
}

const pctOf = (v: number): string => {
  const p = Math.round(v * 1000) / 10;
  return `${Number.isInteger(p) ? p : p.toFixed(1).replace(".", ",")}%`;
};
const secOf = (ms: number): string => {
  const s = Math.round(ms / 100) / 10;
  return `${Number.isInteger(s) ? s : s.toFixed(1).replace(".", ",")} s`;
};

const pct = (
  min: number,
  max: number,
  step: number,
  text: PerkTemplate["text"],
  mods: PerkTemplate["mods"],
): PerkTemplate => ({ min, max, step, unit: "pct", text, mods });
const ms = (
  min: number,
  max: number,
  text: PerkTemplate["text"],
  mods: PerkTemplate["mods"],
): PerkTemplate => ({ min, max, step: 100, unit: "ms", text, mods });

/** Um gancho com o campo `field` no valor rolado. */
const hook = (add: SkillHook, field: string) => (v: number) => [
  gancho(add, field, v),
];

/**
 * Os perks, por skill. As faixas ficam em volta de ~3 ups do adereço parecido (o lendário do spec
 * vale ~isso); crítico e esquiva planos de lendário ficam em até 5% (§9.5).
 */
export const PERKS: Record<string, PerkTemplate> = {
  // ---------------------------------------------------------------- Guerreiro
  "golpe-provocador": pct(
    0.06,
    0.12,
    0.01,
    (v) => `Golpe Provocador cura o guerreiro em ${v} do dano causado.`,
    hook({ on: "danoCura", pct: 0, target: "proprio" }, "pct"),
  ),
  "grito-de-guerra": pct(
    0.6,
    1,
    0.05,
    (v) => `Grito de Guerra também causa ${v} ATQ.`,
    (v) => [
      efeito(
        { type: "dano", parts: [fis(0)], targets: "area" },
        ["parts.0.coef"],
        v,
      ),
    ],
  ),
  "muralha-de-ferro": pct(
    0.06,
    0.12,
    0.01,
    (v) => `Muralha de Ferro reflete ${v} do dano recebido.`,
    hook({ on: "reflete", pct: 0 }, "pct"),
  ),
  redemoinho: pct(
    0.006,
    0.012,
    0.001,
    (v) => `Redemoinho cura ${v} do HP máximo por inimigo atingido.`,
    hook({ on: "porInimigo", healPctMaxHp: 0 }, "healPctMaxHp"),
  ),
  "ultima-resistencia": pct(
    0.025,
    0.05,
    0.005,
    (v) => `Última Resistência cura +${v} do HP máximo.`,
    (v) => [valor(0, "pctMaxHp", v)],
  ),
  "estandarte-de-guerra": pct(
    0.02,
    0.04,
    0.005,
    (v) => `Estandarte de Guerra dá +${v} de ATQ e MATQ a mais.`,
    (v) => [valor(0, "value", v)],
  ),

  // ---------------------------------------------------------------- Paladino
  "golpe-sagrado": pct(
    0.08,
    0.16,
    0.01,
    (v) => `Golpe Sagrado tem ${v} de chance de atordoar lacaio por 1 s.`,
    hook(
      {
        on: "acerto",
        chance: 0,
        effects: [{ type: "atordoar", durationMs: 1000, targets: "alvo" }],
      },
      "chance",
    ),
  ),
  "escudo-da-fe": pct(
    0.06,
    0.14,
    0.01,
    (v) => `Escudo da Fé +${v}.`,
    (v) => [potencia([0], v)],
  ),
  consagracao: ms(
    1000,
    2000,
    (v) => `Consagração dura +${v}.`,
    (v) => [duracao([0], v)],
  ),
  "bencao-da-egide": pct(
    0.02,
    0.04,
    0.005,
    (v) => `Bênção da Égide reduz +${v} do dano físico e do mágico.`,
    (v) => [valor(0, "value", v), valor(1, "value", v)],
  ),
  "imposicao-de-maos": pct(
    0.05,
    0.1,
    0.01,
    (v) =>
      `Imposição de Mãos também dá ao aliado um escudo de ${v} do HP máximo (6 s).`,
    (v) => [
      efeito(
        { type: "escudo", target: "aliado", pctMaxHp: 0, durationMs: 6000 },
        ["pctMaxHp"],
        v,
      ),
    ],
  ),
  "intervencao-divina": pct(
    0.1,
    0.2,
    0.01,
    (v) => `Devoção desvia +${v} do dano.`,
    (v) => [potencia([0], v)],
  ),

  // ---------------------------------------------------------------- Padre
  curar: pct(
    0.1,
    0.2,
    0.01,
    (v) => `Curar tem ${v} de chance de não gastar mana.`,
    hook({ on: "semCusto", chance: 0 }, "chance"),
  ),
  "luz-sagrada": pct(
    0.15,
    0.3,
    0.01,
    (v) => `${v} do dano da Luz Sagrada cura o aliado com menos HP.`,
    hook({ on: "danoCura", pct: 0, target: "menorHp" }, "pct"),
  ),
  // O "devolve ao quebrar" só lê o 1º gancho da skill: com o adereço Espinhos de Luz o perk sumiria.
  "escudo-sagrado": pct(
    0.08,
    0.16,
    0.01,
    (v) => `Escudo Sagrado +${v}.`,
    (v) => [potencia([0], v)],
  ),
  bencao: pct(
    0.02,
    0.04,
    0.005,
    (v) => `Bênção dá +${v} de dano a mais.`,
    (v) => [valor(0, "value", v)],
  ),
  santuario: pct(
    0.1,
    0.2,
    0.01,
    (v) => `Santuário cura +${v}.`,
    (v) => [potencia([0], v)],
  ),
  ressurreicao: pct(
    0.1,
    0.2,
    0.01,
    (v) => `Ressurreição revive com +${v} de HP.`,
    (v) => [valor(0, "hpPct", v)],
  ),

  // ---------------------------------------------------------------- Druida
  rejuvenescer: {
    min: 1,
    max: 1,
    step: 1,
    unit: "fixo",
    text: () => "Rejuvenescer acumula 3×.",
    mods: (v) => [valor(0, "stacks", v)],
  },
  espinhos: pct(
    0.3,
    0.6,
    0.05,
    (v) => `Espinhos tem ${v} de chance de se espalhar para mais 1 inimigo.`,
    hook(
      {
        on: "acerto",
        chance: 0,
        spread: true,
        effects: [
          {
            type: "dot",
            element: "magico",
            coefPerSec: 0.25,
            durationMs: 8000,
          },
          {
            type: "debuff",
            stat: "danoCausado",
            value: 0.1,
            bossValue: 0.1,
            durationMs: 10000,
            targets: "alvo",
          },
        ],
      },
      "chance",
    ),
  ),
  "cancao-da-floresta": pct(
    0.01,
    0.02,
    0.005,
    (v) => `Canção de Guerra dá +${v} de ATQ e MATQ a mais.`,
    (v) => [valor(0, "value", v)],
  ),
  raizes: pct(
    0.1,
    0.2,
    0.01,
    (v) =>
      `Fúria das Raízes cura mais ${v} do dano causado no aliado com menos HP.`,
    hook({ on: "danoCura", pct: 0, target: "menorHp" }, "pct"),
  ),
  "pele-de-carvalho": pct(
    0.03,
    0.05,
    0.005,
    (v) => `Pele de Carvalho reduz +${v} do dano recebido.`,
    (v) => [valor(0, "value", v)],
  ),
  florescer: pct(
    0.1,
    0.2,
    0.01,
    (v) => `Florescer cura +${v}.`,
    (v) => [potencia([0], v)],
  ),

  // ---------------------------------------------------------------- Mago
  "seta-arcana": pct(
    0.2,
    0.4,
    0.05,
    (v) => `Seta Arcana tem ${v} de chance de disparar uma 2ª seta.`,
    hook(
      {
        on: "acerto",
        chance: 0,
        effects: [{ type: "dano", parts: [mag(1.6)] }],
      },
      "chance",
    ),
  ),
  "explosao-de-fogo": pct(
    0.03,
    0.05,
    0.005,
    (v) => `Explosão de Fogo deixa Queimadura de ${v} MATQ/s (4 s).`,
    (v) => [
      efeito(
        {
          type: "dot",
          element: "magico",
          coefPerSec: 0,
          durationMs: 4000,
          targets: "area",
        },
        ["coefPerSec"],
        v,
      ),
    ],
  ),
  nevasca: pct(
    0.08,
    0.16,
    0.01,
    (v) => `Nevasca tem ${v} por pulso de congelar lacaio por 1 s.`,
    (v) => [valor(0, "tickStun.chance", v)],
  ),
  // O "mana volta" só lê o 1º gancho da skill (o do Retorno Arcano ganharia): o perk é a Barreira.
  "escudo-de-mana": pct(
    0.08,
    0.16,
    0.01,
    (v) => `Escudo de Mana absorve +${v} do dano.`,
    (v) => [valor(0, "pct", v)],
  ),
  "raio-em-cadeia": pct(
    0.1,
    0.2,
    0.01,
    (v) => `Raio em Cadeia +${v}.`,
    (v) => [potencia([0], v)],
  ),
  meteoro: pct(
    0.15,
    0.25,
    0.01,
    (v) => `Meteoro −${v} de recarga.`,
    (v) => [{ kind: "corte", pct: v }],
  ),

  // ---------------------------------------------------------------- Caçador
  "rajada-dupla": pct(
    0.03,
    0.05,
    0.005,
    (v) => `Rajada Dupla +${v} de crítico.`,
    (v) => [valor(0, "critFlat", v)],
  ),
  "chuva-de-flechas": pct(
    0.15,
    0.25,
    0.01,
    (v) => `Chuva de Flechas −${v} de recarga.`,
    (v) => [{ kind: "corte", pct: v }],
  ),
  "marca-do-cacador": pct(
    0.02,
    0.04,
    0.005,
    (v) => `Marca do Caçador: o alvo recebe +${v} de dano a mais.`,
    (v) => [valor(0, "value", v), valor(0, "bossValue", v)],
  ),
  "armadilha-de-gelo": ms(
    500,
    1000,
    (v) => `Armadilha de Gelo atordoa +${v}.`,
    (v) => [duracao([1], v)],
  ),
  "foco-mortal": pct(
    0.1,
    0.2,
    0.01,
    (v) => `Foco Mortal dá +${v} de multiplicador crítico a mais.`,
    (v) => [valor(1, "value", v)],
  ),
  "tiro-perfurante": pct(
    0.1,
    0.2,
    0.01,
    (v) => `Tiro Perfurante ignora +${v} da defesa.`,
    (v) => [valor(0, "penetration", v)],
  ),

  // ---------------------------------------------------------------- Assassino
  "lamina-envenenada": pct(
    0.15,
    0.3,
    0.01,
    (v) => `O veneno da Lâmina Envenenada +${v}.`,
    (v) => [potencia([1], v)],
  ),
  "esquiva-sombria": pct(
    0.03,
    0.05,
    0.005,
    (v) => `Esquiva Sombria dá +${v} de esquiva a mais.`,
    (v) => [valor(1, "value", v)],
  ),
  "sequencia-letal": pct(
    0.08,
    0.16,
    0.01,
    (v) => `Sequência Letal +${v}.`,
    (v) => [potencia([0], v)],
  ),
  fumaca: ms(
    1500,
    3000,
    (v) => `Nuvem Tóxica dura +${v}.`,
    (v) => [duracao([0], v)],
  ),
  emboscada: pct(
    0.4,
    0.6,
    0.05,
    (v) => `Emboscada dispara 2×, com ${v} no 2º golpe.`,
    hook({ on: "repete", pct: 0 }, "pct"),
  ),
  "danca-das-laminas": pct(
    0.08,
    0.16,
    0.01,
    (v) => `Dança das Lâminas +${v}.`,
    (v) => [potencia([0], v)],
  ),

  // ---------------------------------------------------------------- fora das skills
  [JOB_XP_PERK]: {
    min: 0.05,
    max: 0.05,
    step: 0.01,
    unit: "pct",
    text: (v) => `+${v} de XP de job.`,
    mods: () => [],
  },
};

/** O valor no formato da faixa ("12%", "1,5 s"). */
export function perkValueText(t: PerkTemplate, v: number): string {
  return t.unit === "ms" ? secOf(v) : pctOf(v);
}

/** A frase do perk; `null` se a skill não existe mais (o item fica sem o efeito). */
export function perkText(p: ItemPerk): string | null {
  const t = PERKS[p.skill];
  return t ? t.text(perkValueText(t, p.value)) : null;
}

/** A classe dona da skill do perk (`null` para o da Coroa, que vale para todas). */
export function perkClass(p: ItemPerk): ClassId | null {
  return SKILLS.find((s) => s.id === p.skill)?.cls ?? null;
}

/** O efeito do perk na skill, como adereço de 1 up; o valor fica dentro da faixa. */
export function perkMods(p: ItemPerk): MechanicMod[] {
  const t = PERKS[p.skill];
  if (!t) return [];
  return t.mods(Math.min(t.max, Math.max(t.min, p.value)));
}

/** A faixa do perk de uma skill, formatada ("de 8% a 16%"; `null` se for fixo). */
export function perkRangeText(skill: string): string | null {
  const t = PERKS[skill];
  if (!t || t.min === t.max) return null;
  return `de ${perkValueText(t, t.min)} a ${perkValueText(t, t.max)}`;
}

/**
 * Rola um perk para a classe: uma das skills dela (menos as de `exclude`, as que o item já tem), com
 * o tamanho em passos de `step` entre `min` e `max`, todos com a mesma chance.
 */
export function rollPerk(
  cls: ClassId,
  exclude: readonly string[],
  rng: RandomSource,
): ItemPerk {
  const pool = SKILLS_BY_CLASS[cls]
    .map((s) => s.id)
    .filter((id) => !exclude.includes(id));
  const list = pool.length > 0 ? pool : SKILLS_BY_CLASS[cls].map((s) => s.id);
  const skill =
    list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))]!;
  const t = PERKS[skill]!;
  const steps = Math.round((t.max - t.min) / t.step);
  const k = Math.min(steps, Math.floor(rng.next() * (steps + 1)));
  return { skill, value: Number((t.min + k * t.step).toFixed(6)) };
}
