import type { Stats } from "./attributes.ts";
import type { VocationId } from "./data.ts";
import type { Dungeon } from "./dungeons.ts";
import type { Element, ItemDef } from "./items.ts";
import type { LootEntry } from "./loot.ts";
import type { MonsterAttack, MonsterDef } from "./monsters.ts";

/**
 * As faixas do 85 ao 500 (rework de 24/11/2026: "nosso primeiro level máximo é 500 ... DG
 * desafiadoras até esse level ... itens condizentes"). Treze dungeons, cada uma com três monstros e
 * um chefe, e o equipamento da faixa para cada classe, gerados por tabela: o tema e os nomes
 * são escritos à mão; os números saem das curvas abaixo, ancoradas no Trono do Vazio (level 70)
 * e ajustadas no simulador (scripts/comfort-levels.ts) com os multiplicadores de cada faixa.
 *
 * As curvas (do level 70 ao 500), pelo que o herói ganha no caminho (atributos.ts, items.ts):
 * - a vida dos monstros cresce como (L/70)^0,72 (≈4× no 500: o dano dos heróis cresce ≈5×, mas
 *   a skill quase para e os atributos rendem menos no alto);
 * - o golpe corpo a corpo, (L/70)^1,05 (≈8× no 500: quem apanha é o cavaleiro, com ≈9× a vida);
 * - a magia, (L/70)^0,72 (≈4×: a área pega o mago também, e a vida dele cresce ≈4×). O
 *   curandeiro é quem segura a área; o cavaleiro, o chefe. Os papéis do grupo continuam;
 * - a experiência sai da meta de horas por level (tierExp): de ~20 min no 85 a ~15 h no 500.
 *
 * Os monstros usam a arte de um monstro de antes com outra cor (`look`); as salas, a de uma
 * dungeon de antes com outra cor.
 */

type Role = "bruto" | "conjurador" | "enxame";

interface MonSpec {
  id: string;
  name: string;
  role: Role;
  /** A arte: o monstro de antes e a cor por cima. */
  like: string;
  tint: string;
}

interface TierSpec {
  level: number;
  id: string;
  name: string;
  blurb: string;
  like: string;
  tint: string;
  /** O elemento da faixa: a magia dos monstros, o que eles resistem e a fraqueza. */
  element: Element;
  weak: Element;
  stages: readonly [string, string, string, string];
  /** O nome do material dos itens da faixa ("de mithril", "celestial"). */
  material: string;
  slug: string;
  mons: readonly [MonSpec, MonSpec, MonSpec, MonSpec];
  /** Ajuste do simulador: vida, corpo a corpo e magia (1 = a curva). */
  tune?: readonly [number, number, number];
}

const T = (
  level: number,
  id: string,
  name: string,
  blurb: string,
  like: string,
  tint: string,
  element: Element,
  weak: Element,
  stages: readonly [string, string, string, string],
  material: string,
  slug: string,
  mons: readonly [MonSpec, MonSpec, MonSpec, MonSpec],
  tune?: readonly [number, number, number],
): TierSpec => ({
  level,
  id,
  name,
  blurb,
  like,
  tint,
  element,
  weak,
  stages,
  material,
  slug,
  mons,
  ...(tune ? { tune } : {}),
});
const M = (
  id: string,
  name: string,
  role: Role,
  like: string,
  tint: string,
): MonSpec => ({ id, name, role, like, tint });

