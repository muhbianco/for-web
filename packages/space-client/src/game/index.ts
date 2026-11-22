// Refúgio (docs/espaco ADR 0009 no overlay muchat): a cena do jogo e a reprise
// da luta. Subcaminho próprio (`@muchat/space-client/game`): o app só carrega
// isto quando o painel do jogo abre.
export { CLASS_COLOR, dummyCanvas, enemyCanvas, heroCanvas, heroPalette, HAIRS, OUTFITS, SKINS, TRIMS } from "./art.ts";
export { buildTimeline, type Frame, frameAt, REPLAY_SPEEDS, type ReplaySpeed, type Timeline } from "./replay.ts";
export { GAME_MAX_FPS, GameScene, type LobbyLook, type SceneLabels } from "./scene.ts";
