/* global process, console */
/**
 * Heróis do Idle Hunt v5 para as contas do laboratório completo (26/11/2026): Ana guerreira, Bia
 * druida e Caio assassino no nível 45, com as skills do kit de referência e os atributos da classe.
 * A Bia fica com os pontos de atributo livres e um colar na mochila (o teste da ficha aberta: ela
 * distribui e equipa entre uma corrida e outra). Grava no Mongo do laboratório e confere, com o
 * simulador, que o trio vence a Caçada do teste. Substitui o herói que já existir.
 *
 *   node packages/space-server/lab/full/seed-idle.ts [--lab-dir <pasta do lab>] [--dungeon cacada-30]
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ClassId,
  type HeroV5,
  CLASSES,
  REFERENCE_KITS,
  balance as B,
  buyCommonItem,
  createHero,
  dungeonById,
  evolveTier,
  heroRunFighter,
  learnableSkills,
  raiseAttributes,
  setSkillSlots,
  simulateRun,
  skillCapacity,
  spendSkillPoint,
} from "@muchat/space-core/game/ot/balance";
import { MongoClient } from "mongodb";

import { newRpgHero } from "../../src/game/ot/hero.ts";
import { MongoRpgStore } from "../../src/game/ot/store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LAB = arg("--lab-dir") ?? process.env.FULL_LAB_DIR ?? HERE;
const DUNGEON = arg("--dungeon") ?? "cacada-30";
const LEVEL = 45;
const ip = readFileSync(join(LAB, ".wsl-ip"), "utf8").trim();
const state = JSON.parse(
  readFileSync(join(LAB, "state.local.json"), "utf8"),
) as { users: Record<string, { id: string }> };

const WHO: Array<[string, ClassId, { freePoints?: boolean }]> = [
  ["ana", "guerreiro", {}],
  ["bia", "druida", { freePoints: true }],
  ["caio", "assassino", {}],
];

/** Pontos de habilidade nos slots (Potência, depois Eficiência), evoluindo de tier no marco. */
function growSkills(h: HeroV5): HeroV5 {
  for (let guard = 0; guard < 600; guard++) {
    let spent = false;
    for (const target of ["potencia", "eficiencia"] as const) {
      for (const id of h.skills.slots) {
        const r = spendSkillPoint(h, id, target, B);
        if (r.ok) {
          h = r.hero;
          spent = true;
          break;
        }
      }
      if (spent) break;
    }
    if (spent) continue;
    const s = learnableSkills(h.cls, h.skills.tier).find(
      (x) =>
        h.skills.builds[x.id] &&
        skillCapacity(x, h.skills.builds[x.id]!, h.skills.tier, B) > 0,
    );
    const r = s ? spendSkillPoint(h, s.id, "eficiencia", B) : null;
    if (r && r.ok) {
      h = r.hero;
      continue;
    }
    const e = evolveTier(h, B);
    if (!e.ok) break;
    h = e.hero;
    const kit = REFERENCE_KITS[h.cls].filter((id) => h.skills.builds[id]);
    const slots = setSkillSlots(h, kit);
    if (slots.ok) h = slots.hero;
  }
  return h;
}

function heroFor(cls: ClassId, opts: { freePoints?: boolean }): HeroV5 {
  let h = createHero(cls, randomUUID, B);
  h = { ...h, level: LEVEL, job: LEVEL, gold: 200_000, autoEquip: !opts.freePoints };
  const kit = REFERENCE_KITS[cls].filter((id) => h.skills.builds[id]);
  const slots = setSkillSlots(h, kit);
  if (slots.ok) h = slots.hero;
  h = growSkills(h);
  if (!opts.freePoints) {
    const target = B.allocateByWeights(
      B.attributePoints(h.level),
      CLASSES[cls].referenceBuild,
    );
    const add: Partial<HeroV5["attrs"]> = {};
    for (const k of Object.keys(target) as (keyof HeroV5["attrs"])[]) {
      const d = target[k] - h.attrs[k];
      if (d > 0) add[k] = d;
    }
    const r = raiseAttributes(h, add, B);
    if (r.ok) h = r.hero;
  } else {
    // Metade dos pontos já gastos (a outra metade fica para o teste), e um colar na mochila.
    const target = B.allocateByWeights(
      Math.floor(B.attributePoints(h.level) / 2),
      CLASSES[cls].referenceBuild,
    );
    const add: Partial<HeroV5["attrs"]> = {};
    for (const k of Object.keys(target) as (keyof HeroV5["attrs"])[]) {
      const d = target[k] - h.attrs[k];
      if (d > 0) add[k] = d;
    }
    const r = raiseAttributes(h, add, B);
    if (r.ok) h = r.hero;
    const bought = buyCommonItem(h, { slot: "colar" }, randomUUID, { next: () => Math.random() }, B);
    if (bought.ok) h = bought.hero;
  }
  return h;
}

const heroes = WHO.map(([name, cls, opts]) => ({
  name,
  hero: heroFor(cls, opts),
}));
const d = dungeonById(DUNGEON);
if (!d) throw new Error(`DG ${DUNGEON} não existe`);
const sim = simulateRun(
  d,
  heroes.map((x) => heroRunFighter(x.hero)),
  { mode: "esperado" },
);
console.log(
  `${DUNGEON} com o trio: ${sim.outcome} em ${Math.round(sim.seconds)} s`,
);
for (const x of heroes)
  console.log(
    `${x.name}: ${x.hero.cls} Nv ${x.hero.level} · T${x.hero.skills.tier} · slots ${x.hero.skills.slots.join(", ")} · mochila ${x.hero.bag.length}`,
  );

const client = new MongoClient(`mongodb://${ip}:27018`, {
  serverSelectionTimeoutMS: 5_000,
});
await client.connect();
try {
  const store = new MongoRpgStore(client);
  for (const x of heroes) {
    const id = state.users[x.name]?.id;
    if (!id) {
      console.log(`${x.name}: sem conta na semente`);
      continue;
    }
    const now = Date.now();
    const cur = await store.get(id).catch(() => null);
    const doc = newRpgHero(id, x.hero.cls, now, randomUUID);
    doc.hero = x.hero;
    if (!cur) {
      console.log(`${x.name}: criado`, await store.create(doc));
    } else {
      doc.rev = cur.rev + 1;
      doc.created_at = cur.created_at;
      console.log(`${x.name}: trocado`, await store.save(doc, cur.rev));
    }
  }
} finally {
  await client.close();
}
