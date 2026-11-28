import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type AffixId,
  type ClassId,
  type ItemBase,
  type ItemInstance,
  type RarityId,
  AFFIXES,
  AFFIX_IDS,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  balance as B,
  CLASSES,
  CLASS_IDS,
  FAMILIES,
  FAMILY_IDS,
  GEAR_SLOTS,
  LEGENDARIES,
  MATERIALS,
  OFFHAND_IDS,
  RARITY_IDS,
  affixCount,
  affixLabel,
  affixRangeText,
  affixRarityShift,
  armorFit,
  canWearWeight,
  generateItem,
  itemName,
  itemTooltip,
  legendaryOdds,
  legendaryText,
  refinable,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import {
  offhandName,
  overweightText,
  rarityName,
  roleName,
  slotName,
  weightName,
} from "./gameText";
import { RARITY } from "./gameTheme";
import { Btn, ItemIcon, Muted } from "./gameUi";
import { pct } from "./heroModel";

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
  /** Armadura um peso acima do da classe: veste, com penalidade (27/11/2026). */
  heavy?: ClassId[];
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
      heavy: CLASS_IDS.filter((c) => armorFit(c, w) === "acima"),
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

/**
 * As linhas da tabela de afixos (27/11/2026, o dono: "coloca os ranges que o reroll de cada atributo
 * pode vir em cada nível/raridade de item"): os 6 atributos têm a mesma faixa, e Precisão, Fuga e
 * Crítico também; cada afixo de % tem a sua.
 */
