import {
  type JSX,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";

import type { HeroV5, ItemInstance } from "@muchat/space-core/game/ot/balance";
import { styled } from "styled-system/jsx";

import { ItemCard } from "./ItemCard";
import { gameChip } from "./gameTheme";
import { placeTip } from "./tipMath";

/** Parar o mouse em cima: abre depois deste tempo (passar por cima não pisca nada). */
const OPEN_DELAY = 300;
/** Indo de um item ao vizinho logo depois de fechar, abre na hora. */
const WARM = 400;
/** No toque: segurar este tempo abre o detalhe (o toque curto continua selecionando). */
const LONG_PRESS = 450;
/** Arrastou o dedo mais que isto: é rolagem, não toque longo. */
const SLOP = 10;

// Um detalhe aberto por vez, na página toda.
let seq = 0;
const [active, setActive] = createSignal<number | null>(null);
let lastClose = 0;

/** Os manipuladores que o item recebe (`{...bind}` no botão ou no ícone). */
export interface TipBind {
  "aria-describedby": string | undefined;
  onPointerEnter: (e: PointerEvent) => void;
  onPointerLeave: (e: PointerEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onFocus: (e: FocusEvent) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * O detalhe ao parar em cima de algo do jogo (item: pedido do dono em 25/11/2026, "parou o mouse em
 * cima do item, o tooltip abre"; skill: no mesmo dia, "não dá pra saber o que elas fazem"). Quem usa
 * diz o conteúdo; o jeito de abrir, fechar e se pôr na tela é um só.
 *
 * Abre: mouse parado em cima (atraso curto), foco pelo teclado (Tab), toque longo no celular (o
 * toque curto segue selecionando, e o clique que viria depois do toque longo é engolido). Fecha:
 * mouse sai, foco sai, Esc, rolagem, mudança de tamanho, o próximo toque em qualquer lugar.
 * Fica ao lado do que está embaixo (nunca em cima), sempre inteiro na tela, e não pega clique
 * (pointer-events: none). Com "reduzir movimento", aparece sem o esmaecer.
 */
export function HoverTip(props: {
  /** Falso: o detalhe nunca abre (um lugar vazio do boneco). */
  enabled: boolean;
  /** O que o detalhe mostra (só é montado com o detalhe aberto). */
  content: () => JSX.Element;
  /** Largura da caixa (padrão: 300px, menos no celular). */
  width?: number;
  children: (bind: TipBind) => JSX.Element;
}) {
  const id = ++seq;
  const domId = `game-tip-${id}`;
  let anchor: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let press: { x: number; y: number } | null = null;
  const [byTouch, setByTouch] = createSignal(false);
  const open = () => active() === id;

  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    press = null;
  };
  const show = (el: HTMLElement, touch: boolean) => {
    if (!props.enabled) return;
    anchor = el;
    setByTouch(touch);
    setActive(id);
  };
  const hide = () => {
    stop();
    if (active() === id) {
      setActive(null);
      lastClose = performance.now();
    }
  };
  const later = (fn: () => void, ms: number) => {
    stop();
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, ms);
  };
  onCleanup(hide);

  // Aberto: rolagem e mudança de tamanho fecham (a posição ficaria errada); o próximo toque em
  // qualquer lugar fecha o que o toque longo abriu; com o mouse, só um clique fora do item.
  createEffect(() => {
    if (!open()) return;
    const close = () => hide();
    const onDown = (e: PointerEvent) => {
      if (byTouch() || !anchor?.contains(e.target as Node)) hide();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", onDown, true);
    });
  });

  /** O toque longo abriu o detalhe: o clique que o navegador manda ao soltar não seleciona. */
  const swallowNextClick = (el: HTMLElement) => {
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      done();
    };
    const done = () => {
      el.removeEventListener("click", swallow, true);
      document.removeEventListener("pointerdown", done, true);
    };
    el.addEventListener("click", swallow, true);
    // Sem clique ao soltar (o navegador às vezes não manda): o próximo toque libera.
    setTimeout(() => document.addEventListener("pointerdown", done, true), 0);
  };

  const bind: TipBind = {
    get "aria-describedby"() {
      return open() ? domId : undefined;
    },
    onPointerEnter: (e) => {
      if (e.pointerType === "touch") return;
      const el = e.currentTarget as HTMLElement;
      later(
        () => show(el, false),
        performance.now() - lastClose < WARM ? 0 : OPEN_DELAY,
      );
    },
    onPointerLeave: (e) => {
      if (e.pointerType !== "touch") hide();
    },
    onPointerDown: (e) => {
      if (e.pointerType !== "touch") return;
      const el = e.currentTarget as HTMLElement;
      later(() => {
        show(el, true);
        swallowNextClick(el);
      }, LONG_PRESS);
      press = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP)
        stop();
    },
    onPointerUp: () => {
      if (press) stop();
    },
    onPointerCancel: () => {
      if (press) stop();
    },
    onContextMenu: (e) => {
      // O toque longo do Android também abre o menu do navegador: aqui o detalhe é o menu.
      if (press || (open() && byTouch())) e.preventDefault();
    },
    onFocus: (e) => {
      const el = e.currentTarget as HTMLElement;
      // Só o foco do teclado (o clique do mouse também foca, e aí quem manda é o mouse).
      if (el.matches?.(":focus-visible")) show(el, false);
    },
    onBlur: () => hide(),
    onKeyDown: (e) => {
      if (e.key === "Escape" && open()) {
        hide();
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };

  return (
    <>
      {props.children(bind)}
      <Show when={open()}>
        <Portal>
          <TipBox anchor={() => anchor} id={domId} width={props.width}>
            {props.content()}
          </TipBox>
        </Portal>
      </Show>
    </>
  );
}

/**
 * O detalhe de um item: o próprio `ItemCard` em modo compacto, a mesma verdade do detalhe
 * (raridade, nível, lugar, base, afixos, refino, ▲/▼ contra o vestido, "se vestir"), mais o que o
 * Mercador paga.
 */
export function ItemTip(props: {
  /** Sem item (um lugar vazio do boneco): o detalhe nunca abre. */
  item: (ItemInstance & { uid?: string }) | null | undefined;
  /** O herói de quem olha (compara com o que ele veste); null: item de outra pessoa. */
  hero: HeroV5 | null;
  /** Quanto o Mercador paga (só onde vender faz sentido). */
  price?: number;
  compare?: boolean;
  children: (bind: TipBind) => JSX.Element;
}) {
  return (
    <HoverTip
      enabled={!!props.item}
      content={() => (
        <Show when={props.item}>
          {(it) => (
            <ItemCard
              hero={props.hero}
              item={it()}
              compare={props.compare}
              price={props.price}
              compact
            />
          )}
        </Show>
      )}
    >
      {props.children}
    </HoverTip>
  );
}

/** A caixa do detalhe: mede o próprio tamanho e se põe ao lado do item (tipMath). */
function TipBox(props: {
  anchor: () => HTMLElement | undefined;
  id: string;
  width?: number;
  children: JSX.Element;
}) {
  let box: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<{
    left: number;
    top: number;
    maxHeight: number;
    side: string;
  } | null>(null);
  onMount(() => {
    const a = props.anchor();
    if (!a || !box) return;
    const view = {
      w: document.documentElement.clientWidth || window.innerWidth,
      h: document.documentElement.clientHeight || window.innerHeight,
    };
    setPos(
      placeTip(
        a.getBoundingClientRect(),
        { w: box.offsetWidth, h: box.scrollHeight },
        view,
      ),
    );
  });
  return (
    <Box
      ref={box}
      id={props.id}
      role="tooltip"
      data-side={pos()?.side}
      style={{
        ...gameChip,
        "box-shadow":
          "0 0 0 1px rgba(122, 100, 64, 0.6), 0 12px 32px rgba(0, 0, 0, 0.65)",
        width: props.width
          ? `min(${props.width}px, calc(100vw - 16px))`
          : undefined,
        left: `${pos()?.left ?? 0}px`,
        top: `${pos()?.top ?? 0}px`,
        "max-height": pos() ? `${pos()!.maxHeight}px` : undefined,
        visibility: pos() ? "visible" : "hidden",
      }}
    >
      {props.children}
    </Box>
  );
}

const Box = styled("div", {
  base: {
    position: "fixed",
    zIndex: 2000,
    width: "min(300px, calc(100vw - 16px))",
    overflow: "hidden",
    borderRadius: "12px",
    pointerEvents: "none",
    color: "#f3efe6",
    fontSize: "0.9rem",
    lineHeight: 1.35,
    textAlign: "start",
    "@media (prefers-reduced-motion: no-preference)": {
      animation: "gameTipIn 0.12s ease-out",
    },
  },
});
