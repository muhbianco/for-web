import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent, SpaceView } from "@muchat/space-client";
import type { NpcKind } from "@muchat/space-core";
import {
  type ItemDef,
  type JobTier,
  type RpgHeroView,
  type Slot,
  canDrink,
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

import { gameFrame } from "./gameTheme";
import { Deltas } from "./ItemBits";
import {
  compareItems,
  inventoryError,
  itemIcon,
  itemLines,
  itemName,
  statsLine,
} from "./itemUi";
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

  // ---- mercador (24/11/2026) ----
  const [filter, setFilter] = createSignal<ShopFilter>("mine");
  const [picked, setPicked] = createSignal<string[]>([]);
  const base = () => VOCATIONS[hero()?.vocation ?? 0].base;
  const level = () => hero()?.level ?? 1;
  const equipped = (slot: Slot) =>
    itemDef(hero()?.inventory.equip[slot]?.item ?? "");
  /** O herói usa? Poção: pode beber; munição: a da arma vestida; o resto: vocação e level. */
  const usable = (d: ItemDef) => {
    if (d.potion) return canDrink(d, base(), level());
    if (d.slot === "municao")
      return !!d.ammo && equipped("arma")?.ammo === d.ammo;
    // A mochila só se for maior que a vestida.
    if (d.slot === "mochila")
      return (d.container ?? 0) > (equipped("mochila")?.container ?? 0);
    if (d.slot === null) return true;
    return cannotUse(d, base(), level()) === null;
  };
  const offers = (f: ShopFilter) =>
    MERCHANT_SELLS.filter((o) => {
      const d = itemDef(o.item);
      if (!d) return false;
      if (f === "all") return true;
      if (f === "mine") return usable(d);
      return shopCategory(d) === f;
    });
  const filterLabel = (f: ShopFilter) => {
    switch (f) {
      case "mine":
        return t`Para mim`;
      case "gear":
        return t`Equipamento`;
      case "acc":
        return t`Anéis e colares`;
      case "potions":
        return t`Poções`;
      case "ammo":
        return t`Munição`;
      default:
        return t`Tudo`;
    }
  };
  /** A troca pelo vestido no mesmo lugar (null: não se veste, ou não há herói). */
  const compareTo = (d: ItemDef | undefined) =>
    d && d.slot && d.slot !== "mochila" && d.slot !== "municao" && hero()
      ? compareItems(d, equipped(d.slot))
      : null;
  /** O que não serve: o que a vocação não usa, o pior que o vestido e o frasco vazio. */
  const isJunk = (d: ItemDef | undefined) => {
    if (!d) return false;
    if (d.id.startsWith("frasco")) return true;
    if (!d.slot || d.slot === "mochila" || d.slot === "municao") return false;
    const why = cannotUse(d, base(), level());
    // O de level mais alto ainda vai servir: fica.
    if (why === "vocation") return true;
    if (why !== null) return false;
    return !compareItems(d, equipped(d.slot)).some((x) => x.delta > 0);
  };
  const markJunk = () => {
    setConfirm(null);
    setPicked([
      ...new Set(
        sellable()
          .filter((r) => isJunk(itemDef(r.x.item)))
          .map((r) => r.x.item),
      ),
    ]);
  };
  const pickedTotal = () =>
    sellable()
      .filter((r) => picked().includes(r.x.item))
      .reduce((n, r) => n + r.price! * r.x.count, 0);
  /** Um comando e a resposta dele (a venda em lote espera uma antes da outra: a mochila muda). */
  const request = (type: string, d: Record<string, unknown>) =>
    new Promise<GameWireEvent>((resolve) => {
      const id = props.view.gameSend(type, {
        npc: props.request.instance,
        ...d,
      });
      const stop = props.view.onGame((e) => {
        if (e.re !== id) return;
        stop();
        clearTimeout(timer);
        resolve(e);
      });
      const timer = setTimeout(() => {
        stop();
        resolve({ t: "error", d: { code: "internal" } });
      }, 10_000);
    });
  async function sellMany() {
    if (busy()) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setConfirm(null);
    let sold = 0;
    let gold = 0;
    try {
      for (const item of picked()) {
        // Todas as pilhas do item, uma por vez (o índice muda a cada venda).
        for (let k = 0; k < 20; k++) {
          const pack = hero()?.inventory.pack ?? [];
          const index = pack.findIndex((x) => x.item === item);
          if (index < 0) break;
          const count = pack[index]!.count;
          const res = await request("rpg.shop.sell", { index, item, count });
          if (res.t === "error") {
            const d = res.d as { code?: string; reason?: string };
            setError(npcError(d.code, d.reason));
            return;
          }
          sold += count;
          gold += (merchantBuys(item) ?? 0) * count;
        }
      }
    } finally {
      setPicked([]);
      setBusy(false);
      queueMicrotask(refocus);
      if (sold > 0) setDone(t`Vendido: ${sold} itens por ${money(gold)}.`);
    }
  }

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
        style={gameFrame}
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

          {/* ---- mercador (24/11/2026: filtros, comparação, quantidade e venda em lote) ---- */}
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
                <Show when={sellable().length > 0}>
                  <Count>{sellable().length}</Count>
                </Show>
              </TabBtn>
            </Tabs>
            <Show when={tab() === "buy"}>
              <Filters role="group" aria-label={t`Mostrar`}>
                <For each={SHOP_FILTERS}>
                  {(f) => (
                    <FilterBtn
                      type="button"
                      aria-pressed={filter() === f}
                      onClick={() => setFilter(f)}
                    >
                      {filterLabel(f)}
                      <Count>{offers(f).length}</Count>
                    </FilterBtn>
                  )}
                </For>
              </Filters>
              <Rows>
                <For
                  each={offers(filter())}
                  fallback={
                    <Muted>{t`Nada nesta categoria para o seu herói.`}</Muted>
                  }
                >
                  {(o) => {
                    const def = itemDef(o.item);
                    const stack = !!def?.stackable;
                    const most = () =>
                      Math.max(
                        1,
                        Math.min(
                          100,
                          Math.floor((carried() + bank()) / o.price),
                        ),
                      );
                    // A pilha começa no que o dinheiro paga (até 50), não num número que falta.
                    const n = () =>
                      qty()[o.item] ?? (stack ? Math.min(50, most()) : 1);
                    const total = () => o.price * n();
                    const left = () => carried() + bank() - total();
                    const setN = (v: number) =>
                      setQty({
                        ...qty(),
                        [o.item]: Math.max(
                          1,
                          Math.min(100, Math.floor(v) || 1),
                        ),
                      });
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
                    const versus = () => compareTo(def);
                    const key = `buy:${o.item}`;
                    return (
                      <ShopRow data-off={why() ? "" : undefined}>
                        <ItemIcon aria-hidden="true">
                          <Symbol size={22}>{itemIcon(def)}</Symbol>
                        </ItemIcon>
                        <Info>
                          <strong>{itemName(o.item)}</strong>
                          <Muted>
                            {def ? itemLines(def, null, vocationName)[0] : ""}
                          </Muted>
                          <Show when={versus()}>
                            {(v) => (
                              <Deltas
                                list={v()}
                                empty={t`igual ao que você veste`}
                              />
                            )}
                          </Show>
                          <Show when={why()}>
                            {(w) => (
                              <Warn>
                                {w() === "level"
                                  ? t`Seu herói só usa a partir do level ${def?.minLevel ?? 0}`
                                  : t`A vocação do seu herói não usa`}
                              </Warn>
                            )}
                          </Show>
                        </Info>
                        <Buy>
                          <Show when={stack}>
                            <Stepper>
                              <button
                                type="button"
                                aria-label={t`Menos`}
                                disabled={n() <= 1}
                                onClick={() => setN(n() - (n() > 10 ? 10 : 1))}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={n()}
                                aria-label={t`Quantidade de ${itemName(o.item)}`}
                                onInput={(e) =>
                                  setN(Number(e.currentTarget.value))
                                }
                              />
                              <button
                                type="button"
                                aria-label={t`Mais`}
                                disabled={n() >= 100}
                                onClick={() => setN(n() + (n() >= 10 ? 10 : 1))}
                              >
                                +
                              </button>
                              <button
                                type="button"
                                title={t`O máximo que o dinheiro paga (até 100)`}
                                onClick={() => setN(most())}
                              >
                                {t`máx`}
                              </button>
                            </Stepper>
                          </Show>
                          <Button
                            size="xs"
                            variant={why() ? "tonal" : "filled"}
                            isDisabled={busy() || inRun() || left() < 0}
                            onPress={() => {
                              if (why() && confirm() !== key)
                                return setConfirm(key);
                              send(
                                "rpg.shop.buy",
                                { item: o.item, count: n() },
                                t`Comprado: ${n()}× ${itemName(o.item)}.`,
                              );
                            }}
                          >
                            {why() && confirm() === key
                              ? t`Confirmar: ${money(total())}`
                              : t`Comprar · ${money(total())}`}
                          </Button>
                          <Muted data-short={left() < 0 ? "" : undefined}>
                            {left() < 0
                              ? t`Faltam ${money(-left())}`
                              : t`Sobra ${money(left())}`}
                          </Muted>
                        </Buy>
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
                <SellBar>
                  <Button
                    size="xs"
                    variant="tonal"
                    isDisabled={busy() || inRun()}
                    onPress={markJunk}
                  >
                    {t`Marcar o que não serve`}
                  </Button>
                  <Show when={picked().length > 0}>
                    <Button
                      size="xs"
                      variant="text"
                      isDisabled={busy()}
                      onPress={() => {
                        setPicked([]);
                        setConfirm(null);
                      }}
                    >
                      {t`Desmarcar`}
                    </Button>
                    <Button
                      size="xs"
                      variant="filled"
                      isDisabled={busy() || inRun()}
                      onPress={() => {
                        if (confirm() !== "sell-many")
                          return setConfirm("sell-many");
                        void sellMany();
                      }}
                    >
                      {confirm() === "sell-many"
                        ? t`Confirmar: vender ${picked().length} por ${money(pickedTotal())}`
                        : t`Vender ${picked().length} · ${money(pickedTotal())}`}
                    </Button>
                  </Show>
                </SellBar>
                <Muted>
                  {t`"O que não serve": o que sua vocação ou level não usa, o que é pior que o vestido e os frascos vazios. Confira antes de vender: a venda não volta.`}
                </Muted>
                <Rows>
                  <For each={sellable()}>
                    {(r) => {
                      const def = itemDef(r.x.item);
                      const on = () => picked().includes(r.x.item);
                      return (
                        <ShopRow data-picked={on() ? "" : undefined}>
                          <Pick>
                            <input
                              type="checkbox"
                              checked={on()}
                              aria-label={t`Marcar ${itemName(r.x.item)} para vender`}
                              onChange={(e) => {
                                setConfirm(null);
                                setPicked(
                                  e.currentTarget.checked
                                    ? [...picked(), r.x.item]
                                    : picked().filter((x) => x !== r.x.item),
                                );
                              }}
                            />
                            <ItemIcon aria-hidden="true">
                              <Symbol size={22}>{itemIcon(def)}</Symbol>
                            </ItemIcon>
                          </Pick>
                          <Info>
                            <strong>
                              {r.x.count > 1
                                ? `${r.x.count}× ${itemName(r.x.item)}`
                                : itemName(r.x.item)}
                            </strong>
                            <Muted>
                              {t`${money(r.price!)} cada`}
                              {def?.stats ? ` · ${statsLine(def.stats)}` : ""}
                            </Muted>
                            <Show when={compareTo(def)}>
                              {(v) => <Deltas list={v()} />}
                            </Show>
                          </Info>
                          <Buy>
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
                              {t`Vender · ${money(r.price! * r.x.count)}`}
                            </Button>
                          </Buy>
                        </ShopRow>
                      );
                    }}
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

type ShopFilter = "mine" | "gear" | "acc" | "potions" | "ammo" | "all";
const SHOP_FILTERS: readonly ShopFilter[] = [
  "mine",
  "gear",
  "acc",
  "potions",
  "ammo",
  "all",
];

function shopCategory(d: ItemDef): ShopFilter {
  if (d.potion) return "potions";
  if (d.slot === "municao") return "ammo";
  if (d.slot === "anel" || d.slot === "colar") return "acc";
  return "gear";
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
    maxWidth: "600px",
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
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    '&[aria-selected="true"]': {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
  },
});

const Rows = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "6px" },
});

