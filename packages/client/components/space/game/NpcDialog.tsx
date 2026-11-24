import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import type { NpcKind } from "@muchat/space-core";
import {
  type JobTier,
  type RpgHeroView,
  cannotEvolve,
  cannotUse,
  EVOLUTION,
  itemDef,
  MERCHANT_SELLS,
  merchantBuys,
  resetCost,
  statPointsSpent,
  treePointsSpent,
  VOCATIONS,
} from "@muchat/space-core/game/ot";
import { styled } from "styled-system/jsx";

import { Button } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { inventoryError, itemIcon, itemLines, itemName } from "./itemUi";
import { useModalKeys } from "./modalKeys";
import { className, rpgLabels, vocationName } from "./rpgUi";

/**
 * Falar com um NPC do jogo idle (docs/espaco/jogo/ot, etapa O8): o mercador (compra e venda),
 * o banqueiro (saldo, depósito, saque e transferência) e o Mestre de evolução (24/11/2026: a 2ª
 * e a 3ª classe, que abrem partes da árvore, e a redistribuição de atributos e habilidades).
 * O servidor confere o NPC e que o herói está ao lado; cada ação volta como o estado novo.
 */
export default function NpcDialog(props: {
  view: SpaceView;
  request: { instance: string; title: string; npc: NpcKind };
  rpg: { hero: RpgHeroView | null } | null;
  /** Quem está no Espaço agora (para a transferência), sem a própria pessoa. */
  people: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const L = rpgLabels();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<"buy" | "sell">("buy");
  const [qty, setQty] = createSignal<Record<string, number>>({});
  const [amount, setAmount] = createSignal(0);
  const [to, setTo] = createSignal<string>("");
  const [confirm, setConfirm] = createSignal<string | null>(null);
  let card: HTMLDivElement | undefined;
  let title: HTMLHeadingElement | undefined;
  const refocus = useModalKeys(
    () => card,
    () => title,
    () => props.onClose(),
  );
  const hero = () => props.rpg?.hero ?? null;
  const carried = () => hero()?.gold ?? 0;
  const bank = () => hero()?.bank_gold ?? 0;
  const inRun = () => !!hero()?.run;

  let pending: { id: string; ok: string } | null = null;
  const off = props.view.onGame((e: GameWireEvent) => {
    if (!pending || e.re !== pending.id) return;
    const ok = pending.ok;
    pending = null;
    setBusy(false);
    setConfirm(null);
    queueMicrotask(refocus);
    if (e.t === "error") {
      const d = e.d as { code?: string; reason?: string };
      setError(npcError(d.code, d.reason));
      return;
    }
    setDone(ok);
  });
  onCleanup(off);

  function send(type: string, d: Record<string, unknown>, ok: string) {
    if (busy()) return;
    setBusy(true);
    setError(null);
    setDone(null);
    pending = {
      id: props.view.gameSend(type, { npc: props.request.instance, ...d }),
      ok,
    };
  }

  /** As recusas que só o NPC tem; o resto vem do inventário e do jogo. */
  function npcError(code?: string, reason?: string): string {
    if (code === "not_allowed" && reason === "too_far")
      return t`Chegue mais perto para falar.`;
    if (code === "not_found") return t`Este NPC não está mais aqui.`;
    switch (reason) {
      case "no_money":
        return t`Não dá: falta dinheiro (nas moedas e no banco).`;
      case "not_sold":
        return t`Isso ele não vende.`;
      case "not_bought":
        return t`Isso ele não compra.`;
      case "self":
        return t`Você não pode transferir para você mesmo.`;
      case "not_here":
        return t`Essa pessoa não está no Espaço agora.`;
      case "no_hero":
        return t`Essa pessoa ainda não escolheu a vocação.`;
      case "busy":
        return t`Há transferências demais a caminho. Espere um pouco.`;
      case "promoted":
      case "max_tier":
        return t`Seu herói já está na última classe.`;
      case "level":
        return t`Falta level para a evolução.`;
      case "points":
        return t`Faltam pontos postos na árvore de habilidades (treine no dummy de habilidade).`;
      case "nothing_to_reset":
        return t`Não há pontos postos para redistribuir.`;
    }
    return inventoryError(reason) ?? L.error(code ?? "internal", reason);
  }

  const money = (n: number) => n.toLocaleString();
  const sellable = createMemo(() =>
    (hero()?.inventory.pack ?? [])
      .map((x, index) => ({ x, index, price: merchantBuys(x.item) }))
      .filter((r) => r.price !== null),
  );

  const subtitle = () => {
    if (props.request.npc === "mercador")
      return t`Compra o loot e o kit; o que ele vende, recompra pela metade. Vende munição, poções, mochilas, anéis e colares.`;
    if (props.request.npc === "banqueiro")
      return t`Guarda suas moedas sem peso e transfere para quem está no Espaço.`;
    return t`Evolui a classe do herói, o que abre partes da árvore de habilidades, e redistribui atributos e habilidades.`;
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
        aria-labelledby="rpg-npc-title"
      >
        <Head>
          <div>
            <h2 id="rpg-npc-title" tabIndex={-1} ref={title}>
              {props.request.title}
            </h2>
            <Muted>{subtitle()}</Muted>
          </div>
          <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
            ×
          </Close>
        </Head>

        <Show
          when={hero() && hero()!.vocation !== 0}
          fallback={
            <p>{t`Escolha a vocação do seu herói num dummy de treino primeiro.`}</p>
          }
        >
          <Purse>
            <span>
              <Symbol size={16}>toll</Symbol>
              {t`Carrega ${money(carried())}`}
            </span>
            <span>
              <Symbol size={16}>account_balance</Symbol>
              {t`Banco ${money(bank())}`}
            </span>
          </Purse>
          <Show when={inRun()}>
            <Notice role="status">
              {t`O herói está numa dungeon: volte quando a corrida acabar.`}
            </Notice>
          </Show>

          {/* ---- mercador ---- */}
          <Show when={props.request.npc === "mercador"}>
            <Tabs role="tablist">
              <TabBtn
                type="button"
                role="tab"
                aria-selected={tab() === "buy"}
                onClick={() => setTab("buy")}
              >
                {t`Comprar`}
              </TabBtn>
              <TabBtn
                type="button"
                role="tab"
                aria-selected={tab() === "sell"}
                onClick={() => setTab("sell")}
              >
                {t`Vender`}
              </TabBtn>
            </Tabs>
            <Show when={tab() === "buy"}>
              <Rows>
                <For each={MERCHANT_SELLS}>
                  {(o) => {
                    const def = itemDef(o.item);
                    const stack = !!def?.stackable;
                    const n = () => qty()[o.item] ?? (stack ? 100 : 1);
                    const total = () => o.price * n();
                    // O que o herói não usa (vocação ou level): aviso à vista e confirmação.
                    const why = () => {
                      const h = hero();
                      if (!h || !def || def.slot === null) return null;
                      const r = cannotUse(
                        def,
                        VOCATIONS[h.vocation].base,
                        h.level,
                      );
                      return r === "vocation" || r === "level" ? r : null;
                    };
                    const key = `buy:${o.item}`;
                    return (
                      <ShopRow
                        title={
                          def
                            ? itemLines(def, null, vocationName).join("\n")
                            : ""
                        }
                      >
                        <Symbol size={20}>{itemIcon(def)}</Symbol>
                        <span>
                          <strong>{itemName(o.item)}</strong>
                          <Muted>{t`${money(o.price)} cada`}</Muted>
                          <Show when={why()}>
                            {(w) => (
                              <Warn>
                                {w() === "level"
                                  ? t`Seu herói só usa a partir do level ${def?.minLevel ?? 0}`
                                  : t`A vocação do seu herói não usa`}
                              </Warn>
                            )}
                          </Show>
                        </span>
                        <Show when={stack} fallback={<span />}>
                          <Qty
                            type="number"
                            min={1}
                            max={100}
                            value={n()}
                            aria-label={t`Quantidade`}
                            onInput={(e) => {
                              const v = Math.max(
                                1,
                                Math.min(
                                  100,
                                  Math.floor(
                                    Number(e.currentTarget.value) || 1,
                                  ),
                                ),
                              );
                              setQty({ ...qty(), [o.item]: v });
                            }}
                          />
                        </Show>
                        <Button
                          size="xs"
                          variant="tonal"
                          isDisabled={
                            busy() || inRun() || total() > carried() + bank()
                          }
                          onPress={() => {
                            if (why() && confirm() !== key)
                              return setConfirm(key);
                            send(
                              "rpg.shop.buy",
                              { item: o.item, count: n() },
                              t`Comprado.`,
                            );
                          }}
                        >
                          {why() && confirm() === key
                            ? t`Confirmar: comprar por ${money(total())}`
                            : t`Comprar por ${money(total())}`}
                        </Button>
                      </ShopRow>
                    );
                  }}
                </For>
              </Rows>
              <Muted>
                {t`Paga com as moedas que você carrega; se faltar, com o banco. O troco volta nas moedas maiores.`}
              </Muted>
            </Show>
            <Show when={tab() === "sell"}>
              <Show
                when={sellable().length > 0}
                fallback={<Muted>{t`Nada na mochila que ele compre.`}</Muted>}
              >
                <Rows>
                  <For each={sellable()}>
                    {(r) => (
                      <ShopRow>
                        <Symbol size={20}>{itemIcon(itemDef(r.x.item))}</Symbol>
                        <span>
                          <strong>
                            {r.x.count > 1
                              ? `${r.x.count}× ${itemName(r.x.item)}`
                              : itemName(r.x.item)}
                          </strong>
                          <Muted>{t`${money(r.price!)} cada`}</Muted>
                        </span>
                        <span />
                        <Button
                          size="xs"
                          variant="tonal"
                          isDisabled={busy() || inRun()}
                          onPress={() =>
                            send(
                              "rpg.shop.sell",
                              {
                                index: r.index,
                                item: r.x.item,
                                count: r.x.count,
                              },
                              t`Vendido.`,
                            )
                          }
                        >
                          {t`Vender por ${money(r.price! * r.x.count)}`}
                        </Button>
                      </ShopRow>
                    )}
                  </For>
                </Rows>
              </Show>
            </Show>
          </Show>

          {/* ---- banqueiro ---- */}
          <Show when={props.request.npc === "banqueiro"}>
            <Field>
              <span>{t`Valor em ouro`}</span>
              <Qty
                type="number"
                min={0}
                value={amount() || ""}
                aria-label={t`Valor em ouro`}
                onInput={(e) =>
                  setAmount(
                    Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)),
                  )
                }
              />
            </Field>
            <Row>
              <Button
                size="xs"
                variant="filled"
                isDisabled={busy() || inRun() || carried() === 0}
                onPress={() =>
                  send("rpg.bank.deposit", { amount: 0 }, t`Depositado.`)
                }
              >
                {t`Depositar tudo (${money(carried())})`}
              </Button>
              <Button
                size="xs"
                variant="tonal"
                isDisabled={
                  busy() || inRun() || amount() <= 0 || amount() > carried()
                }
                onPress={() =>
                  send("rpg.bank.deposit", { amount: amount() }, t`Depositado.`)
                }
              >
                {t`Depositar`}
              </Button>
              <Button
                size="xs"
                variant="tonal"
                isDisabled={
                  busy() || inRun() || amount() <= 0 || amount() > bank()
                }
                onPress={() =>
                  send("rpg.bank.withdraw", { amount: amount() }, t`Sacado.`)
                }
              >
                {t`Sacar`}
              </Button>
            </Row>
            <Field>
              <span>{t`Transferir do banco para`}</span>
              <select
                value={to()}
                aria-label={t`Para quem`}
                onChange={(e) => setTo(e.currentTarget.value)}
              >
                <option value="">{t`Escolha quem está no Espaço`}</option>
                <For each={props.people}>
                  {(p) => <option value={p.id}>{p.name}</option>}
                </For>
              </select>
            </Field>
            <Row>
              <Button
                size="xs"
                variant="tonal"
                isDisabled={
                  busy() ||
                  inRun() ||
                  !to() ||
                  amount() <= 0 ||
                  amount() > bank()
                }
                onPress={() => {
                  const key = `${to()}:${amount()}`;
                  if (confirm() !== key) return setConfirm(key);
                  send(
                    "rpg.bank.transfer",
                    { amount: amount(), to: to() },
                    t`Transferido.`,
                  );
                }}
              >
                {confirm() === `${to()}:${amount()}`
                  ? t`Confirmar: transferir ${money(amount())}`
                  : t`Transferir`}
              </Button>
            </Row>
            <Muted>
              {t`O banco não pesa. Sacar só funciona se as moedas couberem na mochila.`}
            </Muted>
          </Show>

          {/* ---- mestre de evolução (24/11/2026) ---- */}
          <Show when={props.request.npc === "mestre"}>
            {(_) => {
              const h = () => hero()!;
              const tier = () => h().job;
              const next = () =>
                tier() < 3 ? EVOLUTION[(tier() + 1) as 2 | 3] : null;
              const spent = () => treePointsSpent(h().tree);
              const why = () =>
                cannotEvolve(h().vocation, tier(), h().level, spent());
              const nextName = () =>
                className(
                  tier() === 1 ? h().vocation + 4 : h().vocation,
                  (tier() + 1) as JobTier,
                );
              const reset = (what: "stats" | "tree") =>
                resetCost(h().level, h().resets[what]);
              return (
                <>
                  <p>
                    {t`Classe agora: ${className(h().vocation, tier())} (${tier()}ª).`}
                  </p>
                  <Show
                    when={next()}
                    fallback={
                      <Muted>{t`Seu herói já está na última classe.`}</Muted>
                    }
                  >
                    {(n) => (
                      <>
                        <p>
                          {t`Evoluir para ${nextName()}: level ${n().level}, ${n().points} pontos na árvore (você tem ${spent()}) e ${money(n().cost)} de ouro (das moedas e do banco).`}
                        </p>
                        <Muted>
                          {tier() === 1
                            ? t`A 2ª classe recupera vida e mana mais depressa, como a promoção do OT, e abre a 2ª parte da árvore.`
                            : t`A 3ª classe abre a última parte da árvore.`}
                        </Muted>
                        <Row>
                          <Button
                            size="xs"
                            variant="filled"
                            isDisabled={
                              busy() ||
                              inRun() ||
                              !!why() ||
                              carried() + bank() < n().cost
                            }
                            onPress={() => {
                              if (confirm() !== "promote")
                                return setConfirm("promote");
                              send("rpg.promote", {}, t`Evoluiu!`);
                            }}
                          >
                            {confirm() === "promote"
                              ? t`Confirmar: evoluir por ${money(n().cost)}`
                              : t`Evoluir`}
                          </Button>
                        </Row>
                        <Show when={why()}>
                          {(w) => <Muted>{npcError("rpg_invalid", w())}</Muted>}
                        </Show>
                      </>
                    )}
                  </Show>
                  <strong>{t`Redistribuir`}</strong>
                  <Muted>
                    {t`Os pontos postos voltam a ficar livres. A primeira vez de cada é de graça; depois, 500 de ouro por level.`}
                  </Muted>
                  <Row>
                    <Button
                      size="xs"
                      variant="tonal"
                      isDisabled={
                        busy() ||
                        inRun() ||
                        statPointsSpent(h().stats) === 0 ||
                        carried() + bank() < reset("stats")
                      }
                      onPress={() => {
                        if (confirm() !== "reset-stats")
                          return setConfirm("reset-stats");
                        send(
                          "rpg.reset",
                          { what: "stats" },
                          t`Atributos livres de novo.`,
                        );
                      }}
                    >
                      {confirm() === "reset-stats"
                        ? reset("stats") === 0
                          ? t`Confirmar: atributos (grátis)`
                          : t`Confirmar: atributos por ${money(reset("stats"))}`
                        : t`Atributos`}
                    </Button>
                    <Button
                      size="xs"
                      variant="tonal"
                      isDisabled={
                        busy() ||
                        inRun() ||
                        spent() === 0 ||
                        carried() + bank() < reset("tree")
                      }
                      onPress={() => {
                        if (confirm() !== "reset-tree")
                          return setConfirm("reset-tree");
                        send(
                          "rpg.reset",
                          { what: "tree" },
                          t`Pontos de habilidade livres de novo.`,
                        );
                      }}
                    >
                      {confirm() === "reset-tree"
                        ? reset("tree") === 0
                          ? t`Confirmar: habilidades (grátis)`
                          : t`Confirmar: habilidades por ${money(reset("tree"))}`
                        : t`Habilidades`}
                    </Button>
                  </Row>
                </>
              );
            }}
          </Show>
        </Show>

        <Show when={done()}>
          {(msg) => <DoneText role="status">{msg()}</DoneText>}
        </Show>
        <Show when={error()}>
          {(msg) => <ErrorText role="alert">{msg()}</ErrorText>}
        </Show>
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
    // Lays itself out by its own width (container queries), not the window's.
    containerType: "inline-size",
    maxWidth: "520px",
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
    "& p": { margin: 0, lineHeight: 1.5 },
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
    // A finger needs room: 44 px on touch screens.
    "@media (pointer: coarse)": {
      minWidth: "44px",
      minHeight: "44px",
      display: "inline-grid",
      placeItems: "center",
    },
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "1.4em",
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
  },
});

