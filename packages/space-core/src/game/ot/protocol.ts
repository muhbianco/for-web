import { z } from "zod";

import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "../../protocol/messages.ts";
import type { JobTier, Tree } from "./abilities.ts";
import type { PotionCounts } from "./belt.ts";
import { type StatId, type Stats, STAT_MAX, STATS } from "./attributes.ts";
import type { SkillId, VocationId } from "./data.ts";
import type { Gear, Inventory } from "./inventory.ts";
import { type Slot, SLOTS } from "./items.ts";
import type { RunFrame, RunOutcome, RunSupplies } from "./run.ts";
import { MONEY_MAX } from "./shops.ts";
import { type TrainingSkill, TRAINING_SKILLS } from "./training.ts";

/**
 * Comandos do jogo idle na WS do Espaço (docs/espaco/jogo/ot). Prefixo `rpg.`, separado do
 * `game.` do Refúgio (ADR 0009), removido em 23/11/2026. O
 * gateway tenta `parseRpgCommand` antes do parser do mapa.
 */

const env = { v: z.literal(PROTOCOL_VERSION), id: z.string().min(1).max(40) };

/** Pede o estado do herói (abre o jogo; fecha um treino que ficou para trás). */
export const RpgOpenCmd = z.object({
  ...env,
  t: z.literal("rpg.open"),
  d: z.object({}).strict().optional(),
});

/** Escolhe a vocação (só uma vez, enquanto Aprendiz): 1 Feiticeiro, 2 Druida, 3 Arqueiro, 4 Cavaleiro. */
export const RpgVocationCmd = z.object({
  ...env,
  t: z.literal("rpg.vocation"),
  d: z
    .object({
      vocation: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
    })
    .strict(),
});

/** Começa a treinar no dummy `instance` (o herói tem de estar ao lado). */
export const RpgTrainStartCmd = z.object({
  ...env,
  t: z.literal("rpg.train.start"),
  d: z
    .object({
      instance: z.string().min(1).max(40),
      skill: z.enum(TRAINING_SKILLS as [TrainingSkill, ...TrainingSkill[]]),
    })
    .strict(),
});

/** Para de treinar (credita o tempo treinado). */
export const RpgTrainStopCmd = z.object({
  ...env,
  t: z.literal("rpg.train.stop"),
  d: z.object({}).strict().optional(),
});

/** Cria a sala de preparação na TV `tv` para a dungeon (a pessoa tem de estar ao lado da TV). */
export const RpgLobbyCreateCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.create"),
  d: z
    .object({
      tv: z.string().min(1).max(40),
      dungeon: z.string().min(1).max(40),
    })
    .strict(),
});

/** Entra no grupo da TV `tv` (ao lado dela). */
export const RpgLobbyJoinCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.join"),
  d: z.object({ tv: z.string().min(1).max(40) }).strict(),
});

/** Sai do grupo (o líder saindo cancela). */
export const RpgLobbyLeaveCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.leave"),
  d: z.object({}).strict().optional(),
});

/** O líder começa a dungeon. */
export const RpgLobbyStartCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.start"),
  d: z.object({}).strict().optional(),
});

// ---- inventário (etapa O7) ----------------------------------------------------
// Os comandos que apontam uma pilha da mochila levam o índice e o id do item: se a mochila
// mudou entre a tela e o comando, o servidor recusa ("changed") em vez de mexer em outra.

const packRef = {
  index: z.number().int().min(0).max(39),
  item: z.string().min(1).max(40),
};

/** Veste o item da mochila (troca com o que estava no lugar). */
export const RpgEquipCmd = z.object({
  ...env,
  t: z.literal("rpg.equip"),
  d: z.object(packRef).strict(),
});

/** Tira do corpo para a mochila. */
export const RpgUnequipCmd = z.object({
  ...env,
  t: z.literal("rpg.unequip"),
  d: z.object({ slot: z.enum(SLOTS as [Slot, ...Slot[]]) }).strict(),
});

/** Liga ou desliga "escolher o melhor sozinho". */
export const RpgAutoCmd = z.object({
  ...env,
  t: z.literal("rpg.auto"),
  d: z.object({ on: z.boolean() }).strict(),
});

/** Usa a pilha de moedas: 100 viram 1 da de cima, ou 1 vira 100 da de baixo. */
export const RpgCoinsCmd = z.object({
  ...env,
  t: z.literal("rpg.coins"),
  d: z.object(packRef).strict(),
});

/** Joga fora a pilha da mochila. */
export const RpgDiscardCmd = z.object({
  ...env,
  t: z.literal("rpg.discard"),
  d: z.object(packRef).strict(),
});

