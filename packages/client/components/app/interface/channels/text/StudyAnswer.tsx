import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import { styled } from "styled-system/jsx";

import {
  STUDY_CHOICE_LETTERS,
  STUDY_CLOCK_WARN_SECONDS,
  STUDY_CONFIRM_ARM_MS,
  StudyChoice,
  StudyMark,
  formatStudyClock,
  orderAnswer,
  studyMissingHint,
  studySecondsLeft,
  tfAnswer,
  toggleOrderLetter,
  typedAnswer,
} from "@revolt/common/lib/studyAnswer";
import { STUDY_MAX_TYPED, StudyKind } from "@revolt/common/lib/studyProtocol";
import { Button } from "@revolt/ui";

type Draft = {
  choice: string | null;
  sequence: string[];
  marks: (StudyMark | null)[];
  typed: string;
};

/**
 * What the child already picked, per question message. The message list
 * unmounts rows that scroll away; without this a half-marked V/F came back
 * empty.
 */
const drafts = new Map<string, Draft>();

function emptyDraft(): Draft {
  return {
    choice: null,
    sequence: [],
    marks: STUDY_CHOICE_LETTERS.map(() => null),
    typed: "",
  };
}

const TYPED_HINTS: Record<"text" | "blank", string> = {
  text: "Escreva com suas palavras (1 a 3 frases)",
  blank: "Digite só a palavra que falta",
};

/**
 * Answer area of one study question.
 *
 * Built so an answer cannot leave by accident or half done:
 * - choices are tapped, never typed (`order` and `tf` can't lose a letter);
 * - "Revisar resposta" stays off until the answer is complete;
 * - sending takes two steps: review shows the answer back, and "Enviar" only
 *   accepts a press {@link STUDY_CONFIRM_ARM_MS} after it appears, so a double
 *   tap on "Revisar" does not send;
 * - the send row sits apart from the controls, behind a divider.
 */
