import {
  type OwnedItem,
  type RpgChestEvent,
  type RpgChestLogRow,
  CHEST_ITEM_TTL_MS,
  CHEST_LOG_KEEP,
  CHEST_SLOTS,
  ITEM_RULES,
  checkItems,
  itemName,
  legendaryOf,
  upgradeAffixesToD64,
} from "@muchat/space-core/game/ot/balance";
import type { MongoClient } from "mongodb";

import type { RpgOutcome, RpgTransfer } from "./hero.ts";

/**
 * O baú compartilhado (28/11/2026, o dono: "um baú compartilhado; todos podem pôr/pegar item de lá"):
 * um documento por servidor do Muchat, aberto em qualquer baú do mapa. Apagar ou mudar o baú de
 * lugar no editor não perde nada, porque o conteúdo não mora na decoração.
 *
 * Os itens passam entre o herói e o baú como as transferências do Banqueiro: quem dá põe na fila de
 * saída e quem recebe credita pelo `id`, uma vez só. Se o processo cair no meio, a próxima leitura de
 * quem deu entrega de novo, e nada some nem duplica.
 * - Pôr: a mochila do herói vai para a fila de saída dele (`chestOut`), o baú credita (`chestCredit`) e o
 *   herói dá baixa (`transferSettled`); baú cheio devolve tudo.
 * - Pegar: o baú tira os itens para a fila de saída dele (`chestDebit`), o herói credita (`transferIn`) e
 *   o baú dá baixa (`chestSettled`); sem herói, volta para o baú.
 * - O ouro (28/11/2026) passa pelo mesmo caminho (`gold` da transferência) e não some.
 * - Item que passa 5 dias no baú some (28/11/2026, o dono): `chestExpire` antes de toda mudança e o
 *   app nem vê (`chestEvent`). O baú gravado antes disso não tem `put_at`: conta da última mudança.
 */

export const CHEST_VERSION = 1;
export const CHEST_COLLECTION = "rpg_chests5";
/**
 * Os ids já creditados. Folga grande: uma entrega que ficou para trás (o processo caiu) só volta
 * quando quem pôs entra de novo, e o id dela precisa continuar aqui até lá.
 */
export const CHEST_INBOX_KEEP = 512;
/** Entregas do baú para heróis ainda sem baixa (normalmente zero: a baixa vem em seguida). */
export const CHEST_OUTBOX_MAX = 64;

export interface RpgChestDoc {
  /** O servidor do Muchat. */
  _id: string;
  v: typeof CHEST_VERSION;
  rev: number;
  created_at: number;
  updated_at: number;
  /** A regra de item dos itens guardados (ITEM_RULES); abaixo da de agora, a leitura reescala. */
  item_rules: number;
  /** O mais antigo primeiro. */
  items: OwnedItem[];
  /** Quando cada item entrou (pelo uid): some em `put_at + CHEST_ITEM_TTL_MS` (28/11/2026). */
  put_at: Record<string, number>;
  /** O ouro do baú (28/11/2026): não some. */
  gold: number;
  /** O mais novo primeiro, até CHEST_LOG_KEEP. */
  log: RpgChestLogRow[];
  inbox: string[];
  outbox: RpgTransfer[];
}

const ok: RpgOutcome = { ok: true };
const no = (reason: string): RpgOutcome => ({ ok: false, reason });

export function newChest(serverId: string, now: number): RpgChestDoc {
  return {
    _id: serverId,
    v: CHEST_VERSION,
    rev: 0,
    created_at: now,
    updated_at: now,
    item_rules: ITEM_RULES,
    items: [],
    put_at: {},
    gold: 0,
    log: [],
    inbox: [],
    outbox: [],
  };
}

function logRow(
  user: string,
  name: string,
  action: RpgChestLogRow["action"],
  items: OwnedItem[],
  at: number,
  gold = 0,
): RpgChestLogRow {
  return {
    at,
    user_id: user,
    name,
    action,
    items: items.slice(0, 3).map((it) => ({
      name: itemName(it, legendaryOf(it)?.name),
      rarity: it.rarity,
      refine: it.refine,
    })),
    count: items.length,
    ...(gold > 0 ? { gold } : {}),
  };
}

