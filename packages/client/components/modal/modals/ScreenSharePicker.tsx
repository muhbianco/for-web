import { Trans, useLingui } from "@lingui/solid/macro";
import { createFormControl, createFormGroup } from "solid-forms";
import { For, Show, createMemo, createSignal } from "solid-js";
import { styled } from "styled-system/jsx";

import { useState } from "@revolt/state";
import { ScreenShareQualityName } from "@revolt/state/stores/Voice";
import { Dialog, DialogProps, Form2 } from "@revolt/ui";

import { Modals } from "../types";

export function ScreenSharePickerModal(
  props: DialogProps & Modals & { type: "screen_share_picker" },
) {
  const { voice } = useState();
  const { t } = useLingui();

  const group = createFormGroup({
    qualityName: createFormControl<ScreenShareQualityName>(
      voice.screenShareQuality || "low",
    ),
    audio: createFormControl(voice.screenShareAudio),
  });

  const windows = createMemo(() =>
    props.sources.filter((source) => !source.isFullScreen),
  );
  const screens = createMemo(() =>
    props.sources.filter((source) => source.isFullScreen),
  );
  const hasHigh = createMemo(() =>
    props.qualities.some((quality) => quality.name === "high"),
  );
  const hasText = createMemo(() =>
    props.qualities.some((quality) => quality.name === "text"),
  );

  const [tab, setTab] = createSignal<"apps" | "screens">(
    windows().length || !screens().length ? "apps" : "screens",
  );
  const [selectedIdx, setSelectedIdx] = createSignal<number | null>(null);
  const [fps, setFps] = createSignal(
    voice.screenShareQuality === "text" ? 5 : 30,
  );

  const visible = createMemo(() =>
    tab() === "apps" ? windows() : screens(),
  );

  function qualityFromUi(): ScreenShareQualityName {
    const current = group.controls.qualityName.value;
    if (current === "high" && !hasHigh()) return "low";
    if (current === "text" && !hasText()) return "low";
    return current;
  }

  async function onSubmit() {
    const idx = selectedIdx();
    if (!Number.isInteger(idx) || idx === null || idx < 0) return;

    const qualityName = qualityFromUi();
    const audio = group.controls.audio.value;
    const frameRate = qualityName === "text" ? 5 : fps();

    voice.screenShareQuality = qualityName;
    voice.screenShareAudio = audio;

    props.callback(idx, qualityName, audio, frameRate);
    props.onClose();
  }

  return (
    <Dialog
      minWidth={680}
      show={props.show}
      onClose={() => {
        props.onCancel();
        props.onClose();
      }}
      title={t`Compartilhar tela`}
    >
      <Layout>
        <Tabs>
          <Tab
            type="button"
            active={tab() === "apps"}
            onClick={() => setTab("apps")}
          >
            <Trans>Aplicativos</Trans>
          </Tab>
          <Tab
            type="button"
            active={tab() === "screens"}
            onClick={() => setTab("screens")}
          >
            <Trans>Telas</Trans>
          </Tab>
        </Tabs>

        <Show
          when={visible().length}
          fallback={
            <Status>
              <Trans>Nada para mostrar nesta aba.</Trans>
            </Status>
          }
        >
          <Grid>
            <For each={visible()}>
              {(source) => (
                <Item
                  type="button"
                  selected={selectedIdx() === source.idx}
                  onClick={() => setSelectedIdx(source.idx)}
                >
                  <Show
                    when={source.image}
                    fallback={
                      <Placeholder>
                        {tab() === "screens" ? (
                          <Trans>Tela</Trans>
                        ) : (
                          <Trans>Janela</Trans>
                        )}
                      </Placeholder>
                    }
                  >
                    <Thumb src={source.image} alt="" />
                  </Show>
                  <span>{source.name}</span>
                </Item>
              )}
            </For>
          </Grid>
        </Show>

        <Foot>
          <Quality>
            <label>
              <Trans>Quality</Trans>
              <select
                value={group.controls.qualityName.value}
                onChange={(event) => {
                  const next = event.currentTarget
                    .value as ScreenShareQualityName;
                  group.controls.qualityName.setValue(next);
                  if (next === "text") setFps(5);
                  else if (fps() === 5) setFps(30);
                }}
              >
                <option value="low">720p</option>
                <Show when={hasHigh()}>
                  <option value="high">1080p</option>
                </Show>
                <Show when={hasText()}>
                  <option value="text">Source</option>
                </Show>
              </select>
            </label>
            <label>
              <Trans>FPS</Trans>
              <select
                value={String(fps())}
                disabled={group.controls.qualityName.value === "text"}
                onChange={(event) =>
                  setFps(Number(event.currentTarget.value) || 30)
                }
              >
                <option value="15">15</option>
                <option value="30">30</option>
                <option value="60">60</option>
              </select>
            </label>
            <Form2.Checkbox control={group.controls.audio}>
              <Trans>Share audio</Trans>
            </Form2.Checkbox>
          </Quality>
          <Actions>
            <Ghost
              type="button"
              onClick={() => {
                props.onCancel();
                props.onClose();
              }}
            >
              <Trans>Cancel</Trans>
            </Ghost>
            <Live
              type="button"
              disabled={selectedIdx() === null}
              onClick={() => void onSubmit()}
            >
              <Trans>Go Live</Trans>
            </Live>
          </Actions>
        </Foot>
      </Layout>
    </Dialog>
  );
}

