import {
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type PlayerState,
  type RoomTv,
  type SpaceView,
  TvSync,
  YouTubePlayer,
} from "@muchat/space-client";
import { styled } from "styled-system/jsx";

import { IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

const VOLUME_KEY = "muchat.tv.volume";

function storedVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) &&
      v >= 0 &&
      v <= 100 &&
      localStorage.getItem(VOLUME_KEY) !== null
      ? v
      : 60;
  } catch {
    return 60;
  }
}

function storeVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    // Not remembered in a private window; the slider still works.
  }
}

function clock(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * The room's Smart TV on the media stage (ADR 0008). The video plays in this
 * browser (YouTube's official IFrame Player API, its own controls hidden);
 * play, pause and seek are the room's, shared through the space server;
 * volume is this person's alone. Nothing goes through the voice call.
 */
export function SmartTv(props: {
  view: SpaceView;
  tv: RoomTv;
  error: { code: string; retryAfterMs?: number; at: number } | null;
}) {
  const { t } = useLingui();
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal<string | null>(null);
  const [playerError, setPlayerError] = createSignal<number | null>(null);
  const [playerState, setPlayerState] = createSignal<PlayerState>("unstarted");
  const [needsGesture, setNeedsGesture] = createSignal(false);
  const [volume, setVolume] = createSignal(storedVolume());
  const [pos, setPos] = createSignal(0);
  const [dur, setDur] = createSignal(0);
  const [title, setTitle] = createSignal("");
  const [input, setInput] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [scrub, setScrub] = createSignal<number | null>(null);
  let host: HTMLDivElement | undefined;
  let player: YouTubePlayer | null = null;
  let sync: TvSync | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const me = () => props.view.world.me?.userId ?? "";
  const state = () => props.tv.state;
  const you = () => props.tv.you;
  const canStop = () =>
    !!state() &&
    (you().manage || (you().control && state()!.started_by === me()));

  onMount(async () => {
    props.view.probeClock();
    if (!host) return;
    try {
      const p = await YouTubePlayer.create(host, {
        onReady: () => setReady(true),
        onState: (s) => {
          setPlayerState(s);
          sync?.playerState(s);
          if (s === "playing") setPlayerError(null);
          // One report of the end is enough: whoever made the last change sends it.
          const st = state();
          if (
            s === "ended" &&
            st &&
            st.status === "playing" &&
            (st.by === me() || st.started_by === me())
          ) {
            props.view.tvEnded();
          }
        },
        onError: (code) => setPlayerError(code),
      });
      if (disposed) return p.destroy();
      player = p;
      p.setVolume(volume());
      sync = new TvSync(
        p,
        () => props.view.serverNow(),
        () => setNeedsGesture(sync?.needsGesture ?? false),
      );
      sync.apply(state());
      timer = setInterval(() => {
        if (!sync || !player) return;
        setPos(sync.position());
        setDur(player.duration());
        setTitle(player.title());
      }, 500);
    } catch (err) {
      console.error("[tv] player could not load", err);
      setFailed(
        t`Não foi possível carregar o player do YouTube neste aparelho (bloqueado ou sem conexão).`,
      );
    }
  });

  // Every new state of the room's TV: follow it.
  createEffect(
    on(
      () => state(),
      (s) => {
        setPlayerError(null);
        sync?.apply(s);
        if (s) setPos(sync?.position() ?? s.pos_s);
      },
      { defer: true },
    ),
  );

  // A refusal from the server, in words.
  createEffect(
    on(
      () => props.error,
      (e) => {
        if (!e) return;
        const minutes = Math.max(1, Math.ceil((e.retryAfterMs ?? 0) / 60_000));
        const text: Record<string, string> = {
          stale_rev: t`Outra pessoa mexeu na TV ao mesmo tempo; a TV mostra o que ficou valendo.`,
          tv_cooldown: t`Esta sala tem um intervalo entre vídeos: tente de novo em ${minutes} min.`,
          not_allowed: t`Você não tem permissão para controlar a TV desta sala.`,
          no_tv: t`Esta sala não tem uma TV.`,
          rate_limited: t`Muitas trocas de vídeo seguidas; espere um pouco.`,
          invalid_message: t`Esse link não é de um vídeo do YouTube.`,
        };
        setNotice(text[e.code] ?? t`A TV não aceitou o comando.`);
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    disposed = true;
    if (timer) clearInterval(timer);
    sync?.destroy();
    player?.destroy();
  });

  function load() {
    const res = props.view.tvLoad(input());
    if (res === "invalid")
      return setNotice(
        t`Cole um link do YouTube (youtube.com/watch, youtu.be, shorts) ou o ID do vídeo.`,
      );
    setNotice("");
    setInput("");
  }

  const playing = () => state()?.status === "playing";
  const togglePlay = () => {
    if (!state()) return;
    if (playing()) props.view.tvPause(player?.time() ?? pos());
    else props.view.tvPlay(state()!.status === "ended" ? 0 : pos());
  };
  const jump = (delta: number) => props.view.tvSeek(Math.max(0, pos() + delta));

  const errorText = () => {
    switch (playerError()) {
      case null:
        return null;
      case 100:
        return t`Vídeo indisponível: foi removido ou é privado.`;
      case 101:
      case 150:
        // YouTube answers 150 both for "embedding disabled by the owner" and
        // for ids of no video (measured 16/11/2026): say both.
        return t`Este vídeo não pode ser assistido aqui: o dono não permite fora do YouTube, ou ele não existe mais.`;
      case 2:
        return t`Link de vídeo inválido.`;
      case 5:
        return t`O navegador não conseguiu tocar este vídeo.`;
      case 153:
        return t`O YouTube recusou o player (configuração de origem).`;
      default:
        return t`O YouTube não conseguiu tocar este vídeo (erro ${playerError()}).`;
    }
  };

  const loading = () =>
    !!state() &&
    playing() &&
    ready() &&
    !playerError() &&
    (playerState() === "buffering" || playerState() === "unstarted");

  return (
    <Tv aria-label={t`Smart TV da sala`}>
      <Screen>
        {/* YouTube's iframe lives here; Solid never renders into this element. */}
        <div ref={host} class="tv-host" />
        <Show when={!state() && !failed()}>
          <Overlay>
            <Symbol size={40}>tv_off</Symbol>
            <p>
              {you().watch
                ? t`A TV está desligada.`
                : t`Você não tem permissão para assistir à TV desta sala.`}
            </p>
            <Show when={you().watch && !you().control}>
              <small>{t`Quem pode controlar a TV escolhe um vídeo.`}</small>
            </Show>
          </Overlay>
        </Show>
        <Show when={failed()}>
          {(msg) => (
            <Overlay>
              <Symbol size={40}>error</Symbol>
              <p>{msg()}</p>
            </Overlay>
          )}
        </Show>
        <Show when={errorText()}>
          {(msg) => (
            <Overlay data-error="">
              <Symbol size={40}>block</Symbol>
              <p>{msg()}</p>
            </Overlay>
          )}
        </Show>
        <Show when={loading()}>
          <Badge>{t`Carregando…`}</Badge>
        </Show>
        <Show when={needsGesture() && !errorText()}>
          <Overlay>
            <GestureButton type="button" onClick={() => sync?.resume()}>
              <Symbol size={28}>play_circle</Symbol>
              {t`Clique para assistir com som`}
            </GestureButton>
            <small>{t`O navegador só toca vídeo com som depois de um clique.`}</small>
          </Overlay>
        </Show>
      </Screen>

      <Info>
        <Show
          when={state()}
          fallback={<strong>{t`Smart TV · YouTube`}</strong>}
        >
          {(s) => (
            <>
              <strong class="title">{title() || t`Vídeo do YouTube`}</strong>
              <small>
                {s().by_name
                  ? t`Controlado por ${s().by_name}`
                  : t`Sala vazia: a TV pausou`}
                {" · "}
                {s().status === "ended"
                  ? t`terminou`
                  : s().status === "paused"
                    ? t`pausado`
                    : t`tocando`}
              </small>
            </>
          )}
        </Show>
      </Info>

      <Show when={state()}>
        <Controls>
          <IconButton
            size="sm"
            variant="tonal"
            isDisabled={!you().control}
            onPress={() => jump(-10)}
            aria-label={t`Voltar 10 segundos`}
          >
            <Symbol>replay_10</Symbol>
          </IconButton>
          <IconButton
            size="sm"
            variant="filled"
            isDisabled={!you().control}
            onPress={togglePlay}
            aria-label={playing() ? t`Pausar para todos` : t`Tocar para todos`}
          >
            <Symbol>{playing() ? "pause" : "play_arrow"}</Symbol>
          </IconButton>
          <IconButton
            size="sm"
            variant="tonal"
            isDisabled={!you().control}
            onPress={() => jump(10)}
            aria-label={t`Avançar 10 segundos`}
          >
            <Symbol>forward_10</Symbol>
          </IconButton>
          <Time>{clock(scrub() ?? pos())}</Time>
          <Range
            type="range"
            min={0}
            max={Math.max(1, Math.floor(dur()))}
            step={1}
            value={Math.floor(scrub() ?? pos())}
            disabled={!you().control || dur() <= 0}
            aria-label={t`Posição do vídeo`}
            onInput={(e) => setScrub(Number(e.currentTarget.value))}
            onChange={(e) => {
              // Sent once, on release: dragging never floods the room.
              const v = Number(e.currentTarget.value);
              setScrub(null);
              props.view.tvSeek(v);
            }}
          />
          <Time>{clock(dur())}</Time>
          <Symbol size={18} aria-hidden="true">
            {volume() === 0 ? "volume_off" : "volume_up"}
          </Symbol>
          <Range
            data-volume=""
            type="range"
            min={0}
            max={100}
            value={volume()}
            aria-label={t`Seu volume da TV (só para você)`}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              setVolume(v);
              player?.setVolume(v);
              storeVolume(v);
            }}
          />
          <Show when={canStop()}>
            <IconButton
              size="sm"
              variant="tonal"
              onPress={() => props.view.tvStop()}
              aria-label={t`Desligar a TV`}
            >
              <Symbol>power_settings_new</Symbol>
            </IconButton>
          </Show>
        </Controls>
      </Show>

      <Show when={you().control}>
        <Chooser
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            type="text"
            inputmode="url"
            placeholder={t`Cole um link do YouTube ou o ID do vídeo`}
            aria-label={t`Link ou ID do vídeo do YouTube`}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" disabled={!input().trim()}>
            {state() ? t`Trocar vídeo` : t`Ligar a TV`}
          </button>
        </Chooser>
        <Show when={props.tv.cooldownS > 0}>
          <small class="hint">
            {t`Um vídeo por vez; intervalo de ${Math.round(props.tv.cooldownS / 60)} min entre vídeos nesta sala.`}
          </small>
        </Show>
      </Show>
      <Show when={notice()}>
        <Notice role="status">{notice()}</Notice>
      </Show>
    </Tv>
  );
}

const Tv = styled("div", {
  base: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "0 var(--gap-md) var(--gap-md)",
    "& small": { color: "var(--md-sys-color-on-surface-variant)" },
    "& .hint": { fontSize: "0.8em" },
  },
});

