import type {
  HeroCarry,
  MechanicEvent,
  RpgRunEndView,
  RpgRunFeedItem,
  RpgRunView,
  RunFrame,
} from "@muchat/space-core/game/ot/balance";

/**
 * A corrida como o app acompanha (Idle Hunt v5, Fase 8): o último segundo, o registro recente e o que
 * a tela conta por cima dos quadros — poções que sobram no cinto, XP de cada herói, as marcas do
 * Cataclismo no chefe (D24) e a mecânica anunciada. Puro: o SpaceView só guarda o resultado.
 */
export interface RunState {
  run: RpgRunView;
  frame: RunFrame | null;
  feed: RpgRunFeedItem[];
  end: RpgRunEndView | null;
  /** Poções que sobram no cinto de cada herói (vida e mana do tamanho equipado). */
  potions: { hp: number; mp: number }[];
  /** O último segundo em que cada herói bebeu (−1: ainda não). */
  potionAt: number[];
  /** O último segundo de cada gole por tipo (a recarga do cinto depende do tamanho de cada um). */
  drank: { hp: number; mp: number }[];
  /** XP que cada herói levou dos abates que o app viu (sem o bônus de fim). */
  xp: number[];
  /** O app viu a corrida desde o 1º segundo (senão o XP de antes de chegar não está em `xp`). */
  xpFromStart: boolean;
  /** Marcas do Cataclismo no chefe da sala (D24: uma por pulso, até o fim). */
  cataclysm: number;
  /** A última mecânica de chefe anunciada e o segundo dela. */
  mechanic: { s: MechanicEvent; a: number; b?: number; at: number } | null;
  /** Cada herói soltou cada skill pela última vez neste segundo (a barra pisca). */
  casts: Record<string, number>[];
}

/** Quanto do registro o app guarda. */
export const RUN_FEED_MAX = 40;

function countEvent(st: RunState, ev: RpgRunFeedItem): void {
  switch (ev.k) {
    case "pocao": {
      const p = st.potions[ev.a];
      if (p) {
        if (ev.mana) p.mp = Math.max(0, p.mp - 1);
        else p.hp = Math.max(0, p.hp - 1);
      }
      if (ev.a < st.potionAt.length)
        st.potionAt[ev.a] = Math.max(st.potionAt[ev.a]!, ev.at);
      const d = st.drank[ev.a];
      if (d) {
        if (ev.mana) d.mp = Math.max(d.mp, ev.at);
        else d.hp = Math.max(d.hp, ev.at);
      }
      return;
    }
    case "abate":
      if (ev.xp)
        ev.xp.forEach((x, i) => {
          if (i < st.xp.length) st.xp[i] = st.xp[i]! + x;
        });
      return;
    case "sala":
      st.cataclysm = 0;
      st.mechanic = null;
      return;
    case "cataclismo":
      st.cataclysm = Math.max(st.cataclysm, ev.n);
      return;
    case "mecanica":
      st.mechanic = {
        s: ev.s,
        a: ev.a,
        ...(ev.b === undefined ? {} : { b: ev.b }),
        at: ev.at,
      };
      return;
    case "lanca": {
      const c = st.casts[ev.a];
      if (c) c[ev.s] = ev.at;
      return;
    }
  }
}

/** O estado a partir do `rpg.run` (quem chega no meio, ou o começo). */
export function runStateFrom(d: {
  run: RpgRunView;
  frame?: RunFrame | null;
  feed?: RpgRunFeedItem[];
  carry?: HeroCarry[];
  end?: RpgRunEndView;
}): RunState {
  const run = d.run;
  const feed = Array.isArray(d.feed) ? d.feed : [];
  const frame = d.frame ?? null;
  const fromStart = !frame || frame.s <= 1 || feed.some((e) => e.k === "sala" && e.st === 0);
  const st: RunState = {
    run,
    frame,
    feed: feed.slice(-RUN_FEED_MAX),
    end: d.end ?? null,
    potions: run.members.map((m, i) => {
      const c = d.carry?.[i];
      // O estado no fim de `frame` já conta as poções de antes; sem ele, o começo menos o registro.
      return c ? { hp: c.hpPots ?? c.pots, mp: c.mpPots ?? 0 } : { ...m.potions };
    }),
    potionAt: run.members.map(() => -1),
    drank: run.members.map(() => ({ hp: -1, mp: -1 })),
    xp: run.members.map(() => 0),
    xpFromStart: fromStart,
    cataclysm: 0,
    mechanic: null,
    casts: run.members.map(() => ({})),
  };
  const carried = !!d.carry;
  for (const ev of feed) {
    if (carried && ev.k === "pocao") {
      // As poções já vieram contadas no `carry`: só a hora em que bebeu.
      if (ev.a < st.potionAt.length) st.potionAt[ev.a] = Math.max(st.potionAt[ev.a]!, ev.at);
      const d = st.drank[ev.a];
      if (d) {
        if (ev.mana) d.mp = Math.max(d.mp, ev.at);
        else d.hp = Math.max(d.hp, ev.at);
      }
      continue;
    }
    countEvent(st, ev);
  }
  return st;
}

/** Os segundos que chegaram depois (`rpg.run.tick`). Quadros repetidos (já vistos) são ignorados. */
export function applyFrames(cur: RunState, frames: RunFrame[]): RunState {
  if (frames.length === 0) return cur;
  const seen = cur.frame?.s ?? 0;
  const st: RunState = {
    ...cur,
    feed: [...cur.feed],
    potions: cur.potions.map((p) => ({ ...p })),
    potionAt: [...cur.potionAt],
    drank: cur.drank.map((d) => ({ ...d })),
    xp: [...cur.xp],
    casts: cur.casts.map((c) => ({ ...c })),
  };
  let last: RunFrame | null = null;
  for (const f of frames) {
    if (f.s <= seen) continue;
    last = f;
    for (const ev of f.e) {
      const item = { ...ev, at: f.s, st: f.st } as RpgRunFeedItem;
      st.feed.push(item);
      countEvent(st, item);
    }
  }
  if (!last) return cur;
  st.frame = last;
  st.feed = st.feed.slice(-RUN_FEED_MAX);
  return st;
}
