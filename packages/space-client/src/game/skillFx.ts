import type { FrameStatus } from "@muchat/space-core/game/ot/balance";

/**
 * Os efeitos de skill na cena da corrida (fase 1, 26/11/2026, pedido do dono: "um efeito para cada
 * skill; a Nuvem Tóxica cobre os inimigos com uma fumaça verde de veneno"). Puro: o roteiro
 * (`planSecond`) e a cena leem daqui. Skill sem receita segue como antes (avanço e corte, ou
 * projétil e estrela, na cor do elemento).
 *
 * Duas portas de entrada, pelos dados que já chegam em cada segundo:
 *  - `on: "acerto"`: o efeito sai em cada acerto da skill (eventos `magia`), agrupado por quem
 *    soltou — a skill de área vira um efeito só, não um projétil por alvo;
 *  - `on: "lancamento"`: o efeito sai quando a skill é solta (evento `lanca`): as que não dão dano
 *    na hora (DoT, escudo), e a cena resolve os alvos (os monstros vivos, o próprio herói, o grupo).
 * O que dura (a nuvem, o círculo no chão, o gelo, a bolha) vem dos efeitos ativos do quadro
 * (`lingerFor`): aparece e some junto com o efeito do jogo.
 */

/** Cores dos efeitos (as do número de dano e das marcas, para a cena falar a mesma língua). */
export const FX_COLOR = {
  veneno: 0x8eff3c,
  sagrado: 0xffd86b,
  gelo: 0xbfe8ff,
  mana: 0x6aa8ff,
  escudo: 0xf3d27a,
  branco: 0xffffff,
} as const;

export type CastFx =
  /** Lâminas girando em volta de quem solta e um corte em cada alvo (Redemoinho). */
  | { on: "acerto"; kind: "giro" }
  /** Projéteis caindo do alto em cada alvo (Chuva de Flechas). */
  | { on: "acerto"; kind: "chuva"; art: "flecha"; n: number }
  /** Uma pedra caindo em cada alvo e o estouro (Meteoro). */
  | { on: "acerto"; kind: "queda"; art: "meteoro" }
  /** Raio de quem solta ao 1º alvo e de um alvo ao seguinte (Raio em Cadeia). */
  | { on: "acerto"; kind: "cadeia" }
  /** A nuvem que abre em cada monstro vivo (Nuvem Tóxica). */
  | { on: "lancamento"; kind: "nuvem"; color: number }
  /** O anel que abre no chão de cada monstro vivo (Consagração). */
  | { on: "lancamento"; kind: "anel"; color: number }
  /** Flocos caindo em cada monstro vivo (Nevasca). */
  | { on: "lancamento"; kind: "flocos"; color: number }
  /** A bolha que estoura em volta de quem ganha o escudo. */
  | {
      on: "lancamento";
      kind: "bolha";
      color: number;
      alvo: "proprio" | "grupo" | "quemTemEscudo";
    };

export const CAST_FX: Readonly<Record<string, CastFx>> = {
  redemoinho: { on: "acerto", kind: "giro" },
  "chuva-de-flechas": { on: "acerto", kind: "chuva", art: "flecha", n: 3 },
  meteoro: { on: "acerto", kind: "queda", art: "meteoro" },
  "raio-em-cadeia": { on: "acerto", kind: "cadeia" },
  fumaca: { on: "lancamento", kind: "nuvem", color: FX_COLOR.veneno },
  consagracao: { on: "lancamento", kind: "anel", color: FX_COLOR.sagrado },
  nevasca: { on: "lancamento", kind: "flocos", color: FX_COLOR.gelo },
  "escudo-da-fe": {
    on: "lancamento",
    kind: "bolha",
    color: FX_COLOR.escudo,
    alvo: "proprio",
  },
  "escudo-de-mana": {
    on: "lancamento",
    kind: "bolha",
    color: FX_COLOR.mana,
    alvo: "proprio",
  },
  "escudo-sagrado": {
    on: "lancamento",
    kind: "bolha",
    color: FX_COLOR.branco,
    alvo: "quemTemEscudo",
  },
};

export function castFx(skill: string): CastFx | null {
  return CAST_FX[skill] ?? null;
}

/** O que fica desenhado num herói ou monstro enquanto um efeito do jogo está ativo nele. */
export interface LingerFx {
  art: "nuvem" | "glifo" | "floco" | "bolha" | "elo";
  color: number;
  /** Embaixo da unidade (no chão), por cima dela ou em volta dela. */
  layer: "chao" | "cima" | "volta";
  /** No elo: o herói da outra ponta (quem protege). */
  from?: number;
}

/**
 * O efeito que dura, pelo efeito ativo do quadro (a skill que pôs e o tipo). Um por skill e unidade:
 * duas camadas da mesma Nuvem Tóxica são uma nuvem só.
 */
export function lingerFor(
  st: Pick<FrameStatus, "s" | "k"> & Partial<Pick<FrameStatus, "st" | "a">>,
): LingerFx | null {
  // D66: a Devoção liga o aliado ao paladino que toma parte do dano dele.
  if (st.k === "buff" && st.st === "devocao" && st.a !== undefined)
    return { art: "elo", color: FX_COLOR.sagrado, layer: "chao", from: st.a };
  if (st.k === "dot" && st.s === "fumaca")
    return { art: "nuvem", color: FX_COLOR.veneno, layer: "cima" };
  if (st.k === "dot" && st.s === "consagracao")
    return { art: "glifo", color: FX_COLOR.sagrado, layer: "chao" };
  if ((st.k === "dot" || st.k === "debuff") && st.s === "nevasca")
    return { art: "floco", color: FX_COLOR.gelo, layer: "cima" };
  if (st.k === "mana")
    return { art: "bolha", color: FX_COLOR.mana, layer: "volta" };
  if (st.k === "escudo")
    return {
      art: "bolha",
      color: st.s === "escudo-sagrado" ? FX_COLOR.branco : FX_COLOR.escudo,
      layer: "volta",
    };
  return null;
}

/** As que duram numa unidade, sem repetir a mesma arte (a chave é a arte e a cor). */
export function lingersOf(
  list:
    | readonly (Pick<FrameStatus, "s" | "k"> & Partial<Pick<FrameStatus, "st" | "a">>)[]
    | undefined,
): LingerFx[] {
  const out: LingerFx[] = [];
  const seen = new Set<string>();
  for (const st of list ?? []) {
    const fx = lingerFor(st);
    if (!fx) continue;
    const key = `${fx.art}|${fx.color}|${fx.from ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fx);
  }
  return out;
}
