import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type GearSlot,
  type HeroV5,
  type OwnedItem,
  type RpgHeroState,
  buyBackPrice,
  itemTooltip,
  planTransfer,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ItemGrid } from "./ItemCard";
import { ItemTip } from "./ItemTip";
import { errorText, rarityName, slotName } from "./gameText";
import { RARITY } from "./gameTheme";
import {
  type GameLink,
  Btn,
  Confirm,
  Gold,
  ItemIcon,
  Muted,
  Notice,
  Panel,
  Row,
  Tabs,
  useCommands,
} from "./gameUi";
import { type BagMark, bagMarks, cannotWear, gold } from "./heroModel";

type RunFn = (
  type: string,
  d: Record<string, unknown>,
  done: string,
) => Promise<boolean>;

/**
 * A Mula (28/11/2026, antes o Banqueiro): leva ouro e itens da mochila para outra pessoa do Espaço,
 * com taxa e registro. O cofre de ouro e de itens saiu (a mochila não tem limite; o que estava
 * guardado foi para a mochila e para a mão na primeira leitura do herói). O NPC segue o mesmo no mapa
 * (`npc-banqueiro`, tipo `banqueiro`): só o nome, o desenho e o painel mudaram.
 *
 * As peças da grade (`Stash`, `marksOf`, `searchText` e os estilos) ficam aqui: o baú compartilhado
 * e a mochila da ficha usam as mesmas.
 */
export function MulePanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
  people: { id: string; name: string }[];
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [ok, setOk] = createSignal<string | null>(null);
  const h = () => props.state.hero;
  const run = async (
    type: string,
    d: Record<string, unknown>,
    done: string,
  ) => {
    setOk(null);
    const r = await cmd.run(type, { npc: props.npc, ...d });
    if (r?.ok) setOk(done);
    return !!r?.ok;
  };
  return (
    <Wrap>
      <Ledger aria-label={t`Resumo da Mula`}>
        <Stat>
          <small>{t`Ouro na mão`}</small>
          <Gold n={gold(h().gold)} />
        </Stat>
        <Stat>
          <small>{t`Mochila`}</small>
          <strong>
            {h().bag.length === 1 ? t`1 item` : t`${h().bag.length} itens`}
          </strong>
        </Stat>
      </Ledger>
      <Notice error={cmd.error()} ok={ok()} />
      <TransferBox
        state={props.state}
        people={props.people}
        busy={cmd.busy()}
        run={run}
      />
    </Wrap>
  );
}

// ------------------------------------------------------------ a grade (o baú e a mochila usam)

export type Marks = Record<string, { mark: BagMark; score: number }>;

/**
 * ▲/▼ de itens fora da mochila (o baú) pela mesma nota da mochila, em pedaços de 32. ~0,5 ms por
 * item: só o que aparece.
 */
export function marksOf(h: HeroV5, items: OwnedItem[]): Marks {
  const out: Marks = {};
  for (let i = 0; i < items.length; i += 32)
    Object.assign(out, bagMarks({ ...h, bag: items.slice(i, i + 32) }));
  return out;
}

