import { type Element, type RunEvent, type RunFrame, type VocationId, MONSTER_BASE, monsterDef, abilityDef, VOCATIONS } from "@muchat/space-core/game/ot";

import { type HeroGear, isRanged } from "../render/heroArt.ts";

// A cara do herói pela arma e as cores dos elementos moram no heroArt (o mapa usa as mesmas).
export { ELEMENT_COLOR, heroGear, type HeroGear, type HeroLook, isRanged } from "../render/heroArt.ts";

/**
 * A dungeon vista de cima (docs/espaco/jogo/ot, etapa O10): a parte pura da cena. Diz onde cada
 * um fica na sala, que cara o herói tem pela arma, e como os eventos de um segundo da corrida
 * viram um roteiro de ~0,8 s (golpe, flecha, magia, cura, queda, saque). Não toca o Pixi nem o
 * DOM: roda nos testes em node.
 *
 * O servidor manda um quadro por segundo (`rpg.run.tick`); a cena anima os eventos daquele
 * segundo e termina exatamente no estado do quadro. Evento de tipo que esta versão não conhece
 * (as etapas seguintes acrescentam poção e flecha) é ignorado.
 */

export const TILE = 16;
/** A sala: 15 × 9 tiles, parede em cima, portas à esquerda e à direita na linha do meio. */
export const ROOM_W = 15;
export const ROOM_H = 9;
export const SCENE_W = ROOM_W * TILE;
export const SCENE_H = ROOM_H * TILE;
export const DOOR_ROW = 4;
/** Janela em que os eventos de um segundo passam. */
export const SECOND_MS = 800;
/** Recém-chegado na sala: os golpes esperam o grupo chegar no lugar. */
export const ENTER_DELAY_MS = 350;

/** Um ponto da sala em px de arte: o meio dos pés de quem está ali. */
export interface Spot {
  x: number;
  y: number;
}

/** Pés de quem ocupa `size` × `size` tiles a partir do tile (tx, ty). */
export function tileSpot(tx: number, ty: number, size = 1): Spot {
  return { x: tx * TILE + (size * TILE) / 2, y: (ty + size) * TILE };
}

/** Logo fora das portas (o grupo entra pela esquerda e sai pela direita). */
export const DOOR_IN: Spot = { x: -TILE / 2, y: (DOOR_ROW + 1) * TILE };
export const DOOR_OUT: Spot = { x: SCENE_W + TILE / 2, y: (DOOR_ROW + 1) * TILE };

/** Linhas com um tile de folga entre os heróis, para o nome e a barra caberem. */
const HERO_ROWS: Record<number, readonly number[]> = { 1: [4], 2: [3, 5], 3: [2, 4, 6], 4: [1, 3, 5, 7] };

/**
 * Onde cada herói fica [nosso, como na corrida]: quem bate de perto fica a um passo dos monstros
 * (coluna 7, o golpe avança até eles), o arco mais atrás (5) e a varinha um pouco mais (4). O
 * passo de folga deixa o nome do herói e o do monstro sem se cobrir.
 */
export function heroSpots(gears: readonly HeroGear[]): Spot[] {
  const rows = HERO_ROWS[gears.length];
  return gears.map((g, i) => {
    const col = g.look === "varinha" || g.look === "cajado" ? 4 : isRanged(g.look) ? 5 : 7;
    const row = rows ? rows[i]! : 1 + (i % 7);
    return tileSpot(col, row);
  });
}

const BOSS_TILE = { x: 11, y: 3 } as const;
/** Lugares dos monstros, do mais à frente para trás, com folga para o nome. */
const SLOTS: readonly (readonly [number, number])[] = [
  [9, 4], [9, 2], [9, 6], [11, 3], [11, 5], [11, 1], [11, 7], [13, 4], [13, 2], [13, 6],
  [10, 3], [10, 5], [12, 2], [12, 6], [10, 1], [10, 7], [12, 4], [13, 1], [13, 7], [9, 1],
  [9, 7], [9, 3], [9, 5], [11, 2], [11, 4], [11, 6], [13, 3], [13, 5], [12, 1], [12, 7],
];

