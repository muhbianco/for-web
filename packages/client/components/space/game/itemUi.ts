import { t } from "@lingui/core/macro";
import {
  type Element,
  type ItemDef,
  type ItemStack,
  type Slot,
  type StatId,
  type Stats,
  type VocationId,
  COINS,
  itemAbsorb,
  itemDef,
  refineFactor,
  WAND_ML,
} from "@muchat/space-core/game/ot";

/**
 * Textos e ícones dos itens (docs/espaco/jogo/ot, etapa O7). O nome do item vem do conteúdo
 * do jogo (space-core); as frases passam pelo lingui (macro `t` de @lingui/core, nunca o `t`
 * do `useLingui()` por parâmetro).
 */

export function slotLabels(): Record<Slot, string> {
  return {
    cabeca: t`Cabeça`,
    colar: t`Colar`,
    mochila: t`Mochila`,
    corpo: t`Corpo`,
    arma: t`Arma`,
    escudo: t`Escudo`,
    pernas: t`Pernas`,
    pes: t`Pés`,
    anel: t`Anel`,
    municao: t`Munição`,
  };
}

function elementLabels(): Record<Element, string> {
  return {
    fisico: t`físico`,
    energia: t`energia`,
    terra: t`terra`,
    fogo: t`fogo`,
    gelo: t`gelo`,
    sagrado: t`sagrado`,
    morte: t`morte`,
  };
}

/** Ícone vazio de cada lugar (Material Symbols). */
export const SLOT_ICON: Record<Slot, string> = {
  cabeca: "sports_motorsports",
  colar: "diamond",
  mochila: "backpack",
  corpo: "checkroom",
  arma: "swords",
  escudo: "shield",
  pernas: "airline_seat_legroom_extra",
  pes: "footprint",
  anel: "trip_origin",
  municao: "north",
};

export function itemIcon(def: ItemDef | undefined): string {
  if (!def) return "help";
  if (COINS.includes(def.id)) return "toll";
  if (def.potion) return "science";
  if (def.id.startsWith("frasco")) return "science";
  if (def.kind === "distancia") return "target";
  if (def.kind === "varinha") return "auto_fix_high";
  return def.slot ? SLOT_ICON[def.slot] : "inventory_2";
}

export function itemName(id: string): string {
  return itemDef(id)?.name ?? id;
}

/** O nome da pilha com o refino na frente, como no Ragnarok ("+7 Espada larga"). */
export function stackName(x: ItemStack): string {
  const r = x.refine ?? 0;
  return r > 0 ? `+${r} ${itemName(x.item)}` : itemName(x.item);
}

