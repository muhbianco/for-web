import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import {
  type ItemStack,
  type RpgHeroView,
  type RunSupplies,
  type Slot,
  COINS,
  DEFAULT_SUPPLIES,
  SKILLS,
  VOCATIONS,
  cannotUse,
  expForLevel,
  itemDef,
  potionDefs,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  SLOT_ICON,
  coinAction,
  inventoryError,
  itemIcon,
  itemLines,
  itemName,
  oz,
  slotLabels,
} from "./itemUi";
import { useModalKeys } from "./modalKeys";
import { percent, rpgLabels, vocationName } from "./rpgUi";

/** O corpo como no OT: colar, cabeça e mochila; arma, corpo e escudo; anel, pernas e munição; pés. */
const DOLL: readonly (Slot | null)[] = [
  "colar",
  "cabeca",
  "mochila",
  "arma",
  "corpo",
  "escudo",
  "anel",
  "pernas",
  "municao",
  null,
  "pes",
  null,
];

type Pick =
  | { where: "slot"; slot: Slot }
  | { where: "pack"; index: number; item: string };

/**
 * A ficha do herói (docs/espaco/jogo/ot, etapa O7): o que veste nos 10 lugares, a mochila com
 * os espaços, peso e capacidade, moedas, skills e "escolher o melhor sozinho". Tudo pelo
 * servidor: cada ação manda um comando e a ficha muda com o estado que volta.
 */
