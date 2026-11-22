/**
 * Carga do Refúgio para o laboratório de voz (ADR 0009, etapa E6): a cena de
 * verdade do jogo (`@muchat/space-client/game`) na mesma página que fala, passando
 * uma luta de chefe atrás da outra a 1× — animação contínua a 30 quadros/s, o
 * pior caso (no uso real a cena fica parada a maior parte do tempo). O run.mjs
 * carrega este módulo pelo vite do app com `--game-load`.
 */
import { GameScene } from "@muchat/space-client/game";
import {
  type FightInput,
  type HeroCore,
  DEFAULT_TACTICS,
  GAME_ENGINE,
  NO_BOONS,
  SKILL_IDS,
  SLOTS,
  baseItem,
  heroCombat,
} from "@muchat/space-core/game";

function hero() {
  const skills = Object.fromEntries(
    SKILL_IDS.map((s) => [s, { l: 30, p: 0 }]),
  ) as HeroCore["skills"];
  const gear: HeroCore["gear"] = {};
  for (const slot of SLOTS)
    gear[slot] = baseItem(`g${slot}`, slot, "raro", 18, "druida");
  return heroCombat({ cls: "druida", level: 18, skills, gear });
}

export async function startGameLoad(): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;right:0;bottom:0;width:400px;height:264px;z-index:10";
  document.body.appendChild(host);
  const scene = await GameScene.mount(host);
  const hc = hero();
  let fights = 0;
  let stopped = false;
  const started = performance.now();
  const input = (seed: number): FightInput => ({
    engine: GAME_ENGINE,
    seed,
    hero: hc,
    hp: 99_999,
    mp: 99_999,
    potions: 3,
    boons: { ...NO_BOONS, echoBp: 2500 },
    tactics: { ...DEFAULT_TACTICS, order: [] },
    // O chefe chama ratos no meio: mais sprites, barras e números na tela.
    foes: ["matriarca"],
    degree: "dificil",
    abyss: 1,
    foePct: 100,
  });
  void (async () => {
    while (!stopped) {
      await scene.playFight(input(fights + 1), { speed: 1 });
      fights++;
    }
  })();
  (window as unknown as Record<string, unknown>).__gameLoad = {
    stats: () => ({
      fights,
      frames: scene.frameCount,
      fps:
        Math.round(
          (scene.frameCount / ((performance.now() - started) / 1000)) * 10,
        ) / 10,
    }),
    stop: () => {
      stopped = true;
      scene.destroy();
    },
  };
  return "jogo ok";
}