export function StudyAnswer(props: {
  messageId: string;
  kind: StudyKind;
  choices: StudyChoice[];
  totalSeconds: number | null;
  sentAtMs: number;
  locked: boolean;
  lockedLabel: string;
  busy: boolean;
  onSend: (answer: string, summary: string) => void;
}) {
  const saved = drafts.get(props.messageId) ?? emptyDraft();
  const [choice, setChoice] = createSignal<string | null>(saved.choice);
  const [sequence, setSequence] = createSignal<string[]>(saved.sequence);
  const [marks, setMarks] = createSignal<(StudyMark | null)[]>(saved.marks);
  const [typed, setTyped] = createSignal(saved.typed);
  const [reviewing, setReviewing] = createSignal(false);
  const [armed, setArmed] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  createEffect(() => {
    drafts.set(props.messageId, {
      choice: choice(),
      sequence: sequence(),
      marks: marks(),
      typed: typed(),
    });
  });

  const clock = setInterval(() => setNow(Date.now()), 1000);
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearInterval(clock);
    if (armTimer) clearTimeout(armTimer);
  });

  const secondsLeft = createMemo(() =>
    props.totalSeconds === null
      ? null
      : studySecondsLeft(props.totalSeconds, props.sentAtMs, now()),
  );

  const letterText = (letter: string) =>
    props.choices.find((item) => item.letter === letter)?.text ?? "";

  const choiceLabel = (letter: string) => {
    const text = letterText(letter);
    return text ? `${letter}) ${text}` : letter;
  };

  /** Value the bot receives, or null while incomplete. */
  const answer = createMemo<string | null>(() => {
    switch (props.kind) {
      case "mc":
        return choice();
      case "order":
        return orderAnswer(sequence());
      case "tf":
        return tfAnswer(marks());
      default:
        return typedAnswer(typed());
    }
  });

  const missing = createMemo(() =>
    studyMissingHint(props.kind, {
      choice: choice(),
      sequence: sequence(),
      marks: marks(),
      typed: typed(),
    }),
  );

  /** Human version of the answer for the review step. */
  const summary = createMemo(() => {
    const value = answer();
    if (!value) return "";
    switch (props.kind) {
      case "mc":
        return choiceLabel(value);
      case "order":
        return sequence()
          .map((letter, index) => `${index + 1}º ${choiceLabel(letter)}`)
          .join("\n");
      case "tf":
        return marks()
          .map(
            (mark, index) =>
              `${STUDY_CHOICE_LETTERS[index]}: ${mark === "V" ? "Verdadeiro" : "Falso"}`,
          )
          .join("\n");
      default:
        return value;
    }
  });

  const editable = () => !props.locked && !props.busy && !reviewing();

  function review() {
    if (!answer() || props.locked) return;
    setReviewing(true);
    setArmed(false);
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => setArmed(true), STUDY_CONFIRM_ARM_MS);
  }

  function back() {
    if (armTimer) clearTimeout(armTimer);
    setArmed(false);
    setReviewing(false);
  }

  function confirm() {
    const value = answer();
    if (!value || !armed() || props.locked || props.busy) return;
    props.onSend(value, summary());
  }

  function setMark(index: number, mark: StudyMark) {
    if (!editable()) return;
    setMarks((current) =>
      current.map((value, i) => (i === index ? mark : value)),
    );
  }

  return (
    <Area>
      <Show when={!props.locked && secondsLeft() !== null}>
        <Clock
          data-warn={
            (secondsLeft() ?? 0) <= STUDY_CLOCK_WARN_SECONDS ? "" : undefined
          }
          role="timer"
          aria-live="off"
        >
          <Show when={(secondsLeft() ?? 0) > 0} fallback="Tempo esgotado">
            Tempo para responder: {formatStudyClock(secondsLeft() ?? 0)}
          </Show>
        </Clock>
      </Show>

      <Switch>
        <Match when={props.kind === "mc"}>
          <Choices role="radiogroup" aria-label="Opções">
            <For each={[...STUDY_CHOICE_LETTERS]}>
              {(letter) => (
                <Choice
                  type="button"
                  role="radio"
                  aria-checked={choice() === letter}
                  data-selected={choice() === letter ? "" : undefined}
                  disabled={!editable()}
                  onClick={() => editable() && setChoice(letter)}
                >
                  <Badge>{letter}</Badge>
                  <span>{letterText(letter) || `Opção ${letter}`}</span>
                </Choice>
              )}
            </For>
          </Choices>
        </Match>

        <Match when={props.kind === "tf"}>
          <Choices>
            <For each={[...STUDY_CHOICE_LETTERS]}>
              {(letter, index) => (
                <TfRow>
                  <TfText>
                    <Badge>{letter}</Badge>
                    <span>{letterText(letter) || `Frase ${letter}`}</span>
                  </TfText>
                  <Segment role="radiogroup" aria-label={`Frase ${letter}`}>
                    <SegmentButton
                      type="button"
                      role="radio"
                      aria-checked={marks()[index()] === "V"}
                      data-selected={marks()[index()] === "V" ? "" : undefined}
                      disabled={!editable()}
                      onClick={() => setMark(index(), "V")}
                    >
                      Verdadeiro
                    </SegmentButton>
                    <SegmentButton
                      type="button"
                      role="radio"
                      aria-checked={marks()[index()] === "F"}
                      data-selected={marks()[index()] === "F" ? "" : undefined}
                      disabled={!editable()}
                      onClick={() => setMark(index(), "F")}
                    >
                      Falso
                    </SegmentButton>
                  </Segment>
                </TfRow>
              )}
            </For>
          </Choices>
        </Match>

        <Match when={props.kind === "order"}>
          <Lead>
            Toque nos acontecimentos na ordem em que aparecem no texto:
          </Lead>
          <Choices>
            <For each={[...STUDY_CHOICE_LETTERS]}>
              {(letter) => {
                const position = () => sequence().indexOf(letter) + 1;
                return (
                  <Choice
                    type="button"
                    aria-pressed={position() > 0}
                    data-selected={position() > 0 ? "" : undefined}
                    disabled={!editable()}
                    onClick={() =>
                      editable() &&
                      setSequence((current) =>
                        toggleOrderLetter(current, letter),
                      )
                    }
                  >
                    <Badge data-order={position() > 0 ? "" : undefined}>
                      {position() > 0 ? `${position()}º` : letter}
                    </Badge>
                    <span>
                      {letterText(letter) || `Acontecimento ${letter}`}
                    </span>
                  </Choice>
                );
              }}
            </For>
          </Choices>
          <Show when={sequence().length > 0 && editable()}>
            <Inline>
              <Button size="sm" variant="text" onPress={() => setSequence([])}>
                Limpar ordem
              </Button>
            </Inline>
          </Show>
        </Match>

        <Match when={props.kind === "blank"}>
          <TypedInput
            type="text"
            maxLength={STUDY_MAX_TYPED}
            placeholder={TYPED_HINTS.blank}
            value={typed()}
            disabled={!editable()}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setTyped(event.currentTarget.value)}
            onPaste={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              // Enter opens the review step; it never sends on its own.
              if (event.key === "Enter") {
                event.preventDefault();
                review();
              }
            }}
          />
        </Match>

        <Match when={props.kind === "text"}>
          <TypedArea
            rows={4}
            maxLength={STUDY_MAX_TYPED}
            placeholder={TYPED_HINTS.text}
            value={typed()}
            disabled={!editable()}
            spellcheck={false}
            onInput={(event) => setTyped(event.currentTarget.value)}
            onPaste={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                review();
              }
            }}
          />
          <Counter>
            {typed().length}/{STUDY_MAX_TYPED}
          </Counter>
        </Match>
      </Switch>

      <Footer>
        <Switch>
          <Match when={props.locked}>
            <Done>{props.lockedLabel}</Done>
          </Match>
          <Match when={!reviewing()}>
            <Hint>{missing() ?? "Pronto. Revise antes de enviar."}</Hint>
            <Button
              size="sm"
              variant="filled"
              isDisabled={!answer() || props.busy}
              onPress={review}
            >
              Revisar resposta
            </Button>
          </Match>
          <Match when={reviewing()}>
            <Review role="dialog" aria-label="Confirmar resposta">
              <strong>Confere antes de enviar:</strong>
              <Summary>{summary()}</Summary>
              <span>Depois de enviar não dá para mudar.</span>
              <Actions>
                <Button size="sm" variant="tonal" onPress={back}>
                  Corrigir
                </Button>
                <Button
                  size="sm"
                  variant="filled"
                  isDisabled={!armed() || props.busy}
                  onPress={confirm}
                >
                  {props.busy ? "Enviando…" : "Enviar resposta"}
                </Button>
              </Actions>
            </Review>
          </Match>
        </Switch>
      </Footer>
    </Area>
  );
}

