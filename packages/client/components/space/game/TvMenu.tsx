import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type {
  GameWireEvent,
  SpaceUiState,
  SpaceView,
} from "@muchat/space-client";
import {
  type RpgHeroView,
  type RpgLobbyView,
  DUNGEONS,
  VOCATIONS,
  canShare,
  dungeonOf,
  minShareLevel,
  missingAmmo,
  sharedMultiplier,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { gameFrame } from "./gameTheme";
import { useModalKeys } from "./modalKeys";
import {
  dungeonChoices,
  loopSeconds,
  loopStopText,
  partyState,
} from "./partyUi";
import { duration, rpgLabels, vocationName } from "./rpgUi";
import { VocationPicker } from "./VocationPicker";

/**
 * A TV com o jogo ligado (docs/espaco/jogo/ot): a tela inicial de uma Smart TV com os apps
 * (pedido do dono, 23/11/2026). Music é a Smart TV de sempre (o vídeo da sala, ADR 0008);
 * Idle Hunt é a dungeon (etapa O4): montar e entrar no grupo. O servidor confere a presença
 * na TV, a vocação, o level mínimo e o tamanho do grupo.
 */
export default function TvMenu(props: {
  view: SpaceView;
  request: { instance: string; title: string };
  hero: RpgHeroView | null;
  /** Os grupos desta TV (uma TV tem vários desde 24/11/2026). */
  lobbies: RpgLobbyView[];
  /** O meu grupo, nesta TV ou em outra. */
  mine: RpgLobbyView | null;
  /** O quadro do Espaço: grupos se formando e partidas rodando (o menu pede de 5 em 5 s). */
  board: SpaceUiState["board"];
  /** O nome de uma sala pelo id (a lista de salas do app); null se a pessoa não a vê. */
  roomTitle: (roomId: string) => string | null;
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
  const mine = () => !!props.mine;
  const leader = () => props.mine?.leader === props.myId;
  // Os grupos desta TV em que dá para entrar (os outros; o meu aparece inteiro).
  const joinable = () =>
    props.lobbies.filter((l) => l.id !== props.mine?.id);
  // A tela inicial com os apps; o Idle Hunt abre o menu da dungeon.
  const [app, setApp] = createSignal<"home" | "idle">("home");
  const openIdle = () => {
    setApp("idle");
    queueMicrotask(refocus);
  };
  // Enquanto o menu está aberto, o quadro (grupos e partidas do Espaço) se atualiza.
  props.view.requestBoard();
  const boardTimer = setInterval(() => props.view.requestBoard(), 5000);
  onCleanup(() => clearInterval(boardTimer));
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(clock));
  const runs = () => props.board?.runs ?? [];
  const otherLobbies = () =>
    (props.board?.lobbies ?? []).filter((l) => l.tv !== props.request.instance);
  const where = (roomId: string) => props.roomTitle(roomId) ?? t`outra sala`;
  const names = (members: { name: string }[]) =>
    members.map((m) => m.name).join(", ");
  // Arco ou besta sem a munição dele: na dungeon o herói luta com os punhos.
  const ammoGap = () => {
    const h = props.hero;
    if (!h || h.vocation === 0) return null;
    return missingAmmo(h.inventory, VOCATIONS[h.vocation].base, h.level);
  };
  const clockOf = (startedAt: number, endsAt: number) => {
    const total = Math.max(1, Math.round((endsAt - startedAt) / 1000));
    const now = Math.min(
      total,
      Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    );
    const f = (s: number) =>
      `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    return `${f(now)} / ${f(total)}`;
  };
  // Assistir: a partida desta sala já chega sozinha; a de outra sala, o servidor passa a mandar.
  const watch = (id: string) => {
    if (props.view.knowsRun(id)) return props.view.watchRun(id);
    send("rpg.run.watch", { id }, () => props.view.watchRun(id));
  };
  // Confortável = vence 70% ou mais (medido no simulador, dungeons.ts): com o grupo completo (as
  // quatro classes, 24/11/2026) e sozinho com a vocação de quem olha.
  const comfortLine = (d: (typeof DUNGEONS)[number]) => {
    const group = d.comfort.group;
    const inGroup =
      group <= d.minLevel
        ? t`Com o grupo completo (as 4 classes), confortável desde a entrada.`
        : t`Com o grupo completo (as 4 classes), confortável a partir do level ${group}.`;
    const voc = props.hero?.vocation ?? 0;
    if (voc === 0) return inGroup;
    const base = VOCATIONS[voc].base as 1 | 2 | 3 | 4;
    const solo = d.comfort.solo[base];
    const name = vocationName(base);
    const alone =
      solo === null
        ? t`Sozinho como ${name}, não dá.`
        : solo <= d.minLevel
          ? t`Sozinho como ${name}, desde a entrada.`
          : t`Sozinho como ${name}, a partir do ${solo}.`;
    return `${inGroup} ${alone}`;
  };
  const idleStatus = () => {
    const n = runs().length;
    if (n === 1) return t`1 partida rolando`;
    if (n > 1) return t`${n} partidas rolando`;
    const l = props.mine ?? props.lobbies[0];
    if (l) return t`Grupo se formando · ${l.members.length}/${l.max}`;
    return t`Dungeons em grupo`;
  };

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
  // Em memos: as props leem o estado inteiro, que muda a cada atualização.
  const lobbyNow = createMemo(() => props.mine);
  const vocationNow = createMemo(vocation);
  createEffect(
    on([lobbyNow, vocationNow], () => queueMicrotask(refocus), {
      defer: true,
    }),
  );

  const bonusPct = () => {
    const vocs = props.mine?.members.map((m) => m.vocation) ?? [];
    return vocs.length > 1 ? Math.round((sharedMultiplier(vocs) - 1) * 100) : 0;
  };
  // A divisão [TFS party.cpp]: todos com pelo menos 2/3 do maior level. Sem ela, cada um leva
  // pelo dano que causa (24/11/2026: o grupo de levels 24 e 14 não dividia e ninguém sabia).
  const levels = () => props.mine?.members.map((m) => m.level) ?? [];
  const shares = () => levels().length < 2 || canShare(levels());
  const shareMin = () => minShareLevel(Math.max(0, ...levels()));

  return (
    <Backdrop
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <Card
        style={gameFrame}
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpg-tv-title"
      >
        <Head>
          <Show when={app() === "idle"}>
            <Back
              type="button"
              aria-label={t`Voltar aos apps`}
              onClick={() => {
                setApp("home");
                queueMicrotask(refocus);
              }}
            >
              <Symbol size={20}>arrow_back</Symbol>
            </Back>
          </Show>
          <h2 id="rpg-tv-title" tabIndex={-1} ref={title}>
            {app() === "idle" ? t`Idle Hunt` : props.request.title}
          </h2>
        </Head>
        <Show when={app() === "home"}>
          <Apps role="list" aria-label={t`Apps da TV`}>
            <AppTile
              type="button"
              role="listitem"
              data-app="music"
              onClick={() => props.view.watchTv()}
            >
              <Symbol size={36}>music_note</Symbol>
              <strong>{t`Music`}</strong>
              <Muted>{t`O vídeo ou a música da sala, para todos`}</Muted>
            </AppTile>
            <AppTile
              type="button"
              role="listitem"
              data-app="idle"
              onClick={openIdle}
            >
              <Symbol size={36}>swords</Symbol>
              <strong>{t`Idle Hunt`}</strong>
              <Muted>{idleStatus()}</Muted>
            </AppTile>
          </Apps>
        </Show>
        <Show when={app() === "idle"}>
          <Show when={ammoGap()}>
            {(type) => (
              <ErrorText role="alert">
                {type() === "virote"
                  ? t`Sua arma atira virotes e você não tem nenhum: na dungeon o herói luta com os punhos.`
                  : t`Sua arma atira flechas e você não tem nenhuma: na dungeon o herói luta com os punhos.`}
              </ErrorText>
            )}
          </Show>
          <Show when={runs().length > 0}>
            <h3>{t`Partidas rolando`}</h3>
            <For each={runs()}>
              {(r) => (
                <Item data-run={r.id}>
                  <span>
                    <strong>{dungeonOf(r.dungeon)?.name ?? r.dungeon}</strong>{" "}
                    <Muted>{where(r.room)}</Muted>{" "}
                    <Muted>{clockOf(r.started_at, r.ends_at)}</Muted>
                  </span>
                  <Muted>{names(r.members)}</Muted>
                  <Button
                    size="xs"
                    variant="filled"
                    isDisabled={busy()}
                    onPress={() => watch(r.id)}
                  >
                    {t`Assistir`}
                  </Button>
                </Item>
              )}
            </For>
          </Show>
          <Show when={otherLobbies().length > 0}>
            <h3>{t`Grupos em outras TVs`}</h3>
            <For each={otherLobbies()}>
              {(l) => (
                <Item data-lobby={l.tv}>
                  <span>
                    <strong>{dungeonOf(l.dungeon)?.name ?? l.dungeon}</strong>{" "}
                    <Muted>{`${l.members.length}/${l.max}`}</Muted>
                  </span>
                  <Muted>{names(l.members)}</Muted>
                  <Muted>{t`Para entrar, vá até a TV de ${where(l.room)}.`}</Muted>
                </Item>
              )}
            </For>
          </Show>
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
              when={props.mine}
              fallback={
                <>
                  {/* Os grupos desta TV: entrar num deles, ou montar o seu logo abaixo. */}
                  <Show when={joinable().length > 0}>
                    <For each={joinable()}>
                      {(l) => {
                        const full = () => l.members.length >= l.max;
                        const low = () =>
                          (props.hero?.level ?? 0) <
                          (dungeonOf(l.dungeon)?.minLevel ?? 0);
                        return (
                          <Item data-lobby={l.id}>
                            <span>
                              <strong>{dungeonOf(l.dungeon)?.name ?? l.dungeon}</strong>{" "}
                              <Badge data-state={l.state ?? "forming"}>
                                {partyState(l, now())}
                              </Badge>{" "}
                              <Muted>{`${l.members.length}/${l.max}`}</Muted>
                            </span>
                            <Muted>{names(l.members)}</Muted>
                            <Show when={l.state === "running"}>
                              <Muted>{t`Quem entra agora vai na próxima corrida.`}</Muted>
                            </Show>
                            <Button
                              size="xs"
                              variant="filled"
                              isDisabled={busy() || full() || low()}
                              onPress={() =>
                                send("rpg.lobby.join", {
                                  tv: props.request.instance,
                                  id: l.id,
                                })
                              }
                            >
                              {full()
                                ? t`Cheio`
                                : low()
                                  ? t`Level baixo`
                                  : t`Entrar no grupo`}
                            </Button>
                          </Item>
                        );
                      }}
                    </For>
                  </Show>
                  <Muted>{t`Monte o grupo aqui; quem quiser ir junto vem até esta TV e entra. Até 4 pessoas. Depois da corrida o grupo continua montado: o líder começa a próxima quando quiser, ou liga o Repetir.`}</Muted>
                  <For each={DUNGEONS}>
                    {(d) => {
                      const tooLow = () =>
                        (props.hero?.level ?? 0) < d.minLevel;
                      return (
                        <Item>
                          <span>
                            <strong>{d.name}</strong>{" "}
                            <Muted>{t`level ${d.minLevel}+`}</Muted>
                          </span>
                          <Muted>{d.blurb}</Muted>
                          <Muted data-comfort="">{comfortLine(d)}</Muted>
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
              {(lobby) => {
                const st = () => lobby().state ?? "forming";
                const counting = () => loopSeconds(lobby(), now()) !== null;
                const expiry = () => {
                  const l = lobby();
                  if (st() === "running" || counting()) return "";
                  const left = duration(Math.max(0, l.expires_at - now()));
                  return st() === "forming"
                    ? t`O grupo fecha em ${left} se ninguém começar.`
                    : t`O grupo continua montado; desfaz sozinho em ${left} sem nenhuma corrida.`;
                };
                const watchRun = () => {
                  const id = lobby().run_id;
                  if (id) watch(id);
                };
                return (
                  <>
                    <PartyHead>
                      <strong>
                        {dungeonOf(lobby().dungeon)?.name ?? lobby().dungeon}
                      </strong>
                      <Badge data-state={st()}>
                        {partyState(lobby(), now())}
                      </Badge>
                      <Show when={lobby().loop}>
                        <Badge data-loop="">
                          <Symbol size={14}>repeat_on</Symbol> {t`Repetir`}
                        </Badge>
                      </Show>
                      <Muted>
                        {t`${lobby().members.length}/${lobby().max}`}
                        <Show when={(lobby().runs ?? 0) > 0}>
                          {` · ${t`${lobby().runs ?? 0} corridas juntos`}`}
                        </Show>
                      </Muted>
                    </PartyHead>
                    <Members>
                      <For each={lobby().members}>
                        {(m) => (
                          <li>
                            {m.name}
                            {m.user_id === lobby().leader
                              ? ` ${t`(líder)`}`
                              : ""}{" "}
                            <Muted>{t`${vocationName(m.vocation)} · Nv ${m.level}`}</Muted>
                            <Show when={!shares() && m.level < shareMin()}>
                              <Warn>{t` · abaixo do nível ${shareMin()}`}</Warn>
                            </Show>
                          </li>
                        )}
                      </For>
                    </Members>
                    <Show
                      when={shares()}
                      fallback={
                        <ShareNote role="note">
                          {t`A experiência não vai ser dividida: para dividir, todos precisam de nível ${shareMin()} ou mais (2/3 do maior). Assim, cada um leva a experiência pelo dano que causa.`}
                        </ShareNote>
                      }
                    >
                      <Show when={bonusPct() > 0}>
                        <Muted>{t`Experiência dividida igualmente, com bônus do grupo de +${bonusPct()}% (cresce com vocações diferentes).`}</Muted>
                      </Show>
                    </Show>
                    <Show when={loopStopText(lobby())}>
                      {(msg) => <ShareNote role="status">{msg()}</ShareNote>}
                    </Show>
                    {/* O líder entre as corridas: a dungeon e o Repetir. */}
                    <Show when={leader() && st() !== "running"}>
                      <Field>
                        <label for="rpg-party-dungeon">{t`Dungeon`}</label>
                        <select
                          id="rpg-party-dungeon"
                          value={lobby().dungeon}
                          disabled={busy()}
                          onChange={(e) =>
                            send("rpg.lobby.dungeon", {
                              dungeon: e.currentTarget.value,
                            })
                          }
                        >
                          <For each={dungeonChoices(lobby().members)}>
                            {(c) => (
                              <option
                                value={c.d.id}
                                disabled={c.below.length > 0}
                              >
                                {c.below.length > 0
                                  ? t`${c.d.name} (level ${c.d.minLevel}+) · falta level: ${c.below.map((m) => m.name).join(", ")}`
                                  : t`${c.d.name} (level ${c.d.minLevel}+)`}
                              </option>
                            )}
                          </For>
                        </select>
                      </Field>
                      <Toggle>
                        <input
                          id="rpg-party-loop"
                          type="checkbox"
                          role="switch"
                          checked={!!lobby().loop}
                          disabled={busy()}
                          onChange={(e) =>
                            send("rpg.lobby.loop", {
                              on: e.currentTarget.checked,
                            })
                          }
                        />
                        <span>
                          <label for="rpg-party-loop">
                            <strong>{t`Repetir sem parar`}</strong>
                          </label>
                          <Muted>{t`Depois de cada vitória, a próxima começa sozinha em 12 s, com o mesmo grupo. Para em derrota, em retirada, se alguém não puder entrar ou se ninguém do grupo estiver conectado.`}</Muted>
                        </span>
                      </Toggle>
                    </Show>
                    <Row>
                      <Show when={st() === "running"}>
                        <Button
                          variant="filled"
                          isDisabled={busy() || !lobby().run_id}
                          onPress={watchRun}
                        >
                          {t`Assistir a corrida`}
                        </Button>
                      </Show>
                      <Show when={leader() && st() !== "running"}>
                        <Button
                          variant="filled"
                          isDisabled={busy()}
                          onPress={() =>
                            send("rpg.lobby.start", {}, props.onClose)
                          }
                        >
                          {counting()
                            ? t`Começar agora`
                            : (lobby().runs ?? 0) > 0
                              ? t`Começar de novo`
                              : t`Começar`}
                        </Button>
                        <Show when={counting()}>
                          <Button
                            variant="tonal"
                            isDisabled={busy()}
                            onPress={() =>
                              send("rpg.lobby.loop", { on: false })
                            }
                          >
                            {t`Parar o Repetir`}
                          </Button>
                        </Show>
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
                              send("rpg.lobby.join", {
                                tv: props.request.instance,
                              })
                            }
                          >
                            {t`Entrar no grupo`}
                          </Button>
                        }
                      >
                        <Show when={leader()}>
                          <Button
                            variant="text"
                            isDisabled={busy()}
                            onPress={() =>
                              send("rpg.lobby.leave", { disband: true })
                            }
                          >
                            {t`Desfazer grupo`}
                          </Button>
                        </Show>
                        <Show when={!leader() || lobby().members.length > 1}>
                          <Button
                            variant="text"
                            isDisabled={busy()}
                            onPress={() => send("rpg.lobby.leave", {})}
                          >
                            {leader()
                              ? t`Sair (passar a liderança)`
                              : t`Sair do grupo`}
                          </Button>
                        </Show>
                      </Show>
                    </Row>
                    <Show when={expiry()}>
                      <Muted>{expiry()}</Muted>
                    </Show>
                  </>
                );
              }}
            </Show>
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

const PartyHead = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    fontVariantNumeric: "tabular-nums",
  },
});

const Badge = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "1px 8px",
    borderRadius: "999px",
    fontSize: "0.8em",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface)",
    "&[data-state=running]": {
      background: "var(--md-sys-color-tertiary-container)",
      color: "var(--md-sys-color-on-tertiary-container)",
    },
    "&[data-state=ready]": {
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    "&[data-loop]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
  },
});

const Field = styled("div", {
  base: {
    display: "grid",
    gap: "4px",
    "& select": {
      padding: "8px 10px",
      borderRadius: "8px",
      border: "1px solid var(--md-sys-color-outline)",
      background: "var(--md-sys-color-surface-container)",
      color: "var(--md-sys-color-on-surface)",
      fontSize: "inherit",
      // A finger needs room.
      minHeight: "40px",
    },
    "& select:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

const Toggle = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "10px",
    alignItems: "start",
    "& input": {
      width: "20px",
      height: "20px",
      marginTop: "2px",
      accentColor: "var(--md-sys-color-primary)",
      cursor: "pointer",
    },
    "& span": { display: "grid", gap: "2px" },
    "& label": { cursor: "pointer" },
  },
});

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

const Warn = styled("span", {
  base: { color: "var(--md-sys-color-error)", fontSize: "0.85em" },
});

const ShareNote = styled("p", {
  base: {
    margin: 0,
    padding: "6px 10px",
    borderRadius: "10px",
    background: "rgba(255, 138, 122, 0.12)",
    boxShadow: "inset 0 0 0 1px rgba(255, 138, 122, 0.35)",
    fontSize: "0.88em",
  },
});

const Card = styled("div", {
  base: {
    // Lays itself out by its own width (container queries), not the window's.
    containerType: "inline-size",
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

const Head = styled("div", {
  base: { display: "flex", alignItems: "center", gap: "8px" },
});

const Back = styled("button", {
  base: {
    "@media (pointer: coarse)": { minWidth: "44px", minHeight: "44px" },
    display: "grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    border: "none",
    borderRadius: "999px",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    cursor: "pointer",
  },
});

/** A tela inicial: os apps em ladrilhos grandes, como numa Smart TV. */
const Apps = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "linear-gradient(160deg, #1b1d2a, #11121a)",
  },
});

const AppTile = styled("button", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    minHeight: "120px",
    padding: "14px",
    border: "2px solid transparent",
    borderRadius: "12px",
    color: "#f4f5fa",
    cursor: "pointer",
    textAlign: "start",
    transition: "transform 120ms ease, border-color 120ms ease",
    "& > span": { color: "rgba(244, 245, 250, 0.75)" },
    '&[data-app="music"]': {
      background: "linear-gradient(135deg, #8a2be2, #ff4f8b)",
    },
    '&[data-app="idle"]': {
      background: "linear-gradient(135deg, #2c6e49, #c9a227)",
    },
    "&:hover, &:focus-visible": {
      borderColor: "#ffffff",
      transform: "scale(1.03)",
      outline: "none",
    },
    "@media (prefers-reduced-motion: reduce)": {
      transition: "none",
      "&:hover, &:focus-visible": { transform: "none" },
    },
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
    // A narrow menu (a phone): the text takes the whole row, the button goes under it.
    "@container (max-width: 400px)": {
      gridTemplateColumns: "1fr",
      "& > button": { gridRow: "auto", gridColumn: 1, justifySelf: "end" },
    },
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
