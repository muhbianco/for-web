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
import type { RunState } from "@muchat/space-client";
import {
  type RpgGainDungeonView,
  type RpgStatsEvent,
  balance as B,
  gainPerHour,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { type GameLink, Tabs, useCommands } from "./gameUi";
import { gold, num, pct } from "./heroModel";
import { dungeonName } from "./partyUi";

type Days = 1 | 7;
type Stats = RpgStatsEvent["d"];

const levelFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
/** 11,6 (níveis por hora, quando passa de um). */
const levels = (x: number) => levelFmt.format(x);

/** "2 min 8 s" / "45 s". */
function clock(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m} min ${r} s` : `${r} s`;
}

/**
 * A aba "Ganho" do medidor (27/11/2026): quanto XP e ouro por hora o herói tirou de cada DG nas últimas
 * 24 h ou 7 dias, para o grupo escolher onde grindar. O servidor soma as corridas fechadas (`rpg.stats`)
 * com a largada entre uma e a próxima no tempo; aqui só divide e ordena. O XP vem como rende hoje: sem
 * a stamina, que saiu do jogo no mesmo dia.
 */
export default function GainTab(props: {
  link: GameLink;
  state: RunState;
  myId: string | null;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [days, setDays] = createSignal<Days>(1);
  const [data, setData] = createSignal<Stats | null>(null);
  const [open, setOpen] = createSignal<string | null>(null);

  let again = false;
  let alive = true;
  onCleanup(() => (alive = false));
  const load = async () => {
    if (!alive) return;
    if (cmd.busy()) {
      again = true;
      return;
    }
    const want = days();
    const r = await cmd.run("rpg.stats", { days: want });
    if (r?.ok) {
      const d = r.e.d as unknown as Stats;
      if (d.days === days()) setData(d);
    }
    if (again || want !== days()) {
      again = false;
      void load();
    }
  };
  // O estado da corrida muda a cada segundo: só a troca de corrida e o fim dela pedem de novo
  // (memos, para o `on` não disparar a cada quadro).
  const runId = createMemo(() => props.state.run.id);
  const ended = createMemo(() => props.state.end !== null);
  createEffect(on([days, runId, ended], () => void load()));

  const me = createMemo(() =>
    props.state.run.members.find((m) => m.user_id === props.myId),
  );
  const rows = createMemo(() => {
    const d = data();
    if (!d) return [];
    const list = d.dungeons.map((g) => ({
      g,
      xpH: gainPerHour(g.xp, g.cycle_s),
      goldH: gainPerHour(g.gold, g.cycle_s),
    }));
    const top = Math.max(1, ...list.map((r) => r.xpH));
    return list.map((r) => ({ ...r, frac: r.xpH / top }));
  });
  /** Quanto do nível de agora uma hora nessa DG enche. */
  const levelShare = (xpH: number) => {
    const lv = me()?.level;
    const need = lv ? B.xpToNext(lv) : 0;
    return need > 0 ? xpH / need : null;
  };
  const detail = (g: RpgGainDungeonView, xpH: number) => ({
    perRun: g.runs > 0 ? g.xp / g.runs : 0,
    goldPerRun: g.runs > 0 ? g.gold / g.runs : 0,
    jobH: gainPerHour(g.job_xp, g.cycle_s),
    level: levelShare(xpH),
  });

  return (
    <>
      <Tabs
        label={t`Período`}
        value={String(days()) as "1" | "7"}
        onChange={(v) => {
          setDays(v === "7" ? 7 : 1);
          setOpen(null);
        }}
        items={[
          { id: "1", label: t`24 h` },
          { id: "7", label: t`7 dias` },
        ]}
      />
      <Show
        when={data()}
        fallback={
          <Empty role="status">{cmd.error() ?? t`Somando as corridas…`}</Empty>
        }
      >
        {(d) => (
          <>
            <Show
              when={rows().length > 0}
              fallback={
                <Empty>
                  {d().days === 1
                    ? t`Nenhuma corrida fechada nas últimas 24 h.`
                    : t`Nenhuma corrida fechada nos últimos 7 dias.`}
                </Empty>
              }
            >
              <List role="list" aria-busy={cmd.busy()}>
                <For each={rows()}>
                  {(r) => (
                    <li>
                      <Row
                        type="button"
                        aria-expanded={open() === r.g.dungeon}
                        onClick={() =>
                          setOpen(open() === r.g.dungeon ? null : r.g.dungeon)
                        }
                      >
                        <Fill
                          style={{ width: `${Math.round(r.frac * 100)}%` }}
                        />
                        <span data-line="">
                          <span data-name="">{dungeonName(r.g.dungeon)}</span>
                          <span data-num="">
                            {gold(r.xpH)} <small>{t`XP/h`}</small>
                          </span>
                        </span>
                        <span data-line="" data-sub="">
                          <span>
                            {t`${r.g.runs} corridas`} ·{" "}
                            {pct(r.g.wins / Math.max(1, r.g.runs))} ·{" "}
                            {clock(r.g.run_s / Math.max(1, r.g.runs))}
                          </span>
                          <span>
                            {gold(r.goldH)} {t`ouro/h`}
                          </span>
                        </span>
                      </Row>
                      <Show when={open() === r.g.dungeon}>
                        {(() => {
                          const x = detail(r.g, r.xpH);
                          return (
                            <Sources>
                              <li>
                                <span>{t`XP por corrida`}</span>
                                <span>{num(x.perRun)}</span>
                              </li>
                              <li>
                                <span>{t`Ouro por corrida`}</span>
                                <span>{num(x.goldPerRun)}</span>
                              </li>
                              <li>
                                <span>{t`XP de job por hora`}</span>
                                <span>{gold(x.jobH)}</span>
                              </li>
                              <Show when={x.level !== null}>
                                <li>
                                  <span>{t`Do seu nível, por hora`}</span>
                                  <span>
                                    {x.level! < 1
                                      ? pct(x.level!)
                                      : t`${levels(x.level!)} níveis`}
                                  </span>
                                </li>
                              </Show>
                              <Show when={r.g.deaths > 0}>
                                <li>
                                  <span>{t`Corridas em que você caiu`}</span>
                                  <span>{r.g.deaths}</span>
                                </li>
                              </Show>
                            </Sources>
                          );
                        })()}
                      </Show>
                    </li>
                  )}
                </For>
              </List>
            </Show>
            <Empty>
              {t`Por hora de DG, contando a largada entre uma corrida e a próxima (cerca de ${Math.round(d().lead_s)} s).`}
            </Empty>
            <Show when={d().capped}>
              <Empty>{t`Contando só as ${d().runs} corridas mais recentes.`}</Empty>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}

const List = styled("ul", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
});
const Row = styled("button", {
  base: {
    position: "relative",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    padding: "4px 8px",
    minHeight: "34px",
    border: "none",
    borderRadius: "6px",
    background: "rgba(255,255,255,0.05)",
    color: "#f3efe6",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    overflow: "hidden",
    "--c": "#d9b45a",
    "& [data-line]": {
      position: "relative",
      zIndex: 1,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: "8px",
    },
    "& [data-sub]": { color: "#d8ceb9", fontSize: "0.9em" },
    "& small": { color: "#d8ceb9", fontWeight: 400 },
    "& [data-num]": {
      fontVariantNumeric: "tabular-nums",
      fontWeight: 700,
      whiteSpace: "nowrap",
    },
    "& [data-name]": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontWeight: 600,
    },
  },
});
const Fill = styled("i", {
  base: {
    position: "absolute",
    inset: "0 auto 0 0",
    background: "var(--c)",
    opacity: 0.22,
    borderRadius: "6px",
  },
});
const Sources = styled("ul", {
  base: {
    listStyle: "none",
    margin: "2px 0 4px",
    padding: "0 8px 0 16px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "0.92em",
    "& li": { display: "flex", justifyContent: "space-between", gap: "8px" },
    "& li > span:last-child": { fontVariantNumeric: "tabular-nums" },
  },
});
const Empty = styled("p", {
  base: { margin: "2px 4px", color: "#c4b8a2", fontSize: "0.92em" },
});
