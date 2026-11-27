import { createMemo, createSignal, For, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type Affix,
  type ClassId,
  type ItemPerk,
  type Material,
  type OwnedItem,
  type RpgHeroState,
  balance as B,
  buyBackPrice,
  CLASSES,
  dismantle,
  itemPerks,
  itemTooltip,
  perkClass,
  perkRangeText,
  perkText,
  refinable,
  refineCostOf,
  reforgeCost,
  stoneMatters,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ItemCard, ItemGrid } from "./ItemCard";
import {
  type GameLink,
  Btn,
  Confirm,
  Delta,
  Gold,
  Muted,
  Notice,
  Panel,
  Row,
  Tabs,
  useCommands,
} from "./gameUi";
import { bagMarks, findItem, gold, pct } from "./heroModel";

type Tab = "refinar" | "reforjar" | "perk" | "desmontar";

/** O último perk que saiu no Ferreiro (o antes e o depois, na aba do perk). */
type PerkRoll = {
  uid: string;
  slot: number;
  before: ItemPerk | null;
  after: ItemPerk;
};

type Outcome =
  | {
      kind: "subiu" | "falhou" | "caiu" | "protegido";
      from: number;
      to: number;
    }
  | { kind: "reforjou"; before: Affix[] }
  | null;

/**
 * O Ferreiro (§9.6, §10, D3): refinar mostra a chance, o que acontece se falhar (perde o custo, ou
 * cai 1 nível do +8 em diante), o custo com o que você tem, e a Pedra de Proteção só quando ela
 * serve (P48: só é gasta se a falha derrubaria). O resultado aparece na hora, com o antes e o
 * depois. Reforjar e desmontar não voltam atrás: confirmação, e o +7 pede duas. Desmontar é em lote,
 * como a venda no Mercador: marca vários (ou tudo) e vê o minério e a Essência antes (26/11/2026).
 */
