import type { ClassId } from "../content.ts";
import type { HeroStats } from "../formulas.ts";

/**
 * Tipos do combate da engine nova (spec §5): elementos de dano, efeitos de skill como dado (§0.3) e o
 * que entra e sai de uma luta. A engine interpreta efeitos por tipo; as skills são conteúdo
 * (skills/*.ts) e chegam aqui já "compiladas" com as escolhas do jogador (skills/compile.ts).
 */

/**
 * Físico: ATQ contra DEF, pode errar e criticar. Mágico: MATQ contra MDEF, nunca erra (e no gabarito
 * não critica). Sagrado (paladino): ATQ contra MDEF, não erra nem critica. Verdadeiro: só mecânica de
 * chefe, ignora tudo.
 */
export type Element = "fisico" | "magico" | "sagrado";

/** Famílias de monstro (§11.2), para bônus de skill. */
export type Family =
  | "fera"
  | "humanoide"
  | "morto-vivo"
  | "sombrio"
  | "elemental"
  | "dragao"
  | "aberracao";

export interface DamagePart {
  element: Element;
  /** Multiplicador sobre ATQ (físico e sagrado) ou MATQ (mágico). */
  coef: number;
}

/**
 * Em quem o dano cai: o alvo da vez; todos; o alvo e mais `hops` saltos perdendo `falloff` por salto
 * (Raio em Cadeia); até `max` em linha (Tiro Perfurante); inimigos sorteados a cada golpe (Dança das
 * Lâminas); o primeiro da fila (Armadilha de Gelo).
 */
export type Targeting =
  | "alvo"
  | "area"
  | "primeiro"
  | "aleatorios"
  | { kind: "cadeia"; hops: number; falloff: number }
  | { kind: "linha"; max: number };

/** Atributos que um buff mexe no herói ou no grupo. */
export type BuffStat =
  /** Dano recebido −x (todo tipo; só físico; só mágico; só golpe certeiro). */
  | "reducao"
  | "reducaoFisica"
  | "reducaoMagica"
  | "reducaoCerteiro"
  /** Dano causado +x. */
  | "dano"
  /** ATQ e MATQ +x (Estandarte de Guerra). */
  | "poder"
  /** Crítico plano +x e multiplicador de crítico +x. */
  | "critico"
  | "multCritico"
  /** Fuga × (1 + x) e esquiva plana +x (Esquiva Sombria). */
  | "fuga"
  | "esquiva"
  /** Precisão × (1 + x) (Bênção). */
  | "precisao"
  /** HP máximo +x (Última Resistência): sobe o máximo e o atual. */
  | "hpMaxPct"
  /** Cura recebida +x. */
  | "curaRecebida"
  /** Regeneração de x da MP/HP máxima por segundo. */
  | "regenManaPct"
  | "regenVidaPct";

/** Atributos que um debuff mexe no inimigo. */
export type DebuffStat =
  /** O inimigo causa −x de dano. */
  | "danoCausado"
  /** O inimigo recebe +x de dano de todas as fontes (Marca do Caçador). */
  | "danoRecebido"
  /** O inimigo ataca x mais devagar. */
  | "velocidade"
  /** Precisão do inimigo −x (Fumaça, Clarão). */
  | "precisao"
  /** DEF do inimigo −x (Quebra-Guarda). */
  | "defesa";

/** Escopo de efeitos no inimigo. */
export type EnemyScope = "alvo" | "area";

