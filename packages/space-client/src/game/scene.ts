import type { FightEvent, FightInput, FightResult, GameLook, WeaponType } from "@muchat/space-core/game";
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import { RENDERER_DESTROY } from "../render/renderer.ts";
import { dummyCanvas, ENEMY_SIZE, enemyCanvas, heroCanvas, lobbyCanvas, ruinsCanvas, SCENE_H, SCENE_W } from "./art.ts";
import { buildTimeline, frameAt, type Frame, type ReplaySpeed, type Timeline } from "./replay.ts";

/**
 * A cena do Refúgio no painel do jogo (ADR 0009, decisão 9): uma Application
 * do Pixi só dela, que desenha sob demanda (0 quadros com a cena parada) e anima
 * a luta a no máximo 30 quadros/s, só com a aba visível. Destrói só o que criou:
 * o mapa do Espaço vive na mesma página (o defeito de 14/11/2026).
 */

export const GAME_MAX_FPS = 30;
const MAX_RESOLUTION = 2;
const FLOATERS = 10;
const HERO_AT = { x: 40, y: 92 };
const FOE_AT: readonly { x: number; y: number }[] = [
  { x: 136, y: 84 },
  { x: 164, y: 100 },
  { x: 130, y: 114 },
  { x: 166, y: 70 },
  { x: 108, y: 100 },
  { x: 180, y: 120 },
];
const BOSS_AT = { x: 150, y: 104 };

export interface LobbyLook {
  look: GameLook;
  weapon: WeaponType;
  /** Nível do boneco (0 a 4). */
  tier: number;
}

const DEFAULT_LOOK: LobbyLook = { look: { skin: 1, hair: 1, outfit: 0, trim: 0, cosmetic: null }, weapon: "espada", tier: 0 };

interface Actor {
  sprite: Sprite;
  bar: Graphics;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Última vida desenhada na barra (só redesenha quando muda). */
  shown: string;
}

interface Playback {
  tl: Timeline;
  t: number;
  last: number;
  speed: ReplaySpeed;
  hero: Actor;
  foes: Actor[];
  resolve: () => void;
}

export class GameScene {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly bg = new Sprite();
  private readonly actors = new Container();
  private readonly fx = new Container();
  private readonly owned: Texture[] = [];
  private readonly textures = new Map<string, Texture>();
  private readonly floaters: Text[] = [];
  private host: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private raf = 0;
  private dirty = true;
  private frames = 0;
  private lastDraw = 0;
  private destroyed = false;
  private lobby: LobbyLook = DEFAULT_LOOK;
  private play: Playback | null = null;
  /** Sem tremida, sem número subindo, sem piscada (preferência do sistema). */
  reducedMotion = false;
  /** Textos que a cena desenha; o app passa os traduzidos (Lingui). */
  labels: SceneLabels = DEFAULT_LABELS;

  static async mount(host: HTMLElement, opts: { reducedMotion?: boolean; labels?: Partial<SceneLabels> } = {}): Promise<GameScene> {
    const s = new GameScene();
    s.reducedMotion = opts.reducedMotion ?? false;
    s.labels = { ...DEFAULT_LABELS, ...opts.labels };
    await s.init(host);
    return s;
  }

  /** Quadros desenhados desde que a cena nasceu (a prova do "0 quadros parado"). */
  get frameCount(): number {
    return this.frames;
  }

  get playing(): boolean {
    return this.play !== null;
  }

