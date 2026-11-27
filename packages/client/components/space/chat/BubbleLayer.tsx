import {
  For,
  Show,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type BubbleColumn,
  type HeadAnchor,
  type SpaceView,
  layoutBubbles,
} from "@muchat/space-client";
import { css } from "styled-system/css";

import type { SayBubble, SpaceChat } from "./spaceChat";
import { TtsFace } from "./TtsFace";

interface Props {
  chat: SpaceChat;
  view: SpaceView | null;
  reducedMotion: boolean;
  /** Um clique no balão: o painel do chat abre no canal (e na mensagem). */
  onOpen: (channelId: string, messageId?: string) => void;
  /** Nome da sala de um canal, para o sinal de conversa em outra sala. */
  placeOf: (channelId: string) => string;
  /** A voz do TTS desta mensagem está tocando neste aparelho (a carinha mexe a boca). */
  speaking: (messageId: string) => boolean;
  /**
   * O que cobre a borda direita e o pé do mapa (folhas, o painel flutuante, a doca), em px: os
   * balões ficam na parte à vista, como a câmera.
   */
  insets: { right: number; bottom: number };
}

interface ColumnEl {
  el: HTMLDivElement;
  w: number;
  h: number;
  /** Largura de cada balão da pilha (medida), e o deslocamento e a ponta escritos por último. */
  widths: number[];
  dx: number[];
  tail: number;
  /** O nome de quem fala aparece no balão (ficou longe da cabeça, ou gente falando colada). */
  named: boolean;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Duas cabeças mais perto que isto (px da tela): quem falou o quê fica ambíguo. */
const CROWD_X = 72;
const CROWD_Y = 44;

/**
 * Os balões sobre as cabeças (27/11/2026). Fica sobre o canvas do mapa, abaixo de todo o resto
 * (janelas do jogo, painéis): o que é do jogo cobre a conversa, nunca o contrário.
 *
 * Custo: sem balão, nada roda (o mapa nem calcula cabeças). Com balão, o mapa conta onde as
 * cabeças estão só quando uma se mexe, e aqui só se escreve `transform` (sem layout). A esteira
 * anda com Web Animations em `transform`, no compositor: zero trabalho por quadro na thread
 * principal, que é a da voz.
 */
export function BubbleLayer(props: Props) {
  const { t } = useLingui();
  let layer!: HTMLDivElement;
  const cols = new Map<string, ColumnEl>();
  let heads: ReadonlyMap<string, HeadAnchor> = new Map();
  let bounds = { w: 0, h: 0 };
  let measureRaf = 0;

  /** A parte do mapa à vista (sem o que o app pôs por cima na borda direita e no pé). */
  function seen() {
    const r = props.insets.right;
    const b = props.insets.bottom;
    // Como a câmera: se sobra pouco, vale o mapa inteiro.
    return {
      w: bounds.w - r >= 120 ? bounds.w - r : bounds.w,
      h: bounds.h - b >= 120 ? bounds.h - b : bounds.h,
    };
  }

  /** A cabeça está na parte à vista do mapa. */
  function headSeen(h: HeadAnchor | undefined, area = seen()) {
    return !!h && h.visible && h.x <= area.w && h.y <= area.h;
  }

  /** Coloca cada coluna no lugar (chamado no mesmo quadro em que o mapa desenha). */
  function relayout() {
    const area = seen();
    const list: BubbleColumn[] = [];
    for (const [id, c] of cols) {
      const h = heads.get(id);
      if (!headSeen(h, area) || !c.w) {
        if (c.el.style.visibility !== "hidden")
          c.el.style.visibility = "hidden";
        continue;
      }
      list.push({
        id,
        x: h!.x,
        y: h!.y,
        w: c.w,
        h: c.h,
        order: props.chat.orderOf(id),
      });
    }
    let renamed = false;
    for (const p of layoutBubbles(list, area)) {
      const c = cols.get(p.id)!;
      // A ponta deixa de bastar para dizer quem falou: a pilha subiu além da cabeça, ou há
      // outra cabeça falando colada. O nome entra e fica enquanto a pilha existir (sem piscar).
      if (!c.named) {
        const me = heads.get(p.id)!;
        const crowded = list.some((o) => {
          if (o.id === p.id) return false;
          const h = heads.get(o.id)!;
          return (
            Math.abs(h.x - me.x) < CROWD_X && Math.abs(h.y - me.y) < CROWD_Y
          );
        });
        if (p.lift > 0 || crowded) {
          c.named = true;
          c.el.dataset.named = "";
          renamed = true;
        }
      }
      const s = c.el.style;
      const tf = `translate3d(${p.left}px, ${p.top}px, 0)`;
      if (s.transform !== tf) s.transform = tf;
      s.setProperty("--line-x", `${p.tailX}px`);
      s.setProperty("--lift", `${p.lift}px`);
      s.zIndex = String(100 - Math.min(99, props.chat.orderOf(p.id)));
      // Cada balão da pilha centrado sobre a cabeça, preso à largura da pilha; a ponta do de
      // baixo sempre dentro dele, apontando para quem falou.
      const head = heads.get(p.id)!.x - p.left;
      const kids = c.el.children;
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i] as HTMLElement;
        const bw = c.widths[i] ?? c.w;
        const dx = Math.round(clamp(head - bw / 2, 0, Math.max(0, c.w - bw)));
        if (c.dx[i] !== dx) {
          c.dx[i] = dx;
          kid.style.translate = dx ? `${dx}px 0` : "";
        }
        if (i === kids.length - 1) {
          const tail = Math.round(clamp(head - dx, 10, bw - 10));
          if (c.tail !== tail) {
            c.tail = tail;
            kid.style.setProperty("--tail-x", `${tail}px`);
          }
        }
      }
      if (s.visibility !== "visible") s.visibility = "visible";
    }
    // O nome muda a altura da pilha: mede de novo (uma vez; o nome não sai mais).
    if (renamed) measureSoon();
  }

  /** Uma coluna mudou de tamanho (balão novo, saiu, texto editado): mede e recoloca. */
  function measureSoon() {
    if (measureRaf) return;
    measureRaf = requestAnimationFrame(() => {
      measureRaf = 0;
      for (const c of cols.values()) {
        c.w = c.el.offsetWidth;
        c.h = c.el.offsetHeight;
        c.widths = [...c.el.children].map(
          (k) => (k as HTMLElement).offsetWidth,
        );
        // Os balões mudaram: o deslocamento e a ponta são escritos de novo.
        c.dx = [];
        c.tail = -1;
      }
      relayout();
    });
  }

  function onHeads(next: ReadonlyMap<string, HeadAnchor>) {
    heads = next;
    relayout();
    // Para o chat, cabeça coberta pelo painel conta como fora da tela (a fala vira linha).
    const area = seen();
    const shown = new Map<string, HeadAnchor>();
    for (const [id, h] of next)
      shown.set(id, headSeen(h, area) ? h : { ...h, visible: false });
    props.chat.reportHeads(shown);
  }

  // O que cobre o mapa mudou (o painel abriu, a doca do celular): recoloca.
  createEffect(
    on(
      () => [props.insets.right, props.insets.bottom],
      () => relayout(),
      { defer: true },
    ),
  );

  // O mapa só segue as cabeças de quem tem balão; sem ninguém, para de calcular.
  // A visão que está seguindo cabeças, numa variável comum: a limpeza não pode ler props (no
  // Solid 1.9, ler estado reativo no meio do descarte quebra a reatividade do app inteiro).
  let watched: SpaceView | null = null;
  createEffect(
    on(
      () => [props.view, props.chat.columnIds()] as const,
      ([v, ids]) => {
        if (watched && watched !== v) watched.watchHeads(new Set(), null);
        watched = v;
        if (!v) return;
        v.watchHeads(new Set(ids), ids.length ? onHeads : null);
        measureSoon();
      },
    ),
  );
  onCleanup(() => {
    watched?.watchHeads(new Set(), null);
    watched = null;
    if (measureRaf) cancelAnimationFrame(measureRaf);
  });

  onMount(() => {
    const ro = new ResizeObserver(([e]) => {
      bounds = { w: e!.contentRect.width, h: e!.contentRect.height };
      relayout();
    });
    ro.observe(layer);
    onCleanup(() => ro.disconnect());
  });

  /** O nome de quem está no mapa (sem o nível do herói). */
  function nameOf(userId: string): string {
    const w = props.view?.world;
    if (w?.me?.userId === userId) return w.me.name;
    return w?.others.get(userId)?.name ?? "";
  }

  /** A última fala da sua zona, para leitor de tela (o mapa é desenho; isto é o texto). */
  const spoken = createMemo(() => {
    let last: SayBubble | null = null;
    for (const list of Object.values(props.chat.says))
      for (const b of list) if (!b.mine && (!last || b.at > last.at)) last = b;
    return last;
  });

  function Column(p: { userId: string }) {
    let el!: HTMLDivElement;
    // Fixo por coluna (a lista é por id): a limpeza usa esta cópia, não a prop.
    const id = p.userId;
    onMount(() => {
      cols.set(id, {
        el,
        w: 0,
        h: 0,
        widths: [],
        dx: [],
        tail: -1,
        named: false,
      });
      measureSoon();
    });
    onCleanup(() => {
      cols.delete(id);
    });
    // Mudou o que a coluna mostra: mede de novo.
    createEffect(
      on(
        () => [
          (props.chat.says[p.userId] ?? [])
            .map((b) => `${b.key}:${b.text}`)
            .join("|"),
          props.chat.typing().includes(p.userId),
          !!props.chat.elsewhere[p.userId],
        ],
        measureSoon,
      ),
    );
    const says = () => props.chat.says[p.userId] ?? [];
    return (
      <div ref={el} class={column} style={{ visibility: "hidden" }}>
        <For each={says()}>
          {(b, i) => (
            <Say
              bubble={b}
              name={nameOf(b.userId)}
              older={i() < says().length - 1}
              reducedMotion={props.reducedMotion}
              onHold={(on) => props.chat.hold(b.key, on)}
              onOpen={() => props.onOpen(b.channelId, b.key)}
              moreLabel={t`continua no chat`}
              speaking={b.tts && props.speaking(b.key)}
            />
          )}
        </For>
        <Show when={props.chat.typing().includes(p.userId)}>
          <div
            class={bubble}
            data-kind="typing"
            data-reduced={props.reducedMotion ? "" : undefined}
            title={t`digitando…`}
          >
            <i />
            <i />
            <i />
          </div>
        </Show>
        <Show when={props.chat.elsewhere[p.userId]}>
          {(m) => (
            <button
              type="button"
              tabIndex={-1}
              class={bubble}
              data-kind="elsewhere"
              title={t`Conversa em ${props.placeOf(m().channelId)} · abrir`}
              aria-label={t`Conversa em ${props.placeOf(m().channelId)}`}
              onClick={() => props.onOpen(m().channelId)}
            >
              <i />
              <i />
              <i />
            </button>
          )}
        </Show>
      </div>
    );
  }

  return (
    <>
      <div
        ref={layer}
        class={layerCss}
        aria-hidden="true"
        data-space-bubbles=""
      >
        <For each={props.chat.columnIds()}>
          {(id) => <Column userId={id} />}
        </For>
      </div>
      <div class={srOnly} aria-live="polite">
        {(() => {
          const b = spoken();
          if (!b) return "";
          const name = nameOf(b.userId);
          return t`${name} disse: ${b.text}`;
        })()}
      </div>
    </>
  );
}