export function SmithPanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const h = () => props.state.hero;
  // Na corrida só o desmonte vale (o servidor recusa refinar e reforjar): abre nele (26/11/2026).
  const inRun = () => !!props.state.run;
  const [tab, setTab] = createSignal<Tab>(
    props.state.run ? "desmontar" : "refinar",
  );
  const [sel, setSel] = createSignal<string | null>(null);
  const [protect, setProtect] = createSignal(false);
  const [outcome, setOutcome] = createSignal<Outcome>(null);
  const [many, setMany] = createSignal<string[]>([]);
  const [broke, setBroke] = createSignal<string | null>(null);
  const [perkRoll, setPerkRoll] = createSignal<PerkRoll | null>(null);
  const breaking = () => tab() === "desmontar";
  const marks = createMemo(() => (breaking() ? bagMarks(h()) : {}));
  const chosen = () => h().bag.filter((x) => many().includes(x.uid));
  const toggleMany = (uid: string) => {
    setBroke(null);
    setMany(
      many().includes(uid) ? many().filter((x) => x !== uid) : [...many(), uid],
    );
  };

  const worn = () =>
    (Object.values(h().equipment).filter(Boolean) as OwnedItem[]).filter((x) =>
      tab() === "refinar"
        ? refinable(x)
        : tab() === "perk"
          ? x.rarity === "lendario"
          : tab() === "reforjar",
    );
  const bag = () =>
    h().bag.filter((x) =>
      tab() === "refinar"
        ? refinable(x)
        : tab() === "perk"
          ? x.rarity === "lendario"
          : tab() !== "reforjar" || x.affixes.length > 0,
    );
  /** Rola o perk `slot` (ou imbui o 2º, sem `slot`) e guarda o antes e o depois para a caixa. */
  const perk = async (it: OwnedItem, slot?: number) => {
    const before = slot === undefined ? null : (itemPerks(it)[slot] ?? null);
    setPerkRoll(null);
    const r = await cmd.run("rpg.smith.perk", {
      npc: props.npc,
      uid: it.uid,
      action: slot === undefined ? "imbuir" : "rolar",
      ...(slot === undefined ? {} : { slot }),
    });
    if (!r?.ok) return;
    const now = findItem(h(), it.uid)?.item;
    const perks = now ? itemPerks(now) : [];
    const at = slot ?? perks.length - 1;
    const after = perks[at];
    if (after) setPerkRoll({ uid: it.uid, slot: at, before, after });
  };
  const item = createMemo(() => {
    const uid = sel();
    return uid ? (findItem(h(), uid)?.item ?? null) : null;
  });
  const pick = (uid: string) => {
    setOutcome(null);
    // A Pedra é escolha de cada item: trocar de item desmarca (26/11/2026).
    setProtect(false);
    setSel(sel() === uid ? null : uid);
  };
  // O que vai no pedido: a Pedra só quando ela serve (item na faixa que cai) e há pedra na mão. A
  // caixa marcada sozinha não basta: ela some abaixo do +8 e fica travada quando a pedra acaba.
  const useStone = () => {
    const it = item();
    return protect() && h().stones > 0 && !!it && stoneMatters(it);
  };
  const ore = (m: string) => h().ores[m as Material] ?? 0;

  const refine = async () => {
    const it = item();
    if (!it) return;
    const from = it.refine;
    const stones = h().stones;
    const r = await cmd.run("rpg.smith", {
      npc: props.npc,
      action: "refinar",
      uid: it.uid,
      ...(useStone() ? { protect: true } : {}),
    });
    if (!r?.ok) return;
    if (h().stones < 1) setProtect(false);
    const now = findItem(h(), it.uid)?.item.refine ?? from;
    setOutcome({
      kind:
        now > from
          ? "subiu"
          : now < from
            ? "caiu"
            : h().stones < stones
              ? "protegido"
              : "falhou",
      from,
      to: now,
    });
  };

  return (
    <Wrap>
      <Row>
        <Gold n={gold(h().gold)} />
        <Muted>{t`Pedras de Proteção: ${h().stones}`}</Muted>
        <Muted>{t`Essência: ${h().essence}`}</Muted>
      </Row>
      <Tabs
        label={t`Ferreiro`}
        value={tab()}
        onChange={(v) => {
          setTab(v);
          setOutcome(null);
          setSel(null);
          setProtect(false);
          setMany([]);
          setPerkRoll(null);
        }}
        items={[
          { id: "refinar", label: t`Refinar` },
          { id: "reforjar", label: t`Reforjar` },
          { id: "perk", label: t`Perk lendário` },
          { id: "desmontar", label: t`Desmontar` },
        ]}
      />
      <Show when={tab() !== "desmontar"}>
        <ItemGrid
          label={t`Vestido`}
          items={worn()}
          selected={sel() ? [sel()!] : []}
          onToggle={pick}
          note={(it) => `+${it.refine}`}
          empty={<Muted>{t`Nada vestido serve aqui.`}</Muted>}
          hero={h()}
        />
      </Show>
      <ItemGrid
        label={t`Mochila`}
        items={bag()}
        selected={breaking() ? many() : sel() ? [sel()!] : []}
        onToggle={breaking() ? toggleMany : pick}
        mark={breaking() ? (uid) => marks()[uid]?.mark : undefined}
        note={(it) => `+${it.refine}`}
        empty={<Muted>{t`Nada na mochila serve aqui.`}</Muted>}
        hero={h()}
        price={buyBackPrice}
        hint
      />
      <Show when={breaking() && h().bag.length > 0}>
        <Row>
          <Show when={many().length < h().bag.length}>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              onClick={() => setMany(h().bag.map((x) => x.uid))}
            >
              {t`Selecionar tudo`}
            </Btn>
          </Show>
          <Btn
            type="button"
            data-size="sm"
            data-tone="quiet"
            onClick={() =>
              setMany(
                h()
                  .bag.filter(
                    (x) => marks()[x.uid]?.mark === "blocked" && x.refine < 7,
                  )
                  .map((x) => x.uid),
              )
            }
          >
            {t`Marcar o que não dá para vestir`}
          </Btn>
          <Show when={many().length > 0}>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              onClick={() => setMany([])}
            >
              {t`Limpar`}
            </Btn>
          </Show>
        </Row>
        <Muted>{t`O que está vestido não desmonta: tire antes na ficha.`}</Muted>
      </Show>
      <Show when={tab() === "refinar"}>
        <Muted>{t`Refina arma, armadura e escudo. Colar, anel, focus e aljava não refinam.`}</Muted>
      </Show>

      {/* keyed: cada tentativa é um resultado novo (o Result lê o desfecho uma vez). */}
      <Show when={outcome()} keyed>
        {(o) => <Result outcome={o} item={item()} />}
      </Show>
      <Notice error={cmd.error()} ok={breaking() ? broke() : null} />

      <Show when={inRun() && !breaking()}>
        <Muted role="note">
          {t`Refinar, reforjar e rolar perk, só quando a corrida acabar. Desmontar da mochila vale agora.`}
        </Muted>
      </Show>
      <Show when={inRun() && !breaking() ? undefined : item()}>
        {(it) => (
          <Show
            when={tab() === "refinar"}
            fallback={
              <Show
                when={tab() === "reforjar"}
                fallback={
                  <Show when={tab() === "perk"}>
                    <PerkBox
                      item={it()}
                      cls={h().cls}
                      essence={h().essence}
                      busy={cmd.busy()}
                      last={perkRoll()?.uid === it().uid ? perkRoll() : null}
                      onRoll={(slot) => perk(it(), slot)}
                      onImbue={() => perk(it())}
                    />
                  </Show>
                }
              >
                <ReforgeBox
                  item={it()}
                  gold={h().gold}
                  ore={ore(reforgeCost(it()).ore.material)}
                  busy={cmd.busy()}
                  onConfirm={async () => {
                    const before = it().affixes;
                    const r = await cmd.run("rpg.smith", {
                      npc: props.npc,
                      action: "reforjar",
                      uid: it().uid,
                    });
                    if (r?.ok) setOutcome({ kind: "reforjou", before });
                  }}
                />
              </Show>
            }
          >
            <RefineBox
              item={it()}
              gold={h().gold}
              stones={h().stones}
              ore={ore(refineCostOf(it())?.ore.material ?? "")}
              protect={useStone()}
              setProtect={setProtect}
              busy={cmd.busy()}
              onRefine={refine}
            />
          </Show>
        )}
      </Show>
      <Show when={breaking() && chosen().length > 0}>
        <DismantleBox
          items={chosen()}
          ups={chosen().filter((x) => marks()[x.uid]?.mark === "up").length}
          busy={cmd.busy()}
          onConfirm={async () => {
            const list = chosen();
            const sum = dismantleTotals(list);
            setBroke(null);
            const r = await cmd.run("rpg.smith.dismantle.many", {
              npc: props.npc,
              uids: list.map((x) => x.uid),
            });
            if (!r?.ok) return;
            setMany([]);
            const n = list.length;
            const ores = sum.ores
              .map(([m, c]) => t`${c} minério de ${m}`)
              .join(", ");
            const essence = sum.essence;
            setBroke(
              essence > 0
                ? t`Desmontou ${n} itens: ${ores} e ${essence} Essência.`
                : t`Desmontou ${n} itens: ${ores}.`,
            );
          }}
        />
      </Show>
      <Show when={item()}>
        {(it) => <ItemCard hero={h()} item={it()} compare={false} />}
      </Show>
    </Wrap>
  );
}