/** "35,00 oz" a partir de centésimos de oz. */
export function oz(hundredths: number): string {
  const v = (hundredths / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return t`${v} oz`;
}

/** "20:00" (minutos:segundos) para o tempo do anel. */
function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** As siglas dos atributos, na ordem do painel (como no Ragnarok). */
const STAT_ORDER: readonly StatId[] = [
  "for",
  "agi",
  "vit",
  "int",
  "des",
  "sor",
];
export function statAbbr(k: StatId): string {
  switch (k) {
    case "for":
      return t`FOR`;
    case "agi":
      return t`AGI`;
    case "vit":
      return t`VIT`;
    case "int":
      return t`INT`;
    case "des":
      return t`DES`;
    default:
      return t`SOR`;
  }
}

/** "FOR +2 · VIT +1" (vazio: sem atributos). */
export function statsLine(stats: Partial<Stats> | undefined): string {
  if (!stats) return "";
  return STAT_ORDER.filter((k) => stats[k])
    .map((k) => `${statAbbr(k)} ${stats[k]! > 0 ? "+" : ""}${stats[k]}`)
    .join(" · ");
}

/** Uma diferença entre dois itens: o nome do número e quanto o novo dá a mais (ou a menos). */
export interface ItemDelta {
  label: string;
  delta: number;
}

/**
 * O que trocar o vestido (`current`, ou nada) por `def` muda (24/11/2026): ataque, defesa,
 * armadura, acerto e cada atributo. Só o que muda entra; o mais alto é melhor em todos.
 */
export function compareItems(
  def: ItemDef,
  current: ItemDef | undefined,
): ItemDelta[] {
  const out: ItemDelta[] = [];
  const add = (label: string, a = 0, b = 0) => {
    if (a !== b) out.push({ label, delta: a - b });
  };
  add(t`ataque`, def.attack, current?.attack);
  add(t`defesa`, def.defense, current?.defense);
  add(t`armadura`, def.armor, current?.armor);
  add(t`acerto`, def.hitChance, current?.hitChance);
  if (def.wand || current?.wand) {
    const avg = (d?: ItemDef) => (d?.wand ? (d.wand.min + d.wand.max) / 2 : 0);
    add(t`dano da varinha`, Math.round(avg(def)), Math.round(avg(current)));
  }
  for (const k of STAT_ORDER)
    add(statAbbr(k), def.stats?.[k], current?.stats?.[k]);
  return out;
}

/** O que o item faz, linha a linha, para a ficha. */
export function itemLines(
  def: ItemDef,
  stack: ItemStack | null,
  vocationName: (base: number) => string,
): string[] {
  const el = elementLabels();
  const out: string[] = [];
  const stats = statsLine(def.stats);
  if (stats) out.push(stats);
  const refine = stack?.refine ?? 0;
  if (refine > 0) {
    const pct = Math.round((refineFactor(refine) - 1) * 100);
    out.push(t`Refino +${refine}: +${pct}% de dano`);
  }
  const atk = def.attack ?? 0;
  const dfn = def.defense ?? 0;
  if (def.slot === "arma" && def.kind !== "distancia" && def.kind !== "varinha")
    out.push(t`Ataque ${atk} · defesa ${dfn}`);
  if (def.slot === "escudo") out.push(t`Defesa ${dfn}`);
  if (def.armor) {
    const a = def.armor;
    out.push(t`Armadura ${a}`);
  }
  if (def.kind === "distancia") {
    const ammo = def.ammo === "virote" ? t`virotes` : t`flechas`;
    out.push(t`Atira ${ammo}; usa as duas mãos`);
    if (atk) out.push(t`Ataque +${atk}`);
    if (def.hitChance) {
      const h = def.hitChance;
      out.push(t`Acerto +${h}%`);
    }
  } else if (def.twoHanded) out.push(t`Usa as duas mãos`);
  if (def.slot === "municao") {
    const hit = def.maxHitChance ?? 0;
    out.push(
      hit === 75 || hit === 90 || hit === 100
        ? t`Ataque ${atk}; acerto pela skill, até ${hit}%`
        : t`Ataque ${atk}; acerto ${hit}%`,
    );
    out.push(t`Cada tiro gasta uma`);
  }
  if (def.wand) {
    const { min, max, mana } = def.wand;
    const e = el[def.wand.element];
    // 24/11/2026: a varinha cresce com o magic level (spells.ts WAND_ML).
    const a = String(WAND_ML[0]).replace(".", ",");
    const b = String(WAND_ML[1]).replace(".", ",");
    out.push(
      mana > 0
        ? t`${min} a ${max} de ${e} por tiro, mais ${a} a ${b} por magic level; ${mana} de mana`
        : t`${min} a ${max} de ${e} por tiro, mais ${a} a ${b} por magic level`,
    );
  }
  if (def.potion?.health) {
    const [a, b] = def.potion.health;
    out.push(t`Cura ${a} a ${b} de vida`);
  }
  if (def.potion?.mana) {
    const [a, b] = def.potion.mana;
    out.push(t`Devolve ${a} a ${b} de mana`);
  }
  if (def.container) {
    const n = def.container;
    out.push(t`${n} espaços`);
  }
  if (def.absorb) {
    // Só resistência física e mágica (24/11/2026, resist.ts).
    const a = itemAbsorb(def);
    if (a.fisico > 0) out.push(t`Protege ${a.fisico}% do dano físico`);
    if (a.magia > 0) out.push(t`Protege ${a.magia}% do dano mágico`);
  }
  if (def.skillBonus) {
    const parts = Object.entries(def.skillBonus)
      .map(([k, v]) => `+${v} ${skillName(k)}`)
      .join(", ");
    out.push(parts);
  }
  if (def.regen) {
    const { health, mana } = def.regen;
    const s = Math.round(def.regen.ticksMs / 1000);
    out.push(t`+${health} de vida e +${mana} de mana a cada ${s} s`);
  }
  if (def.charges) {
    const left = stack?.charges ?? def.charges;
    const max = def.charges;
    out.push(t`Cargas: ${left} de ${max} (uma por golpe absorvido)`);
  }
  if (def.duration) {
    const left = mmss(stack?.duration ?? def.duration);
    out.push(t`Tempo: ${left} (só corre na dungeon)`);
  }
  const req: string[] = [];
  if (def.minLevel) {
    const lv = def.minLevel;
    req.push(t`level ${lv}`);
  }
  if (def.vocations) req.push(def.vocations.map(vocationName).join(t` ou `));
  if (req.length > 0) {
    const r = req.join(" · ");
    out.push(t`Pede ${r}`);
  }
  const w = oz(def.weight * (stack?.count ?? 1));
  out.push(t`Peso ${w}`);
  if (COINS.includes(def.id)) {
    const v = (def.value * (stack?.count ?? 1)).toLocaleString();
    out.push(t`Vale ${v} de ouro`);
  }
  return out;
}

function skillName(k: string): string {
  if (k === "espada") return t`espada`;
  if (k === "machado") return t`machado`;
  if (k === "maca") return t`maça`;
  if (k === "distancia") return t`distância`;
  if (k === "escudo") return t`escudo`;
  return t`punhos`;
}

/** Por que o herói não bebe esta poção ("só cavaleiro ou paladino", "pede level 50"); null: bebe. */
export function drinkLock(
  def: ItemDef,
  base: VocationId,
  level: number,
  vocationName: (base: number) => string,
): string | null {
  if (def.vocations && !def.vocations.includes(base)) {
    const who = def.vocations.map(vocationName).join(t` ou `);
    return t`só ${who}`;
  }
  const lv = def.minLevel ?? 0;
  if (level < lv) return t`pede level ${lv}`;
  return null;
}

/** O que o botão de trocar moedas faz com esta pilha (null: não troca). */
export function coinAction(stack: ItemStack): string | null {
  const c = COINS.indexOf(stack.item);
  if (c < 0) return null;
  const up = COINS[c + 1];
  const down = COINS[c - 1];
  if (up && stack.count === 100) {
    const name = itemName(up);
    return t`Trocar 100 por 1 ${name}`;
  }
  if (down) {
    const name = itemName(down);
    return t`Trocar 1 por 100 ${name}`;
  }
  return null;
}

/** Mensagens das recusas do inventário. */
export function inventoryError(reason: string | undefined): string | null {
  switch (reason) {
    case "in_run":
      return t`O herói está numa dungeon: o inventário volta quando a corrida acabar.`;
    case "changed":
      return t`A mochila mudou. Confira e tente de novo.`;
    case "both_hands":
      return t`Essa arma usa as duas mãos: tire o escudo antes (ou a arma, para pôr o escudo).`;
    case "no_room":
      return t`Não cabe: falta espaço na mochila ou capacidade.`;
    case "is_container":
      return t`A mochila não sai do corpo: é ela que guarda tudo. Para trocar, vista outra.`;
    case "vocation":
      return t`Sua vocação não usa esse item.`;
    case "level":
      return t`Seu herói ainda não tem o level desse item.`;
    case "not_enough":
      return t`Para trocar ouro por platina, junte 100 moedas na mesma pilha.`;
    case "not_equipment":
      return t`Isso não se veste.`;
    case "no_item":
      return t`Esse item não está mais aí.`;
    default:
      return null;
  }
}