const Purse = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 16px",
    "& > span": { display: "inline-flex", alignItems: "center", gap: "4px" },
  },
});

const Notice = styled("p", {
  base: {
    padding: "6px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-secondary-container)",
    color: "var(--md-sys-color-on-secondary-container)",
  },
});

const Tabs = styled("div", { base: { display: "flex", gap: "6px" } });

const TabBtn = styled("button", {
  base: {
    "@media (pointer: coarse)": { minHeight: "40px", paddingInline: "16px" },
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    borderRadius: "999px",
    padding: "4px 14px",
    cursor: "pointer",
    '&[aria-selected="true"]': {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
  },
});

const Rows = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});

const ShopRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto auto",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "& > span": { display: "flex", flexDirection: "column" },
    // A phone: the name (and its warning) on its own line, quantity and
    // button below it, instead of a name squeezed into a sliver.
    "@container (max-width: 460px)": {
      gridTemplateColumns: "auto auto 1fr",
      "& > :nth-child(2)": { gridColumn: "2 / -1" },
      "& > :nth-child(3)": { gridColumn: "2" },
      "& > :nth-child(4)": { gridColumn: "3", justifySelf: "end" },
    },
  },
});

const Qty = styled("input", {
  base: {
    width: "64px",
    padding: "4px 6px",
    borderRadius: "8px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "inherit",
    "@media (pointer: coarse)": { minHeight: "44px", width: "76px" },
  },
});

const Field = styled("label", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    "& select": {
      padding: "4px 6px",
      borderRadius: "8px",
      border: "1px solid var(--md-sys-color-outline-variant)",
      background: "var(--md-sys-color-surface-container-highest)",
      color: "inherit",
    },
    "@media (pointer: coarse)": {
      "& select, & input": { minHeight: "44px" },
    },
  },
});

const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const DoneText = styled("p", {
  base: { color: "var(--md-sys-color-primary)" },
});

const Warn = styled("span", {
  base: { color: "var(--md-sys-color-error)", fontSize: "0.85em" },
});

const ErrorText = styled("p", {
  base: { color: "var(--md-sys-color-error)" },
});
