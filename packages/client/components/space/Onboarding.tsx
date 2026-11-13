import { For, Show, createSignal, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  DIRS,
  FRAMES,
  PALETTES,
  SPRITE,
  characterSheet,
} from "@muchat/space-client";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";

/**
 * First access to the space (plan §F.11): what changed, pick a character,
 * how to move. Audio setup arrives with voice (Phase 3). Skipping keeps the
 * default character and still counts as done; it can be changed later.
 */
export function Onboarding(props: {
  initialPalette: number;
  onDone: (palette: number) => Promise<void>;
}) {
  const { t } = useLingui();
  const [step, setStep] = createSignal(0);
  const [palette, setPalette] = createSignal(props.initialPalette);
  const [saving, setSaving] = createSignal(false);
  let first: HTMLHeadingElement | undefined;

  onMount(() => first?.focus());

  async function finish(chosen: number) {
    setSaving(true);
    try {
      await props.onDone(chosen);
    } finally {
      setSaving(false);
    }
  }

  return (
    // Keys typed in the dialog must not walk the avatar behind it.
    <Backdrop onKeyDown={(e) => e.stopPropagation()}>
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-onboarding-title"
      >
        <Show when={step() === 0}>
          <h2 id="space-onboarding-title" tabIndex={-1} ref={first}>
            {t`O Muchat virou um espaço`}
          </h2>
          <p>{t`Cada canal de voz agora é uma sala. Entre na sala para conversar e saia para parar de ouvir.`}</p>
          <p>{t`Algumas salas têm a porta fechada para você. A lista de salas ao lado mostra tudo em texto, se preferir não usar o mapa.`}</p>
          <Actions>
            <Button
              variant="text"
              onPress={() => void finish(props.initialPalette)}
              isDisabled={saving()}
            >
              {t`Pular`}
            </Button>
            <Button variant="filled" onPress={() => setStep(1)}>
              {t`Escolher personagem`}
            </Button>
          </Actions>
        </Show>
        <Show when={step() === 1}>
          <h2 id="space-onboarding-title">{t`Escolha seu personagem`}</h2>
          <Grid role="radiogroup" aria-label={t`Personagens`}>
            <For each={PALETTES.map((_, i) => i)}>
              {(i) => (
                <Choice
                  type="button"
                  role="radio"
                  aria-checked={palette() === i}
                  aria-label={t`Personagem ${i + 1}`}
                  data-selected={palette() === i ? "" : undefined}
                  onClick={() => setPalette(i)}
                >
                  <Preview palette={i} />
                </Choice>
              )}
            </For>
          </Grid>
          <Actions>
            <Button variant="text" onPress={() => setStep(0)}>
              {t`Voltar`}
            </Button>
            <Button variant="filled" onPress={() => setStep(2)}>
              {t`Continuar`}
            </Button>
          </Actions>
        </Show>
        <Show when={step() === 2}>
          <h2 id="space-onboarding-title">{t`Como andar`}</h2>
          <ul>
            <li>{t`Setas ou W A S D para andar; clique ou toque para ir até um ponto.`}</li>
            <li>{t`Atravesse a porta para entrar numa sala; saia por ela quando quiser.`}</li>
            <li>{t`+ e − mudam o zoom. Esc cancela o caminho.`}</li>
          </ul>
          <Actions>
            <Button variant="text" onPress={() => setStep(1)}>
              {t`Voltar`}
            </Button>
            <Button
              variant="filled"
              onPress={() => void finish(palette())}
              isDisabled={saving()}
            >
              {t`Entrar no espaço`}
            </Button>
          </Actions>
        </Show>
      </Card>
    </Backdrop>
  );
}

/** Front-facing idle frame of a palette, drawn crisp at 4×. */
function Preview(props: { palette: number }) {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    const sheet = characterSheet(PALETTES[props.palette]!);
    const ctx = canvas!.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const down = DIRS.indexOf("down") * FRAMES;
    ctx.drawImage(
      sheet,
      down * SPRITE,
      0,
      SPRITE,
      SPRITE,
      0,
      0,
      SPRITE * 4,
      SPRITE * 4,
    );
  });
  return (
    <canvas
      ref={canvas}
      width={SPRITE * 4}
      height={SPRITE * 4}
      aria-hidden="true"
    />
  );
}

const Backdrop = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "rgba(0, 0, 0, 0.55)",
    zIndex: 5,
    padding: "var(--gap-lg)",
  },
});

const Card = styled("div", {
  base: {
    maxWidth: "460px",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
    padding: "var(--gap-xl, 24px)",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    "& h2": { margin: 0, fontSize: "1.25rem", outline: "none" },
    "& p, & ul": { margin: 0, lineHeight: 1.5 },
    "& ul": { paddingInlineStart: "1.2em" },
  },
});

const Actions = styled("div", {
  base: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "var(--gap-sm)",
    marginTop: "var(--gap-sm)",
  },
});

const Grid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "var(--gap-sm)",
  },
});

const Choice = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    padding: "var(--gap-sm)",
    borderRadius: "var(--borderRadius-md, 12px)",
    border: "2px solid transparent",
    background: "var(--md-sys-color-surface-container)",
    cursor: "pointer",
    "&[data-selected]": { borderColor: "var(--md-sys-color-primary)" },
    "&:focus-visible": {
      outline: "3px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
    "& canvas": { imageRendering: "pixelated" },
  },
});