/** Um balão de fala: parado (até 3 linhas) ou em esteira, com a barra de progresso embaixo. */
function Say(p: {
  bubble: SayBubble;
  /** Quem falou (aparece só quando a pilha está ambígua: veja `named`). */
  name: string;
  older: boolean;
  reducedMotion: boolean;
  onHold: (on: boolean) => void;
  onOpen: () => void;
  moreLabel: string;
  /** A voz do TTS desta fala está tocando agora neste aparelho. */
  speaking: boolean;
}) {
  let box!: HTMLButtonElement;
  let track: HTMLSpanElement | undefined;
  let bar: HTMLSpanElement | undefined;
  let anims: Animation[] = [];
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;

  const ticker = () =>
    p.bubble.plan.mode === "ticker" && !p.reducedMotion
      ? p.bubble.plan.ticker
      : null;

  function stop() {
    for (const a of anims) a.cancel();
    anims = [];
    if (phaseTimer) clearTimeout(phaseTimer);
  }

  // Esteira: o texto anda da esquerda para a direita no ritmo de leitura (chat/bubbles.ts).
  createEffect(
    on(
      () => [ticker(), p.bubble.text] as const,
      ([plan]) => {
        stop();
        if (!plan || !track || !bar) return;
        const timing: KeyframeAnimationOptions = {
          duration: Math.max(1, plan.runMs),
          delay: plan.delayMs,
          easing: "linear",
          fill: "both",
        };
        box.dataset.phase = "start";
        anims = [
          track.animate(
            [
              { transform: "translateX(0)" },
              { transform: `translateX(${-plan.distancePx}px)` },
            ],
            timing,
          ),
          bar.animate(
            [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
            timing,
          ),
        ];
        phaseTimer = setTimeout(
          () => (box.dataset.phase = "moving"),
          plan.delayMs,
        );
        void anims[0]!.finished.then(
          () => (box.dataset.phase = "end"),
          () => undefined,
        );
      },
    ),
  );
  onCleanup(stop);

  return (
    <button
      ref={box}
      type="button"
      tabIndex={-1}
      class={bubble}
      data-kind="say"
      data-mine={p.bubble.mine ? "" : undefined}
      data-older={p.older ? "" : undefined}
      data-leaving={p.bubble.leaving ? "" : undefined}
      data-ticker={ticker() ? "" : undefined}
      data-clamped={
        p.bubble.plan.mode === "ticker" && p.reducedMotion ? "" : undefined
      }
      onPointerEnter={() => {
        p.onHold(true);
        for (const a of anims) a.pause();
      }}
      onPointerLeave={() => {
        p.onHold(false);
        for (const a of anims) a.play();
      }}
      onClick={() => p.onOpen()}
    >
      <Show when={p.name}>
        <b class={who}>{p.name}</b>
      </Show>
      <span class={body}>
        {/* `/tts`: a carinha falando no lugar do comando (a boca mexe enquanto a voz toca). */}
        <Show when={p.bubble.tts}>
          <TtsFace speaking={p.speaking} />
        </Show>
        <Show
          when={ticker()}
          fallback={
            <span class={stack}>
              <span class={staticText}>{p.bubble.text}</span>
              <Show when={p.bubble.plan.mode === "ticker"}>
                <span class={more}>{p.moreLabel}</span>
              </Show>
            </span>
          }
        >
          <span class={windowCss}>
            <span ref={track} class={trackCss} data-track="">
              {p.bubble.text}
            </span>
          </span>
        </Show>
      </span>
      <Show when={ticker()}>
        <span class={progress}>
          <span ref={bar} />
        </span>
      </Show>
    </button>
  );
}

// O Panda extrai o CSS sem rodar o código: os números abaixo são os de `BUBBLE`
// (space-client/src/chat/bubbles.ts) escritos à mão. Mudou lá, muda aqui; o laboratório
// (qa/full-lab/chat-lab.mjs) confere largura, letra e linha na tela.
const layerCss = css({
  position: "absolute",
  inset: 0,
  // Acima do canvas, abaixo de tudo o que o app põe sobre o mapa (z 2 em diante).
  zIndex: 1,
  overflow: "hidden",
  pointerEvents: "none",
  contain: "strict",
});

/** A pilha de uma pessoa: o mais antigo em cima, o mais novo (com a ponta) perto da cabeça. */
const column = css({
  position: "absolute",
  left: 0,
  top: 0,
  display: "flex",
  flexDirection: "column",
  // Cada balão é posto sobre a cabeça pelo layout (translate); a base é a borda esquerda.
  alignItems: "flex-start",
  gap: "4px",
  width: "max-content",
  maxWidth: "248px",
  willChange: "transform",
  // A linha que liga a pilha à cabeça quando ela precisou subir para não cobrir outra.
  "&::after": {
    content: '""',
    position: "absolute",
    top: "calc(100% + 7px)",
    left: "var(--line-x, 50%)",
    width: "1px",
    height: "var(--lift, 0px)",
    background: "rgba(251, 251, 254, 0.55)",
    transform: "translateX(-0.5px)",
  },
});

const bubble = css({
  position: "relative",
  display: "block",
  boxSizing: "border-box",
  maxWidth: "248px",
  minWidth: "32px",
  margin: 0,
  padding: "6px 10px",
  border: "1px solid rgba(20, 18, 28, 0.08)",
  borderRadius: "12px",
  // Cores fixas: o mapa é escuro em qualquer tema, e o balão claro é o que se lê de relance.
  background: "#FBFBFE",
  color: "#17151D",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25)",
  fontFamily: "var(--fonts-primary)",
  fontSize: "13px",
  lineHeight: "18px",
  fontWeight: 450,
  textAlign: "start",
  overflowWrap: "anywhere",
  pointerEvents: "auto",
  cursor: "pointer",
  userSelect: "none",
  transition: "opacity 200ms ease, transform 200ms ease",
  animation: "spaceBubbleIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
  "&[data-mine]": {
    background: "#EAF1FF",
    borderColor: "rgba(60, 100, 220, 0.22)",
  },
  // Os mais antigos da pilha recuam: o novo é o que importa.
  "&[data-older]": { opacity: 0.72 },
  "&[data-leaving]": { opacity: 0, transform: "translateY(-4px)" },
  "&:focus-visible": { outline: "2px solid #7AA2FF", outlineOffset: "2px" },
  // A ponta: só no balão de baixo (o mais perto da cabeça), apontando para quem falou.
  "&:last-child::after": {
    content: '""',
    position: "absolute",
    top: "100%",
    left: "var(--tail-x, 50%)",
    width: 0,
    height: 0,
    marginLeft: "-6px",
    borderLeft: "6px solid transparent",
    borderRight: "6px solid transparent",
    borderTop: "7px solid #FBFBFE",
    filter: "drop-shadow(0 1px 0 rgba(20, 18, 28, 0.08))",
  },
  "&[data-mine]:last-child::after": { borderTopColor: "#EAF1FF" },
  "&[data-ticker]": {
    width: "248px",
    paddingBottom: "8px",
  },
  // Digitando: três pontos que respiram.
  "&[data-kind=typing], &[data-kind=elsewhere]": {
    display: "flex",
    alignItems: "center",
    gap: "3px",
    minWidth: 0,
    padding: "7px 9px",
    cursor: "default",
  },
  "&[data-kind=typing] > i, &[data-kind=elsewhere] > i": {
    display: "block",
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    background: "#6B6878",
  },
  "&[data-kind=typing]:not([data-reduced]) > i": {
    animation: "spaceTypingDot 1.2s ease-in-out infinite",
  },
  "&[data-kind=typing] > i:nth-child(2)": { animationDelay: "0.15s" },
  "&[data-kind=typing] > i:nth-child(3)": { animationDelay: "0.3s" },
  // Conversa em outra sala: o sinal, sem o texto, mais discreto.
  "&[data-kind=elsewhere]": {
    opacity: 0.82,
    padding: "5px 7px",
    cursor: "pointer",
    "& > i": { width: "4px", height: "4px", background: "#8A8796" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    animation: "none",
    transition: "opacity 120ms linear",
    "&[data-leaving]": { transform: "none" },
  },
});

/** O nome de quem falou, em cima do texto: só aparece na pilha marcada `data-named`. */
const who = css({
  display: "none",
  marginBottom: "1px",
  fontSize: "11px",
  lineHeight: "14px",
  fontWeight: 700,
  color: "#4A4757",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  "[data-named] &": { display: "block" },
});

/** O conteúdo do balão: a carinha do TTS (quando há) e o texto ao lado. */
const body = css({
  display: "flex",
  alignItems: "flex-start",
  gap: "4px",
  minWidth: 0,
});

const stack = css({
  display: "block",
  flex: 1,
  minWidth: 0,
});

const staticText = css({
  lineClamp: 3,
});

const more = css({
  display: "block",
  marginTop: "2px",
  fontSize: "11px",
  lineHeight: "14px",
  color: "#5B5868",
});

/** A janela da esteira: as bordas esmaecem para o lado de onde vem e para onde vai o texto. */
const windowCss = css({
  display: "block",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
  maskImage: "linear-gradient(90deg, #000 calc(100% - 16px), transparent)",
  "[data-phase=moving] &": {
    maskImage:
      "linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 16px), transparent)",
  },
  "[data-phase=end] &": {
    maskImage: "linear-gradient(90deg, transparent, #000 14px)",
  },
});

const trackCss = css({
  display: "inline-block",
  willChange: "transform",
});

/** Quanto da esteira já passou (2 px no pé do balão). */
const progress = css({
  position: "absolute",
  left: "10px",
  right: "10px",
  bottom: "3px",
  height: "2px",
  borderRadius: "1px",
  background: "rgba(23, 21, 29, 0.1)",
  overflow: "hidden",
  "& > span": {
    display: "block",
    height: "100%",
    background: "rgba(23, 21, 29, 0.38)",
    transformOrigin: "left center",
    transform: "scaleX(0)",
  },
});

const srOnly = css({
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
});