function underBoss(tx: number, ty: number) {
  return tx >= BOSS_TILE.x && tx <= BOSS_TILE.x + 1 && ty >= BOSS_TILE.y && ty <= BOSS_TILE.y + 1;
}

export interface MonsterSpot extends Spot {
  /** Tiles de lado: o chefe ocupa 2 × 2. */
  size: number;
}

/**
 * Onde cada monstro da sala fica, na ordem da corrida (o primeiro vivo é o alvo do grupo, então
 * fica na frente). O primeiro chefe vai para o fundo, em 2 × 2. Monstro a mais que os lugares
 * repete os lugares com um passo de lado.
 */
export function monsterSpots(ids: readonly (string | undefined)[]): MonsterSpot[] {
  const bossAt = ids.findIndex((id) => !!id && monsterDef(id)?.boss);
  const free = SLOTS.filter(([x, y]) => bossAt < 0 || !underBoss(x, y));
  let n = 0;
  return ids.map((id, i) => {
    if (i === bossAt) return { ...tileSpot(BOSS_TILE.x, BOSS_TILE.y, 2), size: 2 };
    const boss = !!id && !!monsterDef(id)?.boss;
    const k = n++;
    const [tx, ty] = free[k % free.length]!;
    const lap = Math.floor(k / free.length);
    const s = tileSpot(tx, ty);
    return { x: s.x + lap * 4, y: s.y, size: boss ? 2 : 1 };
  });
}

/** Moedas caem como moedas, não como saco: "moedas" hoje, "moeda-de-ouro/platina/cristal" na O7. */
export function isCoins(item: string): boolean {
  return item.startsWith("moeda");
}

const ELEMENTS = new Set<string>(["fisico", "fogo", "gelo", "energia", "terra", "morte", "sagrado"]);
const isElement = (s: string): s is Element => ELEMENTS.has(s);

export type Shot = "flecha" | "virote" | "orbe" | "lanca";
/** "mana": poção de mana (o número sobe em azul; a vida não muda). */
export type HitHow = "dano" | "cura" | "mana" | "bloqueio" | "erro" | "imune";

/** Um passo do roteiro, `at` ms depois do começo do segundo. Atores como nos eventos: herói 0–3, monstro 100+. */
export type Cue =
  | { k: "lunge"; at: number; who: number; to: number }
  | { k: "shot"; at: number; dur: number; from: number; to: number; shot: Shot; el: Element }
  | { k: "hit"; at: number; who: number; v: number; el: Element | "cura" | "mana"; how: HitHow }
  | { k: "burst"; at: number; who: number; el: Element }
  | { k: "slash"; at: number; who: number; el: Element }
  | { k: "die"; at: number; who: number }
  | { k: "fall"; at: number; who: number }
  | { k: "loot"; at: number; on: number; coins: boolean };

export interface PlanInput {
  /** Os eventos do segundo, como vieram (tipos desconhecidos passam batido). */
  events: readonly { k: string }[];
  gears: readonly HeroGear[];
  vocations: readonly VocationId[];
  /** Os monstros da sala na ordem da corrida (para achar o elemento do ataque). */
  monsters: readonly (string | undefined)[];
  /** O grupo acabou de chegar: tudo começa depois disto. */
  delay?: number;
}

export interface Plan {
  cues: Cue[];
  /** Quando o último golpe, queda ou saque acabou de passar. */
  end: number;
}

const MELEE_LAND = 90;
const SHOT_MS = 190;
const SPELL_MS = 210;
/** Folga no fim da janela para o último tiro chegar e o corpo cair. */
const TAIL = 330;
const MAX_STEP = 160;

function howOf(bl: string, v: number): HitHow {
  if (bl === "erro") return "erro";
  if (v > 0) return "dano";
  return bl === "immunity" ? "imune" : "bloqueio";
}

/**
 * O roteiro de um segundo. As ações (golpes e magias) se espalham na janela na ordem em que a
 * simulação as fez; o ataque em área de um monstro sai de uma vez em todos. A queda e o abate
 * esperam o golpe que matou chegar; o saque cai no último corpo do segundo.
 */
