import { Show, createSignal, onMount } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import { CategoryButton, Checkbox, Column } from "@revolt/ui";
import { DesktopUpdateSection } from "@revolt/ui/components/features/desktop/DesktopUpdate";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

declare type DesktopConfig = {
  firstLaunch: boolean;
  customFrame: boolean;
  minimiseToTray: boolean;
  startMinimisedToTray: boolean;
  spellchecker: boolean;
  hardwareAcceleration: boolean;
  discordRpc: boolean;
  windowState: {
    isMaximised: boolean;
  };
};

/** Used when the shell does not expose desktopConfig at all. */
export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  firstLaunch: false,
  customFrame: false,
  minimiseToTray: true,
  startMinimisedToTray: false,
  spellchecker: true,
  hardwareAcceleration: false,
  discordRpc: false,
  windowState: { isMaximised: false },
};

/** Update lifecycle reported by the desktop shell's auto updater. */
export type AppUpdatePayload = {
  state: "idle" | "available" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
};

declare global {
  interface Window {
    native?: {
      versions: {
        node(): string;
        chrome(): string;
        electron(): string;
        desktop(): string;
      };
      minimise(): void;
      maximise(): void;
      close(): void;
      /** Screens and windows offered by the shell for its own picker. */
      listScreenSources?(): Promise<
        {
          id: string;
          name: string;
          isFullScreen: boolean;
          thumbnail?: string;
          appIcon?: string;
        }[]
      >;
      /** Pre-select a source so getDisplayMedia resolves without a round trip. */
      armScreenShare?(sourceId: string, audio: boolean): Promise<boolean>;
      splashReady?(): void;
      onLoadProgress?(onProgress: (pct: number, label: string) => void): void;
      onAppUpdate?(onUpdate: (payload: AppUpdatePayload) => void): void;
      getUpdateState?(): Promise<AppUpdatePayload>;
      installAppUpdate?(): void;
      isWayland?(): boolean;
    };

    /**
     * Only the upstream Stoat desktop build ships this; the Muchat shell uses
     * the native window frame and its own tray handling, so treat it as absent.
     */
    desktopConfig?: {
      get(): DesktopConfig;
      set(config: Partial<DesktopConfig>): void;
      getAutostart(): Promise<boolean>;
      setAutostart(value: boolean): Promise<boolean>;
    };
  }
}

/**
 * Desktop Configuration Page
 */
export default function Native() {
  const { t } = useLingui();
  const [autostart, setAutostart] = createSignal(false);
  const desktopConfig = window.desktopConfig;
  const [config, setConfig] = createSignal(
    desktopConfig?.get() ?? DEFAULT_DESKTOP_CONFIG,
  );

  function set(config: Partial<DesktopConfig>) {
    desktopConfig?.set(config);
    setConfig((conf) => ({ ...conf, ...config }));
  }

  onMount(async () => {
    if (!desktopConfig) return;
    const value = await desktopConfig.getAutostart();
    setAutostart(value);
  });

  async function toggleAutostart() {
    if (!desktopConfig) return;
    const newValue = !autostart();
    const savedValue = await desktopConfig.setAutostart(newValue);
    setAutostart(savedValue);
  }

  const toggles: Partial<Record<keyof DesktopConfig, () => void>> = {
    minimiseToTray: () => set({ minimiseToTray: !config().minimiseToTray }),
    startMinimisedToTray: () =>
      set({ startMinimisedToTray: !config().startMinimisedToTray }),
    customFrame: () => set({ customFrame: !config().customFrame }),
    discordRpc: () => set({ discordRpc: !config().discordRpc }),
    spellchecker: () => set({ spellchecker: !config().spellchecker }),
    hardwareAcceleration: () =>
      set({ hardwareAcceleration: !config().hardwareAcceleration }),
  };

  function CheckboxButton<K extends keyof Omit<DesktopConfig, "windowState">>(
    key: K,
    icon: string,
    label: string,
    description: string,
  ) {
    return (
      <CategoryButton
        action={<Checkbox checked={config()[key]} />}
        onClick={toggles[key]}
        icon={<Symbol>{icon}</Symbol>}
        description={description}
      >
        {label}
      </CategoryButton>
    );
  }

  return (
    <Column gap="lg">
      <Show when={desktopConfig}>
        <CategoryButton.Group>
          <CategoryButton
            action={<Checkbox checked={autostart()} />}
            onClick={toggleAutostart}
            icon={<Symbol>exit_to_app</Symbol>}
            description={
              <Trans>Launch Muchat when you log into your computer.</Trans>
            }
          >
            <Trans>Start with Computer</Trans>
          </CategoryButton>
          {autostart() &&
            CheckboxButton(
              "startMinimisedToTray",
              "minimize",
              t`Start Minimised to Tray`,
              t`Muchat will start in the system tray.`,
            )}
          {CheckboxButton(
            "minimiseToTray",
            "cancel_presentation",
            t`Minimise to Tray`,
            t`Instead of closing, Muchat will hide in your tray.`,
          )}
          {CheckboxButton(
            "customFrame",
            "web_asset",
            t`Custom window frame`,
            t`Let Muchat use its own custom titlebar.`,
          )}
        </CategoryButton.Group>

        <CategoryButton.Group>
          {CheckboxButton(
            "spellchecker",
            "spellcheck",
            t`Spellchecker`,
            t`Show corrections and suggestions as you type.`,
          )}
          {CheckboxButton(
            "hardwareAcceleration",
            "speed",
            t`Hardware Acceleration`,
            t`Use the graphics card to improve performance.`,
          )}
        </CategoryButton.Group>
      </Show>

      <DesktopUpdateSection />

      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>desktop_windows</Symbol>}
          description={
            <>
              <Trans>Version:</Trans> {window.native?.versions.desktop() || "?"}{" "}
              · <Trans>Chromium:</Trans>{" "}
              {window.native?.versions.chrome() || "?"}
            </>
          }
        >
          <Trans>Muchat for Desktop</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}
