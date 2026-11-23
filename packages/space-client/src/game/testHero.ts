import { addExperience, addItem, autoEquip, expForLevel, gearOf, type RunHero, type SkillId, START, starterInventory, type VocationId, VOCATIONS } from "@muchat/space-core/game/ot";

/**
 * Um herói de corrida montado à mão, para os testes da cena e a página de dev (docs/espaco/jogo/ot,
 * O10): level pela curva do OT, skill da vocação, o kit com a mochila (etapa O7), os itens a mais
 * e o melhor vestido. Não entra no app.
 */
export function testHero(vocation: VocationId, level: number, skill: number, ml: number, owned: readonly string[] = [], name = `H${vocation}`): RunHero {
  const voc = VOCATIONS[vocation];
  const st = addExperience(voc, { level: 1, experience: 0, healthMax: START.health, manaMax: START.mana, cap: START.cap }, expForLevel(level));
  const skills = { punhos: 10, maca: 10, espada: 10, machado: 10, distancia: 10, escudo: 10 } as Record<SkillId, number>;
  if (voc.base === 4) {
    skills.espada = skill;
    skills.escudo = skill;
  }
  if (voc.base === 3) skills.distancia = skill;
  const inv = starterInventory(voc.base, "mochila");
  for (const id of owned) addItem(inv, 100_000, id, 1);
  autoEquip(inv, vocation, st.level, skills, st.manaMax);
  return { userId: `u${vocation}`, name, vocation, level: st.level, healthMax: st.healthMax, manaMax: st.manaMax, skills, magicLevel: ml, stamina: 2520, gear: gearOf(inv), inv, cap: st.cap };
}