function RefineBox(props: {
  item: OwnedItem;
  gold: number;
  stones: number;
  ore: number;
  protect: boolean;
  setProtect: (v: boolean) => void;
  busy: boolean;
  onRefine: () => void;
}) {
  const { t } = useLingui();
  const cost = () => refineCostOf(props.item);
  const r = () => props.item.refine;
  const chance = () => B.refineChance(r());
  const drops = () => B.refineFailure(r()) === "cai";
  const weapon = () => props.item.slot === "arma";
  const mult = (x: number) => B.refineMult(x, weapon());
  const goldOk = () => (cost()?.gold ?? 0) <= props.gold;
  const oreOk = () => (cost()?.ore.count ?? 0) <= props.ore;
  return (
    <Show
      when={cost()}
      fallback={<Muted>{t`Este item já está no +10.`}</Muted>}
    >
      {(c) => (
        <Panel>
          <Row>
            <Big>
              +{r()} → +{r() + 1}
            </Big>
            <Chance
              data-risk={
                chance() < 0.5 ? "alto" : chance() < 1 ? "medio" : undefined
              }
            >
              {t`Chance ${pct(chance())}`}
            </Chance>
          </Row>
          <Muted>
            {t`Bônus do refino`}:{" "}
            <Delta
              a={mult(r()) - 1}
              b={mult(r() + 1) - 1}
              fmt={(x) => `+${Math.round(x * 100)}%`}
            />
          </Muted>
          <Consequence data-bad={drops() ? "" : undefined}>
            {chance() >= 1
              ? t`Até o +4 é certo.`
              : drops()
                ? t`Se falhar: perde o ouro e o minério e o item cai para +${r() - 1}. Nunca quebra.`
                : t`Se falhar: perde o ouro e o minério; o item continua +${r()}. Nunca quebra.`}
          </Consequence>
          <Costs>
            <span data-ok={goldOk() ? "" : undefined}>
              {goldOk() ? "✓" : "✗"} <Gold n={gold(c().gold)} />
              <Show when={!goldOk()}> {t`(você tem ${gold(props.gold)})`}</Show>
            </span>
            <span data-ok={oreOk() ? "" : undefined}>
              {oreOk() ? "✓" : "✗"}{" "}
              {t`${c().ore.count} minério de ${c().ore.material}`}
              <Muted> {t`(você tem ${props.ore})`}</Muted>
            </span>
          </Costs>
          <Show when={drops()}>
            <Toggle>
              <input
                type="checkbox"
                checked={props.protect}
                disabled={props.stones < 1}
                onChange={(e) => props.setProtect(e.currentTarget.checked)}
              />
              <span>
                {t`Usar Pedra de Proteção (você tem ${props.stones})`}
                <Muted>
                  {" "}
                  — {t`se falhar, o item não cai; só é gasta nesse caso.`}
                </Muted>
              </span>
            </Toggle>
          </Show>
          <Show
            when={drops() && !props.protect}
            fallback={
              <Btn
                type="button"
                data-tone="primary"
                disabled={props.busy || !goldOk() || !oreOk()}
                onClick={props.onRefine}
              >
                {t`Refinar (${pct(chance())})`}
              </Btn>
            }
          >
            <Confirm
              tone="primary"
              disabled={props.busy || !goldOk() || !oreOk()}
              label={t`Refinar (${pct(chance())})`}
              confirm={t`Sem Pedra: pode cair para +${r() - 1}. Toque de novo`}
              onConfirm={props.onRefine}
            />
          </Show>
        </Panel>
      )}
    </Show>
  );
}

