/**
 * Carga da corrida da dungeon para o laboratório de voz (etapas O6 e O10,
 * muchat/docs/espaco/jogo/ot): a tela da aventura de verdade (RunPanel, com o CSS e as
 * traduções do app) na mesma página que fala, recebendo um quadro por segundo como o app
 * recebe do servidor. Desde a O10 o painel monta a dungeon vista de cima (DungeonScene, Pixi
 * próprio) num tamanho de desktop, e cada segundo anima ~0,8 s a até 30 quadros/s. Uma corrida
 * atrás da outra com o painel sempre aberto: o pior caso do jogo novo no app (no uso normal o
 * painel fecha e as corridas param). O run.mjs carrega este módulo pelo vite do app com
 * `--run-load`.
 */
import "../../src/index.css";

import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";

import type { RunState } from "@muchat/space-client";
import {
  type RpgRunFeedItem,
  type RpgRunView,
  type RunHero,
  type SkillId,
  type VocationId,
  START,
  VOCATIONS,
  addExperience,
  bestGear,
  expForLevel,
  simulateRun,
} from "@muchat/space-core/game/ot";

import { I18nProvider } from "../../components/i18n";
import RunPanel from "../../components/space/game/RunPanel";

const DUNGEON = "galerias-afogadas";
/** Cada herói com uma paleta do Espaço, como as pessoas de verdade. */
const PALETTES: Record<string, number> = { u1: 6, u2: 3, u3: 5, u4: 0 };

function hero(
  vocation: VocationId,
  level: number,
  skill: number,
  ml: number,
  owned: string[],
): RunHero {
  const voc = VOCATIONS[vocation];
  const st = addExperience(
    voc,
    {
      level: 1,
      experience: 0,
      healthMax: START.health,
      manaMax: START.mana,
      cap: START.cap,
    },
    expForLevel(level),
  );
  const skills = {
    punhos: 10,
    maca: 10,
    espada: 10,
    machado: 10,
    distancia: 10,
    escudo: 10,
  } as Record<SkillId, number>;
  if (voc.base === 4) {
    skills.espada = skill;
    skills.escudo = skill;
  }
  if (voc.base === 3) skills.distancia = skill;
  return {
    userId: `u${vocation}`,
    name: ["", "Feiticeira", "Druida", "Arqueiro", "Cavaleira"][vocation]!,
    vocation,
    level: st.level,
    healthMax: st.healthMax,
    manaMax: st.manaMax,
    skills,
    magicLevel: ml,
    stamina: 2520,
    gear: bestGear(vocation, st.level, skills, st.manaMax, owned),
  };
}

// Grupo completo de level 20: 4 heróis e salas de 6 a 8 monstros, o registro mais cheio.
const PARTY = [
  hero(4, 20, 55, 4, [
    "espada-larga",
    "escudo-de-aco",
    "cota-de-malha",
    "calca-de-malha",
  ]),
  hero(2, 20, 10, 30, ["varinha-de-geada", "manto-azul"]),
  hero(3, 20, 55, 8, ["arco-composto", "cota-de-malha"]),
  hero(1, 20, 10, 30, ["varinha-de-geada", "manto-azul"]),
];

export async function startRunLoad(): Promise<string> {
  const { DungeonScene } = await import("@muchat/space-client/game");
  const host = document.createElement("div");
  // O painel com a cena no tamanho de um desktop (780 px de largura, cena ~500 × 300).
  host.style.cssText =
    "position:fixed;right:0;bottom:0;width:820px;height:640px;z-index:10";
  document.body.appendChild(host);
  const [state, setState] = createSignal<RunState | null>(null);
  const dispose = render(
    () => (
      <I18nProvider>
        <Show when={state()}>
          {(s) => (
            <RunPanel
              state={s()}
              myId="u4"
              onClose={() => undefined}
              paletteOf={(id) => PALETTES[id] ?? 0}
            />
          )}
        </Show>
      </I18nProvider>
    ),
    host,
  );

  const t0 = performance.now();
  const drawn0 = DungeonScene.drawn;
  let runs = 0;
  let frames = 0;
  let updateMsMax = 0;
  let updateMsSum = 0;
  let seed = 1;
  let result = simulateRun({
    seed,
    dungeon: DUNGEON,
    heroes: PARTY,
    rateLoot: 2,
  });
  let sec = 0;
  let view: RpgRunView;
  const newView = () => {
    const now = Date.now();
    view = {
      id: `run-${seed}`,
      tv: "tv",
      room: "R",
      dungeon: DUNGEON,
      started_at: now,
      ends_at: now + result.seconds * 1000,
      members: PARTY.map((h) => ({
        user_id: h.userId,
        name: h.name,
        vocation: h.vocation,
        level: h.level,
        health_max: h.healthMax,
        mana_max: h.manaMax,
        gear: h.gear,
      })),
    };
  };
  newView();
  let feed: RpgRunFeedItem[] = [];

  // Um quadro por segundo, como o rpg.run.tick do servidor; no fim, o resumo por 3 s e outra.
  const timer = setInterval(() => {
    const t0 = performance.now();
    if (sec < result.frames.length) {
      const f = result.frames[sec]!;
      for (const ev of f.e) feed.push({ ...ev, at: f.s, st: f.st });
      feed = feed.slice(-40);
      setState({ run: view, frame: f, feed, end: null });
      frames++;
    } else if (sec === result.frames.length) {
      setState({
        run: view,
        frame: result.frames[result.frames.length - 1]!,
        feed,
        end: {
          outcome: result.outcome,
          members: PARTY.map((h, i) => ({
            user_id: h.userId,
            dead: result.members[i]!.dead,
            reward: {
              exp: result.members[i]!.exp * 5,
              gold: result.members[i]!.gold,
              loot: result.members[i]!.loot,
              tries: result.members[i]!.tries,
              mana_spent: result.members[i]!.manaSpent,
            },
          })),
        },
      });
    } else if (sec >= result.frames.length + 3) {
      runs++;
      seed++;
      result = simulateRun({
        seed,
        dungeon: DUNGEON,
        heroes: PARTY,
        rateLoot: 2,
      });
      newView();
      feed = [];
      sec = -1;
    }
    sec++;
    const ms = performance.now() - t0;
    updateMsMax = Math.max(updateMsMax, ms);
    updateMsSum += ms;
  }, 1000);

  (window as unknown as Record<string, unknown>).__runLoad = {
    stats: () => ({
      runs,
      frames,
      updateMsAvg: frames ? Math.round((updateMsSum / frames) * 100) / 100 : 0,
      updateMsMax: Math.round(updateMsMax * 100) / 100,
      panel: !!host.querySelector("[role=region]"),
      scene: !!host.querySelector("canvas"),
      sceneFrames: DungeonScene.drawn - drawn0,
      sceneFps:
        Math.round(
          ((DungeonScene.drawn - drawn0) / ((performance.now() - t0) / 1000)) *
            10,
        ) / 10,
    }),
    stop: () => {
      clearInterval(timer);
      dispose();
      host.remove();
    },
  };
  return "corrida ok";
}
