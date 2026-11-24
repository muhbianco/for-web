import { t } from "@lingui/core/macro";
import {
  type RpgRunEndView,
  type RpgRunFeedItem,
  type RpgRunView,
  type RunOutcome,
  COINS,
  dungeonOf,
  itemDef,
  merchantBuys,
  MONSTER_BASE,
  monsterDef,
  abilityDef,
  stageMonsters,
  supplyPrice,
} from "@muchat/space-core/game/ot";

/**
 * Textos da corrida da dungeon (docs/espaco/jogo/ot, etapa O5). Os nomes de monstros, itens,
 * magias e salas são do conteúdo do jogo (space-core); as frases passam pelo lingui.
 */

/** Nome de quem age: herói pelo índice; monstro por 100 + índice na sala. */
export function actorName(run: RpgRunView, st: number, actor: number): string {
  if (actor < MONSTER_BASE) return run.members[actor]?.name ?? "?";
  const list = stageMonsters(run.dungeon, st, run.members.length);
  const id = list[actor - MONSTER_BASE]?.id;
  return (id && monsterDef(id)?.name) || "?";
}

export function stageName(dungeon: string, st: number): string {
  return dungeonOf(dungeon)?.stages[st]?.name ?? "";
}

export function outcomeLabel(o: RunOutcome): string {
  if (o === "vitoria") return t`Vitória!`;
  if (o === "derrota") return t`O grupo caiu`;
  return t`Retirada: o tempo acabou`;
}

/** Uma linha do registro. */
export function feedLine(run: RpgRunView, ev: RpgRunFeedItem): string {
  const name = (actor: number) => actorName(run, ev.st, actor);
  switch (ev.k) {
    case "golpe": {
      const a = name(ev.a);
      const b = name(ev.b);
      if (ev.bl === "erro" && ev.a >= MONSTER_BASE) return t`${b} esquivou de ${a}`;
      if (ev.bl === "erro") return t`${a} errou ${b}`;
      if (ev.bl === "defense") return t`${b} se defendeu de ${a}`;
      if (ev.bl === "armor") return t`A armadura de ${b} segurou ${a}`;
      if (ev.bl === "immunity") return t`${b} não sente o golpe de ${a}`;
      if (ev.c) return t`${a} acertou ${b} em cheio (crítico): ${ev.v}`;
      return t`${a} acertou ${b}: ${ev.v}`;
    }
    case "magia": {
      const a = name(ev.a);
      const b = name(ev.b);
      const spell = ev.a < MONSTER_BASE ? (abilityDef(ev.s)?.name ?? ev.s) : ev.s;
      if (ev.cura && ev.a === ev.b) {
        if (ev.a >= MONSTER_BASE) return t`${a} se curou: +${ev.v}`;
        return t`${a} lançou ${spell}: +${ev.v}`;
      }
      if (ev.cura) return t`${a} lançou ${spell} em ${b}: +${ev.v}`;
      // A Proteção do cavaleiro: ele tomou para si parte do golpe num aliado (run.ts coverHit).
      if (ev.s === "protecao") return t`${b} protegeu o grupo do golpe de ${a}: ${ev.v}`;
      return t`${a} lançou ${spell} em ${b}: ${ev.v}`;
    }
    case "abate": {
      const b = name(ev.b);
      return t`${b} caiu (${ev.exp} de experiência)`;
    }
    case "queda": {
      const b = name(ev.b);
      return t`${b} morreu na dungeon`;
    }
    case "loot": {
      const a = name(ev.a);
      if (ev.item === "moedas" || COINS.includes(ev.item)) {
        const c = coins(ev.n);
        return t`${a} pegou ${c}`;
      }
      const item = itemDef(ev.item)?.name ?? ev.item;
      return ev.n > 1 ? t`${a} pegou ${ev.n}× ${item}` : t`${a} pegou ${item}`;
    }
    case "sala": {
      const n = ev.st + 1;
      const stage = stageName(run.dungeon, ev.st);
      return t`Sala ${n}: ${stage}`;
    }
    case "municao": {
      const a = name(ev.a);
      return t`${a} está sem munição para a arma: luta com os punhos`;
    }
    case "impasse":
      return t`Ninguém conseguiu ferir os monstros por 60 s: o grupo se retira`;
    case "deixado": {
      const a = name(ev.a);
      if (COINS.includes(ev.item)) {
        const c = coins(ev.n);
        return t`Não coube: ${c} ficaram no corpo (${a})`;
      }
      const item = itemDef(ev.item)?.name ?? ev.item;
      return ev.n > 1
        ? t`Não coube: ${ev.n}× ${item} ficaram no corpo (${a})`
        : t`Não coube: ${item} ficou no corpo (${a})`;
    }
    case "gasto": {
      const a = name(ev.a);
      const item = itemDef(ev.item)?.name ?? ev.item;
      return t`${item} de ${a} se desfez`;
    }
    case "desafio": {
      const a = name(ev.a);
      return ev.n === 1
        ? t`${a} desafiou o monstro: ele fica no cavaleiro`
        : t`${a} desafiou ${ev.n} monstros: eles ficam no cavaleiro`;
    }
    case "pocao": {
      const a = name(ev.a);
      const item = itemDef(ev.item)?.name ?? ev.item;
      return ev.mana
        ? t`${a} bebeu ${item}: +${ev.v} de mana`
        : t`${a} bebeu ${item}: +${ev.v}`;
    }
    default:
      return "";
  }
}

