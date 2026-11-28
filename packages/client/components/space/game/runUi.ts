import { t } from "@lingui/core/macro";
import type { RunState } from "@muchat/space-client";
import {
  type EnemyInput,
  type RpgRunFeedItem,
  FOE_BASE,
  skillOf,
} from "@muchat/space-core/game/ot/balance";

import { archetypeName, familyName, mechanicName } from "./gameText";
import { BOSS_ARCHETYPES, num, runRooms } from "./heroModel";

/**
 * O que a tela da corrida escreve (Idle Hunt v5): o nome de cada ator (herói pelo índice, inimigo
 * por 100 + índice na sala, os invocados depois) e uma linha por evento do quadro.
 */

export interface RunCast {
  rooms: EnemyInput[][];
  heroName: (i: number) => string;
  enemyName: (room: number, i: number) => string;
  enemyOf: (room: number, i: number) => EnemyInput | null;
}

export function runCast(st: RunState): RunCast {
  const rooms = runRooms(st.run.dungeon, st.run.members.length);
  const enemyOf = (room: number, i: number) => rooms[room]?.[i] ?? null;
  return {
    rooms,
    heroName: (i) => st.run.members[i]?.name ?? "?",
    enemyOf,
    enemyName: (room, i) => {
      const e = enemyOf(room, i);
      if (!e) return t`Lacaio invocado`;
      const fam = familyName(e.family);
      return BOSS_ARCHETYPES.has(e.archetype)
        ? archetypeName(e.archetype)
        : fam
          ? `${archetypeName(e.archetype)} ${fam}`
          : archetypeName(e.archetype);
    },
  };
}

/** Quem é o ator (`a` ou `b` de um evento). */
export function actorName(c: RunCast, room: number, id: number): string {
  return id >= FOE_BASE ? c.enemyName(room, id - FOE_BASE) : c.heroName(id);
}

function skillName(st: RunState, a: number, s: string): string {
  const m = st.run.members[a];
  return (m ? skillOf(m.cls, s)?.name : undefined) ?? s;
}

export type FeedTone = "hit" | "heal" | "bad" | "info" | "warn" | "good";

/** A linha do registro (null: evento que não vale uma linha, como soltar uma skill). */
export function feedLine(
  st: RunState,
  c: RunCast,
  ev: RpgRunFeedItem,
): { text: string; tone: FeedTone } | null {
  const who = (id: number) => actorName(c, ev.st, id);
  switch (ev.k) {
    case "golpe":
      if (ev.bl === "erro")
        return { text: t`${who(ev.b)} desviou de ${who(ev.a)}`, tone: "info" };
      if (ev.bl === "bloqueio")
        return {
          text: t`${who(ev.b)} bloqueou ${who(ev.a)} (${num(ev.v)})`,
          tone: "info",
        };
      return {
        text: t`${who(ev.a)} → ${who(ev.b)}: ${num(ev.v)}`,
        tone: ev.a >= FOE_BASE ? "bad" : "hit",
      };
    case "magia": {
      if (ev.a >= FOE_BASE) {
        const name =
          ev.s === "golpe-pesado" || ev.s === "pulso" || ev.s === "investida"
            ? mechanicName(ev.s)
            : ev.s === "cataclismo"
              ? t`Cataclismo`
              : ev.s === "intervencao-divina"
                ? t`Devoção`
                : ev.s;
        return {
          text: t`${who(ev.a)}: ${name} em ${who(ev.b)} (${num(ev.v)})`,
          tone: "bad",
        };
      }
      const s = skillName(st, ev.a, ev.s);
      if (ev.bl === "erro")
        return {
          text: t`${who(ev.b)} desviou de ${s} (${who(ev.a)})`,
          tone: "info",
        };
      return ev.cura
        ? {
            text: t`${who(ev.a)} · ${s} cura ${who(ev.b)} (+${num(ev.v)})`,
            tone: "heal",
          }
        : {
            text: t`${who(ev.a)} · ${s} → ${who(ev.b)}: ${num(ev.v)}`,
            tone: "hit",
          };
    }
    case "abate":
      return { text: t`${who(ev.b)} derrotado`, tone: "good" };
    case "queda":
      return { text: t`${who(ev.b)} caiu!`, tone: "bad" };
    case "pocao":
      return ev.mana
        ? { text: t`${who(ev.a)} bebeu mana (+${num(ev.v)})`, tone: "heal" }
        : { text: t`${who(ev.a)} bebeu vida (+${num(ev.v)})`, tone: "heal" };
    case "mecanica": {
      const target = ev.b === undefined ? "" : ` → ${who(ev.b)}`;
      return {
        text: t`⚠ ${who(ev.a)}: ${mechanicName(ev.s)}${target}`,
        tone: "warn",
      };
    }
    case "cataclismo":
      return { text: t`☠ Cataclismo ×${ev.n}`, tone: "warn" };
    case "sala":
      return {
        text: ev.st >= 3 ? t`— O chefe! —` : t`— Sala ${ev.st + 1} —`,
        tone: "info",
      };
    case "descanso":
      return { text: t`Descanso antes da próxima sala`, tone: "info" };
    default:
      return null;
  }
}
