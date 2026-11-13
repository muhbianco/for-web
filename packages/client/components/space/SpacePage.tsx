import {
  For,
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ConnStatus,
  type SpaceUiState,
  SpaceView,
  wingHeading,
} from "@muchat/space-client";
import { type ProfileView, ONBOARDING_VERSION } from "@muchat/space-core";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useParams } from "@revolt/routing";
import { Button, IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { clientKind, sessionToken } from "./config";
import { Onboarding } from "./Onboarding";

/**
 * Full-screen space of a server (route `/server/:server/space`, lazy-loaded so
 * PixiJS never reaches the main bundle). The map is decoration for whoever can
 * see it; the room list carries the same information as text.
 */
export default function SpacePage() {
  const params = useParams<{ server: string }>();
  const client = useClient();
  const { t } = useLingui();
  const [ui, setUi] = createSignal<SpaceUiState | null>(null);
  const [view, setView] = createSignal<SpaceView | null>(null);
  const [profile, setProfile] = createSignal<ProfileView | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [showList, setShowList] = createSignal(true);
  let host: HTMLDivElement | undefined;
  let disposed = false;

  const statusText = (s: ConnStatus): string =>
    ({
      connecting: t`Conectando ao espaço…`,
      online: t`Conectado`,
      reconnecting: t`Sem conexão com o espaço — tentando de novo`,
      replaced: t`Aberto em outra aba`,
      unauthenticated: t`Sessão expirada`,
      not_member: t`Você não é membro deste servidor`,
      closed: t`Desconectado`,
    })[s];

  onMount(async () => {
    const token = sessionToken(client());
    if (!token || !host)
      return setFailed(t`Entre na sua conta para usar o espaço.`);
    try {
      const v = await SpaceView.mount({
        el: host,
        baseUrl: location.origin,
        sessionToken: token,
        serverId: params.server,
        client: clientKind(),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      if (disposed) return v.destroy();
      setView(v);
      v.subscribe(setUi);
      host.focus();
      setProfile(await v.profile().catch(() => null));
    } catch {
      setFailed(
        t`Não foi possível abrir o mapa neste aparelho. A lista de salas continua no canal de cada sala.`,
      );
    }
  });

  onCleanup(() => {
    disposed = true;
    view()?.destroy();
  });

  async function finishOnboarding(palette: number) {
    const v = view();
    if (!v) return;
    const next = await v
      .updateProfile({ look: { palette }, onboarding_done: ONBOARDING_VERSION })
      .catch(() => null);
    // Even if saving failed, let the person in; the flow shows again next time.
    setProfile(
      next ?? { look: { palette }, onboarding_version: ONBOARDING_VERSION },
    );
    host?.focus();
  }

  return (
    <Page>
      <Bar>
        <strong>{ui()?.location || t`Espaço`}</strong>
        <Muted>{ui() ? statusText(ui()!.status) : ""}</Muted>
        <Show when={ui()?.status === "replaced"}>
          <Button variant="tonal" onPress={() => view()?.takeOver()}>
            {t`Usar aqui`}
          </Button>
        </Show>
        <span style={{ flex: 1 }} />
        <IconButton
          aria-label={t`Diminuir zoom`}
          onPress={() => view()?.setZoom((ui()?.zoom ?? 2) - 1)}
        >
          <Symbol>zoom_out</Symbol>
        </IconButton>
        <IconButton
          aria-label={t`Aumentar zoom`}
          onPress={() => view()?.setZoom((ui()?.zoom ?? 2) + 1)}
        >
          <Symbol>zoom_in</Symbol>
        </IconButton>
        <IconButton
          aria-label={
            showList() ? t`Esconder lista de salas` : t`Mostrar lista de salas`
          }
          aria-pressed={showList()}
          onPress={() => setShowList(!showList())}
        >
          <Symbol>list</Symbol>
        </IconButton>
      </Bar>
      <Body data-list={showList() ? "" : undefined}>
        <MapHost
          ref={host}
          tabIndex={0}
          role="application"
          aria-label={t`Mapa do espaço. Setas ou W A S D para andar, clique para ir até um ponto, + e − para o zoom. A lista de salas tem as mesmas informações.`}
        >
          <Switch>
            <Match when={failed()}>{(msg) => <Notice>{msg()}</Notice>}</Match>
            <Match
              when={
                profile() && profile()!.onboarding_version < ONBOARDING_VERSION
              }
            >
              <Onboarding
                initialPalette={profile()!.look.palette}
                onDone={finishOnboarding}
              />
            </Match>
          </Switch>
        </MapHost>
        <Show when={showList()}>
          <List aria-label={t`Lista de salas`}>
            <For each={ui()?.list ?? []}>
              {(wing) => (
                <section>
                  <h3>{wingHeading(wing.title)}</h3>
                  <ul>
                    <For each={wing.rooms}>
                      {(room) => (
                        <li data-here={room.here ? "" : undefined}>
                          <span>
                            <Show when={room.isPrivate && !room.canEnter}>
                              <Symbol size={14}>lock</Symbol>{" "}
                            </Show>
                            {room.title}
                          </span>
                          <Muted>{room.status}</Muted>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </List>
        </Show>
      </Body>
      <SrOnly aria-live="polite">{ui()?.announcement ?? ""}</SrOnly>
    </Page>
  );
}

const Page = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minWidth: 0,
    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-lowest, #14151c)",
  },
});

const Bar = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-md)",
    padding: "var(--gap-sm) var(--gap-md)",
    background: "var(--md-sys-color-surface-container)",
    minHeight: "48px",
  },
});

const Body = styled("div", {
  base: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "1fr",
    "&[data-list]": { gridTemplateColumns: "1fr 280px" },
    "@media (max-width: 760px)": {
      "&[data-list]": {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr 40%",
      },
    },
  },
});

const MapHost = styled("div", {
  base: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    outline: "none",
    "& canvas": { position: "absolute", inset: 0 },
    "&:focus-visible": {
      boxShadow: "inset 0 0 0 3px var(--md-sys-color-primary)",
    },
  },
});

const List = styled("aside", {
  base: {
    overflow: "auto",
    padding: "var(--gap-md)",
    background: "var(--md-sys-color-surface-container-low)",
    "& h3": {
      fontSize: "0.75rem",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      color: "var(--md-sys-color-on-surface-variant)",
      margin: "var(--gap-md) 0 var(--gap-sm)",
    },
    "& ul": { listStyle: "none", margin: 0, padding: 0 },
    "& li": {
      display: "flex",
      flexDirection: "column",
      padding: "6px 8px",
      borderRadius: "8px",
    },
    "& li[data-here]": {
      background: "var(--md-sys-color-secondary-container)",
    },
  },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const Notice = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "var(--gap-lg)",
    textAlign: "center",
  },
});

const SrOnly = styled("div", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
