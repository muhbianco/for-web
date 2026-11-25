import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type Affix,
  type Material,
  type OwnedItem,
  type RpgHeroState,
  balance as B,
  buyBackPrice,
  dismantle,
  itemTooltip,
  refinable,
  refineCostOf,
  reforgeCost,
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
import { equippedIn, findItem, gold, pct } from "./heroModel";

type Tab = "refinar" | "reforjar" | "desmontar";

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
 * depois. Reforjar e desmontar não voltam atrás: confirmação, e o +7 pede duas.
 */
export function SmithPanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const h = () => props.state.hero;
  const [tab, setTab] = createSignal<Tab>("refinar");
  const [sel, setSel] = createSignal<string | null>(null);
  const [protect, setProtect] = createSignal(false);
  const [outcome, setOutcome] = createSignal<Outcome>(null);

  const worn = () =>
    (Object.values(h().equipment).filter(Boolean) as OwnedItem[]).filter((x) =>
      tab() === "refinar" ? refinable(x) : tab() === "reforjar",
    );
  const bag = () =>
    h().bag.filter((x) =>
      tab() === "refinar"
        ? refinable(x)
        : tab() !== "reforjar" || x.affixes.length > 0,
    );
  const item = createMemo(() => {
    const uid = sel();
    return uid ? (findItem(h(), uid)?.item ?? null) : null;
  });
  const pick = (uid: string) => {
    setOutcome(null);
    setSel(sel() === uid ? null : uid);
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
      ...(protect() ? { protect: true } : {}),
    });
    if (!r?.ok) return;
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
      </Row>
      <Tabs
        label={t`Ferreiro`}
        value={tab()}
        onChange={(v) => {
          setTab(v);
          setOutcome(null);
          setSel(null);
        }}
        items={[
          { id: "refinar", label: t`Refinar` },
          { id: "reforjar", label: t`Reforjar` },
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
        selected={sel() ? [sel()!] : []}
        onToggle={pick}
        note={(it) => `+${it.refine}`}
        empty={<Muted>{t`Nada na mochila serve aqui.`}</Muted>}
        hero={h()}
        price={buyBackPrice}
        hint
      />
      <Show when={tab() === "refinar"}>
        <Muted>{t`Refina arma, armadura e escudo. Colar, anel, focus e aljava não refinam.`}</Muted>
      </Show>

      {/* keyed: cada tentativa é um resultado novo (o Result lê o desfecho uma vez). */}
      <Show when={outcome()} keyed>
        {(o) => <Result outcome={o} item={item()} />}
      </Show>
      <Notice error={cmd.error()} />

      <Show when={item()}>
        {(it) => (
          <Show
            when={tab() === "refinar"}
            fallback={
              <Show
                when={tab() === "reforjar"}
                fallback={
                  <DismantleBox
                    item={it()}
                    worn={
                      !!equippedIn(h(), it().slot as never) &&
                      equippedIn(h(), it().slot as never)!.uid === it().uid
                    }
                    busy={cmd.busy()}
                    onConfirm={async () => {
                      const r = await cmd.run("rpg.smith", {
                        npc: props.npc,
                        action: "desmontar",
                        uid: it().uid,
                      });
                      if (r?.ok) setSel(null);
                    }}
                  />
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
              protect={protect()}
              setProtect={setProtect}
              busy={cmd.busy()}
              onRefine={refine}
            />
          </Show>
        )}
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

function DismantleBox(props: {
  item: OwnedItem;
  worn: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLingui();
  const d = () => dismantle(props.item);
  return (
    <Panel>
      <strong>{t`Desmontar`}</strong>
      <Muted>
        {t`Vira ${d().ore.count} minério de ${d().ore.material}`}
        <Show when={d().essence > 0}> {t`e ${d().essence} Essência`}</Show>.
      </Muted>
      <Confirm
        tone="danger"
        steps={props.item.refine >= 7 ? 2 : 1}
        disabled={props.busy || props.worn}
        label={t`Desmontar`}
        confirm={t`O item some para sempre. Toque de novo`}
        confirm2={t`É +${props.item.refine}: toque mais uma vez`}
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
