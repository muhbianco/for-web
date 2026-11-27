import {
  type Accessor,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { Channel } from "stoat.js";
import { css } from "styled-system/css";

import { DraftMessages, Messages } from "@revolt/app";
import { useClient } from "@revolt/client";
import { IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { ChatComposer } from "./ChatComposer";

interface Props {
  channel: Channel;
  /** O painel mostra o canal de onde você está (segue você pelo mapa). */
  following: boolean;
  /** Nome do canal, em palavras ("Sala Dev", "#geral"). */
  place: string;
  /** Onde você está, para "Voltar para …" quando o painel mostra outra sala. */
  herePlace: string | null;
  onFollow: () => void;
  onClose: () => void;
  focusRequest: Accessor<number>;
  /** O campo pediu para voltar ao mapa. */
  onLeave: () => void;
  onComposerFocus?: (focused: boolean) => void;
  /** Mensagem em destaque (o balão clicado no mapa). */
  highlight: Accessor<string | undefined>;
  clearHighlight: () => void;
  serverId: string;
  touch: boolean;
  /** Celular: o painel é uma folha que sobe do pé do mapa. */
  sheet?: boolean;
}

/**
 * O canal de texto dentro do Espaço (27/11/2026): a mesma lista de mensagens do chat do canal
 * (anexos, respostas, reações, edição), sem sair do mapa. Segue a sala em que você está; da lista
 * de salas dá para abrir o chat de outra sem andar até lá.
 */
export function ChatPanel(props: Props) {
  const { t } = useLingui();
  const client = useClient();
  const [atEnd, setAtEnd] = createSignal(true);
  const [lastId, setLastId] = createSignal<string>();
  let jumpToBottom: ((nearby?: string) => void) | undefined;

  // A linha "novas mensagens" fica onde a pessoa parou de ler este canal.
  createEffect(
    on(
      () => props.channel.id,
      (id) =>
        setLastId(
          props.channel.unread
            ? (client().channelUnreads.get(id)?.lastMessageId as string)
            : undefined,
        ),
    ),
  );

  // Lido de verdade: o painel aberto, no fim da conversa, com a janela em foco.
  createEffect(() => {
    if (props.channel.unread && atEnd() && document.hasFocus())
      props.channel.ack();
  });
  const onFocus = () => {
    if (props.channel.unread && atEnd()) props.channel.ack();
  };
  window.addEventListener("focus", onFocus);
  onCleanup(() => window.removeEventListener("focus", onFocus));

  return (
    <aside
      class={panel}
      aria-label={t`Chat de ${props.place}`}
      // A folha do celular precisa de altura definida: a lista rola dentro dela.
      style={props.sheet ? { height: "72%" } : undefined}
    >
      <header class={head}>
        <span class={title}>
          <Symbol size={18}>forum</Symbol>
          <strong>{props.place}</strong>
        </span>
        <span class={sub}>
          {props.following ? t`onde você está` : t`outra sala`}
        </span>
        <span style={{ flex: 1 }} />
        <a
          class={iconLink}
          href={`/server/${props.serverId}/channel/${props.channel.id}`}
          aria-label={t`Abrir o canal ${props.place} na tela cheia`}
          title={t`Abrir no canal (sai do mapa)`}
        >
          <Symbol size={18}>open_in_new</Symbol>
        </a>
        <IconButton
          size="sm"
          aria-label={t`Fechar o chat`}
          onPress={props.onClose}
        >
          <Symbol>close</Symbol>
        </IconButton>
      </header>
      <Show when={!props.following && props.herePlace}>
        <div class={peek}>
          <span>
            {t`Você está lendo outra sala. O que você escrever aqui vai para ela, sem balão no mapa.`}
          </span>
          <button type="button" class={back} onClick={props.onFollow}>
            {t`Voltar para ${props.herePlace!}`}
          </button>
        </div>
      </Show>
      <div class={list}>
        <Show when={props.channel} keyed>
          {(channel) => (
            <Messages
              channel={channel}
              lastReadId={lastId}
              pendingMessages={(p) => (
                <DraftMessages
                  channel={channel}
                  tail={p.tail}
                  sentIds={p.ids}
                />
              )}
              highlightedMessageId={props.highlight}
              clearHighlightedMessage={props.clearHighlight}
              jumpToBottomRef={(ref) => (jumpToBottom = ref)}
              atEnd={[atEnd, setAtEnd]}
            />
          )}
        </Show>
      </div>
      <div class={foot}>
        <ChatComposer
          channel={props.channel}
          variant="panel"
          place={props.place}
          focusRequest={props.focusRequest}
          onLeave={props.onLeave}
          onFocusChange={props.onComposerFocus}
          onSent={() => jumpToBottom?.()}
          touch={props.touch}
        />
      </div>
    </aside>
  );
}

const panel = css({
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
  background: "var(--md-sys-color-surface-container-low)",
  color: "var(--md-sys-color-on-surface)",
  borderLeft: "1px solid var(--md-sys-color-outline-variant)",
  // As mensagens usam o tamanho do chat do app, um pouco menor na coluna estreita.
  "--message-size": "14px",
});

const head = css({
  display: "flex",
  alignItems: "center",
  gap: "6px",
  minHeight: "48px",
  padding: "4px 6px 4px 12px",
  borderBottom: "1px solid var(--md-sys-color-outline-variant)",
});

const title = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  minWidth: 0,
  "& > strong": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "14px",
  },
});

const sub = css({
  flexShrink: 0,
  fontSize: "12px",
  color: "var(--md-sys-color-on-surface-variant)",
});

const iconLink = css({
  display: "grid",
  placeItems: "center",
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  color: "var(--md-sys-color-on-surface-variant)",
  "&:hover": { background: "var(--md-sys-color-surface-container-high)" },
  "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  "@media (pointer: coarse)": { width: "44px", height: "44px" },
});

const peek = css({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  margin: "8px 10px 0",
  padding: "8px 10px",
  borderRadius: "10px",
  fontSize: "12px",
  lineHeight: "16px",
  background: "var(--md-sys-color-tertiary-container)",
  color: "var(--md-sys-color-on-tertiary-container)",
});

const back = css({
  alignSelf: "flex-start",
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  fontWeight: 700,
  color: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
  "@media (pointer: coarse)": { minHeight: "40px" },
});

const list = css({
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});

const foot = css({
  padding: "6px 8px 8px",
  paddingBottom: "max(8px, env(safe-area-inset-bottom))",
});