const searchCache = new WeakMap<OwnedItem, string>();
export function searchText(it: OwnedItem): string {
  let s = searchCache.get(it);
  if (s === undefined) {
    const tip = itemTooltip(it);
    s = [
      tip.name,
      tip.kind,
      rarityName(it.rarity),
      slotName(it.slot as GearSlot),
      ...(tip.perks ?? []).map((p) => p.text),
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    searchCache.set(it, s);
  }
  return s;
}

/**
 * A grade do baú: toque escolhe (vários), Shift + clique escolhe o trecho desde o último, clique
 * duplo move na hora. ▲/▼ e o selo NOVO no canto; o detalhe ao parar em cima (ou toque longo).
 */
export function Stash(props: {
  label: string;
  items: OwnedItem[];
  selected: string[];
  onSelect: (uids: string[]) => void;
  onQuick: (uid: string) => void;
  marks?: Marks;
  isNew?: (uid: string) => boolean;
  /** Um selo curto no canto de baixo (o baú: quanto falta para o item sumir). */
  tag?: (uid: string) => string | undefined;
  hero: HeroV5;
}) {
  const { t } = useLingui();
  let anchor: string | null = null;
  const click = (uid: string, e: MouseEvent) => {
    const sel = props.selected;
    if (e.shiftKey && anchor) {
      const ids = props.items.map((x) => x.uid);
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(uid);
      if (a >= 0 && b >= 0) {
        const span = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        props.onSelect([...new Set([...sel, ...span])]);
        return;
      }
    }
    anchor = uid;
    props.onSelect(
      sel.includes(uid) ? sel.filter((x) => x !== uid) : [...sel, uid],
    );
  };
  return (
    <StashGrid
      role="listbox"
      aria-label={props.label}
      aria-multiselectable="true"
    >
      <For each={props.items}>
        {(it) => {
          const mark = () => props.marks?.[it.uid]?.mark;
          const fresh = () => props.isNew?.(it.uid) ?? false;
          return (
            <ItemTip item={it} hero={props.hero} price={buyBackPrice(it)}>
              {(bind) => (
                <Cell
                  {...bind}
                  type="button"
                  role="option"
                  aria-selected={props.selected.includes(it.uid)}
                  aria-label={`${rarityName(it.rarity)} ${slotName(it.slot as GearSlot)} +${it.refine}${
                    mark() === "up"
                      ? ` — ${t`melhor que o vestido`}`
                      : mark() === "blocked"
                        ? ` — ${t`não dá para vestir`}`
                        : ""
                  }${fresh() ? ` — ${t`novo`}` : ""}`}
                  data-blocked={mark() === "blocked" ? "" : undefined}
                  onClick={(e) => click(it.uid, e)}
                  onDblClick={() => props.onQuick(it.uid)}
                >
                  <ItemIcon
                    item={it}
                    mark={mark() === "blocked" ? undefined : mark()}
                  />
                  <Show when={fresh()}>
                    <New aria-hidden="true">{t`NOVO`}</New>
                  </Show>
                  <Show when={props.selected.includes(it.uid)}>
                    <Check aria-hidden="true">✓</Check>
                  </Show>
                  <Show when={props.tag?.(it.uid)}>
                    {(tag) => <Corner aria-hidden="true">{tag()}</Corner>}
                  </Show>
                </Cell>
              )}
            </ItemTip>
          );
        }}
      </For>
    </StashGrid>
  );
}

// ------------------------------------------------------------ transferência

function TransferBox(props: {
  state: RpgHeroState;
  people: { id: string; name: string }[];
  busy: boolean;
  run: RunFn;
}) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const [to, setTo] = createSignal("");
  const [amount, setAmount] = createSignal(0);
  const [sel, setSel] = createSignal<string[]>([]);
  const items = () => h().bag.filter((x) => sel().includes(x.uid));
  const risky = () => items().some((x) => x.refine >= 7);
  const plan = createMemo(() =>
    planTransfer({
      from: "eu",
      to: to() || "ninguem",
      gold: amount(),
      items: items(),
      balance: h().gold,
      confirmations: 2,
    }),
  );
  const who = () => props.people.find((p) => p.id === to())?.name ?? "";
  return (
    <>
      <Show
        when={props.people.length > 0}
        fallback={
          <Muted>{t`Ninguém no Espaço agora para receber. A pessoa precisa estar aqui.`}</Muted>
        }
      >
        <Panel>
          <label>
            <Muted>{t`Para`} </Muted>
            <Select value={to()} onChange={(e) => setTo(e.currentTarget.value)}>
              <option value="">{t`Escolha a pessoa`}</option>
              <For each={props.people}>
                {(p) => <option value={p.id}>{p.name}</option>}
              </For>
            </Select>
          </label>
          <Row>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={amount() || ""}
              placeholder={t`Ouro`}
              aria-label={t`Quanto ouro mandar`}
              onInput={(e) =>
                setAmount(
                  Math.max(0, Math.floor(Number(e.currentTarget.value)) || 0),
                )
              }
            />
            <Muted>{t`e até 20 itens da mochila:`}</Muted>
          </Row>
          <ItemGrid
            label={t`Itens para mandar`}
            items={h().bag}
            selected={sel()}
            onToggle={(u) =>
              setSel(
                sel().includes(u)
                  ? sel().filter((x) => x !== u)
                  : sel().length < 20
                    ? [...sel(), u]
                    : sel(),
              )
            }
            empty={<Muted>{t`A mochila está vazia.`}</Muted>}
            hero={h()}
            price={buyBackPrice}
            hint
          />
          <Show
            when={plan().ok ? plan() : null}
            fallback={
              <Muted>
                {!plan().ok &&
                (plan() as { error: string }).error !== "valor-invalido"
                  ? errorText((plan() as { error: string }).error)
                  : t`Escolha ouro ou itens para mandar.`}
              </Muted>
            }
          >
            {(p) => {
              const pl = () =>
                (p() as Extract<ReturnType<typeof planTransfer>, { ok: true }>)
                  .plan;
              return (
                <Summary>
                  <span>
                    {t`Chega para ${who() || "…"}`}:{" "}
                    <Gold n={gold(pl().credit)} />
                    {items().length > 0
                      ? ` + ${items().length} ${t`itens`}`
                      : ""}
                  </span>
                  <span>
                    {t`Taxa`}: <Gold n={gold(pl().fee)} />
                  </span>
                  <span>
                    {t`Sai da sua mão`}: <Gold n={gold(pl().debit)} />
                  </span>
                </Summary>
              );
            }}
          </Show>
          <Confirm
            tone="primary"
            steps={risky() ? 2 : 1}
            disabled={props.busy || !!props.state.run || !to() || !plan().ok}
            label={t`Transferir`}
            confirm={t`Mandar para ${who()}? Não dá para desfazer`}
            confirm2={t`Tem item +7: confirme mais uma vez`}
            onConfirm={() =>
              void props
                .run(
                  "rpg.bank.transfer",
                  {
                    to: to(),
                    gold: amount(),
                    uids: sel(),
                    confirmations: risky() ? 2 : 1,
                  },
                  t`Transferido para ${who()}.`,
                )
                .then((o) => {
                  if (!o) return;
                  setAmount(0);
                  setSel([]);
                })
            }
          />
          <Show
            when={props.state.run}
            fallback={
              <Muted>{t`Fica tudo no registro de transferências.`}</Muted>
            }
          >
            <Muted role="note">{t`Transferir fica para quando a corrida acabar.`}</Muted>
          </Show>
        </Panel>
      </Show>
    </>
  );
}

