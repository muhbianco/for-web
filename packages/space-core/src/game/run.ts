import {
  ABYSS_STEP,
  BOON_IDS,
  type BoonId,
  BOONS,
  type Boons,
  DEGREE,
  type Degree,
  ENEMIES,
  type EnemyId,
  GAME_ENGINE,
  MAX_ABYSS,
  NO_BOONS,
  type Rarity,
  RULES,
  type SkillId,
} from "./data.ts";
import { degreeMul, fight, type FightInput, type FightResult, type Tactics } from "./fight.ts";
import { type Item, rollItem, rollRarity, sellValue } from "./items.ts";
import { encounter, generateMap, initiationMap, type RunMap } from "./map.ts";
import { Rng, seedOf } from "./rng.ts";
import type { HeroCombat } from "./stats.ts";

export type EventId = "altar" | "bau" | "andarilho";
export const EVENT_IDS: readonly EventId[] = ["altar", "bau", "andarilho"];

/** O que está aberto para o jogador escolher (`choose`). Só a loja deixa seguir sem escolher. */
export type Offer =
  | { kind: "bencao"; boons: BoonId[] }
  | { kind: "loja"; potionPrice: number; boonPrice: number }
  | { kind: "descanso"; retreat: boolean }
  | { kind: "evento"; event: EventId; price: number };

export type RunEnd = "vitoria" | "morte" | "retirada";

/**
 * Semente de cada ação com sorteio (o mapa é a 0). No servidor é o HMAC-SHA256
 * da chave secreta da expedição com `seq`: a semente de uma luta, que o app
 * recebe, não revela as próximas (ADR 0009, decisão 4). Com uma semente de 32
 * bits e `seedOf`, bastariam 2³² tentativas para prever a expedição inteira;
 * por isso `seedOf` só serve para testes e para a simulação.
 */
export type SeedSource = (seq: number) => number;

export function simpleSeeds(seed: number): SeedSource {
  return (seq) => seedOf(seed, seq);
}

/** Estado de uma expedição. Fica no documento do herói e pode ir inteiro ao app: não tem segredo. */
export interface RunState {
  degree: Degree;
  abyss: number;
  initiation: boolean;
  map: RunMap;
  /** Linha atual (0 = primeira); −1 antes de entrar. */
  row: number;
  lane: number;
  hp: number;
  mp: number;
  potions: number;
  boons: Boons;
  bagGold: number;
  bagItems: Item[];
  xp: number;
  kills: number;
  tries: Partial<Record<SkillId, number>>;
  offer: Offer | null;
  /** Conta as ações com sorteio: cada uma pede a própria semente à `SeedSource`. */
  seq: number;
  fights: number;
  combatMs: number;
  end: RunEnd | null;
}

/** `go`: entrar numa sala da próxima linha. `choose`: resolver a oferta aberta (−1 = recusar ou sair). */
export type RunChoice = { t: "go"; lane: number } | { t: "choose"; option: number };

export type RunError = "ended" | "offer_pending" | "bad_lane" | "no_offer" | "bad_option" | "no_gold" | "full";

export interface FightRecord {
  input: FightInput;
  result: FightResult;
}

export type StepResult = { ok: true; state: RunState; fight: FightRecord | null } | { ok: false; error: RunError };

export interface RunStart {
  degree: Degree;
  abyss: number;
  initiation: boolean;
  hp: number;
  mp: number;
  potions: number;
}

export function startRun(o: RunStart, seeds: SeedSource): RunState {
  const map = o.initiation ? initiationMap() : generateMap(new Rng(seeds(0)));
  return {
    degree: o.initiation ? "normal" : o.degree,
    abyss: o.degree === "abismo" && !o.initiation ? Math.min(MAX_ABYSS, Math.max(1, Math.floor(o.abyss))) : 1,
    initiation: o.initiation,
    map,
    row: -1,
    lane: 0,
    hp: Math.max(0, Math.floor(o.hp)),
    mp: Math.max(0, Math.floor(o.mp)),
    potions: Math.min(RULES.maxPotions, Math.max(0, Math.floor(o.potions))),
    boons: { ...NO_BOONS },
    bagGold: 0,
    bagItems: [],
    xp: 0,
    kills: 0,
    tries: {},
    offer: null,
    seq: 1,
    fights: 0,
    combatMs: 0,
    end: null,
  };
}

/**
 * Posição do degrau na escada: Normal 1, Difícil 2, Pesadelo 3, Abismo N 3 + N.
 * O herói guarda o maior degrau vencido (`best`, 0 = nenhum).
 */
export function degreeRank(degree: Degree, abyss: number): number {
  if (degree === "normal") return 1;
  if (degree === "dificil") return 2;
  if (degree === "pesadelo") return 3;
  return 3 + Math.min(MAX_ABYSS, Math.max(1, Math.floor(abyss)));
}

/** O degrau está liberado: o Normal sempre; os outros, vencido o anterior. */
export function degreeUnlocked(best: number, degree: Degree, abyss: number): boolean {
  return degreeRank(degree, abyss) <= Math.max(1, best + 1);
}

