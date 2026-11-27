import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";

import {
  type BubbleLabels,
  type BubblePlan,
  type HeadAnchor,
  type Measure,
  type SpaceView,
  BUBBLE,
  bubbleMs,
  bubbleText,
  planBubble,
} from "@muchat/space-client";
import type { Channel, Client, Message } from "stoat.js";

/**
 * O chat do Espaço (27/11/2026): quem está no mapa escreve ali mesmo e a fala aparece num balão
 * sobre a cabeça; a mensagem é uma mensagem comum do canal de texto (a sala é um canal do Stoat;
 * o saguão — hall, espinha e corredores — usa o primeiro canal de texto do servidor).
 *
 * Regras de quem vê o quê, espelhando o áudio (cada um ouve a própria sala):
 * - a fala de quem está na MESMA zona que você vira balão com o texto;
 * - a fala de quem está em OUTRA zona vira só o sinal de conversa (sem texto) sobre a pessoa;
 * - a mensagem do canal de onde você está, de quem não aparece no mapa (escreveu pelo canal, está
 *   fora da tela ou falou de outra sala), vira uma linha discreta perto do campo de texto.
 * Bloqueado não aparece; mensagem apagada some na hora; editada troca o texto.
 *
 * Nada aqui toca áudio (a regra zero da voz vale para `components/space/chat`).
 */

/** Um balão de fala com texto. */
export interface SayBubble {
  /** Id da mensagem. */
  key: string;
  channelId: string;
  userId: string;
  text: string;
  plan: BubblePlan;
  at: number;
  until: number;
  mine: boolean;
  /** Saindo (o fade antes de sumir). */
  leaving: boolean;
}

/** Uma linha perto do campo de texto: fala de quem não está à vista no mapa. */
export interface FeedLine {
  key: string;
  name: string;
  text: string;
  at: number;
  until: number;
  /** Envio que falhou (só as suas). */
  failed?: { channelId: string; idempotencyKey: string };
}

/** O sinal de conversa sobre quem fala em outra zona (sem o texto). */
export interface ElsewhereMark {
  channelId: string;
  until: number;
}

const ELSEWHERE_MS = 4_000;
const FEED_MS = 8_000;
const FEED_MAX = 3;
const LEAVE_MS = 220;

export interface SpaceChatOptions {
  serverId: string;
  client: Accessor<Client>;
  view: Accessor<SpaceView | null>;
  /** Muda quando alguém troca de lugar (o `ui()` do mapa, a 4 Hz no máximo). */
  tick: Accessor<unknown>;
  labels: BubbleLabels;
}

export type SpaceChat = ReturnType<typeof createSpaceChat>;

/** Canal de texto do saguão: o primeiro canal só de texto, na ordem da barra lateral, que a pessoa vê. */
export function hallChannelOf(
  client: Client,
  serverId: string,
): Channel | undefined {
  const server = client.servers.get(serverId);
  if (!server) return undefined;
  for (const cat of server.orderedChannels)
    for (const ch of cat.channels)
      if (
        ch &&
        ch.type === "TextChannel" &&
        !ch.isVoice &&
        ch.havePermission("ViewChannel")
      )
        return ch;
  return undefined;
}

/** Mede texto na fonte dos balões (a mesma do app), com um canvas que nunca entra na página. */
function canvasMeasure(): Measure {
  let ctx: CanvasRenderingContext2D | null = null;
  const cache = new Map<string, number>();
  return (text) => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    if (!ctx) {
      ctx = document.createElement("canvas").getContext("2d");
      const family =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--fonts-primary")
          .trim() || "system-ui, sans-serif";
      if (ctx) ctx.font = `${BUBBLE.fontPx}px ${family}`;
    }
    const w = ctx ? ctx.measureText(text).width : text.length * 7;
    if (cache.size > 500) cache.clear();
    cache.set(text, w);
    return w;
  };
}

