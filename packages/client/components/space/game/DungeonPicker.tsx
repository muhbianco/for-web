import { For, Show, createMemo } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { ClassId, DungeonDef } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { KindChip, LockText, Tag, chanceText } from "./DungeonDetail";
import {
  type DungeonFilter,
  type DungeonRow,
  type RegionGroup,
  KINDS,
  bossLoot,
  dungeonRow,
  kindParty,
  levelsText,
  oddsFor,
  recommendedDungeons,
  topRarities,
} from "./dungeonUi";
import { dungeonTitle, kindBlurb, kindName, rarityName } from "./gameText";
import { RARITY } from "./gameTheme";
import { Btn, Muted, Section } from "./gameUi";

/**
 * A escolha de DG na TV (26/11/2026, pedido do dono): no topo, as recomendadas para o nível (uma
 * de cada tipo) com o que dão; a legenda dos tipos; e o catálogo por região, com "Concluída", a
 * trava do Chefe de Região e o detalhe de cada uma num toque.
 */

/** Os cartões das recomendadas: tipo, nome, nível, grupo e as duas raridades mais altas. */
export function Recommended(props: {
  level: number;
  cls: ClassId;
  cleared: readonly string[];
  party: (d: DungeonDef) => number;
  onOpen: (d: DungeonDef) => void;
}) {
  const { t } = useLingui();
  const rows = createMemo(() =>
    recommendedDungeons(props.level).map((d) =>
      dungeonRow(d, props.level, props.cleared),
    ),
  );
  return (
    <Section aria-label={t`Recomendadas para o seu nível`}>
      <h3>{t`Recomendadas para o seu nível (${props.level})`}</h3>
      <Cards>
        <For each={rows()}>
          {(row) => (
            <Card
              type="button"
              data-kind={row.def.kind}
              data-locked={row.lock ? "" : undefined}
              onClick={() => props.onOpen(row.def)}
            >
              <CardHead>
                <KindChip kind={row.def.kind} />
                <Show when={row.done}>
                  <Tag data-tone="done">✓ {t`Concluída`}</Tag>
                </Show>
              </CardHead>
              <strong>{dungeonTitle(row.def)}</strong>
              <Muted>
                {row.def.region.name} ·{" "}
                {t`${row.def.party.min}–${row.def.party.max} heróis`}
              </Muted>
              <Show
                when={row.lock}
                fallback={
                  <Odds
                    def={row.def}
                    cls={props.cls}
                    party={props.party(row.def)}
                  />
                }
              >
                {(l) => (
                  <Muted data-lock="">
                    <LockText lock={l()} />
                  </Muted>
                )}
              </Show>
              <Muted data-more="">{t`Ver o que cai ›`}</Muted>
            </Card>
          )}
        </For>
      </Cards>
    </Section>
  );
}

/** As duas raridades mais altas que saem, com a chance por corrida (no cartão). */
function Odds(props: { def: DungeonDef; cls: ClassId; party: number }) {
  const top = createMemo(() =>
    topRarities(oddsFor(props.def, props.party, props.cls)),
  );
  return (
    <OddsLine>
      <For each={top()}>
        {(r) => (
          <span style={{ color: RARITY[r.rarity].color }}>
            {RARITY[r.rarity].pips} {rarityName(r.rarity)}{" "}
            <strong>{chanceText(r.chance)}</strong>
          </span>
        )}
      </For>
    </OddsLine>
  );
}

/** Os três tipos, cada um numa frase com os números do núcleo. */
export function KindLegend(props: { filter: DungeonFilter }) {
  const { t } = useLingui();
  return (
    <Legend aria-label={t`Tipos de dungeon`}>
      <For each={KINDS}>
        {(k) => (
          <li
            data-dim={
              props.filter !== "todas" && props.filter !== k ? "" : undefined
            }
          >
            <KindChip kind={k} />{" "}
            <Muted>{kindBlurb(k, kindParty(k), bossLoot(k))}</Muted>
          </li>
        )}
      </For>
    </Legend>
  );
}

/** O filtro por tipo. */
export function KindFilter(props: {
  value: DungeonFilter;
  onChange: (f: DungeonFilter) => void;
}) {
  const { t } = useLingui();
  return (
    <Chips role="radiogroup" aria-label={t`Tipo de dungeon`}>
      <For each={["todas", ...KINDS] as DungeonFilter[]}>
        {(k) => (
          <Btn
            type="button"
            data-size="sm"
            role="radio"
            aria-checked={props.value === k}
            aria-pressed={props.value === k}
            onClick={() => props.onChange(k)}
          >
            {k === "todas" ? t`Todas` : kindName(k)}
          </Btn>
        )}
      </For>
    </Chips>
  );
}

