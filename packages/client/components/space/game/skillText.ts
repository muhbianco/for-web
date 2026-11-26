import { t } from "@lingui/core/macro";
import {
  type BuffStat,
  type ClassId,
  type DebuffStat,
  type Effect,
  type Element,
  type EnemyScope,
  type Family,
  type HeroStats,
  type SkillDef,
  type SkillHook,
  type Targeting,
  skillOf,
} from "@muchat/space-core/game/ot/balance";

import { familyName } from "./gameText";
import { num, pct } from "./heroModel";

/**
 * O que uma skill faz, em frases (pedido do dono, 25/11/2026: "não dá pra saber o que elas fazem,
 * se aplica algum efeito por algum tempo, resfriamento"). Sai da skill já compilada (skills/
 * compile.ts: Potência, Eficiência, Mecânicas e lendários somados), a mesma que o motor usa; nada
 * aqui é texto escrito à mão por skill. Com os atributos do herói, o número vem pronto (≈ 240);
 * sem eles (a skill de outra pessoa), vem a fração do ATQ/MATQ.
 */

const secs = (ms: number) => {
  const v = ms / 1000;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")} s`;
};
const plus = (x: number) => `+${pct(x)}`;
const minus = (x: number) => `−${pct(x)}`;
const times = (x: number) =>
  `×${Number.isInteger(x) ? x : x.toFixed(2).replace(/0$/, "").replace(".", ",")}`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function elementName(el: Element): string {
  return el === "magico"
    ? t`mágico`
    : el === "sagrado"
      ? t`sagrado`
      : t`físico`;
}

/** O dano/cura de um coeficiente: ≈ número (com o herói) ou a fração do ATQ/MATQ. */
function scaled(coef: number, el: Element, d: HeroStats | null): string {
  if (d) return `≈ ${num(coef * (el === "magico" ? d.matk : d.atk))}`;
  const p = pct(coef);
  return el === "magico" ? t`${p} do MATQ` : t`${p} do ATQ`;
}

function matkPart(coef: number, d: HeroStats | null): string {
  if (d) return `≈ ${num(coef * d.matk)}`;
  const p = pct(coef);
  return t`${p} do MATQ`;
}

function targetingText(x: Targeting | undefined): string {
  if (x === undefined || x === "alvo") return t`no alvo`;
  if (x === "area") return t`em todos os inimigos`;
  if (x === "primeiro") return t`no primeiro inimigo da fila`;
  if (x === "aleatorios") return t`em inimigos sorteados a cada golpe`;
  if (x.kind === "cadeia") {
    const hops = x.hops;
    const loss = pct(x.falloff);
    return t`no alvo e em mais ${hops}, perdendo ${loss} a cada salto`;
  }
  const max = x.max;
  return t`em até ${max} inimigos em linha`;
}

const scopeWhere = (x: EnemyScope | undefined) =>
  x === "area" ? t`em todos os inimigos` : t`no alvo`;
const scopeWhom = (x: EnemyScope | undefined) =>
  x === "area" ? t`todos os inimigos` : t`o alvo`;

/** "morto-vivo e sombrio"; "fera, humanoide e dragão". */
function families(fs: Family[]): string {
  const names = fs.map((f) => familyName(f));
  if (names.length <= 1) return names[0] ?? "";
  const last = names[names.length - 1]!;
  const rest = names.slice(0, -1).join(", ");
  return t`${rest} e ${last}`;
}

function buffText(stat: BuffStat, v: number): string {
  const up = plus(v);
  const down = minus(v);
  const p = pct(v);
  switch (stat) {
    case "reducao":
      return t`${down} de dano recebido`;
    case "reducaoFisica":
      return t`${down} de dano físico recebido`;
    case "reducaoMagica":
      return t`${down} de dano mágico recebido`;
    case "reducaoCerteiro":
      return t`${down} de dano dos golpes certeiros`;
    case "dano":
      return t`${up} de dano causado`;
    case "poder":
      return t`${up} de ATQ e MATQ`;
    case "critico":
      return t`${up} de chance de crítico`;
    case "multCritico":
      return t`${up} no dano do crítico`;
    case "fuga":
      return t`${up} de fuga`;
    case "esquiva":
      return t`${up} de esquiva`;
    case "precisao":
      return t`${up} de precisão`;
    case "hpMaxPct":
      return t`${up} de vida máxima`;
    case "curaRecebida":
      return t`${up} de cura recebida`;
    case "regenManaPct":
      return t`recupera ${p} da mana máxima por segundo`;
    case "regenVidaPct":
      return t`recupera ${p} da vida máxima por segundo`;
    case "ameacaArea":
      return t`${p} da ameaça também nos outros monstros`;
  }
}

