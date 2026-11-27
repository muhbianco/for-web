import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type ClassId,
  type ItemBase,
  type ItemInstance,
  type RarityId,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  balance as B,
  CLASSES,
  CLASS_IDS,
  FAMILIES,
  FAMILY_IDS,
  LEGENDARIES,
  MATERIALS,
  OFFHAND_IDS,
  RARITY_IDS,
  affixCount,
  canWearWeight,
  generateItem,
  itemName,
  itemTooltip,
  legendaryText,
  refinable,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { rarityName, roleName, slotName, weightName } from "./gameText";
import { RARITY } from "./gameTheme";
import { Btn, ItemIcon, Muted } from "./gameUi";

/**
 * O Arsenal (27/11/2026, pedido do dono: a página de todos os itens "como release lá no game, com o
 * mesmo visual"): toda base de item nas 5 raridades, com o ícone e os números do próprio jogo (o
 * núcleo calcula; nada escrito à mão), os lendários com nome e quem pode usar cada um. Material,
 * classe e refino mudam tudo na hora. Abre de dentro da nota do quadro de avisos que traz o link
 * `#arsenal` (NewsPanel).
 */

type Group = "arma" | "secundaria" | "armadura" | "joia";
interface Base {
  key: string;
  group: Group;
  base: ItemBase;
  classes: ClassId[];
}

const BASES: Base[] = [
  ...FAMILY_IDS.map((f) => ({
    key: f,
    group: "arma" as const,
    base: { slot: "arma", family: f } as ItemBase,
    classes: CLASS_IDS.filter((c) => CLASSES[c].weapons.includes(f)),
  })),
  ...OFFHAND_IDS.map((o) => ({
    key: o,
    group: "secundaria" as const,
    base: { slot: "secundaria", offhand: o } as ItemBase,
    classes: CLASS_IDS.filter((c) => CLASSES[c].offhands.includes(o)),
  })),
  ...ARMOR_SLOTS.flatMap((s) =>
    ARMOR_WEIGHTS.map((w) => ({
      key: `${s}-${w}`,
      group: "armadura" as const,
      base: { slot: s, weight: w } as ItemBase,
      classes: CLASS_IDS.filter((c) => canWearWeight(c, w)),
    })),
  ),
  ...(["colar", "anel"] as const).map((s) => ({
    key: s,
    group: "joia" as const,
    base: { slot: s } as ItemBase,
    classes: [...CLASS_IDS],
  })),
];

const baseKeyOf = (b: ItemBase): string =>
  b.slot === "arma"
    ? b.family
    : b.slot === "secundaria"
      ? b.offhand
      : "weight" in b
        ? `${b.slot}-${b.weight}`
        : b.slot;

const MATERIAL_LEVEL = MATERIALS.map((_, i) => (i + 1) * 50);
const REFINES = [0, 4, 7, 9, 10] as const;
const still = { next: () => 0.5 };

/** O item da base no material e na raridade, sem afixos (o que importa aqui é a base). */
function sample(b: ItemBase, ilvl: number, rarity: RarityId, refine: number) {
  const it = { ...generateItem(b, ilvl, rarity, still, B), affixes: [] };
  return { ...it, refine: refinable(it) ? refine : 0 } as ItemInstance;
}

