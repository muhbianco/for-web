import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { Message as MessageInterface } from "stoat.js";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import {
  STUDY_DOWNLOAD_URL,
  STUDY_LETTERS,
  STUDY_MAX_TYPED,
  STUDY_TYPED_HINTS,
  StudyMessage,
  isStudyProtectedClient,
  isStaleStudyAndroidShell,
  isStaleStudyDesktopShell,
  isStudyMenu,
  isStudyProfile,
  isStudyReadingStart,
  isStudyQuestion,
  isStudyTyped,
  parseStudyMessage,
  setStudyContentProtection,
  stripStudyGo,
  studyAnswerContent,
  studyClientTag,
  studyProfileContent,
  studyRereadContent,
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
    setStudyContentProtection(true);
  }
}

function releaseContentProtection() {
  protectedOnScreen = Math.max(0, protectedOnScreen - 1);
  if (protectedOnScreen === 0) {
    setStudyContentProtection(false);
  }
}

/**
 * Menu / reading material / question / result from the study bot.
 *
 * Trusted native shell: body without selection, copy or context menu,
 * screenshots blacked out, Start and A–D buttons. Anywhere else (PC
 * browser, Chrome WebView, phones without the APK): the body is hidden
 * and a notice points to the app.
 */
export function StudyProtectedMessage(props: {
  message: MessageInterface;
  study: StudyMessage;
}) {
  const [sent, setSent] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [typed, setTyped] = createSignal("");
  const [rereadOpen, setRereadOpen] = createSignal(false);
  const [rereadIndex, setRereadIndex] = createSignal(0);
  const protectedClient = isStudyProtectedClient();
  const client = useClient();
  const typedHint = () =>
    props.study.kind === "mc" ? "" : STUDY_TYPED_HINTS[props.study.kind];
  const multiline = () => props.study.kind === "text";
  const visibleBody = () => stripStudyGo(props.study.body);

  const storyParts = createMemo(() => {
    const challengeId = props.study.challengeId;
    const channelId = props.message.channelId;
    const found: { id: string; body: string }[] = [];
    for (const msg of client().messages.toList()) {
      if (msg.channelId !== channelId) continue;
      const parsed = parseStudyMessage(msg.content);
      if (!parsed || parsed.challengeId !== challengeId) continue;
      if (parsed.q !== "m" && parsed.q !== "k") continue;
      found.push({ id: msg.id, body: stripStudyGo(parsed.body) });
    }
    found.sort((a, b) => a.id.localeCompare(b.id));
    return found.map((item) => item.body).filter(Boolean);
  });

  function submitTyped() {
    const value = typed().trim();
    if (!value) return;
    void send(studyTypedContent(props.study, value, studyClientTag()), value);
  }

  onMount(() => {
    if (protectedClient) acquireContentProtection();
  });
  onCleanup(() => {
    if (protectedClient) releaseContentProtection();
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

  async function requestReread() {
    const parts = storyParts();
    if (parts.length) {
      setRereadIndex(0);
      setRereadOpen(true);
      return;
    }
    if (busy()) return;
    setBusy(true);
    try {
      await props.message.channel?.sendMessage({
        content: studyRereadContent(studyClientTag()),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={protectedClient} fallback={<StudyNotice study={props.study} />}>
      <Protected
        onCopy={block}
        onCut={block}
        onContextMenu={block}
        onDragStart={block}
        data-study-protected
      >
        <Markdown content={visibleBody()} />
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
        <Show when={isStudyProfile(props.study)}>
          <ProfileDobForm
            busy={busy()}
            sent={sent()}
            onSubmit={(iso) => send(studyProfileContent(iso, studyClientTag()), iso)}
          />
        </Show>
        <Show when={isStudyReadingStart(props.study)}>
          <Answers>
            <Button
              size="sm"
              variant="filled"
              isDisabled={busy() || !!sent()}
              onPress={() => send("pronto", "ready")}
            >
              Pronto, começar as perguntas
            </Button>
          </Answers>
        </Show>
        <Show when={isStudyQuestion(props.study)}>
          <Answers>
            <Button
              size="sm"
              variant="tonal"
              isDisabled={busy()}
              onPress={() => void requestReread()}
            >
              Reler história
            </Button>
          </Answers>
        </Show>
        <Show when={rereadOpen()}>
          <RereadBox>
            <Markdown
              content={
                storyParts()[rereadIndex()] || "Vamos olhar a história de novo?"
              }
            />
            <Answers>
              <Show when={storyParts().length > 1}>
                <Button
                  size="sm"
                  variant="tonal"
                  isDisabled={rereadIndex() <= 0}
                  onPress={() => setRereadIndex((i) => Math.max(0, i - 1))}
                >
                  Trecho anterior
                </Button>
                <Button
                  size="sm"
                  variant="tonal"
                  isDisabled={rereadIndex() >= storyParts().length - 1}
                  onPress={() =>
                    setRereadIndex((i) =>
                      Math.min(storyParts().length - 1, i + 1),
                    )
                  }
                >
                  Próximo trecho
                </Button>
              </Show>
              <Button
                size="sm"
                variant="filled"
                onPress={() => setRereadOpen(false)}
              >
                Voltar à pergunta
              </Button>
            </Answers>
          </RereadBox>
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

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function ProfileDobForm(props: {
  busy: boolean;
  sent: string | null;
  onSubmit: (iso: string) => void;
}) {
  const now = new Date();
  const maxYear = now.getFullYear() - 4;
  const minYear = now.getFullYear() - 120;
  const years = Array.from(
    { length: maxYear - minYear + 1 },
    (_, index) => maxYear - index,
  );
  const [day, setDay] = createSignal("");
  const [month, setMonth] = createSignal("");
  const [year, setYear] = createSignal("");
  const dayCount = createMemo(() => {
    const monthValue = Number(month());
    const yearValue = Number(year());
    if (!monthValue || !yearValue) return 31;
    return daysInMonth(yearValue, monthValue);
  });
  const iso = createMemo(() => {
    const dayValue = Number(day());
    const monthValue = Number(month());
    const yearValue = Number(year());
    if (!dayValue || !monthValue || !yearValue) return "";
    if (dayValue > daysInMonth(yearValue, monthValue)) return "";
    return `${yearValue}-${String(monthValue).padStart(2, "0")}-${String(dayValue).padStart(2, "0")}`;
  });

  createEffect(() => {
    if (Number(day()) > dayCount()) setDay("");
  });

  return (
    <TypedForm
      onSubmit={(event) => {
        event.preventDefault();
        const value = iso();
        if (value) props.onSubmit(value);
      }}
    >
      <SelectRow>
        <StudySelect
          aria-label="Dia"
          value={day()}
          disabled={props.busy || !!props.sent}
          onChange={(event) => setDay(event.currentTarget.value)}
        >
          <option value="">Dia</option>
          <For each={Array.from({ length: dayCount() }, (_, index) => index + 1)}>
            {(value) => <option value={String(value)}>{value}</option>}
          </For>
        </StudySelect>
        <StudySelect
          aria-label="Mês"
          value={month()}
          disabled={props.busy || !!props.sent}
          onChange={(event) => setMonth(event.currentTarget.value)}
        >
          <option value="">Mês</option>
          <For each={MONTHS}>
            {(name, index) => (
              <option value={String(index() + 1)}>{name}</option>
            )}
          </For>
        </StudySelect>
        <StudySelect
          aria-label="Ano"
          value={year()}
          disabled={props.busy || !!props.sent}
          onChange={(event) => setYear(event.currentTarget.value)}
        >
          <option value="">Ano</option>
          <For each={years}>
            {(value) => <option value={String(value)}>{value}</option>}
          </For>
        </StudySelect>
      </SelectRow>
      <Button
        size="sm"
        variant="filled"
        isDisabled={props.busy || !!props.sent || !iso()}
        onPress={() => {
          const value = iso();
          if (value) props.onSubmit(value);
        }}
      >
        {props.sent ? "Enviado" : "Cadastrar"}
      </Button>
    </TypedForm>
  );
}

function StudyNotice(props: { study: StudyMessage }) {
  const staleDesktop = isStaleStudyDesktopShell();
  const staleAndroid = isStaleStudyAndroidShell();
  const what = () => {
    switch (props.study.q) {
      case "u":
        return "Menu do desafio";
      case "p":
        return "Data de nascimento";
      case "m":
        return "Texto do desafio";
      case "k":
        return "História (releitura)";
      case "r":
        return "Resultado do desafio";
      default:
        return `Pergunta ${props.study.q}`;
    }
  };
  return (
    <Notice>
      <Show
        when={staleAndroid}
        fallback={
          <Show
            when={staleDesktop}
            fallback={
              <>
                <strong>{what()} — só no app Muchat para PC ou Android.</strong>
                <span>
                  Aqui no navegador o conteúdo fica escondido e as respostas não
                  valem. Abra o app no computador ou o APK Muchat.
                </span>
                <a
                  href={STUDY_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Baixar o app
                </a>
              </>
            }
          >
            <strong>{what()} — atualize o app Muchat.</strong>
            <span>
              Esta versão não esconde print da tela. Em Configurações → Desktop,
              instale a atualização e abra o app de novo.
            </span>
          </Show>
        }
      >
        <strong>{what()} — atualize o app Muchat no Android.</strong>
        <span>
          Esta versão não esconde print da tela. Baixe o APK novo e instale por
          cima do atual.
        </span>
        <a href={STUDY_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
          Baixar o APK
        </a>
      </Show>
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

const RereadBox = styled("div", {
  base: {
    marginTop: "var(--gap-md)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "var(--md-sys-color-surface-container-high)",
    maxWidth: "64ch",
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
    "& input, & textarea, & select": {
      userSelect: "text",
      WebkitUserSelect: "text",
    },
  },
});

const SelectRow = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-sm)",
    flexWrap: "wrap",
    width: "100%",
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

const StudySelect = styled("select", {
  base: {
    ...fieldBase,
    width: "auto",
    minWidth: "7em",
    flex: "1 1 7em",
  },
});

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
