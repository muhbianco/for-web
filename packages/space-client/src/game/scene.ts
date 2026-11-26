import type { AvatarGear } from "@muchat/space-core";
import { type ClassId, FOE_BASE, type RunFrame } from "@muchat/space-core/game/ot/balance";
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import { RENDERER_DESTROY } from "../render/renderer.ts";
import { STATUS_COLOR, statusGood, statusTone } from "../status.ts";
import { type FxArt, fxCanvas, gearKey } from "../render/heroArt.ts";
import { corpseCanvas, equippedFrames, fallenCanvas, monsterCanvas, monsterSize, roomCanvas } from "./art.ts";
import {
  afterHit,
  type Cue,
  DOOR_IN,
  DOOR_OUT,
  ELEMENT_COLOR,
  ENTER_DELAY_MS,
  fitName,
  frameStep,
  heroGear,
  type HeroGear,
  heroSpots,
  type Foe,
  monsterSpots,
  ROOMS,
  roomFoes,
  summonedFoe,
  type Plan,
  planSecond,
  roomCleared,
  SCENE_H,
  SCENE_W,
  type Spot,
  TILE,
  damageColor,
  BEAM_MS,
  CAST_MS,
  DROP_MS,
  RAIN_MS,
  SPIN_MS,
} from "./script.ts";
import { type LingerFx, castFx, lingersOf } from "./skillFx.ts";

/**
 * A dungeon vista de cima na tela da aventura (docs/espaco/jogo/ot, etapa O10). Uma Application
 * do Pixi só dela, como a cena do Refúgio (ADR 0009):
 * - desenha sob demanda: chega um segundo da corrida, anima ~0,8 s a no máximo 30 quadros/s e
 *   para; parada, não desenha nada;
 * - com a aba escondida não anima (o navegador não chama o requestAnimationFrame) e, ao voltar,
 *   pula para o estado do último quadro;
 * - "reduzir movimento": sem golpe, tiro, número subindo ou caminhada; um desenho por segundo;
 * - destrói só o que criou (RENDERER_DESTROY e as próprias texturas): o mapa do Espaço vive na
 *   mesma página e usa o pool global de batches do Pixi (o defeito de 14/11/2026).
 */

export const SCENE_MAX_FPS = 30;
const MAX_RESOLUTION = 2;
const FLOATER_MAX = 24;
/** O que sobe quando o golpe não entra inteiro (o jogo é em português; a cena não usa o lingui). */
export const MISS_WORDS = { missed: "errou", dodged: "esquivou", blocked: "bloq." };
const MISS_COLOR = 0xc9c3b8;
const DODGE_COLOR = 0x9fd8ff;
const BLOCK_COLOR = 0xb9c6d6;

const FLOAT_MS = 700;
const WALK_OUT_MS = 750;
/** Um herói sai um pouco depois do outro. */
const WALK_GAP_MS = 60;
const WALK_IN_MS = 800;
const FADE_MS = 180;
const STEP_MS = 140;
const LUNGE_MS = 140;
const DIE_MS = 220;
const POP_MS = 200;

export interface DungeonMember {
  userId: string;
  name: string;
  cls: ClassId;
  healthMax: number;
  /** Paleta do avatar da pessoa no Espaço (render/sprites.ts). */
  palette: number;
  /** O que o avatar mostra, no formato do mapa (hero.ts avatarGearOf: família e peso). */
  gear: AvatarGear;
}

export interface DungeonRun {
  id: string;
  dungeon: string;
  members: readonly DungeonMember[];
}

export interface DungeonSceneOptions {
  reducedMotion?: boolean;
  /** Quem está olhando: o nome dele sai em destaque. */
  me?: string | null;
}

interface Unit {
  ref: number;
  hero: boolean;
  me: boolean;
  boss: boolean;
  sprite: Sprite;
  frames: Texture[];
  size: number;
  label: Text;
  fullName: string;
  home: Spot;
  pos: Spot;
  hp: number;
  max: number;
  alive: boolean;
  /** Herói que caiu numa sala anterior: fica fora da cena. */
  gone: boolean;
  walk: { from: Spot; to: Spot; t0: number; dur: number } | null;
  lunge: { t0: number; dx: number; dy: number } | null;
  flashUntil: number;
  dying: number;
  corpse: Texture | null;
  loot: Sprite[];
}

type FxKind = "shot" | "burst" | "spark" | "puff" | "slash" | "pop" | "spin" | "fall" | "beam" | "bloom" | "ring";

/** Teto de efeitos de uma vez (os de skill param de nascer acima dele; celular e grupo de 5). */
const FX_MAX = 140;

/** Um efeito que dura (a nuvem, o círculo, o gelo, a bolha) preso a um herói ou monstro. */
interface Linger {
  s: Sprite;
  ref: number;
  fx: LingerFx;
}
interface Fx {
  s: Sprite;
  kind: FxKind;
  t0: number;
  dur: number;
  from: Spot;
  to: Spot;
}

interface Floater {
  t: Text;
  t0: number;
  x: number;
  y: number;
}

