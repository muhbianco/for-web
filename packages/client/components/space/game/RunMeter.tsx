import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import { type ClassId, skillOf } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { CLASS_ICON } from "./RunHud";
import { gameFrame } from "./gameTheme";
import { Grip, Tabs } from "./gameUi";
import { num } from "./heroModel";
import { dungeonName } from "./partyUi";
import { useWide, useWindowDrag } from "./windowDrag";

type Tab = "dmg" | "taken" | "heal";

/** As cores das classes nas barras do medidor (com o nome escrito: a cor nunca é o único sinal). */
export const CLASS_COLOR: Record<ClassId, string> = {
  guerreiro: "#c79c6e",
  paladino: "#f58cba",
  padre: "#e8e8e8",
  druida: "#ff9a3c",
  mago: "#69ccf0",
  cacador: "#abd473",
  assassino: "#fff27a",
};

/** "1 min 23 s" / "45 s" (o tempo da corrida até agora). */
function clock(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m > 0 ? `${m} min ${r} s` : `${r} s`;
}

/**
 * O medidor da corrida (26/11/2026, no jeito do Details!/Recount e do medidor nativo do WoW):
 * uma janela à parte, que o jogador abre se quiser e arrasta para onde não atrapalha. Uma métrica
 * por aba (dano causado, dano recebido, cura), cada herói com o total, o por segundo e a fatia do
 * grupo; clicar no herói abre de onde veio (skill a skill). Embaixo, o dano e a cura do grupo
 * por segundo e o tempo da corrida.
 */
