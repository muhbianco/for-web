import { For, Show, createMemo, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type RpgHeroState,
  BAG_SLOTS,
  buyBackPrice,
  planTransfer,
  vaultExpansionCost,
  vaultSlots,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ItemGrid } from "./ItemCard";
import { errorText } from "./gameText";
import {
  type GameLink,
  Btn,
  Confirm,
  Gold,
  Muted,
  Notice,
  Panel,
  Row,
  Section,
  Tabs,
  useCommands,
} from "./gameUi";
import { gold } from "./heroModel";

type Tab = "ouro" | "cofre" | "transferir";

/**
 * O Banqueiro (§10, D36): ouro no cofre (sem limite), o cofre de itens (60 espaços, +20 por
 * expansão) e a transferência para outra pessoa, com a taxa calculada antes (2% no ouro, por item
 * pelo nível dele) e a confirmação; item +7 pede duas.
 */
export function BankPanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
  people: { id: string; name: string }[];
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [tab, setTab] = createSignal<Tab>("ouro");
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
      <Row>
        <span>
          {t`Na mão`}: <Gold n={gold(h().gold)} />
        </span>
        <span>
          {t`No cofre`}: <Gold n={gold(h().vault.gold)} />
        </span>
      </Row>
      <Tabs
        label={t`Banqueiro`}
        value={tab()}
        onChange={(v) => {
          setOk(null);
          setTab(v);
        }}
        items={[
          { id: "ouro", label: t`Ouro` },
          { id: "cofre", label: t`Cofre de itens` },
          { id: "transferir", label: t`Transferir` },
        ]}
      />
      <Notice error={cmd.error()} ok={ok()} />
      <Show when={tab() === "ouro"}>
        <GoldBox state={props.state} busy={cmd.busy()} run={run} />
      </Show>
      <Show when={tab() === "cofre"}>
        <VaultBox state={props.state} busy={cmd.busy()} run={run} />
      </Show>
      <Show when={tab() === "transferir"}>
        <TransferBox
          state={props.state}
          people={props.people}
          busy={cmd.busy()}
          run={run}
        />
      </Show>
    </Wrap>
  );
}

type RunFn = (
  type: string,
  d: Record<string, unknown>,
  done: string,
) => Promise<boolean>;

function GoldBox(props: { state: RpgHeroState; busy: boolean; run: RunFn }) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const [amount, setAmount] = createSignal(0);
  const valid = (n: number) => Number.isInteger(n) && n > 0;
  return (
    <Panel>
      <Muted>{t`O ouro no cofre não se gasta sem querer nem vai para a corrida.`}</Muted>
      <Row>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={amount() || ""}
          placeholder={t`Quanto`}
          aria-label={t`Quanto ouro`}
          onInput={(e) =>
            setAmount(Math.floor(Number(e.currentTarget.value)) || 0)
          }
        />
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={() => setAmount(h().gold)}
        >
          {t`tudo na mão`}
        </Btn>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={() => setAmount(h().vault.gold)}
        >
          {t`tudo do cofre`}
        </Btn>
      </Row>
      <Row>
        <Btn
          type="button"
          data-tone="primary"
          disabled={props.busy || !valid(amount()) || amount() > h().gold}
          onClick={() =>
            void props
              .run("rpg.bank", { gold: amount() }, t`Depositado.`)
              .then((o) => o && setAmount(0))
          }
        >
          {t`Depositar`}
        </Btn>
        <Btn
          type="button"
          disabled={props.busy || !valid(amount()) || amount() > h().vault.gold}
          onClick={() =>
            void props
              .run("rpg.bank", { gold: -amount() }, t`Sacado.`)
              .then((o) => o && setAmount(0))
          }
        >
          {t`Sacar`}
        </Btn>
      </Row>
    </Panel>
  );
}

function VaultBox(props: { state: RpgHeroState; busy: boolean; run: RunFn }) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const [sel, setSel] = createSignal<string | null>(null);
  const slots = () => vaultSlots(h().vault.expansions);
  const cost = () => vaultExpansionCost(h().level);
  const inVault = () => !!sel() && h().vault.items.some((x) => x.uid === sel());
  const inBag = () => !!sel() && h().bag.some((x) => x.uid === sel());
  return (
    <>
      <Section aria-label={t`Cofre`}>
        <h3>
          {t`Cofre`} {h().vault.items.length}/{slots()}
        </h3>
        <ItemGrid
          label={t`Itens no cofre`}
          items={h().vault.items}
          selected={sel() ? [sel()!] : []}
          onToggle={(u) => setSel(sel() === u ? null : u)}
          empty={<Muted>{t`O cofre está vazio.`}</Muted>}
          hero={h()}
          price={buyBackPrice}
          hint
        />
      </Section>
      <Section aria-label={t`Mochila`}>
        <h3>
          {t`Mochila`} {h().bag.length}/{BAG_SLOTS}
        </h3>
        <ItemGrid
          label={t`Itens da mochila`}
          items={h().bag}
          selected={sel() ? [sel()!] : []}
          onToggle={(u) => setSel(sel() === u ? null : u)}
          empty={<Muted>{t`A mochila está vazia.`}</Muted>}
          hero={h()}
          price={buyBackPrice}
          hint={h().vault.items.length === 0}
        />
      </Section>
      <Row>
        <Btn
          type="button"
          data-tone="primary"
          disabled={props.busy || !inBag() || h().vault.items.length >= slots()}
          onClick={() =>
            void props
              .run(
                "rpg.vault",
                { action: "guardar", uid: sel() },
                t`Guardado no cofre.`,
              )
              .then((o) => o && setSel(null))
          }
        >
          {t`Guardar no cofre`}
        </Btn>
        <Btn
          type="button"
          disabled={props.busy || !inVault() || h().bag.length >= BAG_SLOTS}
          onClick={() =>
            void props
              .run(
                "rpg.vault",
                { action: "retirar", uid: sel() },
                t`Na mochila.`,
              )
              .then((o) => o && setSel(null))
          }
        >
          {t`Retirar`}
        </Btn>
      </Row>
      <Panel>
        <Row>
          <strong>{t`+20 espaços`}</strong>
          <Gold n={gold(cost())} />
        </Row>
        <Confirm
          disabled={props.busy || cost() > h().gold}
          label={t`Ampliar o cofre`}
          confirm={t`Pagar ${gold(cost())}? Toque de novo`}
          onConfirm={() =>
            void props.run("rpg.vault.expand", {}, t`Cofre ampliado.`)
          }
        />
      </Panel>
    </>
  );
}

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
            disabled={props.busy || !to() || !plan().ok}
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
          <Muted>{t`Fica tudo no registro de transferências.`}</Muted>
        </Panel>
      </Show>
    </>
  );
}

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "12px" },
});
const Input = styled("input", {
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
const Select = styled("select", {
  base: {
    minHeight: "40px",
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
  },
});
