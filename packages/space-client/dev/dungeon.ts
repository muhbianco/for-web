import {
  type ClassId,
  type HeroV5,
  type RunFrame,
  type RunResult,
  DUNGEONS,
  balanceHero,
  createHero,
  dungeonById,
  heroDerived,
  heroRunFighter,
  simulateRun,
} from "@muchat/space-core/game/ot/balance";
import { Application, Graphics, Sprite, Text, Texture } from "pixi.js";

import { avatarGearOf } from "../src/hero.ts";
import { characterSheet, palette } from "../src/render/sprites.ts";
import { DungeonScene, type DungeonRun } from "../src/game/index.ts";

/**
 * Página de dev da dungeon vista de cima (Idle Hunt v5), sem servidor: uma corrida simulada com o
 * motor de verdade (`simulateRun` com `record`), um quadro por segundo como o `rpg.run.tick`.
 * Ao lado, um dublê do mapa (outra Application do Pixi desenhando sem parar) para provar que
 * abrir e fechar a cena não estraga a outra (o defeito do pool global de 14/11/2026).
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);

let uid = 0;
/** Um herói da classe no nível (o kit do jogador novo, com poções de sobra). */
function hero(cls: ClassId, level: number, name: string): HeroV5 & { name: string; id: string } {
  const h = createHero(cls, () => `d${uid++}`);
  return {
    ...h,
    level,
    proficiency: 10 * level,
    potions: { hp: { pequena: 100, media: 0, grande: 0 }, mp: { pequena: 100, media: 0, grande: 0 } },
    name,
    id: `u${name}`,
  };
}

/** O grupo da DG: dupla na Caçada, quarteto na Masmorra e no Chefe de Região, no nível dela. */
function partyFor(id: string) {
  const d = dungeonById(id)!;
  const L = Math.max(1, d.level);
  return d.kind === "cacada"
    ? [hero("guerreiro", L, "Ana"), hero("mago", L, "Bia")]
    : [hero("guerreiro", L, "Ana"), hero("padre", L, "Bia"), hero("cacador", L, "Caio"), hero("mago", L, "Duda")];
}
const PALETTES = [0, 3, 5, 6];

// Todas as dungeons no seletor.
$<HTMLSelectElement>("dungeon").innerHTML = "";
for (const d of DUNGEONS) {
  const o = document.createElement("option");
  o.value = d.id;
  o.textContent = `${d.name} (${d.minLevel})`;
  $<HTMLSelectElement>("dungeon").append(o);
}

let dungeon = (q.get("d") as string) || "masmorra-40";
$<HTMLSelectElement>("dungeon").value = dungeon;
let seed = Number(q.get("seed") ?? 1);
let result: RunResult & { frames: RunFrame[] };
let run: DungeonRun;
let sec = 0;
let paused = false;
let reduced = q.get("reduced") === "1";
let scene: DungeonScene | null = null;
let cyclesDone = 0;

function newRun() {
  const party = partyFor(dungeon);
  let s = seed;
  const random = { next: () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) };
  const r = simulateRun(dungeonById(dungeon)!, party.map((h) => heroRunFighter(h)), { mode: "aleatorio", random, record: true });
  result = { ...r, frames: r.frames ?? [] };
  run = {
    id: `dev-${dungeon}-${seed}`,
    dungeon,
    members: party.map((h, i) => ({
      userId: h.id,
      name: h.name,
      cls: h.cls,
      healthMax: Math.round(heroDerived(balanceHero(h)).hp),
      palette: PALETTES[i]!,
      gear: avatarGearOf(h.equipment),
    })),
  };
  sec = Number(q.get("at") ?? 0);
  $("feed").innerHTML = "";
}

function frameAt(s: number): RunFrame {
  return result.frames[Math.min(s, result.frames.length - 1)]!;
}

async function mountScene() {
  scene = await DungeonScene.mount($("scene"), { reducedMotion: reduced, me: "uAna" });
  scene.show(run, frameAt(sec), null);
}

function step() {
  if (!scene || paused) return;
  sec++;
  if (sec >= result.frames.length + 4) {
    seed++;
    newRun();
  }
  const f = frameAt(sec);
  const end = sec >= result.frames.length - 1 ? result.outcome : null;
  scene.show(run, f, end);
  $("clock").textContent = `${sec}s · sala ${f.st + 1} · ${end ?? ""}`;
  if (sec < result.frames.length) {
    for (const e of f.e) {
      const li = document.createElement("li");
      li.textContent = JSON.stringify(e);
      $("feed").prepend(li);
    }
  }
}