function addLog(c: RpgChestDoc, row: RpgChestLogRow) {
  c.log = [row, ...c.log].slice(0, CHEST_LOG_KEEP);
}

/** O item passou de 5 dias no baú (28/11/2026): some. */
export function chestExpired(c: RpgChestDoc, uid: string, now: number): boolean {
  return (c.put_at[uid] ?? c.updated_at) + CHEST_ITEM_TTL_MS <= now;
}

/**
 * Tira do baú os itens que passaram de 5 dias e registra no histórico (uma linha, sem pessoa). Roda
 * antes de toda mudança; a leitura sem mudança só esconde (`chestEvent`).
 */
export function chestExpire(c: RpgChestDoc, now: number): number {
  const gone = c.items.filter((x) => chestExpired(c, x.uid, now));
  if (gone.length === 0) return 0;
  const keep = new Set(gone.map((x) => x.uid));
  c.items = c.items.filter((x) => !keep.has(x.uid));
  c.put_at = Object.fromEntries(
    Object.entries(c.put_at).filter(([uid]) => !keep.has(uid)),
  );
  addLog(c, logRow("", "", "sumiu", gone, now));
  return gone.length;
}

/**
 * Credita o que `from` pôs (uma vez por id): itens e ouro. Não cabe: recusa (`chest_full`) e quem pôs
 * recebe de volta. Um item que o baú já tem (mesmo uid) não entra duas vezes.
 */
export function chestCredit(
  c: RpgChestDoc,
  t: RpgTransfer,
  from: string,
  now: number,
): RpgOutcome {
  if (c.inbox.includes(t.id)) return ok;
  const have = new Set(c.items.map((x) => x.uid));
  const fresh = t.items.filter((x) => !have.has(x.uid));
  if (c.items.length + fresh.length > CHEST_SLOTS) return no("chest_full");
  c.items = [...c.items, ...fresh];
  c.put_at = { ...c.put_at, ...Object.fromEntries(fresh.map((x) => [x.uid, now])) };
  c.gold += t.gold;
  c.inbox = [...c.inbox, t.id].slice(-CHEST_INBOX_KEEP);
  if (fresh.length > 0 || t.gold > 0)
    addLog(c, logRow(from, t.name ?? "", "pos", fresh, now, t.gold));
  return ok;
}

/**
 * Tira `uids` e `gold` do baú para `to` (tudo ou nada): vão para a fila de saída com o id `id`, e o
 * herói credita por ele. Algum item já saiu (outra pessoa pegou antes, ou sumiu): `chest_gone`; ouro a
 * menos do que o pedido: `chest_sem_ouro`.
 */
export function chestDebit(
  c: RpgChestDoc,
  uids: readonly string[],
  to: { user: string; name: string },
  id: string,
  now: number,
  gold = 0,
): RpgOutcome {
  const want = new Set(uids);
  if (want.size !== uids.length || !Number.isInteger(gold) || gold < 0)
    return no("lista-invalida");
  if (uids.length === 0 && gold === 0) return no("lista-invalida");
  if (c.outbox.length >= CHEST_OUTBOX_MAX) return no("chest_busy");
  const items = c.items.filter((x) => want.has(x.uid));
  if (items.length !== want.size) return no("chest_gone");
  if (gold > c.gold) return no("chest_sem_ouro");
  c.items = c.items.filter((x) => !want.has(x.uid));
  c.put_at = Object.fromEntries(
    Object.entries(c.put_at).filter(([uid]) => !want.has(uid)),
  );
  c.gold -= gold;
  c.outbox = [
    ...c.outbox,
    { id, to: to.user, gold, items, at: now, name: to.name },
  ];
  addLog(c, logRow(to.user, to.name, "pegou", items, now, gold));
  return ok;
}