// ---- NPCs (etapa O8) -----------------------------------------------------------
// Todos levam o NPC da sala (`npc`, a instância da decoração): o servidor confere que ele é
// do tipo certo e que o herói está ao lado.

const npc = z.string().min(1).max(40);
const money = z.number().int().min(0).max(MONEY_MAX);

/** Compra do mercador: `count` unidades do item (empilhável) ou itens (um espaço cada). */
export const RpgShopBuyCmd = z.object({
  ...env,
  t: z.literal("rpg.shop.buy"),
  d: z
    .object({
      npc,
      item: z.string().min(1).max(40),
      count: z.number().int().min(1).max(100),
    })
    .strict(),
});

/** Venda ao mercador: `count` da pilha `index` (o item confere que é a mesma). */
export const RpgShopSellCmd = z.object({
  ...env,
  t: z.literal("rpg.shop.sell"),
  d: z
    .object({ npc, ...packRef, count: z.number().int().min(1).max(100) })
    .strict(),
});

/** Depósito no banqueiro (`amount` 0: todas as moedas que carrega). */
export const RpgBankDepositCmd = z.object({
  ...env,
  t: z.literal("rpg.bank.deposit"),
  d: z.object({ npc, amount: money }).strict(),
});

export const RpgBankWithdrawCmd = z.object({
  ...env,
  t: z.literal("rpg.bank.withdraw"),
  d: z.object({ npc, amount: money.min(1) }).strict(),
});

/** Transferência do saldo do banco para `to` (alguém que está no Espaço e tem vocação). */
export const RpgBankTransferCmd = z.object({
  ...env,
  t: z.literal("rpg.bank.transfer"),
  d: z
    .object({ npc, amount: money.min(1), to: z.string().min(1).max(64) })
    .strict(),
});

/**
 * Evolução de classe no Mestre (24/11/2026): da 1ª para a 2ª (a promoção da etapa O8) e da 2ª
 * para a 3ª. O nome do comando ficou o da promoção.
 */
export const RpgPromoteCmd = z.object({
  ...env,
  t: z.literal("rpg.promote"),
  d: z.object({ npc }).strict(),
});

// ---- poções e filtro de loot (etapa O9) ----------------------------------------

const supplyRule = z
  .object({
    item: z.string().min(1).max(40).nullable(),
    below: z.number().int().min(0).max(95),
  })
  .strict();

/** Quando beber poção de vida e de mana (o limite em %, 0 desliga; a poção ou "a melhor"). */
export const RpgSuppliesCmd = z.object({
  ...env,
  t: z.literal("rpg.supplies"),
  d: z.object({ health: supplyRule, mana: supplyRule }).strict(),
});

/** Pegar ou não pegar um item do loot. */
export const RpgLootSkipCmd = z.object({
  ...env,
  t: z.literal("rpg.lootskip"),
  d: z.object({ item: z.string().min(1).max(40), skip: z.boolean() }).strict(),
});

// ---- o quadro do Idle Hunt -----------------------------------------------------

/** Os grupos abertos nas TVs do Espaço e as partidas rodando (o menu do jogo pede). */
export const RpgBoardCmd = z.object({
  ...env,
  t: z.literal("rpg.board"),
  d: z.object({}).strict().optional(),
});

/** Assistir uma partida que saiu de outra sala (a sala da TV já recebe sem pedir). */
export const RpgRunWatchCmd = z.object({
  ...env,
  t: z.literal("rpg.run.watch"),
  d: z.object({ id: z.string().min(1).max(64) }).strict(),
});

// ---- herói: atributos, árvore e evolução (24/11/2026) ------------------------------

const statAdd = z
  .object(
    Object.fromEntries(
      STATS.map((k) => [k, z.number().int().min(0).max(STAT_MAX).optional()]),
    ) as Record<StatId, z.ZodOptional<z.ZodNumber>>,
  )
  .strict();

/** Põe pontos de atributo (fora da dungeon; o que já foi posto só volta no Mestre). */
export const RpgStatsCmd = z.object({
  ...env,
  t: z.literal("rpg.stats"),
  d: z.object({ add: statAdd }).strict(),
});

/** Põe um ponto de habilidade num adereço da árvore. */
export const RpgLearnCmd = z.object({
  ...env,
  t: z.literal("rpg.learn"),
  d: z.object({ node: z.string().min(1).max(60) }).strict(),
});

/** Redistribui no Mestre: os atributos ou a árvore voltam a ser pontos livres. */
export const RpgResetCmd = z.object({
  ...env,
  t: z.literal("rpg.reset"),
  d: z.object({ npc, what: z.enum(["stats", "tree"]) }).strict(),
});

