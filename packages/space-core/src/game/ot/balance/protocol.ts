import { z } from "zod";

import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
} from "../../../protocol/messages.ts";
import type { HeroCarry } from "./combat/types.ts";
import {
  type ClassId,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  CLASS_IDS,
  FAMILY_IDS,
  GEAR_SLOTS,
  OFFHAND_IDS,
  STATS,
} from "./content.ts";
import type { HeroV5, OwnedItem } from "./hero.ts";
import type { Material } from "./items/generate.ts";
import type { RunMeter } from "./run/meter.ts";
import type { RunFrame, RunOutcome } from "./run/simulate.ts";

/**
 * O protocolo do jogo idle na engine nova (Fase 8): os comandos `rpg.*` que o app manda e os eventos
 * que o servidor devolve. É o contrato entre o servidor (space-server) e as telas (client): o app
 * recebe o herói v5 inteiro e calcula derivados, preços e barras com as mesmas funções puras do núcleo
 * (balance/), sem o servidor mandar nada pré-calculado. Na virada substitui o `ot/protocol.ts`.
 */

const env = { v: z.literal(PROTOCOL_VERSION), id: z.string().min(1).max(40) };
const empty = z.object({}).strict().optional();
const ref = z.string().min(1).max(64);
const npc = z.string().min(1).max(40);
const cmd = <T extends string, D extends z.ZodType>(t: T, d: D) =>
  z.object({ ...env, t: z.literal(t), d });

// ------------------------------------------------------------ herói

/** Abre o jogo: devolve o estado (e fecha um treino no Dojô que ficou para trás). */
export const RpgOpenCmd = cmd("rpg.open", empty);
/** Jogador novo escolhe a classe (só quando ainda não tem herói; D34). */
export const RpgClassCmd = cmd(
  "rpg.class",
  z.object({ cls: z.enum(CLASS_IDS) }).strict(),
);
/** Começa a treinar Proficiência no boneco `instance` (ao lado dele); para credita o tempo. */
export const RpgDojoStartCmd = cmd(
  "rpg.dojo.start",
  z.object({ instance: ref }).strict(),
);
export const RpgDojoStopCmd = cmd("rpg.dojo.stop", empty);

/** Atributos: quanto subir em cada um (os pontos livres e a escada de custo valem). */
export const RpgAttrsCmd = cmd(
  "rpg.attrs",
  z
    .object({
      add: z.partialRecord(z.enum(STATS), z.number().int().min(1).max(5000)),
    })
    .strict(),
);

const spendTarget = z.union([
  z.literal("potencia"),
  z.literal("eficiencia"),
  z.object({ mechanic: z.string().min(1).max(40) }).strict(),
]);
/** Gasta um ponto de habilidade numa skill: Potência, Eficiência ou uma Mecânica. */
export const RpgSkillSpendCmd = cmd(
  "rpg.skill.spend",
  z.object({ skill: ref, target: spendTarget }).strict(),
);
/** Os 4 slots, em ordem de prioridade. */
export const RpgSkillSlotsCmd = cmd(
  "rpg.skill.slots",
  z.object({ slots: z.array(ref).max(4) }).strict(),
);

const pct = z.number().min(0).max(1);
/** As condições da IA (spec §5), no formato do motor. */
export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sempre") }),
  z.object({ kind: z.literal("soEmChefe") }),
  z.object({
    kind: z.literal("inimigos"),
    min: z.number().int().min(1).max(20),
  }),
  z.object({ kind: z.literal("aliadoAbaixo"), pct }),
  z.object({
    kind: z.literal("aliadosAbaixo"),
    pct,
    min: z.number().int().min(1).max(4),
  }),
  z.object({ kind: z.literal("aliadoComMpAbaixo"), pct }),
  z.object({ kind: z.literal("precisaCura") }),
  z.object({ kind: z.literal("aliadoAmaldicoado") }),
  z.object({ kind: z.literal("aliadoCaido") }),
  z.object({ kind: z.literal("meuHpAbaixo"), pct }),
  z.object({ kind: z.literal("chefePreparando") }),
  z.object({ kind: z.literal("perdiAggro") }),
  z.object({ kind: z.literal("sendoAlvo") }),
]);
/** A IA de uma skill: até 3 condições (vale se qualquer uma valer), ou null para a padrão. */
export const RpgSkillAiCmd = cmd(
  "rpg.skill.ai",
  z
    .object({
      skill: ref,
      conditions: z.array(conditionSchema).min(1).max(3).nullable(),
    })
    .strict(),
);

