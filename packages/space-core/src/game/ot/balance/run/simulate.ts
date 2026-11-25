import { fight } from "../combat/fight.ts";
import type {
  FighterInput,
  FightOptions,
  FightResult,
  HeroCarry,
} from "../combat/types.ts";
import { type DungeonDef, dungeonRooms } from "../dungeons/catalog.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Monsters, createMonsters } from "../monsters/generate.ts";

/**
 * A corrida inteira (spec §12.1): as 4 salas em sequência, com HP, mana, poções e recargas passando de
 * uma sala para a outra; entre as salas, uma pausa fora de combate (2%/s de HP e mana, P12). Acaba em
 * vitória, derrota (todos caídos) ou tempo (teto de 8 min na Caçada e 10 min na Masmorra).
 */

export type RunOutcome = "vitoria" | "derrota" | "tempo";

export interface RunResult {
  outcome: RunOutcome;
  seconds: number;
  rooms: FightResult[];
  /** Estado de cada herói no fim. */
  heroes: HeroCarry[];
}

export function simulateRun(
  d: DungeonDef,
  party: FighterInput[],
  opts: Pick<FightOptions, "mode" | "random">,
  B: Balance = gameBalance,
  M: Monsters = createMonsters(B),
): RunResult {
  const cfg = B.cfg;
  const rooms = dungeonRooms(d, party.length, M);
  let carry: (HeroCarry | undefined)[] = party.map(() => undefined);
  let elapsed = 0;
  const results: FightResult[] = [];
  const end = (outcome: RunOutcome): RunResult => ({
    outcome,
    seconds: Math.round(elapsed * 10) / 10,
    rooms: results,
    heroes: carry.map(
      (c, j) =>
        c ?? {
          hp: party[j]!.stats.hp,
          mp: party[j]!.stats.mp,
          alive: true,
          pots: party[j]!.potions.stock,
          cooldowns: {},
          revived: false,
          cheatedDeath: false,
        },
    ),
  });

  for (let i = 0; i < rooms.length; i++) {
    const left = d.maxSeconds - elapsed;
    if (left <= 0) return end("tempo");
    const r = fight(party, rooms[i]!, { ...opts, maxSeconds: left, carry }, B);
    results.push(r);
    elapsed += r.seconds;
    carry = r.heroes.map((h) => h.carry);
    if (!r.win)
      return end(r.heroes.every((h) => !h.alive) ? "derrota" : "tempo");
    if (i === rooms.length - 1) break;
    // Pausa entre as salas: fora de combate, regenera e as recargas andam.
    const pause = cfg.runs.roomPauseSeconds;
    elapsed += pause;
    const regen = cfg.regen.outOfCombatPctPerSecond * pause;
    carry = carry.map((c, j) => {
      if (!c || !c.alive) return c;
      const st = party[j]!.stats;
      const cooldowns: Record<string, number> = {};
      for (const [id, s] of Object.entries(c.cooldowns))
        if (s - pause > 0) cooldowns[id] = s - pause;
      return {
        ...c,
        hp: Math.min(st.hp, c.hp + regen * st.hp),
        mp: Math.min(st.mp, c.mp + regen * st.mp),
        cooldowns,
      };
    });
  }
  return end("vitoria");
}