export type Effect =
  | {
      type: "dano";
      parts: DamagePart[];
      /** Golpes iguais em sequência (cada um rola erro e crítico). */
      hits?: number;
      critFlat?: number;
      /** Crítico plano a mais só no último golpe (Golpe Final). */
      lastHitCritFlat?: number;
      critMult?: number;
      /** Ignora esta fração da defesa do alvo (soma com a da arma). */
      penetration?: number;
      /** Crítico garantido se o alvo não estiver atacando o herói (no gabarito, limitado ao teto de 70%). */
      ambush?: boolean;
      targets?: Targeting;
      /** × mult contra estas famílias (Luz Sagrada contra mortos-vivos e sombrios). */
      vsFamilies?: { families: Family[]; mult: number };
    }
  | {
      type: "dot";
      element: Element;
      coefPerSec: number;
      durationMs: number;
      targets?: EnemyScope;
      /** Veneno: o traço do assassino soma +20%. */
      poison?: boolean;
      /** Quantas aplicações acumulam no mesmo alvo (padrão: renova). */
      stacks?: number;
      /** A cada pulso (1 s), chance de atordoar lacaio/elite (Congelar). */
      tickStun?: { chance: number; durationMs: number };
      /**
       * Enquanto o DoT queima, cada inimigo atingido cura quem conjurou em x do HP máximo por segundo
       * (Consagração, P63).
       */
      selfHealPctMaxHpPerSec?: number;
    }
  | {
      type: "cura";
      target: "aliado" | "grupo" | "proprio";
      coefMatk?: number;
      pctMaxHp?: number;
      /** Cura sem os bônus de cura de quem conjura (Imposição de Mãos, Última Resistência). */
      noBonus?: boolean;
    }
  | {
      type: "hot";
      target: "aliado" | "grupo";
      coefMatkPerSec?: number;
      /** HoT em fração do HP máximo do alvo por segundo (Terra Santa). */
      pctMaxHpPerSec?: number;
      durationMs: number;
      /** Quantas vezes acumula no mesmo alvo (Rejuvenescer: 2). */
      stacks?: number;
    }
  | {
      type: "escudo";
      target: "proprio" | "alvo-do-chefe" | "grupo" | "aliado";
      pctMaxHp?: number;
      coefMatk?: number;
      durationMs: number;
    }
  | { type: "escudoDeMana"; pct: number; durationMs: number }
  | {
      type: "buff";
      target: "proprio" | "grupo";
      stat: BuffStat;
      value: number;
      durationMs: number;
      /** Buffs do mesmo grupo se sobrescrevem; sem grupo, cada skill tem o seu e eles multiplicam. */
      group?: string;
    }
  | {
      type: "debuff";
      stat: DebuffStat;
      value: number;
      /** Valor contra chefe (Raízes: −25% nos lacaios, −12% no chefe). */
      bossValue?: number;
      durationMs: number;
      targets?: EnemyScope;
      group?: string;
    }
  | {
      type: "atordoar";
      durationMs: number;
      targets?: EnemyScope;
      /** Quantos inimigos no máximo (Armadilha: 1 + Estilhaços). */
      max?: number;
      /** Chance (1 = sempre). Chefe nunca é atordoado. */
      chance?: number;
    }
  | { type: "provocar"; durationMs: number; scope: "alvo" | "sala" }
  | { type: "cortaAmeaca"; pct: number }
  | { type: "reviver"; hpPct: number }
  | {
      type: "purificar";
      target: "aliado" | "grupo";
      count: number;
      /** Repete a cada N ms durante a duração (Santuário: 1 a cada 2 s por 8 s). */
      everyMs?: number;
      durationMs?: number;
      chance?: number;
    };

/** As condições da IA (spec §5): o herói só usa a skill quando a condição vale. */
export type Condition =
  | { kind: "sempre" }
  | { kind: "soEmChefe" }
  | { kind: "inimigos"; min: number }
  | { kind: "aliadoAbaixo"; pct: number }
  /** Pelo menos `min` aliados abaixo de `pct` (Intervenção Divina, Florescer). */
  | { kind: "aliadosAbaixo"; pct: number; min: number }
  | { kind: "aliadoComMpAbaixo"; pct: number }
  /**
   * Cura inteligente (D25): a cura desta skill rende em alguém. Compara a cura estimada com o HP que
   * falta em cada aliado (descontado o HoT que já vai entrar); o tanque vem primeiro quando precisa.
   */
  | { kind: "precisaCura" }
  | { kind: "aliadoAmaldicoado" }
  | { kind: "aliadoCaido" }
  | { kind: "meuHpAbaixo"; pct: number }
  | { kind: "chefePreparando" }
  | { kind: "perdiAggro" }
  | { kind: "sendoAlvo" };

