import {
  type ClassId,
  type HeroV5,
  type OwnedItem,
  type RpgHeroState,
  type RunSpoils,
  CLEARED_MAX,
  applyRun,
  checkHero,
  createHero,
  goldTransferFee,
  itemTransferFee,
  startDojo,
  stopDojo,
  withCleared,
} from "@muchat/space-core/game/ot/balance";

/**
 * O herói da engine nova no servidor (Fase 8): o herói v5 do núcleo (balance/hero.ts) mais o que só o
 * servidor sabe — revisão, datas, o treino no Dojô (em que boneco e servidor), a corrida em
 * andamento e as transferências a caminho. Na virada todo mundo recomeça (D34): não há conversão do
 * v4, e a coleção é outra (store.ts), de modo que a antiga fica intacta para o rollback.
 */

export const RPG_VERSION = 5;

/** Treino no Dojô: onde e desde quando (o runtime confere se a pessoa segue ao lado do boneco). */
export interface RpgDojo {
  instance: string;
  server: string;
  zone: string;
  since: number;
}

export interface RpgRunMark {
  id: string;
  dungeon: string;
  ends_at: number;
}
/** Marca de corrida que passou muito do fim (o processo caiu e ninguém fechou) deixa de prender. */
export const RUN_STALE_MS = 10 * 60_000;

/** Uma transferência saindo (o crédito no destino é por `id`, uma vez só). */
export interface RpgTransfer {
  id: string;
  to: string;
  gold: number;
  items: OwnedItem[];
  at: number;
}
export const INBOX_KEEP = 64;
export const OUTBOX_MAX = 16;

export interface RpgHeroDoc {
  _id: string;
  v: typeof RPG_VERSION;
  rev: number;
  created_at: number;
  updated_at: number;
  hero: HeroV5;
  /*
   * A stamina saiu do jogo (27/11/2026: o dono quer grindar à vontade, XP igual para todos). Documento
   * de antes disso ainda traz `stamina`/`stamina_at`: ninguém lê.
   */
  dojo: RpgDojo | null;
  run: RpgRunMark | null;
  outbox: RpgTransfer[];
  inbox: string[];
  /**
   * As DGs concluídas (o grupo venceu com o herói; 26/11/2026), ids canônicos. Ausente: documento de
   * antes disso; o serviço preenche na leitura com as vitórias guardadas em `rpg_runs5`.
   */
  cleared?: string[];
}

export type RpgOutcome = { ok: true } | { ok: false; reason: string };
const no = (reason: string): RpgOutcome => ({ ok: false, reason });
const yes: RpgOutcome = { ok: true };

/** Jogador novo com a classe escolhida (kit Comum do nível 1, D36). */
export function newRpgHero(
  userId: string,
  cls: ClassId,
  now: number,
  newId: () => string,
): RpgHeroDoc {
  return {
    _id: userId,
    v: RPG_VERSION,
    rev: 0,
    created_at: now,
    updated_at: now,
    hero: createHero(cls, newId),
    dojo: null,
    run: null,
    outbox: [],
    inbox: [],
    cleared: [],
  };
}

/** Confere o documento lido do banco; o motivo vai para o log (nada é consertado em silêncio). */
export function checkHeroDoc(
  raw: unknown,
): { ok: true; doc: RpgHeroDoc } | { ok: false; reason: string } {
  const d = raw as Partial<RpgHeroDoc> | null;
  if (!d || typeof d !== "object") return { ok: false, reason: "vazio" };
  if (d.v !== RPG_VERSION)
    return { ok: false, reason: `versão ${String(d.v)}` };
  if (typeof d._id !== "string" || typeof d.rev !== "number")
    return { ok: false, reason: "cabeçalho" };
  const h = checkHero(d.hero);
  if (!h.ok) return { ok: false, reason: `herói: ${h.reason}` };
  if (!Array.isArray(d.outbox) || !Array.isArray(d.inbox))
    return { ok: false, reason: "transferências" };
  if (
    d.cleared !== undefined &&
    (!Array.isArray(d.cleared) ||
      d.cleared.length > CLEARED_MAX ||
      d.cleared.some((x) => typeof x !== "string"))
  )
    return { ok: false, reason: "concluídas" };
  return { ok: true, doc: d as RpgHeroDoc };
}