const Screen = styled("div", {
  base: {
    position: "relative",
    flex: 1,
    minHeight: "180px",
    borderRadius: "14px",
    overflow: "hidden",
    background: "#050507",
    // A TV: dark bezel, a soft glow when something plays.
    boxShadow: "inset 0 0 0 6px #1b1c22, 0 6px 20px rgba(0,0,0,0.35)",
    "& .tv-host": { position: "absolute", inset: "6px" },
    "& .tv-host iframe": {
      width: "100%",
      height: "100%",
      border: 0,
      borderRadius: "8px",
    },
  },
});

const Overlay = styled("div", {
  base: {
    position: "absolute",
    inset: "6px",
    display: "grid",
    placeItems: "center",
    alignContent: "center",
    gap: "6px",
    padding: "var(--gap-lg)",
    textAlign: "center",
    color: "#e8e8ef",
    background: "rgba(5,5,7,0.82)",
    borderRadius: "8px",
    "&[data-error]": { background: "rgba(40,10,14,0.9)" },
    "& small": { color: "#b9bac8 !important" },
  },
});

const Badge = styled("span", {
  base: {
    position: "absolute",
    top: "14px",
    left: "14px",
    padding: "2px 10px",
    borderRadius: "999px",
    background: "rgba(0,0,0,0.7)",
    color: "#fff",
    fontSize: "0.8em",
  },
});

