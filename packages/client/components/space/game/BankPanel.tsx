import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  untrack,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type GearSlot,
  type HeroV5,
  type OwnedItem,
  type RarityId,
  type RpgHeroState,
  BAG_SLOTS,
  buyBackPrice,
  itemTooltip,
  planTransfer,
} from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ItemGrid } from "./ItemCard";
import { ItemTip } from "./ItemTip";
import { errorText, rarityName, slotName } from "./gameText";
import { RARITY } from "./gameTheme";
import {
  type GameLink,
  Btn,
  Confirm,
  Gold,
  ItemIcon,
  Muted,
  Notice,
  Panel,
  Row,
  Tabs,
  useCommands,
} from "./gameUi";
import { type BagMark, bagMarks, cannotWear, gold } from "./heroModel";

type Tab = "cofre" | "ouro" | "transferir";

/**
 * O Banqueiro (§10, D36; redesenho de 27/11/2026): o cofre de itens sem limite (o que não cabe na
 * mochila no fim da corrida vem para cá), o ouro guardado e a transferência para outra pessoa.
 *
 * O cofre é um baú de duas colunas (cofre | mochila, empilhadas no celular): filtros com a contagem
 * de cada um (tipo, raridade, "serve em mim", novos), busca pelo nome, ordem, seleção de vários
 * (Shift amplia, clique duplo move na hora), atalhos ("guardar o que não dá para vestir", "trazer as
 * melhorias"), a barra de mover com o efeito escrito antes ("cabem 3") e o Desfazer depois. O selo
 * NOVO marca o que chegou desde a última visita (guardado só neste navegador).
 */
export function BankPanel(props: {
  link: GameLink;
  npc: string;
  state: RpgHeroState;
  people: { id: string; name: string }[];
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const [tab, setTab] = createSignal<Tab>("cofre");
  const [ok, setOk] = createSignal<string | null>(null);
  const h = () => props.state.hero;
  const seen = useSeen(() => h().vault.items);
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
  const room = () => BAG_SLOTS - h().bag.length;
  return (
    <Wrap>
      <Ledger aria-label={t`Resumo do Banqueiro`}>
        <Stat>
          <small>{t`Ouro na mão`}</small>
          <Gold n={gold(h().gold)} />
        </Stat>
        <Stat>
          <small>{t`Ouro no cofre`}</small>
          <Gold n={gold(h().vault.gold)} />
        </Stat>
        <Stat>
          <small>{t`Itens no cofre`}</small>
          <strong>
            {h().vault.items.length} <Muted>· {t`sem limite`}</Muted>
          </strong>
        </Stat>
        <Stat data-warn={room() <= 4 ? "" : undefined}>
          <small>{t`Mochila`}</small>
          <strong>
            {h().bag.length}/{BAG_SLOTS}
          </strong>
          <Meter aria-hidden="true">
            <span style={{ width: `${(h().bag.length / BAG_SLOTS) * 100}%` }} />
          </Meter>
        </Stat>
      </Ledger>
      <Tabs
        label={t`Banqueiro`}
        value={tab()}
        onChange={(v) => {
          setOk(null);
          setTab(v);
        }}
        items={[
          {
            id: "cofre",
            label: t`Cofre de itens`,
            badge: seen.count() || null,
          },
          { id: "ouro", label: t`Ouro` },
          { id: "transferir", label: t`Transferir` },
        ]}
      />
      <Show when={tab() === "cofre"}>
        <VaultBox
          state={props.state}
          npc={props.npc}
          link={props.link}
          isNew={seen.isNew}
          onMoved={seen.mark}
        />
      </Show>
      <Show when={tab() === "ouro"}>
        <Notice error={cmd.error()} ok={ok()} />
        <GoldBox state={props.state} busy={cmd.busy()} run={run} />
      </Show>
      <Show when={tab() === "transferir"}>
        <Notice error={cmd.error()} ok={ok()} />
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

// ------------------------------------------------------------ o selo NOVO

const SEEN_KEY = "muchat:idle:vault-seen:v1";

function readSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list)
      ? new Set(list.filter((x): x is string => typeof x === "string"))
      : null;
  } catch {
    // Sem armazenamento (janela privada, bloqueado): o selo vale só para o que chega com ela aberta.
    return null;
  }
}

function writeSeen(uids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(uids));
  } catch {
    // Idem: sem armazenamento, a próxima visita começa sem selo.
  }
}

