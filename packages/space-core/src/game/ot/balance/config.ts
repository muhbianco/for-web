/**
 * Todas as constantes do rebalanceamento do Idle Hunt, num lugar só (spec de 25/11/2026, §0.2; docs
 * do muchat em espaco/jogo/ot/balance). As fórmulas (formulas.ts) recebem este objeto em
 * createBalance(): um simulador afina uma cópia (structuredClone) em vez de mexer em estado global.
 *
 * Os números vêm do spec e do gabarito em Python que o calibrou (idlehunt_sim_referencia.py).
 * Mudar um deles exige rodar os invariantes da §14 de novo (balance/*.test.ts).
 */
export const BALANCE = {
  levels: {
    /** Nível do herói (DGs). */
    maxLevel: 500,
    /** Nível de job (30% da experiência do nível). */
    maxJob: 150,
    /** Proficiência, o nível base do Dojô. */
    maxProficiency: 5000,
  },

  /** §3: todos começam em 1; 5 pontos por nível acima do 1; a escada sobe a cada 10 a partir do 51. */
  attributes: {
    start: 1,
    pointsPerLevel: 5,
    /** O primeiro valor que custa 2 pontos. */
    ladderFrom: 51,
    ladderStep: 10,
  },

  /** §2 e §4.1: Proficiência. */
  proficiency: {
    /** A recomendada é 10 × nível; a efetiva trava em 10 × nível + 250 (o excedente fica guardado). */
    perLevel: 10,
    effectiveSlack: 250,
    xpPerSecond: 10,
    /** +5% por outro herói treinando na mesma sala, até +25% (incentivo social). */
    socialPerHero: 0.05,
    socialMax: 0.25,
    /** XP para o próximo: 170 + 0,55 · b^1,2. */
    xpBase: 170,
    xpCoef: 0.55,
    xpExp: 1.2,
  },

  /** §4.1: N(x) = 12·√x − 0,05·x, o atributo principal esperado no nível x. */
  normalizer: { sqrtCoef: 12, linearCoef: 0.05 },

  /** §4.2: quanto cada ponto de atributo vale nos derivados. */
  derived: {
    /** Fatores do status de ATQ/MATQ: principal 2, secundário 0,4 (0,3 na magia), SOR 0,3, nível 0,5. */
    statusPrimary: 2,
    statusSecondary: 0.4,
    statusMagicSecondary: 0.3,
    statusLuck: 0.3,
    statusLevel: 0.5,
    /** +1% do ATQ/MATQ da arma por ponto do atributo de escala. */
    weaponScalePerPoint: 0.01,
    /** +1% de HP por VIT e de MP por INT. */
    hpPerVit: 0.01,
    mpPerInt: 0.01,
    defPerVit: 0.5,
    mdefPerInt: 0.5,
    /** Precisão = DES + 0,3·SOR + 0,2·nível. */
    hitPerDes: 1,
    hitPerLuck: 0.3,
    hitPerLevel: 0.2,
    /** Fuga = AGI + 0,2·SOR. */
    fleePerAgi: 1,
    fleePerLuck: 0.2,
    /** Rating de crítico = SOR + 0,2·DES. */
    critPerLuck: 1,
    critPerDes: 0.2,
  },

  /** §4.3: redução = DEF / (DEF + K(nível do atacante)), K(x) = 50 + 6·x. */
  defense: {
    kBase: 50,
    kPerLevel: 6,
    heroPhysicalCap: 0.75,
    monsterPhysicalCap: 0.6,
    magicCap: 0.6,
    /** §4.4: DEF × buffs × debuffs no inimigo, somados, nunca passam disso. */
    finalCap: 0.85,
  },

  crit: { base: 0.01, curveCap: 0.5, hardCap: 0.7, multiplier: 1.5 },

  avoid: {
    dodgeCurveCap: 0.6,
    perfectCurveCap: 0.15,
    hardCap: 0.6,
    /** Cercado por mais de 2, a Fuga cai 10% por atacante, até a metade. */
    crowdFrom: 2,
    crowdStep: 0.1,
    crowdFloor: 0.5,
  },

  heroMiss: { curveCap: 0.4 },

  /** Golpe mínimo = 55% + 40% × DES / (DES + 150) do máximo. */
  minRoll: { base: 0.55, span: 0.4, k: 150 },

  /** Velocidade = ataques/s da arma × (1 + min(150%, hyper(AGI, 120, 120%) + afixos)). */
  haste: { k: 120, curveCap: 1.2, hardCap: 1.5 },

  /** Recarga global = min(40%, hyper(DES, 150, 30%) + arma + afixos); a final nunca abaixo de 50% da base. */
  cooldown: { k: 150, curveCap: 0.3, hardCap: 0.4, floorOfBase: 0.5 },

  /** §5: Δ = herói − monstro; dano causado × (1 + 1,2%·Δ), recebido × (1 − 1,2%·Δ), até ±36%. */
  levelDiff: { step: 0.012, cap: 0.36 },

  /** §5: bloqueio de escudo. */
  block: { chance: 0.1, reduce: 0.6 },

  /** §5: regeneração. HP em combate = 0. */
  regen: {
    mpPctPerSecond: 0.004,
    mpPerIntPerSecond: 0.05,
    outOfCombatPctPerSecond: 0.02,
  },

  /** §5: ameaça. */
  threat: {
    /** O monstro troca de alvo quando alguém passa de 110% da ameaça do alvo atual. */
    switchAt: 1.1,
    /** Provocar põe a ameaça do tanque em 150% da maior da lista. */
    tauntTop: 1.5,
    /** A cura gera 0,5 × cura ÷ aliados vivos de ameaça, em todos os monstros engajados. */
    healShare: 0.5,
    /** "Segurar explosão": skill com multiplicador ≥ 300% espera se a ameaça passar de 80% da do tanque. */
    burstGuard: 0.8,
    burstMultiplierFrom: 3,
  },

  /** §5: poções. 1 por segundo, compartilhado entre vida e mana. */
  potions: {
    cooldownMs: 1000,
    /**
     * Níveis das faixas. O spec tinha 1, 20, 50, 100 e daí a cada 50; o 10, o 35 e o 75 entraram
     * (decisão do dono de 25/11/2026, P29): no fim das faixas largas o mago perdia o solo contra o
     * chefe menor (L18–19, L44–49, L89–99), porque a poção ficava pequena perto do HP dele.
     */
    tiers: [1, 10, 20, 35, 50, 75, 100, 150, 200, 250, 300, 350, 400, 450, 500],
    /** Vida = 6% do HP do caçador de referência no nível do tier. */
    hpPctOfReference: 0.06,
    /** Mana = 4% da mana-base do mago no nível do tier. */
    mpPctOfMageBase: 0.04,
    /** §10: preço = ⌈fração × ouroLacaio(tier)⌉. */
    hpPriceOfGold: 0.25,
    mpPriceOfGold: 0.3,
  },

  /** §7: habilidades. */
  skills: {
    gcdMs: 1000,
    potencyMax: 20,
    /** Teto de Potência por tier do herói (T1..T4). */
    potencyCapByTier: [5, 10, 15, 20],
    /** +5% no número principal por rank acima do 1. */
    potencyPerRank: 0.05,
    /** Em skill de apoio puro, cada rank dá −1% de recarga (o valor do buff não escala). */
    supportCooldownPerRank: 0.01,
    efficiencyMax: 5,
    efficiencyManaPerUp: 0.04,
    efficiencyCooldownPerUp: 0.03,
    mechanicMax: 5,
    /** Rank de Potência esperado no perfil de teste: 1 + 0,6·(J−1)/4. */
    referencePotencyPerJob: 0.15,
  },

  /** §6: marcos de tier. T2 no job 20; T3 no nível 40; T4 no nível 70. */
  tiers: { t2Job: 20, t3Level: 40, t4Level: 70 },

  /** §7: redistribuir (a 1ª é grátis). */
  respec: { skillsGoldPerJob: 100, attributesGoldPerLevel: 100 },

  /** §2 e §13: experiência. */
  xp: {
    /** xpLacaio(m) = 6 + 2,5·m^1,3. */
    lacaioBase: 6,
    lacaioCoef: 2.5,
    lacaioExp: 1.3,
    /** Corrida padrão: 12 lacaios, 1 elite (×4), 1 chefe menor (×12). */
    runUnits: 28,
    /** Bônus de fim só com sucesso. */
    endBonus: 0.2,
    /** corridas(L) = 1,2 + 0,11·L. */
    runsBase: 1.2,
    runsPerLevel: 0.11,
    /** 30% do XP de nível também vai para o job. */
    jobShare: 0.3,
    /** Job: 0,42·J^3,5 + 50. */
    jobCoef: 0.42,
    jobExp: 3.5,
    jobBase: 50,
    /** Bônus de grupo (1 + 0,1·(n−1)), dividido igual. */
    groupBonusPerExtra: 0.1,
    /** Diferença de nível no XP. */
    diffFree: 5,
    diffPenaltyPerLevel: 0.06,
    diffFloor: 0.1,
    diffBonusPerLevel: 0.02,
    diffBonusMax: 0.2,
  },

  /** §13: multiplicador por tipo de DG (XP e ouro). */
  dungeonType: { cacada: 1, masmorra: 1.5, regional: 2 },

  /** §13: ouroLacaio(m) = 3 + 0,8·m^1,15. */
  gold: { base: 3, coef: 0.8, exp: 1.15 },

  /** §11.2: escala(n) = 1 + 0,75·(n−1); a Masmorra usa n mínimo de 3. */
  partyScale: { perExtra: 0.75, masmorraMin: 3, maxParty: 4 },

  /** §11.1: arquétipos (multiplicadores sobre N(m) e K(m)). */
  archetypes: {
    lacaio: {
      hit: 0.8,
      flee: 0.4,
      critRes: 0.6,
      def: 0.25,
      mdef: 0.2,
      aps: 0.5,
      xp: 1,
    },
    elite: {
      hit: 1.0,
      flee: 0.5,
      critRes: 0.8,
      def: 0.4,
      mdef: 0.3,
      aps: 0.55,
      xp: 4,
    },
    chefeMenor: {
      hit: 1.3,
      flee: 0.3,
      critRes: 1.0,
      def: 0.5,
      mdef: 0.4,
      aps: 0.5,
      xp: 12,
    },
    chefe: {
      hit: 1.3,
      flee: 0.3,
      critRes: 1.0,
      def: 0.5,
      mdef: 0.4,
      aps: 0.5,
      xp: 25,
    },
    regional: {
      hit: 1.3,
      flee: 0.3,
      critRes: 1.0,
      def: 0.5,
      mdef: 0.4,
      aps: 0.5,
      xp: 60,
    },
  },

  /** §11.2: HP e golpes gerados dos perfis de referência. */
  monsters: {
    /**
     * Calibragem da Fase 6 (decisão do dono de 25/11/2026, D18: salas de 25–40 s): o spec dava 3 s e 4×;
     * com isso as salas acabavam em 4–24 s. Medido: 9 s e 1,6× põem as salas da PT de referência em ~25/38/39 s.
     */
    lacaioHpSeconds: 9,
    eliteHpMult: 1.6,
    /** D17: na Caçada, o golpe de lacaio e elite × isto (solo / dupla); os lacaios batem igual para 1 ou 4. */
    huntHitMult: { solo: 0.5, duo: 0.75 },
    menorHpSeconds: 25,
    masmorraHpSeconds: 80,
    masmorraHpDivisor: 3.25,
    /** Golpe bruto do lacaio = 6% × HP_caç / (1 − RF_caç). */
    lacaioHitPct: 0.06,
    eliteHitMult: 1.8,
    menorHitPct: 0.1,
    /** Chefe de masmorra: 12% × HP_tanque / (1 − RF_tanque), 0,5 ataque/s. */
    bossHitPct: 0.12,
    /** Golpe Pesado = 3 × golpe, certeiro, a cada 15 s, aviso de 1,5 s. */
    busterEverySeconds: 15,
    busterMult: 3,
    warningSeconds: 1.5,
    /** Pulso Sombrio = 22% × HP_caç / (1 − RM_caç), mágico, em todos, a cada 12 s. */
    pulsePct: 0.22,
    pulseEverySeconds: 12,
    /** Cataclismo: 40% do HP máx. de cada herói a cada 2 s, dano verdadeiro. */
    cataclysmAtSeconds: 150,
    menorCataclysmAtSeconds: 120,
    cataclysmPct: 0.4,
    cataclysmEverySeconds: 2,
  },

  /** §12.3: mecânicas de chefe por faixa de nível (entram junto com as respostas dos tiers). */
  bossMechanics: {
    /** Maldição: a cada 20 s, um não tanque perde 3% do HP máx./s até ser purificado (máx. 15 s). */
    curseFrom: 40,
    curse: { everySeconds: 20, pctPerSecond: 0.03, maxSeconds: 15 },
    /** Invocação: a cada 30 s, 2 lacaios do nível do chefe. */
    summonFrom: 70,
    summon: { everySeconds: 30, count: 2 },
    /** Drenar Mana: a cada 25 s, conjuradores perdem 3% da MP máx./s por 6 s. */
    drainFrom: 100,
    manaDrain: { everySeconds: 25, pctPerSecond: 0.03, durationSeconds: 6 },
    /** Investida: a cada 20 s, 1,5× o golpe num não tanque sorteado. */
    chargeFrom: 100,
    /** D16: 1,5× o golpe do CHEFE MENOR (calibrado no caçador); o do chefe, calibrado no tanque, matava num golpe. */
    charge: { everySeconds: 20, mult: 1.5 },
    /** Fases: a 50%, +20% de dano e intervalos −15%. */
    phaseFrom: 150,
    phase: { at: 0.5, damageMult: 1.2, intervalMult: 0.85 },
    /** Chefe de Região, fase 3 a 25%: 10% do HP máx. a cada 5 s até o fim. */
    regionalFinal: { at: 0.25, pct: 0.1, everySeconds: 5 },
  },

  /** §12.1: duração máxima da corrida; pausa fora de combate entre as salas (P12). */
  runs: {
    cacadaMaxMs: 8 * 60_000,
    masmorraMaxMs: 10 * 60_000,
    /** Pausa mínima entre as salas e o descanso fora de combate até todos chegarem a 90% (máx. 30 s; P57). */
    roomPauseSeconds: 3,
    restUntilPct: 0.9,
    maxRestSeconds: 30,
  },

  /** §9: equipamento. */
  items: {
    /** Arma: 12 + 2,4·iL, × família × raridade × refino. */
    weaponBase: 12,
    weaponPerIlvl: 2.4,
    /** Armadura por peça: (4 + iL) × slot × peso; MDEF (2 + 0,6·iL) × slot × pesoM. */
    armorDefBase: 4,
    armorDefPerIlvl: 1,
    armorMdefBase: 2,
    armorMdefPerIlvl: 0.6,
    /** Escudo: DEF 6 + 1,6·iL, bloqueio de 10%. */
    shieldDefBase: 6,
    shieldDefPerIlvl: 1.6,
    /** Focus: +45% da base da arma como MATQ (só com arma mágica de 1 mão). */
    focusMatkOfBase: 0.45,
    /** Aljava: +15% no ATQ da arma à distância; +100 de capacidade de munição. */
    quiverAtk: 0.15,
    quiverAmmoCapacity: 100,
    /** Requisito: nível ≥ iL − 5. */
    requirementSlack: 5,
    /** Afixo de atributo: 1 + iL/40; Precisão, Fuga e crítico: 2 × isso. */
    attrAffixBase: 1,
    attrAffixIlvlDiv: 40,
    ratingAffixMult: 2,
    /** Rolagem dos afixos: ±20% do valor indicado. */
    affixRoll: 0.2,
  },

  /** §9.6: refino (Ferreiro). Decisão do dono de 25/11/2026: a regra do spec inteira. */
  refine: {
    max: 10,
    /** Chance de subir de r para r + 1 (índice r). */
    chance: [1, 1, 1, 1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.2],
    /** A partir de qual alvo a falha derruba 1 nível (+8, +9, +10); abaixo, perde só ouro e minério. */
    dropFromTarget: 8,
    /** Bônus por nível: até +5 e acima do +5. Arma +5%/+8% (+10 = +65%); armadura e escudo +4%/+6% (+10 = +50%). */
    lowUpTo: 5,
    weaponLow: 0.05,
    weaponHigh: 0.08,
    armorLow: 0.04,
    armorHigh: 0.06,
    /** Custo: 50 × (1 + iL/20) × r² em ouro + r minérios da região. */
    costBase: 50,
    costIlvlDiv: 20,
  },

  /** O perfil de referência que calibra o conteúdo (§9.4, §11.2). */
  reference: {
    rarity: "raro",
    refine: 4,
    /** Afixos de atributo: 5 no principal e 3 no secundário da build. */
    mainAttrAffixes: 5,
    secondaryAttrAffixes: 3,
  },
};

export type BalanceConfig = typeof BALANCE;
