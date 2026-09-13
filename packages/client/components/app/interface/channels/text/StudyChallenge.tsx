import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { Message as MessageInterface } from "stoat.js";
import { styled } from "styled-system/jsx";

import {
  STUDY_LETTERS,
  StudyMessage,
  isStudyMobileClient,
  isStudyQuestion,
  studyAnswerContent,
  studyClientTag,
} from "@revolt/common/lib/studyProtocol";
import { Markdown } from "@revolt/markdown";
import { Button } from "@revolt/ui";

/**
 * Desktop content protection is reference counted: the first protected
 * message on screen turns it on, the last one leaving turns it off.
 */
let protectedOnScreen = 0;

function acquireContentProtection() {
  protectedOnScreen += 1;
  if (protectedOnScreen === 1) {
    window.native?.setContentProtection?.(true);
  }
}

function releaseContentProtection() {
  protectedOnScreen = Math.max(0, protectedOnScreen - 1);
  if (protectedOnScreen === 0) {
    window.native?.setContentProtection?.(false);
  }
}

/**
 * Reading material / question / result from the study bot: no selection, no
 * copy, no context menu, screenshots blacked out on the desktop shell, and
 * answer buttons that only exist on desktop and PC browsers.
 */
export function StudyProtectedMessage(props: {
  message: MessageInterface;
  study: StudyMessage;
}) {
  const [sent, setSent] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const mobile = isStudyMobileClient();

  onMount(acquireContentProtection);
  onCleanup(releaseContentProtection);

  const block = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  async function answer(letter: string) {
    if (busy() || sent()) return;
    setBusy(true);
    try {
      await props.message.channel?.sendMessage({
        content: studyAnswerContent(props.study, letter, studyClientTag()),
      });
      setSent(letter);
    } catch {
      // the bot will re-ask; leave the buttons enabled
    } finally {
      setBusy(false);
    }
  }

  return (
    <Protected
      onCopy={block}
      onCut={block}
      onContextMenu={block}
      onDragStart={block}
      data-study-protected
    >
      <Markdown content={props.study.body} />
      <Show when={isStudyQuestion(props.study)}>
        <Show
          when={!mobile}
          fallback={<Note>Responda pelo Muchat do computador.</Note>}
        >
          <Answers>
            <For each={STUDY_LETTERS}>
              {(letter) => (
                <Button
                  size="sm"
                  variant={sent() === letter ? "filled" : "tonal"}
                  isDisabled={busy() || !!sent()}
                  onPress={() => answer(letter)}
                >
                  {letter}
                </Button>
              )}
            </For>
          </Answers>
        </Show>
      </Show>
    </Protected>
  );
}

const Protected = styled("div", {
  base: {
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    cursor: "default",
    wordBreak: "break-word",

    "& *": {
      userSelect: "none",
      WebkitUserSelect: "none",
    },
  },
});

const Answers = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-sm)",
    marginTop: "var(--gap-md)",
    flexWrap: "wrap",
  },
});

const Note = styled("div", {
  base: {
    marginTop: "var(--gap-md)",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.9em",
  },
});
