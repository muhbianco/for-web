import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { findAudioUses, scanGameDirs } from "./voiceGuard.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

test("voz: nenhuma pasta do jogo usa áudio, captura ou a chamada", () => {
  const uses = scanGameDirs(ROOT);
  assert.deepEqual(
    uses.map((u) => `${u.file}:${u.line} (${u.why}) ${u.text}`),
    [],
    "o jogo não toca a cadeia de áudio (ADR 0009, decisão 10)",
  );
});

test("voz: a varredura reprova cada uso proibido", () => {
  const bad = [
    "const ctx = new AudioContext();",
    "const w = window.webkitAudioContext;",
    "await ctx.audioWorklet.addModule(url); const n = new AudioWorkletNode(ctx, 'x');",
    "const a = new Audio('/ding.mp3');",
    "const el: HTMLAudioElement = document.createElement('audio');",
    "navigator.mediaDevices.getUserMedia({ audio: true });",
    'import { Room } from "livekit-client";',
    'import { useVoice } from "../../rtc/state";',
    'import x from "@/components/rtc/VoiceProcessor";',
  ];
  for (const src of bad) assert.ok(findAudioUses(src).length > 0, src);
  // Texto comum do jogo não dispara.
  for (const src of ["const audience = 3;", "// sem som no jogo", "export const AUDIO_FREE = true;"]) {
    assert.deepEqual(findAudioUses(src), [], src);
  }
});

test("voz: a varredura acha o arquivo dentro de uma pasta do jogo", () => {
  const root = mkdtempSync(join(tmpdir(), "voice-guard-"));
  try {
    mkdirSync(join(root, "packages/space-client/src/game/scene"), { recursive: true });
    writeFileSync(join(root, "packages/space-client/src/game/scene/ok.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "packages/space-client/src/game/scene/bad.ts"), "export const x = 1;\nconst c = new AudioContext();\n");
    const uses = scanGameDirs(root);
    assert.equal(uses.length, 1);
    assert.equal(uses[0]!.line, 2);
    assert.match(uses[0]!.file.replace(/\\/g, "/"), /space-client\/src\/game\/scene\/bad\.ts$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
