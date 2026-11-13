import {
  isTextChannel,
  type StoatChannel,
  type StoatRole,
  type StoatServer,
  type StoatTextChannel,
} from "./types.ts";

export type CacheChange =
  | { kind: "structure"; serverId: string } // channels, categories, roles, permissions
  | { kind: "server_gone"; serverId: string }
  | { kind: "member"; serverId: string; userId: string }
  | { kind: "ready" };

type Listener = (change: CacheChange) => void;

/**
 * Servers and server text channels seen by the space bot, kept current by
 * bonfire events. A reducer with no I/O: tests feed it events directly.
 */
export class StoatCache {
  readonly servers = new Map<string, StoatServer>();
  readonly channels = new Map<string, StoatTextChannel>();
  private readonly listeners = new Set<Listener>();
  ready = false;

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(change: CacheChange) {
    for (const fn of this.listeners) fn(change);
  }

  channelsOf(serverId: string): StoatTextChannel[] {
    const server = this.servers.get(serverId);
    if (!server) return [];
    return server.channels.map((id) => this.channels.get(id)).filter((c): c is StoatTextChannel => Boolean(c));
  }

  private putChannel(c: StoatChannel) {
    if (isTextChannel(c)) this.channels.set(c._id, c);
  }

  /** Applies one bonfire event (unknown types are ignored). */
  apply(event: unknown): void {
    if (typeof event !== "object" || event === null) return;
    const e = event as Record<string, unknown> & { type?: unknown };
    switch (e.type) {
      case "Bulk": {
        const v = e.v;
        if (Array.isArray(v)) for (const inner of v) this.apply(inner);
        return;
      }
      case "Ready": {
        this.servers.clear();
        this.channels.clear();
        for (const s of (e.servers as StoatServer[] | undefined) ?? []) this.servers.set(s._id, s);
        for (const c of (e.channels as StoatChannel[] | undefined) ?? []) this.putChannel(c);
        this.ready = true;
        this.emit({ kind: "ready" });
        return;
      }
      case "ServerCreate": {
        const server = e.server as StoatServer | undefined;
        if (!server) return;
        this.servers.set(server._id, server);
        for (const c of (e.channels as StoatChannel[] | undefined) ?? []) this.putChannel(c);
        this.emit({ kind: "structure", serverId: server._id });
        return;
      }
      case "ServerUpdate": {
        const id = e.id as string;
        const server = this.servers.get(id);
        if (!server) return;
        const next: StoatServer = { ...server, ...(e.data as Partial<StoatServer>) };
        for (const field of (e.clear as string[] | undefined) ?? []) {
          if (field === "Categories") delete next.categories;
        }
        this.servers.set(id, next);
        this.emit({ kind: "structure", serverId: id });
        return;
      }
      case "ServerDelete": {
        const id = e.id as string;
        const server = this.servers.get(id);
        if (!server) return;
        for (const cid of server.channels) this.channels.delete(cid);
        this.servers.delete(id);
        this.emit({ kind: "server_gone", serverId: id });
        return;
      }
      case "ChannelCreate": {
        const c = e as unknown as StoatChannel;
        if (!isTextChannel(c)) return;
        this.channels.set(c._id, c);
        const server = this.servers.get(c.server);
        if (server && !server.channels.includes(c._id)) {
          this.servers.set(c.server, { ...server, channels: [...server.channels, c._id] });
        }
        this.emit({ kind: "structure", serverId: c.server });
        return;
      }
      case "ChannelUpdate": {
        const id = e.id as string;
        const c = this.channels.get(id);
        if (!c) return;
        const next: StoatTextChannel = { ...c, ...(e.data as Partial<StoatTextChannel>) };
        for (const field of (e.clear as string[] | undefined) ?? []) {
          if (field === "Voice") delete next.voice;
          if (field === "DefaultPermissions") delete next.default_permissions;
        }
        this.channels.set(id, next);
        this.emit({ kind: "structure", serverId: c.server });
        return;
      }
      case "ChannelDelete": {
        const id = e.id as string;
        const c = this.channels.get(id);
        if (!c) return;
        this.channels.delete(id);
        const server = this.servers.get(c.server);
        // Stoat pulls the id from server.channels but leaves it in categories
        // (channels/model.rs:888-890): consumers must ignore unknown ids.
        if (server) this.servers.set(c.server, { ...server, channels: server.channels.filter((x) => x !== id) });
        this.emit({ kind: "structure", serverId: c.server });
        return;
      }
      case "ServerRoleUpdate": {
        const id = e.id as string;
        const roleId = e.role_id as string;
        const server = this.servers.get(id);
        if (!server) return;
        const roles = { ...(server.roles ?? {}) };
        const prev = roles[roleId];
        const data = e.data as Partial<StoatRole>;
        roles[roleId] = {
          name: data.name ?? prev?.name ?? "",
          permissions: data.permissions ?? prev?.permissions ?? { a: 0, d: 0 },
          rank: data.rank ?? prev?.rank ?? 0,
        };
        this.servers.set(id, { ...server, roles });
        this.emit({ kind: "structure", serverId: id });
        return;
      }
      case "ServerRoleDelete": {
        const id = e.id as string;
        const server = this.servers.get(id);
        if (!server?.roles) return;
        const roles = { ...server.roles };
        delete roles[e.role_id as string];
        this.servers.set(id, { ...server, roles });
        this.emit({ kind: "structure", serverId: id });
        return;
      }
      case "ServerRoleRanksUpdate": {
        const id = e.id as string;
        const server = this.servers.get(id);
        const ranks = e.ranks as string[] | undefined;
        if (!server?.roles || !ranks) return;
        const roles = { ...server.roles };
        ranks.forEach((roleId, rank) => {
          const r = roles[roleId];
          if (r) roles[roleId] = { ...r, rank };
        });
        this.servers.set(id, { ...server, roles });
        this.emit({ kind: "structure", serverId: id });
        return;
      }
      case "ServerMemberUpdate": {
        const key = e.id as { server?: string; user?: string } | undefined;
        if (key?.server && key.user) this.emit({ kind: "member", serverId: key.server, userId: key.user });
        return;
      }
      case "ServerMemberLeave": {
        const serverId = e.id as string;
        const userId = e.user as string;
        if (serverId && userId) this.emit({ kind: "member", serverId, userId });
        return;
      }
      default:
        return;
    }
  }
}
