import { Match, Show, Switch } from "solid-js";

import { Trans } from "@lingui/solid/macro";
import { css } from "styled-system/css";

import { useClientLifecycle } from "@revolt/client";
import { TransitionType } from "@revolt/client/Controller";
import { Navigate } from "@revolt/routing";
import { Button, Column } from "@revolt/ui";

import { useState } from "@revolt/state";
import muchatMark from "../muchat-mark.svg";

/**
 * Flow for logging into an account
 */
export default function FlowHome() {
  const state = useState();
  const { lifecycle, isLoggedIn, isError } = useClientLifecycle();

  return (
    <Switch
      fallback={
        <>
          <Show when={isLoggedIn()}>
            <Navigate href={state.layout.popNextPath() ?? "/app"} />
          </Show>

          <Column gap="xl">
            <Column gap="md" align>
              <img
                src={muchatMark}
                alt="Muchat"
                width={64}
                height={64}
                class={css({
                  width: "64px",
                  height: "64px",
                  margin: "auto",
                  borderRadius: "16px",
                })}
              />
              <b
                style={{
                  "font-weight": 800,
                  "font-size": "1.75rem",
                  "letter-spacing": "-0.03em",
                  "text-align": "center",
                }}
              >
                Muchat
              </b>
            </Column>

            <Column>
              <b
                style={{
                  "font-weight": 800,
                  "font-size": "1.4em",
                  display: "flex",
                  "flex-direction": "column",
                  "align-items": "center",
                  "text-align": "center",
                }}
              >
                <Trans>Private chat.</Trans>
              </b>
              <span style={{ "text-align": "center", opacity: "0.5" }}>
                <Trans>
                  Invite-only. You talk with the people you actually invited.
                </Trans>
              </span>
            </Column>

            <Column>
              <a href="/login/auth">
                <Column>
                  <Button>
                    <Trans>Log In</Trans>
                  </Button>
                </Column>
              </a>
              <a href="/login/create">
                <Column>
                  <Button variant="tonal">
                    <Trans>Sign Up</Trans>
                  </Button>
                </Column>
              </a>
            </Column>
          </Column>
        </>
      }
    >
      <Match when={isError()}>
        <Switch fallback={"an unknown error occurred"}>
          <Match when={lifecycle.permanentError === "InvalidSession"}>
            <h1>
              <Trans>You were logged out!</Trans>
            </h1>
          </Match>
        </Switch>

        <Button
          variant="filled"
          onPress={() =>
            lifecycle.transition({
              type: TransitionType.Dismiss,
            })
          }
        >
          <Trans>OK</Trans>
        </Button>
      </Match>
    </Switch>
  );
}
