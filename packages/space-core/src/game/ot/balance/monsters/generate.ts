import type { ArchetypeKey, EnemyInput, Family } from "../combat/types.ts";
import {
  type Balance,
  type DungeonType,
  balance as gameBalance,
} from "../formulas.ts";
import { createReference } from "../reference.ts";
import { type SimOptions, createEncounters } from "../sim/encounters.ts";
import { MONSTER_TABLE } from "./table.generated.ts";

/**
 * O gerador de monstros (spec §0.4 e §11): o status de cada arquétipo no nível m sai das MESMAS
 * fórmulas de jogador, aplicadas aos perfis de referência — com as skills de verdade, as regras de
 * tier e a IA do gabarito no perfil (P39). O que custa simular (DPS de referência) e os golpes ficam
 * numa tabela gerada (scripts/gen-monsters.ts → table.generated.ts), versionada; o jogo só lê.
 */

/** As referências que calibram os monstros (as 42 skills, tier certo, Potência esperada). */
export const MONSTER_REFERENCE: SimOptions = {
  source: "spec",
  referenceAi: "gabarito",
};

export interface MonsterRow {
  /** DPS_solo_ref(m): média de mago, caçador e assassino em alvo único, 60 s. */
  soloDps: number;
  /** DPS_grupo_ref(m): guerreiro + padre + mago + caçador, 80 s. */
  partyDps: number;
  /** Golpes brutos (antes da defesa do herói). */
  lacaioHit: number;
  menorHit: number;
  bossHit: number;
  pulse: number;
}

/** Calcula a linha do nível m (é o que o script grava na tabela). */
export function computeMonsterRow(
  m: number,
  B: Balance = gameBalance,
): MonsterRow {
  const E = createEncounters(B);
  const R = createReference(B);
  const hits = R.monsterHits(m);
  return {
    soloDps: E.referenceSoloDps(m, MONSTER_REFERENCE),
    partyDps: E.referencePartyDps(m, MONSTER_REFERENCE),
    lacaioHit: hits.lacaio,
    menorHit: hits.chefeMenor,
    bossHit: hits.chefe,
    pulse: hits.pulso,
  };
}

export interface MonsterOptions {
  /** Tamanho do grupo (a escala; Masmorra e Regional usam no mínimo 3). */
  partySize: number;
  type: DungeonType;
  family?: Family;
  magic?: boolean;
}