function debuffText(stat: DebuffStat, v: number): string {
  const up = plus(v);
  const down = minus(v);
  const p = pct(v);
  switch (stat) {
    case "danoCausado":
      return t`${down} de dano causado`;
    case "danoRecebido":
      return t`${up} de dano recebido`;
    case "velocidade":
      return t`ataques ${p} mais lentos`;
    case "precisao":
      return t`${down} de precisão`;
    case "defesa":
      return t`${down} de DEF`;
  }
}

/** As frases de um efeito (o principal primeiro, os detalhes depois). */
export function effectLines(e: Effect, d: HeroStats | null): string[] {
  const out: string[] = [];
  switch (e.type) {
    case "dano": {
      const hits = e.hits ?? 1;
      const amount = e.parts
        .map((p) => {
          const a = scaled(p.coef, p.element, d);
          const el = elementName(p.element);
          return t`${a} de dano ${el}`;
        })
        .join(" + ");
      const where = targetingText(e.targets);
      out.push(
        hits > 1
          ? t`${hits} golpes de ${amount} ${where}.`
          : t`Causa ${amount} ${where}.`,
      );
      if (e.critFlat) {
        const v = plus(e.critFlat);
        out.push(t`${v} de chance de crítico.`);
      }
      if (e.lastHitCritFlat) {
        const v = plus(e.lastHitCritFlat);
        out.push(t`${v} de chance de crítico no último golpe.`);
      }
      if (e.critMult) {
        const v = plus(e.critMult);
        out.push(t`${v} no dano do crítico.`);
      }
      if (e.penetration) {
        const p = pct(e.penetration);
        out.push(t`Ignora ${p} da defesa do alvo.`);
      }
      if (e.ambush)
        out.push(t`Crítico garantido se o alvo não estiver atacando você.`);
      if (e.vsFamilies) {
        const m = times(e.vsFamilies.mult);
        const fs = families(e.vsFamilies.families);
        out.push(t`${m} contra ${fs}.`);
      }
      return out;
    }
    case "dot": {
      const per = scaled(e.coefPerSec, e.element, d);
      const el = elementName(e.element);
      const dur = secs(e.durationMs);
      const where = scopeWhere(e.targets);
      out.push(
        e.poison
          ? t`Veneno por ${dur}: ${per} de dano ${el} por segundo ${where}.`
          : t`Dano contínuo por ${dur}: ${per} de dano ${el} por segundo ${where}.`,
      );
      if (d) {
        const total = num(
          e.coefPerSec *
            (e.element === "magico" ? d.matk : d.atk) *
            (e.durationMs / 1000),
        );
        out.push(t`≈ ${total} no total, em cada inimigo atingido.`);
      }
      if (e.stacks && e.stacks > 1) {
        const n = e.stacks;
        out.push(t`Acumula até ${n} vezes no mesmo alvo.`);
      }
      if (e.tickStun && e.tickStun.chance > 0) {
        const c = pct(e.tickStun.chance);
        const sd = secs(e.tickStun.durationMs);
        out.push(
          t`A cada segundo, ${c} de chance de atordoar lacaios e elites por ${sd}.`,
        );
      }
      if (e.selfHealPctMaxHpPerSec) {
        const p = pct(e.selfHealPctMaxHpPerSec);
        out.push(
          t`Enquanto queima, cada inimigo atingido cura você em ${p} da vida máxima por segundo.`,
        );
      }
      return out;
    }
    case "cura": {
      const parts: string[] = [];
      if (e.coefMatk) parts.push(matkPart(e.coefMatk, d));
      if (e.pctMaxHp) {
        const p = pct(e.pctMaxHp);
        parts.push(t`${p} da vida máxima`);
      }
      const amount = parts.join(" + ");
      out.push(
        e.target === "grupo"
          ? t`Cura o grupo todo: ${amount}.`
          : e.target === "proprio"
            ? t`Cura você: ${amount}.`
            : t`Cura um aliado: ${amount}.`,
      );
      if (e.noBonus) out.push(t`Esta cura não usa os seus bônus de cura.`);
      return out;
    }
    case "hot": {
      const parts: string[] = [];
      if (e.coefMatkPerSec) parts.push(matkPart(e.coefMatkPerSec, d));
      if (e.pctMaxHpPerSec) {
        const p = pct(e.pctMaxHpPerSec);
        parts.push(t`${p} da vida máxima`);
      }
      const amount = parts.join(" + ");
      const dur = secs(e.durationMs);
      out.push(
        e.target === "grupo"
          ? t`Cura contínua no grupo todo por ${dur}: ${amount} por segundo.`
          : t`Cura contínua em um aliado por ${dur}: ${amount} por segundo.`,
      );
      if (e.stacks && e.stacks > 1) {
        const n = e.stacks;
        out.push(t`Acumula até ${n} vezes no mesmo aliado.`);
      }
      return out;
    }
    case "escudo": {
      const parts: string[] = [];
      if (e.coefMatk) parts.push(matkPart(e.coefMatk, d));
      if (e.pctMaxHp) {
        // Em você, a vida máxima é a sua: o número sai pronto.
        if (d && e.target === "proprio")
          parts.push(`≈ ${num(e.pctMaxHp * d.hp)}`);
        else {
          const p = pct(e.pctMaxHp);
          parts.push(t`${p} da vida máxima`);
        }
      }
      const amount = parts.join(" + ");
      const dur = secs(e.durationMs);
      out.push(
        e.target === "proprio"
          ? t`Escudo de ${amount} em você por ${dur}.`
          : e.target === "grupo"
            ? t`Escudo de ${amount} em cada um do grupo por ${dur}.`
            : e.target === "alvo-do-chefe"
              ? t`Escudo de ${amount} em quem o chefe estiver atacando, por ${dur}.`
              : t`Escudo de ${amount} em um aliado por ${dur}.`,
      );
      return out;
    }
    case "escudoDeMana": {
      const dur = secs(e.durationMs);
      const p = pct(e.pct);
      out.push(
        t`Por ${dur}, ${p} do dano que você recebe sai da mana em vez da vida.`,
      );
      return out;
    }
    case "buff": {
      const dur = secs(e.durationMs);
      const what = buffText(e.stat, e.value);
      out.push(
        e.target === "grupo"
          ? t`Bônus no grupo todo por ${dur}: ${what}.`
          : t`Bônus em você por ${dur}: ${what}.`,
      );
      return out;
    }
    case "debuff": {
      const dur = secs(e.durationMs);
      const whom = scopeWhom(e.targets);
      // Só no chefe (Armadilha de Gelo: os lacaios ficam presos, o chefe só fica mais lento).
      if (e.value <= 0) {
        if (e.bossValue && e.bossValue > 0) {
          const b = debuffText(e.stat, e.bossValue);
          out.push(t`Enfraquece o chefe por ${dur}: ${b}.`);
        }
        return out;
      }
      const what = debuffText(e.stat, e.value);
      out.push(t`Enfraquece ${whom} por ${dur}: ${what}.`);
      if (e.bossValue !== undefined && e.bossValue !== e.value) {
        if (e.bossValue <= 0) out.push(t`Não pega no chefe.`);
        else {
          const b = debuffText(e.stat, e.bossValue);
          out.push(t`No chefe: ${b}.`);
        }
      }
      return out;
    }
    case "atordoar": {
      const dur = secs(e.durationMs);
      const max = e.max;
      const whom = max
        ? max === 1
          ? t`1 inimigo`
          : t`até ${max} inimigos`
        : scopeWhom(e.targets);
      if (e.chance !== undefined && e.chance < 1) {
        const c = pct(e.chance);
        out.push(t`${c} de chance de atordoar ${whom} por ${dur}.`);
      } else out.push(t`Atordoa ${whom} por ${dur}.`);
      return out;
    }
    case "provocar": {
      const dur = secs(e.durationMs);
      out.push(
        e.scope === "sala"
          ? t`Provoca a sala inteira por ${dur}: todos passam a atacar você.`
          : t`Provoca o alvo por ${dur}: ele passa a atacar você.`,
      );
      return out;
    }
    case "cortaAmeaca": {
      const p = pct(e.pct);
      out.push(t`Corta ${p} da sua ameaça: os monstros tendem a largar você.`);
      return out;
    }
    case "reviver": {
      const p = pct(e.hpPct);
      out.push(t`Revive um aliado caído com ${p} da vida.`);
      return out;
    }
    case "purificar": {
      const n = e.count;
      const base =
        e.target === "grupo"
          ? n === 1
            ? t`Tira 1 efeito ruim de cada um do grupo`
            : t`Tira ${n} efeitos ruins de cada um do grupo`
          : n === 1
            ? t`Tira 1 efeito ruim de um aliado`
            : t`Tira ${n} efeitos ruins de um aliado`;
      if (e.everyMs && e.durationMs) {
        const every = secs(e.everyMs);
        const dur = secs(e.durationMs);
        out.push(t`${base}, a cada ${every} durante ${dur}.`);
      } else out.push(`${base}.`);
      if (e.chance !== undefined && e.chance < 1) {
        const c = pct(e.chance);
        out.push(t`${c} de chance de funcionar.`);
      }
      return out;
    }
  }
}

