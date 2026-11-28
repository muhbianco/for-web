import {
  type JSX,
  For,
  Show,
  createSignal,
  onCleanup,
  splitProps,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { GameWireEvent } from "@muchat/space-client";
import type { ItemInstance } from "@muchat/space-core/game/ot/balance";
import { itemVisual } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { errorText } from "./gameText";
import { BAR, RARITY, gameFrame } from "./gameTheme";
import type { BagMark } from "./heroModel";
import { useModalKeys } from "./modalKeys";
import { ICON, iconPixels } from "./pixelArt";
import { useWide, useWindowDrag } from "./windowDrag";

/**
 * As peças comuns das telas do Idle Hunt v5: o diálogo (folha de baixo no celular), botões com alvo
 * de toque grande, confirmação em dois toques para o que não volta, abas com selo do que está
 * pendente, barras com o número escrito, a comparação ▲▼ (nunca só a cor) e o ícone do item.
 */

// As animações curtas do jogo (entrada do cartão, brilho do refino, números que sobem, o tremor de
// uma falha). Uma vez por página; o CSS de cada uma só liga com "prefers-reduced-motion: no-preference".
if (
  typeof document !== "undefined" &&
  !document.getElementById("idle-hunt-kf")
) {
  const s = document.createElement("style");
  s.id = "idle-hunt-kf";
  s.textContent = [
    "@keyframes gameIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    "@keyframes gameSparkle{0%,100%{opacity:.15}50%{opacity:1}}",
    "@keyframes gamePop{0%{transform:scale(.7);opacity:0}40%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}",
    "@keyframes gameShake{0%,100%{transform:none}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}",
    "@keyframes gameFloat{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-22px);opacity:0}}",
    "@keyframes gameTipIn{from{opacity:0}to{opacity:1}}",
    "@keyframes gamePulse{0%,100%{box-shadow:0 0 0 0 rgba(255,120,90,.0)}50%{box-shadow:0 0 0 4px rgba(255,120,90,.45)}}",
    // D68: a moldura da Arma Suprema respira como brasa e solta fagulhas para cima.
    "@keyframes gameEmber{0%,100%{box-shadow:0 0 5px 1px rgba(200,16,16,.75),0 0 12px 2px rgba(255,90,20,.35),inset 0 0 6px rgba(150,0,0,.8)}50%{box-shadow:0 0 9px 2px rgba(255,40,20,.95),0 0 18px 4px rgba(255,140,30,.55),inset 0 0 9px rgba(210,20,0,.9)}}",
    "@keyframes gameEmberRise{0%{transform:translateY(3px);opacity:0}30%{opacity:1}100%{transform:translateY(-7px);opacity:0}}",
  ].join("");
  document.head.append(s);
}

// ------------------------------------------------------------ comandos

/** O que as telas usam do SpaceView (o laboratório entrega um servidor local com a mesma cara). */
export interface GameLink {
  gameSend(t: string, d?: Record<string, unknown>): string;
  onGame(listener: (e: GameWireEvent) => void): () => void;
}

export type CommandResult =
  | { ok: true; e: GameWireEvent }
  | { ok: false; code: string; reason?: string };

/**
 * Um comando com a resposta (o `re` do servidor): ocupado enquanto espera, o erro numa frase que
 * diz o que fazer. `runAll` manda em sequência e para no primeiro erro (os pontos marcados).
 */
export function useCommands(link: () => GameLink) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const waiting = new Map<string, (r: CommandResult) => void>();
  let hide: ReturnType<typeof setTimeout> | undefined;
  const off = link().onGame((e) => {
    const done = e.re ? waiting.get(e.re) : undefined;
    if (!done || !e.re) return;
    waiting.delete(e.re);
    if (e.t === "error") {
      const d = e.d as { code?: string; reason?: string };
      done({
        ok: false,
        code: d.code ?? "internal",
        ...(d.reason ? { reason: d.reason } : {}),
      });
    } else done({ ok: true, e });
  });
  onCleanup(() => {
    off();
    clearTimeout(hide);
    for (const w of waiting.values()) w({ ok: false, code: "closed" });
    waiting.clear();
  });
  const request = (t: string, d: Record<string, unknown>) =>
    new Promise<CommandResult>((resolve) => {
      const id = link().gameSend(t, d);
      waiting.set(id, resolve);
      // Sem resposta (a conexão caiu): o botão volta.
      setTimeout(() => {
        if (waiting.delete(id)) resolve({ ok: false, code: "timeout" });
      }, 10_000);
    });
  const fail = (r: CommandResult) => {
    if (r.ok) return;
    setError(errorText(r.code, r.reason));
    clearTimeout(hide);
    hide = setTimeout(() => setError(null), 8_000);
  };
  async function run(t: string, d: Record<string, unknown> = {}) {
    if (busy()) return null;
    setBusy(true);
    setError(null);
    const r = await request(t, d);
    setBusy(false);
    fail(r);
    return r;
  }
  async function runAll(list: [string, Record<string, unknown>][]) {
    if (busy()) return null;
    setBusy(true);
    setError(null);
    let last: CommandResult | null = null;
    for (const [t, d] of list) {
      last = await request(t, d);
      if (!last.ok) break;
    }
    setBusy(false);
    if (last) fail(last);
    return last;
  }
  return { run, runAll, busy, error, setError };
}