/**
 * Efeitos de adereço que agem durante a luta (os que só mudam números entram já somados no efeito).
 * `chance` e os valores já vêm multiplicados pelos ups do jogador.
 */
export type SkillHook =
  /**
   * Ao acertar (cada golpe), chance de disparar os efeitos (Seta Dupla, Julgamento, Clarão). Com
   * `spread`, os efeitos caem em outro inimigo vivo (Espinheiro, Flecha Perfurante).
   */
  | { on: "acerto"; chance: number; effects: Effect[]; spread?: boolean }
  /** Ao bloquear, chance de zerar a recarga desta skill (Revide). */
  | { on: "bloqueio"; chance: number; resetCooldown: true }
  /** Ao esquivar, chance de contra-atacar (Contra-Ataque). */
  | { on: "esquiva"; chance: number; effects: Effect[] }
  /** +x de dano/cura quando a condição vale (Lâminas Giratórias, Combustão, Prece, Sobrecarga, Expurgo). */
  | {
      on: "bonus";
      when:
        | "3+inimigos"
        | "alvoAbaixo35"
        | "alvoAcima70"
        | "aposBloqueio"
        | "familia";
      families?: Family[];
      value: number;
    }
  /** Cada acerto tira x s da recarga das outras skills (Fluxo). */
  | { on: "fluxo"; seconds: number }
  /** x do dano causado cura quem bateu (Luz Purificadora) ou o aliado com menos HP (Penitência). */
  | { on: "danoCura"; pct: number; target: "proprio" | "menorHp" }
  /** Cada inimigo atingido cura x do HP máximo (Fôlego). */
  | { on: "porInimigo"; healPctMaxHp: number }
  /** x da cura que sobra vira escudo no alvo (Luz Remanescente). */
  | { on: "sobracura"; shieldPct: number }
  /** O escudo, ao quebrar, causa x do absorvido como dano sagrado: em área ou em quem bateu. */
  | { on: "escudoQuebra"; pct: number; targets: "area" | "atacante" }
  /** x do escudo vai também ao aliado com menos HP (Égide Compartilhada). */
  | { on: "escudoDivide"; pct: number }
  /** Reflete x do dano recebido enquanto o buff dura (Espinhos de Aço). */
  | { on: "reflete"; pct: number }
  /** x da mana gasta pelo escudo de mana volta no fim (Retorno Arcano). */
  | { on: "manaVolta"; pct: number }
  /** Uma vez por luta, um golpe fatal com a skill pronta deixa o herói com 1 HP e a dispara (5/5). */
  | { on: "recusaMorte" }
  /** Sempre crítico em alvos abaixo de x do HP (Disparo Fatal 5/5). */
  | { on: "criticoAbaixo"; pct: number }
  /** Uma 2ª conjuração com x do dano, logo depois (Chuva de Meteoros 5/5; Katar Bicéfalo). */
  | { on: "repete"; pct: number }
  /** Chance de a skill não gastar mana (Cajado da Aurora). */
  | { on: "semCusto"; chance: number };

export interface SkillDef {
  id: string;
  name: string;
  /** Recarga já com os cortes fixos (adereços de −x s). */
  cooldownMs: number;
  /**
   * Cortes percentuais da própria skill (Eficiência, Potência de apoio) e a recarga original, para o
   * piso de 50% da base (§7). Sem eles, vale só a recarga global.
   */
  ownCooldownCut?: number;
  baseCooldownMs?: number;
  /** Custo em fração da mana-base da classe. */
  manaPct: number;
  /** Multiplicador extra de ameaça sobre o dano desta skill (Golpe Provocador ×2). */
  threatMult?: number;
  /** Basta uma valer (OU). */
  condition: Condition | Condition[];
  /** Conjuração: os efeitos caem depois deste tempo (Meteoro: 2 s). */
  castMs?: number;
  effects: Effect[];
  hooks?: SkillHook[];
}

