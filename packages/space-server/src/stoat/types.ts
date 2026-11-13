/**
 * Minimal Stoat v0.15.5 wire shapes the space reads (snake_case, as the API
 * and the bonfire websocket send them). Only fields we use are typed.
 */

export interface StoatOverride {
  a: number;
  d: number;
}

export interface StoatRole {
  name: string;
  permissions: StoatOverride;
  rank: number;
}

export interface StoatCategory {
  id: string;
  title: string;
  channels: string[];
}

export interface StoatServer {
  _id: string;
  owner: string;
  name: string;
  channels: string[];
  categories?: StoatCategory[] | null;
  default_permissions: number;
  roles?: Record<string, StoatRole> | null;
}

export interface StoatTextChannel {
  channel_type: "TextChannel";
  _id: string;
  server: string;
  name: string;
  default_permissions?: StoatOverride | null;
  role_permissions?: Record<string, StoatOverride> | null;
  voice?: { max_users?: number | null } | null;
}

export interface StoatOtherChannel {
  channel_type: "DirectMessage" | "Group" | "SavedMessages" | "VoiceChannel";
  _id: string;
}

export type StoatChannel = StoatTextChannel | StoatOtherChannel;

export interface StoatMember {
  _id: { server: string; user: string };
  roles?: string[] | null;
  timeout?: string | null;
  can_publish?: boolean | null;
  can_receive?: boolean | null;
  nickname?: string | null;
}

export interface StoatUser {
  _id: string;
  username: string;
  display_name?: string | null;
  privileged?: boolean | null;
  bot?: unknown;
}

export const isTextChannel = (c: StoatChannel | undefined): c is StoatTextChannel =>
  c?.channel_type === "TextChannel";