const GestureButton = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 18px",
    borderRadius: "999px",
    border: "none",
    background: "var(--md-sys-color-primary)",
    color: "var(--md-sys-color-on-primary)",
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
  },
});

const Info = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    "& .title": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
  },
});

const Controls = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
});

const Time = styled("span", {
  base: {
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.8em",
    minWidth: "38px",
    textAlign: "center",
  },
});

const Range = styled("input", {
  base: {
    flex: 1,
    minWidth: "80px",
    accentColor: "var(--md-sys-color-primary)",
    "&[data-volume]": { flex: "0 1 90px", minWidth: "60px" },
  },
});

const Chooser = styled("form", {
  base: {
    display: "flex",
    gap: "6px",
    "& input": {
      flex: 1,
      minWidth: 0,
      padding: "8px 10px",
      borderRadius: "10px",
      border: "1px solid var(--md-sys-color-outline-variant)",
      background: "var(--md-sys-color-surface-container-high)",
      color: "inherit",
      font: "inherit",
    },
    "& button": {
      padding: "8px 14px",
      borderRadius: "10px",
      border: "none",
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
      font: "inherit",
      fontWeight: 600,
      cursor: "pointer",
      "&:disabled": { opacity: 0.5, cursor: "default" },
    },
  },
});

const Notice = styled("p", {
  base: {
    margin: 0,
    fontSize: "0.85em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