function ReforgeBox(props: {
  item: OwnedItem;
  gold: number;
  ore: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLingui();
  const c = () => reforgeCost(props.item);
  const ok = () => c().gold <= props.gold && c().ore.count <= props.ore;
  return (
    <Panel>
      <strong>{t`Reforjar`}</strong>
      <Muted>
        {t`Sorteia os afixos de novo. A raridade, o refino e o efeito lendário ficam; os afixos de agora se perdem.`}
      </Muted>
      <Costs>
        <span data-ok={c().gold <= props.gold ? "" : undefined}>
          {c().gold <= props.gold ? "✓" : "✗"} <Gold n={gold(c().gold)} />
        </span>
        <span data-ok={c().ore.count <= props.ore ? "" : undefined}>
          {c().ore.count <= props.ore ? "✓" : "✗"}{" "}
          {t`${c().ore.count} minério de ${c().ore.material}`}
          <Muted> {t`(você tem ${props.ore})`}</Muted>
        </span>
      </Costs>
      <Confirm
        tone="primary"
        steps={props.item.refine >= 7 ? 2 : 1}
        disabled={props.busy || !ok() || props.item.affixes.length === 0}
        label={t`Reforjar`}
        confirm={t`Trocar os afixos de agora? Toque de novo`}
        confirm2={t`É +${props.item.refine}: toque mais uma vez`}
        onConfirm={props.onConfirm}
      />
    </Panel>
  );
}

/**
 * O perk do lendário (27/11/2026): o que o item tem, a faixa de cada um e as ações. Rolar troca o
 * perk por um numa skill da sua classe, com o tamanho na faixa dela (1 Essência); imbuir dá o 2º
 * (20 Essências). A Essência sai de desmontar lendário. Nada disso mexe nos afixos.
 */
function PerkBox(props: {
  item: OwnedItem;
  cls: ClassId;
  essence: number;
  busy: boolean;
  last: PerkRoll | null;
  onRoll: (slot: number) => void;
  onImbue: () => void;
}) {
  const { t } = useLingui();
  const cfg = B.cfg.legendaryPerks;
  const perks = () => itemPerks(props.item);
  const slots = () => Math.max(1, perks().length);
  const className = () => CLASSES[props.cls].titles[1];
  const off = (p: ItemPerk) => {
    const c = perkClass(p);
    return c !== null && c !== props.cls ? CLASSES[c].titles[1] : null;
  };
  const rollOk = () => props.essence >= cfg.rerollEssence;
  const imbueOk = () => props.essence >= cfg.imbueEssence;
  return (
    <Panel>
      <strong>{t`Perk lendário`}</strong>
      <Muted>
        {t`Rolar troca o perk por um numa das skills de ${className()} (a sua classe), com o tamanho sorteado na faixa da skill. Os afixos não mudam: isso é o Reforjar.`}
      </Muted>
      <For each={Array.from({ length: slots() }, (_, i) => i)}>
        {(i) => {
          const p = () => perks()[i];
          return (
            <PerkLine>
              <span>
                <strong>{t`Perk ${i + 1}`}</strong>{" "}
                <Show when={p()} fallback={<Muted>{t`(vazio)`}</Muted>}>
                  {(x) => (
                    <>
                      <PerkText data-off={off(x()) ? "" : undefined}>
                        ★ {perkText(x()) ?? x().skill}
                      </PerkText>
                      <Show when={perkRangeText(x().skill)}>
                        {(r) => <Muted> {t`(faixa ${r()})`}</Muted>}
                      </Show>
                      <Show when={off(x())}>
                        {(c) => (
                          <Muted>
                            {" "}
                            {t`— skill de ${c()}: não vale para você.`}
                          </Muted>
                        )}
                      </Show>
                    </>
                  )}
                </Show>
              </span>
              <Confirm
                tone="primary"
                disabled={props.busy || !rollOk()}
                label={t`Rolar o perk ${i + 1} (${cfg.rerollEssence} Essência)`}
                confirm={t`Trocar este perk? Toque de novo`}
                onConfirm={() => props.onRoll(i)}
              />
            </PerkLine>
          );
        }}
      </For>
      <Show when={perks().length < cfg.maxPerks && perks().length > 0}>
        <PerkLine>
          <span>
            <strong>{t`2º perk`}</strong>{" "}
            <Muted>{t`Imbuir dá um 2º perk, numa skill diferente da do 1º; depois ele também rola.`}</Muted>
          </span>
          <Confirm
            tone="primary"
            disabled={props.busy || !imbueOk()}
            label={t`Imbuir o 2º perk (${cfg.imbueEssence} Essências)`}
            confirm={t`Gastar ${cfg.imbueEssence} Essências? Toque de novo`}
            onConfirm={props.onImbue}
          />
        </PerkLine>
      </Show>
      <Costs>
        <span data-ok={rollOk() ? "" : undefined}>
          {rollOk() ? "✓" : "✗"} {t`Essência: você tem ${props.essence}`}
        </span>
      </Costs>
      <Muted>{t`Desmontar um lendário dá ${cfg.dismantleEssence} Essências.`}</Muted>
      <Show when={props.last}>
        {(l) => (
          <Notice
            ok={
              l().before
                ? t`Perk ${l().slot + 1}: saiu ${perkText(l().after) ?? ""} (era: ${perkText(l().before!) ?? ""})`
                : t`Novo perk: ${perkText(l().after) ?? ""}`
            }
          />
        )}
      </Show>
    </Panel>
  );
}

const PerkLine = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
});
const PerkText = styled("span", {
  base: { color: "#ffa64d", "&[data-off]": { opacity: 0.6 } },
});

