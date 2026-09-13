/**
 * Contract with the Muchat `study-bot` (see muchat/study-bot/protocol.py).
 *
 * A protected message starts with an invisible marker:
 *
 *     \u2063study:<challenge_id>:<q>\u2063\n<body>
 *
 * `q` is `u` (menu), `m` (reading material), `1`..`9` (question) or `r`
 * (result). Only the Electron desktop shell renders the body; browsers and
 * the Android WebView show a notice instead. Commands the bot accepts:
 *
 *     study:start:desktop                          start today's challenge
 *     study:<id>:<q>:<A-D>:<desktop|web>           answer a question
 */

export const STUDY_MARK = "\u2063";
export const STUDY_LETTERS = ["A", "B", "C", "D"] as const;
export const STUDY_DOWNLOAD_URL = "https://chat.muhbianco.com.br/download";

const RE_STUDY = new RegExp(
  `^${STUDY_MARK}study:([A-Za-z0-9_-]{6,48}):(u|m|[1-9]|r)${STUDY_MARK}\\r?\\n?([\\s\\S]*)$`,
);

export type StudyMessage = {
  challengeId: string;
  /** `u`, `m`, `1`..`9` or `r` */
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
  return /^[1-9]$/.test(study.q);
}

export function isStudyMenu(study: StudyMessage): boolean {
  return study.q === "u";
}

export function studyAnswerContent(
  study: StudyMessage,
  letter: string,
  client: "desktop" | "web",
): string {
  return `study:${study.challengeId}:${study.q}:${letter}:${client}`;
}

export function studyStartContent(client: "desktop" | "web"): string {
  return `study:start:${client}`;
}

/**
 * Only the Electron shell counts as desktop. PC browsers cannot black out
 * screenshots, so they are treated like phones: no content, no buttons.
 */
export function isStudyDesktopClient(
  win: Pick<Window, "native"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return Boolean(win?.native);
}

export function studyClientTag(
  win: Pick<Window, "native"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): "desktop" | "web" {
  return isStudyDesktopClient(win) ? "desktop" : "web";
}