/** Um herói na luta: os derivados já calculados, o kit na ordem de prioridade e as poções. */
export interface FighterInput {
  cls: ClassId;
  stats: HeroStats;
  role: "tanque" | "suporte" | "dps";
  skills: SkillDef[];
  /**
   * Rank de Potência (+5% por rank acima do 1) aplicado na hora da luta. Skills já compiladas com a
   * Potência de cada uma vêm com 1 aqui.
   */
  potencyRank: number;
  /** Traço da classe (§6). */
  lifesteal?: number;
  blockBonus?: number;
  healBonus?: number;
  hotBonus?: number;
  poisonBonus?: number;
  /** Auto-ataque mágico (fração do MATQ) para armas mágicas. */
  magicAutoAttack?: number;
  /**
   * Cura de cada poção e o estoque. Sem `hpStock`/`mpStock` o estoque é um só (o gabarito); com eles,
   * vida e mana têm cada uma o seu (o herói de verdade, Fase 8).
   */
  potions: {
    hp: number;
    mp: number;
    stock: number;
    hpStock?: number;
    mpStock?: number;
    /** Recarga depois de beber, por tipo (D35: a poção maior demora mais); sem ela, a do config. */
    hpCooldownMs?: number;
    mpCooldownMs?: number;
  };
  /** Limiares de poção (fração): vida antes de mana. */
  potionAt?: { hp: number; mp: number };
}

export type ArchetypeKey =
  | "lacaio"
  | "elite"
  | "chefeMenor"
  | "chefe"
  | "regional";

/** Um inimigo: os números já gerados (Fase 6 gera; aqui chegam prontos). */
export interface EnemyInput {
  archetype: ArchetypeKey;
  level: number;
  hp: number;
  family?: Family;
  /** Golpe bruto (antes da defesa do herói) e ataques por segundo. */
  autoRaw: number;
  attacksPerSecond: number;
  /** Auto-ataque mágico (lacaios mágicos a partir da região 2). */
  magicAuto?: boolean;
  /** Golpe Pesado: múltiplo do golpe, certeiro, no alvo. */
  buster?: { everySeconds: number; mult: number };
  /** Pulso Sombrio: mágico, em todos. */
  pulse?: { everySeconds: number; raw: number };
  /** Cataclismo: fração do HP máximo de cada herói, dano verdadeiro. */
  cataclysm?: { atSeconds: number; pct: number; everySeconds: number };
  /** Maldição (§12.3, desde o 40): um não tanque perde x do HP máx./s até ser purificado (no máx. N s). */
  curse?: { everySeconds: number; pctPerSecond: number; maxSeconds: number };
  /** Invocação (desde o 70): `count` lacaios do nível do chefe a cada N s. */
  summon?: { everySeconds: number; count: number; minion: EnemyInput };
  /** Drenar Mana (desde o 100): conjuradores perdem x da MP máx./s por N s. */
  manaDrain?: {
    everySeconds: number;
    pctPerSecond: number;
    durationSeconds: number;
  };
  /** Investida (desde o 100): golpe × mult num não tanque sorteado, não provocável. */
  charge?: { everySeconds: number; mult: number };
  /** Fases (desde o 150): abaixo de `at` do HP, dano × damageMult e intervalos × intervalMult. */
  phase?: { at: number; damageMult: number; intervalMult: number };
  /** Fase final do Chefe de Região: abaixo de `at`, x do HP máx. de cada herói a cada N s (verdadeiro). */
  finalPhase?: { at: number; pct: number; everySeconds: number };
}

/** O que passa de uma sala para a outra (HP, mana, poções, recargas que faltam). */
export interface HeroCarry {
  hp: number;
  mp: number;
  alive: boolean;
  pots: number;
  /** Estoques separados (quando o lutador os tem). */
  hpPots?: number;
  mpPots?: number;
  /** Segundos que faltam de cada recarga. */
  cooldowns: Record<string, number>;
  revived: boolean;
  cheatedDeath: boolean;
}