const Layout = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minWidth: "min(640px, 70vw)",
  },
});

const Tabs = styled("div", {
  base: {
    display: "flex",
    gap: "8px",
  },
});

const Tab = styled("button", {
  base: {
    border: 0,
    cursor: "pointer",
    font: "inherit",
    padding: "8px 12px",
    borderRadius: "8px",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-container-highest)",
  },
  variants: {
    active: {
      true: {
        color: "var(--md-sys-color-on-surface)",
        background: "var(--md-sys-color-surface-container)",
      },
    },
  },
});

const Grid = styled("div", {
  base: {
    display: "grid",
    gap: "10px",
    maxHeight: "42vh",
    overflowY: "auto",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  },
});

const Item = styled("button", {
  base: {
    border: 0,
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    overflow: "hidden",
    borderRadius: "8px",
    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-highest)",
    "& span": {
      display: "block",
      padding: "8px 10px 10px",
      fontSize: "12px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
  },
  variants: {
    selected: {
      true: {
        outline: "2px solid #e85a2a",
      },
    },
  },
});

const Thumb = styled("img", {
  base: {
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    objectFit: "cover",
    background: "#0d0c0b",
  },
});

const Placeholder = styled("div", {
  base: {
    display: "grid",
    width: "100%",
    aspectRatio: "16 / 9",
    placeItems: "center",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "#0d0c0b",
    fontSize: "12px",
  },
});

const Status = styled("p", {
  base: {
    margin: "8px 0 4px",
    color: "var(--md-sys-color-on-surface-variant)",
    lineHeight: 1.45,
  },
});

const Foot = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "4px",
  },
});

const Quality = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
    "& label": {
      display: "flex",
      gap: "8px",
      alignItems: "center",
    },
    "& select": {
      font: "inherit",
      color: "var(--md-sys-color-on-surface)",
      background: "var(--md-sys-color-surface-container-highest)",
      border: "1px solid var(--md-sys-color-outline-variant)",
      borderRadius: "8px",
      padding: "6px 8px",
    },
  },
});

const Actions = styled("div", {
  base: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
});

const Ghost = styled("button", {
  base: {
    border: 0,
    cursor: "pointer",
    font: "inherit",
    padding: "8px 14px",
    borderRadius: "8px",
    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-highest)",
  },
});

const Live = styled("button", {
  base: {
    border: 0,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 700,
    padding: "8px 14px",
    borderRadius: "8px",
    color: "#141210",
    background: "#e85a2a",
    "&:disabled": {
      opacity: 0.45,
      cursor: "default",
    },
  },
});
