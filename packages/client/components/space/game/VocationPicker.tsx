import { For, Show, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";

import { rpgLabels } from "./rpgUi";

/**
 * A escolha da vocação do herói (docs/espaco/jogo/ot): quatro cartões e uma confirmação,
 * porque a escolha é definitiva. Usada no dummy e na TV (o primeiro uso de qualquer um).
 */
export function VocationPicker(props: {
  busy: boolean;
  onChoose: (vocation: 1 | 2 | 3 | 4) => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const [confirm, setConfirm] = createSignal<1 | 2 | 3 | 4 | null>(null);
  return (
    <>
      <p>{t`Seu avatar também é um herói. Escolha a vocação dele para começar.`}</p>
      <Show
        when={confirm()}
        fallback={
          <Choices>
            <For each={[4, 3, 1, 2] as const}>
              {(v) => (
                <Choice
                  type="button"
                  disabled={props.busy}
                  onClick={() => setConfirm(v)}
                >
                  <strong>{L.vocation[v].name}</strong>
                  <Muted>{L.vocation[v].blurb}</Muted>
                </Choice>
              )}
            </For>
          </Choices>
        }
      >
        {(v) => (
          <>
            <p>{t`Ser ${L.vocation[v()].name}? A escolha é definitiva.`}</p>
            <Row>
              <Button
                variant="filled"
                isDisabled={props.busy}
                onPress={() => props.onChoose(v())}
              >
                {t`Confirmar`}
              </Button>
              <Button variant="text" onPress={() => setConfirm(null)}>
                {t`Voltar`}
              </Button>
            </Row>
          </>
        )}
      </Show>
    </>
  );
}

const Choices = styled("div", {
  base: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" },
});

const Choice = styled("button", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    textAlign: "start",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    cursor: "pointer",
    "&:hover": { borderColor: "var(--md-sys-color-primary)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});