export default function HeroSheet(props: {
  view: SpaceView;
  rpg: { hero: RpgHeroView | null; serverNow: number; at: number };
  name: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const S = slotLabels();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [pick, setPick] = createSignal<Pick | null>(null);
  const [confirmDrop, setConfirmDrop] = createSignal(false);
  let card: HTMLDivElement | undefined;
  let title: HTMLHeadingElement | undefined;
  const refocus = useModalKeys(
    () => card,
    () => title,
    () => props.onClose(),
  );
  const hero = () => props.rpg.hero;
  const inv = () => hero()?.inventory ?? { equip: {}, pack: [] };
  const base = () => VOCATIONS[hero()?.vocation ?? 0].base;
  const inRun = () => !!hero()?.run;

  // Uma resposta por comando: estado (sucesso) ou erro, pelo `re`.
  let pending: { id: string } | null = null;
  const off = props.view.onGame((e: GameWireEvent) => {
    if (!pending || e.re !== pending.id) return;
    pending = null;
    setBusy(false);
    setConfirmDrop(false);
    queueMicrotask(refocus);
    if (e.t === "error") {
      const d = e.d as { code?: string; reason?: string };
      setError(
        inventoryError(d.reason) ?? L.error(d.code ?? "internal", d.reason),
      );
      return;
    }
    // A mochila mudou: os índices também.
    if (pick()?.where === "pack") setPick(null);
  });
  onCleanup(off);

  function send(type: string, d: Record<string, unknown>) {
    if (busy()) return;
    setBusy(true);
    setError(null);
    pending = { id: props.view.gameSend(type, d) };
  }

  const selected = createMemo((): ItemStack | null => {
    const p = pick();
    if (!p) return null;
    if (p.where === "slot") return inv().equip[p.slot] ?? null;
    const x = inv().pack[p.index];
    return x && x.item === p.item ? x : null;
  });

  const levelPct = () => {
    const h = hero();
    if (!h) return 0;
    const from = expForLevel(h.level);
    const to = expForLevel(h.level + 1);
    return percent(h.experience - from, to - from);
  };
  const stamina = () => {
    const m = hero()?.stamina ?? 0;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  };
  const capText = () => {
    const h = hero();
    if (!h) return "";
    const used = oz(h.weight);
    const cap = h.cap;
    return t`${used} de ${cap} oz`;
  };
  const gold = () => (hero()?.gold ?? 0).toLocaleString();
  // Poções (etapa O9): quantas carrega de cada e a escolha de quando beber.
  const supplies = () => hero()?.supplies ?? DEFAULT_SUPPLIES;
  const carried = (id: string) =>
    inv().pack.reduce((n, x) => (x.item === id ? n + x.count : n), 0);
  const potionsFor = (kind: "health" | "mana") =>
    potionDefs().filter((d) => d.potion?.[kind]);
  const setRule = (
    kind: "health" | "mana",
    patch: Partial<RunSupplies["health"]>,
  ) => {
    const next: RunSupplies = {
      health: { ...supplies().health },
      mana: { ...supplies().mana },
    };
    next[kind] = { ...next[kind], ...patch };
    send("rpg.supplies", { health: next.health, mana: next.mana });
  };
  const skipped = () => hero()?.loot_skip ?? [];
  const LIMITS = [0, 20, 30, 40, 50, 60, 70, 80, 90];

  const tile = (x: ItemStack | undefined, fallback: string) => {
    const def = x ? itemDef(x.item) : undefined;
    return (
      <>
        <Symbol size={22}>{x ? itemIcon(def) : fallback}</Symbol>
        <Show when={x && x.count > 1}>
          <Count>{x!.count}</Count>
        </Show>
      </>
    );
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
        aria-labelledby="rpg-hero-title"
      >
        <Head>
          <div>
            <h2 id="rpg-hero-title" tabIndex={-1} ref={title}>
              {props.name}
            </h2>
            <Muted>
              {t`${vocationName(hero()?.vocation ?? 0)} · level ${hero()?.level ?? 1} (${levelPct()}%)`}
            </Muted>
          </div>
          <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
            ×
          </Close>
        </Head>

        <Stats>
          <span>
            <Symbol size={16}>favorite</Symbol> {hero()?.health_max ?? 0}
          </span>
          <span>
            <Symbol size={16}>water_drop</Symbol> {hero()?.mana_max ?? 0}
          </span>
          <span title={t`Capacidade: peso de tudo o que carrega`}>
            <Symbol size={16}>weight</Symbol> {capText()}
          </span>
          <span title={t`Stamina (horas:minutos)`}>
            <Symbol size={16}>bolt</Symbol> {stamina()}
          </span>
          <span title={t`Valor das moedas que carrega`}>
            <Symbol size={16}>toll</Symbol> {gold()}
          </span>
          <span title={t`Saldo no banco (não pesa)`}>
            <Symbol size={16}>account_balance</Symbol>{" "}
            {(hero()?.bank_gold ?? 0).toLocaleString()}
          </span>
        </Stats>

        <Show when={inRun()}>
          <Notice role="status">
            {t`Na dungeon: o inventário volta quando a corrida acabar.`}
          </Notice>
        </Show>

        <Body>
          <section aria-label={t`Equipamento`}>
            <Doll>
              <For each={DOLL}>
                {(slot) =>
                  slot ? (
                    <Tile
                      type="button"
                      data-selected={
                        pick()?.where === "slot" &&
                        (pick() as { slot: Slot }).slot === slot
                          ? ""
                          : undefined
                      }
                      data-empty={inv().equip[slot] ? undefined : ""}
                      aria-label={
                        inv().equip[slot]
                          ? `${S[slot]}: ${itemName(inv().equip[slot]!.item)}`
                          : t`${S[slot]}: vazio`
                      }
                      title={
                        inv().equip[slot]
                          ? itemName(inv().equip[slot]!.item)
                          : S[slot]
                      }
                      onClick={() => {
                        setConfirmDrop(false);
                        setError(null);
                        setPick(
                          inv().equip[slot] ? { where: "slot", slot } : null,
                        );
                      }}
                    >
                      {tile(inv().equip[slot], SLOT_ICON[slot])}
                    </Tile>
                  ) : (
                    <span />
                  )
                }
              </For>
            </Doll>
            <Auto>
              <input
                type="checkbox"
                checked={hero()?.auto_equip ?? true}
                disabled={busy() || inRun()}
                onChange={(e) =>
                  send("rpg.auto", { on: e.currentTarget.checked })
                }
              />
              <span>
                {t`Escolher o melhor sozinho`}
                <Muted>
                  {t`Arma, escudo, armaduras, mochila e munição, a cada volta da dungeon. Colar e anel ficam com você.`}
                </Muted>
              </span>
            </Auto>
          </section>

          <section aria-label={t`Mochila`}>
            <PackHead>
              <strong>{itemName(inv().equip.mochila?.item ?? "bolsa")}</strong>
              <Muted>
                {t`${inv().pack.length} de ${hero()?.pack_size ?? 0} espaços`}
              </Muted>
            </PackHead>
            <Pack>
              <For
                each={Array.from(
                  { length: hero()?.pack_size ?? 0 },
                  (_, i) => i,
                )}
              >
                {(i) => {
                  const x = () => inv().pack[i];
                  return (
                    <Tile
                      type="button"
                      disabled={!x()}
                      data-empty={x() ? undefined : ""}
                      data-selected={
                        pick()?.where === "pack" &&
                        (pick() as { index: number }).index === i
                          ? ""
                          : undefined
                      }
                      aria-label={
                        x()
                          ? x()!.count > 1
                            ? `${x()!.count}× ${itemName(x()!.item)}`
                            : itemName(x()!.item)
                          : t`Espaço vazio`
                      }
                      title={x() ? itemName(x()!.item) : undefined}
                      onClick={() => {
                        if (!x()) return;
                        setConfirmDrop(false);
                        setError(null);
                        setPick({ where: "pack", index: i, item: x()!.item });
                      }}
                    >
                      {tile(x(), "")}
                    </Tile>
                  );
                }}
              </For>
            </Pack>
          </section>
        </Body>

        <Show when={selected()}>
          {(x) => {
            const def = () => itemDef(x().item);
            const p = () => pick()!;
            const why = () => {
              const d = def();
              return d && p().where === "pack"
                ? cannotUse(d, base(), hero()?.level ?? 1)
                : null;
            };
            return (
              <Details aria-live="polite">
                <strong>
                  {x().count > 1
                    ? `${x().count}× ${itemName(x().item)}`
                    : itemName(x().item)}
                </strong>
                <Show when={def()}>
                  {(d) => (
                    <ul>
                      <For each={itemLines(d(), x(), vocationName)}>
                        {(line) => <li>{line}</li>}
                      </For>
                    </ul>
                  )}
                </Show>
                <Row>
                  <Show when={p().where === "slot" && p()}>
                    {(sp) => (
                      <Button
                        size="xs"
                        variant="tonal"
                        isDisabled={
                          busy() ||
                          inRun() ||
                          (sp() as { slot: Slot }).slot === "mochila"
                        }
                        onPress={() =>
                          send("rpg.unequip", {
                            slot: (sp() as { slot: Slot }).slot,
                          })
                        }
                      >
                        {t`Tirar para a mochila`}
                      </Button>
                    )}
                  </Show>
                  <Show when={p().where === "pack" && p()}>
                    {(pp) => {
                      const ref = () => pp() as { index: number; item: string };
                      return (
                        <>
                          <Show when={def()?.slot}>
                            <Button
                              size="xs"
                              variant="filled"
                              isDisabled={busy() || inRun() || !!why()}
                              onPress={() =>
                                send("rpg.equip", {
                                  index: ref().index,
                                  item: ref().item,
                                })
                              }
                            >
                              {t`Vestir`}
                            </Button>
                          </Show>
                          <Show when={coinAction(x())}>
                            {(label) => (
                              <Button
                                size="xs"
                                variant="tonal"
                                isDisabled={busy() || inRun()}
                                onPress={() =>
                                  send("rpg.coins", {
                                    index: ref().index,
                                    item: ref().item,
                                  })
                                }
                              >
                                {label()}
                              </Button>
                            )}
                          </Show>
                          <Button
                            size="xs"
                            variant="text"
                            isDisabled={busy() || inRun()}
                            onPress={() => {
                              if (!confirmDrop()) return setConfirmDrop(true);
                              send("rpg.discard", {
                                index: ref().index,
                                item: ref().item,
                              });
                            }}
                          >
                            {confirmDrop()
                              ? t`Confirmar: jogar fora`
                              : t`Jogar fora`}
                          </Button>
                        </>
                      );
                    }}
                  </Show>
                </Row>
                <Show when={why()}>
                  {(w) => <Muted>{inventoryError(w())}</Muted>}
                </Show>
                <Show when={!COINS.includes(x().item)}>
                  <Row>
                    <Button
                      size="xs"
                      variant="text"
                      isDisabled={busy()}
                      onPress={() =>
                        send("rpg.lootskip", {
                          item: x().item,
                          skip: !skipped().includes(x().item),
                        })
                      }
                    >
                      {skipped().includes(x().item)
                        ? t`Voltar a pegar no loot`
                        : t`Não pegar mais no loot`}
                    </Button>
                  </Row>
                </Show>
              </Details>
            );
          }}
        </Show>

        <Show when={error()}>
          {(msg) => <ErrorText role="alert">{msg()}</ErrorText>}
        </Show>

        <Potions aria-label={t`Poções na dungeon`}>
          <strong>{t`Poções na dungeon`}</strong>
          <For each={["health", "mana"] as const}>
            {(kind) => (
              <PotionRow>
                <span>
                  {kind === "health" ? t`Vida abaixo de` : t`Mana abaixo de`}
                </span>
                <select
                  value={String(supplies()[kind].below)}
                  disabled={busy()}
                  aria-label={
                    kind === "health"
                      ? t`Limite da poção de vida`
                      : t`Limite da poção de mana`
                  }
                  onChange={(e) =>
                    setRule(kind, { below: Number(e.currentTarget.value) })
                  }
                >
                  <For each={LIMITS}>
                    {(n) => (
                      <option value={String(n)}>
                        {n === 0 ? t`nunca` : `${n}%`}
                      </option>
                    )}
                  </For>
                </select>
                <select
                  value={supplies()[kind].item ?? ""}
                  disabled={busy() || supplies()[kind].below === 0}
                  aria-label={
                    kind === "health"
                      ? t`Qual poção de vida`
                      : t`Qual poção de mana`
                  }
                  onChange={(e) =>
                    setRule(kind, { item: e.currentTarget.value || null })
                  }
                >
                  <option value="">{t`a melhor que tiver`}</option>
                  <For each={potionsFor(kind)}>
                    {(d) => (
                      <option value={d.id}>
                        {`${d.name} (${carried(d.id)})`}
                      </option>
                    )}
                  </For>
                </select>
              </PotionRow>
            )}
          </For>
          <Muted>
            {t`Uma poção por segundo, como no OT. Compre no mercador; o frasco vazio volta para a mochila.`}
          </Muted>
          <Show when={skipped().length > 0}>
            <Muted>
              {t`Não pega no loot: ${skipped().map(itemName).join(", ")}.`}
            </Muted>
          </Show>
        </Potions>

        <Skills aria-label={t`Skills`}>
          <For each={SKILLS}>
            {(k) => (
              <span>
                {L.skill[k]} <strong>{hero()?.skills[k].level ?? 10}</strong>
              </span>
            )}
          </For>
          <span>
            {L.skill.magia} <strong>{hero()?.magic.level ?? 0}</strong>
          </span>
        </Skills>
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
    maxWidth: "680px",
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
  },
});