/**
 * O que chegou ao cofre desde a última visita (neste navegador): o loot que não coube na mochila.
 * Na primeira visita tudo conta como visto (sem uma enxurrada de selos); o que a pessoa guarda com
 * a janela aberta não ganha selo. `known` é o retrato da abertura (o selo vale até a próxima
 * visita); o que está no cofre vira visto para a próxima a cada mudança, num efeito.
 *
 * Nada de ler estado reativo numa limpeza (onCleanup): fechar a janela muda o `ui()` do app, e ler
 * o herói enquanto a janela é descartada fazia o Solid recalcular ali o Switch que a contém e
 * limpá-lo duas vezes ("Cannot read properties of null (reading '0')" no cleanNode). A reatividade
 * do app parava e a tela congelava (27/11/2026; regressão em qa/game-lab/close-check.mjs).
 */
function useSeen(items: () => OwnedItem[]) {
  const known = readSeen() ?? new Set(untrack(items).map((x) => x.uid));
  const [mine, setMine] = createSignal<ReadonlySet<string>>(new Set());
  const isNew = (uid: string) => !known.has(uid) && !mine().has(uid);
  const count = createMemo(() => items().filter((x) => isNew(x.uid)).length);
  createEffect(on(items, (list) => writeSeen(list.map((x) => x.uid))));
  return {
    isNew,
    count,
    mark: (uids: readonly string[]) => setMine(new Set([...mine(), ...uids])),
  };
}

// ------------------------------------------------------------ cofre de itens

type Cat = "todos" | "armas" | "armaduras" | "joias";
type Sort = "novos" | "raridade" | "nivel" | "lugar";

const CAT_OF: Record<GearSlot, Exclude<Cat, "todos">> = {
  arma: "armas",
  secundaria: "armas",
  elmo: "armaduras",
  armadura: "armaduras",
  calcas: "armaduras",
  botas: "armaduras",
  colar: "joias",
  anel: "joias",
};
const SLOT_ORDER: GearSlot[] = [
  "arma",
  "secundaria",
  "elmo",
  "armadura",
  "calcas",
  "botas",
  "colar",
  "anel",
];
const RARITIES: RarityId[] = ["lendario", "epico", "raro", "incomum", "comum"];
const RANK: Record<RarityId, number> = {
  comum: 0,
  incomum: 1,
  raro: 2,
  epico: 3,
  lendario: 4,
};
/** Quantos itens do cofre aparecem por vez (o cofre não tem fim; o resto vem com "mostrar mais"). */
const PAGE = 48;

type Marks = Record<string, { mark: BagMark; score: number }>;

/**
 * ▲/▼ de itens fora da mochila pela mesma nota da mochila: em pedaços de 32, para a troca (o vestido
 * volta para a "mochila" da conta) nunca passar dos 40 espaços. ~0,5 ms por item: só o que aparece.
 */
function marksOf(h: HeroV5, items: OwnedItem[]): Marks {
  const out: Marks = {};
  for (let i = 0; i < items.length; i += 32)
    Object.assign(out, bagMarks({ ...h, bag: items.slice(i, i + 32) }));
  return out;
}