const AFFIX_ROWS: AffixId[][] = [
  AFFIX_IDS.filter((id) => AFFIXES[id].scale === "atributo"),
  AFFIX_IDS.filter((id) => AFFIXES[id].scale === "rating"),
  ...AFFIX_IDS.filter((id) => AFFIXES[id].scale === "pct").map((id) => [id]),
];
const AFFIX_RARITIES: RarityId[] = ["incomum", "raro", "epico", "lendario"];
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
  // O nível do item da tabela de afixos: começa no topo do material e anda pela régua.
  const [affixIl, setAffixIl] = createSignal(ilvl());
  createEffect(on(mat, () => setAffixIl(ilvl()), { defer: true }));
  const title = (c: ClassId) => CLASSES[c].titles[1];

  const baseName = (b: Base): string => {
    const x = b.base;
    if (x.slot === "arma") return FAMILIES[x.family].name;
    if (x.slot === "secundaria") return offhandName(x.offhand);
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
      switch (x.offhand) {
        case "escudo":
          return t`Não combina com arma de 2 mãos.`;
        case "focus":
          return t`Só com arma mágica de 1 mão. Não refina.`;
        case "aljava":
          return t`Só com arco ou besta. Não refina.`;
        case "punhal":
          return t`A segunda lâmina: só com adaga ou espada. Não refina.`;
      }
    if ("weight" in x)
      return t`Peso ${weightName(x.weight)}: sem penalidade para quem é desse peso ou mais pesado; a classe um peso abaixo veste (◐) com ${overweightText()}.`;
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
      blurb: t`Escudo, focus, aljava e punhal.`,
    },
    {
      id: "armadura" as const,
      title: t`Armaduras`,
      blurb: t`Cada classe veste o peso dela e os mais leves; um peso acima (◐), com ${overweightText()}.`,
    },
    {
      id: "joia" as const,
      title: t`Colar e anel`,
      blurb: t`Todas as classes usam.`,
    },
  ]);

  const shared = Math.round(B.cfg.loot.sharedLegendaryShare * 100);
  const named = Math.round(B.cfg.loot.namedInBase * 100);
  // D71: o chefe (a tabela "Chefes: dano em área e por segundo").
  const mech = B.cfg.bossMechanics;
  const mon = B.cfg.monsters;
  const dots = mech.dots;
  const pulseShare = mon.pulsePct * mech.pulseMult;
  const usableExtra = pct(B.cfg.loot.legendaryUsableWeight - 1);
  /** D70: o que cai como Lendário para a classe escolhida (a mesma conta do sorteio). */
  const legendaryFor = createMemo(() => {
    const c = cls();
    if (!c) return null;
    const odds = legendaryOdds(c);
    const uses =
      odds.crown +
      odds.bases.reduce((a, b) => a + (b.usable ? b.chance : 0), 0);
    const weapon = odds.bases.find((b) => b.usable && b.base.slot === "arma");
    return {
      cls: c,
      uses,
      weaponOneIn: weapon ? Math.round(1 / weapon.chance) : 0,
    };
  });

  const Who = (p: {
    classes: readonly ClassId[];
    heavy?: readonly ClassId[] | undefined;
  }) => (
    <WhoRow>
      <For each={CLASS_IDS}>
        {(c) => (
          <WhoChip
            data-yes={p.classes.includes(c) ? "" : undefined}
            data-heavy={p.heavy?.includes(c) ? "" : undefined}
            data-me={cls() === c ? "" : undefined}
            title={
              p.heavy?.includes(c)
                ? t`Um peso acima: ${overweightText()}`
                : undefined
            }
          >
            {title(c)}
            {p.heavy?.includes(c) ? " ◐" : ""}
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
              <Show when={affixRarityShift(r, B) > 0}>
                {" "}
                {t`· afixos +${Math.round(affixRarityShift(r, B) * 100)}%`}
              </Show>
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
                      <Who classes={b.classes} heavy={b.heavy} />
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
            {t`Quando cai um Lendário: ${shared}% é a Coroa do Mentor; o resto é qualquer item do jogo, todos com a mesma chance, e o que a classe de quem dropou usa tem ${usableExtra} a mais de chance. O que ela não usa, passe para outro jogador pelo Banqueiro. Numa base que tem lendário com nome, ${named}% vêm com o nome. O perk vem sempre numa habilidade da classe de quem dropou; no Ferreiro, ele rola de novo.`}
          </Muted>
          <Show when={legendaryFor()}>
            {(o) => (
              <Muted>
                {t`${title(o().cls)}: ${pct(o().uses)} dos Lendários são algo que ele usa; cada arma dele sai em 1 de cada ${o().weaponOneIn}.`}
              </Muted>
            )}
          </Show>
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
          <h4>{t`Afixos: a faixa de cada um`}</h4>
          <Muted>
            {t`O valor de cada afixo sai sorteado dentro da faixa. Os de atributo, Precisão, Fuga e Crítico crescem com o nível do item; a raridade sobe a faixa (Épico +10%, Lendário +20%). Afixos por item: Incomum 1, Raro 2, Épico 3, Lendário 3, e +1 em colar e anel.`}
          </Muted>
        </GroupHead>
        <FilterRow>
          <Lbl>{t`Nível do item`}</Lbl>
          <input
            type="range"
            min={1}
            max={500}
            value={affixIl()}
            aria-label={t`Nível do item`}
            onInput={(e) => setAffixIl(Number(e.currentTarget.value))}
          />
          <span>
            {t`iL ${affixIl()} · pede nível ${Math.max(1, affixIl() - B.cfg.items.requirementSlack)}`}
          </span>
        </FilterRow>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>{t`Afixo`}</th>
                <th>{t`Sai em`}</th>
                <For each={AFFIX_RARITIES}>
                  {(r) => (
                    <th style={{ color: RARITY[r].color }}>
                      {RARITY[r].pips} {rarityName(r)}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={AFFIX_ROWS}>
                {(ids) => (
                  <tr>
                    <td>{ids.map(affixLabel).join(", ")}</td>
                    <td>
                      {AFFIXES[ids[0]!].slots.length === GEAR_SLOTS.length
                        ? t`qualquer peça`
                        : AFFIXES[ids[0]!].slots
                            .map((s) =>
                              // Afixo de % na mão secundária só sai no escudo (§9.5).
                              s === "secundaria" &&
                              AFFIXES[ids[0]!].scale === "pct"
                                ? offhandName("escudo")
                                : slotName(s),
                            )
                            .join(", ")}
                    </td>
                    <For each={AFFIX_RARITIES}>
                      {(r) => (
                        <td data-yes="">
                          {affixRangeText(ids[0]!, affixIl(), r, B)}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </TableWrap>
      </Group>

      {/* D68: a Arma Suprema, para quem procura a receita fora do Ferreiro. */}
      <Group>
        <GroupHead>
          <h4>{t`Arma Suprema`}</h4>
          <Muted>
            {t`No Ferreiro, ${B.cfg.supreme.inputs} armas Lendárias da mesma família e do mesmo nível de item viram uma Arma Suprema: a base fica (afixos, nome e o 1º perk), o refino é o maior das ${B.cfg.supreme.inputs} menos 30% (+10 vira +7), ganha de +${Math.round(B.cfg.supreme.power.min * 100)}% a +${Math.round(B.cfg.supreme.power.max * 100)}% de poder no dano da arma (média de 15%) e um 2º perk sorteado, que rola como o 1º. É o único item com 2 perks. Desmontar ou vender rende as ${B.cfg.supreme.inputs} lendárias.`}
          </Muted>
        </GroupHead>
      </Group>

      {/* D71 (28/11/2026): o que o chefe cobra por segundo e em área, com os números do config. */}
      <Group>
        <GroupHead>
          <h4>{t`Chefes: dano em área e por segundo`}</h4>
          <Muted>
            {t`Os chefes de Masmorra e de Região têm três jeitos de lutar. Cada Chefe de Região tem o seu; nas Masmorras, ele muda a cada 10 níveis. Os números valem para um herói do nível do chefe com a defesa de referência: com menos defesa, ou abaixo do nível do chefe, o dano é maior. Cada dungeon ainda tem o seu ajuste de força, que vale para estes danos como vale para os golpes. A purificação tira os três danos por segundo.`}
          </Muted>
        </GroupHead>
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>{t`Chefe`}</th>
                <th>{t`Em todos, a cada ${mon.pulseEverySeconds} s`}</th>
                <th>{t`Por segundo`}</th>
                <th>{t`Defesa que corta`}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t`Arcano`}</td>
                <td>{t`Pulso Sombrio (mágico): ${pct(pulseShare)} da vida`}</td>
                <td>{t`Maldição em ${dots.arcano.targets} herói que não é tanque: ${pct(dots.arcano.pct)} da vida por segundo, até ${dots.arcano.maxSeconds} s, a cada ${dots.arcano.everySeconds} s`}</td>
                <td>{t`Defesa mágica`}</td>
              </tr>
              <tr>
                <td>{t`Sanguinário`}</td>
                <td>{t`Talho (físico; esquiva e bloqueio contam): ${pct(pulseShare)} da vida`}</td>
                <td>{t`Sangramento em ${dots.sanguinario.targets} heróis que não são tanque: ${pct(dots.sanguinario.pct)} da vida por segundo, até ${dots.sanguinario.maxSeconds} s, a cada ${dots.sanguinario.everySeconds} s`}</td>
                <td>{t`Defesa física`}</td>
              </tr>
              <tr>
                <td>{t`Peçonhento`}</td>
                <td>{t`Talho (físico; esquiva e bloqueio contam): ${pct(pulseShare)} da vida`}</td>
                <td>{t`Veneno no grupo todo: ${pct(dots.peconhento.pct)} da vida por segundo, até ${dots.peconhento.maxSeconds} s, a cada ${dots.peconhento.everySeconds} s`}</td>
                <td>{t`Defesa física`}</td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
        <Muted>
          {t`Invocação (chefes a partir do nível ${mech.summonFrom}): a cada ${mech.summon.everySeconds} s, ${mech.summon.count} lacaios (${mech.summon.countBySize[4] ?? mech.summon.count} em grupos de 4 ou 5) que nascem atrás de quem não é tanque. Os heróis de dano largam o chefe para matá-los; o tanque e o suporte ficam no chefe.`}
        </Muted>
      </Group>

      <Group>
        <GroupHead>
          <h4>{t`Quem usa o quê`}</h4>
          <Muted>
            {t`✓ pode usar · ◐ veste um peso acima, com ${overweightText()} · ★ é o lendário com nome da classe.`}
          </Muted>
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
                                {b.heavy?.includes(c)
                                  ? "◐"
                                  : b.classes.includes(c)
                                    ? "✓"
                                    : "·"}
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
    "&[data-heavy]": { borderStyle: "dashed", opacity: 0.85 },
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