/** A frase de um gancho (o que a skill faz além do efeito principal); null: nada a dizer. */
export function hookLine(
  h: SkillHook,
  d: HeroStats | null,
  healing: boolean,
): string | null {
  // Os efeitos do gancho: a frase principal de cada um, emendadas ("…; enfraquece o alvo…").
  const sub = (es: Effect[]) =>
    `${es
      .map((e) => effectLines(e, d)[0])
      .filter((l): l is string => !!l)
      .map((l) => lowerFirst(l.replace(/\.$/, "")))
      .join("; ")}.`;
  switch (h.on) {
    case "acerto": {
      if (h.chance <= 0) return null;
      const s = sub(h.effects);
      if (h.chance >= 1)
        return h.spread
          ? t`Ao acertar, em outro inimigo: ${s}`
          : t`Ao acertar: ${s}`;
      const c = pct(h.chance);
      return h.spread
        ? t`Ao acertar, ${c} de chance, em outro inimigo: ${s}`
        : t`Ao acertar, ${c} de chance: ${s}`;
    }
    case "bloqueio": {
      if (h.chance <= 0) return null;
      const c = pct(h.chance);
      return t`Ao bloquear, ${c} de chance de zerar a recarga desta skill.`;
    }
    case "esquiva": {
      if (h.chance <= 0) return null;
      const c = pct(h.chance);
      const s = sub(h.effects);
      return t`Ao esquivar, ${c} de chance de contra-atacar: ${s}`;
    }
    case "bonus": {
      if (h.value <= 0) return null;
      const v = plus(h.value);
      const when =
        h.when === "3+inimigos"
          ? t`com 3 ou mais inimigos`
          : h.when === "alvoAbaixo35"
            ? t`contra alvos abaixo de 35% da vida`
            : h.when === "alvoAcima70"
              ? t`contra alvos acima de 70% da vida`
              : h.when === "aposBloqueio"
                ? t`logo depois de um bloqueio`
                : (() => {
                    const fs = families(h.families ?? []);
                    return t`contra ${fs}`;
                  })();
      return healing ? t`${v} de cura ${when}.` : t`${v} de dano ${when}.`;
    }
    case "fluxo": {
      if (h.seconds <= 0) return null;
      const s = secs(h.seconds * 1000);
      return t`Cada acerto tira ${s} da recarga das outras skills.`;
    }
    case "danoCura": {
      if (h.pct <= 0) return null;
      const p = pct(h.pct);
      return h.target === "menorHp"
        ? t`${p} do dano causado cura o aliado com menos vida.`
        : t`${p} do dano causado cura você.`;
    }
    case "porInimigo": {
      if (h.healPctMaxHp <= 0) return null;
      const p = pct(h.healPctMaxHp);
      return t`Cada inimigo atingido cura você em ${p} da vida máxima.`;
    }
    case "sobracura": {
      if (h.shieldPct <= 0) return null;
      const p = pct(h.shieldPct);
      return t`${p} da cura que passar do máximo vira escudo no alvo.`;
    }
    case "escudoQuebra": {
      if (h.pct <= 0) return null;
      const p = pct(h.pct);
      return h.targets === "area"
        ? t`Quando o escudo quebra, ${p} do que ele absorveu vira dano sagrado em todos os inimigos.`
        : t`Quando o escudo quebra, ${p} do que ele absorveu vira dano sagrado em quem bateu.`;
    }
    case "escudoDivide": {
      if (h.pct <= 0) return null;
      const p = pct(h.pct);
      return t`${p} do escudo vai também para o aliado com menos vida.`;
    }
    case "reflete": {
      if (h.pct <= 0) return null;
      const p = pct(h.pct);
      return t`Devolve ${p} do dano recebido enquanto dura.`;
    }
    case "manaVolta": {
      if (h.pct <= 0) return null;
      const p = pct(h.pct);
      return t`No fim, ${p} da mana gasta pelo escudo de mana volta.`;
    }
    case "recusaMorte":
      return t`Uma vez por luta, um golpe fatal deixa você com 1 de vida e solta esta skill, se ela estiver pronta.`;
    case "criticoAbaixo": {
      const p = pct(h.pct);
      return t`Sempre crítico em alvos abaixo de ${p} da vida.`;
    }
    case "repete": {
      if (h.pct <= 0) return null;
      const p = pct(h.pct);
      return t`Sai de novo logo depois, com ${p} do dano.`;
    }
    case "semCusto": {
      if (h.chance <= 0) return null;
      const c = pct(h.chance);
      return t`${c} de chance de não gastar mana.`;
    }
  }
}

