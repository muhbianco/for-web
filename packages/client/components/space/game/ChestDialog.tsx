import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type OwnedItem,
  type RpgChestEvent,
  type RpgChestLogRow,
  type RpgHeroState,
  CHEST_SLOTS,
  chestNeedsConfirm,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import {
  Count,
  Empty,
  Input,
  Ledger,
  Long,
  Meter,
  MoveBar,
  Pane,
  PaneHead,
  Panes,
  Search,
  Select,
  Short,
  Stash,
  Stat,
  Status,
  Tip,
  Wrap,
  marksOf,
  searchText,
} from "./BankPanel";
import { ClassPicker } from "./ClassPicker";
import { errorText, rarityName } from "./gameText";
import { RARITY } from "./gameTheme";
import {
  type GameLink,
  Btn,
  Confirm,
  GameDialog,
  Gold,
  Muted,
  Row,
  Tabs,
  batches,
  useCommands,
} from "./gameUi";
import { bagMarks, gold } from "./heroModel";

type Chest = RpgChestEvent["d"];
type Sort = "novos" | "raridade" | "nivel";

const RANK: Record<OwnedItem["rarity"], number> = {
  comum: 0,
  incomum: 1,
  raro: 2,
  epico: 3,
  lendario: 4,
};

const when = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * O baú compartilhado (28/11/2026, o dono: "um baú compartilhado; todos podem pôr/pegar item de lá"):
 * um por servidor, o mesmo em qualquer baú do mapa. Duas colunas (baú | mochila): escolher vários,
 * clique duplo move na hora, e a barra diz o efeito antes. O histórico mostra quem pôs e quem pegou.
 * Quando outra pessoa mexe, o servidor avisa e a janela pede de novo.
 *
 * Desde 28/11/2026 (o dono): o baú guarda ouro também, e item que passa 5 dias nele some (o selo no
 * canto diz quanto falta). A mochila não tem limite: listas acima de 40 vão em pedaços.
 */