export const TIERS: readonly TierSpec[] = [
  T(85, "pantano-dos-afogados", "Pântano dos Afogados", "A água parada guarda quem nunca saiu dela.", "galerias-afogadas", "#2f5a3a", "terra", "fogo",
    ["Margem podre", "Brejo fundo", "Ninho das sanguessugas", "Trono de lodo"], "de mithril", "de-mithril",
    [M("afogado", "Afogado", "bruto", "troll-do-lodo", "#3d6b55"), M("bruxa-do-brejo", "Bruxa do brejo", "conjurador", "mineiro-espectral", "#5a8a3a"),
     M("sanguessuga-colossal", "Sanguessuga colossal", "enxame", "larva-gigante", "#6b2a2a"), M("senhora-do-pantano", "Senhora do Pântano", "bruto", "matriarca-do-musgo", "#2a5a4a")]),
  T(100, "fortaleza-partida", "Fortaleza Partida", "Os mortos ainda guardam as muralhas.", "cidadela-de-cinzas", "#5a5a66", "morte", "sagrado",
    ["Portão caído", "Pátio dos ossos", "Torre dos arqueiros", "Salão do lorde"], "de adamantina", "de-adamantina",
    [M("sentinela-de-pedra", "Sentinela de pedra", "bruto", "automato-de-ferro", "#7a7a86"), M("necromante", "Necromante", "conjurador", "sombra-vazia", "#5a3a7a"),
     M("arqueiro-esqueleto", "Arqueiro esqueleto", "enxame", "ossada-inquieta", "#c8c0a8"), M("lorde-da-fortaleza", "Lorde da Fortaleza", "bruto", "senhor-das-cinzas", "#6a6a7a")]),
  T(120, "deserto-de-vidro", "Deserto de Vidro", "A areia derreteu e virou espelho.", "forja-rachada", "#c9a46a", "fogo", "gelo",
    ["Dunas brilhantes", "Oásis seco", "Cemitério de vidro", "Tumba do faraó"], "de oricalco", "de-oricalco",
    [M("escorpiao-de-vidro", "Escorpião de vidro", "bruto", "caranguejo-de-pedra", "#d8c08a"), M("djinn-da-areia", "Djinn da areia", "conjurador", "brasa-viva", "#e0b060"),
     M("verme-das-dunas", "Verme das dunas", "enxame", "larva-gigante", "#c8a070"), M("farao-esquecido", "Faraó Esquecido", "bruto", "capataz-espectral", "#d8b040")]),
  T(145, "picos-trovejantes", "Picos Trovejantes", "Lá em cima, o céu não para de bater.", "bosque-petrificado", "#6a7aa0", "energia", "terra",
    ["Trilha dos raios", "Ninho do grifo", "Cume da tempestade", "Altar do trovão"], "do trovão", "do-trovao",
    [M("gigante-da-tempestade", "Gigante da tempestade", "bruto", "gigante-de-gelo", "#7080c0"), M("elemental-do-raio", "Elemental do raio", "conjurador", "espirito-da-nevasca", "#a0a0ff"),
     M("grifo", "Grifo", "enxame", "harpia-de-granito", "#c09060"), M("rei-trovao", "Rei Trovão", "bruto", "wyrm-de-gelo", "#5060d0")]),
  T(170, "floresta-sombria", "Floresta Sombria", "As árvores fecham o caminho de quem entra.", "ninho-das-aranhas", "#2a2a40", "morte", "fogo",
    ["Clareira sem lua", "Raízes que prendem", "Teia antiga", "Coração da mata"], "da noite", "da-noite",
    [M("lobisomem", "Lobisomem", "bruto", "lobo-cinzento", "#4a3a3a"), M("driade-corrompida", "Dríade corrompida", "conjurador", "ent-de-pedra", "#3a5a2a"),
     M("aranha-das-sombras", "Aranha das sombras", "enxame", "aranha-saltadora", "#2a2a3a"), M("mae-da-noite", "Mãe da Noite", "bruto", "rainha-aranha", "#3a2a4a")]),
  T(200, "catacumbas-reais", "Catacumbas Reais", "Os reis enterrados não aceitaram o fim.", "cripta-do-musgo", "#4a4a5a", "morte", "sagrado",
    ["Galeria dos nobres", "Ossário", "Capela profanada", "Sepulcro do rei"], "real", "real",
    [M("cavaleiro-morto", "Cavaleiro morto", "bruto", "cavaleiro-de-cinzas", "#6a6a7a"), M("lich-menor", "Lich menor", "conjurador", "mineiro-espectral", "#8a7aa0"),
     M("carnical", "Carniçal", "enxame", "troll-do-lodo", "#5a6a4a"), M("rei-lich", "Rei Lich", "bruto", "capataz-espectral", "#7a6aa0")]),
  T(235, "vulcao-rubro", "Vulcão Rubro", "O chão é quente e alguém dorme lá embaixo.", "forja-rachada", "#a03020", "fogo", "gelo",
    ["Encosta de cinza", "Rio de lava", "Ninho dos dragões", "Câmara do dragão"], "de dragão", "de-dragao",
    [M("golem-de-magma", "Golem de magma", "bruto", "golem-de-carvao", "#c04020"), M("salamandra-gigante", "Salamandra gigante", "conjurador", "salamandra", "#e05020"),
     M("dragao-jovem", "Dragão jovem", "enxame", "basilisco", "#b03030"), M("dragao-rubro", "Dragão Rubro", "bruto", "wyrm-de-gelo", "#c02020")]),
  T(270, "abismo-coral", "Abismo Coral", "No fundo do mar, a luz é dos monstros.", "galerias-afogadas", "#1a5a8a", "gelo", "energia",
    ["Recife morto", "Jardim de corais", "Fossa abissal", "Trono do leviatã"], "abissal", "abissal",
    [M("tritao", "Tritão", "bruto", "serpente-da-comporta", "#2a7aa0"), M("sereia-abissal", "Sereia abissal", "conjurador", "espirito-da-nevasca", "#3a8ab0"),
     M("caranguejo-coral", "Caranguejo coral", "enxame", "caranguejo-de-pedra", "#d06050"), M("leviata", "Leviatã", "bruto", "rei-das-comportas", "#1a4a7a")]),
  T(310, "cidade-celeste", "Cidade Celeste", "Uma cidade que caiu do céu e ainda se defende.", "cidadela-de-cinzas", "#e0d8b0", "sagrado", "morte",
    ["Escadaria de nuvens", "Praça dos anjos", "Torre do sino", "Santuário partido"], "celestial", "celestial",
    [M("guardiao-alado", "Guardião alado", "bruto", "harpia-de-granito", "#e8e0c0"), M("anjo-caido", "Anjo caído", "conjurador", "arauto-do-vazio", "#c0b080"),
     M("querubim-de-bronze", "Querubim de bronze", "enxame", "automato-de-ferro", "#c08840"), M("serafim-partido", "Serafim Partido", "bruto", "imperador-do-vazio", "#f0e0a0")]),
  T(350, "vale-dos-titas", "Vale dos Titãs", "Aqui os passos fazem tremer as montanhas.", "bosque-petrificado", "#8a7a5a", "terra", "energia",
    ["Pegadas gigantes", "Acampamento dos ciclopes", "Pasto dos mamutes", "Assento do titã"], "de titã", "de-tita",
    [M("ciclope", "Ciclope", "bruto", "gigante-de-gelo", "#9a7a5a"), M("oraculo-da-pedra", "Oráculo da pedra", "conjurador", "ent-de-pedra", "#8a8a6a"),
     M("mamute-de-guerra", "Mamute de guerra", "enxame", "javali-bravo", "#7a5a3a"), M("tita-ancestral", "Titã Ancestral", "bruto", "guardiao-da-forja", "#8a6a4a")]),
  T(400, "plano-etereo", "Plano Etéreo", "Um lugar entre um passo e outro.", "abismo-gelado", "#7a5ac0", "energia", "morte",
    ["Véu", "Corredor dos ecos", "Lago de cristal", "Trono do éter"], "do éter", "do-eter",
    [M("devorador-de-almas", "Devorador de almas", "bruto", "devorador", "#6a4ab0"), M("fantasma-de-cristal", "Fantasma de cristal", "conjurador", "espirito-da-nevasca", "#b0a0ff"),
     M("eco-vivo", "Eco vivo", "enxame", "sombra-vazia", "#9a7ad0"), M("senhor-do-eter", "Senhor do Éter", "bruto", "imperador-do-vazio", "#8a6af0")]),
  T(450, "fenda-do-caos", "Fenda do Caos", "O mundo rachou e o que estava embaixo subiu.", "cidadela-de-cinzas", "#7a1a2a", "fogo", "sagrado",
    ["Borda da fenda", "Ponte de ossos", "Canil infernal", "Trono do caos"], "infernal", "infernal",
    [M("demonio-maior", "Demônio maior", "bruto", "demonio-menor", "#9a1a2a"), M("sucubo", "Súcubo", "conjurador", "arauto-do-vazio", "#a02a5a"),
     M("cao-infernal", "Cão infernal", "enxame", "lobo-glacial", "#8a2a1a"), M("arquidemonio", "Arquidemônio", "bruto", "senhor-das-cinzas", "#b01a1a")]),
  T(500, "coracao-do-mundo", "Coração do Mundo", "Onde tudo começou, e o primeiro ainda espera.", "trono-do-vazio", "#3a8a7a", "terra", "morte",
    ["Raiz do mundo", "Veio de cristal", "Câmara do eco primeiro", "O começo"], "primordial", "primordial",
    [M("guardiao-primordial", "Guardião primordial", "bruto", "golem-de-carvao", "#3a9a8a"), M("serpente-do-mundo", "Serpente do mundo", "conjurador", "serpente-da-comporta", "#2a9a6a"),
     M("colosso-de-cristal", "Colosso de cristal", "enxame", "ent-de-pedra", "#6adaca"), M("o-primeiro", "O Primeiro", "bruto", "imperador-do-vazio", "#2aaa9a")]),
];

