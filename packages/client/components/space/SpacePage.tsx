import {
  For,
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ConnStatus,
  type ListPerson,
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
import {
  type StageMode,
  type StageTab,
  MediaStage,
  useStageShares,
} from "./MediaStage";
import { AudioCheckDialog, Onboarding } from "./Onboarding";
import { leaveSpacePage, openSpace } from "./session";
import { SmartTv } from "./SmartTv";

/**
 * Refúgio, o jogo do Espaço (ADR 0009): chunk próprio, carregado só quando o
 * painel abre (quem não joga não baixa nada além do botão).
 */
const GamePanel = lazy(() => import("./game/GamePanel"));

const STAGE_MODE_KEY = "muchat.space.stageMode";

function storedStageMode(): StageMode {
  try {
    return localStorage.getItem(STAGE_MODE_KEY) === "focus" ? "focus" : "side";
  } catch {
    return "side";
  }
}

function storeStageMode(mode: StageMode) {
  try {
    localStorage.setItem(STAGE_MODE_KEY, mode);
  } catch {
    // Private window or blocked storage: the mode just is not remembered.
  }
}

/** Narrow screens stack the stage above the map instead of beside it. */
function useNarrow() {
  const query = matchMedia("(max-width: 760px)");
  const [narrow, setNarrow] = createSignal(query.matches);
  const update = () => setNarrow(query.matches);
  query.addEventListener("change", update);
  onCleanup(() => query.removeEventListener("change", update));
  return narrow;
}

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
  const [panel, setPanel] = createSignal<"rooms" | "decor" | "game" | null>(
    "rooms",
  );
  const [audioChecked, setAudioChecked] = createSignal(audioCheckedHere());
  const [notice, setNotice] = createSignal("");
  // Media stage (screens, the room's TV): only in a room, only when opened.
  const [stageOpen, setStageOpen] = createSignal(false);
  const [stageTab, setStageTab] = createSignal<StageTab>("call");
  const [stageMode, setStageModeSignal] =
    createSignal<StageMode>(storedStageMode());
  const [invite, setInvite] = createSignal<{
    key: string;
    name: string;
  } | null>(null);
  const shares = useStageShares();
  const narrow = useNarrow();
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

  /**
   * The game's button: the operator switched it on for this server and the
   * owner did not turn it off (the settings change live; the snapshot does not).
   * Without InteractSpaceObjects the panel says so when it opens.
   */
  const gameOn = createMemo(
    () => !!ui()?.game?.available && ui()?.settings?.game !== "off",
  );
  createEffect(
    on(gameOn, (v) => {
      if (!v && untrack(panel) === "game") setPanel("rooms");
    }),
  );

  function openGame(on: boolean) {
    if (panel() === "decor") view()?.setEditing(false);
    setPanel(on ? "game" : "rooms");
    if (!on) host?.focus();
  }

  function openDecor(on: boolean) {
    const v = view();
    if (!v) return;
    v.setEditing(on);
    setPanel(on ? "decor" : "rooms");
    if (on) setStageOpen(false);
    host?.focus();
  }

  /**
   * The room the person is in (with or without audio), or null in the halls.
   * A memo: `ui()` changes on every move and presence update, and effects
   * keyed on the room (`on(roomId, …)`) must run when the room changes, not
   * on every update — that reset "Parar de ouvir" and the closed TV panel.
   */
  const roomId = createMemo(() => {
    const m = ui()?.media;
    return m && m.kind !== "idle" ? m.roomId : null;
  });
  /** The app's call is this room's, and it is up. */
  const inRoomCall = () => {
    const id = roomId();
    return (
      !!id &&
      ui()?.media.kind === "connected" &&
      voice.channel()?.id === id &&
      voice.state() === "CONNECTED"
    );
  };
  const roomChannel = () => {
    const id = roomId();
    return id ? client().channels.get(id) : undefined;
  };
  const stageVisible = () => stageOpen() && roomId() !== null;

  /** Room under the pointer with its list entry (who is inside). */
  const hoverRoom = () => {
    const h = ui()?.hover;
    if (!h || ui()?.editor.enabled) return null;
    for (const w of ui()?.list ?? []) {
      const room = w.rooms.find((r) => r.roomId === h.roomId);
      if (room) return { x: h.x, y: h.y, room };
    }
    return null;
  };

  function setStageMode(mode: StageMode) {
    setStageModeSignal(mode);
    storeStageMode(mode);
  }

  function openStage(tab: StageTab = "call") {
    if (panel() === "decor") openDecor(false);
    setStageTab(tab);
    setStageOpen(true);
    // The stage takes the room list's place; the list button brings it back.
    if (panel() === "rooms") setPanel(null);
  }

  function closeStage() {
    // Closing the TV's panel is "stop looking", not "stop the TV": the sound
    // goes on while you are in the room, and new videos no longer reopen it.
    if (stageTab() === "tv") tvPanelClosedIn = roomId();
    setStageOpen(false);
    host?.focus();
  }

  /** "Assistir": open the stage on the call and put that screen in focus. */
  function watch(key: string) {
    const s = shares().find((x) => x.key === key);
    openStage("call");
    if (s) voice.focus(s.track);
    setInvite(null);
  }

  // A screen starts in the room: with the stage open on the call, it goes to
  // focus; otherwise a "Fulano está apresentando · Assistir" chip appears.
  let seenShares = new Set<string>();
  createEffect(() => {
    const list = shares();
    const now = new Set(list.map((s) => s.key));
    for (const s of list) {
      if (seenShares.has(s.key) || s.local) continue;
      if (stageVisible() && stageTab() === "call") {
        if (!voice.focusTrack()) voice.focus(s.track);
      } else {
        setInvite({ key: s.key, name: s.name });
      }
      setNotice(t`${s.name} começou a compartilhar a tela.`);
    }
    const inv = invite();
    if (inv && !now.has(inv.key)) setInvite(null);
    seenShares = now;
  });

  // Leaving the room closes the stage; it never holds space in the halls.
  createEffect(() => {
    if (roomId() === null && stageOpen()) setStageOpen(false);
  });

  // ---- Smart TV (ADR 0008) ----
  const roomTv = () => ui()?.tv ?? null;
  const tvPlaying = () => roomTv()?.state?.status === "playing";
  // The room's TV is like a TV in a real room: closing its panel keeps the
  // sound while you are in the room (16/11/2026: "fechar a TV, a música
  // continua"); "Parar de ouvir" silences it for you alone until you open it
  // again or someone puts on another video.
  const [tvListen, setTvListen] = createSignal(true);
  /** The room where this person closed the TV's panel: no auto-reopening there. */
  let tvPanelClosedIn: string | null = null;
  createEffect(
    on(roomId, () => {
      tvPanelClosedIn = null;
      setTvListen(true);
    }),
  );
  /** The player lives while it is seen or heard (it reloads if remounted). */
  const tvMounted = () => {
    const tv = roomTv();
    if (!tv?.hasTv) return false;
    // On screen it always mounts (it also explains a missing permission).
    if (stageVisible() && stageTab() === "tv") return true;
    if (!tv.you.watch) return false;
    const st = tv.state?.status;
    return tvListen() && (st === "playing" || st === "paused");
  };
  function watchTv() {
    setTvListen(true);
    openStage("tv");
  }
  // Using a TV on the map opens it on the stage. A memo, so it fires once per
  // use: with a plain accessor `on` ran on every update of `ui()`, and after
  // one use the TV reopened itself seconds after being closed (16/11/2026).
  const tvOpenRequest = createMemo(() => ui()?.tvOpenRequest ?? 0);
  createEffect(
    on(
      tvOpenRequest,
      (n) => {
        if (n > 0) openStage("tv");
      },
      { defer: true },
    ),
  );
  // Someone puts a video on the room's TV: it plays (and sounds) for everyone
  // in the room. Its panel opens only for someone who is not looking at
  // anything else: not over an open stage (a shared screen, the call), not in
  // fullscreen, not where this person already closed the TV's panel.
  let lastVideo: string | null = null;
  createEffect(() => {
    const s = roomTv()?.state;
    const key = s ? `${s.room_id}:${s.ref}:${s.started_ms}` : null;
    if (key === lastVideo) return;
    lastVideo = key;
    if (!s || s.status !== "playing" || !roomTv()?.you.watch) return;
    setTvListen(true);
    if (s.by_name && s.by !== client().user?.id)
      setNotice(t`${s.by_name} colocou um vídeo na TV da sala.`);
    const busy = untrack(
      () =>
        stageVisible() ||
        voice.layout() === "fullscreen" ||
        tvPanelClosedIn === roomId(),
    );
    if (!busy) openStage("tv");
  });

  /** Grid of the page: map, stage (beside it or in focus), side panel. */
  const gridStyle = () => {
    const st = stageVisible() ? stageMode() : null;
    const side =
      panel() === "rooms"
        ? "280px"
        : panel() === "decor"
          ? "340px"
          : panel() === "game"
            ? "400px"
            : null;
    if (narrow()) {
      const areas: string[] = [];
      const rows: string[] = [];
      if (st) {
        areas.push('"stage"');
        rows.push(st === "focus" ? "minmax(0, 1fr)" : "45%");
      }
      areas.push('"map"');
      rows.push(st === "focus" ? "30%" : "minmax(0, 1fr)");
      if (side) {
        areas.push('"panel"');
        rows.push(panel() === "decor" || panel() === "game" ? "55%" : "40%");
      }
      return {
        "grid-template-columns": "minmax(0, 1fr)",
        "grid-template-rows": rows.join(" "),
        "grid-template-areas": areas.join(" "),
      };
    }
    const areas: string[] = [];
    const cols: string[] = [];
    if (st === "focus") {
      areas.push("stage", "map");
      cols.push("minmax(0, 1fr)", "300px");
    } else {
      areas.push("map");
      cols.push("minmax(0, 1fr)");
      if (st === "side") {
        areas.push("stage");
        cols.push("minmax(360px, 44%)");
      }
    }
    if (side) {
      areas.push("panel");
      cols.push(side);
    }
    return {
      "grid-template-columns": cols.join(" "),
      "grid-template-rows": "minmax(0, 1fr)",
      "grid-template-areas": `"${areas.join(" ")}"`,
    };
  };

  /** Page shortcuts that the map does not use (it takes WASD, arrows, E, +, −). */
  function pageKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyF" && !e.shiftKey && stageVisible()) {
      e.preventDefault();
      setStageMode(stageMode() === "focus" ? "side" : "focus");
    } else if (e.code === "KeyP" && !e.shiftKey && roomId() !== null) {
      e.preventDefault();
      if (stageOpen()) closeStage();
      else openStage(stageTab());
    } else if (e.code === "KeyM" && !e.shiftKey && inRoomCall()) {
      e.preventDefault();
      voice.toggleMute();
    } else if (e.code === "KeyD" && e.shiftKey && inRoomCall()) {
      e.preventDefault();
      voice.toggleDeafen();
    } else if (e.code === "KeyS" && e.shiftKey && inRoomCall()) {
      e.preventDefault();
      if (voice.screenshare() || voice.channel()?.havePermission("Video")) {
        voice.toggleScreenshare();
      }
    }
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
    } catch (err) {
      console.error("[space] could not open the map", err);
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
    <Page onKeyDown={pageKey}>
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
        <Show when={invite()}>
          {(inv) => (
            <PromptChip type="button" onClick={() => watch(inv().key)}>
              <Symbol size={16}>present_to_all</Symbol>
              {t`${inv().name} está apresentando · Assistir`}
            </PromptChip>
          )}
        </Show>
        <Show when={tvPlaying() && !(stageVisible() && stageTab() === "tv")}>
          <PromptChip type="button" onClick={watchTv}>
            <Symbol size={16}>live_tv</Symbol>
            {tvListen() && tvMounted()
              ? t`TV tocando · Abrir`
              : t`TV da sala ligada · Assistir`}
          </PromptChip>
          <Show when={tvListen() && tvMounted()}>
            <PromptChip
              type="button"
              data-quiet=""
              onClick={() => setTvListen(false)}
              title={t`Para o som da TV só para você; a sala continua assistindo`}
            >
              <Symbol size={16}>volume_off</Symbol>
              {t`Parar de ouvir`}
            </PromptChip>
          </Show>
        </Show>
        <span style={{ flex: 1 }} />
        <Show when={roomId() !== null}>
          <Button
            variant={stageVisible() ? "filled" : "tonal"}
            onPress={() => (stageOpen() ? closeStage() : openStage())}
            aria-pressed={stageVisible()}
            use:floating={{
              tooltip: {
                placement: "bottom",
                content: t`Palco da sala: telas compartilhadas e a chamada (P)`,
              },
            }}
          >
            <Symbol size={18}>co_present</Symbol> {t`Palco`}
            <Show when={shares().length > 0 && !stageVisible()}>
              <LiveDot aria-label={t`Alguém está apresentando`} />
            </Show>
          </Button>
        </Show>
        <Show when={gameOn()}>
          <Button
            variant={panel() === "game" ? "filled" : "tonal"}
            onPress={() => openGame(panel() !== "game")}
            aria-pressed={panel() === "game"}
          >
            <Symbol size={18}>swords</Symbol> {t`Aventura`}
          </Button>
        </Show>
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
      <Body style={gridStyle()}>
        {/*
          Two siblings, never one: the map canvas is appended by PixiJS to a
          native element with no JSX children, so Solid never rewrites it.
          Overlays (first access, notices) live next to it. When the only
          dynamic child of an element becomes empty, Solid clears the whole
          element (`textContent = ""`), and that used to wipe the map.
        */}
        <div class={mapArea} style={{ "grid-area": "map" }}>
          <div
            ref={host}
            class={mapCanvas}
            tabIndex={0}
            role="application"
            aria-label={t`Mapa do espaço. Setas ou W A S D para andar, clique para ir até um ponto, E usa o objeto ao lado, + e − para o zoom. Numa sala: P abre o palco, F amplia o palco, M liga e desliga o microfone, Shift+D ensurdece, Shift+S compartilha a tela. A lista de salas tem as mesmas informações.`}
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
          <Show when={hoverRoom()}>
            {(h) => (
              <Tooltip
                role="tooltip"
                style={{ left: `${h().x + 14}px`, top: `${h().y + 14}px` }}
              >
                <strong>{h().room.title}</strong>
                <Show
                  when={h().room.people.length}
                  fallback={
                    <Muted>
                      {h().room.canView ? t`vazia` : t`sem acesso à lista`}
                    </Muted>
                  }
                >
                  <For each={h().room.people}>
                    {(p) => <PersonLine person={p} />}
                  </For>
                </Show>
              </Tooltip>
            )}
          </Show>
        </div>
        {/*
          The stage stays mounted while you are in a room: closed, it moves
          off screen (never display: none) so the TV it holds can keep playing
          without reloading its player.
        */}
        <Show when={roomId() !== null}>
          <div
            aria-hidden={stageVisible() ? undefined : "true"}
            inert={!stageVisible()}
            style={
              stageVisible()
                ? {
                    "grid-area": "stage",
                    display: "flex",
                    "min-height": 0,
                    "min-width": 0,
                  }
                : {
                    position: "fixed",
                    left: "-10000px",
                    top: 0,
                    width: "480px",
                    height: "360px",
                    display: "flex",
                    "pointer-events": "none",
                  }
            }
          >
            <MediaStage
              visible={stageVisible()}
              tvMounted={tvMounted()}
              onStopListening={() => {
                setTvListen(false);
                closeStage();
              }}
              channel={roomChannel()}
              connected={inRoomCall()}
              tab={stageTab()}
              onTab={setStageTab}
              mode={stageMode()}
              onMode={setStageMode}
              onClose={closeStage}
              mediaText={ui() ? mediaText(ui()!.media) : null}
              mediaAction={
                ui() && mediaAction(ui()!.media)
                  ? {
                      label: mediaAction(ui()!.media)!,
                      run: () => view()?.retryMedia(),
                    }
                  : null
              }
              hasTv={!!roomTv()?.hasTv}
              tv={
                <Show when={view() && roomTv()}>
                  <SmartTv
                    view={view()!}
                    tv={roomTv()!}
                    error={ui()?.tvError ?? null}
                  />
                </Show>
              }
              canModerate={!!roomChannel()?.havePermission("MuteMembers")}
              layoutKey={`${stageMode()}:${panel() ?? ""}:${narrow()}`}
              onStopShare={(userId) => view()?.stopScreenOf(userId)}
            />
          </div>
        </Show>
        <Show when={panel() === "game" && view()}>
          {(v) => (
            <Suspense>
              <GamePanel view={v()} onClose={() => openGame(false)} />
            </Suspense>
          )}
        </Show>
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
                          <Show when={room.canView && !room.here}>
                            <PeekButton
                              type="button"
                              onClick={() => {
                                view()?.peekRoom(room.roomId);
                                host?.focus();
                              }}
                              aria-label={t`Ver ${room.title} no mapa`}
                              title={t`Ver no mapa`}
                            >
                              <Symbol size={18}>visibility</Symbol>
                            </PeekButton>
                          </Show>
                          <Show when={room.people.length}>
                            <People aria-label={t`Quem está em ${room.title}`}>
                              <For each={room.people}>
                                {(p) => <PersonLine person={p} />}
                              </For>
                            </People>
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

/**
 * Someone inside a room (server presence): in the call or not, and what their
 * call shows. Icons always come with text for screen readers.
 */
function PersonLine(props: { person: ListPerson }) {
  const { t } = useLingui();
  const v = () => props.person.voice;
  const reconnecting = () => props.person.state === "reconnecting";
  const muted = () => !!v()?.connected && !v()!.mic;
  return (
    <PersonRow data-dim={reconnecting() || !v()?.connected ? "" : undefined}>
      <Dot
        data-state={
          reconnecting() ? "reconnecting" : v()?.connected ? "call" : "room"
        }
      />
      <span class={personName}>{props.person.name}</span>
      <Show when={reconnecting()}>
        <Symbol size={14} aria-label={t`reconectando`}>
          sync
        </Symbol>
      </Show>
      <Show when={!reconnecting() && !v()}>
        <SmallNote>{t`fora da chamada`}</SmallNote>
      </Show>
      <Show when={!reconnecting() && v() && !v()!.connected}>
        <SmallNote>{t`conectando…`}</SmallNote>
      </Show>
      <Show when={muted()}>
        <Symbol size={14} aria-label={t`microfone desligado`}>
          mic_off
        </Symbol>
      </Show>
      <Show when={v()?.deaf}>
        <Symbol size={14} aria-label={t`ensurdecido`}>
          headset_off
        </Symbol>
      </Show>
      <Show when={v()?.camera}>
        <Symbol size={14} aria-label={t`câmera ligada`}>
          videocam
        </Symbol>
      </Show>
      <Show when={v()?.screen}>
        <Symbol size={14} aria-label={t`compartilhando a tela`}>
          screen_share
        </Symbol>
      </Show>
    </PersonRow>
  );
}

const People = styled("ul", {
  base: {
    flexBasis: "100%",
    paddingInlineStart: "10px !important",
    marginBottom: "4px !important",
  },
});

const PersonRow = styled("li", {
  base: {
    display: "flex !important",
    alignItems: "center",
    gap: "6px !important",
    fontSize: "0.85em",
    padding: "1px 4px",
    color: "var(--md-sys-color-on-surface)",
    "&[data-dim]": { color: "var(--md-sys-color-on-surface-variant)" },
  },
});

const personName = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
});

