import { Trans, useLingui } from "@lingui/solid/macro";
import { For, Show, createSignal } from "solid-js";
import { styled } from "styled-system/jsx";

import { useVoice } from "@revolt/rtc";
import type { CallVerdict } from "@revolt/rtc/callDiagnosis";
import { diagnoseCall } from "@revolt/rtc/callDiagnosis";
import type {
  CallStatsSnapshot,
  ParticipantCallStats,
} from "@revolt/rtc/callStats";
import type { VoiceEngineStatus } from "@revolt/rtc/voiceEngineStatus";
import { Button, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { SectionHeader } from "./VoiceProcessingOptions";

/**
 * Live network diagnostics for the current call.
 *
 * VoiceProcessingOptions already shows what the local audio chain is doing;
 * this is the other half, and the half that was missing: what the network is
 * doing, per participant. Without it, "the voice is chopping" was impossible
 * to attribute — the same complaint comes from a saturated CPU, a bad uplink,
 * a bad downlink, or one peer with bad wifi.
 */
export function CallDiagnosticsOptions() {
  const { t } = useLingui();
  const rtc = useVoice();
  const stats = () => rtc.callStats();
  const [copied, setCopied] = createSignal(false);

  const verdict = () =>
    diagnoseCall(stats(), {
      deepFilterSlowRatio: rtc.engineStatus().deepFilterSlowRatio,
      deepFilterOverloaded: rtc.engineStatus().deepFilterOverloaded,
    });

  const verdictText = (v: CallVerdict) => {
    switch (v.kind) {
      case "local-cpu":
        return t`Seu computador não está dando conta`;
      case "local-uplink":
        return t`Sua conexão de subida está com problema`;
      case "local-downlink":
        return t`Sua conexão de descida está com problema`;
      case "remote-network":
        return t`A conexão de ${v.who} está instável`;
      case "ok":
        return t`A chamada está saudável`;
      case "no-data":
        return t`Fale um pouco para medir`;
      default:
        return t`Medindo…`;
    }
  };

  const verdictIcon = (v: CallVerdict) => {
    if (v.kind === "ok") return "check_circle";
    if (v.kind === "waiting" || v.kind === "no-data") return "hourglass_empty";
    return "warning";
  };

  /** A silent window is not a problem, so it must not be painted as one. */
  const verdictIsBad = (v: CallVerdict) =>
    v.kind !== "ok" && v.kind !== "waiting" && v.kind !== "no-data";

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(
        buildReport(
          stats(),
          verdict(),
          verdictText(verdict()),
          rtc.engineStatus(),
        ),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Clipboard can be denied; the numbers are still on screen.
      console.warn("[voice] copy diagnostics", error);
    }
  }

  const ms = (value: number | undefined) =>
    value === undefined ? "—" : `${value} ms`;
  const pct = (value: number | undefined) =>
    value === undefined ? "—" : `${value}%`;

  const selfRows = (): Row[] => {
    const current = stats();
    const audio = current.self.audio;
    const rows: Row[] = [
      { label: t`Qualidade`, value: current.self.quality },
      { label: t`Ida e volta`, value: ms(audio?.rttMs) },
      { label: t`Perda do seu áudio`, value: pct(audio?.lossPct) },
      {
        label: t`Áudio enviado`,
        value:
          audio?.bitrateKbps === undefined ? "—" : `${audio.bitrateKbps} kbps`,
      },
    ];
    for (const video of current.self.video) {
      const name = video.source === "camera" ? t`Câmera` : t`Tela`;
      rows.push({
        label: name,
        value:
          video.width && video.height
            ? `${video.width}×${video.height} @ ${video.fps ?? "?"}fps · ${video.bitrateKbps ?? "?"} kbps`
            : "—",
      });
      if (video.limitedBy) {
        rows.push({
          label: `${name} — ${t`limitada por`}`,
          value: video.limitedBy === "cpu" ? t`CPU` : video.limitedBy,
        });
      }
    }
    return rows;
  };

  const participantRows = (participant: ParticipantCallStats): Row[] => {
    const rows: Row[] = [{ label: t`Qualidade`, value: participant.quality }];
    const audio = participant.audio;
    if (audio) {
      rows.push(
        { label: t`Jitter`, value: ms(audio.jitterMs) },
        { label: t`Perda`, value: pct(audio.lossPct) },
        {
          label: t`Voz acelerada`,
          value:
            audio.acceleratedMsPerSec === undefined
              ? "—"
              : `${audio.acceleratedMsPerSec} ms/s`,
        },
        {
          label: t`Áudio reconstruído`,
          value:
            audio.concealedMsPerSec === undefined
              ? "—"
              : `${audio.concealedMsPerSec} ms/s`,
        },
        { label: t`Buffer`, value: ms(audio.jitterBufferMs) },
      );
    }
    const video = participant.video;
    if (video) {
      rows.push(
        {
          label: t`Vídeo`,
          value:
            video.width && video.height
              ? `${video.width}×${video.height} @ ${video.fps ?? "?"}fps`
              : "—",
        },
        {
          label: t`Travamentos`,
          value:
            video.freezeMsPerSec === undefined
              ? "—"
              : `${video.freezeMsPerSec} ms/s`,
        },
      );
      if (video.decoder) {
        rows.push({
          label: t`Decodificador`,
          value:
            video.powerEfficientDecoder === false
              ? `${video.decoder} (${t`software`})`
              : video.decoder,
        });
      }
    }
    return rows;
  };

  return (
    <Column gap="sm">
      <SectionHeader
        title={<Trans>Diagnóstico da chamada</Trans>}
        description={
          <Trans>
            Como a rede está se comportando agora, por pessoa. Abra isto durante
            uma chamada com problema e copie o resultado.
          </Trans>
        }
      />
      <Card>
        <Show
          when={stats().inCall}
          fallback={
            <Text class="label" size="small">
              <Trans>Entre em uma chamada para ver os números.</Trans>
            </Text>
          }
        >
          <Verdict data-bad={verdictIsBad(verdict())}>
            <Symbol size={18}>{verdictIcon(verdict())}</Symbol>
            <Column gap="none">
              <Text class="label">{verdictText(verdict())}</Text>
              <Show when={verdict().detail}>
                <Text class="label" size="small">
                  {verdict().detail}
                </Text>
              </Show>
            </Column>
          </Verdict>

          <Column gap="xs">
            <Text class="label" size="small">
              <Trans>Você (enviando)</Trans>
            </Text>
            <For each={selfRows()}>
              {(row) => (
                <CardRow>
                  <Text class="label" size="small">
                    {row.label}
                  </Text>
                  <Text class="label">{row.value}</Text>
                </CardRow>
              )}
            </For>
          </Column>

          <For each={stats().participants}>
            {(participant) => (
              <Column gap="xs">
                <Text class="label" size="small">
                  {participant.name} <Trans>(recebendo)</Trans>
                </Text>
                <For each={participantRows(participant)}>
                  {(row) => (
                    <CardRow>
                      <Text class="label" size="small">
                        {row.label}
                      </Text>
                      <Text class="label">{row.value}</Text>
                    </CardRow>
                  )}
                </For>
              </Column>
            )}
          </For>

          <Button variant="tonal" onPress={() => void copyReport()}>
            <Show when={copied()} fallback={<Trans>Copiar diagnóstico</Trans>}>
              <Trans>Copiado</Trans>
            </Show>
          </Button>
        </Show>
      </Card>
    </Column>
  );
}