const searchCache = new WeakMap<OwnedItem, string>();
function searchText(it: OwnedItem): string {
  let s = searchCache.get(it);
  if (s === undefined) {
    const tip = itemTooltip(it);
    s = [
      tip.name,
      tip.kind,
      rarityName(it.rarity),
      slotName(it.slot as GearSlot),
      ...(tip.perks ?? []).map((p) => p.text),
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    searchCache.set(it, s);
  }
  return s;
}

function VaultBox(props: {
  state: RpgHeroState;
  npc: string;
  link: GameLink;
  isNew: (uid: string) => boolean;
  onMoved: (uids: readonly string[]) => void;
}) {
  const { t } = useLingui();
  const cmd = useCommands(() => props.link);
  const h = () => props.state.hero;

  const [query, setQuery] = createSignal("");
  const [cat, setCat] = createSignal<Cat>("todos");
  const [rar, setRar] = createSignal<RarityId[]>([]);
  const [mineOnly, setMineOnly] = createSignal(false);
  const [newOnly, setNewOnly] = createSignal(false);
  const [sort, setSort] = createSignal<Sort>("novos");
  const [shown, setShown] = createSignal(PAGE);
  const [pickVault, setPickVault] = createSignal<string[]>([]);
  const [pickBag, setPickBag] = createSignal<string[]>([]);
  const [done, setDone] = createSignal<{
    action: "guardar" | "retirar";
    uids: string[];
  } | null>(null);

  // Filtro novo volta para a 1ª página.
  createEffect(
    on([query, cat, rar, mineOnly, newOnly, sort], () => setShown(PAGE), {
      defer: true,
    }),
  );

  const wearable = createMemo(() => {
    const hero = h();
    const ok = new Set<string>();
    if (mineOnly())
      for (const it of hero.vault.items)
        if (!cannotWear(hero, it)) ok.add(it.uid);
    return ok;
  });

  /** Tudo menos o filtro `skip` (para a contagem de cada opção daquele filtro). */
  const filtered = (skip: "cat" | "rar" | null) => {
    const q = query().trim().toLocaleLowerCase("pt-BR");
    return h().vault.items.filter(
      (it) =>
        (skip === "cat" ||
          cat() === "todos" ||
          CAT_OF[it.slot as GearSlot] === cat()) &&
        (skip === "rar" || rar().length === 0 || rar().includes(it.rarity)) &&
        (!mineOnly() || wearable().has(it.uid)) &&
        (!newOnly() || props.isNew(it.uid)) &&
        (!q || searchText(it).includes(q)),
    );
  };
  const catCount = createMemo(() => {
    const n: Record<Cat, number> = {
      todos: 0,
      armas: 0,
      armaduras: 0,
      joias: 0,
    };
    for (const it of filtered("cat")) {
      n.todos++;
      n[CAT_OF[it.slot as GearSlot]]++;
    }
    return n;
  });
  const rarCount = createMemo(() => {
    const n: Partial<Record<RarityId, number>> = {};
    for (const it of filtered("rar")) n[it.rarity] = (n[it.rarity] ?? 0) + 1;
    return n;
  });
  const list = createMemo(() => {
    const items = filtered(null);
    const order = new Map(h().vault.items.map((x, i) => [x.uid, i]));
    const age = (x: OwnedItem) => order.get(x.uid) ?? 0;
    const s = sort();
    return [...items].sort((a, b) =>
      s === "novos"
        ? age(b) - age(a)
        : s === "raridade"
          ? RANK[b.rarity] - RANK[a.rarity] || b.ilvl - a.ilvl
          : s === "nivel"
            ? b.ilvl - a.ilvl || RANK[b.rarity] - RANK[a.rarity]
            : SLOT_ORDER.indexOf(a.slot as GearSlot) -
                SLOT_ORDER.indexOf(b.slot as GearSlot) || b.ilvl - a.ilvl,
    );
  });
  const visible = createMemo(() => list().slice(0, shown()));
  const vaultMarks = createMemo(() => marksOf(h(), visible()));
  const bagMarksNow = createMemo(() => bagMarks(h()));
  const newCount = createMemo(
    () => h().vault.items.filter((x) => props.isNew(x.uid)).length,
  );
  const filtering = () =>
    !!query().trim() ||
    cat() !== "todos" ||
    rar().length > 0 ||
    mineOnly() ||
    newOnly();
  const clearFilters = () => {
    setQuery("");
    setCat("todos");
    setRar([]);
    setMineOnly(false);
    setNewOnly(false);
  };

  // O que está escolhido e ainda existe (um item pode sair por outro caminho).
  const vaultSel = createMemo(() => {
    const has = new Set(h().vault.items.map((x) => x.uid));
    return pickVault().filter((u) => has.has(u));
  });
  const bagSel = createMemo(() => {
    const has = new Set(h().bag.map((x) => x.uid));
    return pickBag().filter((u) => has.has(u));
  });
  const room = () => BAG_SLOTS - h().bag.length;

  const move = async (action: "guardar" | "retirar", uids: string[]) => {
    if (uids.length === 0) return false;
    setDone(null);
    const r = await cmd.run("rpg.vault.many", {
      npc: props.npc,
      action,
      uids,
    });
    if (!r?.ok) return false;
    if (action === "guardar") {
      props.onMoved(uids);
      setPickBag([]);
    } else setPickVault([]);
    setDone({ action, uids });
    return true;
  };
  const undo = () => {
    const d = done();
    if (!d) return;
    void move(d.action === "guardar" ? "retirar" : "guardar", d.uids).then(
      (o) => o && setDone(null),
    );
  };

  /** As melhorias do cofre (dentro do filtro), da maior para a menor, até onde a mochila cabe. */
  const pickUpgrades = () => {
    const m = marksOf(h(), list());
    const ups = list()
      .filter((x) => m[x.uid]?.mark === "up")
      .sort((a, b) => (m[b.uid]?.score ?? 0) - (m[a.uid]?.score ?? 0))
      .slice(0, Math.max(0, room()))
      .map((x) => x.uid);
    setPickVault(ups);
    // O escolhido fica à vista: a página abre até o último deles.
    const last = Math.max(
      -1,
      ...ups.map((u) => list().findIndex((x) => x.uid === u)),
    );
    if (last >= shown()) setShown(Math.ceil((last + 1) / PAGE) * PAGE);
    return ups.length;
  };
  const [noUps, setNoUps] = createSignal(false);

  return (
    <>
      <Panes>
        <Pane aria-label={t`Cofre`}>
          <PaneHead>
            <h3>
              {t`Cofre`}{" "}
              <Muted>
                {filtering()
                  ? t`${list().length} de ${h().vault.items.length}`
                  : h().vault.items.length === 1
                    ? t`1 item`
                    : t`${h().vault.items.length} itens`}
              </Muted>
            </h3>
            <Select
              value={sort()}
              aria-label={t`Ordem do cofre`}
              onChange={(e) => setSort(e.currentTarget.value as Sort)}
            >
              <option value="novos">{t`Mais novos`}</option>
              <option value="raridade">{t`Raridade`}</option>
              <option value="nivel">{t`Nível do item`}</option>
              <option value="lugar">{t`Lugar`}</option>
            </Select>
          </PaneHead>
          <Search
            type="search"
            value={query()}
            placeholder={t`Buscar no cofre (nome, lugar, perk…)`}
            aria-label={t`Buscar no cofre`}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <Chips role="group" aria-label={t`Tipo`}>
            <For
              each={
                [
                  ["todos", t`Tudo`],
                  ["armas", t`Armas`],
                  ["armaduras", t`Armaduras`],
                  ["joias", t`Joias`],
                ] as [Cat, string][]
              }
            >
              {([id, label]) => (
                <Chip
                  type="button"
                  aria-pressed={cat() === id}
                  onClick={() => setCat(id)}
                >
                  {label} <small>{catCount()[id]}</small>
                </Chip>
              )}
            </For>
          </Chips>
          <Chips role="group" aria-label={t`Raridade e atalhos`}>
            <For each={RARITIES}>
              {(r) => (
                <Chip
                  type="button"
                  style={{ "--rc": RARITY[r].color }}
                  data-rarity=""
                  aria-pressed={rar().includes(r)}
                  aria-label={t`${rarityName(r)}: ${rarCount()[r] ?? 0}`}
                  title={rarityName(r)}
                  onClick={() =>
                    setRar(
                      rar().includes(r)
                        ? rar().filter((x) => x !== r)
                        : [...rar(), r],
                    )
                  }
                >
                  <b>{RARITY[r].pips || "●"}</b>{" "}
                  <small>{rarCount()[r] ?? 0}</small>
                </Chip>
              )}
            </For>
            <Chip
              type="button"
              aria-pressed={mineOnly()}
              onClick={() => setMineOnly(!mineOnly())}
            >
              {t`Serve em mim`}
            </Chip>
            <Show when={newCount() > 0}>
              <Chip
                type="button"
                data-new=""
                aria-pressed={newOnly()}
                onClick={() => setNewOnly(!newOnly())}
              >
                {t`Novos`} <small>{newCount()}</small>
              </Chip>
            </Show>
          </Chips>

          <Show
            when={h().vault.items.length > 0}
            fallback={
              <Empty>
                <strong>{t`O cofre está vazio.`}</strong>
                <Muted>{t`O que não couber na mochila no fim da corrida vem para cá. Guarde aqui o que quiser poupar: não tem limite.`}</Muted>
              </Empty>
            }
          >
            <Show
              when={list().length > 0}
              fallback={
                <Empty>
                  <Muted>{t`Nada no cofre com esses filtros.`}</Muted>
                  <Btn type="button" data-size="sm" onClick={clearFilters}>
                    {t`Limpar filtros`}
                  </Btn>
                </Empty>
              }
            >
              <Stash
                label={t`Itens no cofre`}
                items={visible()}
                selected={vaultSel()}
                onSelect={setPickVault}
                onQuick={(u) => void move("retirar", [u])}
                marks={vaultMarks()}
                isNew={props.isNew}
                hero={h()}
              />
              <Show when={list().length > visible().length}>
                <Btn
                  type="button"
                  data-tone="quiet"
                  onClick={() => setShown(shown() + PAGE)}
                >
                  {t`Mostrar mais (${list().length - visible().length})`}
                </Btn>
              </Show>
            </Show>
          </Show>
          <Row>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              disabled={list().length === 0 || room() <= 0}
              onClick={() => setNoUps(pickUpgrades() === 0)}
              title={t`Escolhe os itens do cofre melhores que o vestido (pela nota do seu papel), até onde a mochila cabe.`}
            >
              ▲ {t`Trazer as melhorias`}
            </Btn>
            <Show when={visible().length > 0}>
              <Btn
                type="button"
                data-size="sm"
                data-tone="quiet"
                onClick={() => setPickVault(visible().map((x) => x.uid))}
              >
                {t`Escolher os que aparecem`}
              </Btn>
            </Show>
            <Show when={vaultSel().length > 0}>
              <Btn
                type="button"
                data-size="sm"
                data-tone="quiet"
                onClick={() => setPickVault([])}
              >
                {t`Limpar`}
              </Btn>
            </Show>
          </Row>
          <Show when={noUps()}>
            <Muted role="note">{t`Nada no cofre melhora o que você veste.`}</Muted>
          </Show>
        </Pane>

        <Pane aria-label={t`Mochila`}>
          <PaneHead>
            <h3>
              {t`Mochila`}{" "}
              <Count data-full={room() <= 4 ? "" : undefined}>
                {h().bag.length}/{BAG_SLOTS}
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
              onQuick={(u) => void move("guardar", [u])}
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
                    .bag.filter((x) => bagMarksNow()[x.uid]?.mark === "blocked")
                    .map((x) => x.uid),
                )
              }
            >
              {t`Escolher o que não dá para vestir`}
            </Btn>
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              disabled={h().bag.length === 0}
              onClick={() =>
                setPickBag(
                  h()
                    .bag.filter((x) => bagMarksNow()[x.uid]?.mark !== "up")
                    .map((x) => x.uid),
                )
              }
            >
              {t`Tudo menos as melhorias`}
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
          <Tip>{t`Clique duplo num item move na hora; Shift + clique escolhe um trecho.`}</Tip>
        </Pane>
      </Panes>

      <MoveBar
        aria-label={t`Mover itens`}
        data-idle={
          bagSel().length === 0 &&
          vaultSel().length === 0 &&
          !done() &&
          !cmd.error()
            ? ""
            : undefined
        }
      >
        {/* A linha de estado tem altura fixa: o aviso e o Desfazer não empurram a tela. */}
        <Status
          role="status"
          data-kind={
            cmd.error()
              ? "error"
              : done()
                ? "ok"
                : vaultSel().length > room()
                  ? "warn"
                  : undefined
          }
        >
          <Show
            when={cmd.error()}
            fallback={
              <Show
                when={done()}
                fallback={
                  <span>
                    {vaultSel().length > room()
                      ? room() > 0
                        ? t`Cabem só ${room()} na mochila: tire ${vaultSel().length - room()} da escolha.`
                        : t`A mochila está cheia: guarde, venda ou desmonte algo antes.`
                      : t`Escolha itens no cofre ou na mochila para mover.`}
                  </span>
                }
              >
                {(d) => (
                  <>
                    <span>
                      {d().uids.length === 1
                        ? d().action === "guardar"
                          ? t`1 item guardado no cofre.`
                          : t`1 item de volta na mochila.`
                        : d().action === "guardar"
                          ? t`${d().uids.length} itens guardados no cofre.`
                          : t`${d().uids.length} itens de volta na mochila.`}
                    </span>
                    <Btn
                      type="button"
                      data-size="sm"
                      data-tone="quiet"
                      disabled={cmd.busy()}
                      onClick={undo}
                    >
                      ↶ {t`Desfazer`}
                    </Btn>
                  </>
                )}
              </Show>
            }
          >
            {(e) => <span>⚠ {e()}</span>}
          </Show>
        </Status>
        <Btn
          type="button"
          data-tone={bagSel().length > 0 ? "primary" : undefined}
          disabled={cmd.busy() || bagSel().length === 0}
          onClick={() => void move("guardar", bagSel())}
        >
          ←{" "}
          <Long>
            {bagSel().length > 0
              ? t`Guardar ${bagSel().length} no cofre`
              : t`Guardar no cofre`}
          </Long>
          <Short>
            {bagSel().length > 0 ? t`Guardar ${bagSel().length}` : t`Guardar`}
          </Short>
        </Btn>
        <Btn
          type="button"
          data-tone={
            vaultSel().length > 0 && vaultSel().length <= room()
              ? "primary"
              : undefined
          }
          disabled={
            cmd.busy() || vaultSel().length === 0 || vaultSel().length > room()
          }
          onClick={() => void move("retirar", vaultSel())}
        >
          <Long>
            {vaultSel().length > 0
              ? t`Retirar ${vaultSel().length} para a mochila`
              : t`Retirar para a mochila`}
          </Long>
          <Short>
            {vaultSel().length > 0
              ? t`Retirar ${vaultSel().length}`
              : t`Retirar`}
          </Short>{" "}
          →
        </Btn>
      </MoveBar>
    </>
  );
}