// ---- curvas ----------------------------------------------------------------------

const A = 70;
/** Os expoentes das curvas (medidos: com 0,85 e 1,1 o topo passava do que o herói do 500 aguenta). */
const HP_K = 0.72;
const MELEE_K = 1.05;
const grow = (L: number, k: number) => Math.pow(L / A, k);
const r = (n: number) => Math.max(1, Math.round(n));

/** A experiência de um level no OT [TFS player.h getExpForLevel] (a mesma de progression.ts). */
function expFor(lv: number): number {
  return Math.floor((((lv - 6) * lv + 17) * lv - 12) / 6) * 100;
}

/**
 * A meta de horas de corrida por level [nosso, 24/11/2026: "jogar durante anos"]: 0,05 h no
 * começo, ~20 min no 85, ~2,5 h no 200, ~15 h no 500 (do 1 ao 500, ~2.500 h de corrida).
 */
export function hoursPerLevel(level: number): number {
  return 0.05 + 15 * (level / 500) ** 2;
}

/**
 * A experiência crua que a corrida inteira do trio dá na entrada da faixa (a soma dos monstros),
 * para cada um subir no ritmo da meta: cada membro leva 1,6/3 do bolo [party.ts, três vocações],
 * na taxa padrão (1,5, data.ts), numa corrida de ~4 min (o simulador mede e o ajuste é aqui).
 */
