import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type AmmoGrade,
  type ItemBase,
  type PotionSize,
  type RpgHeroState,
  AMMO_GRADES,
  ARMOR_SLOTS,
  BAG_SLOTS,
  CLASSES,
  FAMILIES,
  ammoPackPrice,
  buyBackPrice,
  commonItemPrice,
  generateItem,
  sellNeedsConfirm,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ItemCard, ItemGrid } from "./ItemCard";
import { sizeName, slotName, weightName } from "./gameText";
import {
  type GameLink,
  Btn,
  Confirm,
  Gold,
  Muted,
  Notice,
  Panel,
  Row,
  Stepper,
  Tabs,
  useCommands,
} from "./gameUi";
import { bagMarks, beltOptions, gold, num, pct } from "./heroModel";

type Tab = "pocoes" | "municao" | "itens" | "vender";

/**
 * O Mercador (§10): poções por tamanho (D35), munição em pacotes de 100, equipamento Comum do tier
 * e a compra dos itens do jogador por 10% do preço base. Toda compra mostra o total e o ouro que
 * sobra antes do toque; vender pede confirmação, e o item +7 duas.
 */
export function MerchantPanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [tab, setTab] = createSignal<Tab>("pocoes");
  const [ok, setOk] = createSignal<string | null>(null);
  const h = () => props.state.hero;
  const ranged = () => {
    const f = h().equipment.arma?.family;
    return !!f && FAMILIES[f].kind === "ranged";
  };
  const buy = async (buy: Record<string, unknown>, done: string) => {
    setOk(null);
    const r = await cmd.run("rpg.shop.buy", { npc: props.npc, buy });
    if (r?.ok) setOk(done);
  };

  return (
    <Wrap>
      <Row>
        <Gold n={gold(h().gold)} />
        <Muted>{t`Mochila ${h().bag.length}/${BAG_SLOTS}`}</Muted>
      </Row>
      <Tabs
        label={t`Mercador`}
        value={tab()}
        onChange={(v) => {
          setOk(null);
          setTab(v);
        }}
        items={[
          { id: "pocoes", label: t`Poções` },
          { id: "municao", label: t`Munição` },
          { id: "itens", label: t`Equipamento` },
          { id: "vender", label: t`Vender` },
        ]}
      />
      <Notice error={cmd.error()} ok={ok()} />
      <Show when={tab() === "pocoes"}>
        <Potions state={props.state} busy={cmd.busy()} onBuy={buy} />
      </Show>
      <Show when={tab() === "municao"}>
        <Show when={!ranged()}>
          <Muted role="note">
            {t`Munição é para arco e besta: a sua arma não gasta flechas.`}
          </Muted>
        </Show>
        <For each={Object.keys(AMMO_GRADES) as AmmoGrade[]}>
          {(g) => (
            <Ammo grade={g} state={props.state} busy={cmd.busy()} onBuy={buy} />
          )}
        </For>
      </Show>
      <Show when={tab() === "itens"}>
        <Show when={props.state.run}>
          <Muted role="note">
            {t`Durante a corrida o Mercador só vende poção e munição. Equipamento, quando ela acabar.`}
          </Muted>
        </Show>
        <Commons
          state={props.state}
          busy={cmd.busy() || !!props.state.run}
          onBuy={buy}
        />
      </Show>
      <Show when={tab() === "vender"}>
        <Sell
          link={props.link}
          npc={props.npc}
          state={props.state}
          onDone={(n, g) =>
            setOk(t`Vendido: ${n} itens por ${gold(g)} de ouro.`)
          }
        />
      </Show>
    </Wrap>
  );
}

type BuyFn = (buy: Record<string, unknown>, done: string) => void;

function Potions(props: { state: RpgHeroState; busy: boolean; onBuy: BuyFn }) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const kinds = [
    { kind: "hp" as const, label: () => t`Poção de vida` },
    { kind: "mp" as const, label: () => t`Poção de mana` },
  ];
  return (
    <>
      <Muted>
        {t`A cura é fixa pela faixa do seu nível; as três curam o mesmo por segundo. O tamanho que vai no cinto você troca no Equipamento.`}
      </Muted>
      <Cards>
        <For each={kinds}>
          {(k) => (
            <For each={beltOptions(h(), k.kind)}>
              {(o) => {
                const [n, setN] = createSignal(10);
                const max = () =>
                  Math.max(1, Math.min(10_000, Math.floor(h().gold / o.price)));
                const total = () => o.price * n();
                const short = () => total() - h().gold;
                return (
                  <Panel>
                    <Row>
                      <strong>
                        {k.label()}{" "}
                        {sizeName(o.size as PotionSize).toLowerCase()}
                      </strong>
                      <Show when={o.equipped}>
                        <Tag>{t`no cinto`}</Tag>
                      </Show>
                    </Row>
                    <Muted>
                      {t`cura ${num(o.heal)} · recarga ${o.cooldownS} s · você tem ${o.stock}`}
                    </Muted>
                    <Row>
                      <Gold n={gold(o.price)} />
                      <Muted>{t`cada`}</Muted>
                    </Row>
                    <Stepper
                      label={t`Quantidade`}
                      value={n()}
                      max={max()}
                      onChange={setN}
                      quick={[10, 50]}
                    />
                    <Row>
                      <Btn
                        type="button"
                        data-tone="primary"
                        disabled={props.busy || short() > 0}
                        onClick={() =>
                          props.onBuy(
                            {
                              kind: "pocao",
                              type: k.kind,
                              size: o.size,
                              count: n(),
                            },
                            t`Comprou ${n()} poções.`,
                          )
                        }
                      >
                        {t`Comprar por ${gold(total())}`}
                      </Btn>
                      <Muted>
                        {short() > 0
                          ? t`faltam ${gold(short())} de ouro`
                          : t`sobra ${gold(h().gold - total())}`}
                      </Muted>
                    </Row>
                  </Panel>
                );
              }}
            </For>
          )}
        </For>
      </Cards>
    </>
  );
}