/** Cede ao laço de eventos: o que vem depois roda numa tarefa nova. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class DungeonScene {
  /** Quadros desenhados por todas as cenas da página (o laboratório de voz mede por aqui). */
  static drawn = 0;
  readonly app = new Application();
  private readonly root = new Container();
  private readonly floor = new Sprite();
  private readonly corpses = new Container();
  private readonly units = new Container();
  private readonly fxLayer = new Container();
  /** Efeitos no chão (o círculo da Consagração), embaixo das unidades. */
  private readonly groundFx = new Container();
  /** Efeitos que duram por cima das unidades (nuvem, gelo, bolha). */
  private readonly aura = new Container();
  private lingers = new Map<string, Linger>();
  private readonly fade = new Graphics();
  private readonly ui = new Container();
  private readonly bars = new Graphics();
  private readonly owned: Texture[] = [];
  private readonly textures = new Map<string, Texture>();
  private heroes: Unit[] = [];
  private monsters: Unit[] = [];
  private foes: Foe[] = [];
  private gears: HeroGear[] = [];
  private fx: Fx[] = [];
  private readonly fxPool: Sprite[] = [];
  private floaters: Floater[] = [];
  private readonly floaterPool: Text[] = [];
  private run: DungeonRun | null = null;
  private last: { run: string; s: number } | null = null;
  private frame: RunFrame | null = null;
  private shownSt = -1;
  private plan: Plan | null = null;
  private cueAt = 0;
  private planT0 = 0;
  private trans: { phase: "out" | "fade" | "in"; t0: number; next: number } | null = null;
  private ended: string | null = null;
  private host: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private raf = 0;
  private frames = 0;
  private lastDraw = 0;
  private destroyed = false;
  private scale = 1;
  private fontPx = 10;
  private me: string | null = null;
  private reduced = false;

  static async mount(host: HTMLElement, opts: DungeonSceneOptions = {}): Promise<DungeonScene> {
    const s = new DungeonScene();
    s.reduced = opts.reducedMotion ?? false;
    s.me = opts.me ?? null;
    try {
      await s.init(host);
    } catch (err) {
      s.destroy();
      throw err;
    }
    return s;
  }

  /** Quadros desenhados desde que a cena nasceu (a prova do "nada por quadro parado"). */
  get frameCount(): number {
    return this.frames;
  }

  /** Há animação em curso (o laço de quadros está rodando). */
  get animating(): boolean {
    return this.raf !== 0;
  }

  private async init(host: HTMLElement) {
    // O contexto WebGL numa tarefa própria: criá-lo custou ~30 ms no laboratório, e somado ao init
    // do Pixi (na mesma tarefa da mensagem que abre o painel) passava dos 50 ms de tarefa longa.
    // Os atributos são os que o Pixi pediria; sem WebGL2, o Pixi cria o contexto sozinho.
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: true, antialias: false, stencil: true, preserveDrawingBuffer: false, powerPreference: "default" });
    await nextTask();
    const ready = this.app.init({
      canvas,
      ...(context ? { context } : {}),
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      background: "#0f1015",
      antialias: false,
      autoDensity: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, MAX_RESOLUTION),
      roundPixels: true,
      autoStart: false,
    });
    try {
      await ready;
    } catch (err) {
      // O Pixi não chegou a adotar o contexto: solta aqui, senão ele fica preso até o GC.
      context?.getExtension("WEBGL_lose_context")?.loseContext();
      throw err;
    }
    // Quem desenha é o tick() desta cena, e só quando algo mudou.
    this.app.ticker.stop();
    this.app.ticker.remove(this.app.render, this.app);
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.canvas.style.display = "block";
    // Aquecimento numa tarefa própria: o primeiro desenho de um contexto novo compila os shaders do
    // Pixi (o primeiro quadro da corrida levava 37 ms no laboratório). Um desenho de 1 px faz isso
    // aqui, e o primeiro quadro da corrida só sobe as texturas.
    await nextTask();
    const warm = new Container();
    warm.addChild(new Sprite(Texture.WHITE), new Graphics().rect(0, 0, 1, 1).fill({ color: 0xffffff }));
    this.app.stage.addChild(warm);
    this.app.render();
    warm.destroy({ children: true });
    host.appendChild(this.app.canvas);
    this.host = host;
    this.units.sortableChildren = true;
    this.fade.rect(0, 0, SCENE_W, SCENE_H).fill({ color: 0x0b0b0f });
    this.fade.alpha = 0;
    this.root.addChild(this.floor, this.groundFx, this.corpses, this.units, this.aura, this.fxLayer, this.fade);
    this.ui.addChild(this.bars);
    this.app.stage.addChild(this.root, this.ui);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(host);
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
  }

  set reducedMotion(v: boolean) {
    if (this.reduced === v) return;
    this.reduced = v;
    if (v) this.catchUp();
    this.requestRender();
  }

  get reducedMotion(): boolean {
    return this.reduced;
  }

  /**
   * O estado da corrida como o app tem agora. Chamado a cada atualização do painel: a cena
   * decide se é corrida nova (começa do estado), segundo novo (anima) ou o mesmo de antes.
   */
  show(run: DungeonRun, frame: RunFrame | null, end: string | null) {
    if (this.destroyed) return;
    if (!this.run || this.run.id !== run.id) this.setRun(run);
    else if (run.members.some((m, i) => this.run!.members[i]?.palette !== m.palette)) this.refreshLooks(run);
    if (frame) {
      const step = frameStep(this.last, run.id, frame.s);
      this.last = { run: run.id, s: frame.s };
      if (step === "animate" && !this.hidden()) this.animate(frame);
      else if (step !== "same") this.snapTo(frame, step === "reset");
    } else if (this.shownSt < 0) {
      this.enterRoom(0, 0, false);
    }
    if (end && this.ended !== end) {
      this.ended = end;
      if (!this.plan) this.settle();
    }
    this.requestRender();
  }

  private hidden() {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }

  private readonly onVisibility = () => {
    if (this.hidden()) return;
    // Volta no estado do último quadro: o que passou com a aba escondida não é reprisado.
    this.catchUp();
    this.requestRender();
  };

  private catchUp() {
    this.finishPlan();
    this.finishTransition();
    this.clearFx();
    for (const u of this.all()) {
      u.walk = null;
      u.lunge = null;
      u.flashUntil = 0;
      if (u.dying) this.becomeCorpse(u);
      if (u.alive) u.pos = { ...u.home };
    }
    this.maybeLeaveRoom();
  }

  // ---- texturas ------------------------------------------------------------------

  private tex(key: string, make: () => HTMLCanvasElement): Texture {
    let t = this.textures.get(key);
    if (t) return t;
    t = Texture.from(make());
    t.source.scaleMode = "nearest";
    this.textures.set(key, t);
    this.owned.push(t);
    return t;
  }

  private fxTex(k: FxArt) {
    return this.tex(`fx|${k}`, () => fxCanvas(k));
  }

  // ---- corrida e salas -------------------------------------------------------------

  private setRun(run: DungeonRun) {
    this.finishPlan();
    this.finishTransition();
    this.clearFx();
    for (const u of [...this.heroes, ...this.monsters]) this.dropUnit(u);
    this.heroes = [];
    this.monsters = [];
    this.run = run;
    this.last = null;
    this.frame = null;
    this.shownSt = -1;
    this.ended = null;
    this.gears = run.members.map((m) => heroGear(m.gear.weapon, m.gear.shield));
    const homes = heroSpots(this.gears);
    this.heroes = run.members.map((m, i) => {
      const look = this.heroLook(m.palette, m.gear);
      return this.makeUnit(i, true, m.userId === this.me, false, look.frames, TILE, m.name, homes[i]!, m.healthMax, look.fallen);
    });
  }

  private heroLook(pal: number, gear: AvatarGear): { frames: Texture[]; fallen: Texture } {
    const key = `heroi|${pal}|${gearKey(gear)}`;
    let canvases: HTMLCanvasElement[] | null = null;
    const draw = () => (canvases ??= equippedFrames(pal, gear));
    const frames = [0, 1, 2, 3].map((f) => this.tex(`${key}|${f}`, () => draw()[f]!));
    const fallen = this.tex(`${key}|caido`, () => fallenCanvas(draw()[0]!));
    return { frames, fallen };
  }

  /**
   * A mesma corrida com a paleta de alguém diferente: ao recarregar, o quadro chega antes de o
   * app saber quem está no mapa (todos com a paleta padrão); quando sabe, o avatar se acerta.
   */
  private refreshLooks(run: DungeonRun) {
    const prev = this.run!;
    run.members.forEach((m, i) => {
      const h = this.heroes[i];
      if (!h || prev.members[i]?.palette === m.palette) return;
      const look = this.heroLook(m.palette, m.gear);
      const was = h.sprite.texture;
      const f = h.frames.indexOf(was);
      h.frames = look.frames;
      h.corpse = look.fallen;
      h.sprite.texture = f >= 0 ? look.frames[f]! : h.alive ? look.frames[0]! : look.fallen;
    });
    this.run = run;
    this.requestRender();
  }

  private makeUnit(ref: number, hero: boolean, me: boolean, boss: boolean, frames: Texture[], size: number, name: string, home: Spot, max: number, corpse: Texture | null): Unit {
    const sprite = new Sprite(frames[0]!);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(home.x, home.y);
    this.units.addChild(sprite);
    const label = new Text({ text: name, style: this.labelStyle(hero, me, boss), resolution: this.app.renderer.resolution });
    label.anchor.set(0.5, 1);
    this.ui.addChild(label);
    const u: Unit = { ref, hero, me, boss, sprite, frames, size, label, fullName: name, home, pos: { ...home }, hp: max, max, alive: true, gone: false, walk: null, lunge: null, flashUntil: 0, dying: 0, corpse, loot: [] };
    this.fitLabel(u);
    return u;
  }

  private labelStyle(hero: boolean, me: boolean, boss: boolean) {
    return {
      fontFamily: "system-ui, sans-serif",
      fontSize: hero ? this.fontPx : this.fontPx - 1,
      fontWeight: (boss || me ? "700" : "600") as "700" | "600",
      fill: me ? 0xffd23c : hero ? 0xe8e8ee : boss ? 0xff9a8a : 0xf0c4bc,
      stroke: { color: 0x0b0b0f, width: 3 },
    };
  }

  private fitLabel(u: Unit) {
    const maxW = (u.hero || u.boss ? 3.4 : 2.4) * TILE * this.scale;
    u.label.text = fitName(u.fullName, maxW, (s) => {
      u.label.text = s;
      return u.label.width;
    });
  }

  private dropUnit(u: Unit) {
    u.sprite.destroy();
    u.label.destroy();
    for (const l of u.loot) l.destroy();
    u.loot = [];
  }

  /** Monta a sala `st`: chão, monstros com a vida cheia, heróis no lugar (ou na porta). */
  private enterRoom(st: number, count: number, walkIn: boolean) {
    const run = this.run;
    if (!run) return;
    // Efeitos da sala que sai (inclusive o saco de loot surgindo) não sobrevivem aos monstros dela.
    this.clearFx();
    this.clearLingers();
    for (const u of this.monsters) this.dropUnit(u);
    this.floor.texture = this.tex(`sala|${run.dungeon}|${st}`, () => roomCanvas(run.dungeon, st));
    const list = roomFoes(run.dungeon, run.members.length)[st] ?? [];
    const n = Math.max(list.length, count);
    // Os invocados (Invocação do chefe, §12.3) chegam depois do elenco da sala.
    this.foes = Array.from({ length: n }, (_, i) => list[i] ?? summonedFoe(run.dungeon));
    const spots = monsterSpots(this.foes.map((f) => f.boss));
    this.monsters = this.foes.map((f, i) => {
      const key = f.art;
      const body = monsterCanvas(key, f.boss);
      const tex = this.tex(`monstro|${key}|${f.boss ? 1 : 0}`, () => body);
      const corpse = this.tex(`corpo|${key}|${f.boss ? 1 : 0}`, () => corpseCanvas(key, body));
      return this.makeUnit(FOE_BASE + i, false, false, f.boss, [tex], monsterSize(key, f.boss), f.name, spots[i]!, Math.max(1, f.hp), corpse);
    });
    const now = performance.now();
    let k = 0;
    for (const h of this.heroes) {
      if (!h.alive) {
        h.gone = true;
        continue;
      }
      h.sprite.texture = h.frames[0]!;
      if (walkIn && !this.reduced) {
        h.pos = { x: DOOR_IN.x, y: DOOR_IN.y };
        h.walk = { from: { ...DOOR_IN }, to: { ...h.home }, t0: now + k++ * 70, dur: WALK_IN_MS - 140 };
      } else {
        h.pos = { ...h.home };
        h.walk = null;
      }
    }
    this.shownSt = st;
  }

  // ---- um segundo da corrida -----------------------------------------------------

  private animate(frame: RunFrame) {
    this.finishPlan();
    this.clearFloaters();
    const delay = this.prepareRoom(frame.st, frame.x.length);
    this.frame = frame;
    this.syncLingers();
    const plan = planSecond({ events: frame.e, gears: this.gears, classes: this.run!.members.map((m) => m.cls), foes: this.foes, delay });
    if (this.reduced) {
      // Tudo de uma vez, sem movimento: o estado do quadro e os números parados até o próximo.
      const now = performance.now();
      for (const c of plan.cues) this.fire(c, now, true);
      this.settle();
      this.maybeLeaveRoom();
      return;
    }
    this.plan = plan;
    this.cueAt = 0;
    this.planT0 = performance.now();
  }

  /** O quadro chegou noutra sala: a troca que estava a caminho termina; senão o grupo entra agora. */
  private prepareRoom(st: number, count: number): number {
    const now = performance.now();
    const t = this.trans;
    if (t) {
      if (t.next === st) {
        if (t.phase !== "in") this.swapRoom(now, count);
        return Math.max(0, Math.min(ENTER_DELAY_MS, WALK_IN_MS - (now - this.trans!.t0)));
      }
      // Quadro da pausa da sala que o grupo está deixando: a caminhada segue.
      if (st < t.next) return 0;
    }
    this.finishTransition();
    // A sala só avança: quadro atrasado de uma sala que ficou para trás não traz o grupo de volta.
    if (st <= this.shownSt) return 0;
    this.enterRoom(st, count, true);
    if (this.reduced) return 0;
    this.trans = { phase: "in", t0: now, next: st };
    return ENTER_DELAY_MS;
  }

  private snapTo(frame: RunFrame, reset: boolean) {
    this.finishPlan();
    this.finishTransition();
    this.clearFx();
    if (reset ? this.shownSt !== frame.st : frame.st > this.shownSt) this.enterRoom(frame.st, frame.x.length, false);
    this.frame = frame;
    this.syncLingers();
    if (reset) {
      // Chegou no meio: quem já caiu caiu antes, noutra sala ou nesta; fica fora da cena.
      frame.h.forEach((hp, i) => {
        const h = this.heroes[i];
        if (h && hp <= 0) {
          h.alive = false;
          h.gone = true;
        }
      });
    }
    this.settle(true);
    this.maybeLeaveRoom();
  }

  /** Termina o segundo que estava passando: o que faltava acontece de uma vez. */
  private finishPlan() {
    const p = this.plan;
    if (!p) return;
    const now = performance.now();
    for (; this.cueAt < p.cues.length; this.cueAt++) this.fire(p.cues[this.cueAt]!, now, true);
    this.plan = null;
    this.settle();
  }

  /** A vida de todos fica a do quadro; quem zerou vira corpo (ou cai). */
  private settle(instant = false) {
    const f = this.frame;
    if (!f) return;
    this.heroes.forEach((u, i) => {
      u.hp = Math.max(0, Math.min(u.max, f.h[i] ?? u.hp));
      if (u.hp <= 0 && u.alive) this.fall(u);
      if (this.ended === "vitoria" && u.alive && !u.walk) u.sprite.texture = u.frames[3] ?? u.frames[0]!;
    });
    // O quadro é de outra sala (o grupo já foi para a próxima): os monstros daqui seguem cheios.
    if (f.st !== this.shownSt) return;
    this.monsters.forEach((u, i) => {
      const hp = f.x[i];
      if (hp === undefined) return;
      // Monstro que esta versão não conhece: a vida cheia é a maior que já se viu.
      if (hp > u.max) u.max = hp;
      u.hp = Math.max(0, Math.min(u.max, hp));
      if (u.hp <= 0 && u.alive) {
        u.alive = false;
        this.becomeCorpse(u);
      } else if (u.hp > 0 && !u.alive && instant) {
        u.alive = true;
        u.sprite.texture = u.frames[0]!;
        this.units.addChild(u.sprite);
      }
    });
  }

  private fire(c: Cue, now: number, instant: boolean) {
    const motion = !instant && !this.reduced;
    switch (c.k) {
      case "lunge": {
        const a = this.unit(c.who);
        const b = this.unit(c.to);
        if (!motion || !a || !b) return;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        // Quem bate de perto avança até encostar; o monstro, um passo curto.
        const reach = a.hero ? Math.max(4, Math.min(14, d - TILE)) : 4;
        a.lunge = { t0: now, dx: (dx / d) * reach, dy: (dy / d) * reach };
        return;
      }
      case "shot": {
        const a = this.unit(c.from);
        const b = this.unit(c.to);
        if (!motion || !a || !b) return;
        const art: FxArt = c.shot === "orbe" ? "orbe" : c.shot;
        const s = this.fxSprite(art, c.shot === "orbe" ? ELEMENT_COLOR[c.el] : c.shot === "lanca" ? 0xcfe8ff : 0xffffff);
        this.fx.push({ s, kind: "shot", t0: now, dur: c.dur, from: this.middle(a), to: this.middle(b) });
        return;
      }
      case "burst":
      case "slash": {
        const b = this.unit(c.who);
        if (!motion || !b) return;
        const s = this.fxSprite(c.k === "burst" ? "estrela" : "corte", ELEMENT_COLOR[c.el]);
        const at = this.middle(b);
        this.fx.push({ s, kind: c.k, t0: now, dur: c.k === "burst" ? 220 : 160, from: at, to: at });
        return;
      }
      case "spin": {
        const a = this.unit(c.who);
        if (!motion || !a || this.fx.length > FX_MAX) return;
        const at = this.middle(a);
        const s = this.fxSprite("giro", ELEMENT_COLOR[c.el]);
        this.fx.push({ s, kind: "spin", t0: now, dur: SPIN_MS, from: at, to: at });
        return;
      }
      case "rain": {
        const b = this.unit(c.who);
        if (!motion || !b || this.fx.length > FX_MAX) return;
        const at = this.middle(b);
        for (let i = 0; i < c.n; i++) {
          const dx = (i - (c.n - 1) / 2) * 5;
          const s = this.fxSprite(c.art, 0xffffff);
          s.rotation = Math.PI / 2;
          const dur = Math.max(160, RAIN_MS - i * 50);
          this.fx.push({ s, kind: "fall", t0: now + i * 50, dur, from: { x: at.x + dx, y: at.y - 40 }, to: { x: at.x + dx, y: at.y + 2 } });
        }
        return;
      }
      case "drop": {
        const b = this.unit(c.who);
        if (!motion || !b || this.fx.length > FX_MAX) return;
        const at = this.middle(b);
        const s = this.fxSprite(c.art, 0xffffff);
        this.fx.push({ s, kind: "fall", t0: now, dur: DROP_MS, from: { x: at.x + 14, y: at.y - 52 }, to: at });
        return;
      }
      case "beam": {
        const a = this.unit(c.from);
        const b = this.unit(c.to);
        if (!motion || !a || !b || this.fx.length > FX_MAX) return;
        const s = this.fxSprite("raio", ELEMENT_COLOR[c.el]);
        this.fx.push({ s, kind: "beam", t0: now, dur: BEAM_MS, from: this.middle(a), to: this.middle(b) });
        return;
      }
      case "cast": {
        if (motion && this.fx.length <= FX_MAX) this.castFx(c.who, c.s, now);
        return;
      }
      case "hit": {
        const b = this.unit(c.who);
        if (!b || b.gone) return;
        b.hp = afterHit(b.hp, b.max, c);
        const head = { x: b.pos.x, y: b.pos.y - b.size };
        const up = c.how === "cura" || c.how === "mana";
        if (up) this.floater(`+${c.v}`, ELEMENT_COLOR[c.el], head, now);
        else if (c.how === "dano") this.floater(String(c.v), damageColor(c, b.hero), head, now, !!c.crit && !b.hero);
        // Não acertou: em cima de quem foi atacado. Herói = esquivou do monstro; monstro = o herói
        // errou (antes só a fumacinha, e o erro do herói nem chegava aqui; 26/11/2026).
        else if (c.how === "erro") this.floater(b.hero ? MISS_WORDS.dodged : MISS_WORDS.missed, b.hero ? DODGE_COLOR : MISS_COLOR, head, now);
        // Bloqueado: o número que passou, com a marca (antes não aparecia número nenhum).
        else if (c.how === "bloqueio") this.floater(`${c.v} ${MISS_WORDS.blocked}`, BLOCK_COLOR, head, now);
        if (c.how === "dano" && motion) b.flashUntil = now + 120;
        if (up && motion) {
          for (let i = 0; i < 4; i++) {
            const s = this.fxSprite("faisca", ELEMENT_COLOR[c.how === "mana" ? "mana" : "cura"]);
            const from = { x: b.pos.x - 6 + i * 4, y: b.pos.y - 2 - (i % 2) * 4 };
            this.fx.push({ s, kind: "spark", t0: now + i * 50, dur: 480, from, to: { x: from.x, y: from.y - 10 } });
          }
        }
        if ((c.how === "bloqueio" || c.how === "erro" || c.how === "imune") && motion) {
          const s = this.fxSprite("fumaca", 0xffffff);
          const at = { x: this.middle(b).x + (c.how === "erro" ? 6 : 0), y: this.middle(b).y + (c.how === "erro" ? 4 : 0) };
          this.fx.push({ s, kind: "puff", t0: now, dur: 220, from: at, to: at });
        }
        return;
      }
      case "die": {
        const b = this.unit(c.who);
        if (!b || !b.alive) return;
        b.alive = false;
        b.hp = 0;
        if (motion) b.dying = now;
        else this.becomeCorpse(b);
        return;
      }
      case "fall": {
        const b = this.unit(c.who);
        if (b?.alive) this.fall(b);
        return;
      }
      case "loot": {
        const b = this.unit(c.on);
        if (!b) return;
        const art: FxArt = c.coins ? "moedas" : "saco";
        if (b.loot.some((l) => l.texture === this.fxTex(art))) return;
        const s = new Sprite(this.fxTex(art));
        s.anchor.set(0.5, 1);
        const side = c.coins ? 4 : -3;
        s.position.set(Math.round(b.pos.x + side), Math.round(b.pos.y - 1));
        this.corpses.addChild(s);
        b.loot.push(s);
        if (motion) {
          s.scale.set(0.4);
          const fx: Fx = { s, kind: "pop", t0: now, dur: POP_MS, from: b.pos, to: b.pos };
          this.fx.push(fx);
        }
        return;
      }
    }
  }

  private fall(u: Unit) {
    u.alive = false;
    u.hp = 0;
    u.walk = null;
    u.lunge = null;
    u.sprite.tint = 0xffffff;
    if (u.corpse) u.sprite.texture = u.corpse;
  }

  private becomeCorpse(u: Unit) {
    u.dying = 0;
    if (u.corpse) u.sprite.texture = u.corpse;
    u.sprite.alpha = 1;
    u.sprite.scale.set(1);
    u.sprite.tint = 0xffffff;
    this.corpses.addChild(u.sprite);
  }

  /** A sala acabou e há outra: o grupo vai até a porta da direita. */
  private maybeLeaveRoom() {
    const f = this.frame;
    const run = this.run;
    if (!f || !run || this.trans || this.ended || this.reduced || this.hidden()) return;
    const stages = ROOMS;
    if (!roomCleared(f, stages) || f.st !== this.shownSt) return;
    const now = performance.now();
    let k = 0;
    for (const h of this.heroes) {
      if (!h.alive) continue;
      h.walk = { from: { ...h.pos }, to: { x: DOOR_OUT.x, y: DOOR_OUT.y + (k % 2) * 2 }, t0: now + k++ * WALK_GAP_MS, dur: WALK_OUT_MS };
    }
    this.trans = { phase: "out", t0: now, next: f.st + 1 };
    this.requestRender();
  }

  private swapRoom(now: number, count: number) {
    const t = this.trans;
    if (!t) return;
    this.clearFx();
    this.enterRoom(t.next, count, true);
    this.trans = { phase: "in", t0: now, next: t.next };
  }

  private finishTransition() {
    const t = this.trans;
    if (!t) return;
    this.trans = null;
    if (t.phase !== "in") this.enterRoom(t.next, 0, false);
    for (const h of this.heroes) {
      h.walk = null;
      if (h.alive) h.pos = { ...h.home };
    }
    this.fade.alpha = 0;
  }

  // ---- efeitos ----------------------------------------------------------------------

  private fxSprite(k: FxArt, tint: number, layer: Container = this.fxLayer): Sprite {
    const s = this.fxPool.pop() ?? new Sprite();
    s.texture = this.fxTex(k);
    s.anchor.set(0.5);
    s.tint = tint;
    s.alpha = 1;
    s.scale.set(1);
    s.rotation = 0;
    s.visible = true;
    layer.addChild(s);
    return s;
  }

  /** A skill saiu (evento `lanca`): o efeito da receita nos alvos dela (fase 1, 26/11/2026). */
  private castFx(who: number, skill: string, now: number) {
    const fx = castFx(skill);
    if (!fx || fx.on !== "lancamento") return;
    const foes = this.monsters.filter((m) => m.alive && !m.gone);
    const size = (u: Unit) => Math.max(0.8, u.size / 14);
    switch (fx.kind) {
      case "nuvem":
        for (const m of foes) {
          const s = this.fxSprite("nuvem", fx.color);
          const at = { x: m.pos.x, y: m.pos.y - m.size * 0.35 };
          this.fx.push({ s, kind: "bloom", t0: now, dur: CAST_MS, from: at, to: { x: size(m), y: 0 } });
        }
        return;
      case "anel":
        for (const m of foes) {
          const s = this.fxSprite("anel", fx.color, this.groundFx);
          this.fx.push({ s, kind: "ring", t0: now, dur: CAST_MS, from: { x: m.pos.x, y: m.pos.y - 1 }, to: { x: size(m), y: 0 } });
        }
        return;
      case "flocos":
        for (const m of foes)
          for (let i = 0; i < 3; i++) {
            const s = this.fxSprite("floco", fx.color);
            const x = m.pos.x + (i - 1) * 6;
            this.fx.push({ s, kind: "fall", t0: now + i * 70, dur: CAST_MS - i * 70, from: { x, y: m.pos.y - m.size - 18 }, to: { x, y: m.pos.y - m.size / 2 } });
          }
        return;
      case "bolha": {
        const heroes = this.heroes.filter((h) => h.alive && !h.gone);
        const shielded = (h: Unit) =>
          (this.frame?.u?.h[h.ref] ?? []).some((st) => (st.k === "escudo" || st.k === "mana") && st.s === skill);
        const targets =
          fx.alvo === "proprio"
            ? heroes.filter((h) => h.ref === who)
            : fx.alvo === "grupo"
              ? heroes
              : heroes.filter(shielded);
        for (const h of targets) {
          const s = this.fxSprite("bolha", fx.color);
          this.fx.push({ s, kind: "bloom", t0: now, dur: CAST_MS, from: this.middle(h), to: { x: size(h) * 1.1, y: 0 } });
        }
        return;
      }
    }
  }

  /**
   * Os efeitos que duram, pelo quadro: a nuvem da Nuvem Tóxica, o círculo da Consagração, o gelo da
   * Nevasca e a bolha dos escudos aparecem e somem junto com o efeito do jogo.
   */
  private syncLingers() {
    const u0 = this.frame?.u;
    const want = new Map<string, { ref: number; fx: LingerFx }>();
    if (u0) {
      u0.h.forEach((list, i) => {
        for (const fx of lingersOf(list)) want.set(`${i}|${fx.art}|${fx.color}`, { ref: i, fx });
      });
      u0.x.forEach((list, i) => {
        for (const fx of lingersOf(list)) want.set(`${FOE_BASE + i}|${fx.art}|${fx.color}`, { ref: FOE_BASE + i, fx });
      });
    }
    for (const [key, l] of this.lingers)
      if (!want.has(key)) {
        l.s.destroy();
        this.lingers.delete(key);
      }
    for (const [key, w] of want) {
      if (this.lingers.has(key)) continue;
      const s = new Sprite(this.fxTex(w.fx.art));
      s.anchor.set(0.5);
      s.tint = w.fx.color;
      (w.fx.layer === "chao" ? this.groundFx : this.aura).addChild(s);
      this.lingers.set(key, { s, ref: w.ref, fx: w.fx });
    }
  }

  private clearLingers() {
    for (const l of this.lingers.values()) l.s.destroy();
    this.lingers.clear();
  }

  /** Onde cada efeito que dura fica, acompanhando a unidade (e um leve pulsar com movimento). */
  private drawLingers(now: number) {
    for (const l of this.lingers.values()) {
      const u = this.unit(l.ref);
      const show = !!u && u.alive && !u.gone && !u.dying;
      l.s.visible = show;
      if (!show) continue;
      const k = Math.max(0.8, u.size / 14);
      const pulse = this.reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 260 + l.ref);
      switch (l.fx.art) {
        case "glifo":
          l.s.position.set(Math.round(u.pos.x), Math.round(u.pos.y - 1));
          l.s.scale.set(k);
          l.s.alpha = 0.75 * pulse;
          break;
        case "nuvem":
          l.s.position.set(Math.round(u.pos.x), Math.round(u.pos.y - u.size * 0.35));
          l.s.scale.set(k);
          l.s.alpha = 0.7 * pulse;
          break;
        case "floco":
          l.s.position.set(Math.round(u.pos.x + 5), Math.round(u.pos.y - u.size + 2));
          l.s.scale.set(1);
          l.s.alpha = 0.9 * pulse;
          break;
        case "bolha":
          l.s.position.set(Math.round(u.pos.x), Math.round(u.pos.y - u.size / 2));
          l.s.scale.set(k * 1.1);
          l.s.alpha = 0.8 * pulse;
          break;
      }
    }
  }

  private floater(text: string, color: number, at: Spot, now: number, big = false) {
    if (this.floaters.length >= FLOATER_MAX) this.releaseFloater(this.floaters.shift()!);
    const t =
      this.floaterPool.pop() ??
      new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: this.fontPx + 1, fontWeight: "800", fill: 0xffffff, stroke: { color: 0x0b0b0f, width: 3 } }, resolution: this.app.renderer.resolution });
    t.anchor.set(0.5, 1);
    if (t.text !== text) t.text = text;
    if (t.style.fill !== color) t.style.fill = color;
    t.alpha = 1;
    t.visible = true;
    t.scale.set(big ? 1.3 : 1);
    this.ui.addChild(t);
    // Vários números no mesmo alvo não se empilham no mesmo ponto.
    const near = this.floaters.filter((f) => Math.abs(f.x - at.x) < 2 && now - f.t0 < 300).length;
    this.floaters.push({ t, t0: now, x: at.x + (near % 2 ? 5 : -5) * Math.min(1, near), y: at.y - near * 3 });
  }

  private releaseFloater(f: Floater) {
    f.t.visible = false;
    this.ui.removeChild(f.t);
    this.floaterPool.push(f.t);
  }

  private clearFloaters() {
    for (const f of this.floaters) this.releaseFloater(f);
    this.floaters = [];
  }

  private clearFx() {
    for (const f of this.fx) {
      if (f.kind === "pop") {
        if (!f.s.destroyed) f.s.scale.set(1);
        continue;
      }
      f.s.visible = false;
      f.s.removeFromParent();
      this.fxPool.push(f.s);
    }
    this.fx = [];
    this.clearFloaters();
  }

  // ---- laço de quadros ------------------------------------------------------------

  /** Pede um desenho; vários pedidos no mesmo quadro viram um só. */
  requestRender() {
    if (this.raf || this.destroyed || typeof requestAnimationFrame === "undefined") return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    // Teto de quadros: entre dois desenhos, no mínimo ~1/30 s.
    if (this.frames > 0 && now - this.lastDraw < 1000 / SCENE_MAX_FPS - 2) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const busy = this.advance(performance.now());
    this.draw(performance.now());
    this.app.render();
    this.frames++;
    DungeonScene.drawn++;
    this.lastDraw = now;
    if (busy) this.raf = requestAnimationFrame(this.tick);
  };

  /** Avança roteiro, troca de sala, caminhadas e efeitos. Devolve se ainda há o que animar. */
  private advance(now: number): boolean {
    const p = this.plan;
    if (p) {
      const t = now - this.planT0;
      for (; this.cueAt < p.cues.length && p.cues[this.cueAt]!.at <= t; this.cueAt++) this.fire(p.cues[this.cueAt]!, now, false);
      if (this.cueAt >= p.cues.length && t >= p.end) {
        this.plan = null;
        this.settle();
        this.maybeLeaveRoom();
      }
    }
    const tr = this.trans;
    if (tr) {
      const t = now - tr.t0;
      if (tr.phase === "out" && t >= WALK_OUT_MS + WALK_GAP_MS * this.heroes.length) this.trans = { phase: "fade", t0: now, next: tr.next };
      else if (tr.phase === "fade") {
        this.fade.alpha = clamp01(t / FADE_MS);
        if (t >= FADE_MS) this.swapRoom(now, 0);
      } else if (tr.phase === "in") {
        this.fade.alpha = 1 - clamp01(t / FADE_MS);
        if (t >= WALK_IN_MS) {
          this.trans = null;
          this.fade.alpha = 0;
        }
      }
    }
    let moving = false;
    for (const u of this.all()) {
      if (u.walk) {
        const k = clamp01((now - u.walk.t0) / u.walk.dur);
        u.pos = { x: lerp(u.walk.from.x, u.walk.to.x, k), y: lerp(u.walk.from.y, u.walk.to.y, k) };
        if (k >= 1) u.walk = null;
        else moving = true;
      }
      if (u.lunge && now - u.lunge.t0 >= LUNGE_MS) u.lunge = null;
      if (u.dying && now - u.dying >= DIE_MS) this.becomeCorpse(u);
      if (u.lunge || u.dying || u.flashUntil > now) moving = true;
    }
    this.fx = this.fx.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k < 0) {
        f.s.visible = false;
        return true;
      }
      f.s.visible = true;
      if (k >= 1) {
        if (f.kind === "pop") f.s.scale.set(1);
        else {
          f.s.visible = false;
          f.s.removeFromParent();
          this.fxPool.push(f.s);
        }
        return false;
      }
      switch (f.kind) {
        case "shot": {
          f.s.position.set(Math.round(lerp(f.from.x, f.to.x, k)), Math.round(lerp(f.from.y, f.to.y, k)));
          f.s.rotation = Math.atan2(f.to.y - f.from.y, f.to.x - f.from.x);
          break;
        }
        case "burst":
          f.s.position.set(f.from.x, f.from.y);
          f.s.scale.set(0.6 + k);
          f.s.alpha = 1 - k;
          break;
        case "spark":
          f.s.position.set(f.from.x, Math.round(lerp(f.from.y, f.to.y, easeOut(k))));
          f.s.alpha = 1 - k * k;
          break;
        case "puff":
          f.s.position.set(f.from.x, f.from.y);
          f.s.scale.set(0.8 + 0.4 * k);
          f.s.alpha = 0.9 * (1 - k);
          break;
        case "slash":
          f.s.position.set(f.from.x, f.from.y);
          f.s.alpha = 1 - k;
          break;
        case "pop":
          f.s.scale.set(0.4 + 0.6 * easeOut(k));
          break;
        case "spin":
          f.s.position.set(f.from.x, f.from.y);
          f.s.rotation = k * Math.PI * 3;
          f.s.alpha = 1 - k * k;
          break;
        case "fall":
          f.s.position.set(Math.round(lerp(f.from.x, f.to.x, k * k)), Math.round(lerp(f.from.y, f.to.y, k * k)));
          f.s.alpha = k < 0.85 ? 1 : (1 - k) / 0.15;
          break;
        case "beam": {
          const dx = f.to.x - f.from.x;
          const dy = f.to.y - f.from.y;
          f.s.position.set((f.from.x + f.to.x) / 2, (f.from.y + f.to.y) / 2);
          f.s.rotation = Math.atan2(dy, dx);
          f.s.scale.set(Math.max(1, Math.hypot(dx, dy) / 8), Math.floor(k * 8) % 2 ? 1 : -1);
          f.s.alpha = 1 - k * 0.6;
          break;
        }
        case "bloom":
          f.s.position.set(f.from.x, f.from.y);
          f.s.scale.set(f.to.x * (0.5 + 0.6 * easeOut(k)));
          f.s.alpha = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
          break;
        case "ring":
          f.s.position.set(f.from.x, f.from.y);
          f.s.scale.set(f.to.x * (0.3 + 1.1 * easeOut(k)));
          f.s.alpha = 1 - k;
          break;
      }
      return true;
    });
    this.floaters = this.floaters.filter((f) => {
      if (this.reduced) return true;
      if (now - f.t0 < FLOAT_MS) return true;
      this.releaseFloater(f);
      return false;
    });
    return !!this.plan || !!this.trans || moving || this.fx.length > 0 || (!this.reduced && this.floaters.length > 0);
  }

  /** Posições na cena e, por cima (na escala da tela), nomes, barras e números. */
  private draw(now: number) {
    const s = this.scale;
    const ox = this.root.position.x;
    const oy = this.root.position.y;
    this.bars.clear();
    this.drawLingers(now);
    for (const u of this.all()) {
      const visible = !u.gone;
      u.sprite.visible = visible;
      let x = u.pos.x;
      let y = u.pos.y;
      if (u.lunge) {
        const k = Math.sin(clamp01((now - u.lunge.t0) / LUNGE_MS) * Math.PI);
        x += u.lunge.dx * k;
        y += u.lunge.dy * k;
      }
      u.sprite.position.set(Math.round(x), Math.round(y));
      u.sprite.zIndex = y;
      if (u.alive) {
        if (u.hero && u.walk) u.sprite.texture = u.frames[1 + (Math.floor((now - u.walk.t0) / STEP_MS) % 2 ? 1 : 0)]!;
        else if (u.hero && this.ended !== "vitoria") u.sprite.texture = u.frames[0]!;
        u.sprite.tint = u.flashUntil > now ? 0xff8f8f : 0xffffff;
      }
      if (u.dying) {
        const k = clamp01((now - u.dying) / DIE_MS);
        u.sprite.alpha = 1 - 0.5 * k;
        u.sprite.scale.set(1, 1 - 0.4 * k);
        u.sprite.tint = 0xffb0b0;
      }
      const show = visible && u.alive && !u.dying;
      u.label.visible = show;
      if (!show) continue;
      const sx = Math.round(ox + x * s);
      const top = Math.round(oy + (y - u.size) * s);
      const bw = Math.round(Math.max(14, Math.min(28, u.size * s * 0.8)));
      const by = top - 5;
      u.label.position.set(sx, by - 1);
      const frac = u.max > 0 ? clamp01(u.hp / u.max) : 0;
      const color = frac > 0.5 ? 0x4dd26a : frac > 0.25 ? 0xf0c03a : 0xe0574f;
      this.bars.rect(sx - bw / 2 - 1, by - 1, bw + 2, 5).fill({ color: 0x0b0b0f });
      this.bars.rect(sx - bw / 2, by, Math.round(bw * frac), 3).fill({ color });
      this.drawStatuses(u, sx, by, bw, frac);
    }
    for (const f of this.floaters) {
      const k = this.reduced ? 0 : clamp01((now - f.t0) / FLOAT_MS);
      f.t.position.set(Math.round(ox + f.x * s), Math.round(oy + f.y * s - 8 - k * 16));
      f.t.alpha = this.reduced ? 1 : k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }

  /**
   * Os efeitos ativos (26/11/2026): o escudo como faixa clara por cima da vida e, embaixo da barra,
   * uma marca colorida por efeito (até 5; o que é ruim primeiro). O nome e o tempo ficam no HUD.
   */
  private drawStatuses(u: Unit, sx: number, by: number, bw: number, frac: number) {
    const u0 = this.frame?.u;
    if (!u0) return;
    const list = u.hero ? u0.h[u.ref] : u0.x[u.ref - FOE_BASE];
    if (!list || list.length === 0) return;
    const author = (a: number | undefined, fallback: ClassId | null) =>
      (a !== undefined ? this.run?.members[a]?.cls : undefined) ?? fallback;
    const own = u.hero ? (this.run?.members[u.ref]?.cls ?? null) : null;
    const marks = list
      .map((st) => ({ st, tone: statusTone(st, author(st.a, own)) }))
      .sort((a, b) => Number(statusGood(a.tone)) - Number(statusGood(b.tone)));
    const shield = list.find((s) => s.k === "escudo");
    if (shield?.v && u.max > 0) {
      const w = Math.round(bw * Math.min(1, shield.v / u.max));
      const x0 = Math.min(sx - bw / 2 + Math.round(bw * frac), sx + bw / 2 - w);
      this.bars.rect(x0, by, w, 1).fill({ color: STATUS_COLOR.shield });
    }
    const n = Math.min(5, marks.length);
    const size = 3;
    const gap = 2;
    const total = n * size + (n - 1) * gap;
    let x = Math.round(sx - total / 2);
    const y = by + 5;
    for (let i = 0; i < n; i++) {
      this.bars.rect(x - 1, y - 1, size + 2, size + 2).fill({ color: 0x0b0b0f });
      this.bars.rect(x, y, size, size).fill({ color: STATUS_COLOR[marks[i]!.tone] });
      x += size + gap;
    }
  }

  private resize() {
    if (!this.host || this.destroyed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(w, h);
    const fit = Math.min(w / SCENE_W, h / SCENE_H);
    const scale = fit >= 2 ? Math.floor(fit) : fit;
    this.scale = scale;
    this.root.scale.set(scale);
    this.root.position.set(Math.floor((w - SCENE_W * scale) / 2), Math.floor((h - SCENE_H * scale) / 2));
    const font = Math.max(9, Math.min(12, Math.round(scale * 4.6)));
    if (font !== this.fontPx) {
      this.fontPx = font;
      for (const u of this.all()) u.label.style = this.labelStyle(u.hero, u.me, u.boss);
      for (const t of this.floaterPool) t.style.fontSize = font + 1;
      for (const f of this.floaters) f.t.style.fontSize = font + 1;
    }
    for (const u of this.all()) this.fitLabel(u);
    this.requestRender();
  }

  private all(): Unit[] {
    return this.heroes.length + this.monsters.length ? [...this.heroes, ...this.monsters] : [];
  }

  private unit(ref: number): Unit | undefined {
    return ref >= FOE_BASE ? this.monsters[ref - FOE_BASE] : this.heroes[ref];
  }

  /** O meio do corpo (de onde sai e onde chega o tiro). */
  private middle(u: Unit): Spot {
    return { x: u.pos.x, y: u.pos.y - u.size / 2 };
  }

  /** Fecha a cena: para a animação e libera só o que ela criou. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    // O que está fora do palco primeiro, enquanto o renderizador existe.
    for (const t of this.floaterPool) t.destroy();
    for (const s of this.fxPool) s.destroy();
    this.floaterPool.length = 0;
    this.fxPool.length = 0;
    // Sem renderizador (a init falhou antes, sem WebGL) não há o que soltar no Pixi.
    if (this.app.renderer) this.app.destroy(RENDERER_DESTROY, { children: true });
    for (const t of this.owned) t.destroy(true);
    this.owned.length = 0;
    this.textures.clear();
    this.lingers.clear();
    this.heroes = [];
    this.monsters = [];
    this.host = null;
  }
}
