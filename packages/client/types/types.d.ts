import type { SolidOptions } from "solid-dnd-directive";
import type { Accessor, Component, Setter } from "solid-js";

import type { Placement } from "@floating-ui/dom";
import type { Channel, Client, ServerMember, ServerRole, User } from "stoat.js";

declare global {
  interface Window {
    __TAURI__: object;
    /**
     * Android WebView shell. Desktop Electron uses `window.native` instead.
     * Methods are optional so a partial APK still boots the page.
     */
    MuchatNative?: {
      hideSplash(): void;
      startScreenShare?(width: number, height: number, frameRate: number): void;
      stopScreenShare?(): void;
      startVoiceSession?(title: string): void;
      stopVoiceSession?(): void;
      fcmToken?(): string;
    };
    native?: {
      showIncomingCall?: () => void;
      [key: string]: unknown;
    };
    __muchatPendingIncoming?: { action: string; channelId?: string };
    __muchatIncomingCall?: (
      action: string,
      channelId?: string,
      callerId?: string,
      callerName?: string,
    ) => void;
    __muchatVoiceCommand?: (command: string) => void;
    __muchatFcmToken?: (token: string) => void;
    /** Installed by the Android getDisplayMedia polyfill while a share is live. */
    __muchatScreenShare?: (event: string, payload?: string | null) => void;
  }
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      dndzone: SolidOptions;

      scrollable:
        | true
        | {
            /**
             * Colour customisation
             */
            palette?: "default" | "settings";

            /**
             * Scroll direction
             */
            direction?: "x" | "y";

            /**
             * Offset to apply to top of scroll container
             */
            offsetTop?: number;

            /**
             * Whether to only show scrollbar on hover
             */
            showOnHover?: boolean;

            /**
             * Pass-through class names
             */
            class?: string;
          };
      invisibleScrollable:
        | true
        | {
            /**
             * Scroll direction
             */
            direction?: "x" | "y";

            /**
             * Pass-through class names
             */
            class?: string;
          };
      floating: {
        tooltip?: {
          /**
           * Where the tooltip should be placed
           */
          placement: Placement;
        } & (
          | {
              /**
               * Tooltip content
               */
              content: Component;

              /**
               * Aria label fallback
               */
              aria: string;
            }
          | {
              /**
               * Tooltip content
               */
              content: string | undefined;

              /**
               * Content is used as aria fallback
               */
              aria?: undefined;
            }
        );
        userCard?: {
          /**
           * User to display
           */
          user: User;

          /**
           * Member to display
           */
          member?: ServerMember;

          /**
           * Bot to display
           */
          bot?: { owner: string };
        };
        contextMenu?: Component;
        contextMenuHandler?: "click" | "contextmenu";
        autoComplete?: {
          state: Accessor<AutoCompleteState>;
          selection: Accessor<number>;
          setSelection: Setter<number>;
          select: (index: number) => void;
        };
      };
      autoComplete:
        | true
        | {
            client?: Client;
            onKeyDown?: (
              event: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
            ) => void;
            searchSpace?: {
              users?: User[];
              members?: ServerMember[];
              channels?: Channel[];
              roles?: ServerRole[];
            };
          };
    }
  }
}