/**
 * A grade do baú: toque escolhe (vários), Shift + clique escolhe o trecho desde o último, clique
 * duplo move na hora. ▲/▼ e o selo NOVO no canto; o detalhe ao parar em cima (ou toque longo).
 */
function Stash(props: {
  label: string;
  items: OwnedItem[];
  selected: string[];
  onSelect: (uids: string[]) => void;
  onQuick: (uid: string) => void;
  marks?: Marks;
  isNew?: (uid: string) => boolean;
  hero: HeroV5;
}) {
  const { t } = useLingui();
  let anchor: string | null = null;
  const click = (uid: string, e: MouseEvent) => {
    const sel = props.selected;
    if (e.shiftKey && anchor) {
      const ids = props.items.map((x) => x.uid);
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(uid);
      if (a >= 0 && b >= 0) {
        const span = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        props.onSelect([...new Set([...sel, ...span])]);
        return;
      }
    }
    anchor = uid;
    props.onSelect(
      sel.includes(uid) ? sel.filter((x) => x !== uid) : [...sel, uid],
    );
  };
  return (
    <StashGrid
      role="listbox"
      aria-label={props.label}
      aria-multiselectable="true"
    >
      <For each={props.items}>
        {(it) => {
          const mark = () => props.marks?.[it.uid]?.mark;
          const fresh = () => props.isNew?.(it.uid) ?? false;
          return (
            <ItemTip item={it} hero={props.hero} price={buyBackPrice(it)}>
              {(bind) => (
                <Cell
                  {...bind}
                  type="button"
                  role="option"
                  aria-selected={props.selected.includes(it.uid)}
                  aria-label={`${rarityName(it.rarity)} ${slotName(it.slot as GearSlot)} +${it.refine}${
                    mark() === "up"
                      ? ` — ${t`melhor que o vestido`}`
                      : mark() === "blocked"
                        ? ` — ${t`não dá para vestir`}`
                        : ""
                  }${fresh() ? ` — ${t`novo`}` : ""}`}
                  data-blocked={mark() === "blocked" ? "" : undefined}
                  onClick={(e) => click(it.uid, e)}
                  onDblClick={() => props.onQuick(it.uid)}
                >
                  <ItemIcon
                    item={it}
                    mark={mark() === "blocked" ? undefined : mark()}
                  />
                  <Show when={fresh()}>
                    <New aria-hidden="true">{t`NOVO`}</New>
                  </Show>
                  <Show when={props.selected.includes(it.uid)}>
                    <Check aria-hidden="true">✓</Check>
                  </Show>
                </Cell>
              )}
            </ItemTip>
          );
        }}
      </For>
    </StashGrid>
  );
}

