import { t } from "@lingui/core/macro";
import {
  type AbilityDef,
  type AbilityNow,
  type Derived,
  type NodeEffect,
  type RpgHeroView,
  type StatId,
  type Stats,
  abilityCooldownMs,
  abilityNow,
  ATTACK_FACTOR,
  derive,
  itemDef,
  normalHitRange,
  refineFactor,
  RUN,
  spellRange,
  VOCATIONS,
  withGearStats,
  withInt,
  withVit,
} from "@muchat/space-core/game/ot";

/**
 * Apoio da ficha do herói (24/11/2026): atributos do Ragnarok e a árvore das 4 habilidades.
 * Os números saem das mesmas regras puras do servidor (space-core); as frases passam pelo
 * lingui (macro de @lingui/core, extraído pelo `lingui extract`).
 */

export function statInfo(): Record<StatId, { name: string; blurb: string }> {
  return {
    for: {
      name: t`FOR`,
      blurb: t`Força: dano corpo a corpo (ATQ) e capacidade, +10 oz por ponto.`,
    },
    agi: {
      name: t`AGI`,
      blurb: t`Agilidade: velocidade de ataque e esquiva (level + AGI).`,
    },
    vit: {
      name: t`VIT`,
      blurb: t`Vitalidade: +1% de vida por ponto, regeneração de vida e defesa contra golpes.`,
    },
    int: {
      name: t`INT`,
      blurb: t`Inteligência: +1% de mana por ponto, regeneração de mana, força de magias e curas (MATQ) e defesa mágica.`,
    },
    des: {
      name: t`DES`,
      blurb: t`Destreza: dano à distância, pontaria, golpe mínimo mais alto e recargas mais curtas.`,
    },
    sor: {
      name: t`SOR`,
      blurb: t`Sorte: crítico (golpe no máximo que passa pela armadura), esquiva perfeita e um pouco de ATQ.`,
    },
  };
}

/** O que os atributos dão, com vida, mana e capacidade já somadas. */
/**
 * Os números do herói com os pontos `stats` (os postos, com ou sem os marcados). Os itens vestidos
 * entram por cima (24/11/2026), como no servidor; a capacidade conta só a FOR dos pontos.
 */
export function heroDerived(hero: RpgHeroView, stats: Stats) {
  const eff = withGearStats(stats, hero.gear_stats ?? {});
  const d: Derived = derive(eff, hero.level);
  const attackMs =
    VOCATIONS[hero.vocation].attackSpeedMs * Math.max(0.25, d.aspd);
  return {
    d,
    health: withVit(hero.base.health, eff),
    mana: withInt(hero.base.mana, eff),
    cap: hero.base.cap + derive(stats, hero.level).capBonus,
    attacksPerSecond: 1000 / Math.max(500, attackMs),
  };
}

/** Uma casa decimal, no formato de quem lê. */
export function num(n: number, digits = 1): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** O que um ponto num adereço faz (`n` pontos: o total). */
export function effectText(e: NodeEffect, n: number, heal: boolean): string {
  // `n` é o efeito em pontos de antes (abilities.ts nodeUnits): fracionado com poucos ups.
  const k = Math.max(0, n);
  switch (e.t) {
    case "power": {
      const pct = num(e.pct * k);
      return heal ? t`+${pct}% de cura` : t`+${pct}% de dano`;
    }
    case "cost": {
      const pct = num(e.pct * k);
      return t`−${pct}% de mana`;
    }
    case "cooldown": {
      const s = num((e.ms * k) / 1000);
      return t`−${s} s de recarga`;
    }
    case "targets": {
      const v = e.n * k;
      if (v < 1) {
        const pct = num(v * 100, 0);
        return t`${pct}% de chance de acertar mais um monstro da sala`;
      }
      const m = num(v);
      return t`acerta mais ${m} monstro(s) da sala, em média`;
    }
    case "echo": {
      const pct = num(e.pct * k);
      return t`um segundo golpe com ${pct}% do primeiro`;
    }
    case "leech": {
      const pct = num(e.pct * k);
      return t`${pct}% do dano volta como vida`;
    }
    case "stun": {
      const pct = num(Math.min(100, e.chance * k));
      const s = num(e.ms / 1000);
      return t`${pct}% de chance de atrasar o ataque do monstro em ${s} s`;
    }
    case "element":
      return t`passa a ser do elemento ${e.element}`;
    case "formula": {
      const name = e.name;
      const mana = e.mana;
      return t`vira ${name} (${mana} de mana)`;
    }
    case "trigger": {
      const pct = num(e.pct * k);
      return t`cura mais cedo: +${pct} pontos no limite da vida`;
    }
    case "group": {
      const pct = num(e.pct * k);
      return t`cura também o resto do grupo, com ${pct}% do valor`;
    }
    case "focus": {
      const s = num((e.ms * k) / 1000);
      return t`prende os monstros por mais ${s} s`;
    }
    case "guard": {
      const pct = num(e.pct * k);
      return t`−${pct}% de dano recebido enquanto os monstros estão presos`;
    }
    case "crit": {
      const pct = num(Math.min(60, e.pct * k));
      return t`${pct}% de chance de crítico (×1,5)`;
    }
    case "pierce": {
      const pct = num(Math.min(75, e.pct * k));
      return t`ignora ${pct}% da armadura e da resistência do monstro`;
    }
    case "cover": {
      const pct = num(Math.min(30, e.pct * k));
      return t`+${pct}% na Proteção do grupo enquanto os monstros estão presos`;
    }
  }
}

