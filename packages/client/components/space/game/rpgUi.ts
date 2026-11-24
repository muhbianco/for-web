import { t } from "@lingui/core/macro";
import {
  type RpgHeroView,
  type SkillId,
  type TrainingSkill,
  type VocationId,
  addManaSpent,
  addPointTries,
  addSkillTries,
  JOB_NAMES,
  reqPointTries,
  reqMana,
  reqSkillTries,
  TRAINING,
  trainingDelta,
  trainingGain,
  VOCATIONS,
} from "@muchat/space-core/game/ot";

/**
 * Apoio da interface do jogo idle (docs/espaco/jogo/ot): textos (com o macro `t` de
 * @lingui/core, extraído pelo `lingui extract`; nunca passar o `t` do `useLingui()` por
 * parâmetro) e a projeção do treino pelo relógio, com as mesmas regras do servidor.
 */
export function rpgLabels() {
  const vocation: Record<1 | 2 | 3 | 4, { name: string; blurb: string }> = {
    1: {
      name: t`Feiticeiro`,
      blurb: t`Magia de ataque. Pouca vida, muita mana; treina magia.`,
    },
    2: {
      name: t`Druida`,
      blurb: t`Magia de gelo e terra e as melhores curas; treina magia.`,
    },
    3: {
      name: t`Arqueiro`,
      blurb: t`Ataque à distância e um pouco de magia; treina distância.`,
    },
    4: {
      name: t`Cavaleiro`,
      blurb: t`Espada, machado ou maça e escudo; a vocação com mais vida.`,
    },
  };
  const skill: Record<SkillId | TrainingSkill, string> = {
    punhos: t`Punhos`,
    espada: t`Espada`,
    machado: t`Machado`,
    maca: t`Maça`,
    distancia: t`Distância`,
    escudo: t`Escudo`,
    magia: t`Magia`,
    habilidade: t`Habilidade`,
  };
  const error = (code: string, reason?: string): string => {
    if (code === "not_allowed" && reason === "too_far")
      return t`Chegue mais perto do dummy para treinar.`;
    if (code === "not_allowed") return t`Você não pode usar este dummy aqui.`;
    if (code === "not_found") return t`Este dummy não está mais aqui.`;
    if (code === "game_disabled")
      return t`O jogo está desligado neste servidor.`;
    if (code === "rate_limited") return t`Devagar: muitos comandos seguidos.`;
    if (code === "rpg_invalid" && reason === "no_bank")
      return t`Sem saldo de treino agora. Ele volta a encher enquanto você não treina.`;
    if (code === "rpg_invalid" && reason === "no_vocation")
      return t`Escolha a vocação primeiro.`;
    if (code === "rpg_invalid" && reason === "vocation_set")
      return t`A vocação já foi escolhida.`;
    if (code === "rpg_invalid" && reason === "tv_busy")
      return t`Já tem um grupo se formando nesta TV. Entre nele ou espere.`;
    if (code === "rpg_invalid" && reason === "in_lobby")
      return t`Você já está em outro grupo. Saia dele primeiro.`;
    if (code === "rpg_invalid" && reason === "full")
      return t`O grupo está cheio.`;
    if (code === "rpg_invalid" && reason === "level")
      return t`Seu herói ainda não tem o level mínimo desta dungeon.`;
    if (code === "rpg_invalid" && reason === "no_run")
      return t`Essa partida já acabou.`;
    if (code === "rpg_invalid" && reason === "no_lobby")
      return t`Esse grupo não existe mais.`;
    if (code === "rpg_invalid" && reason === "not_leader")
      return t`Só quem montou o grupo pode começar.`;
    if (code === "rpg_invalid" && reason === "expired")
      return t`O tempo do grupo acabou. Monte de novo.`;
    if (code === "rpg_invalid" && reason === "in_run")
      return t`O herói está numa dungeon agora. Espere a corrida acabar.`;
    if (code === "rpg_invalid" && reason === "changed")
      return t`O grupo mudou enquanto começava. Confira e comece de novo.`;
    if (code === "rpg_invalid" && reason === "wrong_dummy")
      return t`Este dummy não treina isso: as armas e a magia são no dummy de vocação; a habilidade, no dummy de habilidade.`;
    if (code === "rpg_invalid" && reason === "no_points")
      return t`Faltam pontos para isso.`;
    if (code === "rpg_invalid" && reason === "stat_max")
      return t`Esse atributo já está no máximo (99).`;
    if (code === "rpg_invalid" && reason === "requires")
      return t`Aprenda antes o adereço de que este depende.`;
    if (code === "rpg_invalid" && reason === "tier")
      return t`Essa parte da árvore abre com a evolução de classe, no Mestre.`;
    if (code === "rpg_invalid" && reason === "max_rank")
      return t`Esse adereço já está no máximo.`;
    return t`Não foi possível fazer isso agora. Tente de novo.`;
  };
  return { vocation, skill, error };
}

/** Nome de qualquer vocação, com as promovidas (etapa O8). */
export function vocationName(v: number): string {
  switch (v) {
    case 1:
      return t`Feiticeiro`;
    case 2:
      return t`Druida`;
    case 3:
      return t`Arqueiro`;
    case 4:
      return t`Cavaleiro`;
    case 5:
      return t`Arquimago`;
    case 6:
      return t`Ancião`;
    case 7:
      return t`Caçador`;
    case 8:
      return t`Campeão`;
    default:
      return t`Aprendiz`;
  }
}

