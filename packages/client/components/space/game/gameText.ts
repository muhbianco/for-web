import { t } from "@lingui/core/macro";
import type {
  ArchetypeKey,
  ClassId,
  Condition,
  DungeonDef,
  DungeonKind,
  Family,
  GearSlot,
  MechanicEvent,
  PotionSize,
  RarityId,
  Stat,
} from "@muchat/space-core/game/ot/balance";

import type { DerivedKey } from "./heroModel";

/**
 * Os textos das telas do Idle Hunt v5 (macro `t` de @lingui/core, extraído pelo `lingui extract`;
 * cada função lê o idioma na hora da chamada, então nunca no topo do módulo). Nomes de conteúdo
 * (skills, mecânicas, regiões, títulos, itens) vêm do núcleo, em português, como na engine antiga.
 */

export function roleName(role: "tanque" | "suporte" | "dps"): string {
  return role === "tanque"
    ? t`Tanque`
    : role === "suporte"
      ? t`Suporte`
      : t`Dano`;
}

/** O que cada classe faz, em uma linha (o jogador novo escolhe por isto). */
export function classBlurb(cls: ClassId): string {
  switch (cls) {
    case "guerreiro":
      return t`Segura os monstros com muita vida e cura um pouco a cada golpe.`;
    case "paladino":
      return t`Defende o grupo de golpes e de magia; bate com dano sagrado.`;
    case "padre":
      return t`Cura direta, escudos e ressurreição: mantém o grupo de pé.`;
    case "druida":
      return t`Cura ao longo do tempo, devolve mana e enfraquece os monstros.`;
    case "mago":
      return t`Magia em área e golpes de explosão; nunca erra.`;
    case "cacador":
      return t`Ataca de longe sem parar; gasta flechas e ajuda com utilidades.`;
    case "assassino":
      return t`Corpo a corpo de crítico alto e veneno; precisa de sorte.`;
  }
}

export function statName(s: Stat): string {
  return s;
}

export function statBlurb(s: Stat): string {
  switch (s) {
    case "FOR":
      return t`Força: ATQ corpo a corpo e das armas de força.`;
    case "AGI":
      return t`Agilidade: esquiva e velocidade de ataque.`;
    case "VIT":
      return t`Vitalidade: +1% de vida por ponto e um pouco de defesa.`;
    case "INT":
      return t`Inteligência: +1% de mana, MATQ e defesa mágica.`;
    case "DES":
      return t`Destreza: ATQ à distância, precisão, golpe mínimo e recarga.`;
    case "SOR":
      return t`Sorte: crítico, esquiva perfeita e um pouco de tudo.`;
  }
}

export function derivedName(k: DerivedKey): string {
  switch (k) {
    case "hp":
      return t`Vida`;
    case "mp":
      return t`Mana`;
    case "atk":
      return t`ATQ`;
    case "matk":
      return t`MATQ`;
    case "def":
      return t`DEF`;
    case "mdef":
      return t`DEF mágica`;
    case "hit":
      return t`Precisão`;
    case "flee":
      return t`Fuga`;
    case "critRating":
      return t`Crítico (nota)`;
    case "attacksPerSecond":
      return t`Ataques/s`;
    case "cooldownCut":
      return t`Recarga −`;
    case "block":
      return t`Bloqueio`;
  }
}

export function slotName(s: GearSlot): string {
  switch (s) {
    case "arma":
      return t`Arma`;
    case "secundaria":
      return t`Mão secundária`;
    case "elmo":
      return t`Elmo`;
    case "armadura":
      return t`Armadura`;
    case "calcas":
      return t`Calças`;
    case "botas":
      return t`Botas`;
    case "colar":
      return t`Colar`;
    case "anel":
      return t`Anel`;
  }
}

export function rarityName(r: RarityId): string {
  switch (r) {
    case "comum":
      return t`Comum`;
    case "incomum":
      return t`Incomum`;
    case "raro":
      return t`Raro`;
    case "epico":
      return t`Épico`;
    case "lendario":
      return t`Lendário`;
  }
}

export function sizeName(s: PotionSize): string {
  return s === "pequena" ? t`Pequena` : s === "media" ? t`Média` : t`Grande`;
}

export function weightName(w: string): string {
  return w === "leve" ? t`leve` : w === "media" ? t`média` : t`pesada`;
}

/** "Caçada 40", "Masmorra 40"; o Chefe de Região pelo nome dele (o catálogo da TV). */
export function dungeonTitle(d: DungeonDef): string {
  const level = d.level;
  switch (d.kind) {
    case "cacada":
      return t`Caçada ${level}`;
    case "masmorra":
      return t`Masmorra ${level}`;
    case "regional":
      return d.name;
  }
}

export function kindName(k: DungeonKind): string {
  return k === "cacada"
    ? t`Caçada`
    : k === "masmorra"
      ? t`Masmorra`
      : t`Chefe de Região`;
}

