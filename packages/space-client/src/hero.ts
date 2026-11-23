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
