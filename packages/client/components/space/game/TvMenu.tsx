import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import {
  type RpgHeroView,
  type RpgLobbyView,
  DUNGEONS,
  dungeonOf,
  sharedMultiplier,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";

import { VocationPicker } from "./VocationPicker";
import { useModalKeys } from "./modalKeys";
import { duration, rpgLabels } from "./rpgUi";

/**
 * A TV com o jogo ligado (docs/espaco/jogo/ot, etapa O4): assistir (a Smart TV de sempre)
 * ou montar e entrar no grupo da dungeon. O servidor confere a presença na TV, a vocação, o
 * level mínimo e o tamanho do grupo.
 */
export default function TvMenu(props: {
  view: SpaceView;
  request: { instance: string; title: string };
  hero: RpgHeroView | null;
  lobby: RpgLobbyView | null;
  myId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let card: HTMLDivElement | undefined;
  let title: HTMLHeadingElement | undefined;
  const refocus = useModalKeys(
    () => card,
    () => title,
    () => props.onClose(),
  );
  const vocation = () => props.hero?.vocation ?? 0;
  const mine = () =>
    props.lobby?.members.some((m) => m.user_id === props.myId) ?? false;
  const leader = () => props.lobby?.leader === props.myId;

  let pending: { id: string; done: () => void } | null = null;
  const off = props.view.onGame((e: GameWireEvent) => {
    if (!pending || e.re !== pending.id) return;
    const p = pending;
    pending = null;
    setBusy(false);
    queueMicrotask(refocus);
    if (e.t === "error") {
      const d = e.d as { code?: string; reason?: string };
      setError(L.error(d.code ?? "internal", d.reason));
      return;
    }
    p.done();
  });
  onCleanup(off);

  function send(
    type: string,
    d: Record<string, unknown>,
    done: () => void = () => undefined,
  ) {
    if (busy()) return;
    setBusy(true);
    setError(null);
    pending = { id: props.view.gameSend(type, d), done };
  }

  // O grupo muda por fora (alguém entrou, saiu, começou): o botão focado pode ter sumido.
  createEffect(
    on([() => props.lobby, vocation], () => queueMicrotask(refocus), {
      defer: true,
    }),
  );

  const bonusPct = () => {
    const vocs = props.lobby?.members.map((m) => m.vocation) ?? [];
    return vocs.length > 1 ? Math.round((sharedMultiplier(vocs) - 1) * 100) : 0;
  };

  return (
    <Backdrop
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <Card
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpg-tv-title"
      >
        <h2 id="rpg-tv-title" tabIndex={-1} ref={title}>
          {props.request.title}
        </h2>
        <Row>
          <Button variant="tonal" onPress={() => props.view.watchTv()}>
            {t`Assistir na Smart TV`}
          </Button>
        </Row>
        <h3>{t`Dungeon em grupo`}</h3>
        <Show
          when={vocation() !== 0}
          fallback={
            <VocationPicker
              busy={busy()}
              onChoose={(v) => send("rpg.vocation", { vocation: v })}
            />
          }
        >
          <Show
            when={props.lobby}
            fallback={
              <>
                <Muted>{t`Monte o grupo aqui; quem quiser ir junto vem até esta TV e entra. Até 4 pessoas; o grupo fecha em 5 min se ninguém começar.`}</Muted>
                <For each={DUNGEONS}>
                  {(d) => {
                    const tooLow = () => (props.hero?.level ?? 0) < d.minLevel;
                    return (
                      <Item>
                        <span>
                          <strong>{d.name}</strong>{" "}
                          <Muted>{t`level ${d.minLevel}+ · confortável a partir do ${d.recommendedLevel}`}</Muted>
                        </span>
                        <Muted>{d.blurb}</Muted>
                        <Button
                          size="xs"
                          variant={tooLow() ? "tonal" : "filled"}
                          isDisabled={busy() || tooLow()}
                          onPress={() =>
                            send("rpg.lobby.create", {
                              tv: props.request.instance,
                              dungeon: d.id,
                            })
                          }
                        >
                          {t`Montar grupo`}
                        </Button>
                      </Item>
                    );
                  }}
                </For>
              </>
            }
          >
            {(lobby) => (
              <>
                <p>
                  <strong>
                    {dungeonOf(lobby().dungeon)?.name ?? lobby().dungeon}
                  </strong>{" "}
                  <Muted>
                    {t`${lobby().members.length}/${lobby().max} · fecha em ${duration(Math.max(0, lobby().expires_at - Date.now()))}`}
                  </Muted>
                </p>
                <Members>
                  <For each={lobby().members}>
                    {(m) => (
                      <li>
                        {m.name}
                        {m.user_id === lobby().leader
                          ? ` ${t`(líder)`}`
                          : ""}{" "}
                        <Muted>{t`${L.vocation[m.vocation as 1 | 2 | 3 | 4]?.name ?? ""} · Nv ${m.level}`}</Muted>
                      </li>
                    )}
                  </For>
                </Members>
                <Show when={bonusPct() > 0}>
                  <Muted>{t`Bônus de experiência do grupo: +${bonusPct()}% (cresce com vocações diferentes).`}</Muted>
                </Show>
                <Row>
                  <Show when={leader()}>
                    <Button
                      variant="filled"
                      isDisabled={busy()}
                      onPress={() => send("rpg.lobby.start", {}, props.onClose)}
                    >
                      {t`Começar`}
                    </Button>
                  </Show>
                  <Show
                    when={mine()}
                    fallback={
                      <Button
                        variant="filled"
                        isDisabled={
                          busy() || lobby().members.length >= lobby().max
                        }
                        onPress={() =>
                          send("rpg.lobby.join", { tv: props.request.instance })
                        }
                      >
                        {t`Entrar no grupo`}
                      </Button>
                    }
                  >
                    <Button
                      variant="text"
                      isDisabled={busy()}
                      onPress={() => send("rpg.lobby.leave", {})}
                    >
                      {leader() ? t`Cancelar grupo` : t`Sair do grupo`}
                    </Button>
                  </Show>
                </Row>
              </>
            )}
          </Show>
        </Show>
        <Show when={error()}>
          {(msg) => <ErrorText role="alert">{msg()}</ErrorText>}
        </Show>
        <Row>
          <Button variant="text" onPress={props.onClose}>
            {t`Fechar`}
          </Button>
        </Row>
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
    maxWidth: "500px",
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
    "& h2": { margin: 0, fontSize: "1.15rem", outline: "none" },
    "& h3": { margin: 0, fontSize: "1rem" },
    "& p": { margin: 0, lineHeight: 1.5 },
  },
});

const Item = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    columnGap: "8px",
    rowGap: "2px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "& > button": { gridRow: "1 / 3", gridColumn: 2 },
  },
});

const Members = styled("ul", {
  base: {
    margin: 0,
    paddingInlineStart: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const ErrorText = styled("p", {
  base: { color: "var(--md-sys-color-error)" },
});