/** Uma região do catálogo: o cabeçalho com as concluídas e as DGs dela (cada uma abre o detalhe). */
export function RegionBlock(props: {
  group: RegionGroup;
  open: boolean;
  mineDungeon: string | null;
  onToggle: () => void;
  onOpen: (d: DungeonDef) => void;
}) {
  const { t } = useLingui();
  const g = () => props.group;
  return (
    <Region data-current={g().current ? "" : undefined}>
      <RegionHead
        type="button"
        aria-expanded={props.open}
        onClick={() => props.onToggle()}
      >
        <span>
          <strong>{g().region.name}</strong>{" "}
          <Muted>
            {t`níveis ${g().region.from}–${g().region.to} · ${g().region.material}`}
          </Muted>
        </span>
        <span>
          <Muted data-progress={g().done === g().total ? "full" : undefined}>
            {t`${g().done}/${g().total} concluídas`}
          </Muted>{" "}
          <span aria-hidden="true">{props.open ? "▾" : "▸"}</span>
        </span>
      </RegionHead>
      <Show when={props.open}>
        <For each={g().rows}>
          {(row) => (
            <DungeonLine
              row={row}
              mine={props.mineDungeon === row.def.id}
              onOpen={() => props.onOpen(row.def)}
            />
          )}
        </For>
      </Show>
    </Region>
  );
}

function DungeonLine(props: {
  row: DungeonRow;
  mine: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const r = () => props.row;
  const lv = () => levelsText(r().def);
  return (
    <Line
      type="button"
      data-locked={r().lock ? "" : undefined}
      data-rec={r().recommended ? "" : undefined}
      data-kind={r().def.kind}
      onClick={() => props.onOpen()}
    >
      <span>
        {/* "Caçada 40" e "Masmorra 40" já dizem o tipo; o chefe vem pelo nome. */}
        <Show when={r().def.kind === "regional"}>
          <KindChip kind={r().def.kind} />{" "}
        </Show>
        <strong>{dungeonTitle(r().def)}</strong>{" "}
        <Show when={r().done}>
          <Tag data-tone="done">✓ {t`Concluída`}</Tag>
        </Show>{" "}
        <Show when={r().recommended}>
          <Tag data-tone="rec">★ {t`Recomendada`}</Tag>
        </Show>{" "}
        <Show when={props.mine}>
          <Tag>{t`Seu grupo`}</Tag>
        </Show>
        <br />
        <Show
          when={r().lock}
          fallback={
            <Muted>
              {t`Monstros ${lv()} · recomendado a partir do ${r().def.minLevel} · ${r().def.party.min}–${r().def.party.max} heróis`}
            </Muted>
          }
        >
          {(l) => (
            <Muted data-lock="">
              <LockText lock={l()} />
            </Muted>
          )}
        </Show>
      </span>
      <span aria-hidden="true">›</span>
    </Line>
  );
}

const Cards = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "8px",
  },
});
const Card = styled("button", {
  base: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderTopWidth: "3px",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "&[data-kind=cacada]": { borderTopColor: "#9fd18a" },
    "&[data-kind=masmorra]": { borderTopColor: "#9fc3ff" },
    "&[data-kind=regional]": { borderTopColor: "#ffb36b" },
    "&:hover": { filter: "brightness(1.12)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
    "& [data-more]": { marginTop: "auto", fontWeight: 700 },
  },
});
const CardHead = styled("span", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "6px",
  },
});
const OddsLine = styled("span", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "2px 10px",
    fontSize: "0.9em",
    fontVariantNumeric: "tabular-nums",
  },
});
const Legend = styled("ul", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    "& > li[data-dim]": { opacity: 0.45 },
  },
});
const Chips = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "6px" },
});
const Region = styled("div", {
  base: {
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    overflow: "hidden",
    "&[data-current]": { borderColor: "var(--md-sys-color-outline)" },
  },
});
const RegionHead = styled("button", {
  base: {
    width: "100%",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "4px 8px",
    minHeight: "48px",
    padding: "8px 12px",
    border: "none",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    "& [data-progress=full]": { color: "#7ee08a" },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});
const Line = styled("button", {
  base: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px 8px 10px",
    border: "none",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    borderLeft: "4px solid transparent",
    "&[data-kind=cacada]": { borderLeftColor: "#9fd18a" },
    "&[data-kind=masmorra]": { borderLeftColor: "#9fc3ff" },
    "&[data-kind=regional]": { borderLeftColor: "#ffb36b" },
    background: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    "&[data-locked]": { opacity: 0.6 },
    "&[data-rec]": { background: "rgba(217,180,90,0.08)" },
    "&:hover": { background: "var(--md-sys-color-surface-container)" },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});