const Head = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "start",
    "& > div": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});

const Close = styled("button", {
  base: {
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "1.4em",
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
  },
});

const Stats = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 14px",
    fontSize: "0.9em",
    "& > span": { display: "inline-flex", alignItems: "center", gap: "4px" },
  },
});

const Notice = styled("p", {
  base: {
    margin: 0,
    padding: "6px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
  },
});

const Body = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "16px",
    alignItems: "start",
    "& > section": { display: "flex", flexDirection: "column", gap: "10px" },
    "@media (max-width: 560px)": { gridTemplateColumns: "1fr" },
  },
});

const Doll = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 48px)",
    gap: "6px",
    justifyContent: "start",
  },
});

const Pack = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, 48px)",
    gap: "6px",
  },
});

const PackHead = styled("div", {
  base: { display: "flex", alignItems: "baseline", gap: "8px" },
});

const Tile = styled("button", {
  base: {
    position: "relative",
    width: "48px",
    height: "48px",
    display: "grid",
    placeItems: "center",
    borderRadius: "10px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
    cursor: "pointer",
    padding: 0,
    "&[data-empty]": { opacity: 0.45, cursor: "default" },
    "&[data-selected]": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "1px",
    },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "1px",
    },
  },
});

const Count = styled("span", {
  base: {
    position: "absolute",
    right: "3px",
    bottom: "1px",
    fontSize: "0.7em",
    fontWeight: 700,
    textShadow: "0 0 3px var(--md-sys-color-surface-container)",
  },
});

const Auto = styled("label", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "8px",
    alignItems: "start",
    maxWidth: "168px",
    fontSize: "0.85em",
    cursor: "pointer",
    "& > span": { display: "flex", flexDirection: "column", gap: "2px" },
    "& input": { marginTop: "2px" },
    "@media (max-width: 560px)": { maxWidth: "none" },
  },
});

const Details = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    "& ul": {
      margin: 0,
      paddingLeft: "18px",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      fontSize: "0.9em",
    },
  },
});

const Skills = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    fontSize: "0.85em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const Potions = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    fontSize: "0.9em",
  },
});

const PotionRow = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    "& select": {
      padding: "3px 6px",
      borderRadius: "8px",
      border: "1px solid var(--md-sys-color-outline-variant)",
      background: "var(--md-sys-color-surface-container-highest)",
      color: "inherit",
    },
  },
});

const ErrorText = styled("p", {
  base: { margin: 0, color: "var(--md-sys-color-error)" },
});