/** Trilhas que o próximo `go` aceita. */
export function reachableLanes(s: RunState): number[] {
  if (s.end) return [];
  if (s.row < 0) return s.map[0]!.map((_, i) => i);
  if (s.row >= s.map.length - 1) return [];
  return [...s.map[s.row]![s.lane]!.next];
}

export function maxHpWithBoons(hc: HeroCombat, b: Boons): number {
  return Math.floor((hc.maxHp * (100 + b.maxHpPct)) / 100);
}

const mul = (value: number, m: number) => Math.floor((value * m) / 100_000);

function xpMul(s: RunState): number {
  return degreeMul(DEGREE[s.degree].xpPct, ABYSS_STEP.xpPct, s.degree, s.abyss);
}
function goldMul(s: RunState): number {
  return degreeMul(DEGREE[s.degree].goldPct, ABYSS_STEP.goldPct, s.degree, s.abyss);
}

function ilvlRoll(rng: Rng, s: RunState, row: number): number {
  const [lo, hi] = DEGREE[s.degree].ilvl;
  const extra = s.degree === "abismo" ? s.abyss - 1 : 0;
  return Math.min(hi + extra, lo + extra + Math.floor(((hi - lo) * row) / RULES.rows) + rng.int(0, 2));
}

function addItem(s: RunState, it: Item) {
  if (s.bagItems.length < RULES.bagItemsMax) s.bagItems.push(it);
  else s.bagGold += sellValue(it);
}

function loot(rng: Rng, s: RunState, hc: HeroCombat, row: number, min: Rarity, ilvlBonus = 0) {
  addItem(s, rollItem(rng, ilvlRoll(rng, s, row) + ilvlBonus, rollRarity(rng, DEGREE[s.degree].rarity, min), hc.cls));
}

/** Até 3 bênçãos diferentes entre as que ainda não chegaram ao teto. */
function boonOffer(rng: Rng, b: Boons): Offer | null {
  const open = BOON_IDS.filter((id) => BOONS[id].open(b));
  const picks: BoonId[] = [];
  while (picks.length < 3 && open.length) picks.push(open.splice(rng.u32() % open.length, 1)[0]!);
  return picks.length ? { kind: "bencao", boons: picks } : null;
}

function runFight(s: RunState, hc: HeroCombat, tactics: Tactics, rng: Rng, foes: EnemyId[], foePct: number): FightRecord {
  const input: FightInput = {
    engine: GAME_ENGINE,
    seed: rng.u32(),
    hero: hc,
    hp: s.hp,
    mp: s.mp,
    potions: s.potions,
    boons: { ...s.boons },
    tactics: { order: [...tactics.order], potionAt: tactics.potionAt, healAt: tactics.healAt },
    foes,
    degree: s.degree,
    abyss: s.abyss,
    foePct,
  };
  const result = fight(input);
  s.hp = result.hp;
  s.mp = result.mp;
  s.potions = result.potions;
  s.fights++;
  s.combatMs += result.durationMs;
  for (const [k, v] of Object.entries(result.tries)) s.tries[k as SkillId] = (s.tries[k as SkillId] ?? 0) + (v ?? 0);
  const xm = xpMul(s);
  const gm = goldMul(s);
  for (const k of result.kills) {
    const e = ENEMIES[k];
    s.xp += mul(e.xp, xm);
    s.bagGold += mul(rng.int(e.gold[0], e.gold[1]), gm);
    s.kills++;
  }
  if (!result.won) s.end = "morte";
  return { input, result };
}

/**
 * Um passo da expedição: função pura (o estado de entrada não muda). O servidor
 * grava o estado novo e manda a luta, se houve, na `game.fight`.
 */
export function stepRun(state: RunState, hc: HeroCombat, tactics: Tactics, choice: RunChoice, seeds: SeedSource): StepResult {
  if (state.end) return { ok: false, error: "ended" };
  const s = structuredClone(state);
  return choice.t === "go" ? go(s, hc, tactics, choice.lane, seeds) : choose(s, hc, tactics, choice.option, seeds);
}