/** A DG vencida pelo grupo fica concluída para o herói (uma vez; ids canônicos). */
export function markCleared(d: RpgHeroDoc, dungeon: string): void {
  d.cleared = withCleared(d.cleared, dungeon);
}

export function inRun(d: RpgHeroDoc, now: number): boolean {
  return d.run !== null && now < d.run.ends_at + RUN_STALE_MS;
}

/** O código de vocação que o mapa usa para a animação de treino (1 magia, 2 cura, 3 arco, 4 corpo a corpo). */
const LOOK_VOCATION: Record<ClassId, number> = {
  mago: 1,
  padre: 2,
  druida: 2,
  cacador: 3,
  guerreiro: 4,
  paladino: 4,
  assassino: 4,
};

/** O herói no avatar do mapa: nível, classe e a aparência do que veste (família, peso, munição). */
export function heroLook(d: RpgHeroDoc) {
  const e = d.hero.equipment;
  const gear: Record<string, string> = {};
  if (e.arma) gear.weapon = e.arma.family;
  if (e.secundaria) gear.shield = e.secundaria.offhand;
  if (e.elmo) gear.head = e.elmo.weight;
  if (e.armadura) gear.body = e.armadura.weight;
  if (e.calcas) gear.legs = e.calcas.weight;
  if (e.botas) gear.feet = e.botas.weight;
  return {
    level: d.hero.level,
    vocation: LOOK_VOCATION[d.hero.cls],
    cls: d.hero.cls,
    gear,
  };
}

// ------------------------------------------------------------ Dojô

/** Fecha o treino no Dojô em `now` (credita o tempo; `others` = quantos treinam na mesma sala). */
export function closeDojo(d: RpgHeroDoc, now: number, others: number): boolean {
  if (!d.dojo) return false;
  const r = stopDojo({ ...d.hero, dojo: { since: d.dojo.since } }, now, others);
  if (r.ok) d.hero = r.hero;
  d.dojo = null;
  return true;
}

export function openDojo(
  d: RpgHeroDoc,
  where: { instance: string; server: string; zone: string },
  now: number,
): RpgOutcome {
  if (inRun(d, now)) return no("in_run");
  if (
    d.dojo &&
    d.dojo.instance === where.instance &&
    d.dojo.server === where.server
  )
    return yes;
  if (d.dojo) closeDojo(d, now, 0);
  const r = startDojo({ ...d.hero, dojo: null }, now);
  if (!r.ok) return no(r.error);
  d.dojo = { ...where, since: now };
  return yes;
}

// ------------------------------------------------------------ corrida

/** Marca a corrida no herói (o treino fecha antes). */
export function markRun(
  d: RpgHeroDoc,
  mark: RpgRunMark,
  now: number,
): RpgOutcome {
  if (inRun(d, now) && d.run?.id !== mark.id) return no("in_run");
  closeDojo(d, now, 0);
  d.run = mark;
  return yes;
}

export interface SettledHero {
  left: OwnedItem[];
  /** O que não coube na mochila e foi para o cofre do Banqueiro (27/11/2026). */
  toVault: OwnedItem[];
  levelsGained: number;
  jobsGained: number;
}

/**
 * Fecha a corrida no herói (uma vez: a marca tem de ser desta corrida). `spoils` null = saiu antes
 * (sem recompensa); as poções e a munição gastas entram de qualquer jeito.
 */