export function planSecond(p: PlanInput): Plan {
  const start = Math.max(0, p.delay ?? 0);
  const actions = p.events.filter((e) => e.k === "golpe" || e.k === "magia" || e.k === "pocao" || e.k === "desafio").length;
  const span = Math.max(0, SECOND_MS - start - TAIL);
  const step = actions > 1 ? Math.min(MAX_STEP, span / (actions - 1)) : 0;
  const cues: Cue[] = [];
  const landed = new Map<number, number>();
  let j = 0;
  let area = null as { key: string; t: number } | null;
  let corpse: { who: number; at: number } | null = null;
  let end = start;
  const push = (c: Cue, dur = 0) => {
    cues.push(c);
    end = Math.max(end, c.at + dur);
  };
  const nextT = () => Math.round(start + j++ * step);
  const hit = (who: number, at: number, v: number, el: Element | "cura" | "mana", how: HitHow) => {
    push({ k: "hit", at, who, v, el, how }, 120);
    if (how !== "cura" && how !== "mana") landed.set(who, at);
  };

  for (const raw of p.events) {
    if (raw.k === "deixado") {
      // Etapa O7: o que não coube em ninguém fica no corpo (o saco aparece nele do mesmo jeito).
      const item = (raw as { item?: unknown }).item;
      if (corpse) push({ k: "loot", at: corpse.at + 100, on: corpse.who, coins: typeof item === "string" && isCoins(item) }, 150);
      continue;
    }
    const e = raw as RunEvent;
    switch (e.k) {
      case "golpe": {
        area = null;
        const t = nextT();
        const g = e.a < MONSTER_BASE ? p.gears[e.a] : undefined;
        const how = howOf(e.bl, e.v);
        if (g && (g.look === "arco" || g.look === "besta")) {
          push({ k: "shot", at: t, dur: SHOT_MS, from: e.a, to: e.b, shot: g.look === "besta" ? "virote" : "flecha", el: "fisico" }, SHOT_MS);
          hit(e.b, t + SHOT_MS, e.v, "fisico", how);
        } else if (g && (g.look === "varinha" || g.look === "cajado")) {
          push({ k: "shot", at: t, dur: SHOT_MS, from: e.a, to: e.b, shot: "orbe", el: g.element }, SHOT_MS);
          hit(e.b, t + SHOT_MS, e.v, g.element, how);
          if (how === "dano") push({ k: "burst", at: t + SHOT_MS, who: e.b, el: g.element }, 200);
        } else {
          push({ k: "lunge", at: t, who: e.a, to: e.b }, 140);
          hit(e.b, t + MELEE_LAND, e.v, "fisico", how);
        }
        break;
      }
      case "magia": {
        if (e.cura) {
          area = null;
          hit(e.b, nextT() + 60, e.v, "cura", "cura");
          break;
        }
        if (e.a < MONSTER_BASE) {
          area = null;
          const t = nextT();
          // Reforço no próprio herói (a Concentração do arqueiro, 24/11/2026): um brilho, sem dano.
          if (e.b < MONSTER_BASE) {
            push({ k: "burst", at: t, who: e.a, el: "sagrado" }, 200);
            break;
          }
          const sp = abilityDef(e.s);
          const el: Element = sp && sp.element !== "cura" ? sp.element : "fisico";
          const how = howOf("none", e.v);
          const base = p.vocations[e.a] !== undefined ? VOCATIONS[p.vocations[e.a]!]?.base : undefined;
          if (el === "fisico" && base === 4) {
            // Golpe de arma do cavaleiro: corte no alvo, de perto.
            push({ k: "lunge", at: t, who: e.a, to: e.b }, 140);
            push({ k: "slash", at: t + MELEE_LAND, who: e.b, el }, 200);
            hit(e.b, t + MELEE_LAND, e.v, el, how);
          } else {
            push({ k: "shot", at: t, dur: SPELL_MS, from: e.a, to: e.b, shot: el === "fisico" ? (base === 3 ? "flecha" : "lanca") : "orbe", el }, SPELL_MS);
            push({ k: "burst", at: t + SPELL_MS, who: e.b, el }, 200);
            hit(e.b, t + SPELL_MS, e.v, el, how);
          }
          break;
        }
        // Magia de monstro: o elemento sai da ficha do ataque pelo nome (ou o próprio nome é o elemento).
        const id = p.monsters[e.a - MONSTER_BASE];
        const at = id ? monsterDef(id)?.attacks.find((x) => (x.name ?? x.element) === e.s) : undefined;
        const el: Element = at?.element ?? (isElement(e.s) ? e.s : "fisico");
        const how = howOf("none", e.v);
        if (at?.area) {
          const key = `${e.a}|${e.s}`;
          if (area?.key !== key) area = { key, t: nextT() };
          push({ k: "burst", at: area.t + 120, who: e.b, el }, 200);
          hit(e.b, area.t + 120, e.v, el, how);
          break;
        }
        area = null;
        const t = nextT();
        push({ k: "shot", at: t, dur: SPELL_MS, from: e.a, to: e.b, shot: "orbe", el }, SPELL_MS);
        push({ k: "burst", at: t + SPELL_MS, who: e.b, el }, 200);
        hit(e.b, t + SPELL_MS, e.v, el, how);
        break;
      }
      case "pocao": {
        // Etapa O9: a poção bebida sozinha. Vida sobe em verde, mana em azul.
        area = null;
        const t = nextT();
        if (e.mana) hit(e.a, t + 60, e.v, "mana", "mana");
        else hit(e.a, t + 60, e.v, "cura", "cura");
        break;
      }
      case "desafio": {
        // O Desafio do cavaleiro promovido: os monstros viram para ele (um brilho nele).
        area = null;
        push({ k: "burst", at: nextT(), who: e.a, el: "sagrado" }, 200);
        break;
      }
      case "abate": {
        const at = (landed.get(e.b) ?? Math.round(start + j * step)) + 30;
        push({ k: "die", at, who: e.b }, 200);
        corpse = { who: e.b, at };
        break;
      }
      case "queda": {
        const at = (landed.get(e.b) ?? Math.round(start + j * step)) + 30;
        push({ k: "fall", at, who: e.b }, 200);
        break;
      }
      case "loot": {
        if (corpse) push({ k: "loot", at: corpse.at + 100, on: corpse.who, coins: isCoins(e.item) }, 150);
        break;
      }
      default:
        // "sala": a cena troca a sala antes do roteiro. Outros: tipos que esta versão não conhece.
        break;
    }
  }
  cues.sort((a, b) => a.at - b.at);
  return { cues, end };
}

