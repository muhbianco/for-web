import {
  type AffixId,
  type ClassId,
  type RarityId,
  AFFIXES,
  FAMILIES,
  RARITIES,
} from "../content.ts";
import type { ItemInstance } from "../equipment.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Material, affixRange, itemName, materialOf } from "./generate.ts";
import { itemPerks, legendaryOf } from "./legendary.ts";
import { perkClass, perkText } from "./perks.ts";

/**
 * O item como a tela o mostra (spec §9.7): tooltip e o que a arte precisa para desenhar o ícone
 * (silhueta, material, moldura da raridade, brilho do refino). Nenhuma conta fica no componente.
 * O ícone em pixel art 32×32 é desenhado no cliente a partir deste descritor (na virada).
 */

export interface ItemVisual {
  /** Silhueta por família, peça ou mão secundária. */
  silhouette: string;
  material: Material;
  /** Cor da moldura e do nome. */
  rarityColor: string;
  /** +7 brilho; +9 partículas; +10 aura. */
  refineGlow: "nenhum" | "brilho" | "particulas" | "aura";
}

export interface ItemTooltip {
  name: string;
  rarity: string;
  rarityColor: string;
  ilvl: number;
  requiredLevel: number;
  kind: string;
  /** Linha base: ATQ/MATQ da arma, DEF/MDEF da peça, DEF do escudo, bônus de focus e aljava. */
  base: { label: string; value: number }[];
  refine: number;
  affixes: {
    id: AffixId;
    label: string;
    value: number;
    text: string;
    /** D64: a faixa do sorteio deste afixo no iL e na raridade do item, como texto ("1,6–2,4"). */
    range: string;
    delta?: number;
  }[];
  /** Os perks do lendário (em laranja): a frase e a classe dona da skill (`null`: vale para todas). */
  perks?: { text: string; cls: ClassId | null }[];
  visual: ItemVisual;
}

const AFFIX_LABEL: Record<AffixId, string> = {
  FOR: "FOR",
  AGI: "AGI",
  VIT: "VIT",
  INT: "INT",
  DES: "DES",
  SOR: "SOR",
  hpPct: "HP máx.",
  mpPct: "MP máx.",
  atkPct: "ATQ",
  matkPct: "MATQ",
  healPct: "Cura causada",
  defPct: "DEF",
  mdefPct: "MDEF",
  hit: "Precisão",
  flee: "Fuga",
  critRating: "Crítico",
  critMultPct: "Multiplicador crítico",
  hastePct: "Velocidade de ataque",
  cooldownPct: "Recarga",
  effectResPct: "Resistência a efeitos",
};

function affixNumber(id: AffixId, value: number): string {
  return AFFIXES[id].scale === "pct"
    ? `${(value * 100).toFixed(1).replace(".", ",")}%`
    : value.toFixed(1).replace(".", ",");
}

/** O nome do afixo como a dica do item mostra ("VIT", "Cura causada"…). */
export function affixLabel(id: AffixId): string {
  return AFFIX_LABEL[id];
}

/** D64: a faixa do sorteio do afixo no iL e na raridade, como texto ("1,6–2,4", "2,2%–4,4%"). */
export function affixRangeText(
  id: AffixId,
  ilvl: number,
  rarity: RarityId,
  B: Balance = gameBalance,
): string {
  const r = affixRange(id, ilvl, rarity, B);
  return `${affixNumber(id, r.min)}–${affixNumber(id, r.max)}`;
}

function affixText(id: AffixId, value: number): string {
  const n = affixNumber(id, value);
  return id === "cooldownPct"
    ? `−${n} ${AFFIX_LABEL[id]}`
    : `+${n} ${AFFIX_LABEL[id]}`;
}

