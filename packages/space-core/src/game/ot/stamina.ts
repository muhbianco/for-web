/**
 * Stamina do TFS, usada só nas dungeons (decisão do dono, 23/11/2026). Minutos, de 0 a
 * 2520 (42 h). Começa cheia [TFS schema.sql: stamina 2520].
 */
export const STAMINA = {
  max: 2520,
  /** Acima disso a experiência sai ×1,5 [TFS default_onGainExperience.lua:61-64]. */
  happyAbove: 2340,
  /** Até isso a experiência sai ×0,5. */
  tiredAtOrBelow: 840,
  /** Recuperação: 1 min a cada 180 s até 2340, depois 1 a cada 360 s [TFS config.lua.dist:169-170]. */
  regenSecondsPerMinute: 180,
  regenHappySecondsPerMinute: 360,
  /** Os primeiros 10 min fora não recuperam; menos de 3 min depois disso, nada [TFS regenerate_stamina.lua:8-11]. */
  regenGraceSeconds: 600,
  regenMinSeconds: 180,
} as const;

/**
 * Multiplicador da experiência pela stamina [TFS default_onGainExperience.lua:57-66].
 * [nosso] O ×1,5 do original exigia conta premium; aqui vale para todos.
 */
export function staminaMultiplier(minutes: number): number {
  if (minutes > STAMINA.happyAbove) return 1.5;
  if (minutes <= STAMINA.tiredAtOrBelow) return 0.5;
  return 1;
}

/** Gasto: 1 min por minuto na dungeon [TFS default_onGainExperience.lua:5-33, em regime]. */
export function spendStamina(minutes: number, combatMinutes: number): number {
  return Math.max(0, minutes - Math.max(0, Math.floor(combatMinutes)));
}

/**
 * Recuperação fora da dungeon [TFS data/creaturescripts/scripts/regenerate_stamina.lua].
 * [nosso] "Fora" é o tempo sem dungeon; no OT, era o tempo deslogado.
 */
export function regenStamina(minutes: number, awaySeconds: number): number {
  const t = Math.min(awaySeconds, 86_400 * 21) - STAMINA.regenGraceSeconds;
  if (t < STAMINA.regenMinSeconds) return minutes;
  const normalRoom = STAMINA.happyAbove - Math.min(STAMINA.happyAbove, minutes);
  const normal = t / STAMINA.regenSecondsPerMinute;
  if (normal > normalRoom) {
    const happy =
      (t - normalRoom * STAMINA.regenSecondsPerMinute) /
      STAMINA.regenHappySecondsPerMinute;
    return Math.floor(
      Math.min(STAMINA.max, Math.max(STAMINA.happyAbove, minutes) + happy),
    );
  }
  return Math.floor(minutes + normal);
}