/** Vida mostrada depois de um passo do roteiro (a cena fecha o segundo com a vida do quadro). */
export function afterHit(hp: number, max: number, c: { v: number; how: HitHow }): number {
  if (c.how === "cura") return Math.min(max, hp + c.v);
  if (c.how === "dano") return Math.max(0, hp - c.v);
  return hp;
}

export type FrameStep = "reset" | "animate" | "same" | "snap";

/**
 * O que fazer com o quadro que chegou: outra corrida (ou a primeira) começa do estado, sem
 * animar; o segundo seguinte anima; o mesmo segundo de novo (o servidor reenviou o estado ao
 * voltar) não faz nada; um pulo para frente anima só o último segundo, por cima do estado.
 */
export function frameStep(prev: { run: string; s: number } | null, run: string, s: number): FrameStep {
  if (!prev || prev.run !== run) return "reset";
  if (s === prev.s) return "same";
  if (s > prev.s) return "animate";
  return "snap";
}

/** A sala acabou e há outra depois: hora do grupo andar até a porta. */
export function roomCleared(frame: Pick<RunFrame, "st" | "x">, stages: number): boolean {
  return frame.x.length > 0 && frame.x.every((v) => v <= 0) && frame.st < stages - 1;
}

/** O nome cabe na largura; senão corta em palavra (ou letra) com reticências. */
export function fitName(name: string, maxW: number, measure: (s: string) => number): string {
  if (measure(name) <= maxW) return name;
  const words = name.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const s = `${words.slice(0, n).join(" ")}…`;
    if (measure(s) <= maxW) return s;
  }
  for (let n = name.length - 1; n >= 1; n--) {
    const s = `${name.slice(0, n).trimEnd()}…`;
    if (measure(s) <= maxW) return s;
  }
  return "…";
}