/**
 * Tudo o que a skill faz, na ordem: os efeitos, os ganchos, a ameaça e a conjuração; no fim, que
 * o chefe nunca é atordoado (quando a skill atordoa).
 */
export function skillLines(def: SkillDef, d: HeroStats | null): string[] {
  const out = def.effects.flatMap((e) => effectLines(e, d));
  const healing = !def.effects.some(
    (e) => e.type === "dano" || e.type === "dot",
  );
  for (const h of def.hooks ?? []) {
    const line = hookLine(h, d, healing);
    if (line) out.push(line);
  }
  if (def.threatMult && def.threatMult !== 1) {
    const m = times(def.threatMult);
    out.push(t`Gera ${m} de ameaça: o monstro tende a mirar você.`);
  }
  if (def.castMs) {
    const c = secs(def.castMs);
    out.push(t`Conjuração de ${c}: o efeito cai depois desse tempo.`);
  }
  const stuns =
    def.effects.some(
      (e) =>
        e.type === "atordoar" ||
        (e.type === "dot" && (e.tickStun?.chance ?? 0) > 0),
    ) ||
    (def.hooks ?? []).some(
      (h) =>
        (h.on === "acerto" || h.on === "esquiva") &&
        h.chance > 0 &&
        h.effects.some((e) => e.type === "atordoar"),
    );
  if (stuns) out.push(t`O chefe nunca é atordoado.`);
  return out;
}