function Ammo(props: {
  grade: AmmoGrade;
  state: RpgHeroState;
  busy: boolean;
  onBuy: BuyFn;
}) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const p = () => ammoPackPrice(props.grade, h().level);
  const [n, setN] = createSignal(1);
  const max = () => Math.max(1, Math.floor(h().gold / p().gold));
  const name = () =>
    props.grade === "comum"
      ? t`Comum`
      : props.grade === "afiada"
        ? t`Afiada`
        : t`Rúnica`;
  return (
    <Panel>
      <Row>
        <strong>{t`Munição ${name()}`}</strong>
        <Muted>
          {t`+${pct(AMMO_GRADES[props.grade])} de ATQ à distância · você tem ${h().ammo[props.grade] ?? 0}`}
        </Muted>
      </Row>
      <Row>
        <Gold n={gold(p().gold)} />
        <Muted>{t`o pacote de ${p().units}`}</Muted>
      </Row>
      <Stepper
        label={t`Pacotes`}
        value={n()}
        max={max()}
        onChange={setN}
        quick={[5, 10]}
      />
      <Btn
        type="button"
        data-tone="primary"
        disabled={props.busy || p().gold * n() > h().gold}
        onClick={() =>
          props.onBuy(
            { kind: "municao", grade: props.grade, packs: n() },
            t`Comprou ${n() * p().units} unidades.`,
          )
        }
      >
        {t`Comprar ${n() * p().units} por ${gold(p().gold * n())}`}
      </Btn>
      <Muted>{t`Na corrida vai a melhor que você tiver; gasta 1 por ataque básico.`}</Muted>
    </Panel>
  );
}

/** O que a classe veste, primeiro (o resto atrás de "mostrar tudo"). */
function basesFor(cls: RpgHeroState["hero"]["cls"], all: boolean): ItemBase[] {
  const c = CLASSES[cls];
  const fams = all
    ? (Object.keys(FAMILIES) as (keyof typeof FAMILIES)[])
    : c.weapons;
  const out: ItemBase[] = fams.map((family) => ({ slot: "arma", family }));
  for (const off of all ? (["escudo", "focus", "aljava"] as const) : c.offhands)
    out.push({ slot: "secundaria", offhand: off });
  for (const slot of ARMOR_SLOTS) out.push({ slot, weight: c.armor });
  out.push({ slot: "colar" }, { slot: "anel" });
  return out;
}

function Commons(props: { state: RpgHeroState; busy: boolean; onBuy: BuyFn }) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const [all, setAll] = createSignal(false);
  const [i, setI] = createSignal(0);
  const price = () => commonItemPrice(h().level);
  const bases = () => basesFor(h().cls, all());
  const base = () => bases()[Math.min(i(), bases().length - 1)]!;
  const label = (b: ItemBase) =>
    b.slot === "arma"
      ? FAMILIES[b.family].name
      : b.slot === "secundaria"
        ? b.offhand === "escudo"
          ? t`Escudo`
          : b.offhand === "focus"
            ? t`Focus`
            : t`Aljava`
        : "weight" in b
          ? `${slotName(b.slot)} (${weightName(b.weight)})`
          : slotName(b.slot);
  const sample = createMemo(() =>
    generateItem(base(), price().ilvl, "comum", { next: () => 0.5 }),
  );
  return (
    <>
      <Muted>
        {t`Equipamento Comum do nível ${price().ilvl} (o do seu tier de poção). Um bom tapa-buraco até cair coisa melhor.`}
      </Muted>
      <Row>
        <label>
          <Muted>{t`Peça`} </Muted>
          <Select
            value={i()}
            onChange={(e) => setI(Number(e.currentTarget.value))}
          >
            <For each={bases()}>
              {(b, j) => <option value={j()}>{label(b)}</option>}
            </For>
          </Select>
        </label>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={() => {
            setAll(!all());
            setI(0);
          }}
        >
          {all() ? t`Só o que a classe usa` : t`Mostrar tudo`}
        </Btn>
      </Row>
      <ItemCard
        hero={h()}
        item={sample()}
        actions={
          <>
            <Btn
              type="button"
              data-tone="primary"
              disabled={
                props.busy ||
                price().gold > h().gold ||
                h().bag.length >= BAG_SLOTS
              }
              onClick={() =>
                props.onBuy(
                  { kind: "item", base: base() },
                  t`Comprado: está na mochila.`,
                )
              }
            >
              {t`Comprar por ${gold(price().gold)}`}
            </Btn>
            <Show when={base().slot === "colar" || base().slot === "anel"}>
              <Muted>{t`Colar e anel vêm com 1 afixo sorteado.`}</Muted>
            </Show>
          </>
        }
      />
    </>
  );
}

