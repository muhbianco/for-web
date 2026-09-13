import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDY_MARK,
  isStudyMobileClient,
  isStudyQuestion,
  parseStudyMessage,
  studyAnswerContent,
  studyClientTag,
} from "./studyProtocol.ts";

const ID = "2026-09-14-daily";

test("parses the bot marker and strips it from the body", () => {
  const parsed = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:3${STUDY_MARK}\n**Pergunta 3**\nTexto`,
  );
  assert.deepEqual(parsed, {
    challengeId: ID,
    q: "3",
    body: "**Pergunta 3**\nTexto",
  });
  assert.equal(isStudyQuestion(parsed!), true);
  assert.equal(
    isStudyQuestion(
      parseStudyMessage(`${STUDY_MARK}study:${ID}:m${STUDY_MARK}\nOlá`)!,
    ),
    false,
  );
});

test("ignores ordinary messages and forged markers", () => {
  assert.equal(parseStudyMessage("study:abc:1"), null);
  assert.equal(
    parseStudyMessage(`${STUDY_MARK}study:${ID}:9${STUDY_MARK}\nx`),
    null,
  );
  assert.equal(
    parseStudyMessage(`oi ${STUDY_MARK}study:${ID}:1${STUDY_MARK}`),
    null,
  );
  assert.equal(parseStudyMessage(""), null);
  assert.equal(parseStudyMessage(undefined), null);
});

test("answer content matches what the bot accepts", () => {
  const study = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:2${STUDY_MARK}\nx`,
  )!;
  assert.equal(
    studyAnswerContent(study, "C", "desktop"),
    `study:${ID}:2:C:desktop`,
  );
  assert.match(
    studyAnswerContent(study, "A", "web"),
    /^study:[A-Za-z0-9_-]{6,48}:[1-5]:[A-D]:(desktop|web)$/,
  );
});

test("phones are refused, desktop and PC browsers allowed", () => {
  assert.equal(
    isStudyMobileClient(
      { MuchatNative: { hideSplash() {} } },
      "Mozilla/5.0 (Linux; Android 14) Muchat/1.2",
    ),
    true,
  );
  assert.equal(
    isStudyMobileClient(
      {},
      "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile",
    ),
    true,
  );
  assert.equal(
    isStudyMobileClient({}, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"),
    true,
  );
  assert.equal(
    isStudyMobileClient(
      {},
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    ),
    false,
  );
  assert.equal(
    isStudyMobileClient(
      { native: {} as Window["native"] },
      "Mozilla/5.0 (Windows NT 10.0) Electron/33",
    ),
    false,
  );
  assert.equal(isStudyMobileClient(undefined, ""), false);
});

test("client tag distinguishes the Electron shell", () => {
  assert.equal(studyClientTag({ native: {} as Window["native"] }), "desktop");
  assert.equal(studyClientTag({}), "web");
  assert.equal(studyClientTag(undefined), "web");
});
