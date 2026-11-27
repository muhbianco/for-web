import {
  type Accessor,
  type JSX,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { Channel } from "stoat.js";
import { css } from "styled-system/css";

import { useClient } from "@revolt/client";
import { createIsTimedOut } from "@revolt/common/lib/createIsTimedOut";
import { useInstance } from "@revolt/instance";
import { useState } from "@revolt/state";
import { IconButton } from "@revolt/ui";
import { TextEditor2 } from "@revolt/ui/components/features/texteditor/TextEditor2";
import { Symbol } from "@revolt/ui/components/utils/Symbol";
import { useSearchSpace } from "@revolt/ui/components/utils/autoComplete";

/** Intervalo do "digitando" mandado ao Stoat (o mesmo do compositor do canal). */
const TYPING_EVERY_MS = 2_500;
const TYPING_IDLE_MS = 1_000;

interface Props {
  channel: Channel;
  /** `map`: o campo sobre o mapa; `panel`: o pé do painel do chat. */
  variant: "map" | "panel";
  /** Para onde a mensagem vai, em palavras ("Sala Dev", "#geral"). */
  place: string;
  /** Sobe para pedir foco (Enter no mapa). */
  focusRequest: Accessor<number>;
  /** Volta ao mapa: Esc, ou Enter com o campo vazio. */
  onLeave: () => void;
  /** O foco entrou ou saiu do campo. */
  onFocusChange?: (focused: boolean) => void;
  /** Toque (celular, tablet): Enter quebra linha e há botão de enviar. */
  touch: boolean;
  /** O texto não enviado acompanha a troca de destino (o campo do mapa segue onde você está). */
  carry?: boolean;
  /** Mandou (o painel desce até o fim da conversa). */
  onSent?: () => void;
  /** Botões a mais no fim do campo (o do histórico, no mapa). */
  actions?: JSX.Element;
}

/**
 * O campo de conversa do Espaço. Usa o editor do app (menções com @, emoji com :) e o rascunho do
 * canal (o mesmo do chat do canal: o que você começou aqui continua lá). Não usa o compositor do
 * canal: ele foca a caixa com qualquer tecla, e no mapa as letras andam (WASD).
 *
 * Mapa × campo: Enter abre o campo; Enter envia e o campo continua aberto (a conversa segue);
 * Esc, Enter vazio ou um clique no mapa voltam ao mapa. Digitar com o campo aberto nunca anda,
 * nem liga o microfone (M) — o atalho do mapa ignora quem digita.
 */
export function ChatComposer(props: Props) {
  const { t } = useLingui();
  const state = useState();
  const client = useClient();
  const { limits } = useInstance();
  const [focused, setFocused] = createSignal(false);
  const [nodeReplacement, setNodeReplacement] =
    createSignal<readonly [string | "_focus"]>();

  const content = () => state.draft.getDraft(props.channel.id).content ?? "";
  const [initialValue, setInitialValue] = createSignal<readonly [string]>([
    untrack(content),
  ]);
  // Enviou (o rascunho esvaziou): o editor esvazia também.
  createEffect(
    on(
      content,
      (v) => {
        if (v === "") setInitialValue([""]);
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      props.focusRequest,
      (n) => {
        if (n) setNodeReplacement(["_focus"]);
      },
      { defer: true },
    ),
  );

  const timedOut = createIsTimedOut(
    () => props.channel.server?.member?.timeout,
  );
  const allowed = () =>
    props.channel.havePermission("SendMessage") && !timedOut();
  const tooLong = () => content().length > limits().message_length;

  let typingUntil = 0;
  let typingIn: Channel | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  function typing() {
    const now = Date.now();
    if (now >= typingUntil || typingIn !== props.channel) {
      if (typingIn && typingIn !== props.channel) typingIn.stopTyping();
      typingUntil = now + TYPING_EVERY_MS;
      typingIn = props.channel;
      props.channel.startTyping();
    }
    if (idle) clearTimeout(idle);
    idle = setTimeout(stopTyping, TYPING_IDLE_MS);
  }
  function stopTyping() {
    if (idle) clearTimeout(idle);
    idle = undefined;
    if (!typingIn) return;
    typingUntil = 0;
    typingIn.stopTyping();
    typingIn = null;
  }
  onCleanup(stopTyping);

  // O destino mudou (você entrou numa sala, ou o painel trocou de canal). No campo do mapa, o que
  // estava escrito vai junto: a intenção era falar onde você está.
  createEffect(
    on(
      () => props.channel.id,
      (id, prev) => {
        stopTyping();
        if (prev && props.carry) {
          const old = state.draft.getDraft(prev).content ?? "";
          if (old && !state.draft.getDraft(id).content) {
            state.draft.setDraft(id, { content: old });
            state.draft.setDraft(prev, { content: "" });
          }
        }
        setInitialValue([content()]);
      },
      { defer: true },
    ),
  );

  function send() {
    const text = content().trim();
    if (!text) {
      // Enter com o campo vazio: de volta ao mapa.
      props.onLeave();
      return;
    }
    if (tooLong() || props.channel.userSlowmode()) return;
    stopTyping();
    void state.draft.sendDraft(client(), props.channel);
    props.onSent?.();
  }

  const searchSpace = useSearchSpace(() => props.channel, client);

  return (
    <div
      class={bar}
      data-variant={props.variant}
      data-focused={focused() ? "" : undefined}
      data-empty={content() ? undefined : ""}
      onKeyDown={(e) => {
        // Esc fecha primeiro o que o editor abriu (a lista de menções); depois volta ao mapa.
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          props.onLeave();
        }
      }}
      onFocusIn={() => {
        setFocused(true);
        props.onFocusChange?.(true);
      }}
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setFocused(false);
        stopTyping();
        props.onFocusChange?.(false);
      }}
    >
      <Show
        when={allowed()}
        fallback={
          <span class={blocked}>
            <Symbol size={18}>block</Symbol>
            {timedOut()
              ? t`Você está de castigo e não pode escrever agora.`
              : t`Você não pode escrever em ${props.place}.`}
          </span>
        }
      >
        {/* No painel, o cabeçalho já diz o canal; no mapa, o destino fica à vista no campo. */}
        <Show when={props.variant === "map"}>
          <span
            class={where}
            title={t`As mensagens vão para o chat de ${props.place}`}
          >
            <Symbol size={16}>forum</Symbol>
            <span class={whereName}>{props.place}</span>
          </span>
        </Show>
        <div class={editor}>
          <TextEditor2
            placeholder={
              props.variant === "map"
                ? t`Diga algo…`
                : t`Mensagem em ${props.place}`
            }
            initialValue={initialValue()}
            nodeReplacement={nodeReplacement()}
            onChange={(v) => {
              state.draft.setDraft(props.channel.id, { content: v });
              if (v) typing();
            }}
            onComplete={send}
            autoCompleteSearchSpace={searchSpace}
          />
        </div>
        <Show when={tooLong()}>
          <span class={warn}>{limits().message_length - content().length}</span>
        </Show>
        <Show
          when={props.touch || content()}
          fallback={
            <Show when={props.variant === "map"}>
              <kbd class={kbd} aria-hidden="true">
                {focused() ? t`Esc · mapa` : t`Enter`}
              </kbd>
            </Show>
          }
        >
          <IconButton
            size="sm"
            variant={content() ? "filled" : "tonal"}
            isDisabled={!content() || tooLong()}
            aria-label={t`Enviar`}
            onPress={send}
          >
            <Symbol fill>send</Symbol>
          </IconButton>
        </Show>
      </Show>
      {/* Fora do Show: o botão do histórico vale até para quem não pode escrever. */}
      {props.actions}
    </div>
  );
}

