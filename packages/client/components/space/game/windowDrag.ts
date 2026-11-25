import { type JSX, createSignal, onCleanup, onMount } from "solid-js";

import {
  type Box,
  type Offset,
  clampOffset,
  keyStep,
  loadOffset,
  saveOffset,
} from "./dragMath";

/** O que não começa o arrasto mesmo dentro da alça (os botões dela continuam clicáveis). */
const INTERACTIVE =
  "button, a, input, select, textarea, label, [role=tab], [data-no-drag]";

/**
 * A área tem mais que `min` px de conteúdo (a mesma medida das consultas de contêiner: sem o
 * padding). Abaixo disso a janela do jogo vira folha de baixo e não arrasta.
 */
export function useWide(el: () => HTMLElement | undefined, min: number) {
  const [wide, setWide] = createSignal(
    typeof window === "undefined" ? true : window.innerWidth > min,
  );
  onMount(() => {
    const e = el();
    if (!e) return;
    const update = () => {
      const cs = getComputedStyle(e);
      const content =
        e.clientWidth -
        (parseFloat(cs.paddingLeft) || 0) -
        (parseFloat(cs.paddingRight) || 0);
      setWide(content > min);
    };
    update();
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(e);
    onCleanup(() => ro?.disconnect());
  });
  return wide;
}

/** O deslocamento que está de fato na tela (o `translate` calculado), não o guardado. */
function applied(el: Element): Offset {
  const t = getComputedStyle(el).translate;
  if (!t || t === "none") return { x: 0, y: 0 };
  const [x, y] = t.split(" ").map((v) => parseFloat(v) || 0);
  return { x: x ?? 0, y: y ?? 0 };
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/**
 * Uma janela do jogo arrastável pela alça (a barra do título): o ponteiro (mouse, caneta, dedo)
 * arrasta; a alça visível (`data-grip`) também anda com as setas do teclado (Shift: passo maior)
 * e volta ao lugar com Home; duplo clique na barra volta ao lugar. A janela fica sempre inteira
 * dentro da área (`bounds`), inclusive quando a área ou a janela mudam de tamanho, e o lugar fica
 * guardado por janela (`id`) no aparelho. Com `enabled` falso (o celular, onde a janela é folha),
 * nada se mexe e o deslocamento não se aplica.
 *
 * O deslocamento vai na propriedade `translate` (não em `transform`), para não brigar com a
 * animação de entrada da janela.
 */
export function useWindowDrag(opts: {
  id: string;
  win: () => HTMLElement | undefined;
  bounds: () => HTMLElement | null | undefined;
  enabled: () => boolean;
}) {
  const [off, setOff] = createSignal<Offset>(
    loadOffset(opts.id) ?? { x: 0, y: 0 },
  );
  const [dragging, setDragging] = createSignal(false);
  let start: { x: number; y: number; off: Offset; id: number } | null = null;

  /** Põe o deslocamento pedido, preso à área (sem a área ainda medida, guarda como veio). */
  const place = (o: Offset) => {
    const w = opts.win();
    const b = opts.bounds();
    if (!w || !b || !opts.enabled()) return setOff(o);
    const r = boxOf(w);
    const cur = applied(w);
    const natural = {
      left: r.left - cur.x,
      top: r.top - cur.y,
      right: r.right - cur.x,
      bottom: r.bottom - cur.y,
    };
    setOff(clampOffset(o, natural, boxOf(b)));
  };
  const settle = () => saveOffset(opts.id, off());
  const reset = () => {
    setOff({ x: 0, y: 0 });
    settle();
  };

  onMount(() => {
    // O lugar guardado pode não caber nesta tela: prende já, e de novo a cada mudança de tamanho.
    const refit = () => {
      if (opts.enabled()) place(off());
    };
    queueMicrotask(refit);
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refit);
    const w = opts.win();
    const b = opts.bounds();
    if (ro && w) ro.observe(w);
    if (ro && b) ro.observe(b);
    window.addEventListener("resize", refit);
    onCleanup(() => {
      ro?.disconnect();
      window.removeEventListener("resize", refit);
    });
  });

  // Manipuladores com o evento puro: servem em qualquer elemento (div, h2…) sem brigar com o tipo.
  const handle = {
    onPointerDown: (e: PointerEvent) => {
      if (!opts.enabled() || e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest(INTERACTIVE) && !target.closest("[data-grip]")) return;
      start = { x: e.clientX, y: e.clientY, off: off(), id: e.pointerId };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDragging(true);
      // Sem seleção de texto no arrasto; a alça, se foi ela, fica com o foco (as setas valem).
      e.preventDefault();
      (target.closest("[data-grip]") as HTMLElement | null)?.focus({
        preventScroll: true,
      });
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      place({
        x: start.off.x + e.clientX - start.x,
        y: start.off.y + e.clientY - start.y,
      });
    },
    onPointerUp: (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      setDragging(false);
      settle();
    },
    onPointerCancel: () => {
      start = null;
      setDragging(false);
      settle();
    },
    onDblClick: (e: MouseEvent) => {
      if (!opts.enabled() || (e.target as Element).closest(INTERACTIVE)) return;
      reset();
    },
  };

  /** As setas na alça visível movem a janela; Home a devolve ao lugar. */
  const onGripKey = (e: KeyboardEvent) => {
    if (!opts.enabled()) return;
    if (e.key === "Home") {
      reset();
      e.preventDefault();
      return;
    }
    const d = keyStep(e.key, e.shiftKey);
    if (!d) return;
    const o = off();
    place({ x: o.x + d.x, y: o.y + d.y });
    settle();
    e.preventDefault();
    e.stopPropagation();
  };

  const style = (): JSX.CSSProperties => {
    if (!opts.enabled()) return {};
    const o = off();
    return o.x === 0 && o.y === 0 ? {} : { translate: `${o.x}px ${o.y}px` };
  };

  return { off, dragging, handle, onGripKey, reset, style };
}
