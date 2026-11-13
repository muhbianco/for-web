import {
  Match,
  Switch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { useState } from "@revolt/state";
import { Button } from "@revolt/ui";

import { VoiceInputOptions } from "../app/interface/settings/user/voice/VoiceInputOptions";

/** Local to this device: a new device asks again, the account does not. */
const CHECKED_KEY = "muchat.space.audio-checked";

export function audioCheckedHere(): boolean {
  try {
    return localStorage.getItem(CHECKED_KEY) === "1";
  } catch {
    return true; // no storage: never nag
  }
}

export function markAudioCheckedHere() {
  try {
    localStorage.setItem(CHECKED_KEY, "1");
  } catch {
    /* private mode: it simply shows again next time */
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "denied" }
  | { kind: "no_device" }
  | { kind: "error" };

/**
 * Audio step of the first access (plan §F.11): pick the devices and hear the
 * microphone move a meter before walking into a room. The test only starts on
 * a button press (the browser asks for permission then) and stops when the
 * step closes. Skippable; nothing here is required to use the space.
 */
export function AudioCheck(props: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  const { t } = useLingui();
  const state = useState();
  const [phase, setPhase] = createSignal<Phase>({ kind: "idle" });
  const [level, setLevel] = createSignal(0);
  let stop: (() => void) | undefined;
  let disposed = false;

  async function start() {
    stop?.();
    stop = undefined;
    const deviceId = state.voice.preferredAudioInputDevice;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : true,
      });
      if (disposed) {
        // The step closed while the permission prompt was open.
        for (const tr of stream.getTracks()) tr.stop();
        return;
      }
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let raf = 0;
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        // RMS of speech sits around 0.02–0.2; scale so normal speech fills the bar.
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
        raf = requestAnimationFrame(loop);
      };
      loop();
      stop = () => {
        cancelAnimationFrame(raf);
        for (const tr of stream.getTracks()) tr.stop();
        void ctx.close().catch(() => undefined);
        setLevel(0);
      };
      setPhase({ kind: "testing" });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") setPhase({ kind: "denied" });
      else if (name === "NotFoundError" || name === "OverconstrainedError") setPhase({ kind: "no_device" });
      else setPhase({ kind: "error" });
    }
  }

  // Another microphone picked while testing: test that one.
  createEffect(
    on(
      () => state.voice.preferredAudioInputDevice,
      () => {
        if (phase().kind === "testing") void start();
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    disposed = true;
    stop?.();
  });

  function next() {
    stop?.();
    markAudioCheckedHere();
    props.onNext();
  }

  return (
    <>
      <h2 id="space-onboarding-title">{t`Seu áudio`}</h2>
      <p>{t`Escolha o microfone e o alto-falante. Ao entrar numa sala, você fala e ouve quem está nela.`}</p>
      <VoiceInputOptions />
      <Switch>
        <Match when={phase().kind === "testing"}>
          <Meter
            role="meter"
            aria-label={t`Volume do microfone`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level() * 100)}
          >
            <span style={{ width: `${Math.round(level() * 100)}%` }} />
          </Meter>
          <Hint>{t`Fale algo: a barra deve se mexer.`}</Hint>
        </Match>
        <Match when={phase().kind === "denied"}>
          <Hint role="alert">
            {t`O microfone foi bloqueado. Libere o acesso nas permissões do navegador (ícone ao lado do endereço), do aplicativo do PC ou do Android e teste de novo. Você também pode entrar só ouvindo.`}
          </Hint>
        </Match>
        <Match when={phase().kind === "no_device"}>
          <Hint role="alert">
            {t`Nenhum microfone encontrado. Você pode entrar só ouvindo e ligar um depois.`}
          </Hint>
        </Match>
        <Match when={phase().kind === "error"}>
          <Hint role="alert">{t`Não deu para testar o microfone agora.`}</Hint>
        </Match>
      </Switch>
      <Actions>
        {props.onBack && (
          <Button variant="text" onPress={() => props.onBack?.()}>
            {t`Voltar`}
          </Button>
        )}
        <Button variant="tonal" onPress={() => void start()}>
          {phase().kind === "testing" ? t`Testar de novo` : t`Testar microfone`}
        </Button>
        <Button variant="filled" onPress={next}>
          {props.nextLabel}
        </Button>
      </Actions>
    </>
  );
}

const Meter = styled("div", {
  base: {
    height: "10px",
    borderRadius: "999px",
    background: "var(--md-sys-color-surface-container)",
    overflow: "hidden",
    "& span": {
      display: "block",
      height: "100%",
      background: "var(--md-sys-color-primary)",
      transition: "width 60ms linear",
    },
  },
});

const Hint = styled("p", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.9em" },
});

const Actions = styled("div", {
  base: {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: "var(--gap-sm)",
    marginTop: "var(--gap-sm)",
  },
});
