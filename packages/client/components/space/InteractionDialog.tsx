import { Match, Show, Switch } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { Interaction } from "@muchat/space-client";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";

/**
 * What an interactive object does when used (ADR 0007): a link asks before
 * opening (the host is shown), a note shows its text, a picture its image, a
 * frame embeds the page in a sandbox. Teleports never reach here: the server
 * moves the avatar. Only http(s) addresses exist in a configuration (the
 * server refuses the rest), and nothing here runs code from them.
 */
export function InteractionDialog(props: {
  interaction: Interaction;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const kind = () => props.interaction.item.interaction;
  const config = () => props.interaction.config;
  const title = () => config().title?.trim() || props.interaction.item.name;
  const host = (): string => {
    try {
      return new URL(config().url ?? "").host;
    } catch {
      return "";
    }
  };
  const configured = () => {
    switch (kind()) {
      case "note":
        return Boolean(config().text);
      case "link":
      case "picture":
      case "frame":
        return Boolean(config().url);
      default:
        return true;
    }
  };
  const secure = () => (config().url ?? "").startsWith("https://");

  return (
    <Backdrop
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-interaction-title"
        data-wide={kind() === "frame" || kind() === "picture" ? "" : undefined}
      >
        <h2 id="space-interaction-title">{title()}</h2>
        <Show
          when={configured()}
          fallback={
            <>
              <p>{t`Este objeto ainda não foi configurado.`}</p>
              <Show when={props.canEdit}>
                <Muted>{t`Abra o modo Decorar, selecione o objeto e preencha o que ele mostra.`}</Muted>
              </Show>
            </>
          }
        >
          <Switch>
            <Match when={kind() === "note"}>
              <Note>{config().text}</Note>
            </Match>
            <Match when={kind() === "link"}>
              <p>{t`Este objeto abre um site em outra aba:`}</p>
              <Address>{host()}</Address>
              <Muted>{config().url}</Muted>
            </Match>
            <Match when={kind() === "picture"}>
              <Picture
                src={config().url}
                alt={title()}
                referrerPolicy="no-referrer"
              />
              <Muted>{host()}</Muted>
            </Match>
            <Match when={kind() === "frame"}>
              <Show
                when={secure()}
                fallback={
                  <p>{t`Só páginas https podem ser mostradas aqui.`}</p>
                }
              >
                <Frame
                  src={config().url}
                  title={title()}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock"
                  referrerPolicy="no-referrer"
                  allow="fullscreen; autoplay"
                />
              </Show>
              <Muted>{host()}</Muted>
            </Match>
          </Switch>
        </Show>
        <Actions>
          <Button variant="text" onPress={props.onClose}>
            {t`Fechar`}
          </Button>
          <Show when={configured() && kind() === "link"}>
            <Button
              variant="filled"
              onPress={() => {
                window.open(config().url, "_blank", "noopener,noreferrer");
                props.onClose();
              }}
            >
              {t`Abrir`}
            </Button>
          </Show>
        </Actions>
      </Card>
    </Backdrop>
  );
}

const Backdrop = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "rgba(0, 0, 0, 0.55)",
    zIndex: 6,
    padding: "var(--gap-lg)",
  },
});

const Card = styled("div", {
  base: {
    maxWidth: "460px",
    width: "100%",
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
    padding: "var(--gap-xl, 24px)",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    overflow: "auto",
    "& h2": { margin: 0, fontSize: "1.15rem" },
    "& p": { margin: 0, lineHeight: 1.5 },
    "&[data-wide]": { maxWidth: "min(960px, 100%)" },
  },
});

const Note = styled("p", { base: { whiteSpace: "pre-wrap", lineHeight: 1.5 } });
const Address = styled("div", {
  base: { fontWeight: 700, fontSize: "1.05em", wordBreak: "break-all" },
});
const Muted = styled("span", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.85em",
    wordBreak: "break-all",
  },
});
const Picture = styled("img", {
  base: {
    maxWidth: "100%",
    maxHeight: "70vh",
    borderRadius: "8px",
    objectFit: "contain",
    alignSelf: "center",
  },
});
const Frame = styled("iframe", {
  base: {
    width: "100%",
    height: "min(70vh, 540px)",
    border: "none",
    borderRadius: "8px",
    background: "#000",
  },
});
const Actions = styled("div", {
  base: { display: "flex", justifyContent: "flex-end", gap: "var(--gap-sm)" },
});
