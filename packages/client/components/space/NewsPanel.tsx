import {
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { SpaceView } from "@muchat/space-client";
import type { NewsItem, NewsWire } from "@muchat/space-core";
import { styled } from "styled-system/jsx";

import { renderChangelogMarkdown } from "@revolt/markdown";
import { Button } from "@revolt/ui";

import { ArsenalView } from "./game/ArsenalView";
import { gameFrame } from "./game/gameTheme";
import { Grip } from "./game/gameUi";
import { useModalKeys } from "./game/modalKeys";
import { useWide, useWindowDrag } from "./game/windowDrag";
import { markNewsSeen, newsLastSeen } from "./newsSeen";

/**
 * O painel do quadro de avisos (25/11/2026): as novidades do Muchat e do jogo, que o space-server
 * lê da coleção pública do Outline. Lista à esquerda (da mais nova), a nota à direita; em tela
 * estreita, uma embaixo da outra. Abrir o painel marca a nota mais nova como lida e tira o
 * alfinete vermelho do quadro.
 */
export default function NewsPanel(props: {
  view: SpaceView;
  title: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  let backdrop: HTMLDivElement | undefined;
  let card: HTMLDivElement | undefined;
  let title: HTMLHeadingElement | undefined;
  useModalKeys(
    () => card,
    () => title,
    () => props.onClose(),
  );
  // Arrastável pelo cabeçalho, como as janelas do jogo (25/11/2026); no celular, não.
  const wide = useWide(() => backdrop, 600);
  const drag = useWindowDrag({
    id: "space-news",
    win: () => card,
    bounds: () => backdrop,
    enabled: wide,
  });

  // O que já estava lido ao abrir: as notas acima dela ganham a etiqueta "nova".
  const seenAtOpen = newsLastSeen();
  // Estado explícito, não createResource: um recurso que falhou lança o erro em quem o lê
  // (os memos da lista), e sem ErrorBoundary o painel ficava preso em "Carregando…".
  const [news, setNews] = createSignal<
    { kind: "loading" } | { kind: "error" } | { kind: "ready"; wire: NewsWire }
  >({ kind: "loading" });
  let alive = true;
  onCleanup(() => (alive = false));
  const load = async () => {
    setNews({ kind: "loading" });
    try {
      const wire = await props.view.news();
      if (!alive) return;
      const newest = wire.items[0];
      if (newest) markNewsSeen(newest.id);
      props.view.setNewsUnread(false);
      setNews({ kind: "ready", wire });
    } catch {
      if (alive) setNews({ kind: "error" });
    }
  };
  onMount(() => void load());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // A nota com o link `#arsenal` abre o Arsenal (todos os itens do jogo) no lugar dos avisos (27/11/2026).
  const [arsenal, setArsenal] = createSignal(false);
  const hasArsenal = (n: NewsItem) => n.markdown.includes("#arsenal)");
  const items = () => {
    const s = news();
    return s.kind === "ready" ? s.wire.items : [];
  };
  const selected = createMemo<NewsItem | undefined>(
    () => items().find((i) => i.id === selectedId()) ?? items()[0],
  );
  const unreadIds = createMemo(() => {
    const all = items();
    const seenIndex = seenAtOpen
      ? all.findIndex((i) => i.id === seenAtOpen)
      : -1;
    const fresh = seenIndex === -1 ? all : all.slice(0, seenIndex);
    return new Set(fresh.map((i) => i.id));
  });
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
  };

  return (
    <Backdrop
      ref={backdrop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <Card
        style={{ ...gameFrame, ...drag.style() }}
        data-dragging={drag.dragging() ? "" : undefined}
        data-wide={arsenal() ? "" : undefined}
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-news-title"
      >
        <Head {...drag.handle} data-draggable={wide() ? "" : undefined}>
          <Show when={wide()}>
            <Grip onKey={drag.onGripKey} />
          </Show>
          <div>
            <h2 id="space-news-title" tabIndex={-1} ref={title}>
              {props.title}
            </h2>
            <Muted>{t`Novidades do Muchat e do jogo`}</Muted>
          </div>
          <Close type="button" aria-label={t`Fechar`} onClick={props.onClose}>
            ×
          </Close>
        </Head>

        <Switch>
          <Match when={news().kind === "loading"}>
            <p>{t`Carregando os avisos…`}</p>
          </Match>
          <Match when={news().kind === "error"}>
            <ErrorText>{t`Não deu para carregar os avisos agora. Tente de novo em instantes.`}</ErrorText>
            <div>
              <Button size="sm" onPress={() => void load()}>
                {t`Tentar de novo`}
              </Button>
            </div>
          </Match>
          <Match when={items().length === 0}>
            <p>{t`Nenhum aviso por enquanto.`}</p>
          </Match>
          <Match when={arsenal()}>
            <Scroll>
              <ArsenalView onBack={() => setArsenal(false)} />
            </Scroll>
          </Match>
          <Match when={selected()}>
            {(note) => (
              <Body>
                <List role="list" aria-label={t`Avisos`}>
                  <For each={items()}>
                    {(item) => (
                      <li>
                        <Entry
                          type="button"
                          aria-current={
                            item.id === note().id ? "true" : undefined
                          }
                          onClick={() => setSelectedId(item.id)}
                        >
                          <span>{item.title}</span>
                          <small>
                            {when(item.publishedAt)}
                            <Show when={unreadIds().has(item.id)}>
                              <Fresh>{t`nova`}</Fresh>
                            </Show>
                          </small>
                        </Entry>
                      </li>
                    )}
                  </For>
                </List>
                <Note aria-live="polite">
                  <h3>{note().title}</h3>
                  <Muted>{when(note().publishedAt)}</Muted>
                  <Show when={hasArsenal(note())}>
                    <div>
                      <Button size="sm" onPress={() => setArsenal(true)}>
                        {t`Abrir o Arsenal`}
                      </Button>
                    </div>
                  </Show>
                  <Content
                    onClick={(e) => {
                      // O link do Arsenal na nota abre o Arsenal aqui dentro, sem sair do Espaço.
                      const a = (e.target as HTMLElement).closest("a");
                      if (a?.getAttribute("href")?.endsWith("#arsenal")) {
                        e.preventDefault();
                        setArsenal(true);
                      }
                    }}
                  >
                    {renderChangelogMarkdown(note().markdown)}
                  </Content>
                </Note>
              </Body>
            )}
          </Match>
        </Switch>
      </Card>
    </Backdrop>
  );
}

const Backdrop = styled("div", {
  base: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "rgba(0, 0, 0, 0.55)",
    zIndex: 6,
    padding: "var(--gap-lg)",
  },
});

const Card = styled("div", {
  base: {
    containerType: "inline-size",
    maxWidth: "860px",
    width: "100%",
    height: "min(80vh, 680px)",
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-md)",
    padding: "var(--gap-xl, 24px)",
    borderRadius: "var(--borderRadius-lg, 16px)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    overflow: "hidden",
    "& h2": { margin: 0, fontSize: "1.15rem", outline: "none" },
    "& p": { margin: 0, lineHeight: 1.5 },
    // O Arsenal (todos os itens) pede mais espaço que uma nota.
    "&[data-wide]": { maxWidth: "1180px", height: "min(88vh, 940px)" },
  },
});

