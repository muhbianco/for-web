import { Show } from "solid-js";
import { Trans } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import type { VoiceEngineId } from "@revolt/rtc/voiceEngineStatus";
import { useState } from "@revolt/state";
import type { NoiseSuppresionState } from "@revolt/state/stores/Voice";
import { rmsToMeter } from "@revolt/state/stores/noiseSuppressionPolicy";
import { CategoryButton, Checkbox, Column, Slider, Text } from "@revolt/ui";

function engineLabel(engine: VoiceEngineId) {
  switch (engine) {
    case "deepfilter":
      return "DeepFilterNet";
    case "rnnoise":
      return "RNNoise";
    case "browser-ns":
      return "browser";
    case "bypass":
      return "off";
    default:
      return "idle";
  }
}

function yesNo(value: boolean | undefined) {
  if (value === undefined) return "—";
  return value ? "yes" : "no";
}

/**
 * Voice processing options
 */
export function VoiceProcessingOptions() {
  const { voice } = useState();
  const rtc = useVoice();
  const status = () => rtc.engineStatus();

  const liveLine = () => {
    const current = status();
    const rate = current.sampleRate ? ` @ ${current.sampleRate} Hz` : "";
    return `Engine: ${engineLabel(current.engine)}${rate} · processor: ${current.processorAttached ? "yes" : "no"} · capture AGC: ${yesNo(current.autoGainControl)} · browser NS: ${yesNo(current.noiseSuppression)}`;
  };

  const meterLevel = () => {
    if (status().engine !== "deepfilter") return 0;
    return rmsToMeter(status().inputRms ?? 0);
  };

  const meterThreshold = () => {
    if (voice.autoInputSensitivity && status().gateOpenThreshold != null) {
      return rmsToMeter(status().gateOpenThreshold);
    }
    return voice.inputSensitivity;
  };

  return (
    <Column>
      <Text class="title">
        <Trans>Voice Processing</Trans>
      </Text>
      <Text class="label" size="small">
        <Trans>
          This only changes what other people hear from you, not what you hear
          from them.
        </Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton.Select<NoiseSuppresionState>
          icon={"blank"}
          title={<Trans>Select noise suppression</Trans>}
          options={{
            advanced: {
              title: <Trans>DeepFilterNet</Trans>,
              description: (
                <Trans>
                  Stronger against keyboard and TV in the background. Uses more
                  CPU, and falls back to RNNoise on weaker devices.
                </Trans>
              ),
              shortDesc: <Trans>DeepFilterNet</Trans>,
            },
            enhanced: {
              title: <Trans>Enhanced</Trans>,
              description: <Trans>Powered by RNNoise</Trans>,
              shortDesc: <Trans>Enhanced (RNNoise)</Trans>,
            },
            browser: { title: <Trans>Browser</Trans> },
            disabled: { title: <Trans>Disabled</Trans> },
          }}
          value={voice.noiseSupression ?? "enhanced"}
          onUpdate={(ns) => (voice.noiseSupression = ns)}
        />
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={voice.echoCancellation} />}
          onClick={() => (voice.echoCancellation = !voice.echoCancellation)}
        >
          <Trans>Browser Echo Cancellation</Trans>
        </CategoryButton>
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={voice.autoGainControl} />}
          onClick={() => (voice.autoGainControl = !voice.autoGainControl)}
        >
          <Trans>Automatic Gain Control</Trans>
        </CategoryButton>
      </CategoryButton.Group>
      <Show when={voice.noiseSupression === "advanced"}>
        <Column gap="sm">
          <Text class="title">
            <Trans>Microphone sensitivity</Trans>
          </Text>
          <Text class="label" size="small">
            <Trans>
              How loud you need to speak before others hear you. Left is more
              sensitive.
            </Trans>
          </Text>
          <CategoryButton.Group>
            <CategoryButton
              icon="blank"
              action={<Checkbox checked={voice.autoInputSensitivity} />}
              onClick={() =>
                (voice.autoInputSensitivity = !voice.autoInputSensitivity)
              }
            >
              <Trans>Automatically determine input sensitivity</Trans>
            </CategoryButton>
          </CategoryButton.Group>
          <Show
            when={status().inCall && status().engine === "deepfilter"}
            fallback={
              <Text class="label" size="small">
                <Trans>Join a voice call to see the live meter.</Trans>
              </Text>
            }
          >
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
          </Show>
          <SensitivityLabels>
            <Text class="label" size="small">
              <Trans>More sensitive</Trans>
            </Text>
            <Text class="label" size="small">
              <Trans>Less sensitive</Trans>
            </Text>
          </SensitivityLabels>
          <Slider
            min={0}
            max={1}
            step={0.01}
            disabled={voice.autoInputSensitivity}
            value={voice.inputSensitivity}
            onInput={(event) =>
              (voice.inputSensitivity = Number(event.currentTarget.value))
            }
            labelFormatter={(label) => (label * 100).toFixed(0) + "%"}
          />
        </Column>
      </Show>
      <Column gap="sm">
        <Text class="label">
          <Trans>What is actually running</Trans>
        </Text>
        <Show
          when={status().inCall}
          fallback={
            <Text class="label" size="small">
              <Trans>
                Join a voice call to see the live engine. The dropdown only
                stores your preference until then.
              </Trans>
            </Text>
          }
        >
          <Text class="label" size="small">
            {liveLine()}
          </Text>
          <Show
            when={
              status().selectedMode === "advanced" &&
              status().engine !== "deepfilter"
            }
          >
            <Text class="label" size="small">
              <Trans>
                You selected DeepFilterNet; RNNoise is running instead.
              </Trans>
              {status().lastError ? ` ${status().lastError}` : ""}
            </Text>
          </Show>
        </Show>
      </Column>
    </Column>
  );
}

const MeterTrack = styled("div", {
  base: {
    position: "relative",
    height: "10px",
    overflow: "hidden",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-highest)",
  },
});

const MeterFill = styled("div", {
  base: {
    height: "100%",
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
