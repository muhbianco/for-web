import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
} from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import {
  type EditorState,
  type SpaceUiState,
  type SpaceView,
  floorSwatch,
  thumbnail,
} from "@muchat/space-client";
import {
  type DecorCategory,
  type DecorItem,
  type DecorSettings,
  type InteractionConfig,
  CATALOG,
  CATEGORY_LABELS,
  floorRef,
  itemOf,
  parseFloorRef,
  searchCatalog,
} from "@muchat/space-core";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { Button, IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

type Category = "all" | DecorCategory | "interactive";

const CATEGORIES: Category[] = [
  "all",
  "floor",
  "rug",
  "furniture",
  "gamer",
  "decor",
  "lighting",
  "equipment",
  "interactive",
  "special",
];

/**
 * The decoration store and editor panel (ADR 0007): catalog with search and
 * categories, the current tool, the selected object (variant, facing,
 * interaction) and, for admins, who may decorate. Every change goes through
 * the SpaceView's editor, which talks to the server; the panel only shows
 * what the server confirmed.
 */
export function DecorPanel(props: {
  view: SpaceView;
  ui: SpaceUiState;
  roles: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [category, setCategory] = createSignal<Category>("all");
  const [query, setQuery] = createSignal("");
  const editor = () => props.ui.editor;
  const items = createMemo(() => {
    const c = category();
    return searchCatalog(CATALOG, query(), c === "all" ? undefined : c);
  });

  const categoryLabel = (c: Category): string => {
    if (c === "all") return t`Todos`;
    if (c === "interactive") return t`Interativos`;
    return CATEGORY_LABELS[c];
  };

  const toolItem = (): DecorItem | null => {
    const tool = editor().tool;
    if (tool.kind === "place") return tool.item;
    if (tool.kind === "floor")
      return itemOf(CATALOG, parseFloorRef(tool.floor).item) ?? null;
    return null;
  };
  const toolVariant = (): string | undefined => {
    const tool = editor().tool;
    if (tool.kind === "place") return tool.variant;
    if (tool.kind === "floor") return parseFloorRef(tool.floor).variant;
    return undefined;
  };

  function pick(item: DecorItem, variant?: string) {
    if (item.layer === "floor")
      props.view.editor.pickFloor(
        floorRef(item.id, variant ?? item.variants?.[0]),
      );
    else props.view.editor.pickItem(item.id, variant);
  }

  return (
    // Keys typed here (search, texts) must not walk the avatar or trigger editor shortcuts.
    <Panel aria-label={t`Decoração`} onKeyDown={(e) => e.stopPropagation()}>
      <Head>
        <strong>{t`Decorar`}</strong>
        <span style={{ flex: 1 }} />
        <IconButton
          aria-label={t`Desfazer`}
          onPress={() => props.view.editor.undo()}
          isDisabled={!editor().canUndo}
        >
          <Symbol>undo</Symbol>
        </IconButton>
        <IconButton
          aria-label={t`Refazer`}
          onPress={() => props.view.editor.redo()}
          isDisabled={!editor().canRedo}
        >
          <Symbol>redo</Symbol>
        </IconButton>
        <IconButton aria-label={t`Fechar o editor`} onPress={props.onClose}>
          <Symbol>close</Symbol>
        </IconButton>
      </Head>
      <Show when={editor().message}>
        <Message role="status">{editor().message}</Message>
      </Show>

      <Show when={toolItem()}>
        {(item) => (
          <ToolCard>
            <Thumb item={item()} variant={toolVariant()} size={40} />
            <div class={grow}>
              <div>
                <strong>
                  {item().layer === "floor"
                    ? t`Piso: ${item().name}`
                    : t`Colocando: ${item().name}`}
                </strong>
              </div>
              <Muted>
                {item().layer === "floor"
                  ? t`Clique num ambiente para trocar o piso dele.`
                  : item().rotations > 1
                    ? t`Clique no mapa para colocar. R gira, Esc cancela.`
                    : t`Clique no mapa para colocar. Esc cancela.`}
              </Muted>
              <Variants
                item={item()}
                value={toolVariant()}
                onPick={(v) => pick(item(), v)}
              />
            </div>
            <IconButton
              aria-label={t`Cancelar`}
              onPress={() => props.view.editor.cancel()}
            >
              <Symbol>close</Symbol>
            </IconButton>
          </ToolCard>
        )}
      </Show>

      <Show when={editor().selected}>
        {(sel) => (
          <SelectedCard
            view={props.view}
            editor={editor()}
            selectedId={sel().id}
            zones={props.ui.zones}
          />
        )}
      </Show>

      <Chips role="tablist" aria-label={t`Categorias`}>
        <For each={CATEGORIES}>
          {(c) => (
            <Chip
              type="button"
              role="tab"
              aria-selected={category() === c}
              data-active={category() === c ? "" : undefined}
              onClick={() => setCategory(c)}
            >
              {categoryLabel(c)}
            </Chip>
          )}
        </For>
      </Chips>
      <Search
        type="search"
        value={query()}
        placeholder={t`Buscar item…`}
        aria-label={t`Buscar item`}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <Grid role="list">
        <For each={items()}>
          {(item) => (
            <ItemCard
              type="button"
              role="listitem"
              data-active={toolItem()?.id === item.id ? "" : undefined}
              onClick={() => pick(item)}
              title={item.description ?? item.name}
            >
              <Thumb item={item} variant={item.variants?.[0]} size={48} />
              <span class={itemName}>{item.name}</span>
              <Muted>
                {item.layer === "floor" ? t`piso` : `${item.w}×${item.h}`}
                {item.interaction ? " · ⚡" : ""}
              </Muted>
            </ItemCard>
          )}
        </For>
        <Show when={items().length === 0}>
          <Muted>{t`Nada encontrado.`}</Muted>
        </Show>
      </Grid>

      <Show when={props.ui.rights.can_manage && props.ui.settings}>
        {(settings) => (
          <SettingsCard
            view={props.view}
            settings={settings()}
            roles={props.roles}
          />
        )}
      </Show>
      <Hint>{t`Atalhos: R gira · Delete remove · Ctrl+D duplica · Ctrl+Z desfaz · arraste para mover`}</Hint>
    </Panel>
  );
}

/** Variant chips (colours) of an item. */
function Variants(props: {
  item: DecorItem;
  value: string | undefined;
  onPick: (variant: string) => void;
}) {
  return (
    <Show when={props.item.variants?.length}>
      <Chips>
        <For each={props.item.variants ?? []}>
          {(v) => (
            <Chip
              type="button"
              data-active={props.value === v ? "" : undefined}
              onClick={() => props.onPick(v)}
            >
              {v}
            </Chip>
          )}
        </For>
      </Chips>
    </Show>
  );
}

/** The selected object: facing, variant, duplicate, remove and its interaction. */
function SelectedCard(props: {
  view: SpaceView;
  editor: EditorState;
  selectedId: string;
  zones: SpaceUiState["zones"];
}) {
  const { t } = useLingui();
  const inst = () => props.editor.selected;
  const item = () => (inst() ? itemOf(CATALOG, inst()!.item) : undefined);
  const [title, setTitle] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [text, setText] = createSignal("");
  const [target, setTarget] = createSignal("");
  const [saved, setSaved] = createSignal(false);

  // Form follows the selection (another object, or the server confirmed a change).
  createEffect(
    on(
      () => [props.selectedId, JSON.stringify(inst()?.config ?? {})] as const,
      () => {
        const c = inst()?.config ?? {};
        setTitle(c.title ?? "");
        setUrl(c.url ?? "");
        setText(c.text ?? "");
        setTarget(c.target ?? "");
        setSaved(false);
      },
    ),
  );

  function save() {
    const it = item();
    if (!it?.interaction) return;
    const config: InteractionConfig = {};
    if (title().trim()) config.title = title().trim().slice(0, 60);
    if (["link", "picture", "frame"].includes(it.interaction) && url().trim())
      config.url = url().trim();
    if (it.interaction === "note" && text().trim()) config.text = text().trim();
    if (it.interaction === "teleport" && target()) config.target = target();
    props.view.editor.updateSelected({
      config: Object.keys(config).length ? config : null,
    });
    setSaved(true);
  }

  return (
    <Show when={inst() && item()}>
      <ToolCard data-selected="">
        <Thumb item={item()!} variant={inst()!.variant} size={40} />
        <div class={grow}>
          <strong>{item()!.name}</strong>
          <Muted>{t`Selecionado`}</Muted>
          <Variants
            item={item()!}
            value={inst()!.variant}
            onPick={(v) => props.view.editor.updateSelected({ variant: v })}
          />
          <Row>
            <Show when={item()!.rotations > 1}>
              <Button
                variant="tonal"
                size="xs"
                onPress={() => props.view.editor.rotate()}
              >
                {t`Girar`}
              </Button>
            </Show>
            <Button
              variant="tonal"
              size="xs"
              onPress={() => props.view.editor.duplicateSelected()}
            >
              {t`Duplicar`}
            </Button>
            <Button
              variant="tonal"
              size="xs"
              onPress={() => props.view.editor.removeSelected()}
            >
              {t`Remover`}
            </Button>
          </Row>
          <Show when={item()!.interaction}>
            {(kind) => (
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <label>
                  <Muted>{t`Título (aparece no aviso)`}</Muted>
                  <Input
                    type="text"
                    maxLength={60}
                    value={title()}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                  />
                </label>
                <Show when={["link", "picture", "frame"].includes(kind())}>
                  <label>
                    <Muted>
                      {kind() === "link"
                        ? t`Link (abre em nova aba)`
                        : kind() === "picture"
                          ? t`Endereço da imagem`
                          : t`Endereço da página (https)`}
                    </Muted>
                    <Input
                      type="url"
                      maxLength={2048}
                      placeholder="https://"
                      value={url()}
                      onInput={(e) => setUrl(e.currentTarget.value)}
                    />
                  </label>
                </Show>
                <Show when={kind() === "note"}>
                  <label>
                    <Muted>{t`Texto`}</Muted>
                    <TextArea
                      rows={3}
                      maxLength={500}
                      value={text()}
                      onInput={(e) => setText(e.currentTarget.value)}
                    />
                  </label>
                </Show>
                <Show when={kind() === "teleport"}>
                  <label>
                    <Muted>{t`Leva para`}</Muted>
                    <Select
                      value={target()}
                      onChange={(e) => setTarget(e.currentTarget.value)}
                    >
                      <option value="">{t`Escolha um ambiente`}</option>
                      <For each={props.zones}>
                        {(z) => <option value={z.key}>{z.label}</option>}
                      </For>
                    </Select>
                  </label>
                </Show>
                <Row>
                  <Button variant="filled" size="xs" type="submit">
                    {t`Salvar`}
                  </Button>
                  <Show when={saved()}>
                    <Muted role="status">{t`Enviado.`}</Muted>
                  </Show>
                </Row>
              </Form>
            )}
          </Show>
        </div>
        <IconButton
          aria-label={t`Desmarcar`}
          onPress={() => props.view.editor.cancel()}
        >
          <Symbol>close</Symbol>
        </IconButton>
      </ToolCard>
    </Show>
  );
}

/** Who may decorate (ManageServer only). */
function SettingsCard(props: {
  view: SpaceView;
  settings: DecorSettings;
  roles: Array<{ id: string; name: string }>;
}) {
  const { t } = useLingui();
  const [editors, setEditors] = createSignal<DecorSettings["editors"]>(
    props.settings.editors,
  );
  const [roles, setRoles] = createSignal<string[]>([...props.settings.roles]);
  createEffect(
    on(
      () => JSON.stringify(props.settings),
      () => {
        setEditors(props.settings.editors);
        setRoles([...props.settings.roles]);
      },
    ),
  );
  const dirty = () =>
    editors() !== props.settings.editors ||
    JSON.stringify([...roles()].sort()) !==
      JSON.stringify([...props.settings.roles].sort());
  return (
    <Section>
      <strong>{t`Quem pode decorar`}</strong>
      <Muted>{t`Quem gerencia o servidor sempre pode.`}</Muted>
      <RadioRow>
        <label>
          <input
            type="radio"
            name="decor-editors"
            checked={editors() === "admins"}
            onChange={() => setEditors("admins")}
          />{" "}
          {t`Só administradores`}
        </label>
        <label>
          <input
            type="radio"
            name="decor-editors"
            checked={editors() === "roles"}
            onChange={() => setEditors("roles")}
          />{" "}
          {t`Cargos escolhidos`}
        </label>
        <label>
          <input
            type="radio"
            name="decor-editors"
            checked={editors() === "everyone"}
            onChange={() => setEditors("everyone")}
          />{" "}
          {t`Todo mundo`}
        </label>
      </RadioRow>
      <Show when={editors() === "roles"}>
        <RadioRow>
          <For each={props.roles}>
            {(r) => (
              <label>
                <input
                  type="checkbox"
                  checked={roles().includes(r.id)}
                  onChange={(e) =>
                    setRoles(
                      e.currentTarget.checked
                        ? [...roles(), r.id]
                        : roles().filter((x) => x !== r.id),
                    )
                  }
                />{" "}
                {r.name}
              </label>
            )}
          </For>
          <Show when={props.roles.length === 0}>
            <Muted>{t`Este servidor ainda não tem cargos.`}</Muted>
          </Show>
        </RadioRow>
      </Show>
      <Row>
        <Button
          variant="filled"
          size="xs"
          isDisabled={!dirty()}
          onPress={() =>
            props.view.editor.setSettings({
              editors: editors(),
              roles: editors() === "roles" ? roles() : [],
            })
          }
        >
          {t`Salvar permissões`}
        </Button>
      </Row>
    </Section>
  );
}

/** Pixel-art preview of an item (or a floor swatch), redrawn when the variant changes. */
export function Thumb(props: {
  item: DecorItem;
  variant: string | undefined;
  size: number;
}) {
  let host: HTMLSpanElement | undefined;
  createEffect(() => {
    const canvas =
      props.item.layer === "floor"
        ? floorSwatch(props.item.id, props.variant, props.size)
        : thumbnail(props.item, props.variant, props.size);
    canvas.setAttribute("aria-hidden", "true");
    host?.replaceChildren(canvas);
  });
  return (
    <span
      ref={host}
      class={thumbHost}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
    />
  );
}

const Panel = styled("aside", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    overflow: "auto",
    padding: "var(--gap-md)",
    background: "var(--md-sys-color-surface-container-low)",
    color: "var(--md-sys-color-on-surface)",
    fontSize: "0.9rem",
  },
});

