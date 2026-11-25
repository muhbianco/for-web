import {
  type ClassId,
  type EnemyInput,
  type Family,
  type FightEvent,
  type RunFrame,
  FOE_BASE,
  createMonsters,
  dungeonById,
  dungeonRooms,
  skillOf,
} from "@muchat/space-core/game/ot/balance";

import { type Element, type HeroGear, isRanged } from "../render/heroArt.ts";

// A cara do herói pela arma e as cores dos elementos moram no heroArt (o mapa usa as mesmas).
export { ELEMENT_COLOR, heroGear, type HeroGear, type HeroLook, isRanged } from "../render/heroArt.ts";

/**
 * A dungeon vista de cima (Idle Hunt v5): a parte pura da cena. Diz onde cada um fica na sala, que
 * monstro é cada inimigo (a arte pela família, pelo arquétipo e pela região) e como os eventos de um
 * segundo da corrida viram um roteiro de ~0,8 s (golpe, tiro, magia, cura, mecânica, queda). Não
 * toca o Pixi nem o DOM: roda nos testes em node.
 *
 * O servidor manda um quadro por segundo (`rpg.run.tick`); a cena anima os eventos daquele
 * segundo e termina exatamente no estado do quadro. Evento que esta versão não conhece passa batido.
 */

export const TILE = 16;
/** A sala: 15 × 9 tiles, parede em cima, portas à esquerda e à direita na linha do meio. */
export const ROOM_W = 15;
export const ROOM_H = 9;
export const SCENE_W = ROOM_W * TILE;
export const SCENE_H = ROOM_H * TILE;
export const DOOR_ROW = 4;
/** As 4 salas de toda DG (§12.1): 3 de monstros e a do chefe. */
export const ROOMS = 4;
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
 * Onde cada herói fica: quem bate de perto fica a um passo dos monstros (coluna 7, o golpe avança
 * até eles), o arco mais atrás (5) e a magia um pouco mais (4).
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
 * (os invocados) repete os lugares com um passo de lado.
 */
export function monsterSpots(bosses: readonly boolean[]): MonsterSpot[] {
  const bossAt = bosses.findIndex((b) => b);
  const free = SLOTS.filter(([x, y]) => bossAt < 0 || !underBoss(x, y));
  let n = 0;
  return bosses.map((boss, i) => {
    if (i === bossAt) return { ...tileSpot(BOSS_TILE.x, BOSS_TILE.y, 2), size: 2 };
    const k = n++;
    const [tx, ty] = free[k % free.length]!;
    const lap = Math.floor(k / free.length);
    const s = tileSpot(tx, ty);
    return { x: s.x + lap * 4, y: s.y, size: boss ? 2 : 1 };
  });
}

// ---- o elenco de cada sala --------------------------------------------------------

/** Um inimigo como a cena desenha: a arte (um desenho da casa), o nome e a vida cheia. */
export interface Foe {
  art: string;
  boss: boolean;
  name: string;
  hp: number;
  level: number;
  magic: boolean;
}

const BOSSES = new Set(["chefeMenor", "chefe", "regional"]);

/**
 * A arte de cada família (§11.2) com os desenhos que existem (render/game/art.ts): lacaios variam
 * no rodízio, a elite tem a sua, e a região escolhe o chefe e os elementais (pedra, gelo, fogo).
 */
