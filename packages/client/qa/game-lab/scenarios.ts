import {
  type ClassId,
  type HeroV5,
  type ItemBase,
  type OwnedItem,
  type RarityId,
  type RpgBoardRun,
  type RpgHeroState,
  type RpgLobbyView,
  ARMOR_SLOTS,
  balance as B,
  CLASSES,
  createHero,
  evolveTier,
  generateItem,
  raiseAttributes,
  skillOf,
  spendSkillPoint,
} from "@muchat/space-core/game/ot/balance";

import { pending, suggestRaise } from "../../components/space/game/heroModel";

/**
 * Os heróis e as situações do laboratório das telas (Idle Hunt v5), montados com o próprio núcleo:
 * nada de JSON escrito à mão que pode sair do contrato. Semente fixa: a mesma tela toda vez.
 */

export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return {
    next: () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    },
  };
}

let uidN = 0;
export const newUid = () => `lab-${(uidN++).toString(36)}`;

const own = (it: ReturnType<typeof generateItem>): OwnedItem => ({
  ...it,
  uid: newUid(),
});

/** O herói no nível e job pedidos: skills gastas (menos `keepSkill`), evoluído e atributos pela sugestão. */
export function grow(
  cls: ClassId,
  level: number,
  job: number,
  opts: { keepSkill?: number; keepAttr?: number } = {},
): HeroV5 {
  let h: HeroV5 = {
    ...createHero(cls, newUid),
    level,
    job,
    xp: B.xpTotalAt(level) + Math.floor(B.xpToNext(level) * 0.62),
    jobXp: B.jobXpTotalAt(job) + Math.floor(B.jobXpToNext(job) * 0.35),
    // A Proficiência recomendada do nível (10 × nível), como o perfil de referência.
    proficiency: B.recommendedProficiency(level),
  };
  const keep = opts.keepSkill ?? 0;
  const target = B.tierFor(job);
  for (let guard = 0; guard < 600; guard++) {
    const ev = evolveTier(h);
    if (ev.ok) {
      h = ev.hero;
      continue;
    }
    // Antes do último tier gasta tudo (a evolução pede); no último, guarda `keep` para a tela.
    if (h.skills.tier >= target && pending(h).skillPoints <= keep) break;
    let spent = false;
    const ids = [...h.skills.slots, ...Object.keys(h.skills.builds)];
    outer: for (const id of ids) {
      const mech =
        skillOf(cls, id)?.mechanics.map((m) => ({ mechanic: m.id })) ?? [];
      for (const target of ["potencia", "eficiencia", ...mech] as const) {
        const r = spendSkillPoint(h, id, target as never);
        if (r.ok) {
          h = r.hero;
          spent = true;
          break outer;
        }
      }
    }
    if (!spent) break;
  }
  const free = pending(h).attrPoints - (opts.keepAttr ?? 0);
  if (free > 0) {
    const r = raiseAttributes(h, suggestRaise(h, free));
    if (r.ok) h = r.hero;
  }
  return h;
}

function basesOf(cls: ClassId): ItemBase[] {
  const c = CLASSES[cls];
  const out: ItemBase[] = [{ slot: "arma", family: c.referenceWeapon }];
  if (c.referenceOffhand)
    out.push({ slot: "secundaria", offhand: c.referenceOffhand });
  for (const slot of ARMOR_SLOTS) out.push({ slot, weight: c.armor });
  out.push({ slot: "colar" }, { slot: "anel" });
  return out;
}

/** Veste o herói com Raros do próprio nível (+4, a arma +7), como o perfil de referência. */
export function dress(h: HeroV5, seed = 3): HeroV5 {
  const rng = seeded(seed);
  const eq: Record<string, OwnedItem> = {};
  for (const base of basesOf(h.cls)) {
    const it = own(generateItem(base, h.level, "raro", rng));
    it.refine =
      base.slot === "arma"
        ? 7
        : base.slot === "colar" || base.slot === "anel"
          ? 0
          : 4;
    eq[base.slot] = it;
  }
  return { ...h, equipment: eq as HeroV5["equipment"] };
}

