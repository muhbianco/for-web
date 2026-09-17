/**
 * Contract with the Muchat `study-bot` (see muchat/study-bot/protocol.py).
 *
 * A protected message starts with an invisible marker:
 *
 *     \u2063study:<challenge_id>:<q>\u2063\n<body>
 *
 * `q` is `u` (menu), `p` (birth date), `m` (reading material), `k` (reread),
 * `1`..`9` (question) or `r` (result). Questions also carry the input kind:
 * `\u2063study:<id>:<q>:<mc|text|blank|order|tf>\u2063`.
 *
 * The last reading chunk also contains `\u2063go\u2063` in the body: only that
 * message shows the Start-questions button. Intermediate `m` chunks stay
 * protected on older apps, without the button.
 *
 * Only the Electron desktop shell renders the body; browsers and the Android
 * WebView show a notice instead. Commands the bot accepts:
 *
 *     study:start:desktop                          start today's challenge
 *     study:reread:desktop                         reread the story
 *     study:profile:desktop:YYYY-MM-DD             birth date from the menus
 *     study:<id>:<q>:<A-D>:<desktop|web>           multiple choice answer
 *     study:<id>:<q>:T:<desktop|web>:<text>        typed answer
 */

export const STUDY_MARK = "\u2063";
export const STUDY_GO = `${STUDY_MARK}go${STUDY_MARK}`;
export const STUDY_LETTERS = ["A", "B", "C", "D"] as const;
export const STUDY_DOWNLOAD_URL = "https://chat.muhbianco.com.br/download";
export const STUDY_MAX_TYPED = 1200;

export type StudyKind = "mc" | "text" | "blank" | "order" | "tf";

const RE_STUDY = new RegExp(
  `^${STUDY_MARK}study:([A-Za-z0-9_-]{6,48}):(u|m|k|p|[1-9]|r)(?::(mc|text|blank|order|tf))?${STUDY_MARK}\\r?\\n?([\\s\\S]*)$`,
);

export type StudyMessage = {
  challengeId: string;
  /** `u`, `p`, `m`, `k`, `1`..`9` or `r` */
  q: string;
  /** input kind for questions; `mc` when the bot did not say */
  kind: StudyKind;
  body: string;
};

export function parseStudyMessage(
  content: string | null | undefined,
): StudyMessage | null {
  if (!content) return null;
  const match = RE_STUDY.exec(content);
  if (!match) return null;
  return {
    challengeId: match[1],
    q: match[2],
    kind: (match[3] as StudyKind | undefined) ?? "mc",
    body: match[4],
  };
}

export function isStudyQuestion(study: StudyMessage): boolean {
  return /^[1-9]$/.test(study.q);
}

export function isStudyTyped(study: StudyMessage): boolean {
  return isStudyQuestion(study) && study.kind !== "mc";
}

export const STUDY_TYPED_HINTS: Record<Exclude<StudyKind, "mc">, string> = {
  text: "Escreva sua resposta com suas palavras (1 a 3 frases)",
  blank: "Digite só a palavra que falta",
  order: "Digite as letras na ordem certa, ex: C A D B",
  tf: "Digite V ou F para cada frase, ex: V F V F",
};

export function studyTypedContent(
  study: StudyMessage,
  text: string,
  client: "desktop" | "web",
): string {
  const clean = text.replace(/\r\n/g, "\n").trim().slice(0, STUDY_MAX_TYPED);
  return `study:${study.challengeId}:${study.q}:T:${client}:${clean}`;
}

export function isStudyMenu(study: StudyMessage): boolean {
  return study.q === "u";
}

export function isStudyProfile(study: StudyMessage): boolean {
  return study.q === "p";
}

export function isStudyReading(study: StudyMessage): boolean {
  return study.q === "m";
}

export function isStudyReread(study: StudyMessage): boolean {
  return study.q === "k";
}

export function hasStudyGo(body: string): boolean {
  return body.includes(STUDY_GO);
}

export function stripStudyGo(body: string): string {
  return body.split(STUDY_GO).join("").trimEnd();
}

export function isStudyReadingStart(study: StudyMessage): boolean {
  return isStudyReading(study) && hasStudyGo(study.body);
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

export function studyRereadContent(client: "desktop" | "web"): string {
  return `study:reread:${client}`;
}

export function studyProfileContent(
  isoDate: string,
  client: "desktop" | "web",
): string {
  return `study:profile:${client}:${isoDate}`;
}

/**
 * Electron shell that can black out screenshots. PC browsers cannot, and
 * older Muchat `.exe` builds expose `window.native` without
 * `setContentProtection`, so they are treated like phones: no content.
 */
export function isStudyDesktopClient(
  win: Pick<Window, "native"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return typeof win?.native?.setContentProtection === "function";
}

/** Installed desktop shell that still cannot black out a study challenge. */
export function isStaleStudyDesktopShell(
  win: Pick<Window, "native"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return Boolean(win?.native) && !isStudyDesktopClient(win);
}

export function studyClientTag(
  win: Pick<Window, "native"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): "desktop" | "web" {
  return isStudyDesktopClient(win) ? "desktop" : "web";
}
