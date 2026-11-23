import { onCleanup, onMount } from "solid-js";

/**
 * Teclado dos diálogos do jogo (docs/espaco/jogo/ot). O foco entra no título ao abrir, como no
 * Onboarding: sem isso ele fica no mapa e as teclas andam com o avatar por trás do diálogo.
 * O Esc fecha mesmo quando o botão focado some numa troca de conteúdo (o foco cai no body e o
 * evento não passa pelo diálogo). `refocus` devolve o foco ao título depois de uma troca dessas.
 */
export function useModalKeys(
  card: () => HTMLElement | undefined,
  title: () => HTMLElement | undefined,
  onClose: () => void,
): () => void {
  const inside = () => card()?.contains(document.activeElement) ?? false;
  onMount(() => title()?.focus({ preventScroll: true }));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !inside()) onClose();
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));
  return () => {
    if (!inside()) title()?.focus({ preventScroll: true });
  };
}
