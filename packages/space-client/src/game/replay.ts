import { type EnemyId, fight, type FightEvent, type FightInput, type FightResult, GAME_ENGINE, scaleEnemy } from "@muchat/space-core/game";

/**
 * Reprise de uma luta do Refúgio (ADR 0009, decisão 4): o app roda a mesma
 * `fight()` do servidor com a entrada que veio na `game.fight` e guarda os
 * eventos; a cena só pergunta "como estava no instante t". Sem DOM: testável.
 */

export interface FoeSlot {
  enemy: EnemyId;
  maxHp: number;
  /** Quando entra em cena (os chamados pela Matriarca aparecem no meio). */
  spawnAt: number;
}

export interface Timeline {
  input: FightInput;
  result: FightResult;
  events: FightEvent[];
  durationMs: number;
  heroMaxHp: number;
  heroStartHp: number;
  foes: FoeSlot[];
  /** A versão do motor bateu: a reprise é a luta que o servidor gravou. */
  exact: boolean;
}

export function buildTimeline(input: FightInput, serverResult?: FightResult): Timeline {
  const events: FightEvent[] = [];
  const exact = input.engine === GAME_ENGINE;
  const result = fight(input, (e) => events.push(e));
  const heroMaxHp = Math.floor((input.hero.maxHp * (100 + input.boons.maxHpPct)) / 100);
  const foes: FoeSlot[] = input.foes.map((enemy) => ({ enemy, maxHp: scaleEnemy(enemy, input.degree, input.abyss, input.foePct).maxHp, spawnAt: 0 }));
  for (const e of events) {
    if (e.k === "summon") foes[e.who] = { enemy: e.enemy, maxHp: scaleEnemy(e.enemy, input.degree, input.abyss, input.foePct).maxHp, spawnAt: e.t };
  }
  return {
    input,
    // Motor de outra versão (janela de deploy): o resultado que vale é o do servidor.
    result: exact || !serverResult ? result : serverResult,
    events,
    durationMs: result.durationMs,
    heroMaxHp,
    heroStartHp: Math.max(0, Math.min(input.hp, heroMaxHp)),
    foes,
    exact,
  };
}

export interface FoeFrame {
  enemy: EnemyId;
  hp: number;
  maxHp: number;
  visible: boolean;
  alive: boolean;
}

export interface Frame {
  t: number;
  heroHp: number;
  heroMaxHp: number;
  foes: FoeFrame[];
  /** Eventos das últimas `windowMs` (números que sobem, piscada do golpe). */
  recent: FightEvent[];
  done: boolean;
}

/** O estado da luta no instante `t` (ms da luta). Custa O(eventos): a luta tem poucas centenas. */
export function frameAt(tl: Timeline, t: number, windowMs = 700): Frame {
  let heroHp = tl.heroStartHp;
  const foes: FoeFrame[] = tl.foes.map((f) => ({ enemy: f.enemy, hp: f.maxHp, maxHp: f.maxHp, visible: f.spawnAt === 0, alive: true }));
  const recent: FightEvent[] = [];
  for (const e of tl.events) {
    if (e.t > t) break;
    if (e.t > t - windowMs) recent.push(e);
    switch (e.k) {
      case "hit":
        if (e.to === -1) heroHp -= e.dmg;
        else if (foes[e.to]) foes[e.to]!.hp -= e.dmg;
        break;
      case "dot":
        if (e.to === -1) heroHp -= e.dmg;
        else if (foes[e.to]) foes[e.to]!.hp -= e.dmg;
        break;
      case "heal":
      case "potion":
        heroHp = Math.min(tl.heroMaxHp, heroHp + e.v);
        break;
      case "die":
        if (foes[e.who]) foes[e.who]!.alive = false;
        break;
      case "summon":
        if (foes[e.who]) foes[e.who]!.visible = true;
        break;
      default:
        break;
    }
  }
  for (const f of foes) f.hp = Math.max(0, f.hp);
  return { t, heroHp: Math.max(0, heroHp), heroMaxHp: tl.heroMaxHp, foes, recent, done: t >= tl.durationMs };
}

/** Velocidades da reprise; o servidor espera a luta passar a 4× (RULES.replaySpeedMax). */
export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