const RUN_SECONDS = 240;
function poolFor(level: number): number {
  const perHour = (expFor(level + 1) - expFor(level)) / hoursPerLevel(level);
  const perRun = (perHour * RUN_SECONDS) / 3600;
  return perRun / (1.5 * (1.6 / 3));
}

// ---- monstros ----------------------------------------------------------------------

const ROLE: Readonly<Record<Role, { hp: number; melee: number; magic: number; chance: number }>> = {
  bruto: { hp: 1.3, melee: 1.2, magic: 0.6, chance: 12 },
  conjurador: { hp: 0.8, melee: 0.6, magic: 1.15, chance: 25 },
  enxame: { hp: 0.7, melee: 0.9, magic: 0.8, chance: 15 },
};

/** Quantos de cada um entram na corrida do trio (stageMonsters com +40% por herói a mais). */
const TRIO = 1.8;

function monstersOf(t: TierSpec): MonsterDef[] {
  const [hpT, meleeT, magicT] = t.tune ?? [1, 1, 1];
  const L = t.level;
  // A âncora: o Trono do Vazio (70) com a vida ×2 e o resto ×1,4 (o trio de 85 vencia tudo no
  // primeiro desenho; o simulador mede e o ajuste fino é o `tune` de cada faixa).
  const hp = 2 * 2880 * grow(L, HP_K) * hpT;
  const melee = 1.4 * 299 * grow(L, MELEE_K) * meleeT;
  const magic = 1.4 * 352 * grow(L, 0.72) * magicT;
  const armor = r(30 * grow(L, 0.6));
  // A experiência: o chefe leva 30% do bolo; os comuns, o resto (por quantos entram).
  const pool = poolFor(L) * (EXP_FIX[t.id] ?? 1);
  const regulars = Math.round(2 * TRIO) * 2 + Math.round(1 * TRIO) * 2 + Math.round(2 * TRIO);
  const each = (pool * 0.7) / regulars;
  const elements = (boss: boolean): Partial<Record<Element, number>> => ({
    [t.element]: boss ? 60 : 50,
    [t.weak]: -20,
    ...(t.element !== "fisico" ? { fisico: boss ? 15 : 5 } : {}),
  });
  const regular = (m: MonSpec, i: number): MonsterDef => {
    const k = ROLE[m.role];
    const attacks: MonsterAttack[] = [
      { kind: "melee", intervalMs: 2000, chance: 100, element: "fisico", min: 0, max: r(melee * k.melee) },
      {
        kind: "magia",
        name: spellName(t.element),
        intervalMs: 2000,
        chance: k.chance,
        element: t.element,
        min: r(magic * k.magic * 0.55),
        max: r(magic * k.magic),
        // O conjurador pega o grupo inteiro: é a área que o curandeiro segura.
        ...(m.role === "conjurador" ? { area: true } : {}),
      },
    ];
    return {
      id: m.id,
      name: m.name,
      level: L + 1 + i * 2,
      health: r(hp * k.hp),
      experience: r(each * (m.role === "bruto" ? 1.2 : m.role === "conjurador" ? 1 : 0.8)),
      armor,
      defense: armor,
      attacks,
      targetChange: { intervalMs: 4000, chance: m.role === "enxame" ? 30 : 15 },
      elements: elements(false),
      look: { like: m.like, tint: m.tint },
      loot: regularLoot(t, m.role, L),
    };
  };
  const b = t.mons[3];
  const boss: MonsterDef = {
    id: b.id,
    name: b.name,
    boss: true,
    level: L + 10,
    health: r(2 * 54_000 * grow(L, HP_K) * hpT),
    experience: r(pool * 0.3),
    armor: r(armor * 1.6),
    defense: r(armor * 1.6),
    attacks: [
      { kind: "melee", intervalMs: 2000, chance: 100, element: "fisico", min: 0, max: r(1.4 * 575 * grow(L, MELEE_K) * meleeT) },
      {
        kind: "magia",
        name: spellName(t.element),
        intervalMs: 2000,
        chance: 22,
        element: t.element,
        min: r(magic * 0.55),
        max: r(magic * 1.05),
        area: true,
      },
    ],
    heal: { intervalMs: 2000, chance: 10, min: r(600 * grow(L, 0.85)), max: r(1200 * grow(L, 0.85)) },
    targetChange: { intervalMs: 4000, chance: 20 },
    elements: elements(true),
    look: { like: b.like, tint: b.tint },
    loot: bossLoot(t, L),
  };
  return [...t.mons.slice(0, 3).map(regular), boss];
}

