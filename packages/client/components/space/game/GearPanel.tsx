import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type GearSlot,
  type HeroV5,
  type OwnedItem,
  type PotionSize,
  type RpgHeroState,
  FAMILIES,
  MATERIALS,
  buyBackPrice,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Search, searchText } from "./BankPanel";
import { ItemCard, TouchHint } from "./ItemCard";
import { ItemTip } from "./ItemTip";
import { rarityName, sizeName, slotName } from "./gameText";
import { RARITY } from "./gameTheme";
import {
  type GameLink,
  Btn,
  Confirm,
  ItemIcon,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  useCommands,
} from "./gameUi";
import {
  type BagMark,
  autoPlan,
  bagMarks,
  beltOptions,
  equippedIn,
  findItem,
  num,
} from "./heroModel";

/** Um item da prévia do "escolher o melhor": o detalhe ao parar em cima ou no foco (Tab). */
function SwapIcon(props: { item: OwnedItem; hero: HeroV5; mark?: BagMark }) {
  return (
    <ItemTip item={props.item} hero={props.hero}>
      {(bind) => (
        <ItemIcon
          {...bind}
          tabIndex={0}
          role="img"
          aria-label={`${rarityName(props.item.rarity)} ${slotName(props.item.slot as GearSlot)} +${props.item.refine}`}
          item={props.item}
          mark={props.mark}
        />
      )}
    </ItemTip>
  );
}

/** O corpo: colar, elmo e anel; arma, armadura e mão secundária; calças; botas. */
const DOLL: (GearSlot | null)[] = [
  "colar",
  "elmo",
  "anel",
  "arma",
  "armadura",
  "secundaria",
  null,
  "calcas",
  null,
  null,
  "botas",
  null,
];

type Sort = "melhor" | "lugar" | "raridade";
const RANK = { comum: 0, incomum: 1, raro: 2, epico: 3, lendario: 4 } as const;
const MARK_RANK: Record<BagMark, number> = {
  up: 0,
  same: 1,
  down: 2,
  blocked: 3,
};

/**
 * Equipamento e mochila (§9, D36): o que veste nos 8 lugares, a mochila sem limite (28/11/2026;
 * busca e páginas de 60) com ▲/▼ pela nota do papel, o detalhe com antes/depois e as ações; "escolher o melhor sozinho"
 * com a prévia do que vai trocar e a confirmação, um a um, do que esbarra num item +7 (§9.8); o
 * cinto com os 3 tamanhos de poção (D35) e quando beber.
 */