/** Baixa de uma entrega do baú; `refund`: a pessoa não tem herói e tudo volta para o baú. */
export function chestSettled(
  c: RpgChestDoc,
  id: string,
  refund: boolean,
  now: number,
): RpgOutcome {
  const t = c.outbox.find((x) => x.id === id);
  if (!t) return ok;
  c.outbox = c.outbox.filter((x) => x.id !== id);
  if (refund) {
    const have = new Set(c.items.map((x) => x.uid));
    const back = t.items.filter((x) => !have.has(x.uid));
    c.items = [...c.items, ...back];
    c.put_at = { ...c.put_at, ...Object.fromEntries(back.map((x) => [x.uid, now])) };
    c.gold += t.gold;
  }
  return ok;
}

/** O que o app vê: sem os itens que já passaram de 5 dias (mesmo que a próxima mudança ainda vá tirá-los). */
export function chestEvent(
  c: RpgChestDoc,
  now: number,
  re?: string,
): RpgChestEvent {
  const items = c.items.filter((x) => !chestExpired(c, x.uid, now));
  return {
    v: 1,
    t: "rpg.chest",
    ...(re ? { re } : {}),
    d: {
      rev: c.rev,
      slots: CHEST_SLOTS,
      items,
      put_at: Object.fromEntries(
        items.map((x) => [x.uid, c.put_at[x.uid] ?? c.updated_at]),
      ),
      ttl_ms: CHEST_ITEM_TTL_MS,
      gold: c.gold,
      log: c.log,
    },
  };
}

// ------------------------------------------------------------ leitura

const isNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";

function checkLog(raw: unknown): boolean {
  return (
    Array.isArray(raw) &&
    raw.length <= CHEST_LOG_KEEP * 2 &&
    raw.every((r) => {
      const x = r as Partial<RpgChestLogRow> | null;
      return (
        !!x &&
        isNum(x.at) &&
        isStr(x.user_id) &&
        isStr(x.name) &&
        (x.action === "pos" || x.action === "pegou" || x.action === "sumiu") &&
        Array.isArray(x.items) &&
        isNum(x.count)
      );
    })
  );
}

/**
 * Confere o baú lido do banco (o motivo vai para o log; nada é consertado em silêncio). A única
 * correção é a regra de item que mudou: o afixo vai para a faixa de agora, como no herói (D64).
 */
export function checkChestDoc(
  raw: unknown,
):
  | { ok: true; doc: RpgChestDoc; rescaled: number }
  | { ok: false; reason: string } {
  const d = raw as Partial<RpgChestDoc> | null;
  if (!d || typeof d !== "object") return { ok: false, reason: "vazio" };
  if (d.v !== CHEST_VERSION)
    return { ok: false, reason: `versão ${String(d.v)}` };
  if (
    !isStr(d._id) ||
    !isNum(d.rev) ||
    !isNum(d.created_at) ||
    !isNum(d.updated_at) ||
    !isNum(d.item_rules)
  )
    return { ok: false, reason: "cabeçalho" };
  const items = checkItems(d.items);
  if (!items.ok) return { ok: false, reason: `itens: ${items.reason}` };
  if (!checkLog(d.log)) return { ok: false, reason: "histórico" };
  if (!Array.isArray(d.inbox) || !d.inbox.every(isStr))
    return { ok: false, reason: "entradas" };
  if (!Array.isArray(d.outbox)) return { ok: false, reason: "saídas" };
  const outbox: RpgTransfer[] = [];
  for (const t of d.outbox as unknown[]) {
    const x = t as Partial<RpgTransfer> | null;
    const its = checkItems(x?.items);
    if (
      !x ||
      !isStr(x.id) ||
      !isStr(x.to) ||
      !isNum(x.gold) ||
      x.gold < 0 ||
      !isNum(x.at) ||
      !its.ok
    )
      return { ok: false, reason: "saídas" };
    outbox.push({ ...(x as RpgTransfer), items: its.items });
  }
  // O baú gravado antes de 28/11/2026 (o primeiro deploy) não tem ouro nem `put_at`.
  if (d.gold !== undefined && (!isNum(d.gold) || d.gold < 0))
    return { ok: false, reason: "ouro" };
  if (
    d.put_at !== undefined &&
    (typeof d.put_at !== "object" ||
      d.put_at === null ||
      !Object.values(d.put_at).every(isNum))
  )
    return { ok: false, reason: "datas" };
  const doc: RpgChestDoc = {
    ...(d as RpgChestDoc),
    items: items.items,
    put_at: d.put_at ?? {},
    gold: d.gold ?? 0,
    outbox,
  };
  const uids = [
    ...doc.items.map((x) => x.uid),
    ...doc.outbox.flatMap((t) => t.items.map((x) => x.uid)),
  ];
  if (new Set(uids).size !== uids.length)
    return { ok: false, reason: "item repetido" };
  if (doc.item_rules >= ITEM_RULES) return { ok: true, doc, rescaled: 0 };
  let rescaled = 0;
  const up = (it: OwnedItem): OwnedItem => {
    const next = upgradeAffixesToD64(it);
    if (next !== it) rescaled++;
    return next;
  };
  return {
    ok: true,
    doc: {
      ...doc,
      item_rules: ITEM_RULES,
      items: doc.items.map(up),
      outbox: doc.outbox.map((t) => ({ ...t, items: t.items.map(up) })),
    },
    rescaled,
  };
}

