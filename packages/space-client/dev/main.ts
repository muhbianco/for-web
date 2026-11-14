import { CATALOG, CATEGORY_LABELS, type DecorItem, floorRef, itemOf, parseFloorRef, searchCatalog } from "@muchat/space-core";

import { type ConnStatus, floorSwatch, type MediaStatus, SpaceView, thumbnail, type VoicePort, wingHeading } from "../src/index.ts";

// Must match packages/space-server/src/dev.ts.
const DEV_SERVER_ID = "01JDEV0SRV0000000000000000";

const STATUS: Record<ConnStatus, string> = {
  connecting: "Conectando ao espaço…",
  online: "Conectado",
  reconnecting: "Sem conexão com o espaço — tentando de novo",
  replaced: "Aberto em outra aba",
  unauthenticated: "Sessão expirada",
  not_member: "Você não é membro deste servidor",
  closed: "Desconectado",
};

const $ = (id: string) => document.getElementById(id)!;
const as = new URLSearchParams(location.search).get("as") ?? "ana";
$("who").textContent = as;

// A pretend app voice: "connects" after 300 ms (or fails with ?voicefail=1),
// so the media flow can be followed without a LiveKit.
const voiceFail = new URLSearchParams(location.search).get("voicefail") === "1";
const fakeCall: { identity: string | null; room: string | null; connects: number; disconnects: number } = {
  identity: null,
  room: null,
  connects: 0,
  disconnects: 0,
};
const voice: VoicePort = {
  connect: (g) =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        fakeCall.connects++;
        if (voiceFail) return reject(new Error("403"));
        fakeCall.identity = g.identity;
        fakeCall.room = g.room_id;
        resolve();
      }, 300),
    ),
  disconnect: () => {
    fakeCall.disconnects++;
    fakeCall.identity = fakeCall.room = null;
  },
  identity: () => fakeCall.identity,
  live: () => fakeCall.identity !== null,
  busyElsewhere: (roomId) => fakeCall.room !== null && fakeCall.room !== roomId,
};
const MEDIA: Record<MediaStatus["kind"], string> = {
  idle: "",
  connecting: "Conectando áudio…",
  connected: "Áudio da sala conectado",
  unavailable: "Áudio indisponível",
  elsewhere: "Áudio em outra aba",
  paused: "Fora do áudio da sala",
};
const mediaEl = document.createElement("span");
mediaEl.id = "media";
mediaEl.className = "status";
$("status").after(mediaEl);

const view = await SpaceView.mount({
  el: $("space"),
  baseUrl: location.origin,
  sessionToken: `dev-${as}-session-token`,
  serverId: DEV_SERVER_ID,
  client: "web",
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  voice,
});
($("space") as HTMLElement).focus();
// Dev automation and debugging only (this page never ships).
let corrections = 0;
view.world.on((e) => {
  if (e.kind === "corrected") corrections++;
});
(window as unknown as Record<string, unknown>).__space = { view, corrections: () => corrections, fakeCall };
let zoom = 2;
$("zoom-in").onclick = () => view.setZoom(zoom + 1);
$("zoom-out").onclick = () => view.setZoom(zoom - 1);

// ---- editor toolbar (dev only) -------------------------------------------------

const editBtn = $("edit") as HTMLButtonElement;
const catSel = $("cat") as HTMLSelectElement;
const search = $("search") as HTMLInputElement;
const grid = $("items");
const variants = $("variants");
const selectedBox = $("selected");
const msg = $("msg");
const promptEl = $("prompt");
const interactionEl = $("interaction");

for (const c of ["all", ...Object.keys(CATEGORY_LABELS), "interactive"]) {
  const o = document.createElement("option");
  o.value = c;
  o.textContent = c === "all" ? "Todos" : c === "interactive" ? "Interativos" : CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS];
  catSel.append(o);
}

function pick(item: DecorItem, variant?: string) {
  if (item.layer === "floor") view.editor.pickFloor(floorRef(item.id, variant ?? item.variants?.[0]));
  else view.editor.pickItem(item.id, variant);
}