/** Uma linha da loja: o ícone, o item (o que faz e a troca pelo vestido) e a compra. */
const ShopRow = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.05)",
    transition: "box-shadow 0.15s ease",
    "&:hover": { boxShadow: "inset 0 0 0 1px rgba(217, 180, 90, 0.35)" },
    "&[data-off]": { opacity: 0.75 },
    "&[data-picked]": { boxShadow: "inset 0 0 0 2px #d9b45a" },
    // Estreito: a compra desce para a linha de baixo, inteira.
    "@container (max-width: 460px)": {
      gridTemplateColumns: "auto minmax(0, 1fr)",
      "& > :last-child": { gridColumn: "1 / -1", justifyItems: "stretch" },
    },
  },
});

const ItemIcon = styled("span", {
  base: {
    display: "grid",
    placeItems: "center",
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    background: "radial-gradient(circle at 40% 30%, #3a3128, #15110d)",
    boxShadow: "0 0 0 1px rgba(122, 100, 64, 0.6)",
    color: "#e9d7ad",
  },
});

const Info = styled("span", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    minWidth: 0,
    "& > strong": { fontSize: "0.95em" },
  },
});

const Buy = styled("span", {
  base: {
    display: "grid",
    justifyItems: "end",
    gap: "4px",
    "& [data-short]": { color: "var(--md-sys-color-error)" },
  },
});

