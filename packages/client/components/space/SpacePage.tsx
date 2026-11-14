import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ConnStatus,
  type MediaStatus,
  type SpaceUiState,
  type SpaceView,
  wingHeading,
} from "@muchat/space-client";
import { type ProfileView, ONBOARDING_VERSION } from "@muchat/space-core";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useLocation, useParams } from "@revolt/routing";
import { useVoice } from "@revolt/rtc";
import { Button, IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { audioCheckedHere, markAudioCheckedHere } from "./AudioCheck";
import { clientKind, sessionToken } from "./config";
import { DecorPanel } from "./DecorPanel";
import { InteractionDialog } from "./InteractionDialog";
import { AudioCheckDialog, Onboarding } from "./Onboarding";
import { leaveSpacePage, openSpace } from "./session";

/**
 * Route `/server/:server/space`, lazy-loaded so PixiJS never reaches the main
 * bundle. The router keeps this component when only `:server` changes, so the
 * page is recreated per server: each server has its own space.
 */
export default function SpacePage() {
  const params = useParams<{ server: string }>();
  return (
    <Show when={params.server} keyed>
      {(serverId) => <ServerSpace serverId={serverId} />}
    </Show>
  );
}

/**
 * Full-screen space of one server. The map is decoration for whoever can see
 * it; the room list carries the same information as text. `?sala=<channel>`
 * (the voice channels of the sidebar) walks to that room. "Decorar" opens the
 * store and editor (ADR 0007) for whoever may decorate.
 */
function ServerSpace(props: { serverId: string }) {
  const loc = useLocation();
  const client = useClient();
  const voice = useVoice();
  const { t } = useLingui();
  const [ui, setUi] = createSignal<SpaceUiState | null>(null);
  const [view, setView] = createSignal<SpaceView | null>(null);
  const [profile, setProfile] = createSignal<ProfileView | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [panel, setPanel] = createSignal<"rooms" | "decor" | null>("rooms");
  const [audioChecked, setAudioChecked] = createSignal(audioCheckedHere());
  const [notice, setNotice] = createSignal("");
  let host: HTMLDivElement | undefined;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

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

  /** What the room's audio is doing, in words; null when there is nothing to say. */
  const mediaText = (m: MediaStatus): string | null => {
    switch (m.kind) {
      case "idle":
        return null;
      case "connecting":
        return t`Conectando áudio…`;
      case "connected":
        return t`Áudio da sala conectado`;
      case "unavailable":
        return m.retrying
          ? t`Áudio indisponível — tentando de novo`
          : t`Áudio indisponível; você continua na sala`;
      case "elsewhere":
        return t`Seu áudio está em outra aba ou outro servidor`;
      case "paused":
        return t`Você está fora do áudio da sala`;
    }
  };
  const mediaAction = (m: MediaStatus): string | null => {
    if (m.kind === "unavailable" && !m.retrying) return t`Tentar de novo`;
    if (m.kind === "elsewhere") return t`Usar aqui`;
    if (m.kind === "paused") return t`Voltar ao áudio`;
    return null;
  };

  const serverId = props.serverId;

  /** Roles of this Stoat server, for "who may decorate". */
  const roles = () =>
    (client().servers.get(serverId)?.orderedRoles ?? []).map((r) => ({
      id: r.id,
      name: r.name,
    }));

  /** Walk to a room (sidebar link or list); says so when the door will not open. */
  function goToRoom(roomId: string) {
    const v = view();
    if (!v) return;
    setNotice(
      v.walkToRoom(roomId) ? "" : t`Não dá para chegar nessa sala daqui.`,
    );
    host?.focus();
  }

  function openDecor(on: boolean) {
    const v = view();
    if (!v) return;
    v.setEditing(on);
    setPanel(on ? "decor" : "rooms");
    host?.focus();
  }

  // The sidebar's voice channels open `?sala=<id>`: walk there once the map is in.
  let walkedTo: string | null = null;
  createEffect(() => {
    const sala = new URLSearchParams(loc.search).get("sala");
    if (!sala) {
      walkedTo = null;
      return;
    }
    if (sala === walkedTo || !view() || !ui()?.location) return;
    walkedTo = sala;
    goToRoom(sala);
  });

  // Rights taken away while editing: the view already left the editor; follow it.
  createEffect(() => {
    const s = ui();
    if (s && panel() === "decor" && !s.editor.enabled) setPanel("rooms");
  });

  onMount(async () => {
    const token = sessionToken(client());
    if (!token || !host)
      return setFailed(t`Entre na sua conta para usar o espaço.`);
    try {
      // Reattaches to a space that stayed connected (in a room, with audio)
      // since its page was last closed.
      const v = await openSpace({
        el: host,
        baseUrl: location.origin,
        sessionToken: token,
        serverId,
        client: clientKind(),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        voice,
        stoat: () => client(),
      });
      if (disposed) return leaveSpacePage(serverId);
      setView(v);
      unsubscribe = v.subscribe(setUi);
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
    unsubscribe?.();
    // In a room with audio, the space stays connected off-page (like a call).
    leaveSpacePage(serverId);
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
        <Show when={notice()}>
          <Muted role="status">{notice()}</Muted>
        </Show>
        <Show when={ui()?.status === "replaced"}>
          <Button variant="tonal" onPress={() => view()?.takeOver()}>
            {t`Usar aqui`}
          </Button>
        </Show>
        <Show when={ui() && mediaText(ui()!.media)}>
          {(text) => (
            <MediaChip role="status" data-kind={ui()!.media.kind}>
              <Symbol size={16}>
                {ui()!.media.kind === "connected" ? "volume_up" : "volume_off"}
              </Symbol>
              {text()}
            </MediaChip>
          )}
        </Show>
        <Show when={ui() && mediaAction(ui()!.media)}>
          {(label) => (
            <Button variant="tonal" onPress={() => view()?.retryMedia()}>
              {label()}
            </Button>
          )}
        </Show>
        <Show when={ui()?.prompt && !ui()?.editor.enabled}>
          {(_) => (
            <PromptChip type="button" onClick={() => view()?.interact()}>
              <Kbd>E</Kbd> {ui()!.prompt!.label}
            </PromptChip>
          )}
        </Show>
        <span style={{ flex: 1 }} />
        <Show when={ui()?.rights.can_edit}>
          <Button
            variant={panel() === "decor" ? "filled" : "tonal"}
            onPress={() => openDecor(panel() !== "decor")}
            aria-pressed={panel() === "decor"}
          >
            <Symbol size={18}>chair</Symbol> {t`Decorar`}
          </Button>
        </Show>
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
            panel() === "rooms"
              ? t`Esconder lista de salas`
              : t`Mostrar lista de salas`
          }
          aria-pressed={panel() === "rooms"}
          onPress={() => {
            if (panel() === "decor") openDecor(false);
            else setPanel(panel() === "rooms" ? null : "rooms");
          }}
        >
          <Symbol>list</Symbol>
        </IconButton>
      </Bar>
      <Body
        data-list={panel() ? "" : undefined}
        data-wide={panel() === "decor" ? "" : undefined}
      >
        {/*
          Two siblings, never one: the map canvas is appended by PixiJS to a
          native element with no JSX children, so Solid never rewrites it.
          Overlays (first access, notices) live next to it. When the only
          dynamic child of an element becomes empty, Solid clears the whole
          element (`textContent = ""`), and that used to wipe the map.
        */}
        <div class={mapArea}>
          <div
            ref={host}
            class={mapCanvas}
            tabIndex={0}
            role="application"
            aria-label={t`Mapa do espaço. Setas ou W A S D para andar, clique para ir até um ponto, E usa o objeto ao lado, + e − para o zoom. A lista de salas tem as mesmas informações.`}
          />
          <Switch>
            <Match when={failed()}>{(msg) => <Notice>{msg()}</Notice>}</Match>
            <Match
              when={
                profile() && profile()!.onboarding_version < ONBOARDING_VERSION
              }
            >
              <Onboarding
                initialPalette={profile()!.look.palette}
                onDone={async (palette) => {
                  // Skipping the whole flow counts for the audio step too.
                  markAudioCheckedHere();
                  setAudioChecked(true);
                  await finishOnboarding(palette);
                }}
              />
            </Match>
            <Match when={profile() && !audioChecked()}>
              <AudioCheckDialog
                onDone={() => {
                  setAudioChecked(true);
                  host?.focus();
                }}
              />
            </Match>
            <Match when={ui()?.interaction}>
              {(interaction) => (
                <InteractionDialog
                  interaction={interaction()}
                  canEdit={ui()?.rights.can_edit ?? false}
                  onClose={() => {
                    view()?.closeInteraction();
                    host?.focus();
                  }}
                />
              )}
            </Match>
          </Switch>
        </div>
        <Show when={panel() === "decor" && view() && ui()}>
          <DecorPanel
            view={view()!}
            ui={ui()!}
            roles={roles()}
            onClose={() => openDecor(false)}
          />
        </Show>
        <Show when={panel() === "rooms"}>
          <List aria-label={t`Lista de salas`}>
            <For each={ui()?.list ?? []}>
              {(wing) => (
                <section>
                  <h3>{wingHeading(wing.title)}</h3>
                  <ul>
                    <For each={wing.rooms}>
                      {(room) => (
                        <li data-here={room.here ? "" : undefined}>
                          <RoomButton
                            type="button"
                            disabled={!room.canEnter || room.here}
                            onClick={() => goToRoom(room.roomId)}
                            aria-label={t`Ir para ${room.title}`}
                          >
                            <span>
                              <Show when={room.isPrivate && !room.canEnter}>
                                <Symbol size={14}>lock</Symbol>{" "}
                              </Show>
                              {room.title}
                            </span>
                            <Muted>{room.status}</Muted>
                          </RoomButton>
                          <Show when={room.canView}>
                            <ChatLink
                              href={`/server/${serverId}/channel/${room.roomId}`}
                              aria-label={t`Chat de ${room.title}`}
                              title={t`Chat da sala`}
                            >
                              <Symbol size={18}>chat</Symbol>
                            </ChatLink>
                          </Show>
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
      <SrOnly aria-live="polite">
        {notice() || ui()?.editor.message || ui()?.announcement || ""}
      </SrOnly>
    </Page>
  );
}

const Page = styled("div", {
  base: {
    // The app's content container is a flex row: grow like ServerHome and the
    // channel pages, or the page shrinks to its toolbar and the map vanishes.
    flexGrow: 1,
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
    flexWrap: "wrap",
  },
});

const Body = styled("div", {
  base: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "1fr",
    "&[data-list]": { gridTemplateColumns: "1fr 280px" },
    "&[data-wide]": { gridTemplateColumns: "1fr 340px" },
    "@media (max-width: 760px)": {
      "&[data-list]": {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr 40%",
      },
      "&[data-wide]": {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr 50%",
      },
    },
  },
});

const mapArea = css({
  position: "relative",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
});

/** Only the map's own canvas: the first-access previews are canvases too. */
const mapCanvas = css({
  position: "absolute",
  inset: 0,
  outline: "none",
  "& > canvas": { position: "absolute", inset: 0 },
  "&:focus-visible": {
    boxShadow: "inset 0 0 0 3px var(--md-sys-color-primary)",
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
      alignItems: "center",
      gap: "4px",
      borderRadius: "8px",
    },
    "& li[data-here]": {
      background: "var(--md-sys-color-secondary-container)",
    },
  },
});

const MediaChip = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 10px",
    borderRadius: "999px",
    fontSize: "0.85em",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface-variant)",
    "&[data-kind=connected]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
    "&[data-kind=unavailable]": {
      background: "var(--md-sys-color-error-container)",
      color: "var(--md-sys-color-on-error-container)",
    },
  },
});

const PromptChip = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "2px 10px 2px 4px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-primary)",
    background: "var(--md-sys-color-primary-container)",
    color: "var(--md-sys-color-on-primary-container)",
    font: "inherit",
    fontSize: "0.85em",
    cursor: "pointer",
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Kbd = styled("kbd", {
  base: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: "20px",
    height: "20px",
    borderRadius: "5px",
    background: "var(--md-sys-color-on-primary-container)",
    color: "var(--md-sys-color-primary-container)",
    fontFamily: "inherit",
    fontSize: "0.8em",
    fontWeight: 700,
  },
});

const RoomButton = styled("button", {
  base: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    padding: "6px 8px",
    border: "none",
    borderRadius: "8px",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    "&:hover:not(:disabled)": {
      background: "var(--md-sys-color-surface-container-high)",
    },
    "&:disabled": { cursor: "default" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const ChatLink = styled("a", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    color: "var(--md-sys-color-on-surface-variant)",
    "&:hover": { background: "var(--md-sys-color-surface-container-high)" },
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
