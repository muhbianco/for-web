import { addExperience, bestGear, expForLevel, type RunFrame, type RunHero, type RunResult, simulateRun, type SkillId, START, type VocationId, VOCATIONS } from "@muchat/space-core/game/ot";
import { Application, Graphics, Sprite, Text, Texture } from "pixi.js";

import { characterSheet, palette } from "../src/render/sprites.ts";
import { DungeonScene, type DungeonRun } from "../src/game/index.ts";

/**
 * Página de dev da dungeon vista de cima (docs/espaco/jogo/ot, etapa O10), sem servidor: uma
 * corrida simulada com as regras de verdade, um quadro por segundo como o `rpg.run.tick`.
 * Ao lado, um dublê do mapa (outra Application do Pixi desenhando sem parar) para provar que
 * abrir e fechar a cena não estraga a outra (o defeito do pool global de 14/11/2026).
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);

function hero(vocation: VocationId, level: number, skill: number, ml: number, owned: string[], name: string): RunHero {
  const voc = VOCATIONS[vocation];
  const st = addExperience(voc, { level: 1, experience: 0, healthMax: START.health, manaMax: START.mana, cap: START.cap }, expForLevel(level));
  const skills = { punhos: 10, maca: 10, espada: 10, machado: 10, distancia: 10, escudo: 10 } as Record<SkillId, number>;
  if (voc.base === 4) {
    skills.espada = skill;
    skills.escudo = skill;
  }
  if (voc.base === 3) skills.distancia = skill;
  return { userId: `u${vocation}`, name, vocation, level: st.level, healthMax: st.healthMax, manaMax: st.manaMax, skills, magicLevel: ml, stamina: 2520, gear: bestGear(vocation, st.level, skills, st.manaMax, owned) };
}

const PARTIES: Record<string, RunHero[]> = {
  "cripta-do-musgo": [hero(4, 6, 25, 2, [], "Ana"), hero(2, 6, 10, 8, [], "Bia")],
  "galerias-afogadas": [
    hero(4, 20, 55, 4, ["espada-larga", "escudo-de-aco", "cota-de-malha"], "Ana"),
    hero(2, 20, 10, 30, ["varinha-de-geada", "manto-azul"], "Bia"),
    hero(3, 20, 55, 8, ["arco-composto"], "Caio"),
    hero(1, 20, 10, 30, ["varinha-de-geada"], "Duda"),
  ],
  "forja-rachada": [
    hero(4, 42, 72, 6, ["lamina-da-forja", "escudo-da-forja", "placa-de-ferreiro"], "Ana"),
    hero(2, 42, 10, 48, [], "Bia"),
    hero(3, 42, 72, 10, ["arco-de-guerra"], "Caio"),
  ],
};
const PALETTES = [0, 3, 5, 6];

let dungeon = (q.get("d") as string) || ($<HTMLSelectElement>("dungeon").value as string);
$<HTMLSelectElement>("dungeon").value = dungeon;
let seed = Number(q.get("seed") ?? 1);
let result: RunResult;
let run: DungeonRun;
let sec = 0;
let paused = false;
let reduced = q.get("reduced") === "1";
let scene: DungeonScene | null = null;
let cyclesDone = 0;

function newRun() {
  const party = PARTIES[dungeon]!;
  result = simulateRun({ seed, dungeon, heroes: party, rateLoot: 2 });
  run = {
    id: `dev-${dungeon}-${seed}`,
    dungeon,
    members: party.map((h, i) => ({ userId: h.userId, name: h.name, vocation: h.vocation, healthMax: h.healthMax, palette: PALETTES[i]!, weapon: h.gear.weapon, shield: h.gear.shield })),
  };
  sec = Number(q.get("at") ?? 0);
  $("feed").innerHTML = "";
}

function frameAt(s: number): RunFrame {
  return result.frames[Math.min(s, result.frames.length - 1)]!;
}

async function mountScene() {
  scene = await DungeonScene.mount($("scene"), { reducedMotion: reduced, me: "u4" });
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
      const s = await DungeonScene.mount($("scene"), { reducedMotion: reduced, me: "u4" });
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