/**
 * O tipo de DG numa frase, com os números do núcleo (o tamanho do grupo e o item do chefe):
 * `party` de `kindParty` e `boss` de `bossLoot` (dungeonUi.ts).
 */
export function kindBlurb(
  k: DungeonKind,
  party: { min: number; max: number },
  boss: { perPlayer: boolean; floor: RarityId },
): string {
  const { min, max } = party;
  const rarity = rarityName(boss.floor);
  const item = boss.perPlayer
    ? t`1 item ${rarity} ou melhor para cada um`
    : t`1 item ${rarity} ou melhor para alguém do grupo`;
  switch (k) {
    case "cacada":
      return t`De ${min} a ${max} heróis. Três salas de monstros e um chefe menor: dá para ir sozinho. O chefe dá ${item}.`;
    case "masmorra":
      return t`De ${min} a ${max} heróis. O chefe tem mecânicas: tanque, suporte e dano fazem falta. O chefe dá ${item}.`;
    case "regional":
      return t`De ${min} a ${max} heróis. O chefe da região, em 3 fases. Abre quando as Caçadas e Masmorras da região estão concluídas. O chefe dá ${item}.`;
  }
}

export function archetypeName(a: ArchetypeKey): string {
  switch (a) {
    case "lacaio":
      return t`Lacaio`;
    case "elite":
      return t`Elite`;
    case "chefeMenor":
      return t`Chefe`;
    case "chefe":
      return t`Chefe da masmorra`;
    case "regional":
      return t`Chefe de Região`;
  }
}

export function familyName(f: Family | undefined): string {
  switch (f) {
    case "fera":
      return t`fera`;
    case "humanoide":
      return t`humanoide`;
    case "morto-vivo":
      return t`morto-vivo`;
    case "sombrio":
      return t`sombrio`;
    case "elemental":
      return t`elemental`;
    case "dragao":
      return t`dragão`;
    case "aberracao":
      return t`aberração`;
    default:
      return "";
  }
}

export function mechanicName(m: MechanicEvent): string {
  switch (m) {
    case "golpe-pesado":
      return t`Golpe Pesado`;
    case "pulso":
      return t`Pulso Sombrio`;
    case "maldicao":
      return t`Maldição`;
    case "invocacao":
      return t`Invocação`;
    case "dreno":
      return t`Drenar Mana`;
    case "investida":
      return t`Investida`;
    case "fase":
      return t`Fase nova`;
  }
}

/** O que a mecânica faz, em uma linha (o aviso na tela da corrida). */
export function mechanicHint(m: MechanicEvent): string {
  switch (m) {
    case "golpe-pesado":
      return t`Golpe certeiro e pesado no alvo do chefe.`;
    case "pulso":
      return t`Dano mágico em todo o grupo.`;
    case "maldicao":
      return t`Alguém perde vida a cada segundo até ser purificado.`;
    case "invocacao":
      return t`O chefe chamou lacaios.`;
    case "dreno":
      return t`Quem usa magia perde mana por alguns segundos.`;
    case "investida":
      return t`Golpe forte em alguém que não é o tanque.`;
    case "fase":
      return t`O chefe ficou mais forte e mais rápido.`;
  }
}

// ------------------------------------------------------------ IA das skills (§5)

export type ConditionKind = Condition["kind"];

export const CONDITION_KINDS: ConditionKind[] = [
  "sempre",
  "soEmChefe",
  "inimigos",
  "precisaCura",
  "aliadoAbaixo",
  "aliadosAbaixo",
  "aliadoComMpAbaixo",
  "meuHpAbaixo",
  "aliadoAmaldicoado",
  "aliadoCaido",
  "chefePreparando",
  "perdiAggro",
  "sendoAlvo",
];

export function conditionText(c: Condition): string {
  switch (c.kind) {
    case "sempre":
      return t`Sempre`;
    case "soEmChefe":
      return t`Só no chefe`;
    case "inimigos":
      return t`${c.min}+ inimigos`;
    case "aliadoAbaixo":
      return t`Aliado abaixo de ${Math.round(c.pct * 100)}%`;
    case "aliadosAbaixo":
      return t`${c.min}+ aliados abaixo de ${Math.round(c.pct * 100)}%`;
    case "aliadoComMpAbaixo":
      return t`Aliado com mana abaixo de ${Math.round(c.pct * 100)}%`;
    case "precisaCura":
      return t`Quando a cura rende`;
    case "aliadoAmaldicoado":
      return t`Aliado amaldiçoado`;
    case "aliadoCaido":
      return t`Aliado caído`;
    case "meuHpAbaixo":
      return t`Minha vida abaixo de ${Math.round(c.pct * 100)}%`;
    case "chefePreparando":
      return t`Chefe preparando golpe`;
    case "perdiAggro":
      return t`Perdi o monstro`;
    case "sendoAlvo":
      return t`Quando sou o alvo`;
  }
}