/** Quanto dura o efeito mais longo (para a linha de cima do detalhe); 0: instantânea. */
export function longestEffectMs(def: SkillDef): number {
  let ms = 0;
  for (const e of def.effects)
    if ("durationMs" in e && typeof e.durationMs === "number")
      ms = Math.max(ms, e.durationMs);
  return ms;
}

/** O ícone de uma skill pelo que ela faz (o primeiro efeito do conteúdo). */
export function skillIcon(cls: ClassId, id: string): string {
  const s = skillOf(cls, id);
  const e = s?.effects[0];
  if (!e) return "star";
  switch (e.type) {
    case "dano": {
      const el = e.parts[0]?.element;
      if (el === "sagrado") return "flare";
      if (el === "magico")
        return cls === "druida"
          ? "eco"
          : cls === "padre"
            ? "flare"
            : "local_fire_department";
      if (e.targets === "area") return "cyclone";
      return cls === "cacador" ? "north_east" : "swords";
    }
    case "dot":
      return e.poison
        ? "science"
        : e.element === "magico"
          ? "whatshot"
          : "water_drop";
    case "cura":
      return "healing";
    case "hot":
      return "spa";
    case "escudo":
    case "escudoDeMana":
      return "shield";
    case "buff":
      return "trending_up";
    case "debuff":
      return "trending_down";
    case "provocar":
      return "campaign";
    case "atordoar":
      return "flash_on";
    case "reviver":
      return "favorite";
    case "purificar":
      return "water_drop";
    case "cortaAmeaca":
      return "visibility_off";
  }
  return "star";
}