function spellName(el: Element): string {
  switch (el) {
    case "terra":
      return "Lodo";
    case "morte":
      return "Maldição";
    case "fogo":
      return "Labareda";
    case "energia":
      return "Descarga";
    case "gelo":
      return "Nevasca";
    case "sagrado":
      return "Juízo";
    default:
      return "Pisada";
  }
}

// ---- loot ---------------------------------------------------------------------------

/** items.ts GOLD (só o tipo vem de items.ts: este arquivo não importa nada em tempo de execução). */
const GOLD = "moeda-de-ouro";
const coins = (chance: number, countMax: number): LootEntry => ({
  item: GOLD,
  chance,
  countMax,
  stackable: true,
});
const drop = (item: string, chance: number): LootEntry => ({
  item,
  chance,
  countMax: 1,
  stackable: false,
});
const stack = (item: string, chance: number, countMax: number): LootEntry => ({
  item,
  chance,
  countMax,
  stackable: true,
});

function regularLoot(t: TierSpec, role: Role, L: number): LootEntry[] {
  const kit = tierItems(t);
  const gear = kit.filter((d) => !d.stackable);
  // Dois itens da faixa por monstro, raros, um conjunto diferente por papel.
  const from = role === "bruto" ? 0 : role === "conjurador" ? 5 : 10;
  const ammo = kit.filter((d) => d.slot === "municao");
  return [
    coins(100_000, r(200 + L)),
    stack("moeda-de-platina", 30_000, r(L / 50)),
    drop(gear[from % gear.length]!.id, 1_000),
    drop(gear[(from + 3) % gear.length]!.id, 1_000),
    ...(role === "enxame" ? ammo.map((a) => stack(a.id, 8_000, 15)) : []),
    stack(L >= 250 ? "pocao-suprema-de-vida" : L >= 120 ? "pocao-grande-de-vida" : "pocao-forte-de-vida", 5_000, 2),
  ];
}