const Area = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
    marginTop: "var(--gap-md)",
    maxWidth: "64ch",

    // beats the protected block's `& *` user-select: none
    "& input, & textarea": {
      userSelect: "text",
      WebkitUserSelect: "text",
    },
  },
});

const Clock = styled("div", {
  base: {
    alignSelf: "flex-start",
    padding: "2px var(--gap-md)",
    borderRadius: "var(--borderRadius-full, 999px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.85em",
    fontVariantNumeric: "tabular-nums",

    "&[data-warn]": {
      background: "var(--md-sys-color-error-container)",
      color: "var(--md-sys-color-on-error-container)",
    },
  },
});

const Lead = styled("div", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.95em",
  },
});

const Choices = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
  },
});

const choiceBase = {
  display: "flex",
  alignItems: "flex-start",
  gap: "var(--gap-md)",
  width: "100%",
  minHeight: "44px",
  padding: "var(--gap-sm) var(--gap-md)",
  borderRadius: "var(--borderRadius-md)",
  border: "2px solid var(--md-sys-color-outline-variant)",
  background: "var(--md-sys-color-surface-container-low)",
  color: "var(--md-sys-color-on-surface)",
  fontFamily: "inherit",
  fontSize: "1em",
  textAlign: "left",
  lineHeight: 1.35,
  cursor: "pointer",
  transition: "border-color 120ms, background 120ms",
} as const;