  private async init(host: HTMLElement) {
    await this.app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      background: "#14151c",
      antialias: false,
      autoDensity: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, MAX_RESOLUTION),
      roundPixels: true,
      autoStart: false,
    });
    // Quem desenha é o frame() desta cena, e só quando algo mudou.
    this.app.ticker.stop();
    this.app.ticker.remove(this.app.render, this.app);
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.canvas.style.display = "block";
    host.appendChild(this.app.canvas);
    this.host = host;
    this.root.addChild(this.bg, this.actors, this.fx);
    this.app.stage.addChild(this.root);
    for (let i = 0; i < FLOATERS; i++) {
      const t = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 8, fill: 0xffffff, fontWeight: "700" }, resolution: 4 });
      t.anchor.set(0.5, 1);
      t.visible = false;
      this.fx.addChild(t);
      this.floaters.push(t);
    }
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(host);
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.showLobby(DEFAULT_LOOK);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    // Volta sem pular a luta para frente: o tempo escondido não conta.
    if (this.play) this.play.last = performance.now();
    this.requestRender();
  };

  private resize() {
    if (!this.host || this.destroyed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(w, h);
    const fit = Math.min(w / SCENE_W, h / SCENE_H);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    this.root.scale.set(scale);
    this.root.position.set(Math.floor((w - SCENE_W * scale) / 2), Math.floor((h - SCENE_H * scale) / 2));
    this.requestRender();
  }

  private texture(key: string, make: () => HTMLCanvasElement): Texture {
    let t = this.textures.get(key);
    if (t) return t;
    t = Texture.from(make());
    t.source.scaleMode = "nearest";
    this.textures.set(key, t);
    this.owned.push(t);
    return t;
  }

  private heroTexture(l: LobbyLook): Texture {
    const k = `hero|${l.look.skin}|${l.look.hair}|${l.look.outfit}|${l.look.trim}|${l.weapon}`;
    return this.texture(k, () => heroCanvas(l.look, l.weapon));
  }

  private clearActors() {
    for (const c of this.actors.removeChildren()) c.destroy({ children: true });
    for (const f of this.floaters) f.visible = false;
  }

  /** O quarto do Refúgio com o herói e o boneco. Termina uma reprise que estivesse passando. */
  showLobby(l: LobbyLook) {
    if (this.destroyed) return;
    this.finishPlay();
    this.lobby = { look: { ...l.look }, weapon: l.weapon, tier: l.tier };
    this.clearActors();
    this.bg.texture = this.texture("lobby", lobbyCanvas);
    const dummy = new Sprite(this.texture(`dummy|${l.tier}`, () => dummyCanvas(l.tier)));
    dummy.anchor.set(0.5, 1);
    dummy.position.set(150, 96);
    const hero = new Sprite(this.heroTexture(this.lobby));
    hero.anchor.set(0.5, 1);
    hero.position.set(96, 100);
    this.actors.addChild(dummy, hero);
    this.requestRender();
  }

  /**
   * Passa a luta da sala (a `game.fight`): roda `fight(input)` aqui e anima.
   * Resolve quando a luta termina de passar, ou se for pulada, trocada ou a cena fechar.
   */
  playFight(input: FightInput, opts: { speed?: ReplaySpeed; result?: FightResult; look?: LobbyLook } = {}): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.finishPlay();
    if (opts.look) this.lobby = opts.look;
    const tl = buildTimeline(input, opts.result);
    this.clearActors();
    this.bg.texture = this.texture("ruins", ruinsCanvas);
    const actor = (tex: Texture, w: number, h: number, x: number, y: number): Actor => {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(x, y);
      const bar = new Graphics();
      this.actors.addChild(sprite, bar);
      return { sprite, bar, w, h, x, y, shown: "" };
    };
    const hero = actor(this.heroTexture({ ...this.lobby, weapon: input.hero.weapon }), 16, 16, HERO_AT.x, HERO_AT.y);
    const boss = tl.foes[0]?.enemy === "matriarca";
    const foes = tl.foes.map((f, i) => {
      const size = ENEMY_SIZE[f.enemy];
      const at = boss && i === 0 ? BOSS_AT : FOE_AT[(boss ? i - 1 : i) % FOE_AT.length]!;
      return actor(this.texture(`foe|${f.enemy}`, () => enemyCanvas(f.enemy)), size, size, at.x, at.y);
    });
    return new Promise<void>((resolve) => {
      this.play = { tl, t: 0, last: performance.now(), speed: opts.speed ?? 1, hero, foes, resolve };
      this.apply(frameAt(tl, 0));
      this.requestRender();
    });
  }

  setSpeed(speed: ReplaySpeed) {
    if (this.play) this.play.speed = speed;
  }

  /** Mostra o fim da luta agora. */
  skip() {
    const p = this.play;
    if (!p) return;
    p.t = p.tl.durationMs;
    this.apply(frameAt(p.tl, p.t));
    this.finishPlay();
    this.requestRender();
  }

  private finishPlay() {
    const p = this.play;
    if (!p) return;
    this.play = null;
    p.resolve();
  }

  /** Pede um quadro; vários pedidos no mesmo quadro viram um só. */
  requestRender() {
    this.dirty = true;
    if (this.raf || this.destroyed || typeof requestAnimationFrame === "undefined") return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    const p = this.play;
    if (p) {
      // Teto de quadros: entre dois desenhos, no mínimo 1/30 s.
      if (now - this.lastDraw < 1000 / GAME_MAX_FPS) {
        this.raf = requestAnimationFrame(this.frame);
        return;
      }
      const dt = Math.min(100, Math.max(0, now - p.last));
      p.last = now;
      p.t = Math.min(p.tl.durationMs, p.t + dt * p.speed);
      const f = frameAt(p.tl, p.t);
      this.apply(f);
      this.dirty = true;
      if (f.done) this.finishPlay();
    }
    if (this.dirty) {
      this.app.render();
      this.frames++;
      this.lastDraw = now;
      this.dirty = false;
    }
    if (this.play) this.raf = requestAnimationFrame(this.frame);
  };

  private apply(f: Frame) {
    const p = this.play;
    if (!p) return;
    const motion = !this.reducedMotion;
    this.bar(p.hero, f.heroHp, f.heroMaxHp);
    p.hero.sprite.position.x = p.hero.x;
    p.hero.sprite.tint = 0xffffff;
    f.foes.forEach((foe, i) => {
      const a = p.foes[i];
      if (!a) return;
      a.sprite.visible = foe.visible;
      a.bar.visible = foe.visible && foe.alive;
      a.sprite.alpha = foe.alive ? 1 : 0.3;
      a.sprite.tint = 0xffffff;
      a.sprite.position.x = a.x;
      if (foe.visible) this.bar(a, foe.hp, foe.maxHp);
    });
    const actorOf = (who: number) => (who === -1 ? p.hero : p.foes[who]);
    let used = 0;
    // Do mais recente para o mais antigo: os números novos ganham as vagas.
    for (let i = f.recent.length - 1; i >= 0; i--) {
      const e = f.recent[i]!;
      const age = f.t - e.t;
      if (motion && e.k === "hit" && age < 120) {
        const by = actorOf(e.by);
        if (by) by.sprite.position.x = by.x + (e.by === -1 ? 3 : -3);
        const to = actorOf(e.to);
        if (to) to.sprite.tint = 0xff9a9a;
      }
      if (motion && e.k === "cast" && age < 160) p.hero.sprite.tint = 0x9fd8ff;
      if (used >= FLOATERS) continue;
      const label = floaterOf(e, this.labels);
      if (!label) continue;
      const target = actorOf(label.on);
      if (!target) continue;
      const t = this.floaters[used++]!;
      if (t.text !== label.text) t.text = label.text;
      t.style.fill = label.color;
      t.visible = true;
      const rise = motion ? Math.floor((age / 700) * 10) : 0;
      t.position.set(target.x + (used % 2 ? -3 : 3), target.y - target.h - 4 - rise);
      t.alpha = motion ? Math.max(0, 1 - age / 700) : 1;
    }
    for (let i = used; i < FLOATERS; i++) this.floaters[i]!.visible = false;
  }

  private bar(a: Actor, hp: number, max: number) {
    const key = `${hp}/${max}`;
    if (a.shown === key) return;
    a.shown = key;
    const w = Math.max(12, Math.min(24, a.w));
    const x = a.x - w / 2;
    const y = a.y - a.h - 3;
    const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    const color = frac > 0.5 ? 0x4dd26a : frac > 0.25 ? 0xf0c03a : 0xe0574f;
    a.bar.clear();
    a.bar.rect(x - 1, y - 1, w + 2, 4).fill({ color: 0x15131a });
    a.bar.rect(x, y, Math.round(w * frac), 2).fill({ color });
  }

  /** Fecha a cena: para a animação e libera só as texturas que ela criou. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.finishPlay();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.app.destroy(RENDERER_DESTROY, { children: true });
    for (const t of this.owned) t.destroy(true);
    this.owned.length = 0;
    this.textures.clear();
    this.host = null;
  }
}

export interface SceneLabels {
  miss: string;
}
const DEFAULT_LABELS: SceneLabels = { miss: "esquiva" };

function floaterOf(e: FightEvent, labels: SceneLabels): { on: number; text: string; color: number } | null {
  switch (e.k) {
    case "hit":
      return { on: e.to, text: e.crit ? `${e.dmg}!` : String(e.dmg), color: e.to === -1 ? 0xff8a7a : e.crit ? 0xffd23c : 0xffffff };
    case "dot":
      return { on: e.to, text: String(e.dmg), color: 0xb98cff };
    case "heal":
    case "potion":
      return { on: -1, text: `+${e.v}`, color: 0x4dd26a };
    case "miss":
      return { on: e.to, text: labels.miss, color: 0xb8bcc8 };
    default:
      return null;
  }
}