export default function ChestDialog(props: {
  link: GameLink;
  request: { instance: string; title: string };
  rpg: { hero: RpgHeroState | null } | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const state = () => props.rpg?.hero ?? null;
  return (
    <GameDialog
      id="rpg-chest"
      title={props.request.title || t`Baú compartilhado`}
      subtitle={
        props.request.title && props.request.title !== t`Baú compartilhado`
          ? t`Baú compartilhado`
          : undefined
      }
      onClose={props.onClose}
      wide
    >
      <Show when={state()} fallback={<ClassPicker link={props.link} />}>
        {(s) => (
          <ChestPanel
            link={props.link}
            chest={props.request.instance}
            state={s()}
          />
        )}
      </Show>
    </GameDialog>
  );
}

function ChestPanel(props: {
  link: GameLink;
  chest: string;
  state: RpgHeroState;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const sync = useCommands(() => props.link);
  const h = () => props.state.hero;
  const [chest, setChest] = createSignal<Chest | null>(null);
  const [tab, setTab] = createSignal<"bau" | "historico">("bau");
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("novos");
  const [pickChest, setPickChest] = createSignal<string[]>([]);
  const [pickBag, setPickBag] = createSignal<string[]>([]);
  const [done, setDone] = createSignal<string | null>(null);
  /** A leitura do baú falhou (longe, jogo desligado…): o motivo fica até a próxima tentativa. */
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [coins, setCoins] = createSignal(0);
  // O relógio do selo "some em": um tique por minuto basta.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(tick));

  const accept = (d: Chest) => {
    const cur = chest();
    if (!cur || d.rev >= cur.rev) setChest(d);
  };
  let loading = false;
  let again = false;
  /** Pede o baú; um pedido por vez (o aviso que chega no meio pede mais uma vez no fim). */
  const load = async () => {
    if (loading) {
      again = true;
      return;
    }
    loading = true;
    do {
      again = false;
      const r = await sync.run("rpg.chest", { chest: props.chest });
      if (r?.ok) {
        setLoadError(null);
        accept(r.e.d as unknown as Chest);
      } else if (r) setLoadError(errorText(r.code, r.reason));
    } while (again);
    loading = false;
  };
  onMount(() => {
    void load();
    const off = props.link.onGame((e) => {
      if (e.t === "rpg.chest" && !e.re) accept(e.d as unknown as Chest);
      else if (e.t === "rpg.chest.changed") {
        const rev = (e.d as { rev?: number }).rev ?? 0;
        if (rev > (chest()?.rev ?? -1)) void load();
      }
    });
    onCleanup(off);
  });

  const items = () => chest()?.items ?? [];
  const slots = () => chest()?.slots ?? CHEST_SLOTS;
  const list = createMemo(() => {
    const q = query().trim().toLocaleLowerCase("pt-BR");
    const all = items();
    const age = new Map(all.map((x, i) => [x.uid, i]));
    const shown = q ? all.filter((x) => searchText(x).includes(q)) : [...all];
    const s = sort();
    return shown.sort((a, b) =>
      s === "novos"
        ? (age.get(b.uid) ?? 0) - (age.get(a.uid) ?? 0)
        : s === "raridade"
          ? RANK[b.rarity] - RANK[a.rarity] || b.ilvl - a.ilvl
          : b.ilvl - a.ilvl || RANK[b.rarity] - RANK[a.rarity],
    );
  });
  const chestMarks = createMemo(() => marksOf(h(), list()));
  const bagMarksNow = createMemo(() => bagMarks(h()));
  // O que está escolhido e ainda existe (outra pessoa pode ter pegado).
  const chestSel = createMemo(() => {
    const has = new Set(items().map((x) => x.uid));
    return pickChest().filter((u) => has.has(u));
  });
  const bagSel = createMemo(() => {
    const has = new Set(h().bag.map((x) => x.uid));
    return pickBag().filter((u) => has.has(u));
  });
  const chestRoom = () => Math.max(0, slots() - items().length);
  /** Quanto falta para o item sumir do baú (5 dias desde que entrou). */
  const left = (uid: string) => {
    const c = chest();
    const at = c?.put_at[uid];
    if (!c || at === undefined) return undefined;
    const ms = at + c.ttl_ms - now();
    if (ms <= 0) return t`0m`;
    const hours = Math.floor(ms / 3_600_000);
    return hours >= 24
      ? t`${Math.floor(hours / 24)}d`
      : hours >= 1
        ? t`${hours}h`
        : t`${Math.max(1, Math.floor(ms / 60_000))}m`;
  };
  /** Algum escolhido da mochila é +7 ou Lendário: pôr pede a segunda confirmação. */
  const precious = createMemo(() => {
    const sel = new Set(bagSel());
    return h().bag.some((x) => sel.has(x.uid) && chestNeedsConfirm(x));
  });

  const put = async (uids: string[], confirm = false) => {
    if (uids.length === 0) return;
    setDone(null);
    const r = await cmd.runAll(
      batches(uids).map((part) => [
        "rpg.chest.put",
        { chest: props.chest, uids: part, ...(confirm ? { confirm: true } : {}) },
      ]),
    );
    if (!r?.ok) return;
    setPickBag([]);
    setDone(
      uids.length === 1
        ? t`1 item no baú. Qualquer pessoa do servidor pode pegar.`
        : t`${uids.length} itens no baú. Qualquer pessoa do servidor pode pegar.`,
    );
  };
  const take = async (uids: string[]) => {
    if (uids.length === 0) return;
    setDone(null);
    const r = await cmd.runAll(
      batches(uids).map((part) => [
        "rpg.chest.take",
        { chest: props.chest, uids: part },
      ]),
    );
    if (!r?.ok) return;
    setPickChest([]);
    setDone(
      uids.length === 1
        ? t`1 item na sua mochila.`
        : t`${uids.length} itens na sua mochila.`,
    );
  };
  /** O ouro: positivo põe da mão, negativo pega do baú. */
  const moveGold = async (amount: number) => {
    if (amount === 0) return;
    setDone(null);
    const r = await cmd.run("rpg.chest.gold", {
      chest: props.chest,
      gold: amount,
    });
    if (!r?.ok) return;
    setCoins(0);
    setDone(
      amount > 0
        ? t`${gold(amount)} de ouro no baú.`
        : t`${gold(-amount)} de ouro na sua mão.`,
    );
  };
  /** Clique duplo na mochila: +7 e Lendário não vão sem a confirmação da barra. */
  const quickPut = (uid: string) => {
    const it = h().bag.find((x) => x.uid === uid);
    if (it && chestNeedsConfirm(it)) {
      setPickBag([uid]);
      return;
    }
    void put([uid]);
  };

  const hint = () =>
    bagSel().length > chestRoom()
        ? chestRoom() > 0
          ? t`Cabem só ${chestRoom()} no baú: tire ${bagSel().length - chestRoom()} da escolha.`
          : t`O baú está cheio (${slots()} itens).`
        : precious()
          ? t`Tem item +7 ou Lendário na escolha: confirme, porque qualquer pessoa pode pegar.`
          : t`Escolha itens no baú ou na mochila para mover.`;

  return (
    <Wrap>
      <Ledger aria-label={t`Resumo do baú`}>
        <Stat data-warn={chestRoom() <= 5 ? "" : undefined}>
          <small>{t`Itens no baú`}</small>
          <strong>
            {items().length}/{slots()}
          </strong>
          <Meter aria-hidden="true">
            <span style={{ width: `${(items().length / slots()) * 100}%` }} />
          </Meter>
        </Stat>
        <Stat>
          <small>{t`Ouro no baú`}</small>
          <Gold n={gold(chest()?.gold ?? 0)} />
        </Stat>
        <Stat>
          <small>{t`Ouro na mão`}</small>
          <Gold n={gold(h().gold)} />
        </Stat>
      </Ledger>
      <GoldRow aria-label={t`Ouro do baú`}>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={coins() || ""}
          placeholder={t`Ouro`}
          aria-label={t`Quanto ouro`}
          onInput={(e) =>
            setCoins(Math.max(0, Math.floor(Number(e.currentTarget.value)) || 0))
          }
        />
        <Btn
          type="button"
          data-size="sm"
          disabled={cmd.busy() || coins() <= 0 || coins() > h().gold}
          onClick={() => void moveGold(coins())}
        >
          ← {t`Pôr no baú`}
        </Btn>
        <Btn
          type="button"
          data-size="sm"
          disabled={
            cmd.busy() || coins() <= 0 || coins() > (chest()?.gold ?? 0)
          }
          onClick={() => void moveGold(-coins())}
        >
          {t`Pegar do baú`} →
        </Btn>
      </GoldRow>
      <Tabs
        label={t`Baú compartilhado`}
        value={tab()}
        onChange={setTab}
        items={[
          { id: "bau", label: t`Baú` },
          { id: "historico", label: t`Histórico` },
        ]}
      />
      <Show when={tab() === "bau"}>
        <Panes>
          <Pane aria-label={t`Baú`}>
            <PaneHead>
              <h3>
                {t`Baú`}{" "}
                <Muted>
                  {query().trim()
                    ? t`${list().length} de ${items().length}`
                    : items().length === 1
                      ? t`1 item`
                      : t`${items().length} itens`}
                </Muted>
              </h3>
              <Select
                value={sort()}
                aria-label={t`Ordem do baú`}
                onChange={(e) => setSort(e.currentTarget.value as Sort)}
              >
                <option value="novos">{t`Mais novos`}</option>
                <option value="raridade">{t`Raridade`}</option>
                <option value="nivel">{t`Nível do item`}</option>
              </Select>
            </PaneHead>
            <Search
              type="search"
              value={query()}
              placeholder={t`Buscar no baú (nome, lugar, perk…)`}
              aria-label={t`Buscar no baú`}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <Show
              when={chest()}
              fallback={
                <Show
                  when={loadError()}
                  fallback={<Muted role="status">{t`Abrindo o baú…`}</Muted>}
                >
                  {(e) => (
                    <Empty>
                      <Muted role="alert">⚠ {e()}</Muted>
                      <Btn
                        type="button"
                        data-size="sm"
                        onClick={() => void load()}
                      >
                        {t`Tentar de novo`}
                      </Btn>
                    </Empty>
                  )}
                </Show>
              }
            >
              <Show
                when={items().length > 0}
                fallback={
                  <Empty>
                    <strong>{t`O baú está vazio.`}</strong>
                    <Muted>{t`Ponha aqui o que quiser dividir: qualquer pessoa do servidor pode pegar.`}</Muted>
                  </Empty>
                }
              >
                <Show
                  when={list().length > 0}
                  fallback={
                    <Empty>
                      <Muted>{t`Nada no baú com essa busca.`}</Muted>
                    </Empty>
                  }
                >
                  <Stash
                    label={t`Itens no baú`}
                    items={list()}
                    selected={chestSel()}
                    onSelect={setPickChest}
                    onQuick={(u) => void take([u])}
                    marks={chestMarks()}
                    tag={left}
                    hero={h()}
                  />
                </Show>
              </Show>
            </Show>
            <Show when={chestSel().length > 0}>
              <Row>
                <Btn
                  type="button"
                  data-size="sm"
                  data-tone="quiet"
                  onClick={() => setPickChest([])}
                >
                  {t`Limpar`}
                </Btn>
              </Row>
            </Show>
            <Tip>{t`O item some 5 dias depois de entrar no baú (o canto diz quanto falta). O ouro não some.`}</Tip>
          </Pane>

          <Pane aria-label={t`Mochila`}>
            <PaneHead>
              <h3>
                {t`Mochila`}{" "}
                <Count>
                  {h().bag.length === 1
                    ? t`1 item`
                    : t`${h().bag.length} itens`}
                </Count>
              </h3>
            </PaneHead>
            <Show
              when={h().bag.length > 0}
              fallback={
                <Empty>
                  <Muted>{t`A mochila está vazia.`}</Muted>
                </Empty>
              }
            >
              <Stash
                label={t`Itens da mochila`}
                items={h().bag}
                selected={bagSel()}
                onSelect={setPickBag}
                onQuick={quickPut}
                marks={bagMarksNow()}
                hero={h()}
              />
            </Show>
            <Row>
              <Btn
                type="button"
                data-size="sm"
                data-tone="quiet"
                disabled={h().bag.length === 0}
                onClick={() =>
                  setPickBag(
                    h()
                      .bag.filter(
                        (x) => bagMarksNow()[x.uid]?.mark === "blocked",
                      )
                      .map((x) => x.uid),
                  )
                }
              >
                {t`Escolher o que não dá para vestir`}
              </Btn>
              <Show when={bagSel().length > 0}>
                <Btn
                  type="button"
                  data-size="sm"
                  data-tone="quiet"
                  onClick={() => setPickBag([])}
                >
                  {t`Limpar`}
                </Btn>
              </Show>
            </Row>
            <Tip>{t`Clique duplo num item move na hora (o +7 e o Lendário pedem confirmação).`}</Tip>
          </Pane>
        </Panes>

        <MoveBar
          aria-label={t`Mover itens`}
          data-idle={
            bagSel().length === 0 &&
            chestSel().length === 0 &&
            !done() &&
            !cmd.error()
              ? ""
              : undefined
          }
        >
          <Status
            role="status"
            data-kind={
              cmd.error()
                ? "error"
                : done()
                  ? "ok"
                  : bagSel().length > chestRoom() || precious()
                    ? "warn"
                    : undefined
            }
          >
            <span>{cmd.error() ? `⚠ ${cmd.error()}` : (done() ?? hint())}</span>
          </Status>
          <Show
            when={precious() && bagSel().length <= chestRoom()}
            fallback={
              <Btn
                type="button"
                data-tone={
                  bagSel().length > 0 && bagSel().length <= chestRoom()
                    ? "primary"
                    : undefined
                }
                disabled={
                  cmd.busy() ||
                  bagSel().length === 0 ||
                  bagSel().length > chestRoom()
                }
                onClick={() => void put(bagSel())}
              >
                ←{" "}
                <Long>
                  {bagSel().length > 0
                    ? t`Pôr ${bagSel().length} no baú`
                    : t`Pôr no baú`}
                </Long>
                <Short>
                  {bagSel().length > 0 ? t`Pôr ${bagSel().length}` : t`Pôr`}
                </Short>
              </Btn>
            }
          >
            <Confirm
              tone="primary"
              disabled={cmd.busy()}
              label={<>← {t`Pôr ${bagSel().length} no baú`}</>}
              confirm={t`Confirmar: qualquer um pode pegar`}
              onConfirm={() => void put(bagSel(), true)}
            />
          </Show>
          <Btn
            type="button"
            data-tone={chestSel().length > 0 ? "primary" : undefined}
            disabled={cmd.busy() || chestSel().length === 0}
            onClick={() => void take(chestSel())}
          >
            <Long>
              {chestSel().length > 0
                ? t`Pegar ${chestSel().length} para a mochila`
                : t`Pegar para a mochila`}
            </Long>
            <Short>
              {chestSel().length > 0 ? t`Pegar ${chestSel().length}` : t`Pegar`}
            </Short>{" "}
            →
          </Btn>
        </MoveBar>
      </Show>

      <Show when={tab() === "historico"}>
        <Show
          when={(chest()?.log.length ?? 0) > 0}
          fallback={
            <Muted role="status">{t`Ninguém mexeu no baú ainda.`}</Muted>
          }
        >
          <Log aria-label={t`Histórico do baú`}>
            <For each={chest()?.log ?? []}>
              {(row) => <LogLine row={row} />}
            </For>
          </Log>
        </Show>
        <Muted>{t`As últimas ${chest()?.log.length ?? 0} vezes que alguém pôs ou pegou.`}</Muted>
      </Show>
    </Wrap>
  );
}

function LogLine(props: { row: RpgChestLogRow }) {
  const { t } = useLingui();
  const more = () => props.row.count - props.row.items.length;
  const coins = () => props.row.gold ?? 0;
  return (
    <li>
      <time>{when.format(props.row.at)}</time>
      <span>
        <Show
          when={props.row.action !== "sumiu"}
          fallback={
            <>
              {props.row.count === 1
                ? t`1 item sumiu (5 dias no baú):`
                : t`${props.row.count} itens sumiram (5 dias no baú):`}{" "}
            </>
          }
        >
          <b>{props.row.name || t`Alguém`}</b>{" "}
          {props.row.action === "pos" ? t`pôs` : t`pegou`}{" "}
          <Show when={coins() > 0}>
            <Gold n={gold(coins())} />
            {props.row.count > 0 ? " + " : ""}
          </Show>
        </Show>
        <For each={props.row.items}>
          {(it, i) => (
            <>
              {i() > 0 ? ", " : ""}
              <span
                style={{ color: RARITY[it.rarity].color }}
                title={rarityName(it.rarity)}
              >
                {it.name}
                {it.refine > 0 ? ` +${it.refine}` : ""}
              </span>
            </>
          )}
        </For>
        <Show when={more() > 0}> {t`e mais ${more()}`}</Show>
      </span>
    </li>
  );
}

const GoldRow = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    alignItems: "center",
    "& input": { width: "9em" },
  },
});

const Log = styled("ul", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    "& li": {
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "10px",
      alignItems: "baseline",
      padding: "6px 8px",
      borderRadius: "8px",
      background: "color-mix(in srgb, currentColor 5%, transparent)",
    },
    "& time": {
      fontVariantNumeric: "tabular-nums",
      opacity: 0.7,
      fontSize: "0.85em",
    },
  },
});
