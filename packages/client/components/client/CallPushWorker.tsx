import { onCleanup, onMount } from "solid-js";

import { useClient } from "@revolt/client";

import { registerPushToken } from "@revolt/rtc";

/**
 * Registers the Android FCM token with the Muchat push sidecar once the
 * Stoat session exists. Desktop/web ignore missing MuchatNative.fcmToken.
 */
export function CallPushWorker() {
  const client = useClient();

  onMount(() => {
    const send = (token: string) => {
      if (!token) return;
      void registerPushToken(client(), token).catch(() => {
        /* sidecar may be down; voice still works over WS */
      });
    };

    send(window.MuchatNative?.fcmToken?.() ?? "");
    window.__muchatFcmToken = send;
    onCleanup(() => {
      delete window.__muchatFcmToken;
    });
  });

  return null;
}