export default function RunMeter(props: {
  state: RunState;
  myId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [tab, setTab] = createSignal<Tab>("dmg");
  const [open, setOpen] = createSignal<number | null>(null);
  let win: HTMLDivElement | undefined;
  const wide = useWide(() => win?.parentElement ?? undefined, 600);
  const drag = useWindowDrag({
    id: "rpg-meter",
    win: () => win,
    bounds: () => win?.parentElement,
    enabled: wide,
  });

  const m = () => props.state.meter;
  const secs = () => Math.max(1, m().s);
  const values = () =>
    tab() === "dmg" ? m().dmg : tab() === "taken" ? m().taken : m().heal;
  const rows = createMemo(() => {
    const v = values();
    const total = v.reduce((a, b) => a + b, 0);
    const top = Math.max(1, ...v);
    return props.state.run.members
      .map((mem, i) => ({
        i,
        mem,
        v: v[i] ?? 0,
        frac: (v[i] ?? 0) / top,
        share: total > 0 ? (v[i] ?? 0) / total : 0,
      }))
      .sort((a, b) => b.v - a.v);
  });
  const sources = (i: number) => {
    const by =
      tab() === "dmg"
        ? m().dmgBy[i]
        : tab() === "heal"
          ? m().healBy[i]
          : undefined;
    if (!by) return [];
    const cls = props.state.run.members[i]!.cls;
    const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(by)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([s, v]) => ({
        name:
          s === "auto"
            ? t`Ataque básico`
            : s === "pocao"
              ? t`Poção`
              : (skillOf(cls, s)?.name ?? s),
        v,
        share: v / total,
      }));
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <Win
      ref={win}
      style={{ ...gameFrame, ...drag.style() }}
      data-dragging={drag.dragging() ? "" : undefined}
      role="dialog"
      aria-label={t`Medidor da corrida`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <Head {...drag.handle} data-draggable={wide() ? "" : undefined}>
        <Show when={wide()}>
          <Grip onKey={drag.onGripKey} />
        </Show>
        <div>
          <strong>{t`Medidor`}</strong>
          <small>{dungeonName(props.state.run.dungeon)}</small>
        </div>
        <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
          <Symbol size={18}>close</Symbol>
        </Close>
      </Head>
      <Tabs
        label={t`Medidor`}
        value={tab()}
        onChange={(v) => {
          setTab(v);
          setOpen(null);
        }}
        items={[
          { id: "dmg", label: t`Dano` },
          { id: "taken", label: t`Recebido` },
          { id: "heal", label: t`Cura` },
        ]}
      />
      <List role="list">
        <For each={rows()}>
          {(r) => (
            <li>
              <Row
                type="button"
                aria-expanded={tab() !== "taken" ? open() === r.i : undefined}
                disabled={tab() === "taken"}
                data-me={r.mem.user_id === props.myId ? "" : undefined}
                onClick={() => setOpen(open() === r.i ? null : r.i)}
                style={{ "--c": CLASS_COLOR[r.mem.cls] }}
              >
                <Fill style={{ width: `${Math.round(r.frac * 100)}%` }} />
                <span data-name="">
                  <Symbol size={14}>{CLASS_ICON[r.mem.cls]}</Symbol>
                  {r.mem.name}
                </span>
                <span data-num="">
                  {num(r.v)}{" "}
                  <small>
                    ({num(r.v / secs())}/s · {Math.round(r.share * 100)}%)
                  </small>
                </span>
              </Row>
              <Show when={open() === r.i && tab() !== "taken"}>
                <Sources>
                  <For each={sources(r.i)}>
                    {(s) => (
                      <li>
                        <span>{s.name}</span>
                        <span>
                          {num(s.v)} <small>{Math.round(s.share * 100)}%</small>
                        </span>
                      </li>
                    )}
                  </For>
                </Sources>
              </Show>
            </li>
          )}
        </For>
      </List>
      <Foot>
        <span>
          {t`Grupo`}: <strong>{num(sum(m().dmg) / secs())}</strong>{" "}
          {t`de dano/s`} · <strong>{num(sum(m().heal) / secs())}</strong>{" "}
          {t`de cura/s`}
        </span>
        <span>{clock(m().s)}</span>
        <Show when={!props.state.meterFromStart}>
          <small>{t`Contando desde que você abriu a corrida.`}</small>
        </Show>
      </Foot>
    </Win>
  );
}

const Win = styled("div", {
  base: {
    position: "absolute",
    left: "12px",
    top: "64px",
    width: "300px",
    maxWidth: "calc(100% - 24px)",
    maxHeight: "calc(100% - 80px)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "6px 8px 8px",
    borderRadius: "12px",
    zIndex: 6,
    fontSize: "0.85em",
    "@media (max-width: 600px)": {
      left: "8px",
      right: "8px",
      width: "auto",
      top: "56px",
    },
  },
});
const Head = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    "& > div": {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      lineHeight: 1.2,
      minWidth: 0,
    },
    "& small": {
      color: "#c4b8a2",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    "&[data-draggable]": { cursor: "grab" },
  },
});
const Close = styled("button", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "30px",
    height: "30px",
    borderRadius: "999px",
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    "&:hover": { background: "rgba(255,255,255,0.08)" },
  },
});
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
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "4px 8px",
    minHeight: "26px",
    border: "none",
    borderRadius: "6px",
    background: "rgba(255,255,255,0.05)",
    color: "#f3efe6",
    font: "inherit",
    cursor: "pointer",
    overflow: "hidden",
    "&:disabled": { cursor: "default" },
    "&[data-me]": { boxShadow: "inset 0 0 0 1px rgba(217,180,90,0.7)" },
    "& > span": {
      position: "relative",
      zIndex: 1,
      display: "flex",
      gap: "4px",
      alignItems: "center",
    },
    "& small": { color: "#d8ceb9", fontWeight: 400 },
    "& [data-num]": { fontVariantNumeric: "tabular-nums", fontWeight: 700 },
    "& [data-name]": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
  },
});
const Fill = styled("i", {
  base: {
    position: "absolute",
    inset: "0 auto 0 0",
    background: "var(--c)",
    opacity: 0.28,
    borderRadius: "6px",
  },
});
const Sources = styled("ul", {
  base: {
    listStyle: "none",
    margin: "2px 0 4px",
    padding: "0 8px 0 26px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "0.92em",
    "& li": { display: "flex", justifyContent: "space-between", gap: "8px" },
    "& small": { color: "#c4b8a2" },
  },
});
const Foot = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "4px 10px",
    paddingTop: "4px",
    borderTop: "1px solid rgba(122,100,64,0.4)",
    color: "#d8ceb9",
    "& small": { width: "100%", color: "#c4b8a2" },
    "& strong": { color: "#f3efe6" },
  },
});