// ------------------------------------------------------------ ouro

function GoldBox(props: { state: RpgHeroState; busy: boolean; run: RunFn }) {
  const { t } = useLingui();
  const h = () => props.state.hero;
  const [dir, setDir] = createSignal<"depositar" | "sacar">("depositar");
  const [amount, setAmount] = createSignal(0);
  const source = () => (dir() === "depositar" ? h().gold : h().vault.gold);
  const valid = () =>
    Number.isInteger(amount()) && amount() > 0 && amount() <= source();
  const hand = () => h().gold + (dir() === "depositar" ? -amount() : amount());
  const vault = () =>
    h().vault.gold + (dir() === "depositar" ? amount() : -amount());
  const quick = [1_000, 10_000, 100_000];
  return (
    <Panel>
      <Row role="group" aria-label={t`O que fazer`}>
        <Btn
          type="button"
          aria-pressed={dir() === "depositar"}
          onClick={() => {
            setDir("depositar");
            setAmount(0);
          }}
        >
          {t`Depositar`} →
        </Btn>
        <Btn
          type="button"
          aria-pressed={dir() === "sacar"}
          onClick={() => {
            setDir("sacar");
            setAmount(0);
          }}
        >
          ← {t`Sacar`}
        </Btn>
      </Row>
      <Muted>
        {dir() === "depositar"
          ? t`O ouro no cofre não se gasta sem querer nem vai para a corrida.`
          : t`O ouro sacado vai para a mão: é com ele que se compra e refina.`}
      </Muted>
      <Row>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={source()}
          value={amount() || ""}
          placeholder={t`Quanto`}
          aria-label={t`Quanto ouro`}
          onInput={(e) =>
            setAmount(
              Math.max(0, Math.floor(Number(e.currentTarget.value)) || 0),
            )
          }
        />
        <For each={quick}>
          {(n) => (
            <Btn
              type="button"
              data-size="sm"
              data-tone="quiet"
              disabled={n > source()}
              onClick={() => setAmount(Math.min(source(), amount() + n))}
            >
              +{gold(n)}
            </Btn>
          )}
        </For>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          disabled={source() < 2}
          onClick={() => setAmount(Math.floor(source() / 2))}
        >
          {t`Metade`}
        </Btn>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          disabled={source() === 0}
          onClick={() => setAmount(source())}
        >
          {t`Tudo`}
        </Btn>
      </Row>
      <Show when={amount() > 0}>
        <Summary data-bad={valid() ? undefined : ""}>
          <Show
            when={valid()}
            fallback={
              <span>
                {dir() === "depositar"
                  ? t`Você tem só ${gold(h().gold)} na mão.`
                  : t`O cofre tem só ${gold(h().vault.gold)}.`}
              </span>
            }
          >
            <span>
              {t`Fica na mão`}: <Gold n={gold(hand())} />
            </span>
            <span>
              {t`Fica no cofre`}: <Gold n={gold(vault())} />
            </span>
          </Show>
        </Summary>
      </Show>
      <Btn
        type="button"
        data-tone="primary"
        disabled={props.busy || !valid()}
        onClick={() =>
          void props
            .run(
              "rpg.bank",
              { gold: dir() === "depositar" ? amount() : -amount() },
              dir() === "depositar" ? t`Depositado.` : t`Sacado.`,
            )
            .then((o) => o && setAmount(0))
        }
      >
        {dir() === "depositar" ? t`Depositar` : t`Sacar`}{" "}
        <Show when={amount() > 0}>
          <Gold n={gold(amount())} />
        </Show>
      </Btn>
    </Panel>
  );
}

