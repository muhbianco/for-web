import type { AvatarGear, AvatarHero } from "@muchat/space-core";
import type { ClassId, RpgHeroState } from "@muchat/space-core/game/ot/balance";

/**
 * The name under an avatar, with the idle game's hero (docs/espaco/jogo/ot): "⚔" while they
 * train at a dummy, and the level. Text only: nothing animates, the map stays drawn on demand.
 */
export function heroLabel(
  name: string,
  hero: { level: number; training: boolean } | null,
): string {
  if (!hero) return name;
  return `${hero.training ? "⚔ " : ""}${name} · Nv ${hero.level}`;
}

/**
 * How many others train at a dummy in the same zone as ours right now (the Dojô social bonus, +5%
 * each; 28/11/2026: the app always showed 10 XP/s). The same count as the server's runtime.
 */
export function dojoPeers(
  mine: string | null | undefined,
  others: Iterable<{ hero: AvatarHero | null }>,
  items: readonly { id: string; zone: string }[],
): number {
  if (!mine) return 0;
  const zoneOf = (id: string) => items.find((i) => i.id === id)?.zone;
  const zone = zoneOf(mine);
  let n = 0;
  for (const o of others)
    if (o.hero?.training && o.hero.at && zoneOf(o.hero.at) === zone) n++;
  return n;
}

/**
 * The look of each class in the training animation (1 magic, 2 healing, 3 bow, 4 melee); the same
 * table as the server's `heroLook` (space-server game/ot/hero.ts), so we look like the others see us.
 */
const LOOK_OF_CLASS: Record<ClassId, number> = {
  mago: 1,
  padre: 2,
  druida: 2,
  cacador: 3,
  guerreiro: 4,
  paladino: 4,
  assassino: 4,
};

/**
 * What the map draws on a v5 hero, in the server's format: the weapon family, the off-hand and
 * the armor weight of each piece (render/heroArt.ts turns them into the sprite).
 */
export function avatarGearOf(eq: RpgHeroState["hero"]["equipment"]): AvatarGear {
  const gear: AvatarGear = {};
  if (eq.arma) gear.weapon = eq.arma.family;
  if (eq.arma?.family === "arco") gear.ammo = "flecha";
  if (eq.arma?.family === "besta") gear.ammo = "virote";
  if (eq.secundaria) gear.shield = eq.secundaria.offhand;
  if (eq.elmo) gear.head = eq.elmo.weight;
  if (eq.armadura) gear.body = eq.armadura.weight;
  if (eq.calcas) gear.legs = eq.calcas.weight;
  if (eq.botas) gear.feet = eq.botas.weight;
  return gear;
}

/**
 * Our own hero as the map draws it, from `rpg.state` (the server's avatar view is for the
 * others): while training at the Dojô, the dummy, the look and what we wear.
 */
export function myHeroOf(s: RpgHeroState): AvatarHero {
  const h = s.hero;
  if (!s.dojo) return { level: h.level, training: false };
  return {
    level: h.level,
    training: true,
    at: s.dojo.instance,
    vocation: LOOK_OF_CLASS[h.cls],
    gear: avatarGearOf(h.equipment),
  };
}