/** Uma tentativa de refino da arma empunhada, no Ferreiro (24/11/2026). */
export const RpgRefineCmd = z.object({
  ...env,
  t: z.literal("rpg.refine"),
  d: z.object({ npc }).strict(),
});

/** O renascimento da árvore no Mestre, com o adereço que ganha a maestria (24/11/2026). */
export const RpgRebirthCmd = z.object({
  ...env,
  t: z.literal("rpg.rebirth"),
  d: z.object({ npc, node: z.string().min(1).max(80) }).strict(),
});

export const RpgCommand = z.discriminatedUnion("t", [
  RpgOpenCmd,
  RpgVocationCmd,
  RpgTrainStartCmd,
  RpgTrainStopCmd,
  RpgLobbyCreateCmd,
  RpgLobbyJoinCmd,
  RpgLobbyLeaveCmd,
  RpgLobbyStartCmd,
  RpgEquipCmd,
  RpgUnequipCmd,
  RpgAutoCmd,
  RpgCoinsCmd,
  RpgDiscardCmd,
  RpgShopBuyCmd,
  RpgShopSellCmd,
  RpgBankDepositCmd,
  RpgBankWithdrawCmd,
  RpgBankTransferCmd,
  RpgPromoteCmd,
  RpgStatsCmd,
  RpgLearnCmd,
  RpgResetCmd,
  RpgSuppliesCmd,
  RpgLootSkipCmd,
  RpgBoardCmd,
  RpgRunWatchCmd,
  RpgRefineCmd,
  RpgRebirthCmd,
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

/** Uma skill como o app vê: nível, tentativas e o requisito do próximo. */
export interface RpgSkillView {
  level: number;
  tries: number;
  next: number;
}

/** O treino em andamento: o app projeta o progresso pelo relógio com as regras puras. */
export interface RpgTrainingView {
  skill: TrainingSkill;
  instance: string;
  started_at: number;
  budget_ms: number;
  credited_s: number;
}

/** O herói como o app vê (tudo que o app precisa para projetar o treino sem perguntar). */
export interface RpgHeroView {
  vocation: VocationId;
  level: number;
  experience: number;
  /** Vida, mana e capacidade com os atributos (VIT, INT e FOR); `base` é sem eles. */
  health_max: number;
  mana_max: number;
  cap: number;
  base: { health: number; mana: number; cap: number };
  /** 24/11/2026: atributos e pontos livres do level. */
  stats: Stats;
  /** O que os itens vestidos somam aos atributos (já dentro da vida e da mana acima). */
  gear_stats?: Partial<Stats>;
  stat_points: number;
  /** A árvore, os pontos do treino de habilidade (ganhos, livres e o progresso) e a classe. */
  tree: Tree;
  skill_points: { earned: number; free: number; tries: number; next: number };
  job: JobTier;
  /** Quantas vezes já redistribuiu no Mestre (a primeira de cada é de graça). */
  resets: { stats: number; tree: number };
  /** O renascimento da árvore: a maestria de cada adereço e quantas vezes renasceu. */
  mastery?: Record<string, number>;
  rebirths?: number;
  skills: Record<SkillId, RpgSkillView>;
  magic: { level: number; mana_spent: number; next: number };
  stamina: number;
  /** Saldo de treino em ms no instante `bank_at` (enche até 12 h sem treinar). */
  bank_ms: number;
  bank_at: number;
  training: RpgTrainingView | null;
  /** Taxas do servidor em vigor (skill e magia multiplicam as tentativas). */
  rates: { exp: number; skill: number; magic: number; loot: number };
  /** Etapa O7: os 10 lugares do corpo e a mochila (o conteúdo do recipiente vestido). */
  inventory: Inventory;
  /** Espaços do recipiente vestido. */
  pack_size: number;
  /** Peso de tudo, em centésimos de oz; a capacidade é `cap` em oz. */
  weight: number;
  /** Valor das moedas que carrega, em ouro. */
  gold: number;
  /** Etapa O8: saldo no banco, em ouro (não pesa). */
  bank_gold: number;
  /** Etapa O9: quando o herói bebe poção na dungeon e o que ele não pega. */
  supplies: RunSupplies;
  loot_skip: string[];
  /** "Escolher o melhor sozinho" (arma, escudo, armaduras, mochila e munição). */
  auto_equip: boolean;
  /** O que veste agora (o mesmo que entra na dungeon). */
  gear: Gear;
  /** Na dungeon agora: até quando. */
  run: { id: string; dungeon: string; ends_at: number } | null;
}

export interface RpgStateEvent {
  v: 1;
  t: "rpg.state";
  re?: string;
  d: { server_now: number; rev: number; hero: RpgHeroView | null };
}

/** Um membro do grupo como a sala vê. */
export interface RpgLobbyMember {
  user_id: string;
  name: string;
  vocation: VocationId;
  level: number;
}

/** A sala de preparação de uma TV. */
export interface RpgLobbyView {
  tv: string;
  room: string;
  dungeon: string;
  leader: string;
  members: RpgLobbyMember[];
  max: number;
  expires_at: number;
}

/**
 * Estado da sala de uma TV, para quem está na sala do mapa: `lobby` null = não há grupo ali.
 * `started` vem uma vez, quando o líder começa; a corrida chega depois em `rpg.run`.
 */
export interface RpgLobbyEvent {
  v: 1;
  t: "rpg.lobby";
  d: {
    tv: string;
    lobby: RpgLobbyView | null;
    ended?: "started" | "cancelled" | "expired";
    started?: { dungeon: string; members: RpgLobbyMember[] };
  };
}

/** Um herói na corrida, como a sala vê. */
export interface RpgRunMemberView {
  user_id: string;
  name: string;
  vocation: VocationId;
  level: number;
  health_max: number;
  mana_max: number;
  gear: Gear;
  /** As 4 habilidades com a mana e a recarga desta corrida (24/11/2026; a barra da tela). */
  /** `at`: a mana com que a corrida usa a habilidade (custo e reserva da cura); falta nas antigas. */
  skills?: { id: string; mana: number; cd_ms: number; at?: number }[];
  /** Quando bebe poção nesta corrida (o limite marca o cristal de vida e o de mana). */
  supplies?: RunSupplies;
  /** Quanto vale cada ponto de experiência crua no fim (taxa, level baixo e stamina). */
  exp_rate?: number;
}

/** Uma corrida de dungeon (etapa O5): quem, onde e quando acaba. */
export interface RpgRunView {
  id: string;
  tv: string;
  room: string;
  dungeon: string;
  started_at: number;
  ends_at: number;
  members: RpgRunMemberView[];
}

/** O que cada um levou, no fim (null em `reward`: caiu e perdeu a recompensa). */
export interface RpgRunEndView {
  outcome: RunOutcome;
  members: {
    user_id: string;
    dead: boolean;
    /** Etapa O7: munição gasta e anéis ou colares que acabaram (mesmo quem caiu). */
    spent?: { item: string; count: number }[];
    /** Etapa O7: o que não coube e ficou no corpo. */
    left?: { item: string; count: number }[];
    reward: {
      exp: number;
      gold: number;
      loot: { item: string; count: number }[];
      tries: Partial<Record<SkillId, number>>;
      mana_spent: number;
    } | null;
  }[];
}

/** Acontecimento do registro com o segundo em que aconteceu. */
export type RpgRunFeedItem = RunFrame["e"][number] & { at: number; st: number };

/**
 * A corrida inteira até agora, para quem chega (entrou na sala, abriu o app, começou): o
 * último quadro (`frame` null se a corrida veio de outra versão das regras) e o registro
 * recente. `end` vem quando a corrida acaba.
 */
export interface RpgRunEvent {
  v: 1;
  t: "rpg.run";
  d: {
    run: RpgRunView;
    frame: RunFrame | null;
    feed: RpgRunFeedItem[];
    /**
     * 24/11/2026: as poções de cada herói (pelo índice) no fim de `frame`; o app segue com os
     * quadros que chegam depois (belt.ts).
     */
    potions?: PotionCounts[];
    /** A experiência crua de cada herói até `frame` (a barra da tela; entra no fim). */
    exp?: number[];
    end?: RpgRunEndView;
  };
}

/** Uma partida rodando, para a lista do menu. */
export interface RpgBoardRun {
  id: string;
  dungeon: string;
  room: string;
  tv: string;
  started_at: number;
  ends_at: number;
  members: RpgLobbyMember[];
}

/** O quadro: os grupos que estão se formando e as partidas rodando neste Espaço. */
export interface RpgBoardEvent {
  v: 1;
  t: "rpg.board";
  re?: string;
  d: { lobbies: RpgLobbyView[]; runs: RpgBoardRun[] };
}

/** Os segundos que passaram desde o último envio (normalmente um). */
export interface RpgRunTickEvent {
  v: 1;
  t: "rpg.run.tick";
  d: { id: string; frames: RunFrame[] };
}
