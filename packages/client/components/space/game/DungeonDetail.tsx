import { For, Show, createMemo, createSignal, untrack } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ClassId,
  type DungeonDef,
  type LootSourceOdds,
  type RarityId,
  LEGENDARIES,
  RARITY_IDS,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { type DungeonLock, oddsFor, partySizes, rarityRows } from "./dungeonUi";
import {
  archetypeName,
  dungeonTitle,
  familyName,
  kindName,
  rarityName,
  slotName,
} from "./gameText";
import { RARITY } from "./gameTheme";
import { Btn, Muted, Panel, Row, Section } from "./gameUi";
import { pct, runRooms } from "./heroModel";

/** O selo do tipo (cor E texto). */
export function KindChip(props: { kind: DungeonDef["kind"] }) {
  return <Kind data-kind={props.kind}>{kindName(props.kind)}</Kind>;
}

/** A trava em palavras: o que falta concluir na região (o nível não trava desde 27/11/2026). */
export function LockText(props: { lock: DungeonLock }) {
  const { t } = useLingui();
  const text = () => {
    const l = props.lock;
    const list = l.missing.map((d) => dungeonTitle(d)).join(", ");
    return t`Conclua antes: ${list}`;
  };
  return <>🔒 {text()}</>;
}

/**
 * O detalhe de uma DG: o que é, o que cai e a chance de cada raridade para o herói, num grupo do
 * tamanho escolhido (o do grupo dele de saída). Os números saem de `dungeonLootOdds`, o mesmo
 * código do sorteio do servidor.
 */