/**
 * O nome da classe com a evolução (24/11/2026): a 1ª e a 2ª são as vocações do OT; a 3ª, a nova
 * (o nome vem do conteúdo do jogo).
 */
export function className(v: number, job: number): string {
  if (job >= 3) {
    const base = VOCATIONS[v as VocationId]?.base ?? 0;
    if (base >= 1 && base <= 4) return JOB_NAMES[base as 1 | 2 | 3 | 4][2];
  }
  return vocationName(v);
}

/** Skills que a vocação treina bem (as outras andam devagar demais). */
export function mainSkills(v: VocationId): readonly TrainingSkill[] {
  const base = VOCATIONS[v].base;
  if (base === 4) return ["espada", "machado", "maca"];
  if (base === 3) return ["distancia"];
  if (base === 1 || base === 2) return ["magia"];
  return [];
}

/** O relógio do servidor agora, a partir do último estado. */
export function serverNow(
  serverNowAtState: number,
  receivedAt: number,
  now = Date.now(),
): number {
  return serverNowAtState + (now - receivedAt);
}

export interface Projected {
  /** Nível, tentativas e requisito do próximo, já com o treino desde o último crédito. */
  skill: { level: number; tries: number; next: number } | null;
  shield: { level: number; tries: number; next: number };
  /** Tempo de treino que ainda cabe no orçamento desta sessão. */
  remainingMs: number;
}

/** Projeta o treino aberto até `now` (relógio do servidor), pelas regras puras. */
export function projectTraining(
  hero: RpgHeroView,
  now: number,
): Projected | null {
  const tr = hero.training;
  if (!tr) return null;
  const voc = VOCATIONS[hero.vocation];
  const ms = Math.min(Math.max(0, now - tr.started_at), tr.budget_ms);
  const seconds = Math.floor(ms / 1000);
  const remainingMs = Math.max(0, tr.budget_ms - ms);
  const gain =
    seconds * 1000 < TRAINING.minCreditMs
      ? { main: 0, escudo: 0 }
      : trainingDelta(voc, tr.skill, tr.credited_s, seconds, hero.rates);
  const sh0 = hero.skills.escudo;
  const sh = addSkillTries(
    voc,
    "escudo",
    { level: sh0.level, tries: sh0.tries },
    gain.escudo,
  );
  const shield = { ...sh, next: reqSkillTries(voc, "escudo", sh.level + 1) };
  if (tr.skill === "habilidade") {
    // Treino de habilidade (24/11/2026): o "nível" é o total de pontos ganhos.
    const p = addPointTries(
      { points: hero.skill_points.earned, tries: hero.skill_points.tries },
      gain.main,
    );
    return {
      skill: { level: p.points, tries: p.tries, next: reqPointTries(p.points + 1) },
      shield,
      remainingMs,
    };
  }
  if (tr.skill === "magia") {
    const m = addManaSpent(
      voc,
      { level: hero.magic.level, manaSpent: hero.magic.mana_spent },
      gain.main,
    );
    return {
      skill: {
        level: m.level,
        tries: m.manaSpent,
        next: reqMana(voc, m.level + 1),
      },
      shield,
      remainingMs,
    };
  }
  const s0 = hero.skills[tr.skill];
  const s = addSkillTries(
    voc,
    tr.skill,
    { level: s0.level, tries: s0.tries },
    gain.main,
  );
  return {
    skill: { ...s, next: reqSkillTries(voc, tr.skill, s.level + 1) },
    shield,
    remainingMs,
  };
}

/** Saldo de treino agora (sem sessão aberta, enche até 12 h). */
export function bankNow(hero: RpgHeroView, now: number): number {
  if (hero.training)
    return Math.max(
      0,
      hero.training.budget_ms - Math.max(0, now - hero.training.started_at),
    );
  return Math.min(
    TRAINING.maxBankMs,
    hero.bank_ms + Math.max(0, now - hero.bank_at),
  );
}

/** Horas de dummy até o próximo nível da skill, pela regra do treino (para escolher). */
export function hoursToNext(hero: RpgHeroView, skill: TrainingSkill): number {
  const voc = VOCATIONS[hero.vocation];
  const perHour = trainingGain(voc, skill, 3600, hero.rates).main;
  if (perHour <= 0) return Number.POSITIVE_INFINITY;
  const left =
    skill === "habilidade"
      ? hero.skill_points.next - hero.skill_points.tries
      : skill === "magia"
        ? hero.magic.next - hero.magic.mana_spent
        : hero.skills[skill].next - hero.skills[skill].tries;
  return Math.max(0, left) / perHour;
}

/** "3 h 20 min", "45 min", "menos de 1 min". */
export function duration(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t`menos de 1 min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return t`${m} min`;
  if (m === 0) return t`${h} h`;
  return t`${h} h ${m} min`;
}

/** Porcentagem inteira até o próximo nível. */
export function percent(tries: number, next: number): number {
  return next > 0 ? Math.min(99, Math.floor((tries * 100) / next)) : 0;
}