export function ArsenalView(props: { onBack?: () => void; cls?: ClassId }) {
  const { t } = useLingui();
  const [mat, setMat] = createSignal(0);
  const [cls, setCls] = createSignal<ClassId | null>(props.cls ?? null);
  const [ref, setRef] = createSignal<number>(0);
  const ilvl = () => MATERIAL_LEVEL[mat()]!;
  const title = (c: ClassId) => CLASSES[c].titles[1];

  const baseName = (b: Base): string => {
    const x = b.base;
    if (x.slot === "arma") return FAMILIES[x.family].name;
    if (x.slot === "secundaria")
      return x.offhand === "escudo"
        ? t`Escudo`
        : x.offhand === "focus"
          ? t`Focus`
          : t`Aljava`;
    if ("weight" in x) return `${slotName(x.slot)} ${weightName(x.weight)}`;
    return slotName(x.slot);
  };
  const baseSub = (b: Base): string => {
    const x = b.base;
    if (x.slot === "arma") {
      const f = FAMILIES[x.family];
      const aps = f.aps.toFixed(2).replace(".", ",");
      const kind =
        f.kind === "ranged"
          ? t`distância`
          : f.kind === "magic"
            ? t`mágica`
            : t`corpo a corpo`;
      return f.hands === 2
        ? t`2 mãos · ${kind} · ${aps} ataques/s · escala ${f.scale}`
        : t`1 mão · ${kind} · ${aps} ataques/s · escala ${f.scale}`;
    }
    if (x.slot === "secundaria")
      return x.offhand === "escudo"
        ? t`Não combina com arma de 2 mãos.`
        : x.offhand === "focus"
          ? t`Só com arma mágica de 1 mão. Não refina.`
          : t`Só com arma de distância. Não refina.`;
    if ("weight" in x)
      return t`Peso ${weightName(x.weight)}: quem veste esse peso ou mais pesado.`;
    return t`Todas as classes. Não refina; 1 afixo a mais.`;
  };

  const groups = createMemo(() => [
    {
      id: "arma" as const,
      title: t`Armas`,
      blurb: t`A família define mãos, alcance, velocidade e o atributo que escala o dano.`,
    },
    {
      id: "secundaria" as const,
      title: t`Mão secundária`,
      blurb: t`Escudo, focus e aljava.`,
    },
    {
      id: "armadura" as const,
      title: t`Armaduras`,
      blurb: t`Cada classe veste o peso dela ou um mais leve.`,
    },
    {
      id: "joia" as const,
      title: t`Colar e anel`,
      blurb: t`Todas as classes usam.`,
    },
  ]);

  const shared = Math.round(B.cfg.loot.sharedLegendaryShare * 100);
  const named = Math.round(B.cfg.loot.namedLegendaryShare * 100);
  const namedCount = LEGENDARIES.filter((l) => l.cls !== null).length;

  const Who = (p: { classes: readonly ClassId[] }) => (
    <WhoRow>
      <For each={CLASS_IDS}>
        {(c) => (
          <WhoChip
            data-yes={p.classes.includes(c) ? "" : undefined}
            data-me={cls() === c ? "" : undefined}
          >
            {title(c)}
          </WhoChip>
        )}
      </For>
    </WhoRow>
  );

  return (
    <Wrap>
      <Show when={props.onBack}>
        {(back) => (
          <div>
            <Btn type="button" data-size="sm" onClick={() => back()()}>
              ← {t`Voltar aos avisos`}
            </Btn>
          </div>
        )}
      </Show>
      <Head>
        <h3>{t`Arsenal`}</h3>
        <Muted>
          {t`Todas as bases de item do jogo nas 5 raridades, com os números do jogo, e quem pode usar cada uma.`}
        </Muted>
      </Head>

      <Filters>
        <FilterRow>
          <Lbl>{t`Material`}</Lbl>
          <For each={MATERIALS}>
            {(m, i) => (
              <Chip
                type="button"
                aria-pressed={mat() === i() ? "true" : "false"}
                onClick={() => setMat(i())}
              >
                {m} <small>{`${i() * 50 + 1}–${(i() + 1) * 50}`}</small>
              </Chip>
            )}
          </For>
        </FilterRow>
        <FilterRow>
          <Lbl>{t`Classe`}</Lbl>
          <Chip
            type="button"
            aria-pressed={cls() === null ? "true" : "false"}
            onClick={() => setCls(null)}
          >
            {t`Todas`}
          </Chip>
          <For each={CLASS_IDS}>
            {(c) => (
              <Chip
                type="button"
                aria-pressed={cls() === c ? "true" : "false"}
                onClick={() => setCls(c)}
              >
                {title(c)} <small>{roleName(CLASSES[c].role)}</small>
              </Chip>
            )}
          </For>
        </FilterRow>
        <FilterRow>
          <Lbl>{t`Refino`}</Lbl>
          <For each={REFINES}>
            {(r) => (
              <Chip
                type="button"
                aria-pressed={ref() === r ? "true" : "false"}
                onClick={() => setRef(r)}
              >
                {r === 0 ? t`sem` : `+${r}`}
              </Chip>
            )}
          </For>
        </FilterRow>
      </Filters>

      <Legend>
        <For each={RARITY_IDS}>
          {(r) => (
            <span>
              <b style={{ color: RARITY[r].color }}>
                {RARITY[r].pips || "·"} {rarityName(r)}
              </b>{" "}
              ×{B.rarityMult(r).toFixed(2).replace(".", ",")}
            </span>
          )}
        </For>
        <Show when={cls()}>
          {(c) => (
            <span>
              {t`${BASES.filter((b) => b.classes.includes(c())).length} de ${BASES.length} bases servem para ${title(c())}`}
            </span>
          )}
        </Show>
      </Legend>

      <For each={groups()}>
        {(g) => (
          <Group>
            <GroupHead>
              <h4>{g.title}</h4>
              <Muted>{g.blurb}</Muted>
            </GroupHead>
            <Cards>
              <For each={BASES.filter((b) => b.group === g.id)}>
                {(b) => {
                  const off = () => !!cls() && !b.classes.includes(cls()!);
                  const comum = () => sample(b.base, ilvl(), "comum", 0);
                  return (
                    <Card data-off={off() ? "" : undefined}>
                      <CardTitle>
                        <strong>{baseName(b)}</strong>
                        <Muted>{baseSub(b)}</Muted>
                      </CardTitle>
                      <Muted>
                        {t`No jogo: ${itemName(comum())} · iL ${ilvl()}`}
                      </Muted>
                      <Who classes={b.classes} />
                      <Tiers>
                        <For each={RARITY_IDS}>
                          {(r) => {
                            const it = () => sample(b.base, ilvl(), r, ref());
                            const lines = () => itemTooltip(it()).base;
                            const aff = affixCount(b.base.slot, r);
                            return (
                              <Tier>
                                <ItemIcon item={it()} size={48} />
                                <b style={{ color: RARITY[r].color }}>
                                  {rarityName(r)}
                                </b>
                                <span>
                                  {lines()
                                    .map(
                                      (l) =>
                                        `${l.label} ${Math.round(l.value).toLocaleString("pt-BR")}`,
                                    )
                                    .join(" · ") || "—"}
                                </span>
                                <Muted>
                                  {r === "lendario"
                                    ? t`${aff} afixos + perk`
                                    : aff === 1
                                      ? t`1 afixo`
                                      : t`${aff} afixos`}
                                </Muted>
                              </Tier>
                            );
                          }}
                        </For>
                      </Tiers>
                    </Card>
                  );
                }}
              </For>
            </Cards>
          </Group>
        )}
      </For>

      <Group>
        <GroupHead>
          <h4>{t`Lendários`}</h4>
          <Muted>
            {t`Quando cai um Lendário: ${shared}% é a Coroa do Mentor; ${named}% é um dos ${namedCount} lendários com nome, de qualquer classe; o resto é qualquer item do jogo, inclusive os que a sua classe não usa (passe para outro jogador pelo Banqueiro). O perk vem sempre numa habilidade da classe de quem dropou; no Ferreiro, ele rola de novo.`}
          </Muted>
        </GroupHead>
        <Cards>
          <For each={LEGENDARIES}>
            {(l) => {
              const b = BASES.find((x) => x.key === baseKeyOf(l.base))!;
              const it = () => ({
                ...sample(l.base, ilvl(), "lendario", ref()),
                legendary: l.id,
              });
              return (
                <Card
                  data-off={
                    cls() && !b.classes.includes(cls()!) ? "" : undefined
                  }
                >
                  <LegRow>
                    <ItemIcon item={it()} size={48} />
                    <div>
                      <strong>{l.name}</strong>
                      <Muted>
                        {" "}
                        ·{" "}
                        {l.cls
                          ? t`lendário do ${title(l.cls)}`
                          : t`de qualquer classe`}
                      </Muted>
                      <Perk>★ {legendaryText(l)}</Perk>
                      <Muted>
                        {l.cls
                          ? t`Vem com este perk quando cai para ${title(l.cls)}; para as outras classes, com um perk da classe de quem dropou.`
                          : t`Sempre com este perk, para qualquer classe.`}
                      </Muted>
                    </div>
                  </LegRow>
                  <Who classes={b.classes} />
                </Card>
              );
            }}
          </For>
        </Cards>
      </Group>

      <Group>
        <GroupHead>
          <h4>{t`Quem usa o quê`}</h4>
          <Muted>{t`✓ pode usar · ★ é o lendário com nome da classe.`}</Muted>
        </GroupHead>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>{t`Item`}</th>
                <For each={CLASS_IDS}>
                  {(c) => (
                    <th data-me={cls() === c ? "" : undefined}>{title(c)}</th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={groups()}>
                {(g) => (
                  <>
                    <tr data-group="">
                      <td colSpan={CLASS_IDS.length + 1}>{g.title}</td>
                    </tr>
                    <For each={BASES.filter((b) => b.group === g.id)}>
                      {(b) => (
                        <tr>
                          <td>{baseName(b)}</td>
                          <For each={CLASS_IDS}>
                            {(c) => (
                              <td
                                data-yes={
                                  b.classes.includes(c) ? "" : undefined
                                }
                                data-me={cls() === c ? "" : undefined}
                              >
                                {b.classes.includes(c) ? "✓" : "·"}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </>
                )}
              </For>
              <tr data-group="">
                <td colSpan={CLASS_IDS.length + 1}>{t`Lendários`}</td>
              </tr>
              <For each={LEGENDARIES}>
                {(l) => {
                  const b = BASES.find((x) => x.key === baseKeyOf(l.base))!;
                  return (
                    <tr>
                      <td>{l.name}</td>
                      <For each={CLASS_IDS}>
                        {(c) => (
                          <td
                            data-yes={b.classes.includes(c) ? "" : undefined}
                            data-me={cls() === c ? "" : undefined}
                          >
                            {b.classes.includes(c)
                              ? l.cls === c
                                ? "★"
                                : "✓"
                              : "·"}
                          </td>
                        )}
                      </For>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </TableWrap>
      </Group>
    </Wrap>
  );
}

const Wrap = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    minWidth: 0,
  },
});
const Head = styled("div", {
  base: {
    display: "grid",
    gap: "4px",
    "& h3": { margin: 0, fontSize: "1.2rem", color: "#d9b45a" },
  },
});
const Filters = styled("div", {
  base: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: "grid",
    gap: "6px",
    padding: "8px 0",
    background: "var(--md-sys-color-surface-container-high)",
    borderBottom: "1px solid var(--md-sys-color-outline-variant)",
  },
});
const FilterRow = styled("div", {
  base: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    flexWrap: "wrap",
    "@container (max-width: 560px)": {
      flexWrap: "nowrap",
      overflowX: "auto",
      scrollbarWidth: "none",
      "& > *": { flex: "0 0 auto" },
    },
  },
});
const Lbl = styled("span", {
  base: {
    fontSize: "0.72rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--md-sys-color-on-surface-variant)",
    minWidth: "60px",
  },
});
const Chip = styled("button", {
  base: {
    font: "inherit",
    fontSize: "0.82rem",
    color: "inherit",
    background: "var(--md-sys-color-surface-container-highest)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "999px",
    padding: "3px 10px",
    cursor: "pointer",
    display: "inline-flex",
    gap: "6px",
    alignItems: "baseline",
    "& small": {
      color: "var(--md-sys-color-on-surface-variant)",
      fontSize: "0.72rem",
      fontVariantNumeric: "tabular-nums",
    },
    "&[aria-pressed=true]": {
      borderColor: "#d9b45a",
      background: "#3a2f1c",
      color: "#ffe9b0",
    },
    "&:focus-visible": { outline: "2px solid #d9b45a", outlineOffset: "2px" },
  },
});
const Legend = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    fontSize: "0.82rem",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
const Group = styled("section", {
  base: { display: "grid", gap: "10px", minWidth: 0 },
});
const GroupHead = styled("div", {
  base: {
    display: "grid",
    gap: "2px",
    "& h4": { margin: 0, fontSize: "1.05rem" },
  },
});
const Cards = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))",
    gap: "10px",
  },
});
const Card = styled("article", {
  base: {
    display: "grid",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    minWidth: 0,
    "&[data-off]": { opacity: 0.32 },
  },
});
const CardTitle = styled("div", {
  base: { display: "grid", gap: "2px" },
});
const WhoRow = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px" },
});
const WhoChip = styled("span", {
  base: {
    fontSize: "0.72rem",
    padding: "1px 7px",
    borderRadius: "4px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    color: "var(--md-sys-color-outline)",
    textDecoration: "line-through",
    "&[data-yes]": {
      color: "inherit",
      textDecoration: "none",
      borderColor: "#5c4d36",
      background: "#2e271d",
    },
    "&[data-me]": { borderColor: "#d9b45a", color: "#ffe9b0" },
  },
});
const Tiers = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: "6px",
  },
});
const Tier = styled("div", {
  base: {
    display: "grid",
    justifyItems: "center",
    textAlign: "center",
    gap: "3px",
    fontSize: "0.74rem",
    fontVariantNumeric: "tabular-nums",
    minWidth: 0,
  },
});
const LegRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "10px",
    alignItems: "start",
  },
});
const Perk = styled("p", {
  base: { color: "#ffa64d", margin: "4px 0" },
});
const TableWrap = styled("div", {
  base: {
    overflowX: "auto",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "10px",
    "& table": {
      borderCollapse: "collapse",
      width: "100%",
      fontSize: "0.8rem",
    },
    "& th, & td": {
      padding: "5px 9px",
      borderBottom: "1px solid var(--md-sys-color-outline-variant)",
      textAlign: "center",
      whiteSpace: "nowrap",
    },
    "& th:first-child, & td:first-child": { textAlign: "left" },
    "& td": { color: "var(--md-sys-color-outline)" },
    "& td[data-yes]": { color: "#9be38f" },
    "& [data-me]": { background: "#2e271d" },
    "& tr[data-group] td": {
      color: "#d9b45a",
      fontWeight: 600,
      background: "var(--md-sys-color-surface-container)",
    },
  },
});