const Choice = styled("button", {
  base: {
    ...choiceBase,

    "&[data-selected]": {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    "&:disabled": {
      cursor: "default",
    },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

const Badge = styled("span", {
  base: {
    flexShrink: 0,
    minWidth: "2em",
    height: "2em",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    background: "var(--md-sys-color-surface-container-highest)",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",

    "&[data-order]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
    },
  },
});

const TfRow = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--gap-sm) var(--gap-md)",
    padding: "var(--gap-sm) var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-low)",
  },
});

const TfText = styled("div", {
  base: {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--gap-md)",
    flex: "1 1 22ch",
    lineHeight: 1.35,
  },
});

const Segment = styled("div", {
  base: {
    display: "inline-flex",
    flexShrink: 0,
    borderRadius: "var(--borderRadius-md)",
    border: "2px solid var(--md-sys-color-outline-variant)",
    overflow: "hidden",
  },
});

const SegmentButton = styled("button", {
  base: {
    minHeight: "40px",
    minWidth: "6.5em",
    padding: "0 var(--gap-md)",
    border: "none",
    background: "transparent",
    color: "var(--md-sys-color-on-surface)",
    fontFamily: "inherit",
    fontSize: "0.95em",
    fontWeight: 500,
    cursor: "pointer",

    "& + &": {
      borderLeft: "2px solid var(--md-sys-color-outline-variant)",
    },
    "&[data-selected]": {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
    },
    "&:disabled": {
      cursor: "default",
    },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});

const Inline = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-sm)",
  },
});

const fieldBase = {
  width: "100%",
  padding: "var(--gap-sm) var(--gap-md)",
  borderRadius: "var(--borderRadius-md)",
  border: "1px solid var(--md-sys-color-outline-variant)",
  background: "var(--md-sys-color-surface-container-low)",
  color: "var(--md-sys-color-on-surface)",
  fontFamily: "inherit",
  fontSize: "1em",
  outline: "none",
  // the answer field must stay editable inside the protected block
  userSelect: "text",
  WebkitUserSelect: "text",

  "&:focus": {
    borderColor: "var(--md-sys-color-primary)",
  },
  "&:disabled": {
    opacity: 0.6,
  },
} as const;

const TypedInput = styled("input", { base: fieldBase });

const TypedArea = styled("textarea", {
  base: { ...fieldBase, resize: "vertical", minHeight: "5.5em" },
});

const Counter = styled("div", {
  base: {
    alignSelf: "flex-end",
    marginTop: "calc(-1 * var(--gap-sm))",
    fontSize: "0.8em",
    color: "var(--md-sys-color-on-surface-variant)",
    fontVariantNumeric: "tabular-nums",
  },
});

/** Send row: kept apart from the controls so a stray tap lands on nothing. */
const Footer = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--gap-md)",
    marginTop: "var(--gap-lg)",
    paddingTop: "var(--gap-lg)",
    borderTop: "1px solid var(--md-sys-color-outline-variant)",
  },
});

const Hint = styled("span", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.9em",
  },
});

const Done = styled("span", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
    fontWeight: 500,
  },
});

const Review = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    width: "100%",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-high)",
  },
});

const Summary = styled("div", {
  base: {
    whiteSpace: "pre-wrap",
    fontWeight: 500,
    lineHeight: 1.4,
  },
});

const Actions = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "var(--gap-md)",
    marginTop: "var(--gap-sm)",
  },
});