const Head = styled("div", {
  base: {
    "&[data-draggable]": {
      gridTemplateColumns: "auto 1fr auto",
      cursor: "grab",
      userSelect: "none",
      touchAction: "none",
    },
    "[data-dragging] > &": { cursor: "grabbing" },
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "start",
    "& > div": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});

const Close = styled("button", {
  base: {
    "@media (pointer: coarse)": {
      minWidth: "44px",
      minHeight: "44px",
      display: "inline-grid",
      placeItems: "center",
    },
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: "1.4em",
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 4px",
  },
});

const Body = styled("div", {
  base: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: "var(--gap-lg)",
    "@container (max-width: 560px)": {
      gridTemplateColumns: "1fr",
      gridTemplateRows: "auto 1fr",
    },
  },
});

const List = styled("ul", {
  base: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    overflowY: "auto",
    minHeight: 0,
    "@container (max-width: 560px)": {
      flexDirection: "row",
      overflowX: "auto",
      overflowY: "visible",
    },
  },
});

const Entry = styled("button", {
  base: {
    "@media (pointer: coarse)": { minHeight: "44px" },
    width: "100%",
    textAlign: "start",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    borderRadius: "10px",
    padding: "8px 10px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "& small": {
      color: "var(--md-sys-color-on-surface-variant)",
      display: "flex",
      gap: "6px",
      alignItems: "center",
    },
    '&[aria-current="true"]': {
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
      borderColor: "var(--md-sys-color-primary)",
    },
    "@container (max-width: 560px)": { width: "auto", whiteSpace: "nowrap" },
  },
});

const Fresh = styled("span", {
  base: {
    background: "#c0392b",
    color: "#fff",
    borderRadius: "999px",
    padding: "0 6px",
    fontSize: "0.75em",
    fontWeight: 600,
  },
});

const Scroll = styled("div", {
  base: { flex: 1, minHeight: 0, overflowY: "auto", paddingInlineEnd: "6px" },
});

const Note = styled("article", {
  base: {
    minHeight: 0,
    overflowY: "auto",
    paddingInlineEnd: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    "& h3": { margin: 0, fontSize: "1.1rem" },
  },
});

const Content = styled("div", {
  base: {
    marginTop: "var(--gap-md)",
    lineHeight: 1.55,
    // Tabela larga (as 5 colunas das classes) rola de lado no celular em vez de estourar o card.
    "& table": {
      display: "block",
      maxWidth: "100%",
      overflowX: "auto",
      borderCollapse: "collapse",
      margin: "8px 0",
      fontSize: "0.92em",
    },
    "& th, & td": {
      border: "1px solid var(--md-sys-color-outline-variant)",
      padding: "4px 8px",
      textAlign: "start",
    },
    "& h2": { fontSize: "1.05rem", marginTop: "18px" },
  },
});

const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});

const ErrorText = styled("p", {
  base: { color: "var(--md-sys-color-error)" },
});