/** A condição nova com os números padrão (o editor ajusta depois). */
export function defaultCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case "inimigos":
      return { kind, min: 3 };
    case "aliadoAbaixo":
    case "aliadoComMpAbaixo":
      return { kind, pct: 0.5 };
    case "aliadosAbaixo":
      return { kind, pct: 0.6, min: 2 };
    case "meuHpAbaixo":
      return { kind, pct: 0.4 };
    default:
      return { kind } as Condition;
  }
}

// ------------------------------------------------------------ erros

/** Os motivos das recusas (do núcleo e do servidor), numa frase que diz o que fazer. */
export function errorText(code?: string, reason?: string): string {
  const r = reason ?? code ?? "";
  switch (r) {
    case "sem-ouro":
      return t`Ouro insuficiente.`;
    case "mochila-cheia":
      return t`A mochila está cheia (40 espaços). Venda, guarde no cofre ou desmonte algo.`;
    case "cofre-cheio":
      return t`O cofre está cheio. Amplie no Banqueiro.`;
    case "sem-minerio":
      return t`Faltam minérios da região do item.`;
    case "sem-pedra":
      return t`Você não tem Pedra de Proteção.`;
    case "nao-refinavel":
      return t`Este item não pode ser refinado.`;
    case "no-maximo":
      return t`O item já está no +10.`;
    case "confirmacao":
    case "confirmacao-dupla":
      return t`Este item é +7 ou mais: confirme de novo.`;
    case "classe-nao-usa":
      return t`Sua classe não usa este item.`;
    case "peso-acima-da-classe":
      return t`Armadura pesada demais para a sua classe.`;
    case "nivel-baixo":
      return t`Seu nível ainda não é o pedido pelo item.`;
    case "duas-maos-com-escudo":
      return t`Arma de duas mãos não combina com escudo.`;
    case "focus-sem-arma-magica-de-uma-mao":
      return t`O focus só vai com arma mágica de uma mão.`;
    case "aljava-sem-arma-de-distancia":
      return t`A aljava só vai com arco ou besta.`;
    case "sem-pontos":
      return t`Sem pontos livres.`;
    case "pedido-vazio":
      return t`Marque algum ponto antes de confirmar.`;
    case "potencia-no-teto":
      return t`A Potência chegou ao teto do seu tier. Evolua no Mestre.`;
    case "eficiencia-no-teto":
    case "mecanica-no-teto":
      return t`Já está no máximo.`;
    case "mecanica-bloqueada":
      return t`Esta mecânica libera num tier acima.`;
    case "marco-nao-alcancado":
      return t`Você ainda não chegou ao marco da próxima evolução.`;
    case "pontos-nao-gastos":
      return t`Gaste os pontos de habilidade que ainda cabem na árvore antes de evoluir.`;
    case "tier-maximo":
      return t`Você já está no último tier.`;
    case "ja-treinando":
    case "training":
      return t`Você já está treinando no Dojô.`;
    case "treinando":
      return t`Pare o treino no Dojô antes de trocar de classe.`;
    case "mesma-classe":
      return t`Você já é dessa classe.`;
    case "lista-invalida":
      return t`Seleção inválida: marque os itens de novo.`;
    case "in_run":
      return t`Seu herói está numa dungeon agora.`;
    case "in_run_item":
      return t`Durante a corrida o Mercador só vende poção e munição; equipamento, quando ela acabar.`;
    case "run_starting":
      return t`A corrida está largando agora; tente de novo num instante.`;
    case "no_start":
      return t`Não há largada para cancelar.`;
    case "not_near":
      return t`Chegue mais perto.`;
    case "no_hero":
      return t`Escolha a classe primeiro.`;
    case "has_hero":
      return t`Você já tem um herói.`;
    case "changed":
      return t`O herói mudou enquanto isso. Confira e tente de novo.`;
    case "game_disabled":
      return t`O jogo está desligado neste servidor.`;
    case "rate_limited":
      return t`Devagar: muitos comandos seguidos.`;
    case "para-si-mesmo":
      return t`Escolha outra pessoa.`;
    case "valor-invalido":
    case "quantidade-invalida":
      return t`Valor inválido.`;
    case "full":
      return t`O grupo está cheio.`;
    case "level":
      return t`Alguém do grupo ainda não tem o nível desta dungeon.`;
    case "region":
      return t`O Chefe de Região só abre para quem concluiu as Caçadas e Masmorras da região. Alguém do grupo ainda não concluiu.`;
    case "not_leader":
      return t`Só quem montou o grupo pode fazer isso.`;
    case "tv_busy":
      return t`Já tem um grupo se formando nesta TV. Entre nele ou espere.`;
    case "in_lobby":
      return t`Você já está em outro grupo. Saia dele primeiro.`;
    case "no_lobby":
      return t`Esse grupo não existe mais.`;
    case "no_run":
      return t`Essa corrida já acabou.`;
    default:
      return t`Não deu certo agora. Tente de novo.`;
  }
}