export interface FightOptions {
  /** Teto da luta em segundos. */
  maxSeconds: number;
  /** "esperado" = valor médio de cada rolagem (calibragem e paridade); "aleatorio" = rolagens de verdade. */
  mode: "esperado" | "aleatorio";
  /** Fonte de números em [0, 1) para o modo aleatório. */
  random?: { next(): number };
  /** Estado de cada herói vindo da sala anterior (corrida de várias salas). */
  carry?: (HeroCarry | undefined)[];
  /** Grava um quadro por segundo para a tela da corrida (custa um pouco; o simulador não liga). */
  record?: boolean;
}

export interface FighterResult {
  cls: ClassId;
  damage: number;
  autoDamage: number;
  healed: number;
  hpPct: number;
  potionsUsed: number;
  /** Ataques básicos (o caçador gasta 1 munição por ataque). */
  autos: number;
  /** Poções bebidas de cada tipo (o total é `potionsUsed`). */
  hpPotions: number;
  mpPotions: number;
  alive: boolean;
  /** Quantas vezes cada skill saiu. */
  casts: Record<string, number>;
  /** Ameaça no fim, em cada inimigo (na ordem de `enemiesLeft`, invocados no fim). */
  threat: number[];
  /** Estado no fim, para a próxima sala. */
  carry: HeroCarry;
}

/** Atores nos eventos da tela: heróis pelo índice (0–3), inimigos por 100 + índice na luta. */
export const FOE_BASE = 100;

/** Mecânica de chefe anunciada na tela (§12.3). */
export type MechanicEvent =
  | "golpe-pesado"
  | "pulso"
  | "maldicao"
  | "invocacao"
  | "dreno"
  | "investida"
  | "fase";

/**
 * Um evento da luta para a tela da corrida (Fase 8). Dano e cura vêm somados por segundo, por autor,
 * alvo e origem ("auto" = ataque básico; senão o id da skill ou da mecânica).
 */
export type FightEvent =
  /** Ataque básico (herói ou monstro); `bl`: o herói esquivou ("erro") ou bloqueou. */
  | { k: "golpe"; a: number; b: number; v: number; bl?: "erro" | "bloqueio" }
  /** Skill de herói ou mecânica de monstro; `cura` quando curou. */
  | { k: "magia"; a: number; b: number; v: number; s: string; cura?: true }
  /** O herói soltou a skill (aparece mesmo quando ela não dá dano nem cura). */
  | { k: "lanca"; a: number; s: string }
  /** `xp`: o XP que cada herói levou deste abate (a corrida preenche; sem o bônus de fim). */
  | { k: "abate"; b: number; xp?: number[] }
  | { k: "queda"; b: number }
  | { k: "pocao"; a: number; v: number; mana?: true }
  | { k: "mecanica"; a: number; s: MechanicEvent; b?: number }
  /** O Cataclismo como buff do chefe que cresce: `n` marcas (uma por pulso; D24). */
  | { k: "cataclismo"; a: number; n: number };

/** O estado no fim de um segundo da luta: vida e mana dos heróis, vida de cada inimigo. */
export interface FightFrame {
  /** O segundo da luta (1, 2, …). */
  s: number;
  h: number[];
  m: number[];
  x: number[];
  e: FightEvent[];
}

/** Um inimigo abatido: quem estava de pé na hora divide o XP e o ouro (D4). */
export interface KillEvent {
  /** Índice do inimigo na luta (os invocados vêm depois dos da sala). */
  enemy: number;
  archetype: ArchetypeKey;
  level: number;
  seconds: number;
  /** Veio da Invocação do chefe: não dá XP, ouro nem loot (P65). */
  summoned: boolean;
  /** Quem estava vivo no abate, na ordem dos heróis. */
  alive: boolean[];
}

export interface FightResult {
  win: boolean;
  seconds: number;
  deaths: number;
  firstDeath: {
    seconds: number;
    cls: ClassId;
    cause: "golpe" | "cataclismo" | "mecanica";
  } | null;
  damage: number;
  /** Fração de HP que sobrou em cada inimigo. */
  enemiesLeft: number[];
  /** Os abates, na ordem em que aconteceram. */
  kills: KillEvent[];
  /** Com `record`: um quadro por segundo. */
  frames?: FightFrame[];
  heroes: FighterResult[];
}
