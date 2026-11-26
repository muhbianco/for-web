/**
 * O estado de uma habilidade na barra da corrida, a partir do quadro do segundo (puro, testado).
 *
 * O quadro traz a mana do FIM do segundo, já descontado o custo do que saiu nele. Por isso, no
 * segundo em que a habilidade sai, comparar essa mana com o custo dela a pintava "sem mana" junto
 * com o brilho de "saiu" — e parecia que o herói soltava a habilidade sem mana (26/11/2026). O
 * motor só solta com a mana inteira; aqui o segundo da saída vale como "saiu".
 */
export type SkillSlotState = "caiu" | "saiu" | "recarga" | "semMana" | "pronta";

export function skillSlotState(o: {
  dead: boolean;
  /** O segundo da corrida agora. */
  nowS: number;
  /** O último segundo em que a habilidade saiu (undefined: ainda não saiu). */
  castAt: number | undefined;
  /** O que falta da recarga, em ms. */
  cooldownLeftMs: number;
  /** A mana no fim deste segundo. */
  mana: number;
  cost: number;
}): SkillSlotState {
  if (o.dead) return "caiu";
  if (o.castAt === o.nowS) return "saiu";
  if (o.cooldownLeftMs > 0) return "recarga";
  if (o.mana < o.cost) return "semMana";
  return "pronta";
}