function bossLoot(t: TierSpec, L: number): LootEntry[] {
  const gear = tierItems(t).filter((d) => !d.stackable);
  return [
    coins(100_000, r(2000 + 4 * L)),
    stack("moeda-de-platina", 100_000, r(L / 2)),
    ...gear.map((d) => drop(d.id, 8_000)),
    stack(L >= 250 ? "pocao-suprema-de-mana" : "pocao-grande-de-mana", 30_000, 4),
  ];
}

// ---- itens --------------------------------------------------------------------------

const KNIGHT: readonly VocationId[] = [4];
const PALADIN: readonly VocationId[] = [3];
const SORC: readonly VocationId[] = [1];
const DRUID: readonly VocationId[] = [2];
const MAGES: readonly VocationId[] = [1, 2];
const FRONT: readonly VocationId[] = [3, 4];

/** Divide \`total\` pontos de atributo pelos pesos (o resto vai para o primeiro). */
function split(total: number, w: Partial<Record<keyof Stats, number>>): Partial<Stats> {
  const out: Partial<Stats> = {};
  let left = total;
  const keys = Object.keys(w) as (keyof Stats)[];
  for (const k of keys.slice(1)) {
    const n = Math.round(total * w[k]!);
    out[k] = n;
    left -= n;
  }
  out[keys[0]!] = left;
  for (const k of keys) if (!out[k]) delete out[k];
  return out;
}

const SORC_EL: readonly Element[] = ["energia", "fogo", "morte"];
const DRUID_EL: readonly Element[] = ["terra", "gelo"];

const itemsCache = new Map<string, ItemDef[]>();

