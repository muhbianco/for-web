import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDY_MARK,
  isStudyDesktopClient,
  isStudyMenu,
  isStudyQuestion,
  isStudyTyped,
  parseStudyMessage,
  studyAnswerContent,
  studyClientTag,
  studyStartContent,
  studyTypedContent,
} from "./studyProtocol.ts";

const ID = "2026-09-14-daily";

test("parses the bot marker and strips it from the body", () => {
  const parsed = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:3${STUDY_MARK}\n**Pergunta 3**\nTexto`,
  );
  assert.deepEqual(parsed, {
    challengeId: ID,
    q: "3",
    kind: "mc",
    body: "**Pergunta 3**\nTexto",
  });
  assert.equal(isStudyQuestion(parsed!), true);
  assert.equal(isStudyTyped(parsed!), false);
  const blank = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:4:blank${STUDY_MARK}\nO rio ____.`,
  )!;
  assert.equal(blank.kind, "blank");
  assert.equal(blank.body, "O rio ____.");
  assert.equal(isStudyTyped(blank), true);
  assert.equal(
    parseStudyMessage(`${STUDY_MARK}study:${ID}:4:poem${STUDY_MARK}\nx`),
    null,
  );
  const material = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:m${STUDY_MARK}\nOlá`,
  )!;
  assert.equal(isStudyQuestion(material), false);
  assert.equal(isStudyMenu(material), false);
  const menu = parseStudyMessage(
    `${STUDY_MARK}study:menu00:u${STUDY_MARK}\nOi!`,
  )!;
  assert.equal(isStudyMenu(menu), true);
  assert.equal(
    isStudyQuestion(
      parseStudyMessage(`${STUDY_MARK}study:${ID}:8${STUDY_MARK}\nx`)!,
    ),
    true,
  );
});

test("ignores ordinary messages and forged markers", () => {
  assert.equal(parseStudyMessage("study:abc:1"), null);
  assert.equal(
    parseStudyMessage(`${STUDY_MARK}study:${ID}:0${STUDY_MARK}\nx`),
    null,
  );
  assert.equal(
    parseStudyMessage(`oi ${STUDY_MARK}study:${ID}:1${STUDY_MARK}`),
    null,
  );
  assert.equal(parseStudyMessage(""), null);
  assert.equal(parseStudyMessage(undefined), null);
});

test("commands match what the bot accepts", () => {
  const study = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:2${STUDY_MARK}\nx`,
  )!;
  assert.equal(
    studyAnswerContent(study, "C", "desktop"),
    `study:${ID}:2:C:desktop`,
  );
  assert.match(
    studyAnswerContent(study, "A", "web"),
    /^study:[A-Za-z0-9_-]{6,48}:[1-9]:[A-D]:(desktop|web)$/,
  );
  assert.equal(studyStartContent("desktop"), "study:start:desktop");
  assert.equal(
    studyTypedContent(study, "  V F V F\r\n", "desktop"),
    `study:${ID}:2:T:desktop:V F V F`,
  );
  assert.equal(
    studyTypedContent(study, "x".repeat(2000), "web").length,
    `study:${ID}:2:T:web:`.length + 1200,
  );
});

test("only the Electron shell is a desktop client", () => {
  assert.equal(isStudyDesktopClient({ native: {} as Window["native"] }), true);
  assert.equal(isStudyDesktopClient({}), false);
  assert.equal(isStudyDesktopClient(undefined), false);
  assert.equal(studyClientTag({ native: {} as Window["native"] }), "desktop");
  assert.equal(studyClientTag({}), "web");
});
