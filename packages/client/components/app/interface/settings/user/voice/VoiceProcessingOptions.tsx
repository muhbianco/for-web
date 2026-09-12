import { Trans, useLingui } from "@lingui/solid/macro";
import { For, JSX, Show } from "solid-js";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import type { VoiceEngineId } from "@revolt/rtc/voiceEngineStatus";
import { useState } from "@revolt/state";
import type {
  DeepFilterSensitivity,
  NoiseSuppresionState,
} from "@revolt/state/stores/Voice";
import {
  DEEPFILTER_ATTEN_DB,
  DEEPFILTER_AUTO_LOUD_FLOOR_DBFS,
  DEEPFILTER_AUTO_QUIET_FLOOR_DBFS,
  rmsToMeter,
} from "@revolt/state/stores/noiseSuppressionPolicy";
import { CategoryButton, Checkbox, Column, Slider, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Voice processing options: noise suppression engine, DeepFilter strength,
 * microphone sensitivity (gate) and a live diagnostics card.
 */
export function VoiceProcessingOptions() {
  const { voice } = useState();
  const rtc = useVoice();
  const status = () => rtc.engineStatus();
  const isDeepFilterSelected = () => voice.noiseSupression === "advanced";
  const deepFilterLive = () =>
    status().inCall && status().engine === "deepfilter";

  return (
    <Column gap="lg">
      <NoiseSuppressionSection />
      <Show when={isDeepFilterSelected()}>
        <DeepFilterStrengthSection />
        <MicrophoneSensitivitySection live={deepFilterLive()} />
      </Show>
      <DiagnosticsSection />
    </Column>
  );
}

export function SectionHeader(props: {
  title: JSX.Element;
  description?: JSX.Element;
}) {
  return (
    <Column gap="xs">
      <Text class="title">{props.title}</Text>
      <Show when={props.description}>
        <Text class="label" size="small">
          {props.description}
        </Text>
      </Show>
    </Column>
  );
}

function NoiseSuppressionSection() {
  const { voice } = useState();

  return (
    <Column gap="sm">
      <SectionHeader
        title={<Trans>Noise suppression</Trans>}
        description={
          <Trans>
            Changes what other people hear from you, not what you hear from
            them. Only one suppressor runs at a time.
          </Trans>
        }
      />
      <CategoryButton.Group>
        <CategoryButton.Select<NoiseSuppresionState>
          icon={<Symbol>graphic_eq</Symbol>}
          title={<Trans>Engine</Trans>}
          options={{
            advanced: {
              title: <Trans>DeepFilterNet (recommended)</Trans>,
              description: (
                <Trans>
                  Best against keyboard, fans and TV in the background. Uses
                  more CPU and falls back to RNNoise on weaker devices.
                </Trans>
              ),
              shortDesc: <Trans>DeepFilterNet (recommended)</Trans>,
            },
            enhanced: {
              title: <Trans>Enhanced</Trans>,
              description: <Trans>Powered by RNNoise. Light on CPU.</Trans>,
              shortDesc: <Trans>Enhanced (RNNoise)</Trans>,
            },
            browser: {
              title: <Trans>Browser</Trans>,
              description: (
                <Trans>Built-in browser noise suppression only.</Trans>
              ),
            },
            disabled: {
              title: <Trans>Disabled</Trans>,
              description: <Trans>Send the raw microphone signal.</Trans>,
            },
          }}
          value={voice.noiseSupression ?? "advanced"}
          onUpdate={(ns) => (voice.noiseSupression = ns)}
        />
        <CategoryButton
          icon={<Symbol>spatial_audio_off</Symbol>}
          description={
            <Trans>
              Stops your speakers from being heard through your mic.
            </Trans>
          }
          action={<Checkbox checked={voice.echoCancellation} />}
          onClick={() => (voice.echoCancellation = !voice.echoCancellation)}
        >
          <Trans>Echo cancellation</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>volume_up</Symbol>}
          description={
            <Trans>
              Browser volume levelling. Ignored while DeepFilterNet or RNNoise
              is active, since it would boost the residual noise.
            </Trans>
          }
          action={<Checkbox checked={voice.autoGainControl} />}
          onClick={() => (voice.autoGainControl = !voice.autoGainControl)}
        >
          <Trans>Automatic gain control</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}

function DeepFilterStrengthSection() {
  const { voice } = useState();
  const { t } = useLingui();

  const fixed = (level: keyof typeof DEEPFILTER_ATTEN_DB) =>
    t`Up to ${DEEPFILTER_ATTEN_DB[level]} dB of noise removed.`;

  return (
    <Column gap="sm">
      <SectionHeader
        title={<Trans>DeepFilterNet strength</Trans>}
        description={
          <Trans>
            How aggressively background noise is removed. Stronger settings
            remove more noise but can make your voice sound less natural.
          </Trans>
        }
      />
      <CategoryButton.Group>
        <CategoryButton.Select<DeepFilterSensitivity>
          icon={<Symbol>tune</Symbol>}
          title={<Trans>Strength</Trans>}
          options={{
            auto: {
              title: <Trans>Automatic (recommended)</Trans>,
              description: (
                <Trans>
                  Measures your background noise while you are silent and
                  adjusts the strength and the microphone threshold for you.
                </Trans>
              ),
              shortDesc: <Trans>Automatic (recommended)</Trans>,
            },
            light: {
              title: <Trans>Light (quiet room)</Trans>,
              description: (
                <>
                  {t`Keeps your voice the most natural.`} {fixed("light")}
                </>
              ),
            },
            medium: {
              title: <Trans>Medium (home office)</Trans>,
              description: (
                <>
                  {t`Balanced removal for everyday calls.`} {fixed("medium")}
                </>
              ),
            },
            strong: {
              title: <Trans>Strong (noisy place)</Trans>,
              description: (
                <>
                  {t`Fans, street, other people talking.`} {fixed("strong")}
                </>
              ),
            },
          }}
          value={voice.deepFilterSensitivity ?? "auto"}
          onUpdate={(level) => (voice.deepFilterSensitivity = level)}
        />
      </CategoryButton.Group>
    </Column>
  );
}

function MicrophoneSensitivitySection(props: { live: boolean }) {
  const { voice } = useState();
  const rtc = useVoice();
  const status = () => rtc.engineStatus();
  const auto = () => voice.deepFilterSensitivity === "auto";

  const meterLevel = () => {
    if (!props.live) return 0;
    return rmsToMeter(status().inputRms ?? 0);
  };

  const meterThreshold = () => {
    const liveThreshold = status().gateOpenThreshold;
    if (auto() && liveThreshold !== undefined) {
      return rmsToMeter(liveThreshold);
    }
    return voice.inputSensitivity;
  };

  return (
    <Column gap="sm">
      <SectionHeader
        title={<Trans>Microphone sensitivity</Trans>}
        description={
          <Trans>
            Sound louder than the marker is sent to others; anything quieter is
            muted. Speak normally and check that the bar passes the marker.
          </Trans>
        }
      />
      <Card>
        <CardRow>
          <Text class="label">
            <Trans>Your microphone</Trans>
          </Text>
          <Text class="label" size="small">
            <Show
              when={props.live}
              fallback={<Trans>Join a voice call to see the live meter.</Trans>}
            >
              <Show
                when={status().gateOpen}
                fallback={<Trans>Muted by the gate</Trans>}
              >
                <Trans>Being sent</Trans>
              </Show>
            </Show>
          </Text>
        </CardRow>
        <MeterTrack
          role="meter"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={meterLevel()}
        >
          <MeterFill
            data-open={status().gateOpen ? "true" : "false"}
            style={{ width: `${Math.round(meterLevel() * 100)}%` }}
          />
          <MeterMark
            style={{ left: `${Math.round(meterThreshold() * 100)}%` }}
          />
        </MeterTrack>
        <Show
          when={!auto()}
          fallback={
            <Text class="label" size="small">
              <Trans>
                The marker follows your background noise automatically. Pick
                Light, Medium or Strong above to set it by hand.
              </Trans>
            </Text>
          }
        >
          <Column gap="xs">
            <Text class="label" size="small">
              <Trans>Threshold</Trans>
            </Text>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={voice.inputSensitivity}
              onInput={(event) =>
                (voice.inputSensitivity = Number(event.currentTarget.value))
              }
              labelFormatter={(label) => (label * 100).toFixed(0) + "%"}
            />
            <SensitivityLabels>
              <Text class="label" size="small">
                <Trans>Picks up whispers</Trans>
              </Text>
              <Text class="label" size="small">
                <Trans>Only loud speech</Trans>
              </Text>
            </SensitivityLabels>
          </Column>
        </Show>
      </Card>
    </Column>
  );
}

function DiagnosticsSection() {
  const { t } = useLingui();
  const rtc = useVoice();
  const status = () => rtc.engineStatus();

  const engineLabel = (engine: VoiceEngineId) => {
    switch (engine) {
      case "deepfilter":
        return "DeepFilterNet";
      case "rnnoise":
        return "RNNoise";
      case "browser-ns":
        return t`Browser`;
      case "bypass":
        return t`Off`;
      default:
        return t`Not in a call`;
    }
  };

  const yesNo = (value: boolean | undefined) => {
    if (value === undefined) return "—";
    return value ? t`On` : t`Off`;
  };

  const noiseFloorLabel = () => {
    const floor = status().noiseFloorDb;
    if (floor === undefined) return "—";
    const rounded = Math.round(floor);
    if (floor <= DEEPFILTER_AUTO_QUIET_FLOOR_DBFS) {
      return t`Quiet (${rounded} dBFS)`;
    }
    if (floor >= DEEPFILTER_AUTO_LOUD_FLOOR_DBFS) {
      return t`Loud (${rounded} dBFS)`;
    }
    return t`Moderate (${rounded} dBFS)`;
  };

  /** Slowest DeepFilter frame in the last second and how many were slow. */
  const frameTimeLabel = () => {
    const current = status();
    if (current.deepFilterMaxFrameMs === undefined) return "—";
    const slowPct = Math.round((current.deepFilterSlowRatio ?? 0) * 100);
    const maxMs = current.deepFilterMaxFrameMs;
    return slowPct > 0
      ? t`max ${maxMs} ms (${slowPct}% slow)`
      : t`max ${maxMs} ms`;
  };

  const rows = (): { label: string; value: string }[] => {
    const current = status();
    const list = [
      { label: t`Engine`, value: engineLabel(current.engine) },
      {
        label: t`Sample rate`,
        value: current.sampleRate ? `${current.sampleRate} Hz` : "—",
      },
    ];
    if (current.engine === "deepfilter") {
      list.push({
        label: t`Noise removed`,
        value:
          current.deepFilterAttenDb !== undefined
            ? t`up to ${current.deepFilterAttenDb} dB`
            : "—",
      });
      list.push({ label: t`Background noise`, value: noiseFloorLabel() });
      list.push({ label: t`Frame time`, value: frameTimeLabel() });
    }
    list.push(
      {
        label: t`Microphone channels`,
        value:
          current.inputChannelCount !== undefined
            ? String(current.inputChannelCount)
            : "—",
      },
      {
        label: t`Browser noise suppression`,
        value: yesNo(current.noiseSuppression),
      },
      {
        label: t`Browser gain control`,
        value: yesNo(current.autoGainControl),
      },
      {
        label: t`Echo cancellation`,
        value: yesNo(current.echoCancellation),
      },
    );
    return list;
  };

  const fallbackActive = () =>
    status().inCall &&
    status().selectedMode === "advanced" &&
    status().engine !== "deepfilter";

  return (
    <Column gap="sm">
      <SectionHeader
        title={<Trans>What is running right now</Trans>}
        description={
          <Trans>Live view of the audio chain while you are in a call.</Trans>
        }
      />
      <Card>
        <Show
          when={status().inCall}
          fallback={
            <Text class="label" size="small">
              <Trans>
                Join a voice call to see the live engine. Your choices above are
                saved and applied when you connect.
              </Trans>
            </Text>
          }
        >
          <For each={rows()}>
            {(row) => (
              <CardRow>
                <Text class="label" size="small">
                  {row.label}
                </Text>
                <Text class="label">{row.value}</Text>
              </CardRow>
            )}
          </For>
          <Show when={fallbackActive()}>
            <Notice>
              <Symbol size={18}>info</Symbol>
              <Text class="label" size="small">
                <Show
                  when={status().deepFilterOverloaded}
                  fallback={
                    <Trans>
                      DeepFilterNet could not start on this device, so RNNoise
                      is running instead. You still have a single noise
                      suppressor.
                    </Trans>
                  }
                >
                  <Trans>
                    DeepFilterNet could not keep up with your CPU during this
                    call, so RNNoise took over. Rejoin the call to try
                    DeepFilterNet again.
                  </Trans>
                </Show>
                <Show when={status().lastError}>
                  {" "}
                  <code>{status().lastError}</code>
                </Show>
              </Text>
            </Notice>
          </Show>
        </Show>
      </Card>
    </Column>
  );
}

const Card = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
    padding: "var(--gap-lg)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const CardRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--gap-md)",
    minWidth: 0,
  },
});

const Notice = styled("div", {
  base: {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const MeterTrack = styled("div", {
  base: {
    position: "relative",
    height: "12px",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-highest)",
  },
});

const MeterFill = styled("div", {
  base: {
    height: "100%",
    transition: "width 60ms linear",
    background: "var(--md-sys-color-outline)",
    "&[data-open='true']": {
      background: "var(--md-sys-color-primary)",
    },
  },
});

const MeterMark = styled("div", {
  base: {
    position: "absolute",
    top: 0,
    width: "2px",
    height: "100%",
    transform: "translateX(-1px)",
    background: "var(--md-sys-color-on-surface)",
  },
});

const SensitivityLabels = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
  },
});