// ---- dublê do mapa ---------------------------------------------------------------
const map = new Application();
let mapRenders = 0;
const mapErrors: string[] = [];
async function mountMap() {
  await map.init({ resizeTo: $("map"), background: "#1e2029", antialias: false });
  $("map").appendChild(map.canvas);
  const sheet = Texture.from(characterSheet(palette(2)));
  sheet.source.scaleMode = "nearest";
  const a = new Sprite(sheet);
  a.scale.set(2);
  a.position.set(20, 40);
  const g = new Graphics().rect(0, 0, 60, 8).fill({ color: 0x4dd26a });
  g.position.set(150, 30);
  const t = new Text({ text: "mapa", style: { fill: 0xffffff, fontSize: 12 } });
  t.position.set(150, 60);
  map.stage.addChild(a, g, t);
  map.ticker.maxFPS = 30;
  map.ticker.add(() => {
    g.rotation += 0.02;
    mapRenders++;
  });
}
window.addEventListener("error", (e) => mapErrors.push(String(e.message)));

async function cycles(n: number) {
  for (let i = 0; i < n; i++) {
    scene?.destroy();
    scene = null;
    await new Promise((r) => setTimeout(r, 60));
    await mountScene();
    await new Promise((r) => setTimeout(r, 120));
    cyclesDone++;
  }
}

$("restart").onclick = () => {
  newRun();
  scene?.show(run, frameAt(sec), null);
};
$("pause").onclick = () => {
  paused = !paused;
  $("pause").textContent = paused ? "Continuar" : "Pausar";
};
$("reduced").onclick = () => {
  reduced = !reduced;
  if (scene) scene.reducedMotion = reduced;
  $("reduced").textContent = `Reduzir movimento: ${reduced ? "sim" : "não"}`;
};
$("cycles").onclick = () => void cycles(20);
$<HTMLSelectElement>("dungeon").onchange = (e) => {
  dungeon = (e.target as HTMLSelectElement).value;
  newRun();
  scene?.show(run, frameAt(sec), null);
};

newRun();
await mountMap();
await mountScene();
setInterval(step, Number(q.get("ms") ?? 1000));
setInterval(() => {
  $("stats").textContent = JSON.stringify({ quadros: scene?.frameCount, animando: scene?.animating, mapa: mapRenders, erros: mapErrors.length, ciclos: cyclesDone }, null, 1);
}, 500);

(window as unknown as Record<string, unknown>).__dungeon = {
  stats: () => ({ frames: scene?.frameCount ?? 0, animating: scene?.animating ?? false, mapRenders, mapErrors: [...mapErrors], cycles: cyclesDone, sec, st: frameAt(sec).st }),
  cycles,
  pause: (v: boolean) => {
    paused = v;
  },
  seek: (s: number) => {
    sec = s;
    scene?.show(run, frameAt(sec), null);
  },
  scene: () => scene,
  /** Mede `n` montagens: init do Pixi, primeira corrida (show) e primeiro desenho, e as tarefas longas. */
  measure: async (n = 5) => {
    const longs: number[] = [];
    const obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longs.push(Math.round(e.duration));
    });
    obs.observe({ type: "longtask" });
    paused = true;
    const out: { mount: number; show: number; firstDraw: number; longs: number[] }[] = [];
    for (let i = 0; i < n; i++) {
      scene?.destroy();
      scene = null;
      await new Promise((r) => setTimeout(r, 300));
      const before = longs.length;
      const t0 = performance.now();
      const s = await DungeonScene.mount($("scene"), { reducedMotion: reduced, me: "uAna" });
      const t1 = performance.now();
      s.show(run, frameAt(sec), null);
      const t2 = performance.now();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
      const t3 = performance.now();
      scene = s;
      await new Promise((r) => setTimeout(r, 300));
      out.push({ mount: Math.round(t1 - t0), show: Math.round(t2 - t1), firstDraw: Math.round(t3 - t2), longs: longs.slice(before) });
    }
    obs.disconnect();
    paused = false;
    return out;
  },
};
