import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { type RunState, avatarGearOf } from "@muchat/space-client";
import type { DungeonRun, DungeonScene } from "@muchat/space-client/game";
import { defaultPalette } from "@muchat/space-core";
import { styled } from "styled-system/jsx";

/** Uma tarefa nova (o import, o init do Pixi e a 1ª corrida não cabem numa tarefa só). */
const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A dungeon vista de cima na tela da corrida (Pixi próprio, sob demanda; space-client/game). É o
 * "juice" da corrida: golpes, tiros, números e quedas animados a cada segundo. Sem WebGL (ou se o
 * módulo não carregar) some, e a tela segue com as barras. "Reduzir movimento" vale.
 */
export function RunScene(props: {
  state: RunState;
  myId: string | null;
  paletteOf?: (userId: string) => number;
}) {
  let host: HTMLDivElement | undefined;
  const [scene, setScene] = createSignal<DungeonScene | null>(null);
  const [failed, setFailed] = createSignal(false);
  onMount(() => {
    let alive = true;
    let mounted: DungeonScene | null = null;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      if (mounted) mounted.reducedMotion = !!motion?.matches;
    };
    motion?.addEventListener?.("change", onMotion);
    const me = props.myId;
    nextTask()
      .then(() => import("@muchat/space-client/game"))
      .then(async ({ DungeonScene }) => {
        if (!alive || !host) return null;
        const s = await DungeonScene.mount(host, {
          reducedMotion: !!motion?.matches,
          me,
        });
        await nextTask();
        return s;
      })
      .then(
        (s) => {
          if (!s) return;
          if (!alive) return s.destroy();
          mounted = s;
          setScene(s);
        },
        (err: unknown) => {
          console.warn("[espaço] cena da dungeon indisponível", err);
          if (alive) setFailed(true);
        },
      );
    onCleanup(() => {
      alive = false;
      motion?.removeEventListener?.("change", onMotion);
      mounted?.destroy();
      setScene(null);
    });
  });
  // Memos antes do efeito: o estado muda a cada atualização, o quadro só por segundo.
  const runM = createMemo(() => props.state.run);
  const frameM = createMemo(() => props.state.frame);
  const endM = createMemo(() => props.state.end?.outcome ?? null);
  createEffect(() => {
    const s = scene();
    if (!s) return;
    const r = runM();
    const sceneRun: DungeonRun = {
      id: r.id,
      dungeon: r.dungeon,
      members: r.members.map((m) => ({
        userId: m.user_id,
        name: m.name,
        cls: m.cls,
        healthMax: m.hp_max,
        palette: props.paletteOf?.(m.user_id) ?? defaultPalette(m.user_id),
        gear: avatarGearOf(m.equipment),
      })),
    };
    s.show(sceneRun, frameM(), endM());
  });
  return (
    <Show when={!failed()}>
      <Stage ref={host} aria-hidden="true" />
    </Show>
  );
}

const Stage = styled("div", {
  base: {
    // A proporção da sala (15 × 9) sempre; a altura limita a largura (o canvas não estica).
    width: "100%",
    aspectRatio: "15 / 9",
    maxWidth: "calc(42vh * 15 / 9)",
    marginInline: "auto",
    // No celular a cena divide a tela com o grupo e o chefe: mais baixa.
    "@media (max-width: 600px)": { maxWidth: "calc(28vh * 15 / 9)" },
    borderRadius: "12px",
    overflow: "hidden",
    background: "#0f1015",
    border: "1px solid var(--md-sys-color-outline-variant)",
    "& canvas": {
      width: "100% !important",
      height: "100% !important",
      imageRendering: "pixelated",
    },
  },
});
