import { type ConnStatus, type MediaStatus, SpaceView, type VoicePort, wingHeading } from "../src/index.ts";

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
