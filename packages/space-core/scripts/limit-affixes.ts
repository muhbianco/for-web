// Os afixos do perfil do limite (25/11/2026, pedido do dono: "a DG exige o limite de cada herói:
// melhores itens da classe, kit do meta e atributos da classe"). Para cada classe, no item da faixa
// (raridade e refino do `limit` do config), preenche os espaços de afixo um por um com o que mais
// sobe a nota da função, a mesma conta do "escolher o melhor sozinho" (items/autoequip.ts: DPS no
// dano; HP efetivo e ameaça no tanque; cura e HP efetivo no suporte). Valor nominal (sem a rolagem).
//
// Rodar (no space-core): node scripts/limit-affixes.ts [--levels 60,250,480]
// O resultado vai à mão para `limit.affixPlan` do config (é dado, não é calculado no jogo).
import {
  type AffixId,
  type ClassId,
  AFFIXES,
  CLASS_IDS,
  CLASSES,
  GEAR_SLOTS,
  JEWEL_EXTRA_AFFIXES,
  RARITIES,
} from "../src/game/ot/balance/content.ts";
import {
  type BalanceHero,
  type ItemInstance,
} from "../src/game/ot/balance/equipment.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import {
  roleScore,
  scoreHero,
} from "../src/game/ot/balance/items/autoequip.ts";
import {
  affixNominal,
  createReference,
} from "../src/game/ot/balance/reference.ts";
import { referenceSkills } from "../src/game/ot/balance/sim/encounters.ts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const LEVELS = arg("levels", "60,250,480").split(",").map(Number);
const R = createReference(B, "limite");

const plans: Record<string, Record<string, Record<string, string[]>>> = {};
for (const L of LEVELS) {
  for (const cls of CLASS_IDS as readonly ClassId[]) {
    const hero: BalanceHero = R.referenceBalanceHero(cls, L, {
      gearAttrs: false,
    });
    for (const it of Object.values(hero.equipment))
      if (it) (it as ItemInstance).affixes = [];
    const hs = referenceSkills(
      cls,
      B.tierFor(hero.job),
      hero.job,
      false,
      B,
      "gabarito",
    );
    const role = CLASSES[cls].role;
    const plan: Record<string, string[]> = {};
    for (const slot of GEAR_SLOTS) {
      const it = hero.equipment[slot] as ItemInstance | undefined;
      if (!it) continue;
      const n =
        RARITIES[it.rarity].affixes +
        (slot === "colar" || slot === "anel" ? JEWEL_EXTRA_AFFIXES : 0);
      const allowed = (Object.keys(AFFIXES) as AffixId[]).filter((id) => {
        const s = AFFIXES[id].slots as readonly string[];
        if (!s.includes(slot)) return false;
        // defPct e mdefPct na secundária só com escudo (a engine confere).
        if (
          slot === "secundaria" &&
          (id === "defPct" || id === "mdefPct") &&
          it.offhand !== "escudo"
        )
          return false;
        return true;
      });
      for (let k = 0; k < n; k++) {
        const base = scoreHero(hero, hs, B, R);
        let best: AffixId | null = null;
        let bestScore = -Infinity;
        for (const id of allowed) {
          if (it.affixes.some((a) => a.id === id)) continue;
          it.affixes.push({ id, value: affixNominal(id, it.ilvl, B) });
          const s = roleScore(role, scoreHero(hero, hs, B, R), base);
          it.affixes.pop();
          if (s > bestScore + 1e-9) {
            bestScore = s;
            best = id;
          }
        }
        if (!best) break;
        it.affixes.push({ id: best, value: affixNominal(best, it.ilvl, B) });
      }
      plan[slot] = it.affixes.map((a) => a.id);
    }
    (plans[cls] ??= {})[String(L)] = plan;
  }
}
for (const [cls, byL] of Object.entries(plans)) {
  console.log(`== ${cls}`);
  for (const slot of GEAR_SLOTS) {
    const row = LEVELS.map((L) => (byL[String(L)]![slot] ?? []).join(",")).join(
      "  |  ",
    );
    if (row.trim()) console.log(`  ${slot.padEnd(10)} ${row}`);
  }
}