const FAMILY_ART: Record<Family, { minion: string[]; elite: string }> = {
  fera: { minion: ["javali-bravo", "lobo-cinzento", "rato-do-musgo"], elite: "lobo-cinzento" },
  humanoide: { minion: ["cacador-da-toca"], elite: "cavaleiro-de-cinzas" },
  "morto-vivo": { minion: ["ossada-inquieta", "morcego-da-cripta"], elite: "mineiro-espectral" },
  sombrio: { minion: ["sombra-vazia", "morcego-vampiro"], elite: "arauto-do-vazio" },
  elemental: { minion: ["golem-de-carvao", "caranguejo-de-pedra"], elite: "automato-de-ferro" },
  dragao: { minion: ["serpente-da-comporta"], elite: "demonio-menor" },
  aberracao: { minion: ["aranha-tecela", "larva-gigante", "aranha-saltadora"], elite: "troll-do-lodo" },
};
const ELEMENTAL_BY_REGION: Record<number, { minion: string[]; elite: string }> = {
  5: { minion: ["espirito-da-nevasca"], elite: "gigante-de-gelo" },
  6: { minion: ["brasa-viva"], elite: "demonio-menor" },
};
const FERA_BY_REGION: Record<number, string[]> = { 5: ["lobo-glacial"], 9: ["harpia-de-granito"] };
/** O chefe de cada região (os desenhos grandes, 32 px). */
const BOSS_ART: Record<number, string> = {
  1: "rei-javali",
  2: "matriarca-do-musgo",
  3: "guardiao-da-forja",
  4: "medusa-ancia",
  5: "wyrm-de-gelo",
  6: "senhor-das-cinzas",
  7: "rei-das-comportas",
  8: "capataz-espectral",
  9: "rainha-aranha",
  10: "imperador-do-vazio",
};

const ARCH_NAME: Record<string, string> = {
  lacaio: "Lacaio",
  elite: "Elite",
  chefeMenor: "Chefe",
  chefe: "Chefe da masmorra",
  regional: "Chefe de Região",
};

const FAMILY_NAME: Record<Family, string> = {
  fera: "fera",
  humanoide: "humanoide",
  "morto-vivo": "morto-vivo",
  sombrio: "sombrio",
  elemental: "elemental",
  dragao: "dragão",
  aberracao: "aberração",
};

/** A arte de um inimigo da DG numa região (o `k` gira os lacaios). */
export function foeArt(e: Pick<EnemyInput, "archetype" | "family">, region: number, k: number): string {
  if (BOSSES.has(e.archetype)) return BOSS_ART[region] ?? "rei-javali";
  const fam = e.family ?? "fera";
  const base =
    fam === "elemental"
      ? (ELEMENTAL_BY_REGION[region] ?? FAMILY_ART.elemental)
      : fam === "fera" && FERA_BY_REGION[region]
        ? { minion: FERA_BY_REGION[region]!, elite: FAMILY_ART.fera.elite }
        : FAMILY_ART[fam];
  return e.archetype === "elite" ? base.elite : base.minion[k % base.minion.length]!;
}

let monsters: ReturnType<typeof createMonsters> | null = null;

/** O elenco das 4 salas da DG para um grupo de `members` (determinístico, como no servidor). */
export function roomFoes(dungeon: string, members: number): Foe[][] {
  const d = dungeonById(dungeon);
  if (!d) return [];
  monsters ??= createMonsters();
  const rooms = dungeonRooms(d, members, monsters);
  let k = 0;
  return rooms.map((list) =>
    list.map((e) => {
      const boss = BOSSES.has(e.archetype);
      const name =
        e.archetype === "regional"
          ? d.region.bossName
          : boss
            ? (ARCH_NAME[e.archetype] ?? "Chefe")
            : `${ARCH_NAME[e.archetype] ?? "Lacaio"} ${FAMILY_NAME[e.family ?? "fera"]}`;
      return { art: foeArt(e, d.region.index, k++), boss, name, hp: e.hp, level: e.level, magic: !!e.magicAuto };
    }),
  );
}

/** Um inimigo invocado pelo chefe (fora do elenco): lacaio da família do chefe. */
export function summonedFoe(dungeon: string): Foe {
  const d = dungeonById(dungeon);
  const fam = d?.region.families[0] ?? "fera";
  return { art: foeArt({ archetype: "lacaio", family: fam }, d?.region.index ?? 1, 0), boss: false, name: "Lacaio invocado", hp: 1, level: d?.level ?? 1, magic: false };
}

// ---- o roteiro de um segundo -------------------------------------------------------

export type Shot = "flecha" | "virote" | "orbe" | "lanca";
/** "mana": poção de mana (o número sobe em azul; a vida não muda). */
export type HitHow = "dano" | "cura" | "mana" | "bloqueio" | "erro" | "imune";

