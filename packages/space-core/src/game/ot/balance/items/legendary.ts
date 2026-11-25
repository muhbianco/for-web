import type { ClassId } from "../content.ts";
import type { Equipment, ItemInstance } from "../equipment.ts";
import { efeito, fis, gancho, potencia, valor } from "../skills/dsl.ts";
import type { MechanicMod } from "../skills/schema.ts";
import type { ItemBase } from "./generate.ts";

/**
 * Lendários (spec §9.5): raridade Lendário com 3 afixos e um efeito único. O spec dá 8 exemplos
 * ("2 por classe e um por família"); os que faltam são conteúdo a definir (P49). O efeito entra na
 * skill como um adereço de 1 up, na compilação (skills/compile.ts).
 */

export interface LegendaryDef {
  id: string;
  name: string;
  /** Classe que tira proveito (o item pode ser vestido por quem pode vestir a base). */
  cls: ClassId | null;
  base: ItemBase;
  text: string;
  /** A skill que o efeito muda e como. */
  skill?: string;
  mods?: MechanicMod[];
  /** Bônus fora do combate. */
  bonus?: { jobXpPct?: number };
}

export const LEGENDARIES: LegendaryDef[] = [
  {
    id: "machado-do-rugido",
    name: "Machado do Rugido",
    cls: "guerreiro",
    base: { slot: "arma", family: "machado" },
    text: "Grito de Guerra também causa 80% ATQ.",
    skill: "grito-de-guerra",
    mods: [
      efeito(
        { type: "dano", parts: [fis(0)], targets: "area" },
        ["parts.0.coef"],
        0.8,
      ),
    ],
  },
  {
    id: "egide-do-juramento",
    name: "Égide do Juramento",
    cls: "paladino",
    base: { slot: "secundaria", offhand: "escudo" },
    text: "Escudo da Fé +10%.",
    skill: "escudo-da-fe",
    mods: [potencia([0], 0.1)],
  },
  {
    id: "cajado-da-aurora",
    name: "Cajado da Aurora",
    cls: "padre",
    base: { slot: "arma", family: "cajado" },
    text: "Curar tem 15% de chance de não gastar mana.",
    skill: "curar",
    mods: [gancho({ on: "semCusto", chance: 0 }, "chance", 0.15)],
  },
  {
    id: "bastao-do-carvalho-velho",
    name: "Bastão do Carvalho Velho",
    cls: "druida",
    base: { slot: "arma", family: "bastao" },
    text: "Rejuvenescer acumula 3×.",
    skill: "rejuvenescer",
    mods: [valor(0, "stacks", 1)],
  },
  {
    id: "cetro-das-cinzas",
    name: "Cetro das Cinzas",
    cls: "mago",
    base: { slot: "arma", family: "cetro" },
    text: "Explosão de Fogo deixa Queimadura mesmo sem o adereço.",
    skill: "explosao-de-fogo",
    mods: [
      efeito(
        {
          type: "dot",
          element: "magico",
          coefPerSec: 0,
          durationMs: 4000,
          targets: "area",
        },
        ["coefPerSec"],
        0.04,
      ),
    ],
  },
  {
    id: "arco-do-vendaval",
    name: "Arco do Vendaval",
    cls: "cacador",
    base: { slot: "arma", family: "arco" },
    text: "Chuva de Flechas −20% de recarga.",
    skill: "chuva-de-flechas",
    mods: [{ kind: "corte", pct: 0.2 }],
  },
  {
    id: "katar-bicefalo",
    name: "Katar Bicéfalo",
    cls: "assassino",
    base: { slot: "arma", family: "katar" },
    text: "Emboscada dispara 2×, com 50% no 2º golpe.",
    skill: "emboscada",
    mods: [gancho({ on: "repete", pct: 0 }, "pct", 0.5)],
  },
  {
    id: "coroa-do-mentor",
    name: "Coroa do Mentor",
    cls: null,
    base: { slot: "elmo", weight: "leve" },
    text: "+5% de XP de job.",
    bonus: { jobXpPct: 0.05 },
  },
];

export function legendaryOf(item: ItemInstance): LegendaryDef | undefined {
  return item.legendary
    ? LEGENDARIES.find((l) => l.id === item.legendary)
    : undefined;
}

/** Os efeitos de lendário que o equipamento dá, por skill, para a compilação. */
export function legendaryMods(eq: Equipment): Record<string, MechanicMod[]> {
  const out: Record<string, MechanicMod[]> = {};
  for (const it of Object.values(eq) as (ItemInstance | undefined)[]) {
    const def = it && legendaryOf(it);
    if (!def?.skill || !def.mods) continue;
    (out[def.skill] ??= []).push(...def.mods);
  }
  return out;
}

/** Bônus de XP de job somado do equipamento. */
export function jobXpBonus(eq: Equipment): number {
  let n = 0;
  for (const it of Object.values(eq) as (ItemInstance | undefined)[])
    n += (it && legendaryOf(it)?.bonus?.jobXpPct) ?? 0;
  return n;
}
