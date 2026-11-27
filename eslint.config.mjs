import eslint from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";
import solid from "eslint-plugin-solid/configs/typescript";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      // minified files
      "**/i18n/catalogs/**",
      "**/i18n/locales/**",

      // build artifacts
      "**/coverage/**",
      "**/dist/**",
      "**/styled-system/**",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  solid,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          caughtErrors: "all",
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],
      "solid/jsx-no-undef": ["off"],
      "prettier/prettier": ["warn"],
    },
  },
  {
    // Regra zero da voz (docs/espaco ADR 0009, decisão 10): o jogo do Espaço
    // não cria áudio, não captura mídia e não importa a chamada. A varredura
    // do space-core (testing/voiceGuard.ts) cobre também os pacotes space-*.
    // O chat do Espaço (27/11/2026) segue a mesma regra: balão não faz som.
    files: [
      "packages/client/components/space/game/**/*.{ts,tsx}",
      "packages/client/components/space/chat/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["livekit-client", "@livekit/*"], message: "O jogo não fala com a chamada (ADR 0009)." },
            { group: ["**/rtc", "**/rtc/**"], message: "O jogo não importa a cadeia de áudio (ADR 0009)." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...["AudioContext", "webkitAudioContext", "OfflineAudioContext", "AudioWorkletNode", "Audio"].map((name) => ({
          name,
          message: "Sem som no jogo: a cadeia de áudio da voz é intocável (ADR 0009).",
        })),
      ],
      "no-restricted-properties": [
        "error",
        { object: "navigator", property: "mediaDevices", message: "O jogo não captura mídia (ADR 0009)." },
        { object: "window", property: "AudioContext", message: "Sem som no jogo (ADR 0009)." },
        { object: "window", property: "webkitAudioContext", message: "Sem som no jogo (ADR 0009)." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "JSXOpeningElement[name.name='audio']", message: "Sem som no jogo (ADR 0009)." },
      ],
    },
  },
]);