export function createMonsters(
  B: Balance = gameBalance,
  /** A tabela gerada; com um config afinado, passe `null` para calcular na hora. */
  table: readonly MonsterRow[] | null = B === gameBalance
    ? MONSTER_TABLE
    : null,
) {
  const cfg = B.cfg;
  const mon = cfg.monsters;
  const mech = cfg.bossMechanics;
  const cache = new Map<number, MonsterRow>();

  function row(m: number): MonsterRow {
    const lv = Math.max(1, Math.min(cfg.levels.maxLevel, Math.round(m)));
    const fromTable = table?.[lv];
    if (fromTable) return fromTable;
    let r = cache.get(lv);
    if (!r) {
      r = computeMonsterRow(lv, B);
      cache.set(lv, r);
    }
    return r;
  }

  const base = (
    archetype: ArchetypeKey,
    m: number,
    o: MonsterOptions,
    hp: number,
    autoRaw: number,
  ): EnemyInput => ({
    archetype,
    level: m,
    hp,
    autoRaw,
    attacksPerSecond: cfg.archetypes[archetype].aps,
    ...(o.family ? { family: o.family } : {}),
    ...(o.magic ? { magicAuto: true } : {}),
  });

  /**
   * Golpe de lacaio e elite pelo conteúdo: na Caçada cai (D17); nas salas de Masmorra e Região sobe
   * (D28, para a sala sem tanque cobrar). O lacaio da Invocação fica com o golpe do spec.
   */
  const roomHitMult = (
    o: MonsterOptions,
    summoned: boolean,
    arch: "lacaio" | "elite" = "lacaio",
  ): number =>
    o.type !== "cacada"
      ? summoned
        ? 1
        : mon.groupHitMult[arch]
      : o.partySize <= 1
        ? mon.huntHitMult.solo
        : mon.huntHitMult.duo;

  /**
   * Lacaio: HP = 3 s × DPS_solo_ref × escala(n) (o spec; D22); golpe = 6% do HP do caçador ÷
   * (1 − redução dele), × o redutor da Caçada.
   */
  function lacaio(m: number, o: MonsterOptions, summoned = false): EnemyInput {
    const r = row(m);
    return base(
      "lacaio",
      m,
      o,
      mon.lacaioHpSeconds * r.soloDps * B.partyScale(o.partySize, o.type),
      r.lacaioHit * roomHitMult(o, summoned),
    );
  }

  /** Elite: 4× o HP (o spec; D22) e 1,8× o golpe do lacaio. */
  function elite(m: number, o: MonsterOptions): EnemyInput {
    const l = lacaio(m, o, true);
    return base(
      "elite",
      m,
      o,
      mon.eliteHpMult * l.hp,
      mon.eliteHitMult * row(m).lacaioHit * roomHitMult(o, false, "elite"),
    );
  }

  /** Chefe menor da Caçada: 25 s do DPS solo de referência × escala(n); Cataclismo aos 120 s. */
  function chefeMenor(m: number, o: MonsterOptions): EnemyInput {
    const r = row(m);
    return {
      ...base(
        "chefeMenor",
        m,
        o,
        mon.menorHpSeconds * r.soloDps * B.partyScale(o.partySize, o.type),
        r.menorHit,
      ),
      cataclysm: {
        atSeconds: mon.menorCataclysmAtSeconds,
        pct: mon.cataclysmPct,
        everySeconds: mon.cataclysmEverySeconds,
      },
    };
  }

  /** As mecânicas da faixa do chefe (§12.3). */
  function bandMechanics(m: number, o: MonsterOptions): Partial<EnemyInput> {
    const out: Partial<EnemyInput> = {};
    if (m >= mech.curseFrom) out.curse = { ...mech.curse };
    if (m >= mech.summonFrom)
      out.summon = {
        ...mech.summon,
        minion: lacaio(m, { ...o, magic: false }, true),
      };
    if (m >= mech.drainFrom) out.manaDrain = { ...mech.manaDrain };
    // Investida: o multiplicador do config vale sobre o golpe do chefe menor (D16); o motor multiplica o do chefe.
    if (m >= mech.chargeFrom) {
      const r = row(m);
      out.charge = {
        everySeconds: mech.charge.everySeconds,
        mult: (mech.charge.mult * r.menorHit) / r.bossHit,
      };
    }
    if (m >= mech.phaseFrom) out.phase = { ...mech.phase };
    return out;
  }

  /** Chefe de masmorra: 80 s do DPS de grupo de referência × escala(n) ÷ 3,25, com as mecânicas da faixa. */
  function chefe(m: number, o: MonsterOptions): EnemyInput {
    const r = row(m);
    const scale = B.partyScale(o.partySize, "masmorra");
    return {
      ...base(
        "chefe",
        m,
        o,
        (mon.masmorraHpSeconds * r.partyDps * scale) / mon.masmorraHpDivisor,
        r.bossHit,
      ),
      buster: { everySeconds: mon.busterEverySeconds, mult: mon.busterMult },
      pulse: { everySeconds: mon.pulseEverySeconds, raw: r.pulse },
      cataclysm: {
        atSeconds: mon.cataclysmAtSeconds,
        pct: mon.cataclysmPct,
        everySeconds: mon.cataclysmEverySeconds,
      },
      ...bandMechanics(m, o),
    };
  }

  /** Chefe de Região: o chefe de masmorra com 3 fases (100–50–25%) e todas as mecânicas da faixa. */
  function regional(m: number, o: MonsterOptions): EnemyInput {
    return {
      ...chefe(m, o),
      archetype: "regional",
      phase: { ...mech.phase },
      finalPhase: { ...mech.regionalFinal },
    };
  }

  return { row, lacaio, elite, chefeMenor, chefe, regional };
}

export type Monsters = ReturnType<typeof createMonsters>;