export default function DungeonDetail(props: {
  def: DungeonDef;
  cls: ClassId;
  done: boolean;
  lock: DungeonLock | null;
  recommended: boolean;
  /** O tamanho de grupo com que as chances abrem. */
  party: number;
  action: { label: string; disabled: boolean; note?: string } | null;
  busy: boolean;
  onAction: () => void;
  onBack: () => void;
}) {
  const { t } = useLingui();
  // O tamanho de saída (o do meu grupo); depois, quem manda é o seletor.
  const [picked, setSize] = createSignal(untrack(() => props.party));
  /** O tamanho escolhido, dentro do que a DG aceita. */
  const size = () =>
    Math.min(props.def.party.max, Math.max(props.def.party.min, picked()));
  const odds = createMemo(() => oddsFor(props.def, size(), props.cls));
  const rows = () => rarityRows(odds());
  const legend = () =>
    odds()
      .legendaries.map((id) => LEGENDARIES.find((l) => l.id === id)?.name)
      .filter((x): x is string => !!x);
  const rooms = createMemo(() =>
    runRooms(props.def.id, size()).map((room) => {
      const count = new Map<string, number>();
      for (const e of room)
        count.set(e.archetype, (count.get(e.archetype) ?? 0) + 1);
      return [...count].map(([a, n]) => ({ a, n }));
    }),
  );
  const levels = () => odds().itemLevels;
  const levelText = () =>
    levels().min === levels().max
      ? String(levels().max)
      : `${levels().min}–${levels().max}`;

  return (
    <Wrap aria-label={t`Detalhe da dungeon`}>
      <Row>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={props.onBack}
        >
          ← {t`Dungeons`}
        </Btn>
      </Row>

      <Head>
        <KindChip kind={props.def.kind} />
        <h3>{dungeonTitle(props.def)}</h3>
        <Muted>{props.def.region.name}</Muted>
        <Tags>
          <Show when={props.done}>
            <Tag data-tone="done">✓ {t`Concluída`}</Tag>
          </Show>
          <Show when={!props.done}>
            <Tag>{t`Ainda não concluída`}</Tag>
          </Show>
          <Show when={props.recommended}>
            <Tag data-tone="rec">★ {t`Recomendada`}</Tag>
          </Show>
        </Tags>
      </Head>

      <Facts>
        <dt>{t`Monstros e itens`}</dt>
        <dd>
          {t`Nível ${levelText()}`}
          <Muted>
            {" "}
            · {props.def.region.families.map((f) => familyName(f)).join(", ")}
          </Muted>
        </dd>
        <dt>{t`Recomendado`}</dt>
        <dd>{t`A partir do nível ${props.def.minLevel} (qualquer nível entra)`}</dd>
        <dt>{t`Grupo`}</dt>
        <dd>{t`De ${props.def.party.min} a ${props.def.party.max} heróis`}</dd>
        <dt>{t`Salas`}</dt>
        <dd>
          <Rooms>
            <For each={rooms()}>
              {(room, i) => (
                <li>
                  <Muted>{i() + 1}.</Muted>{" "}
                  {room
                    .map(
                      (x) =>
                        `${x.n > 1 ? `${x.n} × ` : ""}${archetypeName(x.a as LootSourceOdds["archetype"])}`,
                    )
                    .join(" + ")}
                </li>
              )}
            </For>
          </Rooms>
        </dd>
      </Facts>
      <Show when={props.lock}>
        {(l) => (
          <Muted role="note" data-lock="">
            <LockText lock={l()} />
          </Muted>
        )}
      </Show>

      <Section aria-label={t`O que cai`}>
        <h3>{t`O que cai`}</h3>
        <Drops>
          <li>
            {t`Equipamento de ${odds().materials.join(" e ")}, nível ${levelText()}, para a sua classe:`}{" "}
            <Muted>
              {odds()
                .slots.map((s) => slotName(s))
                .join(", ")}
              .
            </Muted>
          </li>
          <Show
            when={legend().length > 0 && odds().perHero.atLeastOne.lendario > 0}
          >
            <li>
              {t`Lendário: qualquer item do jogo, com o perk numa habilidade da sua classe (o que não servir, dá para passar a outro jogador pelo Banqueiro). Às vezes vem um com nome: ${legend().join(", ")}.`}
            </li>
          </Show>
          <li>
            {t`${odds().ore.perHero} minérios de ${odds().ore.material} (1 por sala vencida)`}
          </li>
          <Show when={odds().protectionStone > 0}>
            <li>{t`Pedra de Proteção: ${pct(odds().protectionStone)} no chefe`}</li>
          </Show>
        </Drops>
      </Section>

      <Section aria-label={t`Chances por corrida`}>
        <h3>{t`Chances por corrida, para você`}</h3>
        <Muted>{t`Heróis no grupo:`}</Muted>
        <Row role="radiogroup" aria-label={t`Heróis no grupo`}>
          <For each={partySizes(props.def)}>
            {(n) => (
              <Btn
                type="button"
                data-size="sm"
                role="radio"
                aria-checked={size() === n}
                aria-pressed={size() === n}
                onClick={() => setSize(n)}
              >
                {n}
              </Btn>
            )}
          </For>
        </Row>
        <Bars>
          <For each={rows()}>
            {(r) => <RarityBar rarity={r.rarity} chance={r.chance} />}
          </For>
        </Bars>
        <Muted>
          {t`≈ ${num1(odds().perHero.items)} itens por corrida para você. Chance de sair pelo menos um de cada raridade.`}
        </Muted>
        <Sources>
          <summary>{t`De onde vem`}</summary>
          <For each={odds().sources}>
            {(s) => <SourceLine s={s} party={size()} />}
          </For>
          <Muted>
            {t`Conta de uma corrida vencida com o grupo todo vivo: quem cai antes de um abate não leva o item dele.`}
          </Muted>
        </Sources>
      </Section>

      <Show when={props.action}>
        {(a) => (
          <Panel>
            <Btn
              type="button"
              data-tone="primary"
              disabled={props.busy || a().disabled}
              onClick={() => props.onAction()}
            >
              {a().label}
            </Btn>
            <Show when={a().note}>
              <Muted role="note">{a().note}</Muted>
            </Show>
          </Panel>
        )}
      </Show>
    </Wrap>
  );
}

const oneFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const num1 = (n: number) => oneFmt.format(n);

/** A chance em texto: "—" quando não sai. */
export const chanceText = (p: number) => (p > 0 ? pct(p) : "—");

/** Uma raridade: o nome com o marcador e a cor, a barra e a chance. */
export function RarityBar(props: { rarity: RarityId; chance: number }) {
  const look = () => RARITY[props.rarity];
  return (
    <BarRow data-zero={props.chance > 0 ? undefined : ""}>
      <span style={{ color: look().color }}>
        <Pip aria-hidden="true">{look().pips || "·"}</Pip>{" "}
        {rarityName(props.rarity)}
      </span>
      <Track aria-hidden="true">
        <Fill
          style={{
            width: `${Math.max(props.chance > 0 ? 2 : 0, props.chance * 100)}%`,
            background: look().color,
          }}
        />
      </Track>
      <strong>{chanceText(props.chance)}</strong>
    </BarRow>
  );
}