/** Uma mochila cheia de escolhas: melhores, piores, de outra classe, um lendário, um +9. */
export function stuffBag(h: HeroV5, count: number, seed = 11): HeroV5 {
  const rng = seeded(seed);
  const mine = basesOf(h.cls);
  const others: ItemBase[] = [
    { slot: "arma", family: "machado" },
    { slot: "arma", family: "arco" },
    { slot: "armadura", weight: "pesada" },
    { slot: "secundaria", offhand: "aljava" },
  ];
  const rar: RarityId[] = [
    "comum",
    "incomum",
    "raro",
    "epico",
    "incomum",
    "raro",
  ];
  const bag: OwnedItem[] = [];
  for (let i = 0; i < count; i++) {
    const base =
      i % 4 === 3 ? others[i % others.length]! : mine[i % mine.length]!;
    const ilvl = Math.max(1, h.level + ((i * 7) % 11) - 6);
    const it = own(generateItem(base, ilvl, rar[i % rar.length]!, rng));
    if (i === 5) it.refine = 9;
    if (i === 8) it.refine = 3;
    bag.push(it);
  }
  const leg = own(
    generateItem({ slot: "elmo", weight: "leve" }, h.level, "lendario", rng),
  );
  leg.legendary = "coroa-do-mentor";
  bag.push(leg);
  return { ...h, bag };
}

export function stateOf(
  hero: HeroV5,
  extra: Partial<RpgHeroState> = {},
): RpgHeroState {
  return {
    hero,
    stamina: 2400,
    dojo: null,
    run: null,
    rates: { exp: 1 },
    ...extra,
  };
}

/** O mago do nível 45 (T3), o herói principal das capturas. */
export function mage45(): HeroV5 {
  let h = grow("mago", 45, 28, { keepSkill: 3, keepAttr: 12 });
  h = stuffBag(dress(h), 27);
  return {
    ...h,
    gold: 48_350,
    // Um pouco abaixo da recomendada (10 × 45): a tela sugere o Dojô.
    proficiency: 330,
    proficiencyXp: 120,
    potions: {
      hp: { pequena: 40, media: 25, grande: 0 },
      mp: { pequena: 30, media: 10, grande: 6 },
    },
    belt: { hp: "media", mp: "pequena" },
    ores: { Ferro: 22 },
    stones: 2,
    essence: 1,
    vault: {
      gold: 120_000,
      items: stuffBag(h, 6, 99).bag,
      expansions: 0,
    },
    attrResets: 1,
  };
}

/** O caçador do nível 52 (região 2, munição), para o Mercador. */
export function hunter52(): HeroV5 {
  const h = stuffBag(dress(grow("cacador", 52, 30)), 14, 21);
  return {
    ...h,
    gold: 9_800,
    ammo: { comum: 340, afiada: 100 },
    ores: { Bronze: 6, Ferro: 3 },
  };
}

export const PEOPLE = [
  { id: "u-bia", name: "Bia" },
  { id: "u-caio", name: "Caio" },
  { id: "u-duda", name: "Duda" },
];

export function lobbyOf(
  dungeon: string,
  members: { id: string; name: string; cls: ClassId; level: number }[],
  extra: Partial<RpgLobbyView> = {},
): RpgLobbyView {
  return {
    id: `lb-${dungeon}`,
    tv: "tv-1",
    room: "sala-lab",
    dungeon,
    leader: members[0]!.id,
    members: members.map((m) => ({
      user_id: m.id,
      name: m.name,
      cls: m.cls,
      level: m.level,
    })),
    max: dungeon.startsWith("cacada") ? 2 : 4,
    expires_at: Date.now() + 600_000,
    state: "forming",
    run_id: null,
    runs: 0,
    loop: false,
    next_at: null,
    last: null,
    stopped: null,
    stopped_detail: null,
    ...extra,
  };
}

export function boardRuns(): RpgBoardRun[] {
  return [
    {
      id: "run-outra",
      dungeon: "cacada-30",
      room: "sala-2",
      tv: "tv-2",
      started_at: Date.now() - 90_000,
      ends_at: Date.now() + 60_000,
      members: [
        { user_id: "u-caio", name: "Caio", cls: "guerreiro", level: 31 },
        { user_id: "u-duda", name: "Duda", cls: "padre", level: 29 },
      ],
    },
  ];
}
