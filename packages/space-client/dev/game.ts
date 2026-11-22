// Página de dev do Refúgio (ADR 0009, etapa E4): o mapa do Espaço e o jogo na
// mesma página, cada um com a sua Application do Pixi, contra o servidor de dev
// (packages/space-server/src/dev.ts). Nunca vai para produção.
//   http://127.0.0.1:5180/game.html?as=ana        (?stress=20 abre e fecha a cena 20× ao carregar)
import type { Rotation } from "@muchat/space-core";
import {
  type FightInput,
  type FightResult,
  type HeroView,
  lobbyCatalog,
  lobbyItemOf,
  lobbyPlacementError,
  lobbyPrice,
  placedCount,
  type RunView,
} from "@muchat/space-core/game";

import { SpaceView } from "../src/index.ts";
import { GameScene, type LobbyLook, type ReplaySpeed } from "../src/game/index.ts";

const DEV_SERVER_ID = "01JDEV0SRV0000000000000000";
const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const as = params.get("as") ?? "ana";
$("who").textContent = as;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const view = await SpaceView.mount({
  el: $("space"),
  baseUrl: location.origin,
  sessionToken: `dev-${as}-session-token`,
  serverId: DEV_SERVER_ID,
  client: "web",
  reducedMotion,
});

let scene = await GameScene.mount($("scene"), { reducedMotion });
let hero: HeroView | null = null;
let speed: ReplaySpeed = 1;
let fighting = false;
const log = (line: string, err = false) => {
  const el = document.createElement("div");
  if (err) el.className = "err";
  el.textContent = `${new Date().toLocaleTimeString()} ${line}`;
  $("log").prepend(el);
  while ($("log").childElementCount > 60) $("log").lastElementChild!.remove();
};

const lobbyOf = (h: HeroView): LobbyLook => ({ look: h.look, weapon: h.combat.weapon, tier: h.training.tier, items: h.lobby });

// ---- decoração do Refúgio (E4b) ----
let placing: string | null = null;
let rot: Rotation = 0;
function renderDecor() {
  const h = hero;
  $("placed").replaceChildren();
  $("shop").replaceChildren();
  if (!h) return;
  $("placing").textContent = placing ? `Colocando: ${lobbyItemOf(placing)?.name ?? placing} (giro ${rot}). Clique no quarto.` : "Escolha um item e clique no quarto.";
  for (const li of h.lobby) {
    const b = document.createElement("button");
    b.textContent = `tirar ${lobbyItemOf(li.item)?.name ?? li.item}`;
    b.onclick = () => view.gameSend("game.lobby.remove", { id: li.id });
    $("placed").append(b);
  }
  for (const it of lobbyCatalog()) {
    const have = h.decor_owned[it.id] ?? 0;
    const free = have - placedCount(h.lobby, it.id);
    const wrap = document.createElement("span");
    const buy = document.createElement("button");
    buy.textContent = `${it.name} — ${lobbyPrice(it)}`;
    buy.disabled = h.gold < lobbyPrice(it) || !!h.run;
    buy.onclick = () => view.gameSend("game.buy", { offer: "decor", qty: 1, item: it.id });
    wrap.append(buy);
    if (free > 0) {
      const put = document.createElement("button");
      put.textContent = `colocar (${free})`;
      put.onclick = () => {
        placing = it.id;
        rot = 0;
        renderDecor();
      };
      wrap.append(put);
    }
    $("shop").append(wrap);
  }
}
const sceneHost = $("scene");
sceneHost.addEventListener("pointermove", (ev) => {
  if (!placing || !hero || hero.run) return scene.setGhost(null);
  const t = scene.tileAt(ev.clientX, ev.clientY);
  if (!t) return scene.setGhost(null);
  const ok = lobbyPlacementError(hero.lobby, { item: placing, x: t.x, y: t.y, rot }) === null;
  scene.setGhost({ item: placing, rot, x: t.x, y: t.y, ok });
});
sceneHost.addEventListener("pointerleave", () => scene.setGhost(null));
sceneHost.addEventListener("click", (ev) => {
  if (!placing) return;
  const t = scene.tileAt(ev.clientX, ev.clientY);
  if (!t) return;
  view.gameSend("game.lobby.place", { item: placing, x: t.x, y: t.y, rot });
  placing = null;
  scene.setGhost(null);
});
$("cancelPlace").onclick = () => {
  placing = null;
  scene.setGhost(null);
  renderDecor();
};
$("rotate").onclick = () => {
  const it = placing ? lobbyItemOf(placing) : undefined;
  if (it) rot = ((rot + 1) % it.rotations) as Rotation;
  renderDecor();
};

function render() {
  const h = hero;
  $("create").replaceChildren();
  if (!h) {
    $("hero").textContent = "Sem herói. Escolha a classe:";
    for (const cls of ["cavaleiro", "arqueiro", "feiticeiro", "druida"]) {
      const b = document.createElement("button");
      b.textContent = cls;
      b.onclick = () => view.gameSend("game.create", { cls, look: { skin: 1, hair: 2, outfit: 0, trim: 1, cosmetic: null } });
      $("create").append(b);
    }
  } else {
    const main = h.training.skill;
    $("hero").innerHTML = "";
    const lines = [
      `${h.cls} · nível ${h.level} (${h.xp}/${h.xp_next}) · vida ${h.hp}/${h.max_hp} · mana ${h.mp}/${h.max_mp}`,
      `ouro ${h.gold} · poções ${h.potions} · boneco nível ${h.training.tier} treinando ${main} (${h.skills[main].l}, ${h.skills[main].p}/${h.skills[main].next})`,
      `vitórias ${h.stats.wins} · mortes ${h.stats.deaths} · maior degrau ${h.best} · iniciação ${h.initiation_done ? "feita" : "pendente"}`,
      h.last_run ? `última: ${h.last_run.end} (${h.last_run.degree}${h.last_run.initiation ? ", iniciação" : ""}) +${h.last_run.xp} exp, +${h.last_run.gold} ouro, ${h.last_run.items} itens` : "",
    ];
    for (const l of lines.filter(Boolean)) {
      const d = document.createElement("div");
      d.textContent = l;
      $("hero").append(d);
    }
  }
  renderRun(h?.run ?? null);
  renderDecor();
}

