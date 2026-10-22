import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStudyClock,
  orderAnswer,
  splitStudyChoices,
  studyMissingHint,
  studyQuestionSeconds,
  studySecondsLeft,
  tfAnswer,
  toggleOrderLetter,
  typedAnswer,
} from "./studyAnswer.ts";

// Same shape as muchat/study-bot/content.py `format_question`.
const TF_BODY = [
  "**Pergunta 6 de 8** — Verdadeiro ou falso (450s)",
  "",
  "Marque V ou F para cada frase:",
  "",
  "**A)** O barco saiu cedo.",
  "**B)** Choveu a viagem toda.",
  "**C)** Iara viu um boto.",
  "**D)** Eles voltaram a pé.",
  "",
  "Marque Verdadeiro ou Falso em cada frase e envie.",
  "Se quiser ler o texto de novo, use **Reler história**.",
].join("\n");

test("lifts the four choices out of the body", () => {
  const { choices, rest } = splitStudyChoices(TF_BODY);
  assert.deepEqual(
    choices.map((choice) => choice.letter),
    ["A", "B", "C", "D"],
  );
  assert.equal(choices[2].text, "Iara viu um boto.");
  assert.ok(!rest.includes("**A)**"));
  assert.ok(rest.includes("Marque V ou F para cada frase:"));
  assert.ok(rest.includes("Reler história"));
  assert.ok(!/\n{3,}/.test(rest));
});

test("anything but A–D in order keeps the body as text", () => {
  const three = TF_BODY.replace("**D)** Eles voltaram a pé.\n", "");
  assert.deepEqual(splitStudyChoices(three), { choices: [], rest: three });
  const shuffled = TF_BODY.replace("**A)**", "**B)**");
  assert.equal(splitStudyChoices(shuffled).choices.length, 0);
  assert.equal(splitStudyChoices("Pergunta sem opções").choices.length, 0);
});

test("question clock", () => {
  assert.equal(studyQuestionSeconds(TF_BODY), 450);
  assert.equal(studyQuestionSeconds("sem tempo"), null);
  assert.equal(studySecondsLeft(450, 1_000, 1_000), 450);
  assert.equal(studySecondsLeft(450, 1_000, 11_500), 440);
  assert.equal(studySecondsLeft(10, 0, 60_000), 0);
  assert.equal(formatStudyClock(225), "3:45");
  assert.equal(formatStudyClock(9), "0:09");
  assert.equal(formatStudyClock(-3), "0:00");
});

test("order answer needs all four letters, once each", () => {
  let seq: string[] = [];
  for (const letter of ["C", "A", "D"]) seq = toggleOrderLetter(seq, letter);
  assert.equal(orderAnswer(seq), null);
  assert.equal(
    studyMissingHint("order", { sequence: seq }),
    "Falta 1 acontecimento.",
  );
  seq = toggleOrderLetter(seq, "B");
  assert.equal(orderAnswer(seq), "C A D B");
  assert.equal(studyMissingHint("order", { sequence: seq }), null);
  // tapping a placed item takes it out; the rest keep their order
  seq = toggleOrderLetter(seq, "A");
  assert.deepEqual(seq, ["C", "D", "B"]);
  assert.equal(orderAnswer(seq), null);
  // a fifth tap never overflows
  assert.deepEqual(toggleOrderLetter(["A", "B", "C", "D"], "E"), [
    "A",
    "B",
    "C",
    "D",
  ]);
  assert.equal(orderAnswer(["A", "A", "B", "C"]), null);
  assert.equal(orderAnswer(["A", "B", "C", "E"]), null);
});

test("true/false answer needs every statement marked", () => {
  assert.equal(tfAnswer(["V", "F", null, "F"]), null);
  assert.equal(
    studyMissingHint("tf", { marks: ["V", null, null, "F"] }),
    "Faltam marcar 2 frases.",
  );
  assert.equal(tfAnswer(["V", "F", "V", "F"]), "V F V F");
  assert.equal(tfAnswer(["V", "F", "V"]), null);
  assert.equal(studyMissingHint("tf", { marks: ["V", "F", "V", "F"] }), null);
});

test("typed and multiple choice", () => {
  assert.equal(typedAnswer("   "), null);
  assert.equal(typedAnswer(" rio \r\n"), "rio");
  assert.equal(
    studyMissingHint("blank", { typed: "" }),
    "Escreva sua resposta.",
  );
  assert.equal(studyMissingHint("text", { typed: "porque sim" }), null);
  assert.equal(studyMissingHint("mc", { choice: null }), "Escolha uma opção.");
  assert.equal(studyMissingHint("mc", { choice: "B" }), null);
});