/** O que a lista vira: minério por material (na ordem em que aparece) e a Essência somada. */
function dismantleTotals(items: OwnedItem[]) {
  const ores = new Map<string, number>();
  let essence = 0;
  for (const it of items) {
    const d = dismantle(it);
    ores.set(d.ore.material, (ores.get(d.ore.material) ?? 0) + d.ore.count);
    essence += d.essence;
  }
  return { ores: [...ores], essence };
}

function DismantleBox(props: {
  items: OwnedItem[];
  ups: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLingui();
  const sum = () => dismantleTotals(props.items);
  const risky = () => props.items.filter((x) => x.refine >= 7).length;
  const n = () => props.items.length;
  const ores = () =>
    sum()
      .ores.map(([m, c]) => t`${c} minério de ${m}`)
      .join(", ");
  return (
    <Panel>
      <strong>{t`Desmontar ${n()} itens`}</strong>
      <Muted>
        {t`Vira ${ores()}`}
        <Show when={sum().essence > 0}> {t`e ${sum().essence} Essência`}</Show>.
      </Muted>
      <Show when={props.ups > 0}>
        <Muted role="note">
          ⚠ {t`${props.ups} deles é melhor que o que você veste.`}
        </Muted>
      </Show>
      <Show when={risky() > 0}>
        <Muted role="note">⚠ {t`${risky()} item é +7 ou mais.`}</Muted>
      </Show>
      <Confirm
        tone="danger"
        steps={risky() > 0 ? 2 : 1}
        disabled={props.busy}
        label={t`Desmontar ${n()} itens`}
        confirm={t`Os itens somem para sempre. Toque de novo`}
        confirm2={t`Tem item +7: toque mais uma vez`}
        onConfirm={props.onConfirm}
      />
    </Panel>
  );
}

function Result(props: {
  outcome: NonNullable<Outcome>;
  item: OwnedItem | null;
}) {
  const { t } = useLingui();
  const o = props.outcome;
  if (o.kind === "reforjou") {
    const now = () => (props.item ? itemTooltip(props.item).affixes : []);
    const was = () =>
      itemTooltip({ ...(props.item as OwnedItem), affixes: o.before }).affixes;
    return (
      <Flash data-kind="ok" role="status">
        <strong>{t`Afixos novos`}</strong>
        <Pair>
          <div>
            <Muted>{t`Antes`}</Muted>
            <For each={was()}>{(a) => <span>{a.text}</span>}</For>
          </div>
          <div>
            <Muted>{t`Agora`}</Muted>
            <For each={now()}>{(a) => <span>{a.text}</span>}</For>
          </div>
        </Pair>
      </Flash>
    );
  }
  const text =
    o.kind === "subiu"
      ? t`Subiu para +${o.to}!`
      : o.kind === "caiu"
        ? t`Falhou e caiu para +${o.to}.`
        : o.kind === "protegido"
          ? t`Falhou, mas a Pedra de Proteção segurou o +${o.to}.`
          : t`Falhou: o item continua +${o.to}.`;
  return (
    <Flash data-kind={o.kind === "subiu" ? "ok" : "bad"} role="status">
      <strong>{text}</strong>
    </Flash>
  );
}

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "12px" },
});
const Big = styled("strong", {
  base: { fontSize: "1.5rem", fontVariantNumeric: "tabular-nums" },
});
const Chance = styled("span", {
  base: {
    fontWeight: 800,
    padding: "2px 10px",
    borderRadius: "999px",
    background: "rgba(126, 224, 138, 0.15)",
    color: "#7ee08a",
    "&[data-risk=medio]": {
      background: "rgba(224, 164, 90, 0.18)",
      color: "#ffd49a",
    },
    "&[data-risk=alto]": {
      background: "rgba(255, 138, 122, 0.16)",
      color: "#ff8a7a",
    },
  },
});
const Consequence = styled("div", {
  base: { fontSize: "0.9em", "&[data-bad]": { color: "#ffcfc6" } },
});
const Costs = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "& > span": { color: "#ff8a7a" },
    "& > span[data-ok]": { color: "inherit" },
  },
});
const Toggle = styled("label", {
  base: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    minHeight: "44px",
    cursor: "pointer",
    "& > input": {
      width: "20px",
      height: "20px",
      marginTop: "2px",
      accentColor: "#d9b45a",
    },
  },
});
const Flash = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "12px",
    borderRadius: "12px",
    fontSize: "1.05em",
    "&[data-kind=ok]": {
      background: "rgba(126, 224, 138, 0.12)",
      border: "1px solid #7ee08a",
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gamePop 380ms ease-out",
      },
    },
    "&[data-kind=bad]": {
      background: "rgba(255, 138, 122, 0.12)",
      border: "1px solid #ff8a7a",
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gameShake 320ms ease-in-out",
      },
    },
  },
});
const Pair = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    fontSize: "0.88em",
    "& > div": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});
