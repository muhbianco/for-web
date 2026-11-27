import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Regra zero da voz para o código do jogo (docs/espaco ADR 0009, decisão 10):
 * nada nas pastas do jogo cria áudio, mexe em captura ou importa a chamada.
 * O ESLint do app cobre `client/components/space/game`; esta varredura cobre
 * também os pacotes `space-*`, que o ESLint do CI não lê, e roda nos testes do
 * space-core (portão do CI).
 */
export const GAME_DIRS = [
  "packages/space-core/src/game",
  "packages/space-server/src/game",
  "packages/space-client/src/game",
  "packages/client/components/space/game",
  // O chat do Espaço (balões sobre os avatares, 27/11/2026): a mesma regra, balão não faz som.
  "packages/space-client/src/chat",
  "packages/client/components/space/chat",
];

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\b(?:webkit|Offline)?AudioContext\b/, why: "contexto de áudio" },
  { re: /\b[aA]udioWorklet\w*/, why: "worklet de áudio" },
  { re: /\bnew\s+Audio\s*\(/, why: "elemento de áudio" },
  { re: /\bHTMLAudioElement\b|<audio\b/, why: "elemento de áudio" },
  { re: /\bgetUserMedia\b|\bmediaDevices\b/, why: "captura de mídia" },
  { re: /["']livekit-client["']|["']@livekit\//, why: "cliente da chamada" },
  { re: /components\/rtc\b|["'](?:\.\.\/)+rtc\//, why: "cadeia de áudio do app" },
];

export interface AudioUse {
  file: string;
  line: number;
  why: string;
  text: string;
}

/** Usos proibidos num código-fonte (linha a linha). */
export function findAudioUses(source: string, file = "<fonte>"): AudioUse[] {
  const out: AudioUse[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    for (const f of FORBIDDEN) if (f.re.test(text)) out.push({ file, line: i + 1, why: f.why, text: text.trim() });
  });
  return out;
}

/** Varre as pastas do jogo a partir da raiz do repositório (as que ainda não existem são puladas). */
export function scanGameDirs(root: string, dirs: readonly string[] = GAME_DIRS): AudioUse[] {
  const out: AudioUse[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) out.push(...findAudioUses(readFileSync(p, "utf8"), relative(root, p)));
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out;
}