/** Um passo do roteiro, `at` ms depois do começo do segundo. Atores como nos eventos: herói 0–3, inimigo 100+. */
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
  classes: readonly ClassId[];
  /** Os inimigos da sala na ordem da corrida (ataque mágico ou não). */
  foes: readonly { magic: boolean }[];
  /** O grupo acabou de chegar: tudo começa depois disto. */
  delay?: number;
}

export interface Plan {
  cues: Cue[];
  /** Quando o último golpe ou queda acabou de passar. */
  end: number;
}

const MELEE_LAND = 90;
const SHOT_MS = 190;
const SPELL_MS = 210;
/** Folga no fim da janela para o último tiro chegar e o corpo cair. */
const TAIL = 330;
const MAX_STEP = 160;

/** A cor da magia de cada classe (o dano mágico do v5 não tem elemento: é o da classe). */
const MAGIC_OF_CLASS: Partial<Record<ClassId, Element>> = {
  mago: "fogo",
  druida: "terra",
  padre: "sagrado",
  paladino: "sagrado",
};

/** O elemento do dano de uma skill de herói: físico, sagrado ou a magia da classe. */
function skillElement(cls: ClassId | undefined, skill: string): Element {
  const s = cls ? skillOf(cls, skill) : undefined;
  for (const e of s?.effects ?? [])
    if (e.type === "dano" || e.type === "dot") {
      const el = e.type === "dano" ? e.parts[0]?.element : e.element;
      if (el === "sagrado") return "sagrado";
      if (el === "magico") return (cls && MAGIC_OF_CLASS[cls]) ?? "energia";
      return "fisico";
    }
  return (cls && MAGIC_OF_CLASS[cls]) ?? "energia";
}

/** As mecânicas que caem em todos de uma vez (§12.3). */
const AREA = new Set(["pulso", "cataclismo", "fase-final"]);

/**
 * O roteiro de um segundo. As ações (golpes, magias, poções) se espalham na janela na ordem em
 * que a simulação as fez; o ataque em área do chefe sai de uma vez em todos. A queda e o abate
 * esperam o golpe que matou chegar.
 */