/** Mestre da evolução (ao lado do NPC): evoluir de tier e as redistribuições (a 1ª de cada é grátis). */
export const RpgMasterCmd = cmd(
  "rpg.master",
  z
    .object({
      npc,
      action: z.enum([
        "evoluir",
        "redistribuir-atributos",
        "redistribuir-skills",
      ]),
    })
    .strict(),
);

// ------------------------------------------------------------ equipamento

export const RpgEquipCmd = cmd("rpg.equip", z.object({ uid: ref }).strict());
export const RpgUnequipCmd = cmd(
  "rpg.unequip",
  z.object({ slot: z.enum(GEAR_SLOTS) }).strict(),
);
/** "Escolher o melhor sozinho": liga/desliga e, com `apply`, aplica agora. */
export const RpgAutoEquipCmd = cmd(
  "rpg.autoequip",
  z
    .object({ on: z.boolean().optional(), apply: z.boolean().optional() })
    .strict(),
);
export const RpgDiscardCmd = cmd(
  "rpg.discard",
  z.object({ uid: ref }).strict(),
);
/** Quando beber na corrida: vida e mana abaixo destas frações. */
export const RpgSuppliesCmd = cmd(
  "rpg.supplies",
  z.object({ hp: pct, mp: pct }).strict(),
);
/** O tamanho de poção que vai no cinto (D35). */
export const RpgBeltCmd = cmd(
  "rpg.belt",
  z
    .object({
      kind: z.enum(["hp", "mp"]),
      size: z.enum(["pequena", "media", "grande"]),
    })
    .strict(),
);

// ------------------------------------------------------------ NPCs

export const itemBaseSchema = z.union([
  z.object({ slot: z.literal("arma"), family: z.enum(FAMILY_IDS) }).strict(),
  z
    .object({ slot: z.literal("secundaria"), offhand: z.enum(OFFHAND_IDS) })
    .strict(),
  z
    .object({ slot: z.enum(ARMOR_SLOTS), weight: z.enum(ARMOR_WEIGHTS) })
    .strict(),
  z.object({ slot: z.enum(["colar", "anel"]) }).strict(),
]);
const count = z.number().int().min(1).max(10_000);
/** Mercador (ao lado do NPC): poção por tipo e tamanho, munição em pacotes, Comum do tier. */
export const RpgShopBuyCmd = cmd(
  "rpg.shop.buy",
  z
    .object({
      npc,
      buy: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("pocao"),
            type: z.enum(["hp", "mp"]),
            size: z.enum(["pequena", "media", "grande"]),
            count,
          })
          .strict(),
        z
          .object({
            kind: z.literal("municao"),
            grade: z.enum(["comum", "afiada", "runica"]),
            packs: count,
          })
          .strict(),
        z.object({ kind: z.literal("item"), base: itemBaseSchema }).strict(),
      ]),
    })
    .strict(),
);
/** Vende um item da mochila (10% do preço base); do +7, só com `confirm`. */
export const RpgShopSellCmd = cmd(
  "rpg.shop.sell",
  z.object({ npc, uid: ref, confirm: z.boolean().optional() }).strict(),
);
/** Ferreiro: refinar (com a Pedra de Proteção opcional), reforjar ou desmontar. */
export const RpgSmithCmd = cmd(
  "rpg.smith",
  z
    .object({
      npc,
      action: z.enum(["refinar", "reforjar", "desmontar"]),
      uid: ref,
      protect: z.boolean().optional(),
    })
    .strict(),
);
/** Banqueiro: ouro no cofre (positivo deposita, negativo saca). */
export const RpgBankCmd = cmd(
  "rpg.bank",
  z.object({ npc, gold: z.number().int().min(-1e12).max(1e12) }).strict(),
);
/** Banqueiro: guardar um item da mochila no cofre ou retirar. */
export const RpgVaultCmd = cmd(
  "rpg.vault",
  z.object({ npc, action: z.enum(["guardar", "retirar"]), uid: ref }).strict(),
);
export const RpgVaultExpandCmd = cmd(
  "rpg.vault.expand",
  z.object({ npc }).strict(),
);
/**
 * Transferência para outro jogador (taxa de 2% no ouro, 5 × ouro do lacaio por item; item do +7 pede
 * `confirmations: 2`). `to` é o id da pessoa.
 */
