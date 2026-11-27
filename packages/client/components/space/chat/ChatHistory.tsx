import {
  For,
  Match,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { type BubbleLabels, bubbleText, ttsBody } from "@muchat/space-client";
import type { Channel, Message } from "stoat.js";
import { css } from "styled-system/css";

import { useClient } from "@revolt/client";
import { useTime } from "@revolt/i18n";

import { TtsFace } from "./TtsFace";

/** Mensagens buscadas ao abrir (e o teto guardado enquanto chegam novas). */
const FETCH = 30;
const KEEP = 60;
/** Falas seguidas da mesma pessoa dentro disto formam um grupo (o nome aparece uma vez). */
const GROUP_MS = 5 * 60_000;

interface Props {
  channel: Channel;
  labels: BubbleLabels;
  speaking: (messageId: string) => boolean;
  /** Um clique numa fala: o painel do chat abre nela. */
  onOpen: (messageId: string) => void;
}

/**
 * O histórico do canal de onde você está, logo acima do campo do mapa (27/11/2026): as últimas
 * falas da sala (ou do saguão), com quem disse e a hora; as suas à direita. Texto simples, como
 * nos balões (spoiler escondido, link curto); um clique abre a fala no painel do chat, com tudo.
 * Acompanha o canal ao vivo: mensagem nova, editada e apagada.
 */
export function ChatHistory(props: Props) {
  const { t } = useLingui();
  const client = useClient();
  const dayjs = useTime();
  const [items, setItems] = createSignal<Message[]>([]);
  const [state, setState] = createSignal<"loading" | "ready" | "error">(
    "loading",
  );

  /** Junta por id e ordena (ids do Stoat são ULID: a ordem é a do tempo). */
  function merge(list: Message[]) {
    const byId = new Map<string, Message>();
    for (const m of list) byId.set(m.id, m);
    return [...byId.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(-KEEP);
  }

  createEffect(
    on(
      () => props.channel.id,
      () => {
        let alive = true;
        setItems([]);
        setState("loading");
        props.channel
          .fetchMessagesWithUsers({ limit: FETCH })
          .then(({ messages }) => {
            if (!alive) return;
            // O que chegou ao vivo durante a busca fica junto.
            setItems((now) => merge([...messages, ...now]));
            setState("ready");
          })
          .catch(() => alive && setState("error"));
        onCleanup(() => (alive = false));
      },
    ),
  );

  createEffect(
    on(client, (c) => {
      const add = (m: Message) => {
        if (m.channelId === props.channel.id)
          setItems((now) => merge([...now, m]));
      };
      const drop = (ids: Set<string>) =>
        setItems((now) => now.filter((m) => !ids.has(m.id)));
      const del = (m: { id: string }) => drop(new Set([m.id]));
      const bulk = (ms: { id: string }[]) => drop(new Set(ms.map((m) => m.id)));
      c.addListener("messageCreate", add);
      c.addListener("messageDelete", del);
      c.addListener("messageDeleteBulk", bulk);
      onCleanup(() => {
        c.removeListener("messageCreate", add);
        c.removeListener("messageDelete", del);
        c.removeListener("messageDeleteBulk", bulk);
      });
    }),
  );

  const me = () => client().user?.id;

  /** As falas que aparecem (sem mensagem de sistema nem de quem você bloqueou). */
  const rows = createMemo(() => {
    const out: Array<{ m: Message; first: boolean; mine: boolean }> = [];
    let prev: Message | null = null;
    for (const m of items()) {
      if (m.systemMessage || !m.authorId) continue;
      if (m.author?.relationship === "Blocked") continue;
      const first =
        !prev ||
        prev.authorId !== m.authorId ||
        m.createdAt.getTime() - prev.createdAt.getTime() > GROUP_MS;
      out.push({ m, first, mine: m.authorId === me() });
      prev = m;
    }
    return out;
  });

  // O texto acompanha a edição: o `content` da mensagem do Stoat é reativo.
  const textOf = (m: Message) =>
    bubbleText(ttsBody(m.contentPlain) ?? m.contentPlain, {
      attachments: m.attachments?.length ?? 0,
      labels: props.labels,
    });
  const isTts = (m: Message) => ttsBody(m.contentPlain) !== null;

  return (
    <div class={card} data-space-history="">
      {/* column-reverse: a rolagem nasce no fim e fica nele quando chega fala nova. */}
      <div class={scroller}>
        <div class={list}>
          <Switch>
            <Match when={state() === "loading" && !rows().length}>
              <p class={note}>{t`Carregando o histórico…`}</p>
            </Match>
            <Match when={state() === "error" && !rows().length}>
              <p class={note}>{t`Não deu para carregar o histórico agora.`}</p>
            </Match>
            <Match when={!rows().length}>
              <p class={note}>{t`Ninguém escreveu aqui ainda. Diga oi!`}</p>
            </Match>
          </Switch>
          <For each={rows()}>
            {(r) => (
              <div
                class={row}
                data-mine={r.mine ? "" : undefined}
                data-first={r.first ? "" : undefined}
                onClick={() => props.onOpen(r.m.id)}
                title={t`Abrir no chat`}
              >
                {r.first && !r.mine ? (
                  <span class={who}>{r.m.username ?? ""}</span>
                ) : null}
                <span class={say}>
                  {isTts(r.m) ? (
                    <TtsFace speaking={props.speaking(r.m.id)} size={17} />
                  ) : null}
                  <span class={text}>{textOf(r.m) || "…"}</span>
                  <time class={time} dateTime={r.m.createdAt.toISOString()}>
                    {dayjs(r.m.createdAt).format("HH:mm")}
                  </time>
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// Cores fixas, como o campo: o mapa é escuro em qualquer tema.
const card = css({
  borderRadius: "14px",
  background: "rgba(24, 23, 31, 0.94)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  boxShadow: "0 6px 24px rgba(0, 0, 0, 0.45)",
  color: "#E9E8F0",
  overflow: "hidden",
  animation: "spaceBubbleIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

const scroller = css({
  display: "flex",
  flexDirection: "column-reverse",
  maxHeight: "min(208px, 34vh)",
  overflowY: "auto",
  overscrollBehavior: "contain",
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(255, 255, 255, 0.2) transparent",
  // O topo esmaece: há mais acima.
  maskImage: "linear-gradient(180deg, transparent 0, #000 14px)",
});

const list = css({
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: "10px 10px 8px",
});

/** Uma fala: a dos outros à esquerda; a sua, à direita e tingida. */
const row = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  maxWidth: "100%",
  cursor: "pointer",
  "&[data-first]": { marginTop: "6px" },
  "&[data-first]:first-child": { marginTop: 0 },
  "&[data-mine]": { alignItems: "flex-end" },
});

const who = css({
  marginLeft: "2px",
  marginBottom: "1px",
  fontSize: "12px",
  lineHeight: "16px",
  fontWeight: 700,
  color: "#C9D7FF",
});

const say = css({
  display: "inline-flex",
  alignItems: "flex-end",
  gap: "8px",
  maxWidth: "88%",
  padding: "4px 9px",
  borderRadius: "10px",
  background: "rgba(255, 255, 255, 0.06)",
  "[data-mine] &": { background: "rgba(122, 162, 255, 0.2)" },
  "*:hover > &": { background: "rgba(255, 255, 255, 0.1)" },
  "[data-mine]:hover > &": { background: "rgba(122, 162, 255, 0.28)" },
});

const text = css({
  minWidth: 0,
  fontSize: "13px",
  lineHeight: "18px",
  overflowWrap: "anywhere",
});

const time = css({
  flexShrink: 0,
  fontSize: "10.5px",
  lineHeight: "16px",
  color: "rgba(233, 232, 240, 0.5)",
  fontVariantNumeric: "tabular-nums",
});

const note = css({
  margin: 0,
  padding: "4px 2px",
  fontSize: "12.5px",
  color: "rgba(233, 232, 240, 0.6)",
});
