import { For, Show, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { RunState } from "@muchat/space-client";
import {
  dungeonOf,
  itemDef,
  monsterDef,
  stageMonsters,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { rpgLabels } from "./rpgUi";
import {
  clock,
  coins,
  feedLine,
  isMajor,
  itemList,
  outcomeLabel,
  stageName,
} from "./runUi";

/** Linhas do registro à vista. */
const FEED_SHOWN = 12;

/**
 * A tela da aventura (docs/espaco/jogo/ot, etapa O5): a corrida da dungeon como o servidor
 * manda, um segundo por vez. Não bloqueia o mapa (o teclado segue andando com o avatar) e
 * não faz nada por quadro: muda quando chega um segundo novo.
 */
export default function RunPanel(props: {
  state: RunState;
  myId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const run = () => props.state.run;
  const frame = () => props.state.frame;
  const end = () => props.state.end;
  const st = () => frame()?.st ?? 0;
  const stages = () => dungeonOf(run().dungeon)?.stages.length ?? 0;
  const total = () =>
    Math.max(1, Math.round((run().ends_at - run().started_at) / 1000));
  const monsters = createMemo(() =>
    stageMonsters(run().dungeon, st(), run().members.length),
  );
  const feed = () => props.state.feed.slice(-FEED_SHOWN);
  const where = () => {
    const n = st() + 1;
    const of = stages();
    const name = stageName(run().dungeon, st());
    return t`Sala ${n} de ${of}: ${name}`;
  };

  return (
    <Panel role="region" aria-label={t`Dungeon em andamento`}>
      <Head>
        <div>
          <strong>{dungeonOf(run().dungeon)?.name ?? run().dungeon}</strong>
          <Muted>
            {end()
              ? outcomeLabel(end()!.outcome)
              : frame()
                ? where()
                : t`Em andamento`}
          </Muted>
        </div>
        <Show when={frame()}>
          {(f) => (
            <Muted aria-hidden="true">
              {clock(f().s)} / {clock(total())}
            </Muted>
          )}
        </Show>
        <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
          ×
        </Close>
      </Head>

      <Show
        when={frame()}
        fallback={
          <Muted>{t`A corrida segue no servidor; o resultado chega no fim.`}</Muted>
        }
      >
        {(f) => (
          <Cols>
            <section aria-label={t`Grupo`}>
              <For each={run().members}>
                {(m, i) => {
                  const hp = () => f().h[i()] ?? 0;
                  const mp = () => f().m[i()] ?? 0;
                  return (
                    <Unit data-dead={hp() <= 0 ? "" : undefined}>
                      <span>
                        {m.name}
                        {m.user_id === props.myId ? ` ${t`(você)`}` : ""}{" "}
                        <Muted>
                          {L.vocation[m.vocation as 1 | 2 | 3 | 4]?.name ?? ""}{" "}
                          · Nv {m.level}
                        </Muted>
                      </span>
                      <Bar
                        role="meter"
                        aria-label={t`Vida de ${m.name}`}
                        aria-valuemin={0}
                        aria-valuemax={m.health_max}
                        aria-valuenow={hp()}
                        data-low={hp() / m.health_max < 0.3 ? "" : undefined}
                      >
                        <span
                          style={{ width: `${pct(hp(), m.health_max)}%` }}
                        />
                      </Bar>
                      <Show when={m.mana_max > 0}>
                        <Bar
                          data-mana=""
                          role="meter"
                          aria-label={t`Mana de ${m.name}`}
                          aria-valuemin={0}
                          aria-valuemax={m.mana_max}
                          aria-valuenow={mp()}
                        >
                          <span
                            style={{ width: `${pct(mp(), m.mana_max)}%` }}
                          />
                        </Bar>
                      </Show>
                    </Unit>
                  );
                }}
              </For>
            </section>
            <section aria-label={t`Monstros`}>
              <For each={monsters()}>
                {(x, i) => {
                  const hp = () => f().x[i()] ?? 0;
                  const def = monsterDef(x.id);
                  return (
                    <Unit data-dead={hp() <= 0 ? "" : undefined}>
                      <span>
                        {def?.name ?? x.id}
                        {def?.boss ? ` ${t`(chefe)`}` : ""}
                      </span>
                      <Bar
                        data-foe=""
                        role="meter"
                        aria-label={t`Vida de ${def?.name ?? x.id}`}
                        aria-valuemin={0}
                        aria-valuemax={x.health}
                        aria-valuenow={hp()}
                      >
                        <span style={{ width: `${pct(hp(), x.health)}%` }} />
                      </Bar>
                    </Unit>
                  );
                }}
              </For>
            </section>
          </Cols>
        )}
      </Show>

      <Feed>
        <For each={feed()}>
          {(ev) => (
            <li data-major={isMajor(ev) ? "" : undefined}>
              <Muted>{clock(ev.at)}</Muted> {feedLine(run(), ev)}
            </li>
          )}
        </For>
      </Feed>

      <Show when={end()}>
        {(e) => (
          <Summary>
            <For each={e().members}>
              {(m) => {
                const name =
                  run().members.find((x) => x.user_id === m.user_id)?.name ??
                  "";
                const r = m.reward;
                // Etapa O7: o que gastou (até quem caiu) e o que ficou no corpo.
                const spent = itemList(m.spent ?? []);
                const left = itemList(m.left ?? []);
                const extra = (
                  <>
                    <Show when={spent}>
                      <Muted style={{ display: "block" }}>
                        {t`Gastou: ${spent}.`}
                      </Muted>
                    </Show>
                    <Show when={left}>
                      <Muted style={{ display: "block" }}>
                        {t`Ficou no corpo (sem espaço): ${left}.`}
                      </Muted>
                    </Show>
                  </>
                );
                if (!r)
                  return (
                    <li>
                      {t`${name}: caiu e perdeu a recompensa desta dungeon.`}
                      {extra}
                    </li>
                  );
                const items = r.loot
                  .map((l) =>
                    l.count > 1
                      ? `${l.count}× ${itemDef(l.item)?.name ?? l.item}`
                      : (itemDef(l.item)?.name ?? l.item),
                  )
                  .join(", ");
                const exp = r.exp.toLocaleString();
                const gold = coins(r.gold);
                return (
                  <li>
                    {items
                      ? t`${name}: +${exp} de experiência, ${gold}, ${items}.`
                      : t`${name}: +${exp} de experiência, ${gold}.`}
                    {extra}
                  </li>
                );
              }}
            </For>
          </Summary>
        )}
      </Show>

      {/* Só o que muda de sala e o fim, para leitor de tela (o registro corre rápido). */}
      <Live role="status">
        {end() ? outcomeLabel(end()!.outcome) : frame() ? where() : ""}
      </Live>
    </Panel>
  );
}

function pct(v: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (v * 100) / max)) : 0;
}

const Panel = styled("div", {
  base: {
    position: "absolute",
    right: "12px",
    bottom: "12px",
    width: "min(400px, calc(100% - 24px))",
    maxHeight: "calc(100% - 24px)",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "12px 14px",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
    zIndex: 5,
    fontSize: "0.9em",
  },
});

const Head = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "start",
    gap: "8px",
    "& > div": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});

const Close = styled("button", {
  base: {
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "1.3em",
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
  },
});

const Cols = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "& section": { display: "flex", flexDirection: "column", gap: "6px" },
  },
});

const Unit = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "&[data-dead]": { opacity: 0.45 },
  },
});

const Bar = styled("div", {
  base: {
    height: "6px",
    borderRadius: "999px",
    background: "var(--md-sys-color-surface-container-highest)",
    overflow: "hidden",
    "& > span": {
      display: "block",
      height: "100%",
      borderRadius: "inherit",
      background: "var(--md-sys-color-tertiary)",
      transition: "width 0.35s ease",
    },
    "&[data-low] > span": { background: "var(--md-sys-color-error)" },
    "&[data-mana] > span": { background: "var(--md-sys-color-primary)" },
    "&[data-foe] > span": { background: "var(--md-sys-color-error)" },
    "@media (prefers-reduced-motion: reduce)": {
      "& > span": { transition: "none" },
    },
  },
});

const Feed = styled("ol", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    fontSize: "0.92em",
    "& li[data-major]": { fontWeight: 600 },
  },
});

const Summary = styled("ul", {
  base: {
    margin: 0,
    paddingInlineStart: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.88em" },
});

const Live = styled("div", {
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
});
