import { fight } from "../combat/fight.ts";
import {
  type FightEvent,
  type FightFrame,
  type FighterInput,
  type FightOptions,
  type FightResult,
  type HeroCarry,
  FOE_BASE,
} from "../combat/types.ts";
import {
  type DungeonDef,
  dungeonRooms,
  dungeonType,
} from "../dungeons/catalog.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Monsters, createMonsters } from "../monsters/generate.ts";
import { rewardsFor } from "./rewards.ts";

/**
 * A corrida inteira (spec §12.1): as 4 salas em sequência, com HP, mana, poções e recargas passando de
 * uma sala para a outra, sem descanso entre elas (D40: a próxima sala começa na hora). Acaba em
 * vitória (todos os monstros mortos) ou derrota (todos os heróis caídos). Sem teto de tempo (D21).
 */

/**
 * Versão das regras da corrida: a corrida gravada só tem os quadros refeitos pela semente se esta for a
 * mesma do início. Subir quando mudar fórmula, config ou motor (a v4 do jogo era a 15).
 */
export const ENGINE_VERSION = 21;

/** "travada" só se a trava técnica do simulador disparar (defeito; não é regra de jogo). */
export type RunOutcome = "vitoria" | "derrota" | "travada";

/**
 * Evento da corrida: os da luta, mais a entrada numa sala. O "descanso" só vem de corrida gravada
 * antes da v17 (D40 tirou a pausa entre as salas); o app ainda sabe mostrá-lo.
 */
export type RunEvent =
  | FightEvent
  | { k: "sala"; st: number }
  | { k: "descanso"; s: number };

/** Um segundo da corrida para a tela: `s` conta da largada; `st` é a sala (no descanso, a que acabou). */
export interface RunFrame extends Omit<FightFrame, "e"> {
  st: number;
  e: RunEvent[];
}

export interface RunResult {
  outcome: RunOutcome;
  seconds: number;
  rooms: FightResult[];
  /** Estado de cada herói no fim. */
  heroes: HeroCarry[];
  /** Com `record`: um quadro por segundo da corrida inteira, salas e descansos. */
  frames?: RunFrame[];
}

export function simulateRun(
  d: DungeonDef,
  party: FighterInput[],
  opts: Pick<FightOptions, "mode" | "random" | "record">,
  B: Balance = gameBalance,
  M: Monsters = createMonsters(B),
): RunResult {
  const cfg = B.cfg;
  const rooms = dungeonRooms(d, party.length, M);
  let carry: (HeroCarry | undefined)[] = party.map(() => undefined);
  let elapsed = 0;
  const results: FightResult[] = [];
  const frames: RunFrame[] = [];
  let clock = 0;
  const levels = party.map((p) => p.stats.level);
  const type = dungeonType(d);
  const end = (outcome: RunOutcome): RunResult => ({
    outcome,
    seconds: Math.round(elapsed * 10) / 10,
    rooms: results,
    ...(opts.record ? { frames } : {}),
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
    const r = fight(
      party,
      rooms[i]!,
      { ...opts, maxSeconds: cfg.runs.engineGuardSeconds, carry },
      B,
    );
    results.push(r);
    elapsed += r.seconds;
    carry = r.heroes.map((h) => h.carry);
    if (opts.record && r.frames) {
      // O XP de cada abate, para a barra encher na tela (o bônus de fim entra só no fechamento).
      const xpOf = new Map<number, number[]>();
      for (const k of r.kills)
        if (!k.summoned)
          xpOf.set(
            k.enemy,
            rewardsFor([k], levels, type, false, B).heroes.map((h) => h.xp),
          );
      r.frames.forEach((f, idx) => {
        const e: RunEvent[] = f.e.map((ev) =>
          ev.k === "abate" && xpOf.has(ev.b - FOE_BASE)
            ? { ...ev, xp: xpOf.get(ev.b - FOE_BASE)! }
            : ev,
        );
        if (idx === 0) e.unshift({ k: "sala", st: i });
        frames.push({ ...f, s: clock + f.s, st: i, e });
      });
      clock += r.frames.at(-1)?.s ?? 0;
    }
    if (!r.win)
      return end(r.heroes.every((h) => !h.alive) ? "derrota" : "travada");
    // Sem descanso entre as salas (D40, 25/11/2026): a próxima começa na hora, com a vida, a mana,
    // as poções e as recargas como ficaram no fim desta.
  }
  return end("vitoria");
}