const Pick = styled("label", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    "& input": { width: "18px", height: "18px", accentColor: "#d9b45a" },
    "@media (pointer: coarse)": {
      "& input": { width: "24px", height: "24px" },
    },
  },
});

/** Quantidade: −, o número, + e o máximo que o dinheiro paga. */
const Stepper = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "stretch",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px var(--md-sys-color-outline-variant)",
    "& button": {
      minWidth: "28px",
      padding: "0 6px",
      border: "none",
      background: "var(--md-sys-color-surface-container-highest)",
      color: "inherit",
      cursor: "pointer",
      fontSize: "0.85em",
    },
    "& button:disabled": { opacity: 0.4, cursor: "default" },
    "& input": {
      width: "46px",
      border: "none",
      textAlign: "center",
      background: "var(--md-sys-color-surface-container-low)",
      color: "inherit",
      fontVariantNumeric: "tabular-nums",
      appearance: "textfield",
    },
    "@media (pointer: coarse)": {
      "& button, & input": { minHeight: "40px" },
      "& button": { minWidth: "40px" },
    },
  },
});

const Filters = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "6px" },
});

const FilterBtn = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 10px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: "0.85em",
    '&[aria-pressed="true"]': {
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
      borderColor: "var(--md-sys-color-primary)",
    },
    "@media (pointer: coarse)": { minHeight: "36px" },
  },
});

const Count = styled("span", {
  base: {
    minWidth: "18px",
    padding: "0 5px",
    borderRadius: "999px",
    background: "rgba(255, 255, 255, 0.1)",
    fontSize: "0.75em",
    lineHeight: "16px",
    textAlign: "center",
  },
});

const SellBar = styled("div", {
  base: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" },
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
