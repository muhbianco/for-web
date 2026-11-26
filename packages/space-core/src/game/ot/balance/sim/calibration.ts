import type { FighterInput } from "../combat/types.ts";
import { type ClassId, type RarityId, STATS } from "../content.ts";
import { heroFighter } from "../fighter.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type ReferenceOptions, createReference } from "../reference.ts";
import { learnableSkills, MAX_SLOTS } from "../skills/tree.ts";
import { limitMechanics, referenceSkills } from "./encounters.ts";

/**
 * Os grupos que calibram o aperto de cada DG (D41, scripts/gen-edge.ts) e que os testes cobram: no
 * perfil do limite, cada um vence a DG no modo esperado e 9 em 10 corridas no aleatório. A DG fica no
 * ponto do mais frágil deles, para mais de uma composição servir (o dono: "não estou pedindo que
 * isso seja engessado").
 */

/**
 * Masmorra e Região (5): tanque + cura + 3 de dano (com o padre e, desde a D42, com o druida de
 * batalha como cura única); tanque + 2 curas + 2; 2 tanques + cura + 2; e, desde a D50, o paladino
 * de tanque único (com padre e com druida): ele não segura como o guerreiro, mas mantém a party viva.
 */
export const LIMIT_GROUP_PARTIES: readonly (readonly ClassId[])[] = [
  ["guerreiro", "padre", "mago", "cacador", "assassino"],
  ["guerreiro", "druida", "mago", "cacador", "assassino"],
  ["guerreiro", "padre", "druida", "mago", "cacador"],
  ["guerreiro", "paladino", "padre", "mago", "cacador"],
  // D50: o paladino de tanque único (com padre e com druida) também tem de manter a party viva.
  ["paladino", "padre", "mago", "cacador", "assassino"],
  ["paladino", "druida", "mago", "cacador", "assassino"],
];

/** Caçada sozinho: cada classe de dano (o tanque e o suporte caçam com folga, D41). */
export const LIMIT_HUNT_SOLO: readonly (readonly ClassId[])[] = [
  ["mago"],
  ["cacador"],
  ["assassino"],
];

/** Caçada em grupo: cada tamanho com o seu golpe (DungeonEdge.party). */
export const LIMIT_HUNT_GROUPS: Readonly<
  Record<number, readonly (readonly ClassId[])[]>
> = {
  2: [
    ["mago", "cacador"],
    ["guerreiro", "assassino"],
  ],
  3: [
    ["guerreiro", "mago", "cacador"],
    ["padre", "mago", "assassino"],
  ],
};

/** Um degrau abaixo do limite num eixo (D41: o relatório mede quanto cada um perde). */
export interface LimitStep {
  id: "refino" | "raridade" | "nivel" | "atributos" | "kit";
  label: string;
}

export const LIMIT_STEPS: readonly LimitStep[] = [
  { id: "refino", label: "refino −3" },
  { id: "raridade", label: "raridade −1" },
  { id: "nivel", label: "nível −5" },
  { id: "atributos", label: "atributos iguais" },
  { id: "kit", label: "kit fora do meta" },
];

const RARITY_ORDER = ["comum", "incomum", "raro", "epico", "lendario"] as const;

/**
 * O herói no perfil do limite (item da faixa, afixos da classe, build e kit de referência), com as
 * poções do jogo; com `step`, um degrau abaixo num eixo. É o herói do gerador do aperto, dos testes e
 * do relatório.
 */
export function limitFighter(
  cls: ClassId,
  level: number,
  opts: { step?: LimitStep["id"]; solo?: boolean } = {},
  B: Balance = gameBalance,
): FighterInput {
  const RL = createReference(B, "limite");
  const R0 = createReference(B);
  const L = Math.max(1, opts.step === "nivel" ? level - 5 : level);
  const bands = B.cfg.limit.bands;
  const band = bands.find((b) => L <= b.upTo) ?? bands[bands.length - 1]!;
  const ref: ReferenceOptions =
    opts.step === "refino"
      ? { refine: Math.max(0, band.refine - 3) }
      : opts.step === "raridade"
        ? {
            rarity:
              RARITY_ORDER[
                Math.max(0, RARITY_ORDER.indexOf(band.rarity as RarityId) - 1)
              ]!,
          }
        : opts.step === "atributos"
          ? {
              attrs: B.allocateByWeights(
                B.attributePoints(L),
                STATS.map((s) => [s, 1] as const),
              ),
            }
          : {};
  const h = RL.referenceBalanceHero(cls, L, ref);
  const hs = referenceSkills(
    cls,
    B.tierFor(h.job),
    h.job,
    opts.solo ?? false,
    B,
    "gabarito",
  );
  limitMechanics(cls, hs);
  if (opts.step === "kit") {
    // O kit na ordem em que as skills se aprendem, com a IA padrão de cada uma.
    hs.slots = learnableSkills(cls, hs.tier)
      .map((s) => s.id)
      .slice(0, MAX_SLOTS);
    hs.ai = {};
  }
  return heroFighter(
    h,
    hs,
    { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 100 } },
    B,
    R0,
  );
}
