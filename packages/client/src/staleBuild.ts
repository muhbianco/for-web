import { createSignal } from "solid-js";

import { pendingUpdate } from "./serviceWorkerInterface";

/**
 * A tab opened before a deploy runs the old build, and the old build's lazy parts
 * (the dummy, NPC and TV dialogs of the Space, for example) no longer exist on the
 * server: every deploy replaces the hashed files. The import fails and nothing
 * opens (24/11/2026, the owner's tablet: "não consigo clicar em lugar nenhum para
 * abrir o dummy ou o NPC"). This flag turns on when that happens, so the page can
 * offer a reload. It never reloads by itself: that would cut a voice call.
 */
const [staleBuild, setStaleBuild] = createSignal(false);

export { staleBuild };

/** Messages of a failed dynamic import (Chromium, Safari, Firefox) and of Vite's CSS preload. */
const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

if (typeof window !== "undefined") {
  // Vite dispatches this when a lazy part or what it preloads fails to load.
  window.addEventListener("vite:preloadError", () => setStaleBuild(true));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: unknown } | undefined;
    const message = String(reason?.message ?? reason ?? "");
    if (CHUNK_ERROR.test(message)) setStaleBuild(true);
  });
}

/** Loads the new build: through the service worker when it has one waiting, else a reload. */
export function reloadForUpdate() {
  const update = pendingUpdate();
  if (update) update();
  else window.location.reload();
}