// ------------------------------------------------------------ estilos

export const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "12px" },
});
export const Ledger = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "6px",
    "@container (max-width: 600px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
});
export const Stat = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "rgba(0,0,0,0.28)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    fontVariantNumeric: "tabular-nums",
    "& > small": {
      fontSize: "0.72rem",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& > strong": { fontSize: "1rem" },
    "&[data-warn]": { borderColor: "#ff8a7a" },
    "&[data-warn] > strong": { color: "#ffb3a8" },
  },
});
export const Meter = styled("span", {
  base: {
    display: "block",
    height: "4px",
    borderRadius: "2px",
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    "& > span": {
      display: "block",
      height: "100%",
      background: "var(--md-sys-color-primary)",
    },
  },
});
/** A linha de estado da barra de mover: dica, "cabem N", o que foi movido (com Desfazer) ou o erro. */
export const Status = styled("div", {
  base: {
    flexBasis: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "30px",
    padding: "0 4px 0 10px",
    borderRadius: "8px",
    fontSize: "0.88em",
    color: "var(--md-sys-color-on-surface-variant)",
    "& > span": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    "&[data-kind=ok]": {
      background: "rgba(126, 224, 138, 0.1)",
      color: "#cdf5d3",
    },
    "&[data-kind=warn]": { color: "#ffd8a0" },
    "&[data-kind=error]": {
      background: "rgba(255, 138, 122, 0.12)",
      color: "#ffcfc6",
    },
    "@container (max-width: 600px)": {
      "& > span": { whiteSpace: "normal" },
    },
  },
});
export const Panes = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "12px",
    "@container (min-width: 760px)": {
      gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)",
    },
  },
});
export const Pane = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
    padding: "10px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
  },
});
export const PaneHead = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    "& > h3": {
      margin: 0,
      fontSize: "0.8rem",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--md-sys-color-on-surface-variant)",
    },
  },
});
export const Count = styled("span", {
  base: {
    fontVariantNumeric: "tabular-nums",
    "&[data-full]": { color: "#ff8a7a" },
  },
});
export const Chips = styled("div", {
  base: {
    display: "flex",
    gap: "4px",
    overflowX: "auto",
    scrollbarWidth: "none",
    paddingBottom: "2px",
  },
});
export const Chip = styled("button", {
  base: {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "30px",
    padding: "2px 10px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    font: "inherit",
    fontSize: "0.85rem",
    cursor: "pointer",
    touchAction: "manipulation",
    "& > small": {
      fontVariantNumeric: "tabular-nums",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& > b": { color: "var(--rc)", fontSize: "0.75rem", letterSpacing: "-1px" },
    "&[aria-pressed=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    "&[data-rarity][aria-pressed=true]": { borderColor: "var(--rc)" },
    "&[data-new]": { borderColor: "#7ee08a" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
    "@media (pointer: coarse)": { minHeight: "40px" },
  },
});
export const Search = styled("input", {
  base: {
    minHeight: "36px",
    padding: "0 10px",
    borderRadius: "8px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface)",
    color: "inherit",
    font: "inherit",
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
});
const StashGrid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
    gap: "4px",
  },
});
const Cell = styled("button", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    minHeight: "52px",
    padding: "4px 2px",
    borderRadius: "8px",
    border: "1px solid transparent",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    touchAction: "manipulation",
    userSelect: "none",
    "&[aria-selected=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
    },
    "&[data-blocked] > span:first-child": {
      opacity: 0.45,
      filter: "grayscale(0.6)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
const New = styled("span", {
  base: {
    // Em cima da borda, no meio: não cobre os marcadores de raridade (canto) nem o ▲ (outro canto).
    position: "absolute",
    top: "-5px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "0 3px",
    borderRadius: "4px",
    fontSize: "8px",
    fontWeight: 800,
    lineHeight: "12px",
    background: "#2f6b3a",
    color: "#dfffe4",
    pointerEvents: "none",
  },
});
const Check = styled("span", {
  base: {
    position: "absolute",
    bottom: "1px",
    left: "3px",
    fontSize: "11px",
    fontWeight: 800,
    color: "var(--md-sys-color-primary)",
    textShadow: "0 0 2px #000, 0 0 2px #000",
    pointerEvents: "none",
  },
});
const Corner = styled("span", {
  base: {
    position: "absolute",
    left: "2px",
    bottom: "2px",
    padding: "0 3px",
    borderRadius: "4px",
    fontSize: "10px",
    lineHeight: "14px",
    fontWeight: 700,
    background: "rgba(10, 10, 16, 0.78)",
    color: "#ffd27a",
    pointerEvents: "none",
  },
});

export const Empty = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    padding: "16px 4px",
  },
});
export const Tip = styled("small", {
  base: {
    fontSize: "0.75rem",
    color: "var(--md-sys-color-on-surface-variant)",
    "@media (hover: none)": { display: "none" },
  },
});
export const MoveBar = styled("div", {
  base: {
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "10px",
    borderRadius: "12px",
    background: "rgba(20, 18, 15, 0.96)",
    border: "1px solid var(--md-sys-color-outline)",
    boxShadow: "0 -6px 16px rgba(0,0,0,0.45)",
    // No celular a barra só aparece com algo escolhido, e os dois botões dividem a linha.
    "@container (max-width: 600px)": {
      padding: "8px",
      "&[data-idle]": { display: "none" },
      "& > button": { flex: "1 1 0", minWidth: 0 },
    },
  },
});
export const Long = styled("span", {
  base: { "@container (max-width: 600px)": { display: "none" } },
});
export const Short = styled("span", {
  base: {
    display: "none",
    "@container (max-width: 600px)": { display: "inline" },
  },
});
export const Input = styled("input", {
  base: {
    width: "10em",
    minHeight: "40px",
    padding: "0 10px",
    borderRadius: "8px",
    border: "1px solid var(--md-sys-color-outline)",
    background: "var(--md-sys-color-surface)",
    color: "inherit",
    font: "inherit",
    fontVariantNumeric: "tabular-nums",
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
});
export const Select = styled("select", {
  base: {
    minHeight: "36px",
    borderRadius: "8px",
    background: "var(--md-sys-color-surface)",
    color: "inherit",
    border: "1px solid var(--md-sys-color-outline)",
    font: "inherit",
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
});
const Summary = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "8px",
    background: "rgba(0,0,0,0.25)",
    fontVariantNumeric: "tabular-nums",
    "&[data-bad]": { color: "#ffcfc6" },
  },
});