/** O equipamento da faixa: armas, escudo e armaduras de cada classe, e a munição. */
export function tierItems(t: TierSpec): ItemDef[] {
  const hit = itemsCache.get(t.id);
  if (hit) return hit;
  const L = t.level;
  const d = L - 65;
  const idx = TIERS.indexOf(t);
  const stat = r(6 + 0.03 * d);
  const value = r(12_000 * (L / 65) ** 1.5);
  const mk = (
    base: string,
    name: string,
    def: Omit<ItemDef, "id" | "name" | "minLevel" | "value">,
    v = value,
  ): ItemDef => ({
    id: `${base}-${t.slug}`,
    name: `${name} ${t.material}`,
    minLevel: L,
    value: r(v),
    ...def,
  });
  const atk = r(47 + 0.11 * d);
  const dfn = r(28 + 0.05 * d);
  const flecha = r(38 + 0.035 * (L - 85));
  const wand = r(75 + 0.55 * (L - 60));
  const items: ItemDef[] = [
    mk("espada", "Espada", { slot: "arma", kind: "espada", attack: atk, defense: dfn, stats: split(stat, { for: 0.6, agi: 0.4 }), vocations: KNIGHT, weight: 4200 }),
    mk("machado", "Machado", { slot: "arma", kind: "machado", attack: atk + 2, defense: dfn - 6, stats: split(stat, { for: 1 }), vocations: KNIGHT, weight: 5200 }),
    mk("maca", "Maça", { slot: "arma", kind: "maca", attack: atk + 1, defense: dfn - 3, stats: split(stat, { for: 0.6, vit: 0.4 }), vocations: KNIGHT, weight: 5000 }),
    mk("escudo", "Escudo", { slot: "escudo", defense: r(36 + 0.045 * d), stats: split(r(stat * 0.7), { vit: 0.8, sor: 0.2 }), vocations: KNIGHT, weight: 6000 }, value * 0.8),
    mk("armadura", "Armadura", { slot: "corpo", armor: r(16 + 0.03 * d), stats: split(r(stat * 0.7), { vit: 1 }), vocations: KNIGHT, weight: 12_000 }, value * 0.8),
    mk("elmo", "Elmo", { slot: "cabeca", armor: r(8 + 0.015 * d), stats: split(r(stat * 0.5), { vit: 0.7, des: 0.3 }), vocations: FRONT, weight: 4000 }, value * 0.6),
    mk("calca", "Calça", { slot: "pernas", armor: r(7 + 0.014 * d), stats: split(r(stat * 0.5), { vit: 1 }), vocations: FRONT, weight: 4500 }, value * 0.6),
    mk("botas", "Botas", { slot: "pes", armor: r(4 + 0.01 * d), stats: split(r(stat * 0.5), { agi: 0.7, vit: 0.3 }), vocations: FRONT, weight: 2500 }, value * 0.5),
    mk("arco", "Arco", { slot: "arma", kind: "distancia", twoHanded: true, ammo: "flecha", attack: r(8 + 0.02 * d), hitChance: 5, stats: split(stat, { des: 0.6, agi: 0.4 }), vocations: PALADIN, weight: 4000 }),
    mk("besta", "Besta", { slot: "arma", kind: "distancia", twoHanded: true, ammo: "virote", attack: r(10 + 0.02 * d), stats: split(stat, { des: 1 }), vocations: PALADIN, weight: 7000 }),
    mk("couraca", "Couraça", { slot: "corpo", armor: r(10 + 0.02 * d), stats: split(r(stat * 0.7), { des: 0.6, agi: 0.4 }), vocations: PALADIN, weight: 7000 }, value * 0.8),
    mk("varinha", "Varinha", { slot: "arma", kind: "varinha", wand: { element: SORC_EL[idx % SORC_EL.length]!, min: wand, max: wand + 10, mana: r(8 + L / 25) }, stats: split(stat, { int: 0.8, des: 0.2 }), vocations: SORC, weight: 2000 }),
    mk("cajado", "Cajado", { slot: "arma", kind: "varinha", wand: { element: DRUID_EL[idx % DRUID_EL.length]!, min: wand, max: wand + 10, mana: r(8 + L / 25) }, stats: split(stat, { int: 0.7, vit: 0.3 }), vocations: DRUID, weight: 3000 }),
    mk("manto", "Manto", { slot: "corpo", armor: r(11 + 0.018 * (L - 60)), stats: split(r(stat * 0.7), { int: 0.8, des: 0.2 }), vocations: MAGES, weight: 3400 }, value * 0.8),
    mk("chapeu", "Chapéu", { slot: "cabeca", armor: r(3 + 0.006 * (L - 60)), stats: split(r(stat * 0.5), { int: 0.7, sor: 0.3 }), vocations: MAGES, weight: 1200 }, value * 0.6),
    mk("flecha", "Flecha", { slot: "municao", ammo: "flecha", attack: flecha, maxHitChance: 90, stackable: true, vocations: PALADIN, weight: 80 }, 0),
    mk("virote", "Virote", { slot: "municao", ammo: "virote", attack: flecha + 6, maxHitChance: 90, stackable: true, vocations: PALADIN, weight: 90 }, 0),
  ];
  itemsCache.set(t.id, items);
  return items;
}

