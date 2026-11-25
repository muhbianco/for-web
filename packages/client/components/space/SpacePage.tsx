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
import {
  type ProfileView,
  ONBOARDING_VERSION,
  hasUnreadNews,
} from "@muchat/space-core";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { useLocation, useParams } from "@revolt/routing";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import { Button, IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { reloadForUpdate, staleBuild } from "../../src/staleBuild";

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
import { newsLastSeen } from "./newsSeen";
import { AudioCheckDialog, Onboarding } from "./Onboarding";
import { leaveSpacePage, openSpace } from "./session";
import { SmartTv } from "./SmartTv";

/**
 * Jogo idle (docs/espaco/jogo/ot): o diálogo do dummy e a faixa "treinando", num chunk que
 * só carrega quando alguém usa um dummy ou está treinando.
 */
const TrainingDialog = lazy(() => import("./game/TrainingDialog"));
const TrainingChip = lazy(() => import("./game/TrainingChip"));
const HeroSheet = lazy(() => import("./game/HeroSheet"));
const NpcDialog = lazy(() => import("./game/NpcDialog"));
const NewsPanel = lazy(() => import("./NewsPanel"));
/** O menu da TV com o jogo ligado e a faixa do grupo da dungeon (etapa O4). */
const TvMenu = lazy(() => import("./game/TvMenu"));
const LobbyChip = lazy(() => import("./game/LobbyChip"));
/** A corrida da dungeon: a faixa e a tela da aventura (etapa O5). */
const RunChip = lazy(() => import("./game/RunChip"));
const RunPanel = lazy(() => import("./game/RunPanel"));

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
 * Phones (portrait, or landscape with little height): the map fills the page,
 * the room list and decoration are sheets over it, the stage opens over the
 * whole map and the actions (hero, use, watch, TV) sit at the bottom, within
 * thumb reach (23/11/2026: "mobile tá impossível"). Tablets keep the layout of
 * the computer, with bigger touch targets.
 */
function useCompact() {
  const query = matchMedia(
    "(max-width: 600px), (pointer: coarse) and (max-height: 500px)",
  );
  const [compact, setCompact] = createSignal(query.matches);
  const update = () => setCompact(query.matches);
  query.addEventListener("change", update);
  onCleanup(() => query.removeEventListener("change", update));
  return compact;
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
  const compact = useCompact();
  /** A touch screen (phone or tablet): the map comes first, bigger targets. */
  const touch = matchMedia("(pointer: coarse)").matches;
  // On a touch screen the map comes first: the room list opens from its button.
  const [panel, setPanel] = createSignal<"rooms" | "decor" | null>(
    compact() || touch ? null : "rooms",
  );
  // The width left for the space (the app's sidebar takes its part on tablets):
  // too little for a side column, and the panels float over the map.
  const [bodyWidth, setBodyWidth] = createSignal(Number.POSITIVE_INFINITY);
  let bodyEl: HTMLDivElement | undefined;
  onMount(() => {
    if (!bodyEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBodyWidth(e.contentRect.width));
    ro.observe(bodyEl);
    onCleanup(() => ro.disconnect());
  });
  /** No room for a column beside the map: the room list and decoration float over it. */
  const sheets = () => compact() || bodyWidth() < 720;
  /**
   * The stage goes above the map instead of beside it: beside it, the call
   * card's buttons need ~400 px and the map its own share (a tablet in
   * landscape keeps the app's sidebar, 23/11/2026).
   */
  const stacked = () => narrow() || bodyWidth() < 1000;
  const [audioChecked, setAudioChecked] = createSignal(audioCheckedHere());
  const [notice, setNotice] = createSignal("");
  // The hero sheet (game stage O7): equipment, backpack, coins.
  const [heroOpen, setHeroOpen] = createSignal(false);
  // Who is in the space now, for the banker's transfer (stage O8): the rooms' people, not us.
  const npcPeople = createMemo(() => {
    const me = client().user?.id;
    const seen = new Map<string, string>();
    for (const w of ui()?.list ?? [])
      for (const r of w.rooms)
        for (const p of r.people)
          if (p.userId !== me && !seen.has(p.userId))
            seen.set(p.userId, p.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  });

  // A dungeon group started in our room (stage O4): the room hears about it. The dungeon's
  // name comes with the game's chunk, not this page's. Keyed on a memo: `ui()` changes on
  // every patch, and without it this ran again each time (it closed the TV menu of whoever
  // had run, as soon as it opened, and kept rewriting the notice).
  const lobbyStartedN = createMemo(() => ui()?.lobbyStarted?.n ?? 0);
  createEffect(
    on(
      lobbyStartedN,
      (n) => {
        const started = untrack(() => ui()?.lobbyStarted);
        if (!n || !started) return;
        // Who went in leaves the TV menu (the leader's closes on the answer already).
        const me = client().user?.id;
        if (
          me &&
          started.members.some((m) => m.user_id === me) &&
          untrack(ui)?.tvMenu
        ) {
          untrack(view)?.closeTvMenu();
          host?.focus();
        }
        const names = started.members.map((m) => m.name).join(", ");
        void import("@muchat/space-core/game/ot/balance").then((m) => {
          const dungeon =
            m.dungeonById(started.dungeon)?.name ?? started.dungeon;
          setNotice(t`O grupo de ${names} entrou na dungeon ${dungeon}.`);
        });
      },
      { defer: true },
    ),
  );
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
  const appState = useState();
  /** Back to the server's channels: the drawer on phones, the sidebar elsewhere. */
  function showChannels() {
    const drawer = appState.appDrawer();
    if (drawer) drawer.setShown(false);
    else
      appState.layout.toggleSectionState(LAYOUT_SECTIONS.PRIMARY_SIDEBAR, true);
  }
  // A landscape phone gets the app's tablet layout, with the channel sidebar
  // beside the map: close it, the map needs the width (the menu button brings
  // it back). Phones in portrait use the drawer and need nothing.
  createEffect(() => {
    if (compact() && !appState.appDrawer())
      appState.layout.setSectionState(
        LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
        false,
        true,
      );
  });
  // What covers the map (a sheet, the dock, the run panel) moves the camera: you
  // stay in the part you can see. Measured after every layout change and resize.
  let mapAreaEl: HTMLDivElement | undefined;
  const measureInsets = () => {
    const v = view();
    const area = mapAreaEl?.getBoundingClientRect();
    if (!v || !area || area.width === 0) return;
    let right = 0;
    let bottom = 0;
    const covers = [
      ...(bodyEl?.querySelectorAll(":scope > aside") ?? []),
      ...(mapAreaEl?.querySelectorAll("[data-covers-map]") ?? []),
    ];
    for (const el of covers) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right < area.left || r.left > area.right) continue;
      if (r.bottom < area.top || r.top > area.bottom) continue;
      // Along the right edge (taller than half the map): covers a column.
      if (r.right >= area.right - 2 && r.height > area.height / 2)
        right = Math.max(right, area.right - r.left);
      // Along the bottom edge (wider than half): covers a band.
      else if (r.bottom >= area.bottom - 2 && r.width > area.width / 2)
        bottom = Math.max(bottom, area.bottom - r.top);
    }
    v.setInsets(right, bottom);
  };
  const remeasure = () =>
    requestAnimationFrame(() => requestAnimationFrame(measureInsets));
  createEffect(() => {
    // Everything that opens or closes something over the map.
    void [panel(), sheets(), compact(), stageVisible(), ui()?.runOpen, view()];
    remeasure();
  });
  onMount(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(remeasure);
    if (mapAreaEl) ro.observe(mapAreaEl);
    if (bodyEl) ro.observe(bodyEl);
    onCleanup(() => ro.disconnect());
  });
  // On a phone the object within reach is a button at the bottom, not a bubble
  // drawn on the map.
  createEffect(() => view()?.setMapPrompt(!compact()));
  // Quadro de avisos (25/11/2026): ao entrar e a cada 15 min, confere se há nota que esta
  // pessoa não leu; o quadro do mapa ganha o alfinete vermelho. Falha é silenciosa (só o alfinete).
  createEffect(
    on(view, (v) => {
      if (!v) return;
      let stopped = false;
      const check = async () => {
        try {
          const wire = await v.news();
          if (!stopped)
            v.setNewsUnread(hasUnreadNews(wire.items, newsLastSeen()));
        } catch {
          // Sem novidades agora: o quadro fica sem alfinete.
        }
      };
      void check();
      const timer = setInterval(() => void check(), 15 * 60_000);
      onCleanup(() => {
        stopped = true;
        clearInterval(timer);
      });
    }),
  );
  // On a phone the notices pop over the map for a few seconds instead of
  // stretching the header.
  const [toast, setToast] = createSignal("");
  createEffect(
    on(notice, (n) => {
      setToast(n);
      if (!n) return;
      const timer = setTimeout(() => setToast(""), 6_000);
      onCleanup(() => clearTimeout(timer));
    }),
  );
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
    if (sheets() && panel() === "rooms") setPanel(null);
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

  /**
   * Android's back button: the Muchat APK asks the page first
   * (`window.muchatBack()`) and only goes back (or to the background, during a
   * call) when nothing was open. Closes what is on top: a dialog, the run, the
   * stage, the sheet. Without it, back during a call sent the app away with the
   * hero sheet still open (23/11/2026).
   */
  function back(): boolean {
    const u = ui();
    const v = view();
    if (!u || !v) return false;
    if (u.tvMenu) v.closeTvMenu();
    else if (heroOpen()) setHeroOpen(false);
    else if (u.npcRequest) v.closeNpcRequest();
    else if (u.newsRequest) v.closeNewsRequest();
    else if (u.trainRequest) v.closeTrainRequest();
    else if (u.interaction) v.closeInteraction();
    else if (u.runOpen) v.closeRun();
    else if (stageVisible()) closeStage();
    else if (panel() === "decor") openDecor(false);
    else if (panel()) setPanel(null);
    else return false;
    host?.focus();
    return true;
  }
  onMount(() => {
    const w = window as unknown as { muchatBack?: () => boolean };
    w.muchatBack = back;
    onCleanup(() => {
      if (w.muchatBack === back) delete w.muchatBack;
    });
  });

  /** "Assistir": open the stage on the call and put that screen in focus. */
  function watch(key: string) {
    const s = shares().find((x) => x.key === key);
    openStage("call");
    if (s) voice.focus(s.track);
    setInvite(null);
  }

  // A click on someone sharing a screen on the map (the live screen over their head)
  // opens that screen here. Only screens of our call can show: someone presenting in
  // another room, or before we join the call, gets a line saying where to go.
  const watchRequest = createMemo(() => ui()?.watchRequest ?? null, null, {
    equals: (a, b) => a?.n === b?.n,
  });
  createEffect(
    on(
      watchRequest,
      (r) => {
        if (!r) return;
        const s = untrack(shares).find((x) => x.userId === r.userId);
        if (s) {
          watch(s.key);
          return;
        }
        for (const w of untrack(ui)?.list ?? []) {
          for (const room of w.rooms) {
            const who = room.people.find((p) => p.userId === r.userId);
            if (!who) continue;
            setNotice(
              room.here
                ? t`Entre na chamada da sala para assistir à tela de ${who.name}.`
                : t`${who.name} está apresentando na sala ${room.title}: entre lá para assistir.`,
            );
            return;
          }
        }
      },
      { defer: true },
    ),
  );

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

  /** Width of the side column (wide screens); 0 with no panel open. */
  const sideWidth = () =>
    panel() === "rooms" ? 280 : panel() === "decor" ? 340 : 0;
  /** Share of the page height the panel row takes (narrow screens), in %. */
  const panelRowPct = () => (!panel() ? 0 : panel() === "decor" ? 55 : 40);

  /** Grid of the page: map, stage (beside it or in focus), side panel. */
  const gridStyle = () => {
    if (compact())
      return {
        "grid-template-columns": "minmax(0, 1fr)",
        "grid-template-rows": "minmax(0, 1fr)",
        "grid-template-areas": '"map"',
      };
    const st = stageVisible() ? stageMode() : null;
    const side = sideWidth() && !sheets() ? `${sideWidth()}px` : null;
    if (stacked()) {
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
        rows.push(`${panelRowPct()}%`);
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
      // Lab only (packages/client/qa/full-lab): the mobile audit opens the game
      // dialogs through the view. Unset in production builds, so Vite drops it.
      if (import.meta.env.VITE_SPACE_TEST_HOOKS === "1")
        (window as unknown as { __spaceView?: SpaceView }).__spaceView = v;
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

  /**
   * The actions of the moment: hero sheet, training, lobbies, runs, the object
   * beside you, a screen to watch, the TV. In the header on wide screens, in the
   * dock at the bottom of the map on phones.
   */
  const actionChips = () => (
    <>
      {/*
            A tab from before a deploy can't load the dialogs it hasn't opened yet (the
            files changed on the server): offer the reload here, where the taps fail.
          */}
      <Show when={staleBuild()}>
        <PromptChip type="button" onClick={reloadForUpdate}>
          <Symbol size={16}>refresh</Symbol>
          {t`Versão nova do Muchat · Recarregar`}
        </PromptChip>
      </Show>
      <Show when={view() && ui()?.rpg}>
        <PromptChip
          type="button"
          data-quiet=""
          aria-pressed={heroOpen()}
          onClick={() => setHeroOpen(!heroOpen())}
        >
          <Symbol size={16}>shield_person</Symbol>
          {ui()?.rpg?.hero ? t`Herói` : t`Criar herói`}
        </PromptChip>
      </Show>
      <Show when={view() && ui()?.rpg?.hero?.dojo ? ui()!.rpg : null}>
        {(rpg) => (
          <Suspense>
            <TrainingChip link={view()!} rpg={rpg()} />
          </Suspense>
        )}
      </Show>
      <Show
        when={
          view() && Object.keys(ui()?.lobbies ?? {}).length > 0
            ? ui()!.lobbies
            : null
        }
      >
        {(lobbies) => (
          <Suspense>
            <LobbyChip
              link={view()!}
              lobbies={lobbies()}
              myId={client().user?.id ?? null}
              onAct={() => host?.focus()}
            />
          </Suspense>
        )}
      </Show>
      <Show
        when={
          view() && Object.keys(ui()?.runs ?? {}).length > 0 ? ui()!.runs : null
        }
      >
        {(runs) => (
          <Suspense>
            <RunChip
              link={view()!}
              runs={runs()}
              myId={client().user?.id ?? null}
              onAct={() => host?.focus()}
            />
          </Suspense>
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
    </>
  );

  return (
    <Page onKeyDown={pageKey}>
      <Bar data-compact={compact() ? "" : undefined}>
        <Show when={compact() || touch}>
          <IconButton aria-label={t`Canais do servidor`} onPress={showChannels}>
            <Symbol>{appState.appDrawer() ? "arrow_back" : "menu"}</Symbol>
          </IconButton>
        </Show>
        <strong class={place}>{ui()?.location || t`Espaço`}</strong>
        <Show when={!compact() || (ui() && ui()!.status !== "online")}>
          <Muted>{ui() ? statusText(ui()!.status) : ""}</Muted>
        </Show>
        <Show when={notice() && !compact()}>
          <Muted role="status">{notice()}</Muted>
        </Show>
        <Show when={ui()?.status === "replaced"}>
          <Button variant="tonal" onPress={() => view()?.takeOver()}>
            {t`Usar aqui`}
          </Button>
        </Show>
        <Show when={ui() && mediaText(ui()!.media)}>
          {(text) => (
            <MediaChip
              role="status"
              data-kind={ui()!.media.kind}
              data-compact={compact() ? "" : undefined}
              title={text()}
              aria-label={compact() ? text() : undefined}
            >
              <Symbol size={16}>
                {ui()!.media.kind === "connected" ? "volume_up" : "volume_off"}
              </Symbol>
              <Show when={!compact()}>{text()}</Show>
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
        <Show when={!compact()}>{actionChips()}</Show>
        <span style={{ flex: 1 }} />
        <Show when={roomId() !== null}>
          <Show
            when={compact()}
            fallback={
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
            }
          >
            <span class={badged}>
              <IconButton
                variant={stageVisible() ? "filled" : "tonal"}
                aria-label={t`Palco`}
                aria-pressed={stageVisible()}
                onPress={() => (stageOpen() ? closeStage() : openStage())}
              >
                <Symbol>co_present</Symbol>
              </IconButton>
              <Show when={shares().length > 0 && !stageVisible()}>
                <LiveDot aria-label={t`Alguém está apresentando`} />
              </Show>
            </span>
          </Show>
        </Show>
        <Show when={ui()?.rights.can_edit}>
          <Show
            when={compact()}
            fallback={
              <Button
                variant={panel() === "decor" ? "filled" : "tonal"}
                onPress={() => openDecor(panel() !== "decor")}
                aria-pressed={panel() === "decor"}
              >
                <Symbol size={18}>chair</Symbol> {t`Decorar`}
              </Button>
            }
          >
            <IconButton
              variant={panel() === "decor" ? "filled" : "tonal"}
              aria-label={t`Decorar`}
              aria-pressed={panel() === "decor"}
              onPress={() => openDecor(panel() !== "decor")}
            >
              <Symbol>chair</Symbol>
            </IconButton>
          </Show>
        </Show>
        {/* Touch screens zoom with two fingers on the map. */}
        <span class={zoomButtons}>
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
        </span>
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
        ref={bodyEl}
        style={gridStyle()}
        data-compact={compact() ? "" : undefined}
        data-sheets={sheets() && !compact() ? "" : undefined}
      >
        {/*
          Two siblings, never one: the map canvas is appended by PixiJS to a
          native element with no JSX children, so Solid never rewrites it.
          Overlays (first access, notices) live next to it. When the only
          dynamic child of an element becomes empty, Solid clears the whole
          element (`textContent = ""`), and that used to wipe the map.
        */}
        <div ref={mapAreaEl} class={mapArea} style={{ "grid-area": "map" }}>
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
            <Match when={view() && ui()?.tvMenu}>
              {(request) => (
                <Suspense>
                  <TvMenu
                    link={view()!}
                    request={request()}
                    hero={ui()?.rpg?.hero ?? null}
                    lobbies={Object.values(ui()?.lobbies ?? {}).filter(
                      (l) => l.tv === request().instance,
                    )}
                    mine={
                      Object.values(ui()?.lobbies ?? {}).find((l) =>
                        l.members.some((m) => m.user_id === client().user?.id),
                      ) ?? null
                    }
                    board={ui()?.board ?? null}
                    roomTitle={(roomId) => {
                      for (const w of ui()?.list ?? [])
                        for (const r of w.rooms)
                          if (r.roomId === roomId) return r.title;
                      return null;
                    }}
                    myId={client().user?.id ?? null}
                    onClose={() => {
                      view()?.closeTvMenu();
                      host?.focus();
                    }}
                  />
                </Suspense>
              )}
            </Match>
            <Match when={heroOpen() && view() && ui()?.rpg ? ui()!.rpg : null}>
              {(rpg) => (
                <Suspense>
                  <HeroSheet
                    link={view()!}
                    rpg={rpg()}
                    name={
                      client().user?.displayName ??
                      client().user?.username ??
                      ""
                    }
                    onClose={() => {
                      setHeroOpen(false);
                      host?.focus();
                    }}
                  />
                </Suspense>
              )}
            </Match>
            <Match when={view() && ui()?.npcRequest}>
              {(request) => (
                <Suspense>
                  <NpcDialog
                    link={view()!}
                    request={request()}
                    rpg={ui()?.rpg ?? null}
                    people={npcPeople()}
                    onClose={() => {
                      view()?.closeNpcRequest();
                      host?.focus();
                    }}
                  />
                </Suspense>
              )}
            </Match>
            <Match when={view() && ui()?.newsRequest}>
              {(request) => (
                <Suspense>
                  <NewsPanel
                    view={view()!}
                    title={request().title}
                    onClose={() => {
                      view()?.closeNewsRequest();
                      host?.focus();
                    }}
                  />
                </Suspense>
              )}
            </Match>
            <Match when={view() && ui()?.trainRequest}>
              {(request) => (
                <Suspense>
                  <TrainingDialog
                    link={view()!}
                    request={request()}
                    rpg={ui()?.rpg ?? null}
                    onClose={() => {
                      view()?.closeTrainRequest();
                      host?.focus();
                    }}
                  />
                </Suspense>
              )}
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
          <Show
            when={
              view() && ui()?.runOpen
                ? (ui()!.runs[ui()!.runOpen!.id] ?? null)
                : null
            }
          >
            {(state) => (
              <Suspense>
                <RunPanel
                  state={state()}
                  myId={client().user?.id ?? null}
                  hero={ui()?.rpg?.hero ?? null}
                  paletteOf={(id) => view()?.paletteOf(id) ?? 0}
                  link={view()!}
                  lobby={
                    Object.values(ui()?.lobbies ?? {}).find((l) =>
                      l.members.some((m) => m.user_id === client().user?.id),
                    ) ?? null
                  }
                  onClose={() => {
                    view()?.closeRun();
                    host?.focus();
                  }}
                />
              </Suspense>
            )}
          </Show>
          <Show when={compact()}>
            <Show when={toast()}>
              <Toast role="status">{toast()}</Toast>
            </Show>
            {/* The run panel covers the bottom of a phone: no dock under it. */}
            <Show when={!panel() && !stageVisible() && !ui()?.runOpen}>
              <Dock data-covers-map="">{actionChips()}</Dock>
            </Show>
          </Show>
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
              stageVisible() && compact()
                ? {
                    // A phone has no room for the map beside the stage.
                    position: "absolute",
                    inset: 0,
                    "z-index": 6,
                    display: "flex",
                    animation: matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                      ? undefined
                      : "spacePop 180ms ease-out",
                    background:
                      "var(--md-sys-color-surface-container-lowest, #14151c)",
                  }
                : stageVisible()
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
              compact={compact()}
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
              layoutKey={`${stageMode()}:${panel() ?? ""}:${stacked()}:${sheets()}:${compact()}`}
              onStopShare={(userId) => view()?.stopScreenOf(userId)}
            />
          </div>
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
        <LivePill title={t`Compartilhando a tela`}>
          <Symbol size={12} aria-hidden="true">
            screen_share
          </Symbol>
          {t`ao vivo`}
        </LivePill>
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
    // A phone: one row, the place's name gives way (ellipsis).
    "&[data-compact]": {
      flexWrap: "nowrap",
      gap: "4px",
      padding: "4px 6px",
      paddingTop: "max(4px, env(safe-area-inset-top))",
    },
  },
});

/** The place's name in the header; on a phone it shrinks with an ellipsis. */
const place = css({
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/** An icon button with the live dot in its corner (the stage on a phone). */
const badged = css({
  position: "relative",
  display: "inline-flex",
  "& > span:last-child": {
    position: "absolute",
    top: "4px",
    right: "4px",
    pointerEvents: "none",
  },
});

/** The zoom buttons: touch screens pinch the map instead. */
const zoomButtons = css({
  display: "contents",
  "@media (pointer: coarse)": { display: "none" },
});

/** The actions of the moment, at the bottom of the map on a phone. */
const Dock = styled("div", {
  base: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    display: "flex",
    gap: "8px",
    overflowX: "auto",
    padding: "8px 12px",
    paddingBottom: "max(8px, env(safe-area-inset-bottom))",
    // The map stays tappable between the chips.
    pointerEvents: "none",
    "& > *": { pointerEvents: "auto", flex: "0 0 auto" },
    "&:empty": { display: "none" },
  },
});

/** A notice over the map, on a phone (it fades after a few seconds). */
const Toast = styled("div", {
  base: {
    position: "absolute",
    top: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 3,
    maxWidth: "calc(100% - 24px)",
    padding: "8px 14px",
    borderRadius: "12px",
    background: "rgba(21, 19, 26, 0.92)",
    color: "#fff",
    fontSize: "0.9em",
    textAlign: "center",
    pointerEvents: "none",
    animation: "spacePop 180ms ease-out",
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
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
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    "& > aside": { gridArea: "panel", minHeight: 0 },
    // Too narrow for a column (a tablet with the app's sidebar): the room list
    // and decoration float over the map's right side.
    "&[data-sheets] > aside": {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      width: "min(340px, 85%)",
      zIndex: 4,
      boxShadow: "-6px 0 24px rgba(0, 0, 0, 0.45)",
      animation: "spaceSheetIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
    },
    // A phone: the room list and decoration are sheets over the map.
    "&[data-compact] > aside": {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: "70%",
      zIndex: 4,
      borderRadius: "16px 16px 0 0",
      boxShadow: "0 -6px 24px rgba(0, 0, 0, 0.45)",
      paddingBottom: "max(var(--gap-md), env(safe-area-inset-bottom))",
      animation: "spaceSheetUp 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
    },
    "@media (prefers-reduced-motion: reduce)": {
      "& > aside": { animation: "none !important" },
    },
  },
});

/** Someone sharing a screen in the room list: louder than the other icons, like the map. */
const LivePill = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    padding: "0 6px 0 4px",
    borderRadius: "999px",
    fontSize: "0.78em",
    fontWeight: 600,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    background: "var(--md-sys-color-error)",
    color: "var(--md-sys-color-on-error)",
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
    // A phone: the icon alone, its colour says how the audio is.
    "&[data-compact]": { padding: "6px", flexShrink: 0 },
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
    "@media (pointer: coarse)": {
      minHeight: "40px",
      paddingInline: "8px 14px",
    },
  },
});

const Kbd = styled("kbd", {
  base: {
    // A touch screen has no E key: the chip alone says what it does.
    "@media (pointer: coarse)": { display: "none" },
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
    "@media (pointer: coarse)": { minHeight: "48px", justifyContent: "center" },
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
    "@media (pointer: coarse)": { width: "44px", height: "44px" },
  },
});

const PeekButton = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    "@media (pointer: coarse)": { width: "44px", height: "44px" },
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