export function itemVisual(item: ItemInstance): ItemVisual {
  const silhouette =
    item.slot === "arma"
      ? item.family
      : item.slot === "secundaria"
        ? item.offhand
        : "weight" in item
          ? `${item.slot}-${item.weight}`
          : item.slot;
  const r = item.refine;
  return {
    silhouette,
    material: materialOf(item.ilvl),
    rarityColor: RARITIES[item.rarity].color,
    refineGlow:
      r >= 10 ? "aura" : r >= 9 ? "particulas" : r >= 7 ? "brilho" : "nenhum",
  };
}

/** O tooltip; com `equipped`, cada afixo traz a diferença para o item vestido no mesmo slot. */
export function itemTooltip(
  item: ItemInstance,
  equipped?: ItemInstance,
  B: Balance = gameBalance,
): ItemTooltip {
  const leg = legendaryOf(item);
  const perks = itemPerks(item).flatMap((p) => {
    const text = perkText(p);
    return text ? [{ text, cls: perkClass(p) }] : [];
  });
  const rm = B.rarityMult(item.rarity);
  const base: ItemTooltip["base"] = [];
  let kind: string;
  if (item.slot === "arma") {
    const f = FAMILIES[item.family];
    const wb =
      B.weaponBaseValue(item.ilvl) * rm * B.refineMult(item.refine, true);
    kind = `${f.name} (${f.hands === 2 ? "2 mãos" : "1 mão"}, ${f.aps.toFixed(2).replace(".", ",")} ataques/s, escala ${f.scale})`;
    if (f.atk > 0) base.push({ label: "ATQ", value: Math.round(wb * f.atk) });
    if (f.matk > 0)
      base.push({ label: "MATQ", value: Math.round(wb * f.matk) });
  } else if (item.slot === "secundaria") {
    switch (item.offhand) {
      case "escudo":
        kind = "Escudo";
        base.push({
          label: "DEF",
          value: Math.round(
            B.shieldDefValue(item.ilvl) * rm * B.refineMult(item.refine, false),
          ),
        });
        break;
      case "focus":
        kind = "Focus";
        base.push({
          label: "MATQ da arma",
          value: Math.round(B.cfg.items.focusMatkOfBase * 100),
        });
        break;
      case "aljava":
        kind = "Aljava";
        base.push({
          label: "ATQ à distância da arma",
          value: Math.round(B.cfg.items.quiverAtk * 100),
        });
        break;
      case "punhal":
        kind = "Punhal (segunda lâmina)";
        base.push({
          label: "ATQ corpo a corpo da arma",
          value: Math.round(B.cfg.items.offDaggerAtk * 100),
        });
        break;
    }
  } else if (!("weight" in item)) {
    kind = item.slot === "colar" ? "Colar" : "Anel";
  } else {
    kind = `${item.slot} (${item.weight})`;
    const m = rm * B.refineMult(item.refine, false);
    base.push({
      label: "DEF",
      value: Math.round(B.armorDefPiece(item.ilvl, item.slot, item.weight) * m),
    });
    base.push({
      label: "MDEF",
      value: Math.round(
        B.armorMdefPiece(item.ilvl, item.slot, item.weight) * m,
      ),
    });
  }
  const theirs = new Map<AffixId, number>();
  for (const a of equipped?.affixes ?? [])
    theirs.set(a.id, (theirs.get(a.id) ?? 0) + a.value);
  const affixes = item.affixes.map((a) => ({
    id: a.id,
    label: AFFIX_LABEL[a.id],
    value: a.value,
    text: affixText(a.id, a.value),
    range: affixRangeText(a.id, item.ilvl, item.rarity, B),
    ...(equipped ? { delta: a.value - (theirs.get(a.id) ?? 0) } : {}),
  }));
  return {
    name: itemName(item, leg?.name),
    rarity: item.rarity,
    rarityColor: RARITIES[item.rarity].color,
    ilvl: item.ilvl,
    requiredLevel: Math.max(1, item.ilvl - B.cfg.items.requirementSlack),
    kind,
    base,
    refine: item.refine,
    affixes,
    ...(perks.length > 0 ? { perks } : {}),
    visual: itemVisual(item),
  };
}