/** A skill da arma vestida (TFS getWeaponSkill) e o ataque dela, para as fórmulas de arma. */
function weaponNumbers(hero: RpgHeroView): { skill: number; attack: number } {
  const id = hero.inventory.equip.arma?.item;
  const w = id ? itemDef(id) : undefined;
  if (w && (w.kind === "espada" || w.kind === "machado" || w.kind === "maca"))
    return { skill: hero.skills[w.kind].level, attack: w.attack ?? 7 };
  return { skill: hero.skills.punhos.level, attack: 7 };
}

/**
 * O golpe normal do herói com o que veste, como na corrida (run.ts normalHit): a base das
 * habilidades de ataque (fórmula "golpe"). A flecha é a vestida.
 */
function normalHit(hero: RpgHeroView, d: Derived) {
  const eq = hero.inventory.equip;
  const w = eq.arma ? itemDef(eq.arma.item) : undefined;
  const ammo = eq.municao ? itemDef(eq.municao.item) : undefined;
  const voc = VOCATIONS[hero.vocation];
  return normalHitRange({
    level: hero.level,
    magicLevel: hero.magic.level,
    cls: voc.base,
    meleeDamage: voc.meleeDamage,
    distDamage: voc.distDamage,
    weapon: w ?? null,
    refine: refineFactor(eq.arma?.refine ?? 0),
    ammoAttack: w?.kind === "distancia" && w.ammo && ammo?.ammo === w.ammo ? (ammo.attack ?? 0) : null,
    skills: {
      punhos: hero.skills.punhos.level,
      espada: hero.skills.espada.level,
      machado: hero.skills.machado.level,
      maca: hero.skills.maca.level,
      distancia: hero.skills.distancia.level,
    },
    minRoll: d.minRoll,
    attackFactor: ATTACK_FACTOR[RUN.fightMode],
  });
}

/** A habilidade agora: adereços, faixa de valor com os atributos, mana e recarga. */
export function abilityView(
  hero: RpgHeroView,
  def: AbilityDef,
  stats: Stats = hero.stats,
  tree = hero.tree,
): { now: AbilityNow; range: [number, number] | null; cooldownS: number } {
  // A maestria do renascimento e os atributos dos itens, como na corrida.
  const now = abilityNow(def, tree, hero.mastery);
  const d = derive(withGearStats(stats, hero.gear_stats ?? {}), hero.level);
  const w = weaponNumbers(hero);
  // A recarga com a DES e o teto (run.ts abilityCooldownMs), como na corrida.
  const cooldownS = abilityCooldownMs(now, d) / 1000;
  if (def.kind === "desafio" || def.kind === "foco")
    return { now, range: null, cooldownS };
  const normal = normalHit(hero, d);
  const [a, b] = spellRange(now, {
    level: hero.level,
    magicLevel: hero.magic.level,
    weaponSkill: w.skill,
    weaponAttack: w.attack,
    distance: hero.skills.distancia.level,
    baseHit: [normal.lo, normal.hi],
  });
  // A % dos atributos é a do golpe normal de onde a habilidade sai (run.ts abilityValue).
  const f = now.formula.type;
  const from = f === "golpe" ? normal.kind : f === "arma" ? "melee" : f === "distancia" ? "ranged" : "wand";
  const [lo, hi] =
    from === "melee"
      ? [d.meleePct, d.meleePct]
      : from === "ranged"
        ? [d.rangedPct, d.rangedPct]
        : d.magicPct;
  return {
    now,
    range: [
      Math.max(0, Math.floor(a * now.power * (1 + lo / 100))),
      Math.max(0, Math.floor(b * now.power * (1 + hi / 100))),
    ],
    cooldownS,
  };
}

export function abilityKind(def: AbilityDef): string {
  switch (def.kind) {
    case "ataque":
      return t`Ataque no alvo`;
    case "area":
      return t`Ataque em área`;
    case "cura":
      return t`Cura em si`;
    case "cura-outro":
      return t`Cura no grupo`;
    case "desafio":
      return t`Puxa os monstros`;
    case "foco":
      return t`Reforço em si`;
  }
}

/** Por que não dá para aprender, em texto (null: dá). */
export function learnError(reason: string | null): string | null {
  switch (reason) {
    case null:
      return null;
    case "requires":
      return t`Pede antes o adereço anterior do ramo.`;
    case "tier":
      return t`Abre com a evolução de classe, no Mestre.`;
    case "max_rank":
      return t`No máximo.`;
    case "no_points":
      return t`Sem pontos livres: treine no dummy de habilidade.`;
    default:
      return t`Não disponível.`;
  }
}