export function GearPanel(props: {
  link: GameLink;
  state: RpgHeroState;
  locked: boolean;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const h = () => props.state.hero;
  const [sel, setSel] = createSignal<string | null>(null);
  const [sort, setSort] = createSignal<Sort>("melhor");
  // A mochila não tem limite (28/11/2026): busca pelo nome e páginas de 60.
  const [query, setQuery] = createSignal("");
  const [shown, setShown] = createSignal(BAG_PAGE);
  const [plan, setPlan] = createSignal(false);
  const [ok, setOk] = createSignal<string | null>(null);

  const marks = createMemo(() => bagMarks(h()));
  const bag = createMemo(() => {
    const q = query().trim().toLocaleLowerCase("pt-BR");
    const list = q
      ? h().bag.filter((x) => searchText(x).includes(q))
      : [...h().bag];
    const m = marks();
    if (sort() === "melhor")
      list.sort(
        (a, b) =>
          MARK_RANK[m[a.uid]?.mark ?? "same"] -
            MARK_RANK[m[b.uid]?.mark ?? "same"] ||
          (m[b.uid]?.score ?? 0) - (m[a.uid]?.score ?? 0),
      );
    else if (sort() === "raridade")
      list.sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || b.ilvl - a.ilvl);
    else list.sort((a, b) => a.slot.localeCompare(b.slot) || b.ilvl - a.ilvl);
    return list;
  });
  const picked = createMemo(() => {
    const uid = sel();
    return uid ? findItem(h(), uid) : null;
  });
  const auto = createMemo(() => (plan() ? autoPlan(h()) : null));
  const visible = createMemo(() => bag().slice(0, shown()));

  const act = async (
    type: string,
    d: Record<string, unknown>,
    done: string,
  ) => {
    setOk(null);
    const r = await cmd.run(type, d);
    if (r?.ok) setOk(done);
    return r?.ok ?? false;
  };

  return (
    <Wrap>
      <Layout>
        <Side>
          <Section aria-label={t`Vestido`} style={{ order: 1 }}>
            <h3>{t`Vestido`}</h3>
            <Doll>
              <For each={DOLL}>
                {(slot) => (
                  <Show when={slot} fallback={<span />}>
                    {(s) => {
                      const it = () => equippedIn(h(), s());
                      return (
                        <ItemTip item={it()} hero={h()}>
                          {(bind) => (
                            <SlotBtn
                              {...bind}
                              type="button"
                              aria-pressed={!!it() && sel() === it()!.uid}
                              aria-label={
                                it()
                                  ? t`${slotName(s())}: ${rarityName(it()!.rarity)}, +${it()!.refine}`
                                  : t`${slotName(s())}: vazio`
                              }
                              onClick={() => it() && setSel(it()!.uid)}
                              data-empty={it() ? undefined : ""}
                            >
                              <Show
                                when={it()}
                                fallback={<Empty>{slotName(s())}</Empty>}
                              >
                                {(x) => <ItemIcon item={x()} />}
                              </Show>
                            </SlotBtn>
                          )}
                        </ItemTip>
                      );
                    }}
                  </Show>
                )}
              </For>
            </Doll>
          </Section>
          <Slot style={{ order: 6 }}>
            <Belt link={props.link} state={props.state} locked={props.locked} />
          </Slot>
          <Slot style={{ order: 7 }}>
            <Wallet state={props.state} />
          </Slot>
        </Side>

        <Main>
          <Section aria-label={t`Mochila`} style={{ order: 2 }}>
            <BagHead>
              <h3>
                {t`Mochila`}{" "}
                <Count>
                  {query().trim()
                    ? t`${bag().length} de ${h().bag.length}`
                    : h().bag.length === 1
                      ? t`1 item`
                      : t`${h().bag.length} itens`}
                </Count>
              </h3>
              <Row>
                <label>
                  <Muted>{t`Ordem`} </Muted>
                  <Select
                    value={sort()}
                    onChange={(e) => setSort(e.currentTarget.value as Sort)}
                  >
                    <option value="melhor">{t`Melhorias primeiro`}</option>
                    <option value="lugar">{t`Por lugar`}</option>
                    <option value="raridade">{t`Por raridade`}</option>
                  </Select>
                </label>
              </Row>
            </BagHead>
            <Show when={h().bag.length > BAG_PAGE}>
              <Search
                type="search"
                value={query()}
                placeholder={t`Buscar na mochila (nome, lugar, perk…)`}
                aria-label={t`Buscar na mochila`}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setShown(BAG_PAGE);
                }}
              />
            </Show>
            <Grid role="list">
              <For each={visible()}>
                {(it) => (
                  <ItemTip item={it} hero={h()} price={buyBackPrice(it)}>
                    {(bind) => (
                      <Cell
                        {...bind}
                        type="button"
                        role="listitem"
                        aria-pressed={sel() === it.uid}
                        aria-label={`${rarityName(it.rarity)} ${slotName(it.slot as GearSlot)} +${it.refine}${
                          marks()[it.uid]?.mark === "up"
                            ? ` — ${t`melhor que o vestido`}`
                            : marks()[it.uid]?.mark === "blocked"
                              ? ` — ${t`não dá para vestir`}`
                              : ""
                        }`}
                        data-blocked={
                          marks()[it.uid]?.mark === "blocked" ? "" : undefined
                        }
                        onClick={() => setSel(it.uid)}
                      >
                        <ItemIcon item={it} mark={marks()[it.uid]?.mark} />
                      </Cell>
                    )}
                  </ItemTip>
                )}
              </For>
            </Grid>
            <Show when={bag().length > visible().length}>
              <Btn
                type="button"
                data-tone="quiet"
                onClick={() => setShown(shown() + BAG_PAGE)}
              >
                {t`Mostrar mais (${bag().length - visible().length})`}
              </Btn>
            </Show>
            <Legend>
              <span>
                <b style={{ color: "#7ee08a" }}>▲</b>{" "}
                {t`melhor para o seu papel`}
              </span>
              <span>
                <b style={{ color: "#ff8a7a" }}>▼</b> {t`pior`}
              </span>
              <span>
                {RARITY.incomum.pips} {RARITY.raro.pips} {RARITY.epico.pips}{" "}
                {RARITY.lendario.pips} {t`raridade`}
              </span>
            </Legend>
            <TouchHint />
          </Section>

          <Slot style={{ order: 3 }}>
            <Notice error={cmd.error()} ok={ok()} />
          </Slot>

          <Slot style={{ order: 4 }}>
            <Show when={picked()}>
              {(p) => (
                <ItemCard
                  hero={h()}
                  item={p().item}
                  actions={
                    <Show
                      when={p().where === "bag"}
                      fallback={
                        <Btn
                          type="button"
                          disabled={props.locked || cmd.busy()}
                          onClick={() =>
                            act(
                              "rpg.unequip",
                              { slot: p().item.slot },
                              t`Guardado na mochila.`,
                            )
                          }
                        >
                          {t`Tirar`}
                        </Btn>
                      }
                    >
                      <Btn
                        type="button"
                        data-tone="primary"
                        disabled={
                          props.locked ||
                          cmd.busy() ||
                          marks()[p().item.uid]?.mark === "blocked"
                        }
                        onClick={() =>
                          act("rpg.equip", { uid: p().item.uid }, t`Vestido.`)
                        }
                      >
                        {t`Vestir`}
                      </Btn>
                      <Confirm
                        tone="danger"
                        steps={p().item.refine >= 7 ? 2 : 1}
                        disabled={props.locked || cmd.busy()}
                        label={t`Descartar`}
                        confirm={t`Descartar para sempre?`}
                        confirm2={t`É +${p().item.refine}: toque mais uma vez`}
                        onConfirm={async () => {
                          if (
                            await act(
                              "rpg.discard",
                              { uid: p().item.uid },
                              t`Descartado.`,
                            )
                          )
                            setSel(null);
                        }}
                      />
                    </Show>
                  }
                />
              )}
            </Show>
          </Slot>
          <Section
            aria-label={t`Escolher o melhor sozinho`}
            style={{ order: 5 }}
          >
            <h3>{t`Escolher o melhor sozinho`}</h3>
            <Row>
              <Toggle>
                <input
                  type="checkbox"
                  checked={h().autoEquip}
                  disabled={props.locked || cmd.busy()}
                  onChange={(e) =>
                    act(
                      "rpg.autoequip",
                      { on: e.currentTarget.checked },
                      e.currentTarget.checked
                        ? t`Depois de cada corrida o herói veste o que for melhor.`
                        : t`Desligado: você escolhe o que vestir.`,
                    )
                  }
                />
                <span>{t`Ligado depois de cada corrida`}</span>
              </Toggle>
              <Btn
                type="button"
                disabled={props.locked}
                onClick={() => setPlan(!plan())}
              >
                {plan() ? t`Fechar a prévia` : t`Ver o que trocaria agora`}
              </Btn>
            </Row>
            <Muted>
              {t`Compara pela mesma conta do combate (dano contra o chefe do nível, vida efetiva ou cura). Não mexe em colar e anel, e nunca tira um item +7 ou mais sem você confirmar.`}
            </Muted>
            <Show when={auto()}>
              {(a) => (
                <Panel>
                  <Show
                    when={a().changes.length > 0 || a().confirm.length > 0}
                    fallback={
                      <Muted>{t`Nada a trocar: já está com o melhor da mochila.`}</Muted>
                    }
                  >
                    <For each={a().changes}>
                      {(c) => (
                        <Swap>
                          <span>{slotName(c.slot)}</span>
                          <Show
                            when={c.from}
                            fallback={<Muted>{t`vazio`}</Muted>}
                          >
                            {(f) => <SwapIcon item={f()} hero={h()} />}
                          </Show>
                          <span aria-hidden="true">→</span>
                          <SwapIcon item={c.to} hero={h()} mark="up" />
                        </Swap>
                      )}
                    </For>
                    <Show when={a().changes.length > 0}>
                      <Btn
                        type="button"
                        data-tone="primary"
                        disabled={props.locked || cmd.busy()}
                        onClick={async () => {
                          if (
                            await act(
                              "rpg.autoequip",
                              { apply: true },
                              t`Trocado: ${a().changes.length} peças.`,
                            )
                          )
                            setPlan(false);
                        }}
                      >
                        {t`Aplicar ${a().changes.length} trocas`}
                      </Btn>
                    </Show>
                    <For each={a().confirm}>
                      {(c) => (
                        <Swap data-risky="">
                          <span>
                            {slotName(c.slot)}{" "}
                            <strong>+{c.current.refine}</strong>
                          </span>
                          <SwapIcon item={c.current} hero={h()} />
                          <span aria-hidden="true">→</span>
                          <SwapIcon item={c.candidate} hero={h()} mark="up" />
                          <Confirm
                            size="sm"
                            disabled={props.locked || cmd.busy()}
                            label={t`Trocar mesmo assim`}
                            confirm={t`Tirar o +${c.current.refine}? Toque de novo`}
                            onConfirm={() =>
                              act(
                                "rpg.equip",
                                { uid: c.candidate.uid },
                                t`Trocado.`,
                              )
                            }
                          />
                        </Swap>
                      )}
                    </For>
                  </Show>
                </Panel>
              )}
            </Show>
          </Section>
        </Main>
      </Layout>
    </Wrap>
  );
}