export const RpgTransferCmd = cmd(
  "rpg.bank.transfer",
  z
    .object({
      npc,
      to: ref,
      gold: z.number().int().min(0).max(1e12),
      uids: z.array(ref).max(20),
      confirmations: z.number().int().min(1).max(2),
    })
    .strict(),
);

// ------------------------------------------------------------ grupo e corrida (mesmo desenho de antes)

export const RpgLobbyCreateCmd = cmd(
  "rpg.lobby.create",
  z.object({ tv: npc, dungeon: npc }).strict(),
);
export const RpgLobbyJoinCmd = cmd(
  "rpg.lobby.join",
  z.object({ tv: npc, id: ref.optional() }).strict(),
);
export const RpgLobbyLeaveCmd = cmd(
  "rpg.lobby.leave",
  z.object({ disband: z.boolean().optional() }).strict().optional(),
);
/**
 * O líder pede a largada (26/11/2026): a corrida sai depois da contagem de 3 s, e espera enquanto
 * alguém do grupo está na ficha ou num NPC (`rpg.lobby.prep`). `cancel`: desiste da largada.
 */
export const RpgLobbyStartCmd = cmd(
  "rpg.lobby.start",
  z.object({ cancel: z.boolean().optional() }).strict().optional(),
);
/** O que segura a largada do grupo: a ficha do herói ou um NPC aberto (o Mercador não segura). */
export const PREP_KINDS = ["heroi", "ferreiro", "banqueiro", "mestre"] as const;
export type RpgPrepKind = (typeof PREP_KINDS)[number];
/** A pessoa abriu (ou fechou, `what: null`) uma janela que segura a largada do grupo. */
export const RpgLobbyPrepCmd = cmd(
  "rpg.lobby.prep",
  z.object({ what: z.enum(PREP_KINDS).nullable() }).strict(),
);
export const RpgLobbyDungeonCmd = cmd(
  "rpg.lobby.dungeon",
  z.object({ dungeon: npc }).strict(),
);
export const RpgLobbyLoopCmd = cmd(
  "rpg.lobby.loop",
  z.object({ on: z.boolean() }).strict(),
);
/** Sai da corrida: livre na hora, sem a recompensa dela (o que gastou até ali fica gasto). */
export const RpgRunLeaveCmd = cmd("rpg.run.leave", empty);
/** Assistir uma corrida de outra sala (o quadro do menu). */
export const RpgRunWatchCmd = cmd(
  "rpg.run.watch",
  z.object({ id: ref }).strict(),
);
export const RpgBoardCmd = cmd("rpg.board", empty);

export const RpgCommand = z.discriminatedUnion("t", [
  RpgOpenCmd,
  RpgClassCmd,
  RpgDojoStartCmd,
  RpgDojoStopCmd,
  RpgAttrsCmd,
  RpgSkillSpendCmd,
  RpgSkillSlotsCmd,
  RpgSkillAiCmd,
  RpgMasterCmd,
  RpgEquipCmd,
  RpgUnequipCmd,
  RpgAutoEquipCmd,
  RpgDiscardCmd,
  RpgSuppliesCmd,
  RpgBeltCmd,
  RpgShopBuyCmd,
  RpgShopSellCmd,
  RpgSmithCmd,
  RpgBankCmd,
  RpgVaultCmd,
  RpgVaultExpandCmd,
  RpgTransferCmd,
  RpgLobbyCreateCmd,
  RpgLobbyJoinCmd,
  RpgLobbyLeaveCmd,
  RpgLobbyStartCmd,
  RpgLobbyDungeonCmd,
  RpgLobbyLoopCmd,
  RpgLobbyPrepCmd,
  RpgRunLeaveCmd,
  RpgRunWatchCmd,
  RpgBoardCmd,
]);
export type RpgCommand = z.infer<typeof RpgCommand>;