function go(s: RunState, hc: HeroCombat, tactics: Tactics, lane: number, seeds: SeedSource): StepResult {
  if (s.offer && s.offer.kind !== "loja") return { ok: false, error: "offer_pending" };
  if (!Number.isInteger(lane) || !reachableLanes(s).includes(lane)) return { ok: false, error: "bad_lane" };
  s.offer = null;
  s.row += 1;
  s.lane = lane;
  const row = s.row + 1;
  const node = s.map[s.row]![lane]!;
  const rng = new Rng(seeds(s.seq++));
  const gm = goldMul(s);
  let rec: FightRecord | null = null;
  switch (node.type) {
    case "combate":
    case "elite":
    case "chefe": {
      const foePct = node.type === "chefe" && s.initiation ? RULES.initiationBossPct : 100;
      rec = runFight(s, hc, tactics, rng, encounter(rng, row, node.type, s.degree), foePct);
      if (s.end) break;
      if (node.type === "elite") {
        loot(rng, s, hc, row, "incomum");
        s.offer = boonOffer(rng, s.boons);
      } else if (node.type === "chefe") {
        loot(rng, s, hc, row, "raro", 1);
        loot(rng, s, hc, row, "incomum", 1);
        s.bagGold += mul(80, gm);
        s.end = "vitoria";
      } else {
        if (rng.bp(1800)) loot(rng, s, hc, row, "comum");
        if (rng.bp(2500)) s.offer = boonOffer(rng, s.boons);
      }
      break;
    }
    case "tesouro":
      s.bagGold += mul(rng.int(15, 30), gm);
      loot(rng, s, hc, row, rng.bp(6000) ? "incomum" : "comum");
      break;
    case "loja":
      s.offer = { kind: "loja", potionPrice: Math.max(1, mul(30, gm)), boonPrice: Math.max(1, mul(90, gm)) };
      break;
    case "descanso":
      s.offer = { kind: "descanso", retreat: row >= RULES.retreatFromRow };
      break;
    case "evento":
      s.offer = { kind: "evento", event: rng.pick(EVENT_IDS), price: Math.max(1, mul(25, gm)) };
      break;
  }
  return { ok: true, state: s, fight: rec };
}

function choose(s: RunState, hc: HeroCombat, tactics: Tactics, option: number, seeds: SeedSource): StepResult {
  const offer = s.offer;
  if (!offer) return { ok: false, error: "no_offer" };
  if (!Number.isInteger(option)) return { ok: false, error: "bad_option" };
  const maxHp = maxHpWithBoons(hc, s.boons);
  let rec: FightRecord | null = null;
  switch (offer.kind) {
    case "bencao": {
      if (option === -1) break;
      const id = offer.boons[option];
      if (!id) return { ok: false, error: "bad_option" };
      BOONS[id].apply(s.boons);
      break;
    }
    case "loja": {
      if (option === -1) break;
      if (option === 0) {
        if (s.potions >= RULES.maxPotions) return { ok: false, error: "full" };
        if (s.bagGold < offer.potionPrice) return { ok: false, error: "no_gold" };
        s.bagGold -= offer.potionPrice;
        s.potions++;
        return { ok: true, state: s, fight: null }; // a loja continua aberta
      }
      if (option === 1) {
        if (s.bagGold < offer.boonPrice) return { ok: false, error: "no_gold" };
        const next = boonOffer(new Rng(seeds(s.seq++)), s.boons);
        if (!next) return { ok: false, error: "bad_option" };
        s.bagGold -= offer.boonPrice;
        s.offer = next;
        return { ok: true, state: s, fight: null };
      }
      return { ok: false, error: "bad_option" };
    }
    case "descanso":
      if (option === 0) s.hp = Math.min(maxHp, s.hp + Math.floor((maxHp * RULES.restHealPct) / 100));
      else if (option === 1) s.boons.dmgPct += RULES.sharpenPct;
      else if (option === 2 && offer.retreat) {
        s.end = "retirada";
        break;
      } else return { ok: false, error: "bad_option" };
      s.mp = hc.maxMp;
      break;
    case "evento": {
      if (option === 1 || option === -1) break;
      if (option !== 0) return { ok: false, error: "bad_option" };
      const rng = new Rng(seeds(s.seq++));
      if (offer.event === "altar") {
        s.hp = Math.max(1, s.hp - Math.floor((maxHp * 15) / 100));
        s.offer = boonOffer(rng, s.boons);
        return { ok: true, state: s, fight: null };
      }
      if (offer.event === "bau") {
        if (rng.bp(6000)) loot(rng, s, hc, s.row + 1, "incomum");
        else rec = runFight(s, hc, tactics, rng, encounter(rng, s.row + 1, "combate", s.degree), 100);
        break;
      }
      if (s.bagGold < offer.price) return { ok: false, error: "no_gold" };
      s.bagGold -= offer.price;
      s.boons.maxHpPct += 10;
      s.hp = Math.min(maxHpWithBoons(hc, s.boons), s.hp + Math.floor((maxHp * 10) / 100));
      break;
    }
  }
  s.offer = null;
  return { ok: true, state: s, fight: rec };
}

export interface RunReward {
  end: RunEnd;
  xp: number;
  tries: Partial<Record<SkillId, number>>;
  gold: number;
  items: Item[];
  kills: number;
  potions: number;
  hp: number;
  mp: number;
}

/**
 * O que fica com o herói (GDD §7.5). A experiência e as tentativas ficam sempre;
 * morrer (ou abandonar, que conta como morte) guarda metade do ouro e perde os itens.
 */
export function settleRun(s: RunState): RunReward {
  const end: RunEnd = s.end ?? "morte";
  const died = end === "morte";
  return {
    end,
    xp: s.xp,
    tries: { ...s.tries },
    gold: died ? Math.floor(s.bagGold / 2) : s.bagGold,
    items: died ? [] : s.bagItems.map((it) => structuredClone(it)),
    kills: s.kills,
    potions: s.potions,
    hp: died ? 1 : s.hp,
    mp: died ? 0 : s.mp,
  };
}
