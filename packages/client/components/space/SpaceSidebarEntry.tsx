import { Show, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { Server } from "stoat.js";

import { useClient } from "@revolt/client";
import { useLocation } from "@revolt/routing";
import { MenuButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { peopleInSpace } from "@muchat/space-client/presence";

import { isSpaceServer, refreshSpaceConfig } from "./config";
import { useSpacePresence } from "./presence";

/**
 * "Espaço" at the top of a server's channel list, only where the space is on.
 * Renders nothing anywhere else, so servers without the space are unchanged.
 */
export function SpaceSidebarEntry(props: { server: Server }) {
  const client = useClient();
  const location = useLocation();
  const { t } = useLingui();

  onMount(() => void refreshSpaceConfig(client()));

  const href = () => `/server/${props.server.id}/space`;
  const active = () => location.pathname.endsWith(href());
  // People on the map right now (halls and the rooms this person may see).
  const presence = useSpacePresence(
    () => client(),
    () => props.server.id,
  );
  const here = () => peopleInSpace(presence());

  return (
    <Show when={isSpaceServer(props.server.id)}>
      <div style={{ padding: "var(--gap-sm) var(--gap-sm) 0" }}>
        <MenuButton
          href={href()}
          size="normal"
          attention={active() ? "selected" : "normal"}
          icon={<Symbol>map</Symbol>}
        >
          {t`Espaço`}
          <Show when={here() > 0}>
            <span
              style={{
                "margin-inline-start": "8px",
                "font-size": "0.8em",
                color: "var(--md-sys-color-on-surface-variant)",
              }}
              aria-label={t`${here()} pessoas no Espaço`}
            >
              · {here()}
            </span>
          </Show>
        </MenuButton>
      </div>
    </Show>
  );
}