/** O cinto (D35): o tamanho de vida e o de mana que vão na corrida, e quando beber. */
function Belt(props: { link: GameLink; state: RpgHeroState; locked: boolean }) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const h = () => props.state.hero;
  const [hp, setHp] = createSignal(h().supplies.hp);
  const [mp, setMp] = createSignal(h().supplies.mp);
  const saveSupplies = () => {
    if (hp() === h().supplies.hp && mp() === h().supplies.mp) return;
    void cmd.run("rpg.supplies", { hp: hp(), mp: mp() });
  };
  const kinds = [
    { kind: "hp" as const, label: () => t`Vida` },
    { kind: "mp" as const, label: () => t`Mana` },
  ];
  return (
    <Section aria-label={t`Cinto`}>
      <h3>{t`Cinto de poções`}</h3>
      <For each={kinds}>
        {(k) => {
          const opts = () => beltOptions(h(), k.kind);
          const on = () => opts().find((o) => o.equipped)!;
          return (
            <Panel>
              <Row>
                <strong>{k.label()}</strong>
                <Muted>
                  {t`cura ${num(on().heal)} a cada ${on().cooldownS} s`}
                </Muted>
              </Row>
              <Sizes
                role="radiogroup"
                aria-label={t`Tamanho da poção de ${k.label()}`}
              >
                <For each={opts()}>
                  {(o) => (
                    <SizeBtn
                      type="button"
                      role="radio"
                      aria-checked={o.equipped}
                      disabled={props.locked || cmd.busy()}
                      onClick={() =>
                        !o.equipped &&
                        void cmd.run("rpg.belt", {
                          kind: k.kind,
                          size: o.size as PotionSize,
                        })
                      }
                    >
                      <span>{sizeName(o.size)}</span>
                      <strong data-zero={o.stock === 0 ? "" : undefined}>
                        ×{o.stock}
                      </strong>
                      <small>
                        {num(o.heal)} · {o.cooldownS}s
                      </small>
                    </SizeBtn>
                  )}
                </For>
              </Sizes>
              <Show when={on().stock === 0}>
                <Warn role="note">
                  {t`Nenhuma poção ${sizeName(on().size).toLowerCase()} no cinto: compre no Mercador ou troque o tamanho.`}
                </Warn>
              </Show>
              <Slider>
                <span>
                  {t`Beber abaixo de`}{" "}
                  <strong>
                    {Math.round((k.kind === "hp" ? hp() : mp()) * 100)}%
                  </strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={k.kind === "hp" ? hp() : mp()}
                  disabled={props.locked}
                  aria-label={t`Beber ${k.label()} abaixo de`}
                  onInput={(e) =>
                    (k.kind === "hp" ? setHp : setMp)(
                      Number(e.currentTarget.value),
                    )
                  }
                  onChange={saveSupplies}
                />
              </Slider>
            </Panel>
          );
        }}
      </For>
      <Muted>
        {t`Os três tamanhos curam o mesmo por segundo: a grande cura mais de uma vez, mas demora mais para a próxima.`}
      </Muted>
      <Notice error={cmd.error()} />
    </Section>
  );
}