const Head = styled("div", {
  base: { display: "flex", alignItems: "center", gap: "var(--gap-xs)" },
});

const Message = styled("div", {
  base: {
    padding: "6px 10px",
    borderRadius: "8px",
    background: "var(--md-sys-color-error-container)",
    color: "var(--md-sys-color-on-error-container)",
    fontSize: "0.85em",
  },
});

const ToolCard = styled("div", {
  base: {
    display: "flex",
    gap: "var(--gap-sm)",
    alignItems: "flex-start",
    padding: "var(--gap-sm)",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
    "&[data-selected]": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Section = styled("section", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",
    padding: "var(--gap-sm)",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container)",
  },
});

const Chips = styled("div", {
  base: { display: "flex", flexWrap: "wrap", gap: "4px" },
});

const Chip = styled("button", {
  base: {
    padding: "3px 9px",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: "0.8em",
    cursor: "pointer",
    "&[data-active]": {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
      borderColor: "transparent",
    },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const inputBase = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: "8px",
  border: "1px solid var(--md-sys-color-outline-variant)",
  background: "var(--md-sys-color-surface-container-lowest)",
  color: "inherit",
  font: "inherit",
  "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
} as const;

const Search = styled("input", { base: inputBase });
const Input = styled("input", { base: inputBase });
const TextArea = styled("textarea", {
  base: { ...inputBase, resize: "vertical" },
});
const Select = styled("select", { base: inputBase });

const Grid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
    gap: "6px",
  },
});

const ItemCard = styled("button", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    padding: "6px 4px",
    borderRadius: "10px",
    border: "2px solid transparent",
    background: "var(--md-sys-color-surface-container)",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
    textAlign: "center",
    "&:hover": { background: "var(--md-sys-color-surface-container-high)" },
    "&[data-active]": { borderColor: "var(--md-sys-color-primary)" },
    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});

const Form = styled("form", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginTop: "6px",
    "& label": { display: "flex", flexDirection: "column", gap: "2px" },
  },
});
const Row = styled("div", {
  base: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: "4px",
  },
});
const RadioRow = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    "& label": { display: "flex", gap: "6px", alignItems: "center" },
  },
});
const Muted = styled("span", {
  base: { color: "var(--md-sys-color-on-surface-variant)", fontSize: "0.85em" },
});
const Hint = styled("p", {
  base: {
    margin: 0,
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "0.75em",
  },
});

const grow = css({
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "2px",
});
const itemName = css({
  fontSize: "0.8em",
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "100%",
});
const thumbHost = css({
  display: "inline-grid",
  placeItems: "center",
  flexShrink: 0,
  "& canvas": {
    imageRendering: "pixelated",
    maxWidth: "100%",
    maxHeight: "100%",
  },
});