function renderGrid() {
  const cat = catSel.value;
  const items = searchCatalog(CATALOG, search.value, cat === "all" ? undefined : (cat as never));
  grid.replaceChildren(
    ...items.map((item) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "item";
      b.title = item.description ?? item.name;
      const canvas = item.layer === "floor" ? floorSwatch(item.id, item.variants?.[0], 40) : thumbnail(item, item.variants?.[0], 40);
      const name = document.createElement("span");
      name.textContent = item.name;
      b.append(canvas, name);
      b.onclick = () => pick(item);
      return b;
    }),
  );
}
catSel.onchange = renderGrid;
search.oninput = renderGrid;
renderGrid();

editBtn.onclick = () => view.setEditing(!view.ui.editor.enabled);
$("rotate").onclick = () => view.editor.rotate();
$("remove").onclick = () => view.editor.removeSelected();
$("dup").onclick = () => view.editor.duplicateSelected();
$("undo").onclick = () => view.editor.undo();
$("redo").onclick = () => view.editor.redo();
$("cancel").onclick = () => view.editor.cancel();
$("everyone").onclick = () => view.editor.setSettings({ editors: "everyone", roles: [] });
$("admins").onclick = () => view.editor.setSettings({ editors: "admins", roles: [] });
$("interact").onclick = () => view.interact();
$("close-interaction").onclick = () => view.closeInteraction();
// Stop the toolbar's keys from walking the avatar.
$("toolbar").addEventListener("keydown", (e) => e.stopPropagation());

let lastAnnouncement = "";
view.subscribe((s) => {
  zoom = s.zoom;
  $("status").textContent = STATUS[s.status];
  mediaEl.textContent = MEDIA[s.media.kind];
  mediaEl.dataset.kind = s.media.kind;
  $("where").textContent = s.location || "Carregando mapa…";
  if (s.announcement && s.announcement !== lastAnnouncement) {
    lastAnnouncement = s.announcement;
    $("live").textContent = s.announcement;
  }
  editBtn.textContent = s.editor.enabled ? "Sair do editor" : "Decorar";
  editBtn.disabled = !s.rights.can_edit;
  $("rights").textContent = `rev ${s.decorRev} · edita: ${s.rights.can_edit} · gerencia: ${s.rights.can_manage} · quem: ${s.settings?.editors ?? "?"}`;
  msg.textContent = s.editor.message ?? "";
  const tool = s.editor.tool;
  const toolItem = tool.kind === "place" ? tool.item : tool.kind === "floor" ? itemOf(CATALOG, parseFloorRef(tool.floor).item) : null;
  const toolVariant = tool.kind === "place" ? tool.variant : tool.kind === "floor" ? parseFloorRef(tool.floor).variant : undefined;
  $("tool").textContent = toolItem ? `${tool.kind === "floor" ? "Piso" : "Colocando"}: ${toolItem.name}${toolVariant ? ` (${toolVariant})` : ""}` : "";
  variants.replaceChildren(
    ...(toolItem?.variants ?? []).map((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v;
      b.className = v === toolVariant ? "on" : "";
      b.onclick = () => pick(toolItem!, v);
      return b;
    }),
  );
  const sel = s.editor.selected;
  const selItem = sel ? itemOf(CATALOG, sel.item) : undefined;
  selectedBox.textContent = sel && selItem ? `Selecionado: ${selItem.name} #${sel.id} em ${sel.zone} (${sel.x},${sel.y}) rot ${sel.rot}${sel.variant ? ` ${sel.variant}` : ""}` : "";
  promptEl.textContent = s.prompt ? `E · ${s.prompt.label}` : "";
  interactionEl.textContent = s.interaction ? `${s.interaction.item.interaction}: ${JSON.stringify(s.interaction.config)}` : "";
  ($("close-interaction") as HTMLButtonElement).hidden = !s.interaction;
  const list = $("list");
  list.replaceChildren(
    ...s.list.map((wing) => {
      const section = document.createElement("section");
      const h = document.createElement("h2");
      h.textContent = wingHeading(wing.title);
      const ul = document.createElement("ul");
      for (const r of wing.rooms) {
        const li = document.createElement("li");
        if (r.here) li.className = "here";
        const t = document.createElement("span");
        t.textContent = r.isPrivate && !r.canEnter ? `🔒 ${r.title}` : r.title;
        const st = document.createElement("span");
        st.className = "status";
        st.textContent = r.status;
        li.append(t, st);
        ul.append(li);
      }
      section.append(h, ul);
      return section;
    }),
  );
});
