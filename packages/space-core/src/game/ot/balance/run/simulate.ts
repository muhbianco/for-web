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
 * uma sala para a outra; entre as salas, uma pausa fora de combate (2%/s de HP e mana, P12). Acaba em
 * vitória (todos os monstros mortos) ou derrota (todos os heróis caídos). Sem teto de tempo (D21).
 */

/** "travada" só se a trava técnica do simulador disparar (defeito; não é regra de jogo). */
export type RunOutcome = "vitoria" | "derrota" | "travada";

/** Evento da corrida: os da luta, mais a entrada numa sala e o descanso entre as salas. */
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
    if (i === rooms.length - 1) break;
    // Pausa entre as salas: fora de combate, regenera e as recargas andam.
    // Descansa até todos chegarem ao alvo de HP e mana, no mínimo a pausa.
    const rate = cfg.regen.outOfCombatPctPerSecond;
    let need = 0;
    carry.forEach((c, j) => {
      if (!c || !c.alive) return;
      const st = party[j]!.stats;
      const short = Math.max(
        cfg.runs.restUntilPct - c.hp / st.hp,
        cfg.runs.restUntilPct - c.mp / st.mp,
        0,
      );
      need = Math.max(need, short / rate);
    });
    const pause = Math.max(cfg.runs.roomPauseSeconds, Math.ceil(need));
    elapsed += pause;
    const regen = rate * pause;
    if (opts.record) {
      for (let p = 1; p <= pause; p++)
        frames.push({
          s: clock + p,
          st: i,
          h: carry.map((c, j) =>
            !c || !c.alive
              ? 0
              : Math.round(
                  Math.min(
                    party[j]!.stats.hp,
                    c.hp + rate * p * party[j]!.stats.hp,
                  ),
                ),
          ),
          m: carry.map((c, j) =>
            !c || !c.alive
              ? 0
              : Math.round(
                  Math.min(
                    party[j]!.stats.mp,
                    c.mp + rate * p * party[j]!.stats.mp,
                  ),
                ),
          ),
          x: [],
          e: p === 1 ? [{ k: "descanso", s: pause }] : [],
        });
      clock += pause;
    }
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
