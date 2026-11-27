import { type Accessor, For, Show, createEffect, createSignal } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { BubbleLabels } from "@muchat/space-client";
import type { Channel } from "stoat.js";
import { css } from "styled-system/css";

import { useClient } from "@revolt/client";
import { useState } from "@revolt/state";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { ChatComposer } from "./ChatComposer";
import { ChatHistory } from "./ChatHistory";
import type { FeedLine, SpaceChat } from "./spaceChat";

/** Mostrar ou não o histórico sobre o campo: vale até a pessoa clicar de novo (neste aparelho). */
const HISTORY_KEY = "muchat.space.chatHistory";

function storedHistory(): boolean {
  try {
    return localStorage.getItem(HISTORY_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function storeHistory(shown: boolean) {
  try {
    localStorage.setItem(HISTORY_KEY, shown ? "shown" : "hidden");
  } catch {
    // Janela anônima ou armazenamento bloqueado: a escolha vale só até recarregar.
  }
}

interface Props {
  chat: SpaceChat;
  channel: Channel;
  place: string;
  labels: BubbleLabels;
  focusRequest: Accessor<number>;
  onLeave: () => void;
  onFocusChange?: (focused: boolean) => void;
  /** Abre o painel do chat (numa mensagem, quando há). */
  onOpenPanel: (channelId: string, messageId?: string) => void;
  touch: boolean;
}

/**
 * O campo de conversa sobre o mapa, no pé e no meio (onde o olho volta depois de ler um balão),
 * com o histórico do canal logo acima (27/11/2026). O botão do campo oculta o histórico; aí
 * voltam as linhas discretas de quem falou sem aparecer no mapa. Some quando o painel do chat
 * está aberto (um campo só na tela) e quando a corrida do jogo cobre o pé do mapa.
 */
export function ChatDock(props: Props) {
  const { t } = useLingui();
  const state = useState();
  const client = useClient();
  const [history, setHistory] = createSignal(storedHistory());
  function toggleHistory() {
    const next = !history();
    setHistory(next);
    storeHistory(next);
  }

  // Um envio seu que falhou vira linha com "Tentar de novo" (no painel, a lista já mostra).
  const reported = new Set<string>();
  createEffect(() => {
    for (const m of state.draft.getPendingMessages(props.channel.id)) {
      if (m.status !== "failed" || reported.has(m.idempotencyKey)) continue;
      reported.add(m.idempotencyKey);
      props.chat.reportFailed(
        t`Não foi enviada`,
        props.channel.id,
        m.idempotencyKey,
        m.content ?? "",
      );
    }
  });

  function retry(line: FeedLine) {
    const f = line.failed;
    const ch = f && client().channels.get(f.channelId);
    props.chat.dismissFeed(line.key);
    if (ch && f) state.draft.retrySend(client(), ch, f.idempotencyKey);
  }

  return (
    <div class={dock}>
      <Show when={history()}>
        <ChatHistory
          channel={props.channel}
          labels={props.labels}
          onOpen={(id) => props.onOpenPanel(props.channel.id, id)}
        />
      </Show>
      <div class={feed}>
        {/* Com o histórico à vista, ele já mostra quem falou fora do mapa: só a falha de envio fica. */}
        <For each={props.chat.feed().filter((l) => !history() || l.failed)}>
          {(line) => (
            <Show
              when={line.failed}
              fallback={
                <button
                  type="button"
                  class={row}
                  onClick={() => props.onOpenPanel(props.channel.id, line.key)}
                  title={t`Abrir no chat`}
                >
                  <strong>{line.name}</strong>
                  <span>{line.text}</span>
                </button>
              }
            >
              <div class={row} data-failed="">
                <Symbol size={16}>error</Symbol>
                <strong>{line.name}</strong>
                <span>{line.text}</span>
                <button type="button" class={act} onClick={() => retry(line)}>
                  {t`Tentar de novo`}
                </button>
                <button
                  type="button"
                  class={act}
                  aria-label={t`Descartar`}
                  onClick={() => {
                    const f = line.failed!;
                    const ch = client().channels.get(f.channelId);
                    if (ch) state.draft.cancelSend(ch, f.idempotencyKey);
                    props.chat.dismissFeed(line.key);
                  }}
                >
                  <Symbol size={16}>close</Symbol>
                </button>
              </div>
            </Show>
          )}
        </For>
      </div>
      <ChatComposer
        channel={props.channel}
        variant="map"
        place={props.place}
        focusRequest={props.focusRequest}
        onLeave={props.onLeave}
        onFocusChange={props.onFocusChange}
        touch={props.touch}
        carry
        actions={
          <button
            type="button"
            class={toggle}
            data-history-toggle=""
            aria-pressed={history()}
            aria-label={history() ? t`Ocultar histórico` : t`Mostrar histórico`}
            title={history() ? t`Ocultar histórico` : t`Mostrar histórico`}
            onClick={toggleHistory}
          >
            <Symbol size={18}>{history() ? "expand_more" : "history"}</Symbol>
          </button>
        }
      />
    </div>
  );
}

/** O botão do histórico, nas cores fixas do campo (o mapa é escuro em qualquer tema). */
const toggle = css({
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  width: "32px",
  height: "32px",
  padding: 0,
  border: "none",
  borderRadius: "8px",
  background: "transparent",
  color: "rgba(242, 241, 247, 0.72)",
  cursor: "pointer",
  "&:hover": { background: "rgba(255, 255, 255, 0.1)", color: "#F2F1F7" },
  "&:focus-visible": { outline: "2px solid #7AA2FF", outlineOffset: "1px" },
  "&[aria-pressed=true]": { color: "#C9D7FF" },
  "@media (pointer: coarse)": { width: "40px", height: "40px" },
});

const dock = css({
  position: "absolute",
  left: "50%",
  bottom: "14px",
  transform: "translateX(-50%)",
  width: "min(560px, calc(100% - 32px))",
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  pointerEvents: "none",
  "& > *": { pointerEvents: "auto" },
});

const feed = css({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "4px",
  pointerEvents: "none !important",
  "&:empty": { display: "none" },
});

/** Uma fala de quem não está à vista: nome e texto numa linha, discreta. */
const row = css({
  display: "flex",
  alignItems: "center",
  gap: "6px",
  maxWidth: "100%",
  padding: "4px 10px",
  border: "none",
  borderRadius: "10px",
  background: "rgba(24, 23, 31, 0.88)",
  color: "#E9E8F0",
  font: "inherit",
  fontSize: "13px",
  lineHeight: "18px",
  textAlign: "start",
  cursor: "pointer",
  pointerEvents: "auto",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
  outline: "1px solid rgba(255, 255, 255, 0.1)",
  animation: "spaceBubbleIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
  "& > strong": { flexShrink: 0, fontWeight: 700, color: "#C9D7FF" },
  "& > span": {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  "&[data-failed]": {
    cursor: "default",
    background: "rgba(80, 22, 28, 0.94)",
    "& > strong": { color: "#FFB4AB" },
  },
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

const act = css({
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 6px",
  border: "none",
  borderRadius: "6px",
  background: "rgba(255, 255, 255, 0.1)",
  color: "#fff",
  font: "inherit",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  "&:hover": { background: "rgba(255, 255, 255, 0.18)" },
});