const Dot = styled("span", {
  base: {
    flexShrink: 0,
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: "var(--md-sys-color-outline)",
    "&[data-state=call]": { background: "#4ade80" },
    "&[data-state=reconnecting]": { background: "#facc15" },
  },
});

const SmallNote = styled("span", {
  base: { fontSize: "0.85em", color: "var(--md-sys-color-on-surface-variant)" },
});

const Tooltip = styled("div", {
  base: {
    position: "absolute",
    zIndex: 3,
    pointerEvents: "none",
    minWidth: "160px",
    maxWidth: "260px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "rgba(21, 19, 26, 0.92)",
    color: "#fff",
    fontSize: "0.85em",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
    "& li": { color: "#fff", listStyle: "none" },
  },
});

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

/**
 * Map, media stage and side panel (room list or decoration). The columns and
 * areas come from `gridStyle()` (stage beside the map, in focus, or stacked
 * on narrow screens); the side panels are the `aside` children.
 */
const Body = styled("div", {
  base: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    "& > aside": { gridArea: "panel", minHeight: 0 },
  },
});

const LiveDot = styled("span", {
  base: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "var(--md-sys-color-error)",
    marginInlineStart: "2px",
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
      flexWrap: "wrap",
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

const PeekButton = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    border: "none",
    borderRadius: "8px",
    background: "transparent",
    color: "var(--md-sys-color-on-surface-variant)",
    cursor: "pointer",
    "&:hover": { background: "var(--md-sys-color-surface-container-high)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
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