export function settleRunHero(
  d: RpgHeroDoc,
  runId: string,
  spoils: RunSpoils | null,
  spent: { potionsUsed: { hp: number; mp: number }; ammoUsed: number },
): { ok: true; settled: SettledHero } | { ok: false; reason: string } {
  if (d.run?.id !== runId) return { ok: false, reason: "no_run" };
  const s: RunSpoils = spoils ?? {
    xp: 0,
    jobXp: 0,
    gold: 0,
    items: [],
    ores: {},
    stones: 0,
    potionsUsed: spent.potionsUsed,
    ammoUsed: spent.ammoUsed,
  };
  const r = applyRun(d.hero, s);
  if (!r.ok) return { ok: false, reason: "apply" };
  d.hero = r.hero;
  d.run = null;
  return {
    ok: true,
    settled: {
      left: r.left,
      toVault: r.toVault,
      levelsGained: r.levelsGained,
      jobsGained: r.jobsGained,
    },
  };
}

// ------------------------------------------------------------ transferência (Banqueiro)

/** Tira o ouro (com a taxa) e os itens da mochila e põe na fila de saída. */
export function transferOut(
  d: RpgHeroDoc,
  t: RpgTransfer,
  now: number,
): RpgOutcome {
  if (inRun(d, now)) return no("in_run");
  if (d.outbox.length >= OUTBOX_MAX) return no("outbox_full");
  const items: OwnedItem[] = [];
  const bag = [...d.hero.bag];
  for (const it of t.items) {
    const i = bag.findIndex((x) => x.uid === it.uid);
    if (i < 0) return no("item-nao-encontrado");
    items.push(bag[i]!);
    bag.splice(i, 1);
  }
  const fee =
    (t.gold > 0 ? goldTransferFee(t.gold) : 0) +
    items.reduce((a, i) => a + itemTransferFee(i), 0);
  if (t.gold + fee > d.hero.gold) return no("sem-ouro");
  d.hero = { ...d.hero, gold: d.hero.gold - t.gold - fee, bag };
  d.outbox.push({ ...t, items });
  return yes;
}

/** Credita no destino (uma vez por id; itens que não cabem na mochila vão para o cofre). */
export function transferIn(d: RpgHeroDoc, t: RpgTransfer): RpgOutcome {
  if (d.inbox.includes(t.id)) return yes;
  const room = Math.max(0, 40 - d.hero.bag.length);
  const toBag = t.items.slice(0, room);
  const toVault = t.items.slice(room);
  d.hero = {
    ...d.hero,
    gold: d.hero.gold + t.gold,
    bag: [...d.hero.bag, ...toBag],
    vault: { ...d.hero.vault, items: [...d.hero.vault.items, ...toVault] },
  };
  d.inbox.push(t.id);
  while (d.inbox.length > INBOX_KEEP) d.inbox.shift();
  return yes;
}

/** Baixa na origem; `refund`: o destino não existe e tudo volta (a taxa fica). */
export function transferSettled(
  d: RpgHeroDoc,
  id: string,
  refund: boolean,
): RpgOutcome {
  const i = d.outbox.findIndex((x) => x.id === id);
  if (i < 0) return yes;
  const t = d.outbox[i]!;
  d.outbox.splice(i, 1);
  if (refund) {
    const room = Math.max(0, 40 - d.hero.bag.length);
    d.hero = {
      ...d.hero,
      gold: d.hero.gold + t.gold,
      bag: [...d.hero.bag, ...t.items.slice(0, room)],
      vault: {
        ...d.hero.vault,
        items: [...d.hero.vault.items, ...t.items.slice(room)],
      },
    };
  }
  return yes;
}

// ------------------------------------------------------------ o que o app recebe

export function rpgHeroState(
  d: RpgHeroDoc,
  rates: { exp: number },
): RpgHeroState {
  return {
    hero: d.hero,
    dojo: d.dojo ? { instance: d.dojo.instance, since: d.dojo.since } : null,
    run: d.run,
    rates: { exp: rates.exp },
    cleared: d.cleared ?? [],
  };
}

export const RPG_DOC_MAX_BYTES = 64 * 1024;
export function rpgDocBytes(d: RpgHeroDoc): number {
  return Buffer.byteLength(JSON.stringify(d), "utf8");
}