/** O que não ocupa espaço (D36): ouro, minérios, pedras, essência e munição. */
function Wallet(props: { state: RpgHeroState }) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const ores = () => MATERIALS.filter((m) => (h().ores[m] ?? 0) > 0);
  const ranged = () => {
    const f = h().equipment.arma?.family;
    return !!f && FAMILIES[f].kind === "ranged";
  };
  return (
    <Section aria-label={t`Sem espaço na mochila`}>
      <h3>{t`Consumíveis`}</h3>
      <Facts>
        <Show
          when={ores().length > 0}
          fallback={<Muted>{t`Sem minérios.`}</Muted>}
        >
          <For each={ores()}>
            {(m) => (
              <span>
                {t`Minério de ${m}`}: <strong>{h().ores[m]}</strong>
              </span>
            )}
          </For>
        </Show>
        <span>
          {t`Pedras de Proteção`}: <strong>{h().stones}</strong>
        </span>
        <Show when={h().essence > 0}>
          <span>
            {t`Essência`}: <strong>{h().essence}</strong>
          </span>
        </Show>
        <Show
          when={ranged() || Object.values(h().ammo).some((n) => (n ?? 0) > 0)}
        >
          <span>
            {t`Munição`}: {t`comum`} <strong>{h().ammo.comum ?? 0}</strong> ·{" "}
            {t`afiada`} <strong>{h().ammo.afiada ?? 0}</strong> · {t`rúnica`}{" "}
            <strong>{h().ammo.runica ?? 0}</strong>
          </span>
        </Show>
      </Facts>
    </Section>
  );
}

