import { Trans, useLingui } from "@lingui/solid/macro";
import { Show } from "solid-js";

import { speakTts, ttsSupported } from "@revolt/rtc/tts";
import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { SectionHeader } from "./VoiceProcessingOptions";

/**
 * Discord-style `/tts`: read messages from the connected voice channel aloud
 * with the device's own speech synthesis.
 */
export function TextToSpeechOptions() {
  const { voice } = useState();
  const { t } = useLingui();
  const supported = ttsSupported();

  const test = () =>
    void speakTts(t`This is how /tts sounds on this device.`, {
      volume: voice.outputVolume,
    });

  return (
    <Column gap="sm">
      <SectionHeader
        title={<Trans>Text-to-speech</Trans>}
        description={
          <Trans>
            Type /tts followed by a message in a voice channel's chat and
            everyone connected to it hears it, spoken by their own device.
          </Trans>
        }
      />
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>record_voice_over</Symbol>}
          description={
            <Trans>
              Turn off to keep seeing /tts messages without hearing them.
            </Trans>
          }
          action={<Checkbox checked={voice.ttsEnabled} />}
          disabled={!supported}
          onClick={() => (voice.ttsEnabled = !voice.ttsEnabled)}
        >
          <Trans>Read /tts messages aloud</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>play_arrow</Symbol>}
          description={<Trans>Uses your output volume.</Trans>}
          disabled={!supported}
          onClick={test}
        >
          <Trans>Test voice</Trans>
        </CategoryButton>
      </CategoryButton.Group>
      <Show when={!supported}>
        <Text class="label" size="small">
          <Trans>
            This device has no speech synthesis, so /tts messages stay silent
            here.
          </Trans>
        </Text>
      </Show>
    </Column>
  );
}
