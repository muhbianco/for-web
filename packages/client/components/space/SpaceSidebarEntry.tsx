import { Show, onMount } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { Server } from "stoat.js";

import { useClient } from "@revolt/client";
import { useLocation } from "@revolt/routing";
import { MenuButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { isSpaceServer, refreshSpaceConfig } from "./config";

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
        </MenuButton>
      </div>
    </Show>
  );
}