const Wrap = styled("div", { base: { paddingTop: "8px" } });
const Layout = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 300px) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    "@container (max-width: 680px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});
const Side = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    "@container (max-width: 680px)": { display: "contents" },
  },
});
/** Um item da coluna com ordem própria no celular. */
const Slot = styled("div", { base: { minWidth: 0 } });
const Main = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    minWidth: 0,
    "@container (max-width: 680px)": { display: "contents" },
  },
});
const Doll = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 56px)",
    justifyContent: "center",
    gap: "6px",
  },
});
const SlotBtn = styled("button", {
  base: {
    width: "56px",
    height: "56px",
    display: "grid",
    placeItems: "center",
    borderRadius: "10px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "rgba(0,0,0,0.25)",
    color: "inherit",
    cursor: "pointer",
    padding: 0,
    "&[data-empty]": { cursor: "default", borderStyle: "dashed" },
    "&[aria-pressed=true]": {
      outline: "2px solid var(--md-sys-color-primary)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
const Empty = styled("span", {
  base: {
    fontSize: "0.62rem",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
    lineHeight: 1.1,
    padding: "2px",
  },
});
/** Itens por página na mochila (sem limite desde 28/11/2026). */
const BAG_PAGE = 60;

const BagHead = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
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
const Count = styled("span", {
  base: {
    letterSpacing: 0,
    color: "var(--md-sys-color-on-surface)",
    "&[data-full]": { color: "#ff8a7a" },
  },
});
const Select = styled("select", {
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
const Grid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
    gap: "4px",
  },
});
const Cell = styled("button", {
  base: {
    aspectRatio: "1",
    minHeight: "48px",
    display: "grid",
    placeItems: "center",
    borderRadius: "8px",
    border: "1px solid transparent",
    background: "rgba(0,0,0,0.22)",
    padding: 0,
    cursor: "pointer",
    "&[aria-pressed=true]": {
      outline: "2px solid var(--md-sys-color-primary)",
    },
    "&[data-blocked] > span": { opacity: 0.45, filter: "grayscale(0.6)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
const Legend = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    fontSize: "0.78rem",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
const Toggle = styled("label", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "44px",
    cursor: "pointer",
    "& > input": { width: "20px", height: "20px", accentColor: "#d9b45a" },
  },
});
const Swap = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    "& > span:first-child": { minWidth: "7em", fontSize: "0.9em" },
    "&[data-risky]": {
      padding: "6px",
      borderRadius: "8px",
      background: "rgba(255, 138, 122, 0.08)",
    },
  },
});
const Sizes = styled("div", {
  base: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px" },
});
const SizeBtn = styled("button", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1px",
    minHeight: "56px",
    padding: "4px",
    borderRadius: "10px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "rgba(0,0,0,0.25)",
    color: "inherit",
    font: "inherit",
    fontSize: "0.85em",
    cursor: "pointer",
    "& > small": {
      fontSize: "0.72em",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& > strong[data-zero]": { color: "#ff8a7a" },
    "&[aria-checked=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
      boxShadow: "inset 0 0 0 1px var(--md-sys-color-primary)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
    "&:disabled": { opacity: 0.5 },
  },
});
const Warn = styled("div", { base: { fontSize: "0.85em", color: "#ffcfc6" } });
const Slider = styled("label", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "0.85em",
    "& > input": { width: "100%", minHeight: "32px", accentColor: "#d9b45a" },
  },
});
const Facts = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "0.88em",
    fontVariantNumeric: "tabular-nums",
  },
});