type Row = { label: string; value: string };

/**
 * A compact, pasteable summary. Only display names travel with it — no track
 * ids, no user ids, nothing that is not already visible in the call.
 *
 * The local audio engine goes in too. The first time this report was used on
 * a real problem it carried only the network side, and the numbers that would
 * have settled it — how late the DeepFilter frames are, and whether the
 * capture device runs at the rate the processing context assumes — were the
 * ones missing.
 */
function buildReport(
  stats: CallStatsSnapshot,
  verdict: CallVerdict,
  verdictText: string,
  engine: VoiceEngineStatus,
): string {
  return JSON.stringify(
    {
      verdict: {
        kind: verdict.kind,
        text: verdictText,
        detail: verdict.detail,
      },
      engine: {
        engine: engine.engine,
        selectedMode: engine.selectedMode,
        processorAttached: engine.processorAttached,
        contextSampleRate: engine.sampleRate,
        deviceSampleRate: engine.inputSampleRate,
        inputChannelCount: engine.inputChannelCount,
        deepFilterMaxFrameMs: engine.deepFilterMaxFrameMs,
        deepFilterStatWindows: engine.deepFilterStatWindows,
        deepFilterStatFrames: engine.deepFilterStatFrames,
        deepFilterSlowRatio: engine.deepFilterSlowRatio,
        deepFilterOverloaded: engine.deepFilterOverloaded,
        deepFilterAttenDb: engine.deepFilterAttenDb,
        vadEngine: engine.vadEngine,
        vadInferMs: engine.vadInferMs,
        echoCancellation: engine.echoCancellation,
        autoGainControl: engine.autoGainControl,
        noiseSuppression: engine.noiseSuppression,
        lastError: engine.lastError,
        vadError: engine.vadError,
      },
      self: stats.self,
      participants: stats.participants.map((p) => ({
        name: p.name,
        quality: p.quality,
        audio: p.audio,
        video: p.video,
      })),
    },
    null,
    2,
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

const Verdict = styled("div", {
  base: {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface-variant)",
    "&[data-bad='true']": {
      color: "var(--md-sys-color-error)",
    },
  },
});