// ------------------------------------------------------------ transferência

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
            disabled={props.busy || !!props.state.run || !to() || !plan().ok}
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
          <Show
            when={props.state.run}
            fallback={
              <Muted>{t`Para mandar algo do cofre, retire para a mochila antes. Fica tudo no registro de transferências.`}</Muted>
            }
          >
            <Muted role="note">{t`Transferir fica para quando a corrida acabar.`}</Muted>
          </Show>
        </Panel>
      </Show>
    </>
  );
}

// ------------------------------------------------------------ estilos

const Wrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "12px" },
});
const Ledger = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "6px",
    "@container (max-width: 600px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
});
const Stat = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "rgba(0,0,0,0.28)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    fontVariantNumeric: "tabular-nums",
    "& > small": {
      fontSize: "0.72rem",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& > strong": { fontSize: "1rem" },
    "&[data-warn]": { borderColor: "#ff8a7a" },
    "&[data-warn] > strong": { color: "#ffb3a8" },
  },
});
const Meter = styled("span", {
  base: {
    display: "block",
    height: "4px",
    borderRadius: "2px",
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    "& > span": {
      display: "block",
      height: "100%",
      background: "var(--md-sys-color-primary)",
    },
  },
});
/** A linha de estado da barra de mover: dica, "cabem N", o que foi movido (com Desfazer) ou o erro. */
const Status = styled("div", {
  base: {
    flexBasis: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "30px",
    padding: "0 4px 0 10px",
    borderRadius: "8px",
    fontSize: "0.88em",
    color: "var(--md-sys-color-on-surface-variant)",
    "& > span": {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    "&[data-kind=ok]": {
      background: "rgba(126, 224, 138, 0.1)",
      color: "#cdf5d3",
    },
    "&[data-kind=warn]": { color: "#ffd8a0" },
    "&[data-kind=error]": {
      background: "rgba(255, 138, 122, 0.12)",
      color: "#ffcfc6",
    },
    "@container (max-width: 600px)": {
      "& > span": { whiteSpace: "normal" },
    },
  },
});
const Panes = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "12px",
    "@container (min-width: 760px)": {
      gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)",
    },
  },
});
const Pane = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
    padding: "10px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
  },
});
const PaneHead = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    "& > h3": {
      margin: 0,
      fontSize: "0.8rem",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--md-sys-color-on-surface-variant)",
    },
  },
});
const Count = styled("span", {
  base: {
    fontVariantNumeric: "tabular-nums",
    "&[data-full]": { color: "#ff8a7a" },
  },
});
const Chips = styled("div", {
  base: {
    display: "flex",
    gap: "4px",
    overflowX: "auto",
    scrollbarWidth: "none",
    paddingBottom: "2px",
  },
});
const Chip = styled("button", {
  base: {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "30px",
    padding: "2px 10px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    font: "inherit",
    fontSize: "0.85rem",
    cursor: "pointer",
    touchAction: "manipulation",
    "& > small": {
      fontVariantNumeric: "tabular-nums",
      color: "var(--md-sys-color-on-surface-variant)",
    },
    "& > b": { color: "var(--rc)", fontSize: "0.75rem", letterSpacing: "-1px" },
    "&[aria-pressed=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    "&[data-rarity][aria-pressed=true]": { borderColor: "var(--rc)" },
    "&[data-new]": { borderColor: "#7ee08a" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
    "@media (pointer: coarse)": { minHeight: "40px" },
  },
});
const Search = styled("input", {
  base: {
    minHeight: "36px",
    padding: "0 10px",
    borderRadius: "8px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface)",
    color: "inherit",
    font: "inherit",
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
});
const StashGrid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
    gap: "4px",
  },
});
const Cell = styled("button", {
  base: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    minHeight: "52px",
    padding: "4px 2px",
    borderRadius: "8px",
    border: "1px solid transparent",
    background: "rgba(0,0,0,0.22)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    touchAction: "manipulation",
    userSelect: "none",
    "&[aria-selected=true]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
    },
    "&[data-blocked] > span:first-child": {
      opacity: 0.45,
      filter: "grayscale(0.6)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
const New = styled("span", {
  base: {
    // Em cima da borda, no meio: não cobre os marcadores de raridade (canto) nem o ▲ (outro canto).
    position: "absolute",
    top: "-5px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "0 3px",
    borderRadius: "4px",
    fontSize: "8px",
    fontWeight: 800,
    lineHeight: "12px",
    background: "#2f6b3a",
    color: "#dfffe4",
    pointerEvents: "none",
  },
});
const Check = styled("span", {
  base: {
    position: "absolute",
    bottom: "1px",
    left: "3px",
    fontSize: "11px",
    fontWeight: 800,
    color: "var(--md-sys-color-primary)",
    textShadow: "0 0 2px #000, 0 0 2px #000",
    pointerEvents: "none",
  },
});
const Empty = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    padding: "16px 4px",
  },
});
const Tip = styled("small", {
  base: {
    fontSize: "0.75rem",
    color: "var(--md-sys-color-on-surface-variant)",
    "@media (hover: none)": { display: "none" },
  },
});
const MoveBar = styled("div", {
  base: {
    position: "sticky",
    bottom: 0,
    zIndex: 1,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "10px",
    borderRadius: "12px",
    background: "rgba(20, 18, 15, 0.96)",
    border: "1px solid var(--md-sys-color-outline)",
    boxShadow: "0 -6px 16px rgba(0,0,0,0.45)",
    // No celular a barra só aparece com algo escolhido, e os dois botões dividem a linha.
    "@container (max-width: 600px)": {
      padding: "8px",
      "&[data-idle]": { display: "none" },
      "& > button": { flex: "1 1 0", minWidth: 0 },
    },
  },
});
const Long = styled("span", {
  base: { "@container (max-width: 600px)": { display: "none" } },
});
const Short = styled("span", {
  base: {
    display: "none",
    "@container (max-width: 600px)": { display: "inline" },
  },
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
    minHeight: "36px",
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
    "&[data-bad]": { color: "#ffcfc6" },
  },
});