function renderRun(run: RunView | null) {
  $("choices").replaceChildren();
  ($("start") as HTMLButtonElement).disabled = !hero || !!run;
  ($("abandon") as HTMLButtonElement).disabled = !run;
  if (!run) {
    $("run").textContent = hero ? "No Refúgio." : "";
    return;
  }
  const row = run.row < 0 ? "entrada" : `linha ${run.row + 1} de ${run.map.length}`;
  $("run").textContent = `${run.initiation ? "Iniciação" : run.degree} · ${row} · vida ${run.hp}/${run.max_hp} · poções ${run.potions} · bolsa ${run.bag_gold} ouro, ${run.bag_items.length} itens`;
  const add = (label: string, t: string, d?: Record<string, unknown>) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => view.gameSend(t, d);
    $("choices").append(b);
  };
  const o = run.offer;
  if (o?.kind === "bencao") {
    o.boons.forEach((id, i) => add(`bênção: ${id}`, "game.run.choose", { option: i }));
    add("recusar", "game.run.choose", { option: -1 });
  } else if (o?.kind === "descanso") {
    add("curar", "game.run.choose", { option: 0 });
    add("afiar", "game.run.choose", { option: 1 });
    if (o.retreat) add("retirar-se", "game.run.retreat");
  } else if (o?.kind === "evento") {
    add(`${o.event}: aceitar`, "game.run.choose", { option: 0 });
    add("seguir", "game.run.choose", { option: 1 });
  } else {
    if (o?.kind === "loja") {
      add(`poção (${o.potionPrice})`, "game.run.choose", { option: 0 });
      add(`bênção (${o.boonPrice})`, "game.run.choose", { option: 1 });
    }
    const next = run.map[run.row + 1];
    for (const lane of run.lanes) add(`trilha ${lane + 1}: ${next?.[lane]?.type ?? "?"}`, "game.run.go", { lane });
  }
}

async function playFight(d: { input: FightInput; result: FightResult }) {
  fighting = true;
  log(`luta: ${d.input.foes.join(", ")} → ${d.result.won ? "vitória" : "derrota"} em ${(d.result.durationMs / 1000).toFixed(1)} s`);
  await scene.playFight(d.input, { speed, result: d.result, look: hero ? lobbyOf(hero) : undefined });
  fighting = false;
  if (hero && !hero.run) scene.showLobby(lobbyOf(hero));
}

view.onGame((e) => {
  if (e.t === "error") {
    const d = e.d as { code?: string; reason?: string; retry_after_ms?: number };
    log(`erro: ${d.code}${d.reason ? ` (${d.reason})` : ""}${d.retry_after_ms ? ` — espere ${d.retry_after_ms} ms` : ""}`, true);
    return;
  }
  if (e.t === "game.fight") {
    void playFight(e.d as { input: FightInput; result: FightResult });
    return;
  }
  hero = (e.d as { hero: HeroView | null }).hero;
  render();
  if (hero && !hero.run && !fighting) scene.showLobby(lobbyOf(hero));
});

let opened = false;
view.subscribe((s) => {
  if (s.status === "online" && !opened) {
    opened = true;
    log(`conectado · jogo ${s.game ? `disponível=${s.game.available} liberado=${s.game.enabled}` : "sem informação"}`);
    view.gameSend("game.open");
  }
});

$("start").onclick = () => {
  const v = ($("degree") as HTMLSelectElement).value;
  view.gameSend("game.run.start", { degree: v, ...(v === "abismo" ? { abyss: 1 } : {}) });
};
$("abandon").onclick = () => view.gameSend("game.run.abandon");
$("skip").onclick = () => scene.skip();
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  b.onclick = () => {
    speed = Number(b.dataset.speed) as ReplaySpeed;
    scene.setSpeed(speed);
  };
}
setInterval(() => ($("frames").textContent = String(scene.frameCount)), 500);

/** Abre e fecha a cena N vezes com o mapa vivo ao lado (o defeito de 14/11/2026). */
async function stress(n: number) {
  const t0 = performance.now();
  let errors = 0;
  const onErr = () => errors++;
  window.addEventListener("error", onErr);
  for (let i = 0; i < n; i++) {
    scene.destroy();
    scene = await GameScene.mount($("scene"), { reducedMotion });
    if (hero) scene.showLobby(lobbyOf(hero));
  }
  window.removeEventListener("error", onErr);
  const ms = Math.round(performance.now() - t0);
  const canvases = $("scene").querySelectorAll("canvas").length;
  const out = { n, ms, errors, canvases, mapCanvas: $("space").querySelectorAll("canvas").length };
  $("stressOut").textContent = JSON.stringify(out);
  log(`teste de abrir e fechar: ${JSON.stringify(out)}`);
  return out;
}
$("stress").onclick = () => void stress(20);

// Automação de dev (Playwright / painel do navegador): esta página nunca vai para produção.
(window as unknown as Record<string, unknown>).__game = {
  view,
  scene: () => scene,
  hero: () => hero,
  stress,
  send: (t: string, d?: Record<string, unknown>) => view.gameSend(t, d),
};
const auto = Number(params.get("stress") ?? 0);
if (auto > 0) void stress(auto);
