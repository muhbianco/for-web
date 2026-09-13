/**
 * Contract with the Muchat `study-bot` (see muchat/study-bot/protocol.py).
 *
 * A protected message starts with an invisible marker:
 *
 *     \u2063study:<challenge_id>:<q>\u2063\n<body>
 *
 * `q` is `m` (reading material), `1`..`5` (question) or `r` (result).
 * Answers only count when sent as `study:<id>:<q>:<A-D>:<desktop|web>`,
 * which only the protected UI produces — loose text and phones are refused.
 */

export const STUDY_MARK = "\u2063";
export const STUDY_LETTERS = ["A", "B", "C", "D"] as const;

const RE_STUDY = new RegExp(
  `^${STUDY_MARK}study:([A-Za-z0-9_-]{6,48}):(m|[1-5]|r)${STUDY_MARK}\\r?\\n?([\\s\\S]*)$`,
);

export type StudyMessage = {
  challengeId: string;
  /** `m`, `1`..`5` or `r` */
  q: string;
  body: string;
};

export function parseStudyMessage(
  content: string | null | undefined,
): StudyMessage | null {
  if (!content) return null;
  const match = RE_STUDY.exec(content);
  if (!match) return null;
  return { challengeId: match[1], q: match[2], body: match[3] };
}

export function isStudyQuestion(study: StudyMessage): boolean {
  return /^[1-5]$/.test(study.q);
}

export function studyAnswerContent(
  study: StudyMessage,
  letter: string,
  client: "desktop" | "web",
): string {
  return `study:${study.challengeId}:${study.q}:${letter}:${client}`;
}

/**
 * Phones are out for now: no content protection there. The Android WebView
 * exposes `MuchatNative` and tags its UA with `Muchat/`; browsers on phones
 * are caught by the UA family.
 */
export function isStudyMobileClient(
  win: Pick<Window, "MuchatNative" | "native"> | undefined = typeof window ===
  "undefined"
    ? undefined
    : window,
  userAgent: string = typeof navigator === "undefined"
    ? ""
    : navigator.userAgent,
): boolean {
  if (!win) return false;
  if (win.MuchatNative) return true;
  if (win.native) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function studyClientTag(
  win: Pick<Window, "native"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): "desktop" | "web" {
  return win?.native ? "desktop" : "web";
}