export function createSpaceChat(opts: SpaceChatOptions) {
  const measure = canvasMeasure();
  const [says, setSays] = createStore<Record<string, SayBubble[]>>({});
  const [elsewhere, setElsewhere] = createStore<Record<string, ElsewhereMark>>(
    {},
  );
  const [feed, setFeed] = createSignal<FeedLine[]>([]);
  /** Cabeças que o mapa mostrou por último (quem tem balão): fora da tela vira linha. */
  let heads: ReadonlyMap<string, HeadAnchor> = new Map();
  /** Falas que já viraram linha (uma vez só). */
  const fed = new Set<string>();

  const myId = () => opts.client().user?.id;

  const hall = createMemo(() => hallChannelOf(opts.client(), opts.serverId));

  /** Canal da zona de alguém: a sala (o canal dela) ou o saguão; undefined fora do mapa. */
  function zoneChannelId(room: string | null | undefined): string | undefined {
    if (room === undefined) return undefined;
    if (room === null) return hall()?.id;
    return opts.client().channels.get(room) ? room : undefined;
  }

  /** Onde você está agora: a sala ou o saguão. */
  const hereRoom = createMemo(() => {
    opts.tick();
    const me = myId();
    const v = opts.view();
    return me && v ? v.roomOf(me) : undefined;
  });
  const hereChannelId = createMemo(() => zoneChannelId(hereRoom()));
  const hereChannel = createMemo(() => {
    const id = hereChannelId();
    return id ? opts.client().channels.get(id) : undefined;
  });

  // ---- relógio: um timer só, para o próximo vencimento ---------------------------------------

  let timer: ReturnType<typeof setTimeout> | undefined;
  const held = new Set<string>();

  function nextDue(): number {
    let due = Infinity;
    for (const list of Object.values(says))
      for (const b of list)
        if (!held.has(b.key))
          due = Math.min(due, b.leaving ? b.until + LEAVE_MS : b.until);
    for (const m of Object.values(elsewhere)) due = Math.min(due, m.until);
    for (const l of feed()) if (!l.failed) due = Math.min(due, l.until);
    return due;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const due = untrack(nextDue);
    if (!Number.isFinite(due)) return;
    timer = setTimeout(sweep, Math.max(16, due - Date.now()));
  }

  function sweep() {
    const now = Date.now();
    batch(() => {
      setSays(
        produce((all) => {
          for (const [user, list] of Object.entries(all)) {
            for (const b of list)
              if (!b.leaving && !held.has(b.key) && b.until <= now)
                b.leaving = true;
            const kept = list.filter(
              (b) => !(b.leaving && b.until + LEAVE_MS <= now),
            );
            if (kept.length) all[user] = kept;
            else delete all[user];
          }
        }),
      );
      setElsewhere(
        produce((all) => {
          for (const [user, m] of Object.entries(all))
            if (m.until <= now) delete all[user];
        }),
      );
      setFeed((f) => f.filter((l) => l.failed || l.until > now));
    });
    schedule();
  }

  // ---- entrada das mensagens ------------------------------------------------------------------

  function textOf(m: Message): string {
    return bubbleText(m.contentPlain, {
      attachments: m.attachments?.length ?? 0,
      labels: opts.labels,
    });
  }

  function pushSay(m: Message, text: string) {
    const now = Date.now();
    const plan = planBubble(text, measure);
    const shown = plan.mode === "ticker" ? plan.text : text;
    const bubble: SayBubble = {
      key: m.id,
      channelId: m.channelId,
      userId: m.authorId!,
      text: shown,
      plan,
      at: now,
      until: now + bubbleMs(shown, plan),
      mine: m.authorId === myId(),
      leaving: false,
    };
    batch(() => {
      setSays(
        produce((all) => {
          const list = all[bubble.userId] ?? [];
          list.push(bubble);
          all[bubble.userId] = list.slice(-BUBBLE.perPerson);
        }),
      );
      // A pessoa chegou à sua zona e falou: o sinal de "conversa em outra sala" dá lugar ao balão.
      setElsewhere(produce((all) => void delete all[bubble.userId]));
    });
    schedule();
  }

  function pushFeed(line: FeedLine) {
    setFeed((f) =>
      [...f.filter((l) => l.key !== line.key), line].slice(-FEED_MAX),
    );
    schedule();
  }

  function onCreate(m: Message) {
    if (m.channel?.serverId !== opts.serverId) return;
    if (m.systemMessage || !m.authorId) return;
    if (m.author?.relationship === "Blocked") return;
    const text = textOf(m);
    if (!text) return;
    const v = opts.view();
    const room = v ? v.roomOf(m.authorId) : undefined;
    const theirs = zoneChannelId(room);
    const here = hereChannelId();
    if (theirs === m.channelId) {
      if (m.channelId === here) {
        pushSay(m, text);
        // Ainda não sabemos se a cabeça está na tela: o mapa conta no próximo quadro (reportHeads).
        return;
      }
      setElsewhere(m.authorId, {
        channelId: m.channelId,
        until: Date.now() + ELSEWHERE_MS,
      });
      schedule();
      return;
    }
    if (m.channelId === here && m.authorId !== myId()) {
      fed.add(m.id);
      pushFeed({
        key: m.id,
        name: m.username ?? m.author?.displayName ?? "",
        text,
        at: Date.now(),
        until: Date.now() + FEED_MS,
      });
    }
  }

  function onUpdate(m: Message) {
    const text = textOf(m);
    batch(() => {
      setSays(
        produce((all) => {
          for (const [user, list] of Object.entries(all)) {
            const i = list.findIndex((b) => b.key === m.id);
            if (i < 0) continue;
            if (!text) {
              list.splice(i, 1);
              if (!list.length) delete all[user];
              continue;
            }
            const plan = planBubble(text, measure);
            const shown = plan.mode === "ticker" ? plan.text : text;
            const b = list[i]!;
            b.text = shown;
            b.plan = plan;
            b.until = Math.max(
              b.until,
              Date.now() + Math.min(bubbleMs(shown, plan), 6_000),
            );
          }
        }),
      );
      setFeed((f) =>
        f
          .map((l) => (l.key === m.id && text ? { ...l, text } : l))
          .filter((l) => l.key !== m.id || !!text),
      );
    });
    schedule();
  }

  function dropMessages(ids: ReadonlySet<string>) {
    batch(() => {
      setSays(
        produce((all) => {
          for (const [user, list] of Object.entries(all)) {
            const kept = list.filter((b) => !ids.has(b.key));
            if (kept.length === list.length) continue;
            if (kept.length) all[user] = kept;
            else delete all[user];
          }
        }),
      );
      setFeed((f) => f.filter((l) => !ids.has(l.key)));
    });
  }

  createEffect(
    on(opts.client, (c) => {
      const del = (m: { id: string }) => dropMessages(new Set([m.id]));
      const bulk = (ms: { id: string }[]) =>
        dropMessages(new Set(ms.map((m) => m.id)));
      c.addListener("messageCreate", onCreate);
      c.addListener("messageUpdate", onUpdate);
      c.addListener("messageDelete", del);
      c.addListener("messageDeleteBulk", bulk);
      onCleanup(() => {
        c.removeListener("messageCreate", onCreate);
        c.removeListener("messageUpdate", onUpdate);
        c.removeListener("messageDelete", del);
        c.removeListener("messageDeleteBulk", bulk);
      });
    }),
  );

  // ---- digitando ------------------------------------------------------------------------------

  /** Quem está digitando no canal de onde você está e está nessa mesma zona do mapa. */
  const typing = createMemo<string[]>((prev) => {
    opts.tick();
    const ch = hereChannel();
    const v = opts.view();
    const me = myId();
    if (!ch || !v) return prev.length ? [] : prev;
    const ids = [...ch.typingIds]
      .filter((id) => id !== me && zoneChannelId(v.roomOf(id)) === ch.id)
      .sort();
    return ids.join() === prev.join() ? prev : ids;
  }, []);

  // ---- colunas (uma por pessoa com algo sobre a cabeça) ---------------------------------------

  const columnIds = createMemo<string[]>((prev) => {
    const ids = new Set<string>([
      ...Object.keys(says),
      ...Object.keys(elsewhere),
      ...typing(),
    ]);
    const next = [...ids].sort();
    return next.join() === prev.join() ? prev : next;
  }, []);

  /** Prioridade de cada coluna no layout: quem falou por último fica no lugar natural. */
  function orderOf(userId: string): number {
    const last = (id: string) =>
      Math.max(
        0,
        ...(says[id] ?? []).map((b) => b.at),
        typing().includes(id) ? Date.now() : 0,
        elsewhere[id] ? elsewhere[id]!.until - ELSEWHERE_MS : 0,
      );
    const mine = last(userId);
    return columnIds().filter((id) => last(id) > mine).length;
  }

  /** O mapa contou onde as cabeças estão: fala de quem está fora da tela também vira linha. */
  function reportHeads(next: ReadonlyMap<string, HeadAnchor>) {
    heads = next;
    const here = hereChannelId();
    for (const [user, list] of Object.entries(says)) {
      const h = heads.get(user);
      if (h?.visible) continue;
      for (const b of list) {
        if (b.leaving || fed.has(b.key) || b.channelId !== here || b.mine)
          continue;
        fed.add(b.key);
        const m = opts.client().messages.get(b.key);
        pushFeed({
          key: b.key,
          name: m?.username ?? m?.author?.displayName ?? "",
          text: b.text,
          at: b.at,
          until: Date.now() + FEED_MS,
        });
      }
    }
    if (fed.size > 400) fed.clear();
  }

  /** O ponteiro está sobre o balão: ele não some (e a esteira para) enquanto a pessoa lê. */
  function hold(key: string, on: boolean) {
    if (on) held.add(key);
    else {
      held.delete(key);
      const now = Date.now();
      setSays(
        produce((all) => {
          for (const list of Object.values(all))
            for (const b of list)
              if (b.key === key) {
                b.leaving = false;
                b.until = Math.max(b.until, now + 2_000);
              }
        }),
      );
    }
    schedule();
  }

  /** Falha de envio das suas mensagens: vira linha com "Tentar de novo" (a lista mostra no painel). */
  function reportFailed(
    name: string,
    channelId: string,
    idempotencyKey: string,
    text: string,
  ) {
    pushFeed({
      key: `failed:${idempotencyKey}`,
      name,
      text,
      at: Date.now(),
      until: Infinity,
      failed: { channelId, idempotencyKey },
    });
  }

  function dismissFeed(key: string) {
    setFeed((f) => f.filter((l) => l.key !== key));
    schedule();
  }

  /** Trocou de zona: as linhas da zona anterior saem (os balões terminam o tempo deles). */
  createEffect(
    on(hereChannelId, () => setFeed((f) => f.filter((l) => l.failed)), {
      defer: true,
    }),
  );

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    setSays(reconcile({}));
  });

  return {
    says,
    elsewhere,
    typing,
    feed,
    columnIds,
    orderOf,
    reportHeads,
    hold,
    reportFailed,
    dismissFeed,
    hall,
    hereChannel,
    hereChannelId,
    zoneChannelId,
  };
}
