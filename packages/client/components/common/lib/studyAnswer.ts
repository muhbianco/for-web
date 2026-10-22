/**
 * Answer building for study questions (see StudyAnswer.tsx). Pure, no imports:
 * runs under `node --test` next to studyProtocol.test.ts.
 *
 * The bot lists the choices of `mc`, `order` and `tf` as `**A)** text` lines
 * (muchat/study-bot/content.py `format_question`). The client lifts them out
 * of the body and renders them as controls, so the answer is built by tapping,
 * never typed: an `order` or `tf` answer cannot leave with a letter missing.
 */

export type StudyChoice = { letter: string; text: string };
export type StudyMark = "V" | "F";

export const STUDY_CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

/** Time the second step waits before it accepts a press (double-tap guard). */
export const STUDY_CONFIRM_ARM_MS = 800;

/** Below this many seconds the question clock turns into a warning. */
export const STUDY_CLOCK_WARN_SECONDS = 30;

const RE_CHOICE = /^\*\*([A-D])\)\*\*\s*(.*)$/;
const RE_SECONDS = /\((\d{1,4})s\)/;

/**
 * Choices A–D in order plus the body without them. Anything other than exactly
 * A, B, C, D (in that order) returns no choices and the body untouched, so a
 * format change in the bot degrades to the plain text instead of a wrong UI.
 */
export function splitStudyChoices(body: string): {
  choices: StudyChoice[];
  rest: string;
} {
  const lines = body.split("\n");
  const choices: StudyChoice[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    const match = RE_CHOICE.exec(line.trim());
    if (match) {
      choices.push({ letter: match[1], text: match[2].trim() });
    } else {
      kept.push(line);
    }
  }
  const letters = choices.map((choice) => choice.letter).join("");
  if (letters !== STUDY_CHOICE_LETTERS.join("")) {
    return { choices: [], rest: body };
  }
  const rest = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { choices, rest };
}

/** Seconds the bot gave this question (`(225s)` in the header), or null. */
export function studyQuestionSeconds(body: string): number | null {
  const match = RE_SECONDS.exec(body);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function studySecondsLeft(
  totalSeconds: number,
  sentAtMs: number,
  nowMs: number,
): number {
  return Math.max(0, Math.ceil(totalSeconds - (nowMs - sentAtMs) / 1000));
}

export function formatStudyClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

/** Tap on an `order` item: append it, or take it out if already placed. */
export function toggleOrderLetter(
  sequence: string[],
  letter: string,
): string[] {
  if (sequence.includes(letter)) {
    return sequence.filter((item) => item !== letter);
  }
  if (sequence.length >= STUDY_CHOICE_LETTERS.length) return sequence;
  return [...sequence, letter];
}

/** `C A D B` once all four letters are placed, each once; otherwise null. */
export function orderAnswer(sequence: string[]): string | null {
  const valid =
    sequence.length === STUDY_CHOICE_LETTERS.length &&
    new Set(sequence).size === sequence.length &&
    sequence.every((letter) =>
      (STUDY_CHOICE_LETTERS as readonly string[]).includes(letter),
    );
  return valid ? sequence.join(" ") : null;
}

/** `V F V F` once every statement is marked; otherwise null. */
export function tfAnswer(marks: (StudyMark | null)[]): string | null {
  if (marks.length !== STUDY_CHOICE_LETTERS.length) return null;
  if (marks.some((mark) => mark !== "V" && mark !== "F")) return null;
  return marks.join(" ");
}

/** Typed answers (`blank`, `text`): trimmed, or null when empty. */
export function typedAnswer(value: string): string | null {
  const clean = value.replace(/\r\n/g, "\n").trim();
  return clean ? clean : null;
}

/** What is still missing, for the hint under the controls; null when ready. */
export function studyMissingHint(
  kind: "mc" | "text" | "blank" | "order" | "tf",
  state: {
    choice?: string | null;
    sequence?: string[];
    marks?: (StudyMark | null)[];
    typed?: string;
  },
): string | null {
  switch (kind) {
    case "mc":
      return state.choice ? null : "Escolha uma opção.";
    case "order": {
      const left = STUDY_CHOICE_LETTERS.length - (state.sequence?.length ?? 0);
      if (left <= 0) return null;
      return left === 1
        ? "Falta 1 acontecimento."
        : `Faltam ${left} acontecimentos.`;
    }
    case "tf": {
      const left = (state.marks ?? []).filter((mark) => !mark).length;
      if (left <= 0) return null;
      return left === 1
        ? "Falta marcar 1 frase."
        : `Faltam marcar ${left} frases.`;
    }
    default:
      return typedAnswer(state.typed ?? "") ? null : "Escreva sua resposta.";
  }
}
