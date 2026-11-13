import { type ConnStatus, SpaceView, wingHeading } from "../src/index.ts";

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

const view = await SpaceView.mount({
  el: $("space"),
  baseUrl: location.origin,
  sessionToken: `dev-${as}-session-token`,
  serverId: DEV_SERVER_ID,
  client: "web",
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
});
($("space") as HTMLElement).focus();
// Dev automation and debugging only (this page never ships).
let corrections = 0;
view.world.on((e) => {
  if (e.kind === "corrected") corrections++;
});
(window as unknown as Record<string, unknown>).__space = { view, corrections: () => corrections };
let zoom = 2;
$("zoom-in").onclick = () => view.setZoom(zoom + 1);
$("zoom-out").onclick = () => view.setZoom(zoom - 1);

let lastAnnouncement = "";
view.subscribe((s) => {
  zoom = s.zoom;
  $("status").textContent = STATUS[s.status];
  $("where").textContent = s.location || "Carregando mapa…";
  if (s.announcement && s.announcement !== lastAnnouncement) {
    lastAnnouncement = s.announcement;
    $("live").textContent = s.announcement;
  }
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