/** `null` = não é comando do jogo idle (o gateway segue para os outros parsers). */
export function parseRpgCommand(
  raw: string,
): { ok: true; cmd: RpgCommand } | { ok: false; error: string } | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const t = (json as { t?: unknown }).t;
  if (typeof t !== "string" || !t.startsWith("rpg.")) return null;
  const res = RpgCommand.safeParse(json);
  return res.success
    ? { ok: true, cmd: res.data }
    : { ok: false, error: "invalid_message" };
}

// ------------------------------------------------------------ eventos do servidor

/**
 * O estado do herói: o documento v5 inteiro (o app calcula o resto com o núcleo) e o que só o
 * servidor sabe — a stamina agora, o treino no Dojô e a corrida em andamento.
 */
export interface RpgHeroState {
  hero: HeroV5;
  /** Stamina em minutos no instante `server_now` (ela multiplica o XP; spec §2: fica como era). */
  stamina: number;
  /** Treino no Dojô: o boneco e desde quando (o app projeta o XP pelo relógio). */
  dojo: { instance: string; since: number } | null;
  /** Na dungeon agora: até quando. */
  run: { id: string; dungeon: string; ends_at: number } | null;
  /** Taxa de XP do servidor em vigor. */
  rates: { exp: number };
}

export interface RpgStateEvent {
  v: 1;
  t: "rpg.state";
  re?: string;
  /** `hero` null: a pessoa ainda não escolheu a classe (jogador novo). */
  d: { server_now: number; rev: number; hero: RpgHeroState | null };
}

/** Um membro do grupo como a sala vê. */
export interface RpgLobbyMember {
  user_id: string;
  name: string;
  cls: ClassId;
  level: number;
}

/** Como a corrida acabou para o grupo: o resultado da luta, ou "retirada" (todos saíram antes). */
export type RpgRunEnd = RunOutcome | "retirada";

export type RpgLoopStop =
  | "derrota"
  | "start_failed"
  | "offline"
  | "leader_left"
  | "retreat"
  /** A largada esperou demais por alguém na ficha ou num NPC (`stopped_detail`: os nomes). */
  | "prep";

/** O grupo de uma TV (fica montado entre as corridas). */
export interface RpgLobbyView {
  id: string;
  tv: string;
  room: string;
  /** Id da DG do catálogo (balance/dungeons/catalog.ts). */
  dungeon: string;
  leader: string;
  members: RpgLobbyMember[];
  /** Tamanho máximo do grupo para esta DG. */
  max: number;
  expires_at: number;
  state: "forming" | "running" | "ready";
  run_id: string | null;
  runs: number;
  loop: boolean;
  next_at: number | null;
  last: RpgRunEnd | null;
  stopped: RpgLoopStop | null;
  stopped_detail: string | null;
  /**
   * A largada pedida (pelo líder ou pelo loop) que ainda não saiu: espera quem está se preparando e
   * depois conta 3 s. Servidor antigo não manda (o app trata como false).
   */
  pending?: boolean;
  /** A largada pendente veio do loop (só quem deixou a tela aberta acompanha). */
  pending_auto?: boolean;
  /** Quando a corrida sai (a contagem); null enquanto alguém se prepara. */
  start_at?: number | null;
  /** Quem está na ficha ou num NPC agora (segura a largada). */
  prep?: { user_id: string; what: RpgPrepKind }[];
}