const bar = css({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minHeight: "44px",
  padding: "4px 6px 4px 12px",
  borderRadius: "14px",
  background: "var(--md-sys-color-surface-container-high)",
  color: "var(--md-sys-color-on-surface)",
  border: "1px solid var(--md-sys-color-outline-variant)",
  transition:
    "border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease",
  "&[data-focused]": {
    borderColor: "var(--md-sys-color-primary)",
    boxShadow: "0 0 0 1px var(--md-sys-color-primary)",
  },
  // Sobre o mapa: sólido (sem desfoque, que custaria GPU a cada quadro do mapa) e discreto
  // enquanto ninguém usa.
  "&[data-variant=map]": {
    background: "rgba(24, 23, 31, 0.94)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    color: "#F2F1F7",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.45)",
  },
  "&[data-variant=map]:not([data-focused])[data-empty]": { opacity: 0.86 },
  "&[data-variant=map][data-focused]": {
    borderColor: "#7AA2FF",
    boxShadow: "0 0 0 1px #7AA2FF, 0 6px 24px rgba(0, 0, 0, 0.45)",
  },
  "@media (pointer: coarse)": { minHeight: "48px" },
});

/** Para onde vai: a sala (ou o canal do saguão). */
const where = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  flexShrink: 1,
  minWidth: 0,
  maxWidth: "38%",
  padding: "2px 8px 2px 6px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  background: "var(--md-sys-color-secondary-container)",
  color: "var(--md-sys-color-on-secondary-container)",
  "[data-variant=map] &": {
    background: "rgba(122, 162, 255, 0.16)",
    color: "#C9D7FF",
  },
});

const whereName = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const editor = css({
  flex: 1,
  minWidth: 0,
  maxHeight: "96px",
  display: "flex",
  overflow: "hidden",
  "[data-variant=map] &": {
    "& .cm-editor, & .md-text": { color: "#F2F1F7" },
    "& .cm-placeholder": { color: "rgba(242, 241, 247, 0.55)" },
    "& .cm-cursor": { borderLeftColor: "#F2F1F7" },
  },
});

const kbd = css({
  flexShrink: 0,
  padding: "2px 7px",
  marginRight: "4px",
  borderRadius: "6px",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  fontFamily: "inherit",
  fontSize: "11px",
  fontWeight: 600,
  color: "rgba(242, 241, 247, 0.7)",
  whiteSpace: "nowrap",
  "@media (pointer: coarse)": { display: "none" },
});

const warn = css({
  flexShrink: 0,
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--md-sys-color-error)",
});

const blocked = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "13px",
  opacity: 0.8,
  paddingBlock: "8px",
});
