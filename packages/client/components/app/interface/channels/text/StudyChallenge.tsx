import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { Message as MessageInterface } from "stoat.js";
import { styled } from "styled-system/jsx";

import {
  STUDY_DOWNLOAD_URL,
  STUDY_LETTERS,
  STUDY_MAX_TYPED,
  STUDY_TYPED_HINTS,
  StudyMessage,
  isStudyDesktopClient,
  isStudyMenu,
  isStudyQuestion,
  isStudyTyped,
  studyAnswerContent,
  studyClientTag,
  studyStartContent,
  studyTypedContent,
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
 * Menu / reading material / question / result from the study bot.
 *
 * Desktop shell: body without selection, copy or context menu, screenshots
 * blacked out, Start and A–D buttons. Anywhere else (PC browser, Android
 * WebView, phones): the body is hidden and a notice points to the app.
 */
export function StudyProtectedMessage(props: {
  message: MessageInterface;
  study: StudyMessage;
}) {
  const [sent, setSent] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [typed, setTyped] = createSignal("");
  const desktop = isStudyDesktopClient();
  const typedHint = () =>
    props.study.kind === "mc" ? "" : STUDY_TYPED_HINTS[props.study.kind];
  const multiline = () => props.study.kind === "text";

  function submitTyped() {
    const value = typed().trim();
    if (!value) return;
    void send(studyTypedContent(props.study, value, studyClientTag()), value);
  }

  onMount(() => {
    if (desktop) acquireContentProtection();
  });
  onCleanup(() => {
    if (desktop) releaseContentProtection();
  });

  const block = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  async function send(content: string, marker: string) {
    if (busy() || sent()) return;
    setBusy(true);
    try {
      await props.message.channel?.sendMessage({ content });
      setSent(marker);
    } catch {
      // the bot will re-ask; leave the buttons enabled
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={desktop} fallback={<StudyNotice study={props.study} />}>
      <Protected
        onCopy={block}
        onCut={block}
        onContextMenu={block}
        onDragStart={block}
        data-study-protected
      >
        <Markdown content={props.study.body} />
        <Show when={isStudyMenu(props.study)}>
          <Answers>
            <Button
              size="sm"
              variant="filled"
              isDisabled={busy() || !!sent()}
              onPress={() => send(studyStartContent(studyClientTag()), "start")}
            >
              Começar o desafio de hoje
            </Button>
          </Answers>
        </Show>
        <Show when={isStudyTyped(props.study)}>
          <TypedForm
            onSubmit={(event) => {
              event.preventDefault();
              submitTyped();
            }}
          >
            <Show
              when={multiline()}
              fallback={
                <TypedInput
                  type="text"
                  maxLength={STUDY_MAX_TYPED}
                  placeholder={typedHint()}
                  value={typed()}
                  disabled={busy() || !!sent()}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => setTyped(event.currentTarget.value)}
                  onPaste={block}
                />
              }
            >
              <TypedArea
                rows={3}
                maxLength={STUDY_MAX_TYPED}
                placeholder={typedHint()}
                value={typed()}
                disabled={busy() || !!sent()}
                spellcheck={false}
                onInput={(event) => setTyped(event.currentTarget.value)}
                onPaste={block}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    submitTyped();
                  }
                }}
              />
            </Show>
            <Button
              size="sm"
              variant="filled"
              isDisabled={busy() || !!sent() || !typed().trim()}
              onPress={submitTyped}
            >
              {sent() ? "Enviado" : "Enviar resposta"}
            </Button>
          </TypedForm>
        </Show>
        <Show when={isStudyQuestion(props.study) && props.study.kind === "mc"}>
          <Answers>
            <For each={STUDY_LETTERS}>
              {(letter) => (
                <Button
                  size="sm"
                  variant={sent() === letter ? "filled" : "tonal"}
                  isDisabled={busy() || !!sent()}
                  onPress={() =>
                    send(
                      studyAnswerContent(props.study, letter, studyClientTag()),
                      letter,
                    )
                  }
                >
                  {letter}
                </Button>
              )}
            </For>
          </Answers>
        </Show>
      </Protected>
    </Show>
  );
}

function StudyNotice(props: { study: StudyMessage }) {
  const what = () => {
    switch (props.study.q) {
      case "u":
        return "Menu do desafio";
      case "m":
        return "Texto do desafio";
      case "r":
        return "Resultado do desafio";
      default:
        return `Pergunta ${props.study.q}`;
    }
  };
  return (
    <Notice>
      <strong>{what()} — só no app Muchat para PC.</strong>
      <span>
        Aqui no navegador ou no celular o conteúdo fica escondido e as respostas
        não valem. Abra o app no computador e me chame por lá.
      </span>
      <a href={STUDY_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
        Baixar o app
      </a>
    </Notice>
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

const TypedForm = styled("form", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    marginTop: "var(--gap-md)",
    maxWidth: "64ch",
    alignItems: "flex-start",

    // the answer field itself must stay editable inside the protected block
    "& input, & textarea": {
      userSelect: "text",
      WebkitUserSelect: "text",
    },
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

  "&:focus": {
    borderColor: "var(--md-sys-color-primary)",
  },
  "&:disabled": {
    opacity: 0.6,
  },
} as const;

const TypedInput = styled("input", { base: fieldBase });

const TypedArea = styled("textarea", {
  base: { ...fieldBase, resize: "vertical", minHeight: "4.5em" },
});

const Notice = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.95em",
    maxWidth: "48ch",

    "& a": {
      color: "var(--md-sys-color-primary)",
      textDecoration: "underline",
    },
  },
});