/** Eventos que pesam (aparecem com destaque no registro). */
export function isMajor(ev: RpgRunFeedItem): boolean {
  return (
    ev.k === "abate" ||
    ev.k === "queda" ||
    ev.k === "loot" ||
    ev.k === "sala" ||
    ev.k === "desafio" ||
    ev.k === "municao" ||
    ev.k === "impasse" ||
    ev.k === "deixado"
  );
}

/** Moedas em ouro: "1 de ouro", "1.234 de ouro". */
export function coins(n: number): string {
  const v = n.toLocaleString();
  return t`${v} de ouro`;
}

/** "3× Flecha, Anel do gume" */
export function itemList(
  list: readonly { item: string; count: number }[],
): string {
  return list
    .map((l) => {
      const name = itemDef(l.item)?.name ?? l.item;
      return l.count > 1 ? `${l.count}× ${name}` : name;
    })
    .join(", ");
}

/**
 * O analisador da caçada (etapa O8) [OTClient game_analyser]: experiência por hora, o loot
 * pelo que o mercador paga, o gasto pelo preço de repor e o saldo.
 */
export function huntStats(
  run: RpgRunView,
  m: RpgRunEndView["members"][number],
): { expH: number; loot: number; supplies: number; balance: number } {
  const hours = Math.max(1, (run.ends_at - run.started_at) / 1000) / 3600;
  const r = m.reward;
  let loot = r?.gold ?? 0;
  for (const l of r?.loot ?? []) loot += (merchantBuys(l.item) ?? 0) * l.count;
  let supplies = 0;
  for (const s of m.spent ?? []) supplies += supplyPrice(s.item) * s.count;
  return {
    expH: Math.round((r?.exp ?? 0) / hours),
    loot,
    supplies,
    balance: loot - supplies,
  };
}

export function huntLine(
  run: RpgRunView,
  m: RpgRunEndView["members"][number],
): string {
  const h = huntStats(run, m);
  const expH = h.expH.toLocaleString();
  const loot = h.loot.toLocaleString();
  const sup = h.supplies.toLocaleString();
  const bal = (h.balance >= 0 ? "+" : "") + h.balance.toLocaleString();
  return t`${expH} de experiência por hora · loot ${loot} · gasto ${sup} · saldo ${bal}`;
}

/** "1:05" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