export function planSecond(p: PlanInput): Plan {
  const start = Math.max(0, p.delay ?? 0);
  const actions = p.events.filter((e) => e.k === "golpe" || e.k === "magia" || e.k === "pocao").length;
  const span = Math.max(0, SECOND_MS - start - TAIL);
  const step = actions > 1 ? Math.min(MAX_STEP, span / (actions - 1)) : 0;
  const cues: Cue[] = [];
  const landed = new Map<number, number>();
  let j = 0;
  let area = null as { key: string; t: number } | null;
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
    const e = raw as FightEvent;
    switch (e.k) {
      case "golpe": {
        area = null;
        const t = nextT();
        const how: HitHow = e.bl === "erro" ? "erro" : e.bl === "bloqueio" ? "bloqueio" : e.v > 0 ? "dano" : "imune";
        if (e.a >= FOE_BASE) {
          if (p.foes[e.a - FOE_BASE]?.magic) {
            push({ k: "shot", at: t, dur: SPELL_MS, from: e.a, to: e.b, shot: "orbe", el: "morte" }, SPELL_MS);
            hit(e.b, t + SPELL_MS, e.v, "morte", how);
          } else {
            push({ k: "lunge", at: t, who: e.a, to: e.b }, 140);
            hit(e.b, t + MELEE_LAND, e.v, "fisico", how);
          }
          break;
        }
        const g = p.gears[e.a];
        if (g && (g.look === "arco" || g.look === "besta")) {
          push({ k: "shot", at: t, dur: SHOT_MS, from: e.a, to: e.b, shot: g.look === "besta" ? "virote" : "flecha", el: "fisico" }, SHOT_MS);
          hit(e.b, t + SHOT_MS, e.v, "fisico", how);
        } else if (g && (g.look === "varinha" || g.look === "cajado")) {
          const el = MAGIC_OF_CLASS[p.classes[e.a]!] ?? g.element;
          push({ k: "shot", at: t, dur: SHOT_MS, from: e.a, to: e.b, shot: "orbe", el }, SHOT_MS);
          hit(e.b, t + SHOT_MS, e.v, el, how);
          if (how === "dano") push({ k: "burst", at: t + SHOT_MS, who: e.b, el }, 200);
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
        if (e.a < FOE_BASE) {
          area = null;
          const t = nextT();
          // Skill num aliado sem cura (escudo, reforço): um brilho, sem dano.
          if (e.b < FOE_BASE) {
            push({ k: "burst", at: t, who: e.b, el: "sagrado" }, 200);
            break;
          }
          const cls = p.classes[e.a];
          const el = skillElement(cls, e.s);
          const melee = !isRanged(p.gears[e.a]?.look ?? "punhos");
          if (el === "fisico" && melee) {
            push({ k: "lunge", at: t, who: e.a, to: e.b }, 140);
            push({ k: "slash", at: t + MELEE_LAND, who: e.b, el }, 200);
            hit(e.b, t + MELEE_LAND, e.v, el, "dano");
          } else {
            const shot: Shot = el === "fisico" ? (cls === "cacador" ? "flecha" : "lanca") : "orbe";
            push({ k: "shot", at: t, dur: SPELL_MS, from: e.a, to: e.b, shot, el }, SPELL_MS);
            push({ k: "burst", at: t + SPELL_MS, who: e.b, el }, 200);
            hit(e.b, t + SPELL_MS, e.v, el, "dano");
          }
          break;
        }
        // Mecânica do chefe (§12.3): em área (Pulso, Cataclismo) sai de uma vez em todos.
        if (AREA.has(e.s)) {
          const el: Element = e.s === "cataclismo" ? "fogo" : "morte";
          const key = `${e.a}|${e.s}`;
          if (area?.key !== key) area = { key, t: nextT() };
          push({ k: "burst", at: area.t + 120, who: e.b, el }, 200);
          hit(e.b, area.t + 120, e.v, el, "dano");
          break;
        }
        area = null;
        const t = nextT();
        if (e.s === "golpe-pesado" || e.s === "investida") {
          push({ k: "lunge", at: t, who: e.a, to: e.b }, 140);
          push({ k: "slash", at: t + MELEE_LAND, who: e.b, el: "fisico" }, 200);
          hit(e.b, t + MELEE_LAND, e.v, "fisico", "dano");
        } else {
          push({ k: "shot", at: t, dur: SPELL_MS, from: e.a, to: e.b, shot: "orbe", el: "morte" }, SPELL_MS);
          push({ k: "burst", at: t + SPELL_MS, who: e.b, el: "morte" }, 200);
          hit(e.b, t + SPELL_MS, e.v, "morte", "dano");
        }
        break;
      }
      case "pocao": {
        area = null;
        const t = nextT();
        if (e.mana) hit(e.a, t + 60, e.v, "mana", "mana");
        else hit(e.a, t + 60, e.v, "cura", "cura");
        break;
      }
      case "mecanica":
        // O chefe anuncia (a tela escreve qual): um brilho escuro nele.
        push({ k: "burst", at: Math.round(start + j * step), who: e.a, el: "morte" }, 200);
        break;
      case "cataclismo":
        // O buff do chefe que cresce (D24): uma chama nele a cada marca.
        push({ k: "burst", at: Math.round(start + j * step), who: e.a, el: "fogo" }, 200);
        break;
      case "abate": {
        const at = (landed.get(e.b) ?? Math.round(start + j * step)) + 30;
        push({ k: "die", at, who: e.b }, 200);
        break;
      }
      case "queda": {
        const at = (landed.get(e.b) ?? Math.round(start + j * step)) + 30;
        push({ k: "fall", at, who: e.b }, 200);
        break;
      }
      default:
        // "sala" e "descanso": a cena troca a sala antes do roteiro. "lanca": a skill saiu (o dano vem na magia).
        break;
    }
  }
  cues.sort((a, b) => a.at - b.at);
  return { cues, end };
}

/** Vida mostrada depois de um passo do roteiro (a cena fecha o segundo com a vida do quadro). */
export function afterHit(hp: number, max: number, c: { v: number; how: HitHow }): number {
  if (c.how === "cura") return Math.min(max, hp + c.v);
  if (c.how === "dano" || c.how === "bloqueio") return Math.max(0, hp - c.v);
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
export function roomCleared(frame: Pick<RunFrame, "st" | "x">, stages = ROOMS): boolean {
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