// ------------------------------------------------------------ onde mora

/** Compare-and-set em `rev`, como o herói: a fila do serviço serializa um processo e o CAS cobre dois. */
export interface ChestStore {
  get(serverId: string): Promise<unknown | null>;
  /** Grava o primeiro baú do servidor; false se ele já existe. */
  create(doc: RpgChestDoc): Promise<boolean>;
  /** Substitui se o `rev` guardado ainda é `expectRev`; false se alguém gravou antes. */
  save(doc: RpgChestDoc, expectRev: number): Promise<boolean>;
}

export class MemoryChestStore implements ChestStore {
  readonly docs = new Map<string, RpgChestDoc>();
  /** Teste: a próxima gravação perde a corrida do CAS (outro processo gravou antes). */
  failNextSave = 0;

  async get(serverId: string): Promise<unknown | null> {
    const d = this.docs.get(serverId);
    return d ? structuredClone(d) : null;
  }

  async create(doc: RpgChestDoc): Promise<boolean> {
    if (this.docs.has(doc._id)) return false;
    this.docs.set(doc._id, structuredClone(doc));
    return true;
  }

  async save(doc: RpgChestDoc, expectRev: number): Promise<boolean> {
    if (this.failNextSave > 0) {
      this.failNextSave--;
      return false;
    }
    const cur = this.docs.get(doc._id);
    if (!cur || cur.rev !== expectRev) return false;
    this.docs.set(doc._id, structuredClone(doc));
    return true;
  }
}

const OP = { maxTimeMS: 2_000 } as const;
type ChestMongo = RpgChestDoc & { mtime: Date };

export class MongoChestStore implements ChestStore {
  private readonly col;

  constructor(client: Pick<MongoClient, "db">, db = "muchat_space") {
    this.col = client.db(db).collection<ChestMongo>(CHEST_COLLECTION);
  }

  async get(serverId: string): Promise<unknown | null> {
    const raw = await this.col.findOne({ _id: serverId }, OP);
    if (!raw) return null;
    const { mtime: _m, ...doc } = raw;
    return doc;
  }

  async create(doc: RpgChestDoc): Promise<boolean> {
    try {
      await this.col.insertOne({ ...doc, mtime: new Date() }, OP);
      return true;
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) return false;
      throw err;
    }
  }

  async save(doc: RpgChestDoc, expectRev: number): Promise<boolean> {
    const res = await this.col.replaceOne(
      { _id: doc._id, rev: expectRev },
      { ...doc, mtime: new Date() },
      OP,
    );
    return res.matchedCount === 1;
  }
}
