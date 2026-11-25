/**
 * Carga da corrida da dungeon para o laboratório de voz (muchat/docs/espaco/jogo/ot): a tela da
 * corrida de verdade (RunPanel, com o CSS e as traduções do app, e a dungeon vista de cima no Pixi
 * próprio) na mesma página que fala, recebendo um quadro por segundo como o app recebe do servidor.
 * Uma corrida atrás da outra com o painel sempre aberto: o pior caso do jogo no app (no uso normal
 * o painel fecha e as corridas param). Desde o Idle Hunt v5 (25/11/2026) a corrida sai do motor
 * novo (`simulateRun` com `record`). O run.mjs carrega este módulo pelo vite do app com `--run-load`.
 */
import "../../src/index.css";

import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";

import { type RunState, applyFrames, runStateFrom } from "@muchat/space-client";
import {
  type ClassId,
  type HeroV5,
  type RpgRunView,
  type RunResult,
  balanceHero,
  createHero,
  dungeonById,
  heroDerived,
  heroRunFighter,
  simulateRun,
} from "@muchat/space-core/game/ot/balance";

import { I18nProvider } from "../../components/i18n";
import RunPanel from "../../components/space/game/RunPanel";

const DUNGEON = "masmorra-40";
/** Cada herói com uma paleta do Espaço, como as pessoas de verdade. */
const PALETTES: Record<string, number> = { u1: 6, u2: 3, u3: 5, u4: 0 };

let uid = 0;
function hero(cls: ClassId, name: string): HeroV5 & { name: string } {
  const h = createHero(cls, () => `l${uid++}`);
  return {
    ...h,
    level: 45,
    proficiency: 450,
    potions: {
      hp: { pequena: 100, media: 0, grande: 0 },
      mp: { pequena: 100, media: 0, grande: 0 },
    },
    name,
  };
}

// Grupo completo: 4 heróis, o registro mais cheio.
const PARTY = [
  hero("guerreiro", "Cavaleira"),
  hero("padre", "Padre"),
  hero("cacador", "Arqueiro"),
  hero("mago", "Feiticeira"),
];

/** Nada sai da página: os comandos da tela da corrida (sair) caem aqui. */
const LINK = {
  gameSend: () => "x",
  onGame: () => () => undefined,
};

function simulate(seed: number): RunResult {
  let s = seed;
  const random = {
    next: () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296,
  };
  return simulateRun(
    dungeonById(DUNGEON)!,
    PARTY.map((h) => heroRunFighter(h)),
    { mode: "aleatorio", random, record: true },
  );
}

export async function startRunLoad(): Promise<string> {
  const { DungeonScene } = await import("@muchat/space-client/game");
  const host = document.createElement("div");
  // O painel no tamanho de um desktop.
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
              hero={null}
              link={LINK}
              lobby={null}
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
  let result = simulate(seed);
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
      auto: false,
      members: PARTY.map((h, i) => ({
        user_id: `u${i + 1}`,
        name: h.name,
        cls: h.cls,
        level: h.level,
        hp_max: Math.round(heroDerived(balanceHero(h)).hp),
        mp_max: Math.round(heroDerived(balanceHero(h)).mp),
        equipment: h.equipment,
        skills: h.skills.slots.map((id) => ({ id, mana: 0, cd_ms: 0 })),
        supplies: h.supplies,
        belt: h.belt,
        potions: { hp: 100, mp: 100 },
      })),
    };
  };
  newView();
  let st = runStateFrom({ run: view!, frame: null, feed: [] });

  // Um quadro por segundo, como o rpg.run.tick do servidor; no fim, o resumo por 3 s e outra.
  const timer = setInterval(() => {
    const t1 = performance.now();
    const list = result.frames ?? [];
    if (sec < list.length) {
      st = applyFrames(st, [list[sec]!]);
      setState(st);
      frames++;
    } else if (sec === list.length) {
      st = {
        ...st,
        end: {
          outcome: result.outcome,
          members: view.members.map((m, i) => ({
            user_id: m.user_id,
            dead: !result.heroes[i]?.alive,
            retreated: false,
            reward: {
              xp: st.xp[i] ?? 0,
              job_xp: 0,
              gold: 0,
              items: [],
              ores: {},
              stones: 0,
            },
            left: [],
            potions_used: { hp: 0, mp: 0 },
            ammo_used: 0,
            levels_gained: 0,
            jobs_gained: 0,
          })),
        },
      };
      setState(st);
    } else if (sec >= list.length + 3) {
      runs++;
      seed++;
      result = simulate(seed);
      newView();
      st = runStateFrom({ run: view, frame: null, feed: [] });
      sec = -1;
    }
    sec++;
    const ms = performance.now() - t1;
    updateMsMax = Math.max(updateMsMax, ms);
    updateMsSum += ms;
  }, 1000);

  (window as unknown as Record<string, unknown>).__runLoad = {
    stats: () => ({
      runs,
      frames,
      updateMsAvg: frames ? Math.round((updateMsSum / frames) * 100) / 100 : 0,
      updateMsMax: Math.round(updateMsMax * 100) / 100,
      panel: !!host.querySelector("[role=dialog]"),
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
