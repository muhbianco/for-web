import { type JSX, For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type GearSlot,
  type HeroV5,
  type ItemInstance,
  CLASSES,
  armorFit,
  itemTooltip,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import {
  derivedName,
  errorText,
  overweightText,
  rarityName,
  slotName,
  weightName,
} from "./gameText";
import { RARITY } from "./gameTheme";
import { Btn, Delta, Gold, ItemIcon, Muted } from "./gameUi";
import {
  type DerivedKey,
  DERIVED_ALL,
  DERIVED_MAIN,
  bagMarks,
  cannotWear,
  derivedDiff,
  derivedOf,
  derivedText,
  equipPreview,
  equippedIn,
  gold,
  pct,
} from "./heroModel";
import { ItemTip } from "./ItemTip";

/**
 * O detalhe de um item (spec §9.7): nome na cor da raridade e o nome da raridade escrito, iL e
 * requisito, a linha base, refino, afixos e o efeito lendário; e a comparação antes/depois com o
 * que está vestido no mesmo lugar: cada número com ▲/▼, e "se vestir", os derivados do herói pela
 * mesma conta do combate. `actions` vai embaixo (equipar, vender, refinar...).
 *
 * `compact` é o mesmo detalhe no tooltip do item (ItemTip): sem ações e sem o "ver todos os
 * números". Sem herói (`hero` null: o item que caiu para outra pessoa), não compara nem diz se
 * dá para vestir. `price`: quanto o Mercador paga, onde vender faz sentido.
 */
export function ItemCard(props: {
  hero: HeroV5 | null;
  item: ItemInstance & { uid?: string };
  /** Compara com o vestido (padrão: sim, se não for o próprio). */
  compare?: boolean;
  actions?: JSX.Element;
  compact?: boolean;
  price?: number;
}) {
  const { t } = useLingui();
  const [all, setAll] = createSignal(false);
  const worn = () =>
    props.hero
      ? equippedIn(props.hero, props.item.slot as GearSlot)
      : undefined;
  const isWorn = () => !!props.item.uid && worn()?.uid === props.item.uid;
  const comparing = () => (props.compare ?? true) && !isWorn() && !!worn();
  const tip = createMemo(() =>
    itemTooltip(props.item, comparing() ? worn() : undefined),
  );
  const theirs = createMemo(() => (comparing() ? itemTooltip(worn()!) : null));
  const r = () => RARITY[props.item.rarity];
  const below = () => !!props.hero && props.hero.level < tip().requiredLevel;
  const blocked = () =>
    !props.hero || isWorn() ? null : cannotWear(props.hero, props.item);
  // Armadura um peso acima do da classe de quem vê (27/11/2026): veste, com penalidade por peça.
  const overweight = () => {
    const it = props.item;
    if (!props.hero || !("weight" in it) || !it.weight) return null;
    return armorFit(props.hero.cls, it.weight) === "acima" ? it.weight : null;
  };

  // "Se vestir": o herói com este item no lugar (só itens da mochila; a prévia do núcleo).
  const preview = createMemo(() => {
    const h = props.hero;
    const uid = props.item.uid;
    if (!h || !uid || isWorn() || blocked()) return null;
    if (!h.bag.some((x) => x.uid === uid)) return null;
    const p = equipPreview(h, uid);
    if (!p.ok) return null;
    const keys: DerivedKey[] = all() ? DERIVED_ALL : DERIVED_MAIN[h.cls];
    const rows = derivedDiff(derivedOf(h), derivedOf(p.after), keys);
    const mark = bagMarks({
      ...h,
      bag: [h.bag.find((x) => x.uid === uid)!],
    })[uid];
    return { rows, score: mark?.score ?? 1 };
  });

  return (
    <Card
      style={{ "--rc": tip().supreme ? "#ff4a2a" : r().color }}
      data-compact={props.compact ? "" : undefined}
      data-supreme={tip().supreme ? "" : undefined}
    >
      <Top>
        <ItemIcon item={props.item} size={props.compact ? 48 : 64} />
        <div>
          <Name>{tip().name}</Name>
          <Meta>
            <span>
              {r().pips ? `${r().pips} ` : ""}
              {tip().supreme ? t`Arma Suprema` : rarityName(props.item.rarity)}
            </span>
            <span>·</span>
            <span>{slotName(props.item.slot as GearSlot)}</span>
            <Show when={props.item.refine > 0}>
              <span>·</span>
              <strong>+{props.item.refine}</strong>
            </Show>
          </Meta>
          <Muted>{tip().kind}</Muted>
          <Show when={tip().supreme}>
            {(sp) => (
              <SupremeLine>
                {t`✦ +${pct(sp().power)} de poder no dano da arma · 2 perks`}
              </SupremeLine>
            )}
          </Show>
          <Req data-bad={below() ? "" : undefined}>
            {t`Nível do item ${tip().ilvl} · pede nível ${tip().requiredLevel}`}
            <Show when={below()}> {t`(acima do seu)`}</Show>
          </Req>
        </div>
      </Top>

      <Show when={isWorn()}>
        <Tag>{t`Vestido agora`}</Tag>
      </Show>
      <Show when={blocked()}>
        {(b) => <Blocked role="note">⛔ {errorText(b())}</Blocked>}
      </Show>
      <Show when={!blocked() && overweight()}>
        {(w) => (
          <Heavy role="note">
            <b>
              ◐ {t`Armadura ${weightName(w())}: um peso acima do da sua classe`}
            </b>
            <span>{overweightText()}.</span>
          </Heavy>
        )}
      </Show>

      <Lines>
        <For each={tip().base}>
          {(b) => {
            const old = () => theirs()?.base.find((x) => x.label === b.label);
            return (
              <Line>
                <span>{b.label}</span>
                <Show when={old()} fallback={<strong>{b.value}</strong>}>
                  {(o) => <Delta a={o().value} b={b.value} fmt={String} />}
                </Show>
              </Line>
            );
          }}
        </For>
        <For each={tip().affixes}>
          {(a) => (
            <Line data-affix="">
              <span>
                {a.text}{" "}
                <Range
                  title={t`Faixa do sorteio deste afixo no nível e na raridade do item`}
                >
                  ({a.range})
                </Range>
              </span>
              <Show when={a.delta !== undefined && Math.abs(a.delta) > 1e-9}>
                <Diff data-up={a.delta! > 0 ? "" : undefined}>
                  {a.delta! > 0 ? "▲" : "▼"} {t`vs vestido`}
                </Diff>
              </Show>
            </Line>
          )}
        </For>
        <Show
          when={
            tip().affixes.length === 0 &&
            props.item.slot !== "colar" &&
            props.item.slot !== "anel"
          }
        >
          <Muted>{t`Sem afixos (Comum).`}</Muted>
        </Show>
        <Show when={theirs()}>
          {(o) => (
            <For
              each={o().affixes.filter(
                (x) => !tip().affixes.some((y) => y.id === x.id),
              )}
            >
              {(lost) => (
                <Line data-lost="">
                  <span>{lost.text}</span>
                  <Diff>▼ {t`perde`}</Diff>
                </Line>
              )}
            </For>
          )}
        </Show>
      </Lines>

      <For each={tip().perks ?? []}>
        {(p) => (
          <Legend
            data-off={
              p.cls && props.hero && p.cls !== props.hero.cls ? "" : undefined
            }
          >
            ★ {p.text}
            <Show when={p.cls && props.hero && p.cls !== props.hero.cls}>
              {" "}
              <Muted>{t`(skill de ${CLASSES[p.cls!].titles[1]}: não vale para você)`}</Muted>
            </Show>
          </Legend>
        )}
      </For>

      <Show when={props.price !== undefined}>
        <Line data-price="">
          <span>{t`O Mercador paga`}</span>
          <Gold n={gold(props.price ?? 0)} />
        </Line>
      </Show>

      <Show when={preview()}>
        {(p) => (
          <Compare aria-label={t`Se vestir`}>
            <CompareHead>
              <strong>{t`Se vestir`}</strong>
              <Verdict
                data-dir={
                  p().score > 1.005 ? "1" : p().score < 0.995 ? "-1" : "0"
                }
                title={t`A mesma nota do "escolher o melhor sozinho": dano por segundo, vida efetiva ou cura, pelo papel da classe.`}
              >
                {p().score > 1.005
                  ? t`▲ melhor para o seu papel (+${Math.round((p().score - 1) * 100)}%)`
                  : p().score < 0.995
                    ? t`▼ pior para o seu papel (${Math.round((p().score - 1) * 100)}%)`
                    : t`= quase igual`}
              </Verdict>
            </CompareHead>
            <For each={p().rows}>
              {(row) => (
                <Line>
                  <span>{derivedName(row.key)}</span>
                  <Delta
                    a={row.a}
                    b={row.b}
                    dir={row.dir}
                    fmt={(n) => derivedText(row.key, n)}
                  />
                </Line>
              )}
            </For>
            <Show when={!props.compact}>
              <Btn
                type="button"
                data-size="sm"
                data-tone="quiet"
                onClick={() => setAll(!all())}
              >
                {all() ? t`Mostrar só o principal` : t`Ver todos os números`}
              </Btn>
            </Show>
          </Compare>
        )}
      </Show>

      <Show when={props.actions}>
        <Actions>{props.actions}</Actions>
      </Show>
    </Card>
  );
}

/**
 * Uma grade de itens para escolher (vender, refinar, guardar): um toque seleciona; com `multi`,
 * marca vários. `mark` põe ▲/▼ (a comparação com o vestido); `note` escreve algo embaixo (preço).
 * `hero`: o detalhe de cada item ao parar o mouse em cima (ou no foco, ou no toque longo), com
 * `price` (o que o Mercador paga). `hint`: a dica do toque longo no celular (uma por tela).
 */
export function ItemGrid(props: {
  label: string;
  items: (ItemInstance & { uid: string })[];
  selected: string[];
  onToggle: (uid: string) => void;
  mark?: (uid: string) => "up" | "down" | "same" | "blocked" | undefined;
  note?: (it: ItemInstance & { uid: string }) => string | undefined;
  empty?: JSX.Element;
  hero?: HeroV5 | null;
  price?: (it: ItemInstance & { uid: string }) => number | undefined;
  hint?: boolean;
}) {
  return (
    <Show when={props.items.length > 0} fallback={props.empty}>
      <Grid role="listbox" aria-label={props.label} aria-multiselectable="true">
        <For each={props.items}>
          {(it) => (
            <ItemTip
              item={it}
              hero={props.hero ?? null}
              price={props.price?.(it)}
            >
              {(bind) => (
                <GridCell
                  {...(props.hero !== undefined ? bind : {})}
                  type="button"
                  role="option"
                  aria-selected={props.selected.includes(it.uid)}
                  aria-label={`${rarityName(it.rarity)} ${slotName(it.slot as GearSlot)} +${it.refine}${props.note?.(it) ? ` · ${props.note(it)}` : ""}`}
                  onClick={() => props.onToggle(it.uid)}
                >
                  <ItemIcon item={it} mark={props.mark?.(it.uid)} />
                  <Show when={props.note?.(it)}>
                    {(n) => <small>{n()}</small>}
                  </Show>
                </GridCell>
              )}
            </ItemTip>
          )}
        </For>
      </Grid>
      <Show when={props.hint && props.hero !== undefined}>
        <TouchHint />
      </Show>
    </Show>
  );
}

/** No celular (sem mouse): como ver o detalhe. Some onde há mouse. */
export function TouchHint() {
  const { t } = useLingui();
  return <Hint>{t`Toque e segure um item para ver os detalhes.`}</Hint>;
}

const Hint = styled("small", {
  base: {
    display: "none",
    fontSize: "0.78rem",
    color: "var(--md-sys-color-on-surface-variant)",
    "@media (hover: none)": { display: "block" },
  },
});

const Grid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))",
    gap: "4px",
  },
});
const GridCell = styled("button", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    minHeight: "56px",
    padding: "4px 2px",
    borderRadius: "8px",
    border: "1px solid transparent",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    "& > small": { fontSize: "0.68rem", fontVariantNumeric: "tabular-nums" },
    "&[aria-selected=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Card = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "12px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderTop: "3px solid var(--rc)",
    // No tooltip: mais apertado, para caber ao lado do item sem cobrir a tela.
    "&[data-compact]": { gap: "7px", padding: "10px" },
    // D68: a Suprema tem a borda de cima em sangue e fogo, e um brilho de brasa no fundo.
    "&[data-supreme]": {
      borderTop: "3px solid transparent",
      borderImage:
        "linear-gradient(90deg, #7a0606, #e0261a 35%, #ff8a2a 60%, #e0261a 85%, #7a0606) 1",
      borderImageSlice: "3 0 0 0",
      background:
        "radial-gradient(ellipse at 50% 0%, rgba(224,38,26,0.16), transparent 60%), var(--md-sys-color-surface-container)",
    },
  },
});
const SupremeLine = styled("span", {
  base: {
    fontSize: "0.85em",
    fontWeight: 700,
    color: "#ff7a3d",
    textShadow: "0 0 6px rgba(224, 38, 26, 0.55)",
  },
});
const Top = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "12px",
    alignItems: "center",
    "& > div": {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      minWidth: 0,
    },
  },
});
const Name = styled("strong", {
  base: { color: "var(--rc)", fontSize: "1.05rem", lineHeight: 1.2 },
});
const Meta = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    fontSize: "0.85em",
    "& > span:first-child": { color: "var(--rc)", fontWeight: 700 },
  },
});
const Req = styled("span", {
  base: {
    fontSize: "0.8em",
    color: "var(--md-sys-color-on-surface-variant)",
    "&[data-bad]": { color: "#ff8a7a", fontWeight: 700 },
  },
});
const Tag = styled("span", {
  base: {
    alignSelf: "flex-start",
    fontSize: "0.75rem",
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: "999px",
    background: "var(--md-sys-color-primary-container)",
    color: "var(--md-sys-color-on-primary-container)",
  },
});
const Blocked = styled("div", {
  base: { fontSize: "0.88em", color: "#ffcfc6" },
});
/** O aviso do peso acima: âmbar, como a penalidade que é (não o vermelho de "não veste"). */
const Heavy = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "0.86em",
    padding: "6px 8px",
    borderRadius: "8px",
    color: "#ffe1a8",
    background: "rgba(255, 184, 77, 0.1)",
    border: "1px solid rgba(255, 184, 77, 0.4)",
    "& b": { color: "#ffc46b" },
  },
});
const Lines = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "4px" },
});
const Line = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontVariantNumeric: "tabular-nums",
    fontSize: "0.92em",
    "&[data-affix] > span:first-child": { color: "#cfe3ff" },
    "&[data-lost] > span:first-child": {
      color: "var(--md-sys-color-on-surface-variant)",
      textDecoration: "line-through",
    },
    "&[data-price]": {
      paddingTop: "6px",
      borderTop: "1px solid var(--md-sys-color-outline-variant)",
      color: "var(--md-sys-color-on-surface-variant)",
    },
  },
});
/** D64: a faixa do sorteio do afixo, discreta ao lado do valor. */
const Range = styled("span", {
  base: {
    fontSize: "0.85em",
    color: "var(--md-sys-color-on-surface-variant)",
    whiteSpace: "nowrap",
  },
});
const Diff = styled("span", {
  base: {
    fontSize: "0.85em",
    color: "#ff8a7a",
    whiteSpace: "nowrap",
    "&[data-up]": { color: "#7ee08a" },
  },
});
const Legend = styled("div", {
  base: {
    color: "#ffa64d",
    fontSize: "0.92em",
    "&[data-off]": { opacity: 0.6 },
  },
});
const Compare = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px",
    borderRadius: "10px",
    background: "rgba(0,0,0,0.25)",
  },
});
const CompareHead = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "6px",
    marginBottom: "2px",
  },
});
const Verdict = styled("span", {
  base: {
    fontWeight: 700,
    fontSize: "0.9em",
    "&[data-dir='1']": { color: "#7ee08a" },
    "&[data-dir='-1']": { color: "#ff8a7a" },
  },
});
const Actions = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "8px" },
});
