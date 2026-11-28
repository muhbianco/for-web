import assert from "node:assert/strict";
import test from "node:test";

import { showsSpaceTts } from "./voiceUser.ts";

// O bloco da voz do TTS no menu de uma pessoa (28/11/2026).

const space = (id: string) => id === "alopa";
const other = { self: false, bot: false, screenshare: false };

test("na sala do Espaço na barra lateral, sem membro carregado e fora da chamada, o bloco aparece", () => {
  // O caso do dono: a pessoa está no Dojô (sala do mapa), o Stoat não sabe da chamada, o membro não carregou.
  assert.equal(showsSpaceTts(other, { serverId: "alopa" }, space), true);
  // Antes da correção o menu só tinha o membro e a chamada: nenhum dos dois, nada de bloco.
  assert.equal(showsSpaceTts(other, {}, space), false);
});

test("o servidor do membro ou da chamada também serve; o de quem abriu vem primeiro", () => {
  assert.equal(showsSpaceTts(other, { memberServerId: "alopa" }, space), true);
  assert.equal(showsSpaceTts(other, { voiceServerId: "alopa" }, space), true);
  assert.equal(
    showsSpaceTts(other, { serverId: "outro", memberServerId: "alopa" }, space),
    false,
  );
});

test("você, um bot e a tela compartilhada não têm o bloco", () => {
  for (const who of [
    { ...other, self: true },
    { ...other, bot: true },
    { ...other, screenshare: true },
  ])
    assert.equal(showsSpaceTts(who, { serverId: "alopa" }, space), false);
});
