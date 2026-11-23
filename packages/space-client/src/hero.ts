import type { AvatarGear, AvatarHero } from "@muchat/space-core";
import type { RpgHeroView } from "@muchat/space-core/game/ot";

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
 * Our own hero as the map draws it, from `rpg.state` (the server's avatar view is for the
 * others): while training, the dummy, the vocation and what we wear.
 */
export function myHeroOf(h: RpgHeroView): AvatarHero {
  if (!h.training) return { level: h.level, training: false };
  const g = h.gear;
  const gear: AvatarGear = {};
  if (g.weapon) gear.weapon = g.weapon;
  if (g.shield) gear.shield = g.shield;
  if (g.armor.cabeca) gear.head = g.armor.cabeca;
  if (g.armor.corpo) gear.body = g.armor.corpo;
  if (g.armor.pernas) gear.legs = g.armor.pernas;
  if (g.armor.pes) gear.feet = g.armor.pes;
  if (g.ammo) gear.ammo = g.ammo;
  return { level: h.level, training: true, at: h.training.instance, vocation: h.vocation, gear };
}