/** Todos os itens das faixas. */
export function allTierItems(): ItemDef[] {
  return TIERS.flatMap(tierItems);
}

/** Todos os monstros das faixas. */
export function allTierMonsters(): MonsterDef[] {
  return TIERS.flatMap(monstersOf);
}

/** As dungeons das faixas (as salas como no Trono do Vazio: 2, 2+1, 2, chefe+1). */
export function allTierDungeons(): Dungeon[] {
  return TIERS.map((t) => {
    const [a, b, c, boss] = t.mons;
    return {
      id: t.id,
      name: t.name,
      minLevel: t.level,
      comfort: COMFORT[t.id] ?? { group: t.level, solo: { 1: null, 2: null, 3: null, 4: null } },
      blurb: t.blurb,
      look: { like: t.like, tint: t.tint },
      stages: [
        { name: t.stages[0], monsters: [{ id: a.id, count: 2 }] },
        { name: t.stages[1], monsters: [{ id: b.id, count: 2 }, { id: a.id, count: 1 }] },
        { name: t.stages[2], monsters: [{ id: c.id, count: 2 }] },
        { name: t.stages[3], monsters: [{ id: boss.id, count: 1 }, { id: b.id, count: 1 }] },
      ],
    };
  });
}

/**
 * O acerto da experiência pela corrida medida (24/11/2026, comfort-levels.ts, 30 sementes): a
 * meta de horas por level contra a experiência por hora do trio na entrada (a corrida não dura
 * os 240 s da conta em todas).
 */
const EXP_FIX: Readonly<Record<string, number>> = {
  "pantano-dos-afogados": 1.15,
  "fortaleza-partida": 0.59,
  "deserto-de-vidro": 0.8,
  "picos-trovejantes": 0.85,
  "floresta-sombria": 0.89,
  "catacumbas-reais": 0.81,
  "vulcao-rubro": 0.77,
  "abismo-coral": 1.03,
  "cidade-celeste": 0.91,
  "vale-dos-titas": 1.27,
  "plano-etereo": 0.68,
  "fenda-do-caos": 0.63,
  "coracao-do-mundo": 0.86,
};

/**
 * O conforto medido (24/11/2026, 30 sementes): o trio cavaleiro + arqueiro + druida vence 70% a
 * partir deste level; sozinho, ninguém (o arqueiro só no Pântano, no 120). Sem curandeiro ou sem
 * tanque, o grupo perde até bem depois (com --papeis no simulador).
 */
const solo = (archer: number | null = null): Dungeon["comfort"]["solo"] => ({
  1: null,
  2: null,
  3: archer,
  4: null,
});
const COMFORT: Readonly<Record<string, Dungeon["comfort"]>> = {
  "pantano-dos-afogados": { group: 97, solo: solo(120) },
  "fortaleza-partida": { group: 110, solo: solo() },
  "deserto-de-vidro": { group: 130, solo: solo() },
  "picos-trovejantes": { group: 155, solo: solo() },
  "floresta-sombria": { group: 180, solo: solo() },
  "catacumbas-reais": { group: 210, solo: solo() },
  "vulcao-rubro": { group: 245, solo: solo() },
  "abismo-coral": { group: 290, solo: solo() },
  "cidade-celeste": { group: 320, solo: solo() },
  "vale-dos-titas": { group: 360, solo: solo() },
  "plano-etereo": { group: 400, solo: solo() },
  "fenda-do-caos": { group: 450, solo: solo() },
  "coracao-do-mundo": { group: 500, solo: solo() },
};