/** Uma fonte de drop: quem, quantos, a chance de item e a raridade dele. */
function SourceLine(props: { s: LootSourceOdds; party: number }) {
  const { t } = useLingui();
  const s = () => props.s;
  const lv = () =>
    s().levels.min === s().levels.max
      ? String(s().levels.max)
      : `${s().levels.min}–${s().levels.max}`;
  const who = () =>
    s().perPlayer
      ? t`1 item para cada um`
      : s().chance > 1
        ? t`1 item e ${pct(s().chance - Math.floor(s().chance))} de mais um, para alguém do grupo`
        : s().chance >= 1
          ? props.party > 1
            ? t`1 item para alguém do grupo`
            : t`1 item`
          : props.party > 1
            ? t`${pct(s().chance)} de item em cada, para alguém do grupo`
            : t`${pct(s().chance)} de item em cada`;
  return (
    <Source>
      <strong>
        {s().count > 1 ? `${s().count} × ` : ""}
        {archetypeName(s().archetype)}
      </strong>{" "}
      <Muted>{t`nível ${lv()}`}</Muted>
      <br />
      <Muted>{who()}</Muted>
      <br />
      <For each={RARITY_IDS.filter((r) => s().rarity[r] > 0)}>
        {(r, i) => (
          <>
            {i() > 0 ? " · " : ""}
            <span style={{ color: RARITY[r].color }}>
              {rarityName(r)} {pct(s().rarity[r])}
            </span>
          </>
        )}
      </For>
    </Source>
  );
}

const Wrap = styled("section", {
  base: { display: "flex", flexDirection: "column", gap: "12px" },
});
const Head = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px 10px",
    "& > h3": { margin: 0, fontSize: "1.15rem" },
  },
});
const Tags = styled("span", {
  base: { display: "inline-flex", flexWrap: "wrap", gap: "6px" },
});
export const Tag = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "1px 8px",
    borderRadius: "999px",
    fontSize: "0.75rem",
    fontWeight: 700,
    border: "1px solid var(--md-sys-color-outline-variant)",
    color: "var(--md-sys-color-on-surface-variant)",
    whiteSpace: "nowrap",
    "&[data-tone=done]": { color: "#7ee08a", borderColor: "#7ee08a" },
    "&[data-tone=rec]": {
      color: "var(--md-sys-color-on-primary)",
      background: "var(--md-sys-color-primary)",
      borderColor: "transparent",
    },
  },
});
const Facts = styled("dl", {
  base: {
    margin: 0,
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "4px 12px",
    "& > dt": {
      color: "var(--md-sys-color-on-surface-variant)",
      fontSize: "0.85em",
    },
    "& > dd": { margin: 0 },
  },
});
const Rooms = styled("ol", {
  base: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
});
const Drops = styled("ul", {
  base: {
    margin: 0,
    paddingLeft: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
});
const Bars = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});
const BarRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "7.5em 1fr 3.6em",
    alignItems: "center",
    gap: "8px",
    fontVariantNumeric: "tabular-nums",
    "& > strong": { textAlign: "right" },
    "&[data-zero]": { opacity: 0.5 },
  },
});
const Pip = styled("span", {
  base: { display: "inline-block", minWidth: "1.6em", fontSize: "0.8em" },
});
const Track = styled("span", {
  base: {
    height: "10px",
    borderRadius: "999px",
    background: "var(--md-sys-color-surface-container-highest)",
    overflow: "hidden",
  },
});
const Fill = styled("span", {
  base: { display: "block", height: "100%", borderRadius: "999px" },
});
const Sources = styled("details", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "& > summary": { cursor: "pointer", fontWeight: 700, minHeight: "32px" },
  },
});
const Source = styled("p", {
  base: { margin: "6px 0", lineHeight: 1.5 },
});
export const Kind = styled("span", {
  base: {
    justifySelf: "start",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.04em",
    padding: "2px 8px",
    borderRadius: "6px",
    border: "1px solid currentColor",
    whiteSpace: "nowrap",
    "&[data-kind=cacada]": { color: "#9fd18a" },
    "&[data-kind=masmorra]": { color: "#9fc3ff" },
    "&[data-kind=regional]": { color: "#ffb36b" },
  },
});