function Sell(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
  onDone: (n: number, gold: number) => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [sel, setSel] = createSignal<string[]>([]);
  const h = () => props.state.hero;
  const marks = createMemo(() => bagMarks(h()));
  const chosen = () => h().bag.filter((x) => sel().includes(x.uid));
  const total = () => chosen().reduce((a, x) => a + buyBackPrice(x), 0);
  const risky = () => chosen().filter((x) => sellNeedsConfirm(x));
  const ups = () =>
    chosen().filter((x) => marks()[x.uid]?.mark === "up").length;
  const toggle = (uid: string) =>
    setSel(
      sel().includes(uid) ? sel().filter((x) => x !== uid) : [...sel(), uid],
    );
  // Um comando para a lista inteira (tudo ou nada): item por item, uma mochila cheia passava do
  // limite de comandos por segundo e a venda parava no meio.
  const sell = async () => {
    const list = chosen();
    const g = total();
    const r = await cmd.run("rpg.shop.sell.many", {
      npc: props.npc,
      uids: list.map((x) => x.uid),
      ...(risky().length > 0 ? { confirm: true } : {}),
    });
    setSel([]);
    if (r?.ok) props.onDone(list.length, g);
  };
  return (
    <>
      <Muted>{t`O Mercador paga 10% do preço base; o refino não entra no preço.`}</Muted>
      <ItemGrid
        label={t`Itens da mochila`}
        items={h().bag}
        selected={sel()}
        onToggle={toggle}
        mark={(uid) => marks()[uid]?.mark}
        note={(it) => gold(buyBackPrice(it))}
        empty={<Muted>{t`A mochila está vazia.`}</Muted>}
        hero={h()}
        price={buyBackPrice}
        hint
      />
      <Row>
        <Show when={h().bag.length > 0 && sel().length < h().bag.length}>
          <Btn
            type="button"
            data-size="sm"
            data-tone="quiet"
            onClick={() => setSel(h().bag.map((x) => x.uid))}
          >
            {t`Selecionar tudo`}
          </Btn>
        </Show>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={() =>
            setSel(
              h()
                .bag.filter(
                  (x) =>
                    marks()[x.uid]?.mark === "blocked" && !sellNeedsConfirm(x),
                )
                .map((x) => x.uid),
            )
          }
        >
          {t`Marcar o que não dá para vestir`}
        </Btn>
        <Show when={sel().length > 0}>
          <Btn
            type="button"
            data-size="sm"
            data-tone="quiet"
            onClick={() => setSel([])}
          >
            {t`Limpar`}
          </Btn>
        </Show>
      </Row>
      <Show when={sel().length > 0}>
        <Panel>
          <Row>
            <strong>{t`${sel().length} itens`}</strong>
            <Gold n={gold(total())} />
          </Row>
          <Show when={ups() > 0}>
            <Muted role="note">
              ⚠ {t`${ups()} deles é melhor que o que você veste.`}
            </Muted>
          </Show>
          <Show when={risky().length > 0}>
            <Muted role="note">
              ⚠ {t`${risky().length} item é +7 ou mais.`}
            </Muted>
          </Show>
          <Confirm
            tone="primary"
            steps={risky().length > 0 ? 2 : 1}
            disabled={cmd.busy()}
            label={t`Vender por ${gold(total())}`}
            confirm={t`Vender ${sel().length} itens? Não dá para desfazer`}
            confirm2={t`Tem item +7: toque mais uma vez`}
            onConfirm={sell}
          />
          <Notice error={cmd.error()} />
        </Panel>
      </Show>
    </>
  );
}

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "12px" },
});
const Cards = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: "8px",
  },
});
const Tag = styled("span", {
  base: {
    fontSize: "0.72rem",
    fontWeight: 700,
    padding: "1px 8px",
    borderRadius: "999px",
    background: "var(--md-sys-color-primary-container)",
    color: "var(--md-sys-color-on-primary-container)",
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
