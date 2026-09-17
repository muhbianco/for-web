import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDY_GO,
  STUDY_MARK,
  hasStudyGo,
  isStudyDesktopClient,
  isStudyAndroidClient,
  isStudyProtectedClient,
  isStaleStudyAndroidShell,
  isStaleStudyDesktopShell,
  isStudyMenu,
  isStudyReading,
  isStudyReadingStart,
  isStudyReread,
  isStudyQuestion,
  isStudyTyped,
  parseStudyMessage,
  stripStudyGo,
  studyAnswerContent,
  studyClientTag,
  studyRereadContent,
  studyStartContent,
  studyTypedContent,
  isStudyProfile,
  studyProfileContent,
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
  const reread = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:k${STUDY_MARK}\nTrecho`,
  )!;
  assert.equal(isStudyReread(reread), true);
  assert.equal(isStudyReading(reread), false);
  const last = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:m${STUDY_MARK}\nFim\n${STUDY_GO}`,
  )!;
  assert.equal(isStudyReadingStart(last), true);
  assert.equal(hasStudyGo(last.body), true);
  assert.equal(stripStudyGo(last.body).includes(STUDY_GO), false);
  const mid = parseStudyMessage(
    `${STUDY_MARK}study:${ID}:m${STUDY_MARK}\nMeio`,
  )!;
  assert.equal(isStudyReadingStart(mid), false);
  const menu = parseStudyMessage(
    `${STUDY_MARK}study:menu00:u${STUDY_MARK}\nOi!`,
  )!;
  assert.equal(isStudyMenu(menu), true);
  assert.equal(isStudyReading(menu), false);
  const profile = parseStudyMessage(
    `${STUDY_MARK}study:menu00:p${STUDY_MARK}\nNasceu quando?`,
  )!;
  assert.equal(isStudyProfile(profile), true);
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
    /^study:[A-Za-z0-9_-]{6,48}:[1-9]:[A-D]:(desktop|web|android)$/,
  );
  assert.equal(studyStartContent("desktop"), "study:start:desktop");
  assert.equal(studyStartContent("android"), "study:start:android");
  assert.equal(studyRereadContent("desktop"), "study:reread:desktop");
  assert.equal(studyRereadContent("android"), "study:reread:android");
  assert.equal(
    studyProfileContent("1988-11-27", "desktop"),
    "study:profile:desktop:1988-11-27",
  );
  assert.equal(
    studyProfileContent("1988-11-27", "android"),
    "study:profile:android:1988-11-27",
  );
  assert.equal(
    studyTypedContent(study, "  V F V F\r\n", "desktop"),
    `study:${ID}:2:T:desktop:V F V F`,
  );
  assert.equal(
    studyTypedContent(study, "x".repeat(2000), "web").length,
    `study:${ID}:2:T:web:`.length + 1200,
  );
});

test("trusted shells are Electron with setContentProtection or the APK", () => {
  const protectedNative = {
    native: { setContentProtection() {} } as Window["native"],
  };
  const staleNative = { native: {} as Window["native"] };
  const apk = {
    MuchatNative: {
      hideSplash() {},
      setContentProtection() {},
    },
  };
  const staleApk = {
    MuchatNative: {
      hideSplash() {},
    },
  };
  assert.equal(isStudyDesktopClient(protectedNative), true);
  assert.equal(isStudyDesktopClient(staleNative), false);
  assert.equal(isStaleStudyDesktopShell(staleNative), true);
  assert.equal(isStaleStudyDesktopShell(protectedNative), false);
  assert.equal(isStudyDesktopClient({}), false);
  assert.equal(isStudyDesktopClient(undefined), false);
  assert.equal(studyClientTag(protectedNative), "desktop");
  assert.equal(studyClientTag(staleNative), "web");
  assert.equal(studyClientTag({}), "web");
  assert.equal(isStudyAndroidClient(apk), true);
  assert.equal(isStudyAndroidClient(staleApk), false);
  assert.equal(isStudyProtectedClient(apk), true);
  assert.equal(isStudyProtectedClient(protectedNative), true);
  assert.equal(isStudyProtectedClient(staleApk), false);
  assert.equal(isStaleStudyAndroidShell(staleApk), true);
  assert.equal(isStaleStudyAndroidShell(apk), false);
  assert.equal(studyClientTag(apk), "android");
  assert.equal(studyClientTag(staleApk), "web");
});
