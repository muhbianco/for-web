import { t } from "@lingui/core/macro";
import type {
  BoonId,
  ClassId,
  Degree,
  EnemyId,
  EventId,
  Item,
  NodeType,
  Rarity,
  SkillId,
  Slot,
} from "@muchat/space-core/game";

/**
 * Textos do Refúgio (ADR 0009), com o macro `t` de @lingui/core (o mesmo de
 * EditCategory.tsx): extraído pelo `lingui extract` e traduzido na hora em
 * que `gameLabels()` roda. Nunca passar o `t` do `useLingui()` adiante por
 * parâmetro: fora do escopo dele o macro não extrai e o texto vira hash.
 */
export function gameLabels() {
  const cls: Record<ClassId, { name: string; blurb: string }> = {
    cavaleiro: {
      name: t`Cavaleiro`,
      blurb: t`Linha de frente: muita vida, armadura e escudo; parte do dano volta como vida.`,
    },
    arqueiro: {
      name: t`Arqueiro`,
      blurb: t`Dano constante à distância; esquiva os golpes com facilidade.`,
    },
    feiticeiro: {
      name: t`Feiticeiro`,
      blurb: t`Magias de fogo e energia em área; frágil, mas a mana amortece o dano.`,
    },
    druida: {
      name: t`Druida`,
      blurb: t`Cura e controle; começa com uma magia de dano e uma de cura.`,
    },
  };
  const skill: Record<SkillId, string> = {
    espada: t`Espada`,
    machado: t`Machado`,
    maca: t`Maça`,
    distancia: t`Distância`,
    escudo: t`Escudo`,
    magia: t`Magia`,
  };
  const slot: Record<Slot, string> = {
    elmo: t`Elmo`,
    armadura: t`Armadura`,
    calcas: t`Calças`,
    botas: t`Botas`,
    secundaria: t`Mão secundária`,
    arma: t`Arma`,
    anel: t`Anel`,
    amuleto: t`Amuleto`,
  };
  const type: Record<string, string> = {
    espada: t`Espada`,
    machado: t`Machado`,
    maca: t`Maça`,
    arco: t`Arco`,
    varinha: t`Varinha`,
    cajado: t`Cajado`,
    escudo: t`Escudo`,
    aljava: t`Aljava`,
    foco: t`Foco`,
  };
  const rarity: Record<Rarity, string> = {
    comum: t`comum`,
    incomum: t`incomum`,
    raro: t`raro`,
    epico: t`épico`,
    lendario: t`lendário`,
    mitico: t`mítico`,
  };
  /** A raridade concordando com o nome do item ("Armadura rara", "Botas épicas"). */
  const rarityAgree: Record<"m" | "f" | "fp", Record<Rarity, string>> = {
    m: rarity,
    f: {
      comum: t`comum`,
      incomum: t`incomum`,
      raro: t`rara`,
      epico: t`épica`,
      lendario: t`lendária`,
      mitico: t`mítica`,
    },
    fp: {
      comum: t`comuns`,
      incomum: t`incomuns`,
      raro: t`raras`,
      epico: t`épicas`,
      lendario: t`lendárias`,
      mitico: t`míticas`,
    },
  };
  const degree = (d: Degree, abyss = 1): string =>
    ({
      normal: t`Normal`,
      dificil: t`Difícil`,
      pesadelo: t`Pesadelo`,
      abismo: t`Abismo ${abyss}`,
    })[d];
  const node: Record<NodeType, string> = {
    combate: t`Combate`,
    elite: t`Elite`,
    tesouro: t`Tesouro`,
    evento: t`Evento`,
    loja: t`Loja`,
    descanso: t`Descanso`,
    chefe: t`Chefe`,
  };
  const boon: Record<BoonId, { name: string; what: string }> = {
    furia: { name: t`Fúria`, what: t`+20% de dano` },
    ritmo: { name: t`Ritmo`, what: t`+15% de velocidade` },
    olho_agucado: { name: t`Olho aguçado`, what: t`+10% de crítico` },
    seiva_viva: { name: t`Seiva viva`, what: t`regenera vida na luta` },
    eco_arcano: { name: t`Eco arcano`, what: t`magias podem repetir` },
    lamina_larga: { name: t`Lâmina larga`, what: t`ataque atinge mais um` },
    egide: { name: t`Égide`, what: t`escudo de 15% da vida em cada luta` },
    vigor: { name: t`Vigor`, what: t`+12% de vida máxima` },
  };
  const event = (e: EventId, price: number): { title: string; yes: string } =>
    ({
      altar: {
        title: t`Altar rachado: dar 15% da vida em troca de uma bênção?`,
        yes: t`Oferecer`,
      },
      bau: {
        title: t`Baú suspeito: 60% de chance de item, 40% de emboscada.`,
        yes: t`Abrir`,
      },
      andarilho: {
        title: t`Andarilho ferido pede ${price} de ouro: +10% de vida máxima.`,
        yes: t`Ajudar`,
      },
    })[e];
  const enemy: Record<EnemyId, string> = {
    rato: t`Rato-de-cripta`,
    esqueleto: t`Esqueleto lanceiro`,
    fungo: t`Fungo cuspidor`,
    ossario: t`Ossário`,
    matriarca: t`Matriarca do Musgo`,
  };
  const spell: Record<string, string> = {
    golpe_pesado: t`Golpe pesado`,
    brado: t`Brado`,
    investida: t`Investida`,
    muralha: t`Muralha`,
    redemoinho: t`Redemoinho`,
    flecha_luminosa: t`Flecha luminosa`,
    disparo_triplo: t`Disparo triplo`,
    marca_da_presa: t`Marca da presa`,
    perfurante: t`Perfurante`,
    chuva_de_flechas: t`Chuva de flechas`,
    bola_de_fogo: t`Bola de fogo`,
    raio: t`Raio`,
    corrente: t`Corrente`,
    explosao: t`Explosão`,
    meteoro: t`Meteoro`,
    espinheiro: t`Espinheiro`,
    seiva: t`Seiva`,
    onda_gelida: t`Onda gélida`,
    esporos: t`Esporos`,
    furia_da_mata: t`Fúria da mata`,
    espirito: t`Espírito protetor`,
  };
  const dummy = [t`Madeira`, t`Reforçado`, t`Avançado`, t`Mágico`, t`Lendário`];

  /** Mensagem de um erro do servidor para quem joga. */
  const error = (code: string, reason?: string, retryMs?: number): string => {
    if (code === "game_busy")
      return t`A luta ainda está acontecendo. Mais ${Math.ceil((retryMs ?? 0) / 1000)} s.`;
    if (code === "game_disabled")
      return t`O Refúgio está desligado neste servidor.`;
    if (code === "not_allowed")
      return t`Você não tem permissão para jogar aqui.`;
    if (code === "rate_limited") return t`Devagar: muitos comandos seguidos.`;
    if (code !== "game_invalid") return t`Algo deu errado. Tente de novo.`;
    const r: Record<string, string> = {
      exists: t`Você já tem um herói.`,
      no_hero: t`Crie o seu herói primeiro.`,
      hurt: t`O herói está ferido: espere a vida voltar a 30%.`,
      locked: t`Esse degrau ainda está trancado: vença o chefe do anterior.`,
      on_run: t`Termine a expedição primeiro.`,
      no_run: t`Nenhuma expedição em andamento.`,
      no_gold: t`Ouro insuficiente.`,
      full: t`Sem espaço para isso.`,
      bag_full: t`A mochila está cheia.`,
      level: t`Nível insuficiente para esse item.`,
      class: t`Esse item não é da sua classe.`,
      not_found: t`Item não encontrado.`,
      not_owned: t`Você não tem mais desse item para colocar.`,
      out_of_bounds: t`Não cabe aí.`,
      overlap: t`Já tem algo nesse lugar.`,
      reserved: t`Esse lugar é do herói ou do boneco.`,
      offer_pending: t`Escolha uma opção antes de seguir.`,
      no_retreat: t`Só dá para se retirar num descanso.`,
      bad_lane: t`Esse caminho não está ao alcance.`,
      spell: t`Magia de outra classe.`,
      cosmetic_locked: t`Visual ainda não conquistado.`,
      unknown_item: t`Item indisponível.`,
    };
    return (reason && r[reason]) || t`Não foi possível fazer isso agora.`;
  };

  /** Nome curto de um item: tipo (ou espaço) e raridade. */
  const itemName = (it: Item): string => {
    const key = it.type ?? it.slot;
    return `${(it.type && type[it.type]) || slot[it.slot]} ${rarityAgree[GENDER[key] ?? "m"][it.rarity]}`;
  };

  /** Os números do item, numa linha. */
  const itemStats = (it: Item): string => {
    const parts: string[] = [];
    if (it.atk) parts.push(t`ATQ ${it.atk}`);
    if (it.armor) parts.push(t`armadura ${it.armor}`);
    if (it.blockBp) parts.push(t`bloqueio ${it.blockBp / 100}%`);
    for (const [k, v] of Object.entries(it.attrs))
      if (v) parts.push(`${k.toUpperCase()} +${v}`);
    if (it.critBp)
      parts.push(
        t`crítico +${(it.critBp / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
      );
    if (it.speedPct) parts.push(t`velocidade +${it.speedPct}%`);
    if (it.hp) parts.push(t`vida +${it.hp}`);
    if (it.mp) parts.push(t`mana +${it.mp}`);
    return parts.join(" · ");
  };

  return {
    cls,
    skill,
    slot,
    type,
    rarity,
    degree,
    node,
    boon,
    event,
    enemy,
    spell,
    dummy,
    error,
    itemName,
    itemStats,
  };
}

export type GameLabels = ReturnType<typeof gameLabels>;

/** Cor de cada raridade (borda do item). */
export const RARITY_COLOR: Record<Rarity, string> = {
  comum: "#9aa3b2",
  incomum: "#4dd26a",
  raro: "#4a8cff",
  epico: "#b062ff",
  lendario: "#ffb020",
  mitico: "#ff4d6d",
};

/** Gênero (e número) do nome de cada item, para a raridade concordar. */
const GENDER: Record<string, "m" | "f" | "fp"> = {
  elmo: "m",
  armadura: "f",
  calcas: "fp",
  botas: "fp",
  secundaria: "f",
  arma: "f",
  anel: "m",
  amuleto: "m",
  espada: "f",
  machado: "m",
  maca: "f",
  arco: "m",
  varinha: "f",
  cajado: "m",
  escudo: "m",
  aljava: "f",
  foco: "m",
};