export interface RpgLobbyEvent {
  v: 1;
  t: "rpg.lobby";
  d: {
    tv: string;
    id?: string;
    lobby: RpgLobbyView | null;
    ended?: "started" | "cancelled" | "expired";
    started?: { dungeon: string; members: RpgLobbyMember[] };
  };
}

/** Um herói na corrida, como a tela vê (o necessário para as barras e a barra de skills). */
export interface RpgRunMemberView {
  user_id: string;
  name: string;
  cls: ClassId;
  level: number;
  /** Job e Proficiência guardada (os retratos da tela da corrida; corridas antigas não trazem). */
  job?: number;
  proficiency?: number;
  hp_max: number;
  mp_max: number;
  /** O que veste (o app desenha o herói e os ícones). */
  equipment: HeroV5["equipment"];
  /**
   * As skills dos slots nesta corrida: a mana e a recarga final, como o motor usa (Eficiência,
   * recarga global da DES e dos afixos, nunca abaixo de 50% da base).
   */
  skills: { id: string; mana: number; cd_ms: number }[];
  supplies: HeroV5["supplies"];
  belt: HeroV5["belt"];
  /** Poções no cinto no começo (vida e mana do tamanho equipado). */
  potions: { hp: number; mp: number };
}

/**
 * Uma corrida (os monstros de cada sala o app tira de `dungeonRooms(dungeon, members.length)`, que é
 * determinístico): quem, onde e quando acaba.
 */
export interface RpgRunView {
  id: string;
  tv: string;
  room: string;
  dungeon: string;
  started_at: number;
  ends_at: number;
  members: RpgRunMemberView[];
  auto: boolean;
}

/** O que cada um levou no fim (D4: quem caiu leva o que rendeu até cair; sem o bônus de fim). */
export interface RpgRunMemberEnd {
  user_id: string;
  dead: boolean;
  /** Saiu antes do fim: não leva nada desta corrida. */
  retreated: boolean;
  reward: {
    xp: number;
    job_xp: number;
    gold: number;
    items: OwnedItem[];
    ores: Partial<Record<Material, number>>;
    stones: number;
  } | null;
  /** Itens que não couberam na mochila (ficaram na dungeon). */
  left: OwnedItem[];
  potions_used: { hp: number; mp: number };
  ammo_used: number;
  levels_gained: number;
  jobs_gained: number;
}

export interface RpgRunEndView {
  outcome: RpgRunEnd;
  members: RpgRunMemberEnd[];
}

/** Um evento do registro com o segundo e a sala em que aconteceu. */
export type RpgRunFeedItem = RunFrame["e"][number] & { at: number; st: number };

/** A corrida até agora, para quem chega: o último quadro, o registro recente e o fim, se acabou. */
export interface RpgRunEvent {
  v: 1;
  t: "rpg.run";
  d: {
    run: RpgRunView;
    frame: RunFrame | null;
    feed: RpgRunFeedItem[];
    /** Estado de cada herói no fim de `frame` (poções e recargas que faltam). */
    carry?: HeroCarry[];
    end?: RpgRunEndView;
    /** O medidor até `frame` (dano, dano recebido e cura de cada herói; 26/11/2026). */
    meter?: RunMeter;
  };
}

/** Os segundos que passaram desde o último envio (normalmente um). */
export interface RpgRunTickEvent {
  v: 1;
  t: "rpg.run.tick";
  d: { id: string; frames: RunFrame[] };
}

export interface RpgBoardRun {
  id: string;
  dungeon: string;
  room: string;
  tv: string;
  started_at: number;
  ends_at: number;
  members: RpgLobbyMember[];
}

export interface RpgBoardEvent {
  v: 1;
  t: "rpg.board";
  re?: string;
  d: { lobbies: RpgLobbyView[]; runs: RpgBoardRun[] };
}

/** Os erros que o servidor devolve em `error.d.code` (mais os das ações do herói, em `reason`). */
export type RpgErrorCode =
  | "rate_limited"
  | "game_disabled"
  | "not_allowed"
  | "internal"
  | "no_hero"
  | "has_hero"
  | "in_run"
  | "training"
  | "not_near"
  | "changed"
  | "refused";
