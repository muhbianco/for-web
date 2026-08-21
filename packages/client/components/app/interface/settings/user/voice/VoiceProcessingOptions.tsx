import { Trans } from "@lingui/solid/macro";

import { useState } from "@revolt/state";
import type { NoiseSuppresionState } from "@revolt/state/stores/Voice";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";

/**
 * Voice processing options
 */
export function VoiceProcessingOptions() {
  const { voice } = useState();

  return (
    <Column>
      <Text class="title">
        <Trans>Voice Processing</Trans>
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
          value={voice.noiseSupression ?? "advanced"}
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
    </Column>
  );
}