// ------------------------------------------------------------ diálogo

export function GameDialog(props: {
  id: string;
  title: JSX.Element;
  subtitle?: JSX.Element;
  onClose: () => void;
  children: JSX.Element;
  wide?: boolean;
  /** Algo fixo embaixo (a barra de confirmar), fora da rolagem. */
  footer?: JSX.Element;
}) {
  const { t } = useLingui();
  let backdrop: HTMLDivElement | undefined;
  let card: HTMLDivElement | undefined;
  let title: HTMLHeadingElement | undefined;
  useModalKeys(
    () => card,
    () => title,
    () => props.onClose(),
  );
  // Arrastável pela barra do título (pedido do dono, 25/11/2026); no celular a janela é folha.
  const wide = useWide(() => backdrop, 600);
  const drag = useWindowDrag({
    id: props.id,
    win: () => card,
    bounds: () => backdrop,
    enabled: wide,
  });
  return (
    <Backdrop
      ref={backdrop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <Card
        style={{ ...gameFrame, ...drag.style() }}
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${props.id}-title`}
        data-wide={props.wide ? "" : undefined}
        data-dragging={drag.dragging() ? "" : undefined}
      >
        <Head {...drag.handle} data-draggable={wide() ? "" : undefined}>
          <Show when={wide()}>
            <Grip onKey={drag.onGripKey} />
          </Show>
          <div>
            <h2 id={`${props.id}-title`} tabIndex={-1} ref={title}>
              {props.title}
            </h2>
            <Show when={props.subtitle}>
              <Sub>{props.subtitle}</Sub>
            </Show>
          </div>
          <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
            ×
          </Close>
        </Head>
        <Body>{props.children}</Body>
        <Show when={props.footer}>
          <Foot>{props.footer}</Foot>
        </Show>
      </Card>
    </Backdrop>
  );
}

/**
 * A alça visível de uma janela arrastável: o ícone de arrastar na barra do título. Com o teclado,
 * as setas movem (Shift: passo maior) e Home devolve ao lugar.
 */
export function Grip(props: { onKey: (e: KeyboardEvent) => void }) {
  const { t } = useLingui();
  return (
    <GripBtn
      type="button"
      data-grip=""
      aria-label={t`Mover a janela (setas do teclado; Home volta ao lugar)`}
      title={t`Arraste para mover · duplo clique na barra volta ao lugar`}
      onKeyDown={props.onKey}
    >
      <Symbol size={20}>drag_indicator</Symbol>
    </GripBtn>
  );
}

export const GripBtn = styled("button", {
  base: {
    width: "32px",
    height: "44px",
    marginLeft: "-10px",
    display: "grid",
    placeItems: "center",
    border: "none",
    borderRadius: "8px",
    background: "transparent",
    color: "var(--md-sys-color-on-surface-variant)",
    cursor: "grab",
    touchAction: "none",
    "&:hover": {
      color: "var(--md-sys-color-primary)",
      background: "rgba(255,255,255,0.05)",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
    "[data-dragging] &": { cursor: "grabbing" },
  },
});

const Backdrop = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    containerType: "inline-size",
    display: "grid",
    placeItems: "center",
    background: "rgba(0, 0, 0, 0.55)",
    zIndex: 6,
    padding: "16px",
    "@container (max-width: 600px)": {
      placeItems: "end stretch",
      padding: "0",
    },
  },
});

const Card = styled("div", {
  base: {
    containerType: "inline-size",
    width: "100%",
    maxWidth: "720px",
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: "16px",
    overflow: "hidden",
    "&[data-wide]": { maxWidth: "980px" },
    "& h2": { margin: 0, fontSize: "1.15rem", outline: "none" },
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gameIn 160ms ease-out",
    },
    "@container (max-width: 600px)": {
      maxWidth: "none",
      maxHeight: "92%",
      borderRadius: "16px 16px 0 0",
    },
  },
});

const Head = styled("div", {
  base: {
    "&[data-draggable]": {
      gridTemplateColumns: "auto 1fr auto",
      cursor: "grab",
      userSelect: "none",
      touchAction: "none",
    },
    "[data-dragging] > &": { cursor: "grabbing" },
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "start",
    gap: "8px",
    padding: "16px 16px 8px 20px",
    "& > div": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});

const Sub = styled("div", {
  base: { fontSize: "0.85em", color: "var(--md-sys-color-on-surface-variant)" },
});

const Body = styled("div", {
  base: {
    overflow: "auto",
    padding: "4px 20px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    // Filho com rolagem própria (a barra de abas) encolheria a 1 px numa coluna com altura limitada.
    "& > *": { flexShrink: 0 },
    "@container (max-width: 600px)": { padding: "4px 14px 16px" },
  },
});

const Foot = styled("div", {
  base: {
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
    padding: "10px 16px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    background: "rgba(0,0,0,0.25)",
  },
});

const Close = styled("button", {
  base: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "1.6rem",
    lineHeight: 1,
    cursor: "pointer",
    "&:hover": { background: "rgba(255,255,255,0.06)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

// ------------------------------------------------------------ botões

/** Botão do jogo: 44 px de altura no toque, foco visível, três tons. */
export const Btn = styled("button", {
  base: {
    minHeight: "36px",
    padding: "6px 14px",
    borderRadius: "10px",
    border: "1px solid var(--md-sys-color-outline)",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface)",
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    textAlign: "center",
    touchAction: "manipulation",
    "@media (pointer: coarse)": { minHeight: "44px", minWidth: "44px" },
    "&:hover:not(:disabled)": { filter: "brightness(1.15)" },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
    "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    "&[data-tone=primary]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
      borderColor: "transparent",
    },
    "&[data-tone=danger]": {
      background: "#5a1f19",
      borderColor: "#ff8a7a",
      color: "#ffe2dc",
    },
    "&[data-tone=quiet]": {
      background: "transparent",
      borderColor: "transparent",
    },
    "&[data-size=sm]": { minHeight: "30px", padding: "2px 10px" },
    "&[aria-pressed=true]": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
      background: "var(--md-sys-color-primary-container)",
    },
  },
});

/**
 * Para o que não volta atrás (vender, desmontar, descartar, reforjar, redistribuir): o 1º toque
 * arma e mostra o que vai acontecer, o 2º faz. Desarma sozinho em 5 s. `steps={2}` pede duas
 * confirmações (o item +7 na transferência).
 */
export function Confirm(props: {
  label: JSX.Element;
  confirm: JSX.Element;
  confirm2?: JSX.Element;
  steps?: 1 | 2;
  disabled?: boolean;
  tone?: "primary" | "danger";
  size?: "sm";
  onConfirm: () => void;
}) {
  const [armed, setArmed] = createSignal(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const steps = () => props.steps ?? 1;
  const press = () => {
    clearTimeout(timer);
    if (armed() >= steps()) {
      setArmed(0);
      props.onConfirm();
      return;
    }
    setArmed(armed() + 1);
    timer = setTimeout(() => setArmed(0), 5_000);
  };
  return (
    <Btn
      type="button"
      data-tone={armed() > 0 ? "danger" : props.tone}
      data-size={props.size}
      disabled={props.disabled}
      aria-live="polite"
      onClick={press}
      onBlur={() => setArmed(0)}
    >
      {armed() === 0
        ? props.label
        : armed() === 1
          ? props.confirm
          : (props.confirm2 ?? props.confirm)}
    </Btn>
  );
}

// ------------------------------------------------------------ abas

export function Tabs<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: JSX.Element; badge?: number | string | null }[];
}) {
  let list: HTMLDivElement | undefined;
  const move = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = props.items.findIndex((x) => x.id === props.value);
    const n = props.items.length;
    const next = props.items[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!;
    props.onChange(next.id);
    queueMicrotask(() =>
      (list?.querySelector(`[data-tab="${next.id}"]`) as HTMLElement)?.focus(),
    );
    e.preventDefault();
  };
  return (
    <TabRow role="tablist" aria-label={props.label} ref={list} onKeyDown={move}>
      <For each={props.items}>
        {(it) => (
          <Tab
            type="button"
            role="tab"
            data-tab={it.id}
            aria-selected={props.value === it.id}
            tabIndex={props.value === it.id ? 0 : -1}
            onClick={() => props.onChange(it.id)}
          >
            {it.label}
            <Show when={it.badge}>
              {(b) => <Badge aria-label={String(b())}>{b()}</Badge>}
            </Show>
          </Tab>
        )}
      </For>
    </TabRow>
  );
}

const TabRow = styled("div", {
  base: {
    display: "flex",
    gap: "4px",
    overflowX: "auto",
    borderBottom: "1px solid var(--md-sys-color-outline-variant)",
    scrollbarWidth: "none",
  },
});

const Tab = styled("button", {
  base: {
    flex: "0 0 auto",
    minHeight: "44px",
    padding: "6px 14px",
    border: "none",
    borderBottom: "3px solid transparent",
    background: "transparent",
    color: "var(--md-sys-color-on-surface-variant)",
    font: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    "&[aria-selected=true]": {
      color: "var(--md-sys-color-on-surface)",
      borderBottomColor: "var(--md-sys-color-primary)",
    },
    // Três abas com selo cabem num celular de 360 px.
    "@container (max-width: 480px)": { padding: "6px 8px", fontSize: "0.9rem" },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});

/** O selo do que está pendente (pontos para gastar, item melhor na mochila). */
export const Badge = styled("span", {
  base: {
    minWidth: "20px",
    height: "20px",
    padding: "0 6px",
    borderRadius: "999px",
    background: "var(--md-sys-color-primary)",
    color: "var(--md-sys-color-on-primary)",
    fontSize: "0.75rem",
    fontWeight: 800,
    display: "inline-grid",
    placeItems: "center",
    fontVariantNumeric: "tabular-nums",
  },
});

// ------------------------------------------------------------ barras e números

export function Bar(props: {
  label: string;
  frac: number;
  color: keyof typeof BAR | string;
  text?: JSX.Element;
  /** A parte que vai entrar (prévia), por cima da barra. */
  preview?: number;
  thin?: boolean;
}) {
  const color = () =>
    (BAR as Record<string, string>)[props.color] ?? props.color;
  const f = () => Math.max(0, Math.min(1, props.frac || 0));
  return (
    <BarWrap data-thin={props.thin ? "" : undefined}>
      <Show when={!props.thin}>
        <BarLabel>
          <span>{props.label}</span>
          <span>{props.text}</span>
        </BarLabel>
      </Show>
      <Track
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(f() * 100)}
        aria-valuetext={typeof props.text === "string" ? props.text : undefined}
      >
        <Fill style={{ width: `${f() * 100}%`, background: color() }} />
        <Show when={props.preview !== undefined && props.preview > f()}>
          <Ghost
            style={{
              left: `${f() * 100}%`,
              width: `${(Math.min(1, props.preview!) - f()) * 100}%`,
              background: color(),
            }}
          />
        </Show>
      </Track>
    </BarWrap>
  );
}

const BarWrap = styled("div", {
  base: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 },
});
const BarLabel = styled("div", {
  base: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "0.8rem",
    color: "var(--md-sys-color-on-surface-variant)",
    fontVariantNumeric: "tabular-nums",
    "& > span:last-child": { color: "var(--md-sys-color-on-surface)" },
  },
});
const Track = styled("div", {
  base: {
    position: "relative",
    height: "8px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    "[data-thin] &": { height: "5px" },
  },
});
const Fill = styled("div", {
  base: {
    position: "absolute",
    inset: "0 auto 0 0",
    borderRadius: "999px",
    "@media (prefers-reduced-motion: no-preference)": {
      transition: "width 400ms ease-out",
    },
  },
});
const Ghost = styled("div", {
  base: {
    position: "absolute",
    top: 0,
    bottom: 0,
    opacity: 0.45,
    backgroundImage:
      "repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0 3px, transparent 3px 6px)",
  },
});

/** "123 → 145 ▲": antes e depois, a seta e a cor juntas. */
export function Delta(props: {
  a: number;
  b: number;
  fmt: (n: number) => string;
  /** Força o sentido (quando "menos é melhor"). */
  dir?: -1 | 0 | 1;
  compact?: boolean;
}) {
  const dir = () =>
    props.dir ?? (props.b > props.a ? 1 : props.b < props.a ? -1 : 0);
  return (
    <DeltaText data-dir={dir()}>
      <Show when={!props.compact}>
        <span>{props.fmt(props.a)}</span>
        <span aria-hidden="true"> → </span>
      </Show>
      <strong>{props.fmt(props.b)}</strong>
      <Show when={dir() !== 0}>
        <span aria-label={dir() > 0 ? "melhora" : "piora"}>
          {dir() > 0 ? " ▲" : " ▼"}
        </span>
      </Show>
    </DeltaText>
  );
}

export const DeltaText = styled("span", {
  base: {
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    "&[data-dir='1'] > strong, &[data-dir='1'] > span:last-child": {
      color: "#7ee08a",
    },
    "&[data-dir='-1'] > strong, &[data-dir='-1'] > span:last-child": {
      color: "#ff8a7a",
    },
  },
});

/** Ouro com o símbolo (o nome vai para o leitor de tela). */
export function Gold(props: { n: string | number; short?: boolean }) {
  const { t } = useLingui();
  return (
    <GoldText aria-label={t`${props.n} de ouro`}>
      <span aria-hidden="true">◉</span> {props.n}
    </GoldText>
  );
}

const GoldText = styled("span", {
  base: {
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    "& > span": { color: "#e8c35a" },
  },
});

/** A mensagem de erro de um comando (role=alert) ou de sucesso (status). */
export function Notice(props: { error?: string | null; ok?: string | null }) {
  return (
    <>
      <Show when={props.error}>
        <NoticeBox role="alert" data-kind="error">
          {props.error}
        </NoticeBox>
      </Show>
      <Show when={!props.error && props.ok}>
        <NoticeBox role="status" data-kind="ok">
          {props.ok}
        </NoticeBox>
      </Show>
    </>
  );
}

const NoticeBox = styled("div", {
  base: {
    padding: "8px 12px",
    borderRadius: "10px",
    fontSize: "0.9em",
    "&[data-kind=error]": {
      background: "rgba(255, 138, 122, 0.12)",
      color: "#ffcfc6",
      border: "1px solid rgba(255, 138, 122, 0.4)",
    },
    "&[data-kind=ok]": {
      background: "rgba(126, 224, 138, 0.1)",
      color: "#cdf5d3",
      border: "1px solid rgba(126, 224, 138, 0.35)",
    },
  },
});

export const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.88em" },
});

export const Section = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
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

export const Row = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
});

export const Panel = styled("div", {
  base: {
    padding: "12px",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
});

/** Quantidade com − e +, e atalhos (1, 10, máx.). */
export function Stepper(props: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
  quick?: number[];
}) {
  const { t } = useLingui();
  const min = () => props.min ?? 1;
  const set = (n: number) =>
    props.onChange(
      Math.max(min(), Math.min(props.max, Math.floor(n) || min())),
    );
  return (
    <StepWrap role="group" aria-label={props.label}>
      <Btn
        type="button"
        data-size="sm"
        aria-label={t`Menos`}
        disabled={props.value <= min()}
        onClick={() => set(props.value - 1)}
      >
        −
      </Btn>
      <StepInput
        type="number"
        inputMode="numeric"
        min={min()}
        max={props.max}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => set(Number(e.currentTarget.value))}
      />
      <Btn
        type="button"
        data-size="sm"
        aria-label={t`Mais`}
        disabled={props.value >= props.max}
        onClick={() => set(props.value + 1)}
      >
        +
      </Btn>
      <For each={props.quick ?? []}>
        {(q) => (
          <Btn
            type="button"
            data-size="sm"
            data-tone="quiet"
            disabled={q > props.max}
            onClick={() => set(q)}
          >
            {q}
          </Btn>
        )}
      </For>
      <Show when={props.max > min()}>
        <Btn
          type="button"
          data-size="sm"
          data-tone="quiet"
          onClick={() => set(props.max)}
        >
          {t`máx.`}
        </Btn>
      </Show>
    </StepWrap>
  );
}

const StepWrap = styled("div", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flexWrap: "wrap",
  },
});
const StepInput = styled("input", {
  base: {
    width: "5em",
    minHeight: "36px",
    textAlign: "center",
    borderRadius: "8px",
    border: "1px solid var(--md-sys-color-outline)",
    background: "var(--md-sys-color-surface)",
    color: "inherit",
    font: "inherit",
    fontVariantNumeric: "tabular-nums",
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
});

// ------------------------------------------------------------ ícone do item

const iconCache = new Map<string, string>();

/** O ícone 32×32 num canvas, guardado como imagem (um por silhueta e material). */
function iconUrl(item: ItemInstance): string {
  const v = itemVisual(item);
  const key = `${v.silhouette}|${v.material}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = ICON;
  canvas.height = ICON;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const px = iconPixels(v);
  for (let i = 0; i < px.length; i++) {
    const c = px[i];
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(i % ICON, Math.floor(i / ICON), 1, 1);
  }
  const url = canvas.toDataURL();
  iconCache.set(key, url);
  return url;
}

/**
 * O ícone com a moldura da raridade (cor + estilo + marcadores), o refino (+N) e o brilho do refino
 * (+7 brilho, +9 partículas, +10 aura; parado com "reduzir movimento"). `mark` põe ▲/▼ no canto.
 */
export function ItemIcon(
  props: {
    item: ItemInstance;
    /** 32 (padrão) ou 64 (o detalhe). */
    size?: 32 | 48 | 64;
    mark?: BagMark;
  } & JSX.HTMLAttributes<HTMLSpanElement>,
) {
  const [local, rest] = splitProps(props, ["item", "size", "mark"]);
  const r = () => RARITY[local.item.rarity];
  const glow = () => itemVisual(local.item).refineGlow;
  const supreme = () => itemVisual(local.item).supreme;
  const px = () => local.size ?? 32;
  return (
    <Frame
      {...rest}
      data-frame={r().frame}
      data-glow={glow() === "nenhum" ? undefined : glow()}
      data-supreme={supreme() ? "" : undefined}
      style={{
        "--rc": r().color,
        width: `${px() + 8}px`,
        height: `${px() + 8}px`,
      }}
    >
      <img
        src={iconUrl(local.item)}
        width={px()}
        height={px()}
        alt=""
        draggable={false}
      />
      <Show when={r().pips}>
        <Pips aria-hidden="true">{r().pips}</Pips>
      </Show>
      <Show when={local.item.refine > 0}>
        <Refine aria-hidden="true">+{local.item.refine}</Refine>
      </Show>
      <Show when={local.mark === "up" || local.mark === "down"}>
        <Mark aria-hidden="true" data-mark={local.mark}>
          {local.mark === "up" ? "▲" : "▼"}
        </Mark>
      </Show>
    </Frame>
  );
}

const Frame = styled("span", {
  base: {
    position: "relative",
    display: "inline-grid",
    placeItems: "center",
    flex: "0 0 auto",
    borderRadius: "8px",
    background:
      "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.08), rgba(0,0,0,0.25))",
    border: "1px solid var(--rc)",
    "& > img": { imageRendering: "pixelated" },
    "&[data-frame=grossa]": { borderWidth: "2px" },
    "&[data-frame=dupla]": { border: "3px double var(--rc)" },
    "&[data-frame=cantos]": {
      borderWidth: "2px",
      boxShadow:
        "inset 4px 4px 0 -2px var(--rc), inset -4px -4px 0 -2px var(--rc)",
    },
    "&[data-frame=brilho]": {
      borderWidth: "2px",
      boxShadow: "0 0 8px var(--rc), inset 0 0 6px var(--rc)",
    },
    "&[data-glow] > img": { filter: "drop-shadow(0 0 3px #fff3b0)" },
    "&[data-glow=particulas]::after, &[data-glow=aura]::after": {
      content: '""',
      position: "absolute",
      inset: "-3px",
      borderRadius: "10px",
      pointerEvents: "none",
      background:
        "radial-gradient(circle at 20% 25%, #fff6c8 0 1.2px, transparent 2px), radial-gradient(circle at 78% 35%, #fff6c8 0 1px, transparent 2px), radial-gradient(circle at 60% 80%, #fff6c8 0 1.2px, transparent 2px)",
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gameSparkle 1.6s ease-in-out infinite",
      },
    },
    "&[data-glow=aura]": {
      boxShadow: "0 0 12px 2px rgba(255, 214, 102, 0.55)",
    },
    // D68 Arma Suprema: borda de sangue e fogo (vermelho-escuro → brasa) que respira, e fagulhas
    // subindo pela borda de cima. Parada (só o brilho fixo) com "reduzir movimento".
    "&[data-supreme]": {
      border: "2px solid #e0261a",
      background:
        "radial-gradient(circle at 50% 115%, rgba(255,110,30,0.45), rgba(120,0,0,0.55) 55%, rgba(20,0,0,0.6))",
      boxShadow:
        "0 0 6px 1px rgba(220,30,20,0.85), 0 0 14px 3px rgba(255,110,30,0.4), inset 0 0 7px rgba(170,0,0,0.85)",
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gameEmber 1.8s ease-in-out infinite",
      },
    },
    "&[data-supreme]::before": {
      content: '""',
      position: "absolute",
      inset: "-4px -2px auto -2px",
      height: "10px",
      pointerEvents: "none",
      background:
        "radial-gradient(circle at 18% 70%, #ffd27a 0 1px, transparent 1.6px), radial-gradient(circle at 52% 40%, #ff8a3d 0 1.2px, transparent 1.8px), radial-gradient(circle at 83% 75%, #ffb24d 0 1px, transparent 1.6px)",
      opacity: 0.85,
      "@media (prefers-reduced-motion: no-preference)": {
        animation: "gameEmberRise 1.4s ease-out infinite",
      },
    },
  },
});

const Pips = styled("span", {
  base: {
    position: "absolute",
    top: "-1px",
    left: "2px",
    fontSize: "8px",
    lineHeight: 1,
    letterSpacing: "-1px",
    color: "var(--rc)",
    textShadow: "0 0 2px #000, 0 0 2px #000",
  },
});

const Refine = styled("span", {
  base: {
    position: "absolute",
    right: "1px",
    bottom: "0",
    fontSize: "10px",
    fontWeight: 800,
    lineHeight: 1,
    color: "#ffe7a8",
    textShadow: "0 0 2px #000, 0 0 2px #000, 0 0 2px #000",
  },
});

const Mark = styled("span", {
  base: {
    position: "absolute",
    top: "-2px",
    right: "0",
    fontSize: "11px",
    lineHeight: 1,
    textShadow: "0 0 2px #000, 0 0 2px #000",
    "&[data-mark=up]": { color: "#7ee08a" },
    "&[data-mark=down]": { color: "#ff8a7a" },
  },
});
